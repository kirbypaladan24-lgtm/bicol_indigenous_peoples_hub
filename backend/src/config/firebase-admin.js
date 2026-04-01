import admin from "firebase-admin";
import { env } from "./env.js";
import { serviceUnavailable, unauthorized } from "../utils/api-error.js";

let firebaseAuth = null;

if (env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey) {
  const privateKey = env.firebasePrivateKey
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/^'(.*)'$/s, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebaseProjectId,
        clientEmail: env.firebaseClientEmail,
        privateKey,
      }),
    });
  }

  firebaseAuth = admin.auth();
}

export function isFirebaseAuthConfigured() {
  return Boolean(firebaseAuth);
}

export async function verifyFirebaseToken(idToken) {
  if (!firebaseAuth) {
    throw serviceUnavailable(
      "Firebase authentication is not configured for this backend yet."
    );
  }

  try {
    return await firebaseAuth.verifyIdToken(idToken, true);
  } catch {
    throw unauthorized("The provided Firebase ID token is invalid or expired.");
  }
}
