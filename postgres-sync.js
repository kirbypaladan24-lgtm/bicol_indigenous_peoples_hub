function readInjectedBackendConfig() {
  if (typeof window === "undefined") return null;
  return window.__PUBLIC_BACKEND_CONFIG__ || null;
}

function readLocalDevBackendConfig() {
  if (typeof window === "undefined" || location.hostname !== "localhost") {
    return null;
  }

  const stored = localStorage.getItem("dev-backend-config");
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn("[PG Sync] Failed to parse dev-backend-config:", error);
    return null;
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

const BACKEND_SYNC_TIMEOUT_MS = 3500;
const BACKEND_RETRY_COOLDOWN_MS = 15000;
let backendUnavailableUntil = 0;

function markBackendTemporarilyUnavailable() {
  backendUnavailableUntil = Date.now() + BACKEND_RETRY_COOLDOWN_MS;
}

function clearBackendUnavailableMarker() {
  backendUnavailableUntil = 0;
}

export function getBackendBaseUrl() {
  const injected = normalizeBaseUrl(readInjectedBackendConfig()?.baseUrl);
  if (injected) return injected;

  const localDev = normalizeBaseUrl(readLocalDevBackendConfig()?.baseUrl);
  if (localDev) return localDev;

  return "";
}

export function isBackendSyncConfigured() {
  return Boolean(getBackendBaseUrl());
}

export async function sendBackendSyncJob(job, idToken) {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    throw new Error("Backend sync URL is not configured.");
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const error = new Error("Browser is offline. Backend sync will retry later.");
    error.status = 0;
    error.code = "browser-offline";
    throw error;
  }

  if (backendUnavailableUntil > Date.now()) {
    const error = new Error("Backend sync is cooling down after a recent failure.");
    error.status = 503;
    error.code = "backend-cooldown";
    throw error;
  }

  if (!idToken) {
    throw new Error("A Firebase ID token is required for backend sync.");
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timerApi = typeof globalThis !== "undefined" ? globalThis : null;
  const timeoutId = controller
    ? timerApi?.setTimeout(() => controller.abort("Backend sync timeout"), BACKEND_SYNC_TIMEOUT_MS)
    : null;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1/sync/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(job),
      signal: controller?.signal,
    });
  } catch (error) {
    if (timeoutId) {
      timerApi?.clearTimeout(timeoutId);
    }

    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Backend sync timed out after ${BACKEND_SYNC_TIMEOUT_MS}ms.`
      );
      timeoutError.status = 504;
      timeoutError.code = "backend-timeout";
      markBackendTemporarilyUnavailable();
      throw timeoutError;
    }

    markBackendTemporarilyUnavailable();
    throw error;
  }

  if (timeoutId) {
    timerApi?.clearTimeout(timeoutId);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `Backend sync failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    if (response.status >= 500) {
      markBackendTemporarilyUnavailable();
    }
    throw error;
  }

  clearBackendUnavailableMarker();
  return payload;
}
