import { query } from "../config/db.js";
import { isAdminRole } from "./roles.js";

async function runQuery(executor, text, params) {
  if (typeof executor?.query === "function") {
    return executor.query(text, params);
  }
  return query(text, params);
}

export async function logAdminActivity(executor, actor, event) {
  if (!actor || !isAdminRole(actor.role)) {
    return;
  }

  await runQuery(
    executor,
    `
    INSERT INTO admin_activity_logs (
      actor_user_id,
      actor_uid_snapshot,
      actor_email_snapshot,
      actor_name_snapshot,
      actor_role,
      action_type,
      target_type,
      target_id,
      target_label,
      summary
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      actor.id,
      actor.firebase_uid,
      actor.email,
      actor.display_name || actor.username || actor.email,
      actor.role,
      event.actionType,
      event.targetType,
      event.targetId || null,
      event.targetLabel || null,
      event.summary || null,
    ]
  );
}
