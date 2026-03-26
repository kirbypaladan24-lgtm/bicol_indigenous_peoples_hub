const REQUIRED_FIREBASE_KEYS = [
  "apiKey",
  "authDomain",
  "databaseURL",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

function readViteFirebaseConfig() {
  if (typeof import.meta === "undefined" || !import.meta.env) {
    return null;
  }

  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };
}

function readInjectedFirebaseConfig() {
  if (typeof window === "undefined" || !window.__FIREBASE_CONFIG__) {
    return null;
  }

  return window.__FIREBASE_CONFIG__;
}

function readLocalDevConfig() {
  if (typeof window === "undefined") {
    return null;
  }

  const devConfig = localStorage.getItem("dev-firebase-config");
  if (!devConfig || location.hostname !== "localhost") {
    return null;
  }

  try {
    return JSON.parse(devConfig);
  } catch (error) {
    console.warn("[Firebase] Failed to parse dev-firebase-config:", error);
    return null;
  }
}

function getMissingKeys(config) {
  return REQUIRED_FIREBASE_KEYS.filter((key) => !config?.[key]);
}

function normalizeFirebaseConfig(config) {
  if (!config) return null;

  return {
    apiKey: String(config.apiKey || "").trim(),
    authDomain: String(config.authDomain || "").trim(),
    databaseURL: String(config.databaseURL || "").trim(),
    projectId: String(config.projectId || "").trim(),
    storageBucket: String(config.storageBucket || "").trim(),
    messagingSenderId: String(config.messagingSenderId || "").trim(),
    appId: String(config.appId || "").trim(),
    measurementId: config.measurementId ? String(config.measurementId).trim() : "",
  };
}

function getFirebaseConfig() {
  const candidates = [
    readViteFirebaseConfig(),
    readInjectedFirebaseConfig(),
    readLocalDevConfig(),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeFirebaseConfig(candidate);
    if (getMissingKeys(normalized).length === 0) {
      return normalized;
    }
  }

  const fallbackCandidate = normalizeFirebaseConfig(candidates.find(Boolean));
  const missingKeys = getMissingKeys(fallbackCandidate);
  console.error(
    "[Firebase] Missing required config values:",
    missingKeys.length ? missingKeys.join(", ") : REQUIRED_FIREBASE_KEYS.join(", ")
  );
  return null;
}

export const SECURITY_CONFIG = {
  allowedOrigins: [
    "https://bicol-ip-hub.web.app",
    "https://bicol-ip-hub.firebaseapp.com",
    "https://bicol-indigenous-peoples-hub.vercel.app",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:8080",
  ],
  isEmulator:
    location.hostname === "localhost" &&
    new URLSearchParams(location.search).get("emulator") === "true",
  isProduction: !["localhost", "127.0.0.1"].includes(location.hostname),
  features: {
    enableOfflinePersistence: true,
    enableMultiTab: true,
    forceServerReads: true,
    enableDebugLogging: !["localhost", "127.0.0.1"].includes(location.hostname),
  },
};

export function validateOrigin() {
  const currentOrigin = location.origin;
  const isAllowed = SECURITY_CONFIG.allowedOrigins.some(
    (origin) => currentOrigin === origin || currentOrigin.startsWith(origin)
  );

  if (!isAllowed && SECURITY_CONFIG.isProduction) {
    console.error("[Firebase] Origin not allowed:", currentOrigin);
    return false;
  }

  return true;
}

export function validateDomain() {
  if (!firebaseConfig?.authDomain) {
    return false;
  }

  const expectedAuthDomain = firebaseConfig.authDomain;
  const currentHost = location.hostname;

  if (
    !currentHost.includes(expectedAuthDomain) &&
    !expectedAuthDomain.includes(currentHost) &&
    SECURITY_CONFIG.isProduction
  ) {
    console.warn("[Firebase] Domain mismatch. Expected:", expectedAuthDomain, "Got:", currentHost);
  }

  return true;
}

export const firebaseConfig = getFirebaseConfig();
export const firebaseConfigReady = Boolean(firebaseConfig);

export function assertFirebaseConfig() {
  if (firebaseConfigReady) {
    return firebaseConfig;
  }

  throw new Error(
    "Firebase configuration is missing. Add the VITE_FIREBASE_* variables to your local .env and Vercel Environment Variables."
  );
}

validateOrigin();
validateDomain();

if (SECURITY_CONFIG.features.enableDebugLogging && firebaseConfigReady) {
  console.log("[Firebase] Config loaded:", {
    projectId: firebaseConfig.projectId,
    isEmulator: SECURITY_CONFIG.isEmulator,
    isProduction: SECURITY_CONFIG.isProduction,
  });
}
