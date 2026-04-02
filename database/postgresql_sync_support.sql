-- Run this inside the existing "BIPs-Hub" database
-- before enabling Firestore -> PostgreSQL sync.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS source_firestore_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_firestore_unique
  ON posts (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

ALTER TABLE landmarks
  ADD COLUMN IF NOT EXISTS source_firestore_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_landmarks_source_firestore_unique
  ON landmarks (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

ALTER TABLE emergency_alerts
  ADD COLUMN IF NOT EXISTS source_firestore_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_alerts_source_firestore_unique
  ON emergency_alerts (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;

ALTER TABLE admin_activity_logs
  ADD COLUMN IF NOT EXISTS source_firestore_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_activity_source_firestore_unique
  ON admin_activity_logs (source_firestore_id)
  WHERE source_firestore_id IS NOT NULL;
