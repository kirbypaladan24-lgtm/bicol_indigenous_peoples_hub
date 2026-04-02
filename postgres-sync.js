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

  if (!idToken) {
    throw new Error("A Firebase ID token is required for backend sync.");
  }

  const response = await fetch(`${baseUrl}/api/v1/sync/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(job),
  });

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
    throw error;
  }

  return payload;
}
