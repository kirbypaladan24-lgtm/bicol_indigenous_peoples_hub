-- PostgreSQL consistency hardening
-- Purpose:
-- 1. Remove redundant super-admin rows from admin_access.
-- 2. Ensure delegated admin roles are the only roles stored in admin_access.
-- 3. Normalize historical audit action names to match the current frontend/backend vocabulary.

DELETE FROM admin_access aa
USING users u
WHERE aa.user_id = u.id
  AND (
    aa.role = 'super_admin'
    OR u.firebase_uid = '6bs7TaQnJBZDGiyhR1eoDMLncsb2'
  );

ALTER TABLE admin_access
  DROP CONSTRAINT IF EXISTS admin_access_role_chk;

ALTER TABLE admin_access
  ADD CONSTRAINT admin_access_role_chk
  CHECK (role IN ('content_admin', 'landmark_admin', 'emergency_admin'));

UPDATE users u
SET role = aa.role
FROM admin_access aa
WHERE aa.user_id = u.id
  AND aa.active = TRUE
  AND u.firebase_uid <> '6bs7TaQnJBZDGiyhR1eoDMLncsb2';

UPDATE users u
SET role = 'user'
FROM admin_access aa
WHERE aa.user_id = u.id
  AND aa.active = FALSE
  AND u.firebase_uid <> '6bs7TaQnJBZDGiyhR1eoDMLncsb2';

UPDATE admin_activity_logs
SET action_type = 'post_updated'
WHERE action_type = 'post_edited';

UPDATE admin_activity_logs
SET action_type = 'landmark_updated'
WHERE action_type = 'landmark_edited';
