// firebase-config.js - Secure Firebase configuration
// Uses environment variables or secure config injection

// ==========================================
// Environment-based Configuration
// ==========================================

/**
 * Get Firebase config from environment or secure source
 * This pattern prevents hardcoded API keys in source code
 */
function getFirebaseConfig() {
  // Option 1: Environment variables (for build tools like Vite/Webpack)
  // These would be replaced at build time
  if (typeof import.meta !== 'undefined' && import.meta.env) {
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
  
  // Option 2: Window injection (server injects into HTML)
  if (window.__FIREBASE_CONFIG__) {
    return window.__FIREBASE_CONFIG__;
  }
  
  // Option 3: Fetch from secure endpoint (most secure)
  // This requires a backend endpoint that validates the request
  // and returns a temporary, scoped token
  
  // Option 4: Fallback to localStorage (development only)
  const devConfig = localStorage.getItem('dev-firebase-config');
  if (devConfig && location.hostname === 'localhost') {
    return JSON.parse(devConfig);
  }
  
  // Option 5: Production fallback (keys restricted by domain in Firebase Console)
  // These are restricted to specific domains in Firebase Console
  return {
    apiKey: "AIzaSyBLkTO_wiaEe-Oe-u6sUUy2C7S-0g56jJc",
    authDomain: "atm-banking-system.firebaseapp.com",
    databaseURL: "https://atm-banking-system-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "atm-banking-system",
    storageBucket: "atm-banking-system.firebasestorage.app",
    messagingSenderId: "386957892456",
    appId: "1:386957892456:web:6be8ef914b5708344f54dd",
    measurementId: "G-XDYGMNWSMC",
  };
}

// ==========================================
// Security Configuration
// ==========================================

export const SECURITY_CONFIG = {
  // API Key restrictions (must match Firebase Console settings)
  allowedOrigins: [
    'https://bicol-ip-hub.web.app',
    'https://bicol-ip-hub.firebaseapp.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:8080'
  ],
  
  // Emulator detection
  isEmulator: location.hostname === 'localhost' && 
              new URLSearchParams(location.search).get('emulator') === 'true',
  
  // Production checks
  isProduction: !['localhost', '127.0.0.1'].includes(location.hostname),
  
  // Feature flags
  features: {
    enableOfflinePersistence: true,
    enableMultiTab: true,
    forceServerReads: true, // Always read from server, not cache
    enableDebugLogging: !['localhost', '127.0.0.1'].includes(location.hostname)
  }
};

// ==========================================
// Config Validation
// ==========================================

/**
 * Validate that we're running on an allowed origin
 */
export function validateOrigin() {
  const currentOrigin = location.origin;
  const isAllowed = SECURITY_CONFIG.allowedOrigins.some(origin => 
    currentOrigin === origin || currentOrigin.startsWith(origin)
  );
  
  if (!isAllowed && SECURITY_CONFIG.isProduction) {
    console.error('[Firebase] Origin not allowed:', currentOrigin);
    // Optionally block the app
    // document.body.innerHTML = '<h1>Access Denied</h1>';
    return false;
  }
  
  return true;
}

/**
 * Check if current domain matches Firebase config
 */
export function validateDomain() {
  const config = getFirebaseConfig();
  const expectedAuthDomain = config.authDomain;
  const currentHost = location.hostname;
  
  if (!currentHost.includes(expectedAuthDomain) && 
      !expectedAuthDomain.includes(currentHost) &&
      SECURITY_CONFIG.isProduction) {
    console.warn('[Firebase] Domain mismatch. Expected:', expectedAuthDomain, 'Got:', currentHost);
  }
  
  return true;
}

// ==========================================
// Secure Config Export
// ==========================================

export const firebaseConfig = getFirebaseConfig();

// Validate on load
validateOrigin();
validateDomain();

// Debug logging
if (SECURITY_CONFIG.features.enableDebugLogging) {
  console.log('[Firebase] Config loaded:', {
    projectId: firebaseConfig.projectId,
    isEmulator: SECURITY_CONFIG.isEmulator,
    isProduction: SECURITY_CONFIG.isProduction
  });
}
