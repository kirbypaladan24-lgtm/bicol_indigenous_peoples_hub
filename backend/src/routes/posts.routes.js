import { Router } from "express";
import { query, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { parsePagination } from "../utils/pagination.js";
import { logAdminActivity } from "../utils/audit-log.js";
import { forbidden, notFound } from "../utils/api-error.js";
import { canManagePosts } from "../utils/roles.js";
import {
  ensureObject,
  parseBoolean,
  parseMediaItems,
  parseRequiredString,
  pickDisplayName,
} from "../utils/validators.js";

const router = Router();
const writeLimiter = createRateLimiter({
  name: "posts-write",
  max: env.writeRateLimitMax,
  message: "Too many post changes were submitted. Please slow down.",
});

async function loadPostForAccess(postId) {
  const result = await query(
    `
    SELECT id, author_user_id, author_name, title, content, cover_url, is_published
    FROM posts
    WHERE id = $1 AND deleted_at IS NULL
    LIMIT 1
    `,
    [postId]
  );

  return result.rows[0] || null;
}

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);
    const isManager = req.auth?.role ? canManagePosts(req.auth.role) : false;

    const result = await query(
      `
      SELECT
        p.id,
        p.author_user_id,
        p.author_name,
        p.title,
        p.content,
        p.cover_url,
        p.likes_count,
        p.dislikes_count,
        p.is_published,
        p.created_at,
        p.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pm.id,
              'media_url', pm.media_url,
              'media_type', pm.media_type,
              'sort_order', pm.sort_order
            )
            ORDER BY pm.sort_order
          ) FILTER (WHERE pm.id IS NOT NULL),
          '[]'::json
        ) AS media_items
      FROM posts p
      LEFT JOIN post_media pm ON pm.post_id = p.id
      WHERE
        p.deleted_at IS NULL
        AND (
          p.is_published = TRUE
          OR $1 = TRUE
          OR ($2::bigint IS NOT NULL AND p.author_user_id = $2)
        )
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
      `,
      [isManager, req.auth?.dbUser?.id || null, limit, offset]
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
      SELECT
        p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pm.id,
              'media_url', pm.media_url,
              'media_type', pm.media_type,
              'sort_order', pm.sort_order
            )
            ORDER BY pm.sort_order
          ) FILTER (WHERE pm.id IS NOT NULL),
          '[]'::json
        ) AS media_items
      FROM posts p
      LEFT JOIN post_media pm ON pm.post_id = p.id
      WHERE p.id = $1 AND p.deleted_at IS NULL
      GROUP BY p.id
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      throw notFound("Post not found.");
    }

    const post = result.rows[0];
    const isOwner = String(post.author_user_id) === String(req.auth?.dbUser?.id || "");
    const canViewUnpublished = req.auth?.role
      ? canManagePosts(req.auth.role) || isOwner
      : false;

    if (!post.is_published && !canViewUnpublished) {
      throw notFound("Post not found.");
    }

    res.json(post);
  })
);

router.post(
  "/",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body);
    const title = parseRequiredString(body.title, "title", { minLength: 3, maxLength: 250 });
    const content = parseRequiredString(body.content, "content", {
      minLength: 10,
      maxLength: 20000,
    });
    const mediaItems = parseMediaItems(body.media);
    const isPublished =
      canManagePosts(req.auth.role) && body.is_published !== undefined
        ? parseBoolean(body.is_published, "is_published", true)
        : true;

    const created = await withTransaction(async (client) => {
      const postResult = await client.query(
        `
        INSERT INTO posts (author_user_id, author_name, title, content, cover_url, is_published)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
          req.auth.dbUser.id,
          pickDisplayName(req.auth.dbUser),
          title,
          content,
          mediaItems[0]?.media_url || null,
          isPublished,
        ]
      );

      const post = postResult.rows[0];

      for (const item of mediaItems) {
        await client.query(
          `
          INSERT INTO post_media (post_id, media_url, media_type, sort_order)
          VALUES ($1, $2, $3, $4)
          `,
          [post.id, item.media_url, item.media_type, item.sort_order]
        );
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "post_created",
        targetType: "post",
        targetId: post.id,
        targetLabel: post.title,
        summary: `${pickDisplayName(req.auth.dbUser)} created a post.`,
      });

      return post;
    });

    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const existingPost = await loadPostForAccess(req.params.id);
    if (!existingPost) {
      throw notFound("Post not found.");
    }

    const isOwner = String(existingPost.author_user_id) === String(req.auth.dbUser.id);
    const isManager = canManagePosts(req.auth.role);

    if (!isOwner && !isManager) {
      throw forbidden("You are not allowed to edit this post.");
    }

    const body = ensureObject(req.body);
    const title =
      body.title !== undefined
        ? parseRequiredString(body.title, "title", { minLength: 3, maxLength: 250 })
        : null;
    const content =
      body.content !== undefined
        ? parseRequiredString(body.content, "content", { minLength: 10, maxLength: 20000 })
        : null;
    const mediaProvided = body.media !== undefined;
    const mediaItems = mediaProvided ? parseMediaItems(body.media) : null;
    const isPublished =
      body.is_published !== undefined && isManager
        ? parseBoolean(body.is_published, "is_published", existingPost.is_published)
        : null;

    const updated = await withTransaction(async (client) => {
      const postResult = await client.query(
        `
        UPDATE posts
        SET
          title = COALESCE($2, title),
          content = COALESCE($3, content),
          cover_url = CASE WHEN $4 THEN $5 ELSE cover_url END,
          is_published = COALESCE($6, is_published)
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
        `,
        [
          req.params.id,
          title,
          content,
          mediaProvided,
          mediaItems?.[0]?.media_url || null,
          isPublished,
        ]
      );

      if (!postResult.rows.length) {
        return null;
      }

      if (mediaProvided) {
        await client.query("DELETE FROM post_media WHERE post_id = $1", [req.params.id]);
        for (const item of mediaItems) {
          await client.query(
            `
            INSERT INTO post_media (post_id, media_url, media_type, sort_order)
            VALUES ($1, $2, $3, $4)
            `,
            [req.params.id, item.media_url, item.media_type, item.sort_order]
          );
        }
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "post_edited",
        targetType: "post",
        targetId: req.params.id,
        targetLabel: title || existingPost.title,
        summary: `${pickDisplayName(req.auth.dbUser)} updated a post.`,
      });

      return postResult.rows[0];
    });

    if (!updated) {
      throw notFound("Post not found.");
    }

    res.json(updated);
  })
);

router.delete(
  "/:id",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const existingPost = await loadPostForAccess(req.params.id);
    if (!existingPost) {
      throw notFound("Post not found.");
    }

    const isOwner = String(existingPost.author_user_id) === String(req.auth.dbUser.id);
    const isManager = canManagePosts(req.auth.role);

    if (!isOwner && !isManager) {
      throw forbidden("You are not allowed to delete this post.");
    }

    await withTransaction(async (client) => {
      const result = await client.query(
        `
        UPDATE posts
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, title
        `,
        [req.params.id]
      );

      if (!result.rows.length) {
        throw notFound("Post not found.");
      }

      await logAdminActivity(client, req.auth.dbUser, {
        actionType: "post_deleted",
        targetType: "post",
        targetId: req.params.id,
        targetLabel: result.rows[0].title,
        summary: `${pickDisplayName(req.auth.dbUser)} deleted a post.`,
      });
    });

    res.status(204).send();
  })
);

export default router;
