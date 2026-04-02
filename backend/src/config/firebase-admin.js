import admin from "firebase-admin";
import { env } from "./env.js";
import { serviceUnavailable, unauthorized } from "../utils/api-error.js";

let firebaseAuth = null;
let firebaseFirestore = null;

if (env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey) {
  try {
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
    firebaseFirestore = admin.firestore();
  } catch (error) {
    firebaseAuth = null;
    firebaseFirestore = null;
    console.error(
      "[Firebase Admin] Failed to initialize Firebase Admin credentials. Protected routes will stay unavailable until the environment variables are corrected.",
      error
    );
  }
}

export function isFirebaseAuthConfigured() {
  return Boolean(firebaseAuth);
}

export function isFirebaseFirestoreConfigured() {
  return Boolean(firebaseFirestore);
}

export function getFirebaseFirestore() {
  if (!firebaseFirestore) {
    throw serviceUnavailable(
      "Firebase Firestore is not configured for this backend yet."
    );
  }

  return firebaseFirestore;
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
