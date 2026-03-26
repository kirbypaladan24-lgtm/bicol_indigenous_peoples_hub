const FIREBASE_ENV_MAP = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  databaseURL: "VITE_FIREBASE_DATABASE_URL",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
  measurementId: "VITE_FIREBASE_MEASUREMENT_ID",
};

function readFirebaseConfig() {
  const config = {};

  for (const [key, envName] of Object.entries(FIREBASE_ENV_MAP)) {
    const value = process.env[envName];
    if (value) {
      config[key] = value;
    }
  }

  return config;
}

export default function handler(_req, res) {
  const firebaseConfig = readFirebaseConfig();
  const publicUploadConfig = {
    imgbbKey: process.env.VITE_IMGBB_KEY || process.env.IMGBB_KEY || "",
  };
  const payload = `
window.__FIREBASE_CONFIG__ = ${JSON.stringify(firebaseConfig)};
window.__PUBLIC_UPLOAD_CONFIG__ = ${JSON.stringify(publicUploadConfig)};
`.trim();

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).send(payload);
}
