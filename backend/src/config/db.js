import pg from "pg";
import { env, isProduction } from "./env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.pgssl || isProduction ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("[DB] Unexpected PostgreSQL pool error:", error);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(handler) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function testDatabaseConnection(timeoutMs = 3000) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Database connection check timed out.")), timeoutMs);
  });

  const result = await Promise.race([
    query("SELECT NOW() AS now, current_database() AS database_name"),
    timeoutPromise,
  ]);

  return result.rows[0];
}
