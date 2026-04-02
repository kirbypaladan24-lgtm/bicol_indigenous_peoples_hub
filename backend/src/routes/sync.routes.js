import { Router } from "express";
import { withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { getFirebaseFirestore, isFirebaseFirestoreConfigured } from "../config/firebase-admin.js";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { badRequest, forbidden } from "../utils/api-error.js";
import { canManageEmergencies, canManageLandmarks, canManagePosts, ROLE } from "../utils/roles.js";
import { ensureObject, parseEnum, parseRequiredString } from "../utils/validators.js";

const router = Router();

const syncLimiter = createRateLimiter({
  name: "firestore-postgres-sync",
  max: Math.max(60, env.writeRateLimitMax * 2),
  message: "Too many sync jobs were submitted. Please wait and try again.",
});

const SYNC_ENTITY_TYPES = [
  "user_profile",
  "post",
  "post_delete",
  "landmark",
  "landmark_delete",
  "shared_location",
  "emergency_alert",
  "admin_activity",
  "admin_access",
];

const EMERGENCY_STATUS_VALUES = [
  "pending",
  "approved",
  "help_on_the_way",
  "declined",
  "resolved",
];

const DEFAULT_ROLE_BY_UID = new Map([
  ["6bs7TaQnJBZDGiyhR1eoDMLncsb2", ROLE.SUPER_ADMIN],
  ["7gquSWQ94xZZLMxLCW4Xlv2QJ613", ROLE.CONTENT_ADMIN],
  ["L6aGCzr08Wd4gcj6ndiAqa0Z5dx2", ROLE.LANDMARK_ADMIN],
  ["TI0yeuCaYcggEJmjh7H4BlAmp562", ROLE.EMERGENCY_ADMIN],
]);

function normalizeString(value, maxLength = null) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeEmail(value, firebaseUid) {
  const trimmed = normalizeString(value, 320);
  if (trimmed && trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }
  return `${firebaseUid}@firebase.local`;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const lowered = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(lowered)) return true;
  if (["false", "0", "no", "off"].includes(lowered)) return false;
  return fallback;
}

