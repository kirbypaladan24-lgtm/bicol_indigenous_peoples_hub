import { observeAuth, canAccessTracker, observeEmergencyAlerts } from "./auth.js";

const STORAGE_KEY = "bicol-ip-last-seen-emergency-alert";

let cleanupAlerts = null;
let currentBanner = null;

function getStoredAlertSignature() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredAlertSignature(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {}
}

function getAlertSignature(alert) {
  if (!alert) return "";
  const seconds = alert?.submittedAt?.seconds || alert?.updatedAt?.seconds || 0;
  const nanos = alert?.submittedAt?.nanoseconds || alert?.updatedAt?.nanoseconds || 0;
  return `${alert.id || alert.userId || "unknown"}:${seconds}:${nanos}`;
}

function removeBanner() {
  if (currentBanner?.parentElement) {
    currentBanner.parentElement.removeChild(currentBanner);
  }
  currentBanner = null;
}

function showBanner(alert) {
  removeBanner();

  const username = String(alert?.username || alert?.email || "A user").trim();
  const message = String(alert?.message || "").trim();
  const preview = message ? message.slice(0, 110) : "Tap to review the emergency alert.";
  const href = `tracker.html?user=${encodeURIComponent(alert?.userId || alert?.uid || "")}&focus=emergency`;
  const alertSignature = getAlertSignature(alert);

  const banner = document.createElement("div");
  banner.className = "admin-emergency-banner";
  banner.dataset.signature = alertSignature;
  banner.innerHTML = `
    <div class="admin-emergency-banner__copy">
      <span class="admin-emergency-banner__eyebrow">Emergency Alert</span>
      <strong>${username}</strong>
      <p>${preview}</p>
    </div>
    <div class="admin-emergency-banner__actions">
      <a class="solid" href="${href}">Open Tracker</a>
      <button type="button" class="ghost">Dismiss</button>
    </div>
  `;

  const openLink = banner.querySelector("a");
  const dismissBtn = banner.querySelector("button");
  openLink?.addEventListener("click", () => {
    if (alertSignature) setStoredAlertSignature(alertSignature);
  });
  dismissBtn?.addEventListener("click", () => {
    if (alertSignature) setStoredAlertSignature(alertSignature);
    removeBanner();
  });

  document.body.appendChild(banner);
  currentBanner = banner;
}

export function initAdminEmergencyNotifications() {
  observeAuth((user) => {
    removeBanner();
    cleanupAlerts?.();
    cleanupAlerts = null;

    if (!user || !canAccessTracker(user)) {
      return;
    }

    cleanupAlerts = observeEmergencyAlerts((alerts) => {
      if (!Array.isArray(alerts) || !alerts.length) return;

      const latest = alerts[0];
      const latestSignature = getAlertSignature(latest);
      const storedSignature = getStoredAlertSignature();
      const bannerSignature = currentBanner?.dataset?.signature || "";

      if (latestSignature && latestSignature !== storedSignature && latestSignature !== bannerSignature) {
        showBanner(latest);
      }
    });
  });
}
