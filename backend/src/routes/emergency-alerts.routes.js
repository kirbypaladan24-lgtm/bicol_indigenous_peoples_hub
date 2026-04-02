import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { parsePagination } from "../utils/pagination.js";
import { logAdminActivity } from "../utils/audit-log.js";
import { badRequest, forbidden, notFound } from "../utils/api-error.js";
import { ROLE } from "../utils/roles.js";
import { buildUserIdentitySnapshot, loadUserByIdOrThrow } from "../utils/user-records.js";
import {
  ensureObject,
  parseEnum,
  parseInteger,
  parseLatitude,
  parseLongitude,
  parseOptionalString,
  parseUrl,
  pickDisplayName,
} from "../utils/validators.js";

const router = Router();
const createLimiter = createRateLimiter({
  name: "emergency-create",
  max: env.emergencyRateLimitMax,
  message: "Too many emergency alerts were sent from this source. Please wait and try again.",
});
const responseLimiter = createRateLimiter({
  name: "emergency-response",
  max: 30,
  message: "Too many emergency responses were submitted. Please wait and try again.",
});

router.get(
  "/",
  requireAuth,
  requireRoles(ROLE.EMERGENCY_ADMIN, ROLE.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);
    const params = [];
    const where = [];

    if (req.query.status) {
      params.push(String(req.query.status));
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);

    const result = await query(
      `
      SELECT *
      FROM emergency_alerts
      ${whereClause}
      ORDER BY submitted_at DESC
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
      SELECT *
      FROM emergency_alerts
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      throw notFound("Emergency alert not found.");
    }

    const alert = result.rows[0];
    const isOwner = String(alert.user_id) === String(req.auth.dbUser.id);
    const isEmergencyManager =
      req.auth.role === ROLE.EMERGENCY_ADMIN || req.auth.role === ROLE.SUPER_ADMIN;

    if (!isOwner && !isEmergencyManager) {
      throw forbidden("You are not allowed to view this emergency alert.");
    }

    res.json(alert);
  })
);

router.post(
  "/",
  requireAuth,
  createLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const userId = body.user_id
      ? parseInteger(body.user_id, "user_id", { min: 1 })
      : req.auth.dbUser.id;
    const isEmergencyManager =
      req.auth.role === ROLE.EMERGENCY_ADMIN || req.auth.role === ROLE.SUPER_ADMIN;

    if (!isEmergencyManager && String(userId) !== String(req.auth.dbUser.id)) {
      throw forbidden("You can only submit an emergency alert for your own account.");
    }

    const latitude = parseLatitude(body.latitude);
    const longitude = parseLongitude(body.longitude);
    const accuracyMeters = parseInteger(body.accuracy_meters, "accuracy_meters", { min: 0 });
    const message = parseOptionalString(body.message, "message", {
      minLength: 5,
      maxLength: 5000,
    });
    const imageUrl = parseUrl(body.image_url, "image_url", true);

    if (!message) {
      throw badRequest("message is required.");
    }

    const result = await withTransaction(async (client) => {
      const targetUser = await loadUserByIdOrThrow(client, userId, "Target user not found.");
      const snapshot = buildUserIdentitySnapshot(targetUser);
      const inserted = await client.query(
        `
        INSERT INTO emergency_alerts (
          user_id, username_snapshot, email_snapshot, phone_snapshot,
          latitude, longitude, accuracy_meters,
          message, image_url, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
        RETURNING *
        `,
        [
          userId,
          snapshot.usernameSnapshot,
          snapshot.emailSnapshot,
          parseOptionalString(body.phone_snapshot, "phone_snapshot", { maxLength: 32 }),
          latitude,
          longitude,
          accuracyMeters,
          message,
          imageUrl,
        ]
      );

      return inserted.rows[0];
    });

    res.status(201).json(result);
  })
);

router.patch(
  "/:id/respond",
  requireAuth,
  requireRoles(ROLE.EMERGENCY_ADMIN, ROLE.SUPER_ADMIN),
  responseLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const status = parseEnum(body.status, "status", [
      "approved",
      "help_on_the_way",
      "declined",
      "resolved",
    ], { required: true });
    const responseReason = parseOptionalString(body.response_reason, "response_reason", {
      maxLength: 5000,
    });

    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        `
        UPDATE emergency_alerts
        SET
          status = $2,
          response_reason = $3,
          responded_by = $4,
          responded_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id, status, responseReason, req.auth.dbUser.id]
      );

      if (!result.rows.length) {
        throw notFound("Emergency alert not found.");
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "emergency_responded",
        targetType: "emergency_alert",
        targetId: req.params.id,
        targetLabel: result.rows[0].username_snapshot || result.rows[0].email_snapshot,
        summary: `${pickDisplayName(req.auth.dbUser)} responded to an emergency alert.`,
      });

      return result.rows[0];
    });

    res.json(updated);
  })
);

export default router;