function normalizeRole(value, fallback = ROLE.USER) {
  const normalized = normalizeString(value, 40);
  if (!normalized) return fallback;
  if (
    normalized === ROLE.USER ||
    normalized === ROLE.CONTENT_ADMIN ||
    normalized === ROLE.LANDMARK_ADMIN ||
    normalized === ROLE.EMERGENCY_ADMIN ||
    normalized === ROLE.SUPER_ADMIN
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeEmergencyStatus(value) {
  const normalized = normalizeString(value, 40);
  if (!normalized) return null;
  return EMERGENCY_STATUS_VALUES.includes(normalized) ? normalized : null;
}

function normalizeBirthdate(value) {
  const timestamp = normalizeTimestamp(value);
  if (timestamp) {
    return timestamp.toISOString().slice(0, 10);
  }

  const textValue = normalizeString(value, 40);
  if (!textValue) return null;
  const parsed = new Date(textValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function getPayloadEntityUid(job) {
  if (job.entityType === "user_profile") {
    return job.payload?.publicProfile?.uid || job.payload?.uid || job.ownerUid || job.firestoreId;
  }
  if (job.entityType === "post_delete") {
    return job.payload?.authorId || job.ownerUid || null;
  }
  if (job.entityType === "post") {
    return job.ownerUid || job.payload?.authorId || null;
  }
  if (job.entityType === "shared_location" || job.entityType === "emergency_alert") {
    return job.payload?.uid || job.payload?.userId || job.ownerUid || job.firestoreId;
  }
  if (job.entityType === "admin_activity") {
    return job.payload?.actorUid || job.ownerUid || null;
  }
  if (job.entityType === "admin_access") {
    return job.payload?.uid || job.ownerUid || job.firestoreId;
  }
  return job.ownerUid || null;
}

function assertSyncPermission(job, auth) {
  const role = auth?.role || ROLE.USER;
  const actorUid = auth?.firebaseUid || null;
  const targetUid = getPayloadEntityUid(job);
  const isOwnTarget = actorUid && targetUid && actorUid === targetUid;

  if (role === ROLE.SUPER_ADMIN) {
    return;
  }

  switch (job.entityType) {
    case "user_profile":
      if (isOwnTarget) return;
      break;
    case "post_delete":
      if (isOwnTarget || canManagePosts(role)) return;
      break;
    case "post":
      return;
    case "landmark":
    case "landmark_delete":
      if (canManageLandmarks(role)) return;
      break;
    case "shared_location":
    case "emergency_alert":
      if (isOwnTarget || canManageEmergencies(role)) return;
      break;
    case "admin_activity":
      if (
        role !== ROLE.USER &&
        ((job.payload?.actorUid && job.payload.actorUid === actorUid) || job.ownerUid === actorUid)
      ) {
        return;
      }
      break;
    case "admin_access":
      break;
    default:
      break;
  }

  throw forbidden("Your role does not allow this sync job.");
}

async function loadCanonicalFirestorePost(firestoreId) {
  if (!firestoreId || !isFirebaseFirestoreConfigured()) {
    return null;
  }

  try {
    const firestore = getFirebaseFirestore();
    const postSnap = await firestore.collection("posts").doc(String(firestoreId)).get();
    if (!postSnap.exists) return null;

    const postData = postSnap.data() || {};
    let authorProfile = null;
    const authorUid = normalizeString(postData.authorId, 128);
    if (authorUid) {
      const authorSnap = await firestore.collection("users").doc(authorUid).get();
      if (authorSnap.exists) {
        authorProfile = authorSnap.data() || null;
      }
    }

    return {
      id: postSnap.id,
      ...postData,
      authorProfile,
    };
  } catch (error) {
    console.warn("[Sync] Failed to load canonical Firestore post for PostgreSQL sync:", error);
    return null;
  }
}

async function hasUserFieldConflict(client, { field, value, firebaseUid }) {
  if (!value) return false;
  const result = await client.query(
    `
    SELECT 1
    FROM users
    WHERE ${field} = $1 AND firebase_uid <> $2
    LIMIT 1
    `,
    [value, firebaseUid]
  );
  return Boolean(result.rows.length);
}

async function upsertUserRecord(
  client,
  {
    firebaseUid,
    email = null,
    username = null,
    displayName = null,
    preferredLanguage = null,
    role = ROLE.USER,
    isAnonymous = false,
    isActive = true,
    emailVerified = false,
    photoUrl = null,
    createdAt = null,
    lastLoginAt = null,
  } = {}
) {
  if (!firebaseUid) {
    throw badRequest("A Firebase UID is required for user sync.");
  }

  let safeEmail = normalizeEmail(email, firebaseUid);
  let safeUsername = normalizeString(username, 80);
  const safeDisplayName = normalizeString(displayName, 120);
  const safeLanguage = normalizeString(preferredLanguage, 40);
  const safePhotoUrl = normalizeString(photoUrl, 2000);
  const safeRole = normalizeRole(role, DEFAULT_ROLE_BY_UID.get(firebaseUid) || ROLE.USER);

  if (await hasUserFieldConflict(client, { field: "email", value: safeEmail, firebaseUid })) {
    safeEmail = `${firebaseUid}@firebase.local`;
  }

  if (await hasUserFieldConflict(client, { field: "username", value: safeUsername, firebaseUid })) {
    safeUsername = null;
  }

  const result = await client.query(
    `
    INSERT INTO users (
      firebase_uid,
      email,
      username,
      display_name,
      role,
      is_anonymous,
      is_active,
      email_verified,
      photo_url,
      preferred_language,
      created_at,
      last_login_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE), $8, $9, $10, COALESCE($11, NOW()), $12)
    ON CONFLICT (firebase_uid)
    DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      username = COALESCE(EXCLUDED.username, users.username),
      display_name = COALESCE(EXCLUDED.display_name, users.display_name),
      role = CASE
        WHEN users.role = 'super_admin' THEN users.role
        ELSE COALESCE(EXCLUDED.role, users.role)
      END,
      is_anonymous = COALESCE(EXCLUDED.is_anonymous, users.is_anonymous),
      is_active = CASE
        WHEN users.is_active = FALSE THEN FALSE
        ELSE COALESCE(EXCLUDED.is_active, users.is_active)
      END,
      email_verified = COALESCE(EXCLUDED.email_verified, users.email_verified),
      photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
      preferred_language = COALESCE(EXCLUDED.preferred_language, users.preferred_language),
      last_login_at = COALESCE(EXCLUDED.last_login_at, users.last_login_at)
    RETURNING *
    `,
    [
      firebaseUid,
      safeEmail,
      safeUsername,
      safeDisplayName,
      safeRole,
      Boolean(isAnonymous),
      isActive,
      Boolean(emailVerified),
      safePhotoUrl,
      safeLanguage,
      normalizeTimestamp(createdAt),
      normalizeTimestamp(lastLoginAt),
    ]
  );

  return result.rows[0];
}

async function upsertUserPrivateRecord(client, userId, privateProfile = null) {
  if (!userId || !privateProfile || typeof privateProfile !== "object") {
    return null;
  }

  const phone = normalizeString(privateProfile.phone, 32);
  const birthdate = normalizeBirthdate(privateProfile.birthdate);
  const address = normalizeString(privateProfile.address, 2000);
  const emergencyContactName = normalizeString(privateProfile.emergencyContactName, 120);
  const emergencyContactPhone = normalizeString(privateProfile.emergencyContactPhone, 32);

  const result = await client.query(
    `
    INSERT INTO users_private (
      user_id,
      phone,
      birthdate,
      address,
      emergency_contact_name,
      emergency_contact_phone
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id)
    DO UPDATE SET
      phone = COALESCE(EXCLUDED.phone, users_private.phone),
      birthdate = COALESCE(EXCLUDED.birthdate, users_private.birthdate),
      address = COALESCE(EXCLUDED.address, users_private.address),
      emergency_contact_name = COALESCE(EXCLUDED.emergency_contact_name, users_private.emergency_contact_name),
      emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, users_private.emergency_contact_phone)
    RETURNING *
    `,
    [userId, phone, birthdate, address, emergencyContactName, emergencyContactPhone]
  );

  return result.rows[0];
}

async function ensureUserByFirebaseUid(
  client,
  firebaseUid,
  publicProfile = {},
  privateProfile = null,
  preferredRole = null
) {
  if (!firebaseUid) {
    throw badRequest("A Firebase UID is required.");
  }

  const user = await upsertUserRecord(client, {
    firebaseUid,
    email: publicProfile?.email,
    username: publicProfile?.username,
    displayName: publicProfile?.displayName || publicProfile?.username,
    preferredLanguage: publicProfile?.preferredLanguage,
    role: preferredRole || publicProfile?.role || DEFAULT_ROLE_BY_UID.get(firebaseUid) || ROLE.USER,
    isAnonymous: publicProfile?.isAnonymous,
    isActive: publicProfile?.isActive,
    emailVerified: publicProfile?.emailVerified,
    photoUrl: publicProfile?.photoUrl,
    createdAt: publicProfile?.createdAt,
    lastLoginAt: publicProfile?.lastLoginAt,
  });

  if (privateProfile) {
    await upsertUserPrivateRecord(client, user.id, privateProfile);
  }

  return user;
}

function buildMediaItemsFromPayload(payload = {}) {
  const rawItems = Array.isArray(payload.media) ? payload.media : [];
  if (!rawItems.length && payload.coverUrl) {
    return [
      {
        mediaUrl: String(payload.coverUrl),
        mediaType: "image",
        sortOrder: 0,
      },
    ];
  }

  return rawItems
    .map((item, index) => {
      if (!item) return null;
      if (typeof item === "string") {
        return {
          mediaUrl: item,
          mediaType: "image",
          sortOrder: index,
        };
      }

      const mediaUrl = normalizeString(item.media_url || item.url || item.mediaUrl, 2000);
      if (!mediaUrl) return null;

      return {
        mediaUrl,
        mediaType: normalizeString(item.media_type || item.type || item.mediaType, 30) || "image",
        sortOrder: normalizeInteger(item.sort_order ?? item.sortOrder) ?? index,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

async function syncUserProfileJob(client, job) {
  const payload = ensureObject(job.payload, "sync payload");
  const publicProfile =
    payload.publicProfile && typeof payload.publicProfile === "object"
      ? payload.publicProfile
      : payload;
  const privateProfile =
    payload.privateProfile && typeof payload.privateProfile === "object" ? payload.privateProfile : null;
  const targetUid = publicProfile?.uid || job.ownerUid || job.firestoreId;

  const user = await ensureUserByFirebaseUid(
    client,
    targetUid,
    publicProfile,
    privateProfile,
    DEFAULT_ROLE_BY_UID.get(targetUid) || ROLE.USER
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firebaseUid: targetUid,
    userId: user.id,
  };
}

async function syncPostJob(client, job, auth) {
  if (job.operation === "delete") {
    if (!canManagePosts(auth.role)) {
      const ownershipCheck = await client.query(
        `
        SELECT author_user_id
        FROM posts
        WHERE source_firestore_id = $1
        LIMIT 1
        `,
        [job.firestoreId]
      );
      if (
        ownershipCheck.rows.length &&
        String(ownershipCheck.rows[0].author_user_id || "") !== String(auth.dbUser.id)
      ) {
        throw forbidden("You are not allowed to sync deletion for this post.");
      }
    }

    const deleted = await client.query(
      `
      UPDATE posts
      SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE source_firestore_id = $1
      RETURNING id
      `,
      [job.firestoreId]
    );

    return {
      entityType: job.entityType,
      operation: job.operation,
      firestoreId: job.firestoreId,
      deleted: Boolean(deleted.rows.length),
    };
  }

  const canonicalPayload = await loadCanonicalFirestorePost(job.firestoreId);
  const payload = canonicalPayload || ensureObject(job.payload, "sync payload");
  const usingCanonicalFirestorePayload = Boolean(canonicalPayload);
  const authorUid = payload.authorId || job.ownerUid || auth.firebaseUid;
  if (
    !usingCanonicalFirestorePayload &&
    !canManagePosts(auth.role) &&
    job.ownerUid &&
    job.ownerUid !== auth.firebaseUid
  ) {
    throw forbidden("You can only sync your own posts.");
  }

  const authorProfile =
    payload.authorProfile && typeof payload.authorProfile === "object"
      ? payload.authorProfile
      : {
          uid: authorUid,
          email: payload.email || null,
          username: payload.author || null,
        };

  const authorUser = authorUid
    ? await ensureUserByFirebaseUid(client, authorUid, authorProfile, null, DEFAULT_ROLE_BY_UID.get(authorUid))
    : null;

  if (!usingCanonicalFirestorePayload && !canManagePosts(auth.role)) {
    const ownershipCheck = await client.query(
      `
      SELECT author_user_id
      FROM posts
      WHERE source_firestore_id = $1
      LIMIT 1
      `,
      [job.firestoreId]
    );
    if (
      ownershipCheck.rows.length &&
      String(ownershipCheck.rows[0].author_user_id || "") !== String(auth.dbUser.id)
    ) {
      throw forbidden("You are not allowed to sync changes for this post.");
    }
  }

  const mediaItems = buildMediaItemsFromPayload(payload);
  const postResult = await client.query(
    `
    INSERT INTO posts (
      source_firestore_id,
      author_user_id,
      author_name,
      title,
      content,
      cover_url,
      likes_count,
      dislikes_count,
      is_published,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), COALESCE($8, 0), COALESCE($9, TRUE), COALESCE($10, NOW()), COALESCE($11, NOW()), NULL)
    ON CONFLICT (source_firestore_id)
    DO UPDATE SET
      author_user_id = COALESCE(EXCLUDED.author_user_id, posts.author_user_id),
      author_name = EXCLUDED.author_name,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      cover_url = EXCLUDED.cover_url,
      likes_count = EXCLUDED.likes_count,
      dislikes_count = EXCLUDED.dislikes_count,
      is_published = EXCLUDED.is_published,
      updated_at = COALESCE(EXCLUDED.updated_at, posts.updated_at),
      deleted_at = NULL
    RETURNING id
    `,
    [
      job.firestoreId,
      authorUser?.id || null,
      normalizeString(payload.author, 120) || authorUser?.username || authorUser?.display_name || authorUser?.email || "Community Member",
      parseRequiredString(payload.title, "title", { minLength: 1, maxLength: 250 }),
      parseRequiredString(payload.content, "content", { minLength: 1, maxLength: 20000 }),
      normalizeString(payload.coverUrl || mediaItems[0]?.mediaUrl, 2000),
      normalizeInteger(payload.likes) ?? 0,
      normalizeInteger(payload.dislikes) ?? 0,
      payload.isPublished !== undefined ? normalizeBoolean(payload.isPublished, true) : true,
      normalizeTimestamp(payload.createdAt),
      normalizeTimestamp(payload.updatedAt),
    ]
  );

  const postId = postResult.rows[0].id;
  await client.query("DELETE FROM post_media WHERE post_id = $1", [postId]);

  for (const item of mediaItems) {
    await client.query(
      `
      INSERT INTO post_media (post_id, media_url, media_type, sort_order)
      VALUES ($1, $2, $3, $4)
      `,
      [postId, item.mediaUrl, item.mediaType, item.sortOrder]
    );
  }

  return {
    entityType: job.entityType,
    operation: job.operation,
    firestoreId: job.firestoreId,
    postId,
    mediaCount: mediaItems.length,
  };
}

async function syncLandmarkJob(client, job, auth) {
  if (job.operation === "delete") {
    const deleted = await client.query(
      `
      UPDATE landmarks
      SET deleted_at = COALESCE(deleted_at, NOW()), updated_by = $2
      WHERE source_firestore_id = $1
      RETURNING id
      `,
      [job.firestoreId, auth.dbUser.id]
    );

    return {
      entityType: job.entityType,
      operation: job.operation,
      firestoreId: job.firestoreId,
      deleted: Boolean(deleted.rows.length),
    };
  }

  const payload = ensureObject(job.payload, "sync payload");
  const result = await client.query(
    `
    INSERT INTO landmarks (
      source_firestore_id,
      name,
      summary,
      latitude,
      longitude,
      cover_url,
      color,
      created_by,
      updated_by,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, COALESCE($9, NOW()), COALESCE($10, NOW()), NULL)
    ON CONFLICT (source_firestore_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      summary = EXCLUDED.summary,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      cover_url = EXCLUDED.cover_url,
      color = EXCLUDED.color,
      updated_by = EXCLUDED.updated_by,
      updated_at = COALESCE(EXCLUDED.updated_at, landmarks.updated_at),
      deleted_at = NULL
    RETURNING id
    `,
    [
      job.firestoreId,
      parseRequiredString(payload.name, "name", { minLength: 1, maxLength: 180 }),
      parseRequiredString(payload.summary, "summary", { minLength: 1, maxLength: 10000 }),
      normalizeNumber(payload.lat),
      normalizeNumber(payload.lng),
      normalizeString(payload.coverUrl, 2000),
      normalizeString(payload.color, 16),
      auth.dbUser.id,
      normalizeTimestamp(payload.createdAt),
      normalizeTimestamp(payload.updatedAt),
    ]
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firestoreId: job.firestoreId,
    landmarkId: result.rows[0].id,
  };
}

async function syncSharedLocationJob(client, job) {
  const payload = ensureObject(job.payload, "sync payload");
  const targetUid = payload.uid || payload.userId || job.ownerUid || job.firestoreId;

  const user = await ensureUserByFirebaseUid(
    client,
    targetUid,
    {
      uid: targetUid,
      email: payload.email,
      username: payload.username,
      createdAt: payload.createdAt,
      lastLoginAt: payload.updatedAt,
    },
    payload.phone ? { phone: payload.phone } : null,
    DEFAULT_ROLE_BY_UID.get(targetUid)
  );

  const result = await client.query(
    `
    INSERT INTO shared_locations (
      user_id,
      username_snapshot,
      email_snapshot,
      phone_snapshot,
      latitude,
      longitude,
      accuracy_meters,
      consent_accepted,
      consent_accepted_at,
      sharing_enabled,
      emergency_active,
      emergency_message,
      emergency_image_url,
      emergency_status,
      emergency_submitted_at,
      response_status,
      response_reason,
      responded_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, COALESCE($8, FALSE), $9, COALESCE($10, FALSE),
      COALESCE($11, FALSE), $12, $13, $14, $15, $16, $17, $18
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
      consent_accepted_at = COALESCE(EXCLUDED.consent_accepted_at, shared_locations.consent_accepted_at),
      sharing_enabled = EXCLUDED.sharing_enabled,
      emergency_active = EXCLUDED.emergency_active,
      emergency_message = EXCLUDED.emergency_message,
      emergency_image_url = EXCLUDED.emergency_image_url,
      emergency_status = EXCLUDED.emergency_status,
      emergency_submitted_at = EXCLUDED.emergency_submitted_at,
      response_status = EXCLUDED.response_status,
      response_reason = EXCLUDED.response_reason,
      responded_at = EXCLUDED.responded_at
    RETURNING user_id
    `,
    [
      user.id,
      normalizeString(payload.username, 120),
      normalizeEmail(payload.email, targetUid),
      normalizeString(payload.phone, 32),
      normalizeNumber(payload.lat),
      normalizeNumber(payload.lng),
      normalizeInteger(payload.accuracy),
      payload.consentAccepted !== undefined ? normalizeBoolean(payload.consentAccepted, false) : false,
      normalizeTimestamp(payload.consentAcceptedAt),
      payload.sharingEnabled !== undefined ? normalizeBoolean(payload.sharingEnabled, false) : false,
      payload.emergencyActive !== undefined ? normalizeBoolean(payload.emergencyActive, false) : false,
      normalizeString(payload.emergencyMessage, 5000),
      normalizeString(payload.emergencyImageUrl, 2000),
      normalizeEmergencyStatus(payload.emergencyStatus),
      normalizeTimestamp(payload.emergencySubmittedAt),
      normalizeEmergencyStatus(payload.responseStatus),
      normalizeString(payload.responseReason, 5000),
      normalizeTimestamp(payload.respondedAt),
    ]
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firebaseUid: targetUid,
    userId: result.rows[0].user_id,
  };
}

async function syncEmergencyAlertJob(client, job) {
  const payload = ensureObject(job.payload, "sync payload");
  const targetUid = payload.uid || payload.userId || job.ownerUid;

  const user = await ensureUserByFirebaseUid(
    client,
    targetUid,
    {
      uid: targetUid,
      email: payload.email,
      username: payload.username,
    },
    payload.phone ? { phone: payload.phone } : null,
    DEFAULT_ROLE_BY_UID.get(targetUid)
  );

  let respondedByUserId = null;
  if (payload.respondedBy) {
    const responder = await ensureUserByFirebaseUid(
      client,
      payload.respondedBy,
      { uid: payload.respondedBy, role: DEFAULT_ROLE_BY_UID.get(payload.respondedBy) || ROLE.USER },
      null,
      DEFAULT_ROLE_BY_UID.get(payload.respondedBy)
    );
    respondedByUserId = responder.id;
  }

  const result = await client.query(
    `
    INSERT INTO emergency_alerts (
      source_firestore_id,
      user_id,
      username_snapshot,
      email_snapshot,
      phone_snapshot,
      latitude,
      longitude,
      accuracy_meters,
      message,
      image_url,
      status,
      response_reason,
      responded_by,
      responded_at,
      submitted_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      COALESCE($11, 'pending'), $12, $13, $14, COALESCE($15, NOW()), COALESCE($16, NOW())
    )
    ON CONFLICT (source_firestore_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      username_snapshot = EXCLUDED.username_snapshot,
      email_snapshot = EXCLUDED.email_snapshot,
      phone_snapshot = EXCLUDED.phone_snapshot,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      accuracy_meters = EXCLUDED.accuracy_meters,
      message = EXCLUDED.message,
      image_url = EXCLUDED.image_url,
      status = EXCLUDED.status,
      response_reason = EXCLUDED.response_reason,
      responded_by = EXCLUDED.responded_by,
      responded_at = EXCLUDED.responded_at,
      submitted_at = COALESCE(EXCLUDED.submitted_at, emergency_alerts.submitted_at),
      updated_at = COALESCE(EXCLUDED.updated_at, emergency_alerts.updated_at)
    RETURNING id
    `,
    [
      job.firestoreId,
      user.id,
      normalizeString(payload.username, 120),
      normalizeEmail(payload.email, targetUid),
      normalizeString(payload.phone, 32),
      normalizeNumber(payload.lat),
      normalizeNumber(payload.lng),
      normalizeInteger(payload.accuracy),
      parseRequiredString(payload.message, "message", { minLength: 1, maxLength: 5000 }),
      parseRequiredString(payload.imageUrl, "imageUrl", { minLength: 1, maxLength: 2000 }),
      normalizeEmergencyStatus(payload.status),
      normalizeString(payload.responseReason, 5000),
      respondedByUserId,
      normalizeTimestamp(payload.respondedAt),
      normalizeTimestamp(payload.submittedAt),
      normalizeTimestamp(payload.updatedAt),
    ]
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firestoreId: job.firestoreId,
    emergencyAlertId: result.rows[0].id,
  };
}

async function syncAdminActivityJob(client, job) {
  const payload = ensureObject(job.payload, "sync payload");
  const actorUid = payload.actorUid || job.ownerUid;
  const actorRole = normalizeRole(payload.actorRole, DEFAULT_ROLE_BY_UID.get(actorUid) || ROLE.USER);

  const actor = await ensureUserByFirebaseUid(
    client,
    actorUid,
    {
      uid: actorUid,
      email: payload.actorEmail,
      username: payload.actorName,
      displayName: payload.actorName,
      role: actorRole,
    },
    null,
    actorRole
  );

  const result = await client.query(
    `
    INSERT INTO admin_activity_logs (
      source_firestore_id,
      actor_user_id,
      actor_uid_snapshot,
      actor_email_snapshot,
      actor_name_snapshot,
      actor_role,
      action_type,
      target_type,
      target_id,
      target_label,
      summary,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, NOW()))
    ON CONFLICT (source_firestore_id)
    DO UPDATE SET
      actor_user_id = COALESCE(EXCLUDED.actor_user_id, admin_activity_logs.actor_user_id),
      actor_uid_snapshot = EXCLUDED.actor_uid_snapshot,
      actor_email_snapshot = EXCLUDED.actor_email_snapshot,
      actor_name_snapshot = EXCLUDED.actor_name_snapshot,
      actor_role = EXCLUDED.actor_role,
      action_type = EXCLUDED.action_type,
      target_type = EXCLUDED.target_type,
      target_id = EXCLUDED.target_id,
      target_label = EXCLUDED.target_label,
      summary = EXCLUDED.summary,
      created_at = COALESCE(EXCLUDED.created_at, admin_activity_logs.created_at)
    RETURNING id
    `,
    [
      job.firestoreId,
      actor.id,
      actorUid,
      normalizeEmail(payload.actorEmail, actorUid),
      normalizeString(payload.actorName, 120) || actor.display_name || actor.username || actor.email,
      actorRole,
      parseRequiredString(payload.actionType, "actionType", { minLength: 1, maxLength: 100 }),
      parseRequiredString(payload.targetType, "targetType", { minLength: 1, maxLength: 50 }),
      normalizeString(payload.targetId, 128),
      normalizeString(payload.targetLabel, 200),
      normalizeString(payload.summary, 4000),
      normalizeTimestamp(payload.createdAt),
    ]
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firestoreId: job.firestoreId,
    activityLogId: result.rows[0].id,
  };
}

async function syncAdminAccessJob(client, job, auth) {
  const payload = ensureObject(job.payload, "sync payload");
  const targetUid = payload.uid || job.ownerUid || job.firestoreId;
  const role = normalizeRole(payload.role, DEFAULT_ROLE_BY_UID.get(targetUid) || ROLE.USER);
  const targetUser = await ensureUserByFirebaseUid(
    client,
    targetUid,
    payload.profile || { uid: targetUid },
    null,
    role
  );

  await client.query("UPDATE users SET role = $2 WHERE id = $1", [targetUser.id, role]);

  const result = await client.query(
    `
    INSERT INTO admin_access (
      user_id,
      role,
      active,
      granted_by,
      updated_by,
      notes
    )
    VALUES ($1, $2, $3, $4, $4, $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      role = EXCLUDED.role,
      active = EXCLUDED.active,
      granted_by = COALESCE(admin_access.granted_by, EXCLUDED.granted_by),
      updated_by = EXCLUDED.updated_by,
      notes = COALESCE(EXCLUDED.notes, admin_access.notes)
    RETURNING user_id, role, active
    `,
    [
      targetUser.id,
      role,
      normalizeBoolean(payload.active, true),
      auth.dbUser.id,
      normalizeString(payload.notes, 5000),
    ]
  );

  return {
    entityType: job.entityType,
    operation: job.operation,
    firebaseUid: targetUid,
    userId: result.rows[0].user_id,
    role: result.rows[0].role,
    active: result.rows[0].active,
  };
}

async function processSyncJob(client, job, auth) {
  switch (job.entityType) {
    case "user_profile":
      return syncUserProfileJob(client, job);
    case "post":
    case "post_delete":
      return syncPostJob(client, job, auth);
    case "landmark":
    case "landmark_delete":
      return syncLandmarkJob(client, job, auth);
    case "shared_location":
      return syncSharedLocationJob(client, job);
    case "emergency_alert":
      return syncEmergencyAlertJob(client, job);
    case "admin_activity":
      return syncAdminActivityJob(client, job);
    case "admin_access":
      return syncAdminAccessJob(client, job, auth);
    default:
      throw badRequest("Unsupported sync entity type.");
  }
}

router.post(
  "/jobs",
  requireAuth,
  syncLimiter,
  asyncHandler(async (req, res) => {
    const body = ensureObject(req.body, "sync job");
    const job = {
      entityType: parseEnum(body.entityType, "entityType", SYNC_ENTITY_TYPES, { required: true }),
      operation: parseEnum(body.operation || "upsert", "operation", ["upsert", "delete"], {
        required: true,
      }),
      firestoreId: parseRequiredString(body.firestoreId, "firestoreId", {
        minLength: 1,
        maxLength: 160,
      }),
      ownerUid: normalizeString(body.ownerUid, 128),
      payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    };

    assertSyncPermission(job, req.auth);

    const result = await withTransaction(async (client) => processSyncJob(client, job, req.auth));

    res.status(200).json({
      ok: true,
      job: {
        entityType: job.entityType,
        operation: job.operation,
        firestoreId: job.firestoreId,
      },
      result,
      syncedAt: new Date().toISOString(),
    });
  })
);

export default router;
