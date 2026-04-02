import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { parsePagination } from "../utils/pagination.js";
import { logAdminActivity } from "../utils/audit-log.js";
import { forbidden, notFound } from "../utils/api-error.js";
import { MANAGED_ADMIN_ROLES, PRIMARY_SUPER_ADMIN_UID, ROLE } from "../utils/roles.js";
import {
  ensureObject,
  parseBoolean,
  parseEnum,
  parseOptionalString,
  pickDisplayName,
} from "../utils/validators.js";

const router = Router();
const adminWriteLimiter = createRateLimiter({
  name: "admin-write",
  max: env.writeRateLimitMax,
  message: "Too many admin-access changes were submitted. Please slow down.",
});

router.use(requireAuth, requireRoles(ROLE.SUPER_ADMIN));

router.get(
  "/activity-logs",
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);
    const result = await query(
      `
      SELECT *
      FROM admin_activity_logs
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    res.json({ page, limit, items: result.rows });
  })
);

router.get(
  "/access",
  asyncHandler(async (req, res) => {
    const result = await query(
      `
      SELECT
        aa.user_id,
        aa.role,
        aa.active,
        aa.granted_by,
        aa.updated_by,
        aa.notes,
        aa.granted_at,
        aa.updated_at,
        u.firebase_uid,
        u.email,
        u.username,
        u.display_name,
        u.is_active
      FROM admin_access aa
      JOIN users u ON u.id = aa.user_id
      ORDER BY aa.role, u.username NULLS LAST, u.email
      `
    );

    res.json(result.rows);
  })
);

router.put(
  "/access/:userId",
  adminWriteLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const role = parseEnum(body.role, "role", MANAGED_ADMIN_ROLES, { required: true });
    const active = parseBoolean(body.active, "active", true);
    const notes = parseOptionalString(body.notes, "notes", { maxLength: 5000 });

    const updated = await withTransaction(async (client) => {
      const targetUserResult = await client.query(
        `
        SELECT id, firebase_uid, email, username, display_name
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [req.params.userId]
      );

      if (!targetUserResult.rows.length) {
        throw notFound("The target user does not exist.");
      }

      const targetUser = targetUserResult.rows[0];

      if (targetUser.firebase_uid === PRIMARY_SUPER_ADMIN_UID) {
        throw forbidden("The primary super admin account is fixed and cannot be changed here.");
      }

      if (String(targetUser.id) === String(req.auth.dbUser.id)) {
        throw forbidden("The current super admin account cannot change its own delegated admin access.");
      }

      await client.query(
        `
        UPDATE users
        SET role = $2
        WHERE id = $1
        `,
        [req.params.userId, active ? role : ROLE.USER]
      );

      const result = await client.query(
        `
        INSERT INTO admin_access (user_id, role, active, granted_by, updated_by, notes)
        VALUES ($1, $2, $3, $4, $4, $5)
        ON CONFLICT (user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          active = EXCLUDED.active,
          granted_by = COALESCE(admin_access.granted_by, EXCLUDED.granted_by),
          updated_by = EXCLUDED.updated_by,
          notes = EXCLUDED.notes
        RETURNING *
        `,
        [req.params.userId, role, active, req.auth.dbUser.id, notes]
      );

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: active ? "admin_access_updated" : "admin_disabled",
        targetType: "user",
        targetId: String(targetUser.id),
        targetLabel: targetUser.display_name || targetUser.username || targetUser.email,
        summary: `${pickDisplayName(req.auth.dbUser)} set ${targetUser.email} to ${role} (${active ? "active" : "inactive"}).`,
      });

      return result.rows[0];
    });

    res.json(updated);
  })
);

export default router;
