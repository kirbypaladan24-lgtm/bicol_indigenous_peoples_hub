import { observeAuth, observeSharedLocations, isAdmin, logout, respondToEmergency } from "./auth.js";
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
const trackerEmergencyCount = document.getElementById("trackerEmergencyCount");
const trackerLastUpdated = document.getElementById("trackerLastUpdated");
const trackerMapStatus = document.getElementById("trackerMapStatus");
const trackerList = document.getElementById("trackerList");
const trackerDetailSection = document.getElementById("trackerDetailSection");
const trackerDetail = document.getElementById("trackerDetail");
const trackerDetailEmpty = document.getElementById("trackerDetailEmpty");
const closeTrackerDetail = document.getElementById("closeTrackerDetail");
const detailUsername = document.getElementById("detailUsername");
const detailEmail = document.getElementById("detailEmail");
const detailPhone = document.getElementById("detailPhone");
const detailCoords = document.getElementById("detailCoords");
const detailUpdated = document.getElementById("detailUpdated");
const detailEmergencyStatus = document.getElementById("detailEmergencyStatus");
const detailMessage = document.getElementById("detailMessage");
const detailProofImage = document.getElementById("detailProofImage");
const detailNoProof = document.getElementById("detailNoProof");
const trackerResponseForm = document.getElementById("trackerResponseForm");
const responseReason = document.getElementById("responseReason");
const approveEmergencyBtn = document.getElementById("approveEmergencyBtn");
const helpEmergencyBtn = document.getElementById("helpEmergencyBtn");
const declineEmergencyBtn = document.getElementById("declineEmergencyBtn");

const THEME_KEY = "bicol-ip-theme";
const BICOL_CENTER = [13.420988, 123.413673];

