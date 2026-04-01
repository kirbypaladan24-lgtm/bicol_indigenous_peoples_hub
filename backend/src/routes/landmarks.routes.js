import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { optionalAuth, requireAuth, requireRoles } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { parsePagination } from "../utils/pagination.js";
import { logAdminActivity } from "../utils/audit-log.js";
import { notFound } from "../utils/api-error.js";
import { ROLE } from "../utils/roles.js";
import {
  ensureObject,
  parseColor,
  parseLatitude,
  parseLongitude,
  parseRequiredString,
  parseUrl,
  pickDisplayName,
} from "../utils/validators.js";

const router = Router();
const writeLimiter = createRateLimiter({
  name: "landmarks-write",
  max: env.writeRateLimitMax,
  message: "Too many landmark changes were submitted. Please wait and try again.",
});

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);
    const result = await query(
      `
      SELECT *
      FROM landmarks
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    res.json({ page, limit, items: result.rows });
  })
);

router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const result = await query(
      `
      SELECT *
      FROM landmarks
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      throw notFound("Landmark not found.");
    }

    res.json(result.rows[0]);
  })
);

router.post(
  "/",
  requireAuth,
  requireRoles(ROLE.LANDMARK_ADMIN, ROLE.SUPER_ADMIN),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const name = parseRequiredString(body.name, "name", { minLength: 3, maxLength: 180 });
    const summary = parseRequiredString(body.summary, "summary", {
      minLength: 10,
      maxLength: 10000,
    });
    const latitude = parseLatitude(body.latitude);
    const longitude = parseLongitude(body.longitude);
    const coverUrl = parseUrl(body.cover_url, "cover_url", false);
    const color = parseColor(body.color);

    const result = await withTransaction(async (client) => {
      const created = await client.query(
        `
        INSERT INTO landmarks (name, summary, latitude, longitude, cover_url, color, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING *
        `,
        [name, summary, latitude, longitude, coverUrl, color, req.auth.dbUser.id]
      );

      const landmark = created.rows[0];

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "landmark_created",
        targetType: "landmark",
        targetId: landmark.id,
        targetLabel: landmark.name,
        summary: `${pickDisplayName(req.auth.dbUser)} created a landmark.`,
      });

      return landmark;
    });

    res.status(201).json(result);
  })
);

router.put(
  "/:id",
  requireAuth,
  requireRoles(ROLE.LANDMARK_ADMIN, ROLE.SUPER_ADMIN),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const existing = await query(
      `
      SELECT *
      FROM landmarks
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!existing.rows.length) {
      throw notFound("Landmark not found.");
    }

    const body = ensureObject(req.body);
    const name =
      body.name !== undefined
        ? parseRequiredString(body.name, "name", { minLength: 3, maxLength: 180 })
        : null;
    const summary =
      body.summary !== undefined
        ? parseRequiredString(body.summary, "summary", { minLength: 10, maxLength: 10000 })
        : null;
    const latitude = body.latitude !== undefined ? parseLatitude(body.latitude) : null;
    const longitude = body.longitude !== undefined ? parseLongitude(body.longitude) : null;
    const coverUrl =
      body.cover_url !== undefined ? parseUrl(body.cover_url, "cover_url", false) : undefined;
    const color = body.color !== undefined ? parseColor(body.color) : undefined;

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `
        UPDATE landmarks
        SET
          name = COALESCE($2, name),
          summary = COALESCE($3, summary),
          latitude = COALESCE($4, latitude),
          longitude = COALESCE($5, longitude),
          cover_url = CASE WHEN $6 THEN $7 ELSE cover_url END,
          color = CASE WHEN $8 THEN $9 ELSE color END,
          updated_by = $10
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
        `,
        [
          req.params.id,
          name,
          summary,
          latitude,
          longitude,
          coverUrl !== undefined,
          coverUrl ?? null,
          color !== undefined,
          color ?? null,
          req.auth.dbUser.id,
        ]
      );

      if (!updated.rows.length) {
        throw notFound("Landmark not found.");
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "landmark_edited",
        targetType: "landmark",
        targetId: req.params.id,
        targetLabel: updated.rows[0].name,
        summary: `${pickDisplayName(req.auth.dbUser)} updated a landmark.`,
      });

      return updated.rows[0];
    });

    res.json(result);
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRoles(ROLE.LANDMARK_ADMIN, ROLE.SUPER_ADMIN),
  writeLimiter,
  asyncHandler(async (req, res) => {
    await withTransaction(async (client) => {
      const result = await client.query(
        `
        UPDATE landmarks
        SET deleted_at = NOW(), updated_by = $2
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, name
        `,
        [req.params.id, req.auth.dbUser.id]
      );

      if (!result.rows.length) {
        throw notFound("Landmark not found.");
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "landmark_deleted",
        targetType: "landmark",
        targetId: req.params.id,
        targetLabel: result.rows[0].name,
        summary: `${pickDisplayName(req.auth.dbUser)} deleted a landmark.`,
      });
    });

    res.status(204).send();
  })
);

export default router;
