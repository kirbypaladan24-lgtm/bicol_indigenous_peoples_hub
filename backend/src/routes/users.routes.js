import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { parsePagination } from "../utils/pagination.js";
import { forbidden, notFound } from "../utils/api-error.js";
import { ROLE } from "../utils/roles.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRoles(ROLE.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);
    const params = [];
    const where = [];

    if (req.query.role) {
      params.push(String(req.query.role));
      where.push(`u.role = $${params.length}`);
    }

    if (req.query.active !== undefined) {
      params.push(String(req.query.active) === "true");
      where.push(`u.is_active = $${params.length}`);
    }

    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where.push(`(
        u.email::text ILIKE $${params.length}
        OR COALESCE(u.username, '') ILIKE $${params.length}
        OR COALESCE(u.display_name, '') ILIKE $${params.length}
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, offset);

    const result = await query(
      `
      SELECT
        u.id,
        u.firebase_uid,
        u.email,
        u.username,
        u.display_name,
        u.role,
        u.is_active,
        u.email_verified,
        u.is_anonymous,
        u.preferred_language,
        u.created_at,
        u.last_login_at,
        up.phone,
        up.birthdate
      FROM users u
      LEFT JOIN users_private up ON up.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    res.json({ page, limit, items: result.rows });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await query(
      `
      SELECT
        u.*,
        up.phone,
        up.birthdate,
        up.address,
        up.emergency_contact_name,
        up.emergency_contact_phone
      FROM users u
      LEFT JOIN users_private up ON up.user_id = u.id
      WHERE u.id::text = $1 OR u.firebase_uid = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      throw notFound("User not found.");
    }

    const user = result.rows[0];
    const isSelf =
      String(user.id) === String(req.auth.dbUser.id) ||
      String(user.firebase_uid) === String(req.auth.firebaseUid);

    if (!isSelf && req.auth.role !== ROLE.SUPER_ADMIN) {
      throw forbidden("You are not allowed to view this user record.");
    }

    res.json(user);
  })
);

export default router;
