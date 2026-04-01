import { Router } from "express";
import { isFirebaseAuthConfigured } from "../config/firebase-admin.js";
import { asyncHandler } from "../utils/async-handler.js";
import { testDatabaseConnection } from "../config/db.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const dbStatus = await testDatabaseConnection();
    res.json({
      status: "ok",
      service: "bips-hub-backend",
      database: "connected",
      databaseName: dbStatus.database_name,
      serverTime: dbStatus.now,
      authConfigured: isFirebaseAuthConfigured(),
    });
  })
);

export default router;
