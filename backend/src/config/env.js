import dotenv from "dotenv";

dotenv.config();

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  pgssl: readBoolean(process.env.PGSSL, false),
  trustProxy: readBoolean(process.env.TRUST_PROXY, false),
  corsOrigins: readOrigins(process.env.CORS_ORIGINS),
  firebaseProjectId: String(process.env.FIREBASE_PROJECT_ID || "").trim(),
  firebaseClientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
  firebasePrivateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").trim(),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  writeRateLimitMax: Number(process.env.WRITE_RATE_LIMIT_MAX || 60),
  emergencyRateLimitMax: Number(process.env.EMERGENCY_RATE_LIMIT_MAX || 10),
};

if (!env.databaseUrl) {
  throw new Error("Missing DATABASE_URL in backend environment variables.");
}

export const isProduction = env.nodeEnv === "production";