let map = null;
let markersLayer = null;
let unsubscribeSharedLocations = null;
let currentLocations = [];
let selectedLocationId = null;
let responding = false;
let mapRetryQueued = false;

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
  if (map) return true;
  if (!window.L) return false;

  map = L.map("trackerMap", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(BICOL_CENTER, 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  return true;
}

function createMarkerIcon(entry) {
  if (entry?.emergencyActive === true) {
    return L.divIcon({
      className: "tracker-warning-icon",
      html: '<span class="tracker-warning-pin">!</span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  return undefined;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getEmergencyLabel(entry) {
  if (entry?.responseStatus === "approved") return "Approved";
  if (entry?.responseStatus === "help_on_the_way") return "Help is on the way";
  if (entry?.responseStatus === "declined") return "Declined";
  if (entry?.emergencyStatus === "pending") return "Pending admin review";
  return "No active alert";
}

function getEntryMode(entry) {
  return entry?.emergencyActive === true ? "warning" : "normal";
}

function formatCoords(entry) {
  return `${Number(entry.lat).toFixed(5)}, ${Number(entry.lng).toFixed(5)}`;
}

function scrollToDetails() {
  trackerDetailSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setSelectedLocation(locationId, options = {}) {
  selectedLocationId = locationId || null;
  renderLocations(currentLocations);

  if (!locationId || !options.scrollToDetail) return;

  const entry = currentLocations.find((item) => item.id === locationId);
  if (getEntryMode(entry) === "warning") {
    scrollToDetails();
  }
}

function renderDetail(entry) {
  if (!entry) {
    trackerDetail?.classList.add("hidden");
    trackerDetailEmpty?.classList.remove("hidden");
    trackerResponseForm?.classList.add("hidden");
    closeTrackerDetail?.classList.add("hidden");
    return;
  }

  trackerDetailEmpty?.classList.add("hidden");
  trackerDetail?.classList.remove("hidden");
  closeTrackerDetail?.classList.remove("hidden");
  const isWarning = getEntryMode(entry) === "warning";
  detailUsername.textContent = entry.username || "--";
  detailEmail.textContent = entry.email || "No email saved";
  detailPhone.textContent = entry.phone || "No phone number saved";
  detailCoords.textContent = formatCoords(entry);
  detailUpdated.textContent = formatTimestamp(entry.updatedAt);
  detailEmergencyStatus.textContent = isWarning ? getEmergencyLabel(entry) : "Location shared normally";
  detailMessage.textContent = isWarning
    ? entry.emergencyMessage || "No emergency message for this location."
    : "No emergency alert is active for this shared location.";
  responseReason.value = entry.responseReason || "";

  if (isWarning && entry.emergencyImageUrl) {
    detailProofImage.src = entry.emergencyImageUrl;
    detailProofImage.classList.remove("hidden");
    detailNoProof.classList.add("hidden");
  } else {
    detailProofImage.removeAttribute("src");
    detailProofImage.classList.add("hidden");
    detailNoProof.classList.toggle("hidden", isWarning && Boolean(entry.emergencyImageUrl));
    detailNoProof.textContent = isWarning
      ? "No emergency proof image was uploaded for this location."
      : "This location has no active emergency report. Click a warning marker to review an emergency alert.";
  }

  const canRespond = isWarning;
  trackerResponseForm?.classList.toggle("hidden", !canRespond);
  [approveEmergencyBtn, helpEmergencyBtn, declineEmergencyBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !canRespond || responding;
  });
  if (responseReason) responseReason.disabled = !canRespond || responding;
}

function renderLocations(locations) {
  if (!ensureMap()) {
    if (!mapRetryQueued) {
      mapRetryQueued = true;
      window.setTimeout(() => {
        mapRetryQueued = false;
        renderLocations(currentLocations);
      }, 250);
    }
    return;
  }
  if (!trackerList) return;
  currentLocations = locations;

  trackerCount.textContent = String(locations.length);
  trackerEmergencyCount.textContent = String(locations.filter((entry) => entry?.emergencyActive === true).length);
  trackerStatus.textContent = locations.length
    ? `${locations.length} user location${locations.length === 1 ? "" : "s"} synced for the admin tracker.`
    : "No user has shared a location yet.";
  trackerMapStatus.textContent = locations.some((entry) => entry?.emergencyActive === true)
    ? "Warning markers are active"
    : locations.length
      ? "Showing synced user markers"
      : "Waiting for user shares";
  trackerLastUpdated.textContent = locations.length ? formatTimestamp(locations[0]?.updatedAt) : "--";

  trackerList.innerHTML = "";

  if (markersLayer) {
    markersLayer.clearLayers();
  }

  if (!locations.length) {
    trackerList.innerHTML = '<div class="tracker-empty">No user locations have been shared yet.</div>';
    map?.setView(BICOL_CENTER, 7);
    renderDetail(null);
    return;
  }
  if (!locations.some((entry) => entry.id === selectedLocationId)) {
    selectedLocationId = null;
  }

  const bounds = [];

  locations.forEach((entry) => {
    const username = entry.username || entry.email || "Unknown user";
    const email = entry.email || "No email saved";
    const updated = formatTimestamp(entry.updatedAt);
    const emergencyLabel = getEmergencyLabel(entry);
    const isWarning = getEntryMode(entry) === "warning";

    const item = document.createElement("article");
    item.className = `tracker-item${entry.id === selectedLocationId ? " is-selected" : ""}${isWarning ? " is-warning" : ""}`;
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="tracker-item-head">
        <div>
          <h4>${escapeHtml(username)}</h4>
          <p>${isWarning ? "Warning marker active" : "Shared location is active"}</p>
        </div>
        <span class="ghost small">${isWarning ? "Warning" : "View"}</span>
      </div>
      <div class="tracker-item-meta">
        <p><strong>Updated:</strong> ${escapeHtml(updated)}</p>
        <p><strong>Status:</strong> ${escapeHtml(isWarning ? emergencyLabel : "Location shared normally")}</p>
      </div>
    `;
    item.addEventListener("click", () => setSelectedLocation(entry.id, { scrollToDetail: isWarning }));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedLocation(entry.id, { scrollToDetail: isWarning });
      }
    });
    trackerList.appendChild(item);

    if (markersLayer) {
      const marker = L.marker([entry.lat, entry.lng], createMarkerIcon(entry) ? { icon: createMarkerIcon(entry) } : undefined);
      marker.on("click", () => setSelectedLocation(entry.id, { scrollToDetail: isWarning }));
      markersLayer.addLayer(marker);
    }

    bounds.push([entry.lat, entry.lng]);
  });

  renderDetail(selectedLocationId ? locations.find((entry) => entry.id === selectedLocationId) || null : null);

  if (bounds.length === 1) {
    map?.setView(bounds[0], 13);
    return;
  }

  if (bounds.length > 1) {
    map?.fitBounds(bounds, { padding: [28, 28] });
  }
}

async function handleEmergencyResponse(status) {
  const selectedEntry = currentLocations.find((entry) => entry.id === selectedLocationId);
  if (!selectedEntry?.id || responding) return;

  const reason = responseReason?.value.trim() || "";
  if (status === "declined" && !reason) {
    showToast("Please add a reason before declining this emergency report.", "warn");
    return;
  }

  responding = true;
  renderDetail(selectedEntry);

  try {
    await respondToEmergency(selectedEntry.id, { status, reason });
    currentLocations = currentLocations.map((entry) =>
      entry.id === selectedEntry.id
        ? {
            ...entry,
            emergencyActive: false,
            emergencyStatus: null,
            responseStatus: status,
            responseReason: reason || null,
          }
        : entry
    );
    selectedLocationId = null;
    showToast("Emergency response sent successfully.", "success");
  } catch (error) {
    console.error("Failed to respond to emergency:", error);
    showToast(error?.message || "Could not send the emergency response.", "error");
  } finally {
    responding = false;
    renderLocations(currentLocations);
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
approveEmergencyBtn?.addEventListener("click", () => handleEmergencyResponse("approved"));
helpEmergencyBtn?.addEventListener("click", () => handleEmergencyResponse("help_on_the_way"));
declineEmergencyBtn?.addEventListener("click", () => handleEmergencyResponse("declined"));
closeTrackerDetail?.addEventListener("click", () => setSelectedLocation(null));

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

window.addEventListener("load", () => {
  if (currentLocations.length || selectedLocationId !== null) {
    renderLocations(currentLocations);
  } else {
    ensureMap();
  }
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
