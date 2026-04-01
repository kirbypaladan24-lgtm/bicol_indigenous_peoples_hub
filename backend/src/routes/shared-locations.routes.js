import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAdminActivity } from "../utils/audit-log.js";
import { badRequest, forbidden, notFound } from "../utils/api-error.js";
import { ROLE } from "../utils/roles.js";
import {
  ensureObject,
  parseBoolean,
  parseEnum,
  parseInteger,
  parseLatitude,
  parseLongitude,
  parseOptionalString,
  parseUrl,
  pickDisplayName,
} from "../utils/validators.js";

const router = Router();
const writeLimiter = createRateLimiter({
  name: "shared-location-write",
  max: env.writeRateLimitMax,
  message: "Too many location updates were submitted. Please try again in a moment.",
});

function resolveTargetUserId(req) {
  return req.params.userId === "me" ? req.auth.dbUser.id : req.params.userId;
}

router.get(
  "/",
  requireAuth,
  requireRoles(ROLE.EMERGENCY_ADMIN, ROLE.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await query(
      `
      SELECT *
      FROM shared_locations
      WHERE sharing_enabled = TRUE
      ORDER BY updated_at DESC
      `
    );
    res.json(result.rows);
  })
);

router.get(
  "/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetUserId = String(resolveTargetUserId(req));
    const isSelf = targetUserId === String(req.auth.dbUser.id);
    const isEmergencyManager =
      req.auth.role === ROLE.EMERGENCY_ADMIN || req.auth.role === ROLE.SUPER_ADMIN;

    if (!isSelf && !isEmergencyManager) {
      throw forbidden("You are not allowed to view this shared location.");
    }

    const result = await query(
      `
      SELECT *
      FROM shared_locations
      WHERE user_id = $1
      LIMIT 1
      `,
      [targetUserId]
    );

    if (!result.rows.length) {
      throw notFound("Shared location not found.");
    }

    res.json(result.rows[0]);
  })
);

router.post(
  "/upsert",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const isEmergencyManager =
      req.auth.role === ROLE.EMERGENCY_ADMIN || req.auth.role === ROLE.SUPER_ADMIN;
    const targetUserId =
      isEmergencyManager && body.user_id ? parseInteger(body.user_id, "user_id", { min: 1 }) : req.auth.dbUser.id;

    if (!isEmergencyManager && String(targetUserId) !== String(req.auth.dbUser.id)) {
      throw forbidden("You can only update your own shared location.");
    }

    const consentAccepted = parseBoolean(body.consent_accepted, "consent_accepted", false);
    const sharingEnabled = parseBoolean(body.sharing_enabled, "sharing_enabled", false);
    const emergencyActive = parseBoolean(body.emergency_active, "emergency_active", false);
    const latitude = parseLatitude(body.latitude, "latitude", false);
    const longitude = parseLongitude(body.longitude, "longitude", false);
    const accuracyMeters = parseInteger(body.accuracy_meters, "accuracy_meters", {
      min: 0,
    });
    const phoneSnapshot = parseOptionalString(body.phone_snapshot, "phone_snapshot", {
      maxLength: 32,
    });
    const emergencyMessage = emergencyActive
      ? parseOptionalString(body.emergency_message, "emergency_message", {
          minLength: 5,
          maxLength: 5000,
        })
      : null;
    const emergencyImageUrl = emergencyActive
      ? parseUrl(body.emergency_image_url, "emergency_image_url", true)
      : null;

    if (emergencyActive && !emergencyMessage) {
      throw badRequest("An emergency message is required when emergency_active is true.");
    }

    const result = await query(
      `
      INSERT INTO shared_locations (
        user_id, username_snapshot, email_snapshot, phone_snapshot,
        latitude, longitude, accuracy_meters,
        consent_accepted, consent_accepted_at, sharing_enabled,
        emergency_active, emergency_message, emergency_image_url,
        emergency_status, emergency_submitted_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, CASE WHEN $8 THEN COALESCE($9, NOW()) ELSE NULL END, $10,
        $11, $12, $13,
        CASE WHEN $11 THEN 'pending' ELSE NULL END,
        CASE WHEN $11 THEN NOW() ELSE NULL END
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        username_snapshot = EXCLUDED.username_snapshot,
        email_snapshot = EXCLUDED.email_snapshot,
        phone_snapshot = EXCLUDED.phone_snapshot,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        accuracy_meters = EXCLUDED.accuracy_meters,
        consent_accepted = EXCLUDED.consent_accepted,
        consent_accepted_at = COALESCE(shared_locations.consent_accepted_at, EXCLUDED.consent_accepted_at),
        sharing_enabled = EXCLUDED.sharing_enabled,
        emergency_active = EXCLUDED.emergency_active,
        emergency_message = EXCLUDED.emergency_message,
        emergency_image_url = EXCLUDED.emergency_image_url,
        emergency_status = EXCLUDED.emergency_status,
        emergency_submitted_at = EXCLUDED.emergency_submitted_at
      RETURNING *
      `,
      [
        targetUserId,
        pickDisplayName(req.auth.dbUser),
        req.auth.dbUser.email,
        phoneSnapshot,
        latitude,
        longitude,
        accuracyMeters,
        consentAccepted,
        body.consent_accepted_at || null,
        sharingEnabled,
        emergencyActive,
        emergencyMessage,
        emergencyImageUrl,
      ]
    );

    res.json(result.rows[0]);
  })
);

router.patch(
  "/:userId/response",
  requireAuth,
  requireRoles(ROLE.EMERGENCY_ADMIN, ROLE.SUPER_ADMIN),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const targetUserId = parseInteger(resolveTargetUserId(req), "userId", { min: 1 });
    const responseStatus = parseEnum(
      body.response_status || body.status,
      "response_status",
      ["approved", "help_on_the_way", "declined", "resolved"],
      { required: true }
    );
    const responseReason = parseOptionalString(body.response_reason || body.reason, "response_reason", {
      maxLength: 5000,
    });

    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        `
        UPDATE shared_locations
        SET
          response_status = $2,
          response_reason = $3,
          responded_at = NOW(),
          emergency_active = FALSE,
          emergency_status = NULL
        WHERE user_id = $1
        RETURNING *
        `,
        [targetUserId, responseStatus, responseReason]
      );

      if (!result.rows.length) {
        throw notFound("Shared location not found.");
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "emergency_responded",
        targetType: "shared_location",
        targetId: String(targetUserId),
        targetLabel: result.rows[0].username_snapshot || result.rows[0].email_snapshot,
        summary: `${pickDisplayName(req.auth.dbUser)} responded to a shared-location emergency.`,
      });

      return result.rows[0];
    });

    res.json(updated);
  })
);

export default router;
