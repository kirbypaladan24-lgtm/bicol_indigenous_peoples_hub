import { observeAuth, observeSharedLocations, isAdmin, logout } from "./auth.js";
import { initI18n } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";

const themeToggle = document.getElementById("themeToggle");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const logoutBtn = document.getElementById("logoutBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");

const trackerStatus = document.getElementById("trackerStatus");
const trackerUsername = document.getElementById("trackerUsername");
const trackerEmail = document.getElementById("trackerEmail");
const trackerRole = document.getElementById("trackerRole");
const trackerCount = document.getElementById("trackerCount");
const trackerLastUpdated = document.getElementById("trackerLastUpdated");
const trackerMapStatus = document.getElementById("trackerMapStatus");
const trackerList = document.getElementById("trackerList");

const THEME_KEY = "bicol-ip-theme";
const BICOL_CENTER = [13.420988, 123.413673];

let map = null;
let markersLayer = null;
let unsubscribeSharedLocations = null;

function applyTheme(theme) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = value;
  localStorage.setItem(THEME_KEY, value);
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function formatTimestamp(timestamp) {
  const date =
    timestamp?.toDate?.() ||
    (timestamp instanceof Date ? timestamp : null);

  return date
    ? date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "--";
}

function ensureMap() {
  if (map || !window.L) return;

  map = L.map("trackerMap", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(BICOL_CENTER, 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLocations(locations) {
  ensureMap();
  if (!trackerList) return;

  trackerCount.textContent = String(locations.length);
  trackerStatus.textContent = locations.length
    ? `${locations.length} user location${locations.length === 1 ? "" : "s"} synced for the admin tracker.`
    : "No user has shared a location yet.";
  trackerMapStatus.textContent = locations.length ? "Showing synced user markers" : "Waiting for user shares";
  trackerLastUpdated.textContent = locations.length ? formatTimestamp(locations[0]?.updatedAt) : "--";

  trackerList.innerHTML = "";

  if (markersLayer) {
    markersLayer.clearLayers();
  }

  if (!locations.length) {
    trackerList.innerHTML = '<div class="tracker-empty">No user locations have been shared yet.</div>';
    map?.setView(BICOL_CENTER, 7);
    return;
  }

  const bounds = [];

  locations.forEach((entry) => {
    const username = entry.username || entry.email || "Unknown user";
    const email = entry.email || "No email saved";
    const updated = formatTimestamp(entry.updatedAt);
    const accuracy = Number.isFinite(entry.accuracy) ? `${Math.round(entry.accuracy)} meters` : "Not provided";
    const coords = `${Number(entry.lat).toFixed(5)}, ${Number(entry.lng).toFixed(5)}`;

    const item = document.createElement("article");
    item.className = "tracker-item";
    item.innerHTML = `
      <div class="tracker-item-head">
        <div>
          <h4>${escapeHtml(username)}</h4>
          <p>${escapeHtml(email)}</p>
        </div>
        <span class="ghost small">Live</span>
      </div>
      <div class="tracker-item-meta">
        <p><strong>Coordinates:</strong> ${coords}</p>
        <p><strong>Accuracy:</strong> ${escapeHtml(accuracy)}</p>
        <p><strong>Updated:</strong> ${escapeHtml(updated)}</p>
      </div>
    `;
    trackerList.appendChild(item);

    if (markersLayer) {
      const marker = L.marker([entry.lat, entry.lng]).bindPopup(`
        <strong>${escapeHtml(username)}</strong><br />
        ${escapeHtml(email)}<br />
        Accuracy: ${escapeHtml(accuracy)}<br />
        Updated: ${escapeHtml(updated)}
      `);
      markersLayer.addLayer(marker);
    }

    bounds.push([entry.lat, entry.lng]);
  });

  if (bounds.length === 1) {
    map?.setView(bounds[0], 13);
    return;
  }

  if (bounds.length > 1) {
    map?.fitBounds(bounds, { padding: [28, 28] });
  }
}

async function handleLogout() {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (error) {
    console.error("Logout failed:", error);
    showToast("Could not log out right now.", "error");
  }
}

themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
});

mobileThemeToggle?.addEventListener("click", () => {
  themeToggle?.click();
  mobileMenu?.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
});

menuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenu?.classList.toggle("open");
  menuToggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

logoutBtn?.addEventListener("click", handleLogout);
mobileLogoutBtn?.addEventListener("click", handleLogout);

observeAuth((user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  if (!isAdmin(user)) {
    window.location.href = "profile.html";
    return;
  }

  trackerUsername.textContent = user.displayName || user.email?.split("@")[0] || "--";
  trackerEmail.textContent = user.email || "--";
  trackerRole.textContent = "Administrator";

  unsubscribeSharedLocations?.();
  unsubscribeSharedLocations = observeSharedLocations((locations) => {
    renderLocations(locations);
  });
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
