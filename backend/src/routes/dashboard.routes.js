import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ROLE } from "../utils/roles.js";

const router = Router();

router.get(
  "/summary",
  requireAuth,
  requireRoles(
    ROLE.CONTENT_ADMIN,
    ROLE.LANDMARK_ADMIN,
    ROLE.EMERGENCY_ADMIN,
    ROLE.SUPER_ADMIN
  ),
  asyncHandler(async (req, res) => {
    const result = await query("SELECT * FROM v_platform_dashboard");
    res.json(result.rows[0] || {});
  })
);

router.get(
  "/admin-productivity",
  requireAuth,
  requireRoles(ROLE.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await query(`
      SELECT *
      FROM v_admin_productivity_summary
      ORDER BY total_actions DESC, admin_name ASC
    `);
    res.json(result.rows);
  })
);

router.get(
  "/active-emergencies",
  requireAuth,
  requireRoles(ROLE.EMERGENCY_ADMIN, ROLE.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await query(`
      SELECT *
      FROM v_active_emergency_locations
      ORDER BY emergency_submitted_at DESC NULLS LAST
    `);
    res.json(result.rows);
  })
);

export default router;
