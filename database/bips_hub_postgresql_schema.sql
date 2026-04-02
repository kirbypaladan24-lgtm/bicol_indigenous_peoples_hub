-- BIPs Hub PostgreSQL Schema
-- Purpose:
-- Future relational database foundation for the
-- Bicol Indigenous Peoples Hub platform.
-- Note:
-- This schema does not change the current platform code.
-- It is prepared for future migration, reporting, and scaling.

-- 1. Create database
-- Run this part first in PostgreSQL as a superuser or owner.

-- DROP DATABASE IF EXISTS "BIPs-Hub";

CREATE DATABASE "BIPs-Hub"
    WITH
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'English_Philippines.1252'
    LC_CTYPE = 'English_Philippines.1252'
    LOCALE_PROVIDER = 'libc'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;

-- After creating the database, connect to it:
-- \connect "BIPs-Hub"

-- 2. Extensions

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- 3. Reusable trigger for updated_at

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 4. Enumerated types

DO $$
BEGIN
  CREATE TYPE system_role_enum AS ENUM (
    'user',
    'content_admin',
    'landmark_admin',
    'emergency_admin',
    'super_admin'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE reaction_value_enum AS ENUM ('like', 'dislike');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE emergency_response_enum AS ENUM (
    'pending',
    'approved',
    'help_on_the_way',
    'declined',
    'resolved'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE moderation_status_enum AS ENUM (
    'open',
    'reviewed',
    'resolved',
    'dismissed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE notification_status_enum AS ENUM (
    'unread',
    'read',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE content_target_enum AS ENUM (
    'post',
    'landmark',
    'emergency_alert',
    'shared_location',
    'user'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE media_context_enum AS ENUM (
    'post',
    'landmark',
    'emergency_alert',
    'profile',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5. Core users

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  email CITEXT NOT NULL UNIQUE,
  username CITEXT,
  display_name VARCHAR(120),
  role system_role_enum NOT NULL DEFAULT 'user',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  photo_url TEXT,
  preferred_language VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_username_length_chk
    CHECK (username IS NULL OR LENGTH(username) BETWEEN 3 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (username)
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role_active
  ON users (role, is_active);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 6. Sensitive user details

CREATE TABLE IF NOT EXISTS users_private (
  user_id BIGINT PRIMARY KEY
    REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(32),
  birthdate DATE,
  address TEXT,
  emergency_contact_name VARCHAR(120),
  emergency_contact_phone VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_private_phone
  ON users_private (phone);

CREATE TRIGGER trg_users_private_updated_at
BEFORE UPDATE ON users_private
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 7. Admin access control

CREATE TABLE IF NOT EXISTS admin_access (
  user_id BIGINT PRIMARY KEY
    REFERENCES users(id) ON DELETE CASCADE,
  role system_role_enum NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_access_role_chk
    CHECK (role IN ('content_admin', 'landmark_admin', 'emergency_admin'))
);

CREATE INDEX IF NOT EXISTS idx_admin_access_role_active
  ON admin_access (role, active);

CREATE TRIGGER trg_admin_access_updated_at
BEFORE UPDATE ON admin_access
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 8. Posts

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_firestore_id VARCHAR(128) UNIQUE,
  author_user_id BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(120) NOT NULL,
  title VARCHAR(250) NOT NULL,
  content TEXT NOT NULL,
  cover_url TEXT,
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT posts_likes_nonnegative_chk CHECK (likes_count >= 0),
  CONSTRAINT posts_dislikes_nonnegative_chk CHECK (dislikes_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON posts (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_firestore_unique
  ON posts (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_author
  ON posts (author_user_id);

CREATE TRIGGER trg_posts_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS post_media (
  id BIGSERIAL PRIMARY KEY,
  post_id UUID NOT NULL
    REFERENCES posts(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type VARCHAR(30) NOT NULL DEFAULT 'image',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_media_order_unique
  ON post_media (post_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_post_media_post
  ON post_media (post_id);

CREATE TABLE IF NOT EXISTS post_reactions (
  user_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL
    REFERENCES posts(id) ON DELETE CASCADE,
  value reaction_value_enum NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post
  ON post_reactions (post_id);

CREATE TRIGGER trg_post_reactions_updated_at
BEFORE UPDATE ON post_reactions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 9. Landmarks

CREATE TABLE IF NOT EXISTS landmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_firestore_id VARCHAR(128) UNIQUE,
  name VARCHAR(180) NOT NULL,
  summary TEXT NOT NULL,
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  cover_url TEXT,
  color VARCHAR(16),
  created_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT landmarks_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT landmarks_longitude_chk CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_landmarks_created_at
  ON landmarks (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_landmarks_source_firestore_unique
  ON landmarks (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_landmarks_coords
  ON landmarks (latitude, longitude);

CREATE TRIGGER trg_landmarks_updated_at
BEFORE UPDATE ON landmarks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 10. Shared user locations

CREATE TABLE IF NOT EXISTS shared_locations (
  user_id BIGINT PRIMARY KEY
    REFERENCES users(id) ON DELETE CASCADE,
  username_snapshot VARCHAR(120),
  email_snapshot CITEXT,
  phone_snapshot VARCHAR(32),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy_meters INTEGER,
  consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_accepted_at TIMESTAMPTZ,
  sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_active BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_message TEXT,
  emergency_image_url TEXT,
  emergency_status emergency_response_enum,
  emergency_submitted_at TIMESTAMPTZ,
  response_status emergency_response_enum,
  response_reason TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shared_locations_latitude_chk
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT shared_locations_longitude_chk
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT shared_locations_accuracy_chk
    CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shared_locations_active
  ON shared_locations (sharing_enabled, emergency_active, updated_at DESC);

CREATE TRIGGER trg_shared_locations_updated_at
BEFORE UPDATE ON shared_locations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 11. Emergency alert history

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_firestore_id VARCHAR(128) UNIQUE,
  user_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  username_snapshot VARCHAR(120),
  email_snapshot CITEXT,
  phone_snapshot VARCHAR(32),
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  accuracy_meters INTEGER,
  message TEXT NOT NULL,
  image_url TEXT NOT NULL,
  status emergency_response_enum NOT NULL DEFAULT 'pending',
  response_reason TEXT,
  responded_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT emergency_alerts_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT emergency_alerts_longitude_chk CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT emergency_alerts_accuracy_chk CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status_time
  ON emergency_alerts (status, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_alerts_source_firestore_unique
  ON emergency_alerts (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_user
  ON emergency_alerts (user_id, submitted_at DESC);

CREATE TRIGGER trg_emergency_alerts_updated_at
BEFORE UPDATE ON emergency_alerts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 12. Admin activity logs

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  source_firestore_id VARCHAR(128) UNIQUE,
  actor_user_id BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  actor_uid_snapshot VARCHAR(128),
  actor_email_snapshot CITEXT,
  actor_name_snapshot VARCHAR(120),
  actor_role system_role_enum,
  action_type VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(128),
  target_label VARCHAR(200),
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_actor_time
  ON admin_activity_logs (actor_user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_activity_source_firestore_unique
  ON admin_activity_logs (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_activity_action_time
  ON admin_activity_logs (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_target
  ON admin_activity_logs (target_type, target_id);

-- 13. Notifications for future use

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  link_path TEXT,
  status notification_status_enum NOT NULL DEFAULT 'unread',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status
  ON notifications (recipient_user_id, status, created_at DESC);

-- 14. Media assets for future use

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  source_provider VARCHAR(40) NOT NULL DEFAULT 'imgbb',
  media_context media_context_enum NOT NULL DEFAULT 'other',
  context_id VARCHAR(128),
  original_url TEXT NOT NULL,
  display_url TEXT,
  thumbnail_url TEXT,
  mime_type VARCHAR(80),
  width_px INTEGER,
  height_px INTEGER,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_assets_width_chk CHECK (width_px IS NULL OR width_px > 0),
  CONSTRAINT media_assets_height_chk CHECK (height_px IS NULL OR height_px > 0),
  CONSTRAINT media_assets_size_chk CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_context
  ON media_assets (media_context, context_id);

-- 15. Content reports for future governance support

CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  target_type content_target_enum NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  status moderation_status_enum NOT NULL DEFAULT 'open',
  reviewed_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status_time
  ON content_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON content_reports (target_type, target_id);

CREATE TRIGGER trg_content_reports_updated_at
BEFORE UPDATE ON content_reports
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 16. Public stats snapshot

CREATE TABLE IF NOT EXISTS public_stats (
  stat_key VARCHAR(60) PRIMARY KEY,
  stat_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public_stats (stat_key, stat_value)
VALUES
  ('user_count', 0),
  ('post_count', 0),
  ('landmark_count', 0),
  ('emergency_alert_count', 0)
ON CONFLICT (stat_key) DO NOTHING;

-- 17. Platform settings

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. Helpful views for reports

CREATE OR REPLACE VIEW v_platform_dashboard AS
SELECT
  (SELECT COUNT(*) FROM users WHERE is_active = TRUE) AS total_active_users,
  (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL) AS total_posts,
  (SELECT COUNT(*) FROM landmarks WHERE deleted_at IS NULL) AS total_landmarks,
  (SELECT COUNT(*) FROM emergency_alerts) AS total_emergency_alerts,
  (SELECT COUNT(*) FROM shared_locations WHERE sharing_enabled = TRUE) AS total_shared_locations,
  (SELECT COUNT(*) FROM admin_activity_logs) AS total_admin_actions;

CREATE OR REPLACE VIEW v_active_emergency_locations AS
SELECT
  sl.user_id,
  u.firebase_uid,
  COALESCE(sl.username_snapshot, u.username, u.display_name) AS username,
  COALESCE(sl.email_snapshot, u.email) AS email,
  sl.phone_snapshot AS phone,
  sl.latitude,
  sl.longitude,
  sl.accuracy_meters,
  sl.emergency_message,
  sl.emergency_image_url,
  sl.emergency_submitted_at,
  sl.response_status,
  sl.response_reason,
  sl.responded_at
FROM shared_locations sl
JOIN users u ON u.id = sl.user_id
WHERE sl.sharing_enabled = TRUE
  AND sl.emergency_active = TRUE;

CREATE OR REPLACE VIEW v_admin_productivity_summary AS
SELECT
  aal.actor_user_id,
  COALESCE(u.username, u.display_name, aal.actor_name_snapshot) AS admin_name,
  COALESCE(u.email, aal.actor_email_snapshot) AS admin_email,
  aal.actor_role,
  COUNT(*) AS total_actions,
  COUNT(*) FILTER (WHERE aal.action_type LIKE 'post_%') AS post_actions,
  COUNT(*) FILTER (WHERE aal.action_type LIKE 'landmark_%') AS landmark_actions,
  COUNT(*) FILTER (WHERE aal.action_type = 'emergency_responded') AS emergency_actions,
  MIN(aal.created_at) AS first_recorded_action,
  MAX(aal.created_at) AS last_recorded_action
FROM admin_activity_logs aal
LEFT JOIN users u ON u.id = aal.actor_user_id
GROUP BY
  aal.actor_user_id,
  COALESCE(u.username, u.display_name, aal.actor_name_snapshot),
  COALESCE(u.email, aal.actor_email_snapshot),
  aal.actor_role;

-- 19. Suggested seed rows for the current admin structure
-- Adjust the email/username values later as needed.

INSERT INTO users (firebase_uid, email, username, display_name, role, is_active)
VALUES
  ('6bs7TaQnJBZDGiyhR1eoDMLncsb2', 'superadmin@bipshub.local', 'superadmin', 'Super Admin', 'super_admin', TRUE),
  ('7gquSWQ94xZZLMxLCW4Xlv2QJ613', 'contentadmin@bipshub.local', 'contentadmin', 'Content Admin', 'content_admin', TRUE),
  ('L6aGCzr08Wd4gcj6ndiAqa0Z5dx2', 'landmarkadmin@bipshub.local', 'landmarkadmin', 'Landmark Admin', 'landmark_admin', TRUE),
  ('TI0yeuCaYcggEJmjh7H4BlAmp562', 'emergencyadmin@bipshub.local', 'emergencyadmin', 'Emergency Admin', 'emergency_admin', TRUE)
ON CONFLICT (firebase_uid) DO NOTHING;

INSERT INTO admin_access (user_id, role, active, granted_at, updated_at)
SELECT id, role, TRUE, NOW(), NOW()
FROM users
WHERE role IN ('content_admin', 'landmark_admin', 'emergency_admin')
ON CONFLICT (user_id) DO NOTHING;

-- End of schema
