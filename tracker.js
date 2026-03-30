import { observeAuth, observeSharedLocations, isAdmin, isSuperAdmin, logout, respondToEmergency } from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";
import { initAdminEmergencyNotifications } from "./admin-emergency-notifications.js";
import { setSuperAdminNavVisible } from "./role-nav.js";

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
const trackerSearch = document.getElementById("trackerSearch");
const trackerList = document.getElementById("trackerList");
const trackerAdminLocationStatus = document.getElementById("trackerAdminLocationStatus");
const trackerNearestEmergency = document.getElementById("trackerNearestEmergency");
const trackerGuideStatus = document.getElementById("trackerGuideStatus");
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
const detailGuideDistance = document.getElementById("detailGuideDistance");
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
const TRACKER_CLOSE_LABEL_ZOOM = 15;
const trackerParams = new URLSearchParams(window.location.search);
let preselectedUserId = trackerParams.get("user");
let preselectedFocusMode = trackerParams.get("focus");

let map = null;
let markersLayer = null;
let unsubscribeSharedLocations = null;
let currentLocations = [];
let selectedLocationId = null;
let responding = false;
let mapRetryQueued = false;
let trackerSearchQuery = "";
let adminLocation = null;
let adminMarker = null;
let guideLine = null;
let adminGeoWatchId = null;
let trackerMapEventsBound = false;

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

function haversineDistanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "--";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
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
  if (!trackerMapEventsBound) {
    map.on("zoomend", () => {
      if (currentLocations.length) {
        renderLocations(currentLocations, { preserveViewport: true });
      }
    });
    trackerMapEventsBound = true;
  }
  return true;
}

function shouldShowCloseupLabels() {
  return Boolean(map) && map.getZoom() >= TRACKER_CLOSE_LABEL_ZOOM;
}

function createAdminLocationIcon() {
  return L.divIcon({
    className: "tracker-admin-location-icon",
    html: '<span class="tracker-admin-location-pin">A</span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
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

function getFilteredLocations(locations = currentLocations) {
  const query = trackerSearchQuery.trim().toLowerCase();
  if (!query) return locations;

  return locations.filter((entry) => {
    const username = String(entry?.username || "").toLowerCase();
    const email = String(entry?.email || "").toLowerCase();
    return username.includes(query) || email.includes(query);
  });
}

function entryMatchesSearch(entry) {
  const query = trackerSearchQuery.trim().toLowerCase();
  if (!query) return false;
  const username = String(entry?.username || "").toLowerCase();
  const email = String(entry?.email || "").toLowerCase();
  return username.includes(query) || email.includes(query);
}

function getEmergencyLabel(entry) {
  if (entry?.responseStatus === "approved") return t("approved");
  if (entry?.responseStatus === "help_on_the_way") return t("help_on_the_way");
  if (entry?.responseStatus === "declined") return t("decline");
  if (entry?.emergencyStatus === "pending") return t("pending_admin_review");
  return t("no_alert");
}

function getEntryMode(entry) {
  return entry?.emergencyActive === true ? "warning" : "normal";
}

function formatCoords(entry) {
  return `${Number(entry.lat).toFixed(5)}, ${Number(entry.lng).toFixed(5)}`;
}

function buildMarkerPopup(entry) {
  const username = escapeHtml(entry.username || "--");
  const email = escapeHtml(entry.email || "No email saved");
  const phone = escapeHtml(entry.phone || t("no_phone_saved"));
  const coords = escapeHtml(formatCoords(entry));
  const updated = escapeHtml(formatTimestamp(entry.updatedAt));
  const status = escapeHtml(getEntryMode(entry) === "warning" ? getEmergencyLabel(entry) : "Location shared normally");

  return `
    <strong>${username}</strong><br />
    ${escapeHtml(t("email"))}: ${email}<br />
    ${escapeHtml(t("phone_label"))}: ${phone}<br />
    ${escapeHtml(t("coordinates_label"))}: ${coords}<br />
    ${escapeHtml(t("updated_label"))}: ${updated}<br />
    ${escapeHtml(t("status_label"))}: ${status}
  `;
}

function createSearchHighlightIcon(entry) {
  if (!entryMatchesSearch(entry)) return null;
  const warning = getEntryMode(entry) === "warning";
  return L.divIcon({
    className: `tracker-search-highlight${warning ? " is-warning" : ""}`,
    html: '<span class="tracker-search-ring"></span>',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function updateAdminMarker() {
  if (!map || !adminLocation) return;
  if (!adminMarker) {
    adminMarker = L.marker([adminLocation.lat, adminLocation.lng], {
      icon: createAdminLocationIcon(),
    }).addTo(map);
    adminMarker.bindTooltip("Admin location", {
      permanent: true,
      direction: "top",
      offset: [0, -18],
      className: "tracker-admin-label",
    });
  } else {
    adminMarker.setLatLng([adminLocation.lat, adminLocation.lng]);
  }
  adminMarker.bindPopup(
    `${escapeHtml(t("your_current_admin_location"))}<br />${escapeHtml(t("accuracy_label"))}: ${escapeHtml(formatDistance(adminLocation.accuracy))}`,
    { maxWidth: 220 }
  );
}

function clearGuideLine() {
  if (guideLine && map) {
    try {
      map.removeLayer(guideLine);
    } catch (error) {}
  }
  guideLine = null;
}

function updateNearestEmergencyStatus(locations = currentLocations) {
  if (!trackerNearestEmergency) return;
  const emergencyLocations = (locations || []).filter((entry) => entry?.emergencyActive === true);
  if (!emergencyLocations.length) {
    trackerNearestEmergency.textContent = t("no_active_emergency_alerts");
    return;
  }
  if (!adminLocation) {
    trackerNearestEmergency.textContent = t("enable_admin_location_estimate");
    return;
  }

  const nearest = emergencyLocations
    .map((entry) => ({
      entry,
      distance: haversineDistanceMeters(adminLocation, { lat: entry.lat, lng: entry.lng }),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  trackerNearestEmergency.textContent = t("nearest_emergency_format", {
    user: nearest.entry.username || nearest.entry.email || t("unknown_user"),
    distance: formatDistance(nearest.distance),
  });
}

function updateGuideLine() {
  clearGuideLine();

  if (!map) return;

  const selectedEntry = currentLocations.find((entry) => entry.id === selectedLocationId);
  if (!selectedEntry || !adminLocation) {
    if (trackerGuideStatus) {
      trackerGuideStatus.textContent = selectedEntry
        ? t("admin_location_needed_guide")
        : t("select_shared_location_guide");
    }
    if (detailGuideDistance) {
      detailGuideDistance.textContent = selectedEntry
        ? t("admin_location_needed_distance")
        : t("guide_distance_select");
    }
    return;
  }

  const distance = haversineDistanceMeters(adminLocation, { lat: selectedEntry.lat, lng: selectedEntry.lng });
  guideLine = L.polyline(
    [
      [adminLocation.lat, adminLocation.lng],
      [selectedEntry.lat, selectedEntry.lng],
    ],
    {
      color: selectedEntry.emergencyActive === true ? "#c45344" : "#2b7bff",
      weight: 4,
      opacity: 0.9,
      dashArray: "10 12",
      className: "tracker-route-line",
    }
  ).addTo(map);

  if (trackerGuideStatus) {
    trackerGuideStatus.textContent = t("guide_line_active", { distance: formatDistance(distance) });
  }
  if (detailGuideDistance) {
    detailGuideDistance.textContent = t("guide_distance_from_admin", { distance: formatDistance(distance) });
  }

  const bounds = L.latLngBounds(
    [
      [adminLocation.lat, adminLocation.lng],
      [selectedEntry.lat, selectedEntry.lng],
    ]
  );
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
}

function updateAdminLocationStatus() {
  if (!trackerAdminLocationStatus) return;
  if (!navigator.geolocation) {
    trackerAdminLocationStatus.textContent = t("browser_no_live_admin_location");
    return;
  }
  if (!adminLocation) {
    trackerAdminLocationStatus.textContent = t("finding_current_location");
    return;
  }
  trackerAdminLocationStatus.textContent = `${Number(adminLocation.lat).toFixed(4)}, ${Number(adminLocation.lng).toFixed(4)} · ${formatDistance(adminLocation.accuracy)}`;
}

function startAdminLocationTracking() {
  if (!navigator.geolocation) {
    updateAdminLocationStatus();
    updateNearestEmergencyStatus(currentLocations);
    return;
  }

  if (adminGeoWatchId !== null) {
    try {
      navigator.geolocation.clearWatch(adminGeoWatchId);
    } catch (error) {}
    adminGeoWatchId = null;
  }

  const onSuccess = (position) => {
    adminLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    };
    updateAdminLocationStatus();
    updateAdminMarker();
    updateNearestEmergencyStatus(currentLocations);
    updateGuideLine();
  };

  const onError = () => {
    if (trackerAdminLocationStatus) {
      trackerAdminLocationStatus.textContent = t("allow_location_admin_marker");
    }
    if (trackerNearestEmergency && currentLocations.some((entry) => entry?.emergencyActive === true)) {
      trackerNearestEmergency.textContent = t("allow_admin_location_estimate");
    }
    updateGuideLine();
  };

  navigator.geolocation.getCurrentPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

  try {
    adminGeoWatchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 5000,
    });
  } catch (error) {
    console.warn("Failed to watch admin location:", error);
  }
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
  detailEmail.textContent = entry.email || t("no_email_saved");
  detailPhone.textContent = entry.phone || t("no_phone_saved");
  detailCoords.textContent = formatCoords(entry);
  detailUpdated.textContent = formatTimestamp(entry.updatedAt);
  detailEmergencyStatus.textContent = isWarning ? getEmergencyLabel(entry) : t("location_shared_normally");
  if (detailGuideDistance) {
    if (adminLocation) {
      detailGuideDistance.textContent = t("guide_distance_from_admin", {
        distance: formatDistance(haversineDistanceMeters(adminLocation, { lat: entry.lat, lng: entry.lng })),
      });
    } else {
      detailGuideDistance.textContent = t("admin_location_needed_distance");
    }
  }
  detailMessage.textContent = isWarning
    ? entry.emergencyMessage || t("no_emergency_message")
    : t("no_active_emergency_for_location");
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
      ? t("tracker_no_proof")
      : t("no_active_emergency_click_warning");
  }

  const canRespond = isWarning;
  trackerResponseForm?.classList.toggle("hidden", !canRespond);
  [approveEmergencyBtn, helpEmergencyBtn, declineEmergencyBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !canRespond || responding;
  });
  if (responseReason) responseReason.disabled = !canRespond || responding;
}

function renderLocations(locations, options = {}) {
  const { preserveViewport = false } = options;
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
  const matchedLocations = getFilteredLocations(locations);

  trackerCount.textContent = String(locations.length);
  trackerEmergencyCount.textContent = String(locations.filter((entry) => entry?.emergencyActive === true).length);
    trackerStatus.textContent = locations.length
    ? trackerSearchQuery.trim()
      ? t("tracker_status_highlighted", { count: matchedLocations.length })
      : t("tracker_status_synced", { count: locations.length })
    : t("tracker_status_none");
  trackerMapStatus.textContent = locations.some((entry) => entry?.emergencyActive === true)
    ? t("warning_markers_active")
    : locations.length
      ? t("showing_synced_user_markers")
      : t("waiting_for_user_shares");
  trackerLastUpdated.textContent = locations.length ? formatTimestamp(locations[0]?.updatedAt) : "--";
  updateNearestEmergencyStatus(locations);

  trackerList.innerHTML = "";

  if (markersLayer) {
    markersLayer.clearLayers();
  }

  if (!locations.length) {
    trackerList.innerHTML = `<div class="tracker-empty">${escapeHtml(t("tracker_empty"))}</div>`;
    map?.setView(BICOL_CENTER, 7);
    renderDetail(null);
    return;
  }
  if (!locations.some((entry) => entry.id === selectedLocationId)) {
    selectedLocationId = null;
  }
  if (!selectedLocationId && preselectedUserId && locations.some((entry) => entry.id === preselectedUserId)) {
    selectedLocationId = preselectedUserId;
  }

  const bounds = [];

  if (trackerSearchQuery.trim() && !matchedLocations.length) {
    trackerList.innerHTML = `<div class="tracker-empty">${escapeHtml(t("no_tracked_user_match"))}</div>`;
  }

  locations.forEach((entry) => {
    const username = entry.username || entry.email || "Unknown user";
    const updated = formatTimestamp(entry.updatedAt);
    const emergencyLabel = getEmergencyLabel(entry);
    const isWarning = getEntryMode(entry) === "warning";
    const isMatch = entryMatchesSearch(entry);

    if (!trackerSearchQuery.trim() || isMatch) {
      const item = document.createElement("article");
      item.className = `tracker-item${entry.id === selectedLocationId ? " is-selected" : ""}${isWarning ? " is-warning" : ""}${isMatch ? " is-match" : ""}`;
      item.tabIndex = 0;
      item.innerHTML = `
        <div class="tracker-item-head">
          <div>
            <h4>${escapeHtml(username)}</h4>
            <p>${isWarning ? escapeHtml(t("warning_marker_active")) : escapeHtml(t("shared_location_active"))}</p>
          </div>
          <span class="ghost small">${isWarning ? escapeHtml(t("warning")) : escapeHtml(t("view"))}</span>
        </div>
        <div class="tracker-item-meta">
          <p><strong>${escapeHtml(t("updated_label"))}:</strong> ${escapeHtml(updated)}</p>
          <p><strong>${escapeHtml(t("status_label"))}:</strong> ${escapeHtml(isWarning ? emergencyLabel : t("location_shared_normally"))}</p>
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
    }

    if (markersLayer) {
      const marker = L.marker([entry.lat, entry.lng], createMarkerIcon(entry) ? { icon: createMarkerIcon(entry) } : undefined);
      if (shouldShowCloseupLabels()) {
        marker.bindTooltip(escapeHtml(entry.email || entry.username || "Tracked user"), {
          permanent: true,
          direction: "top",
          offset: [0, -18],
          className: `tracker-email-label${isWarning ? " is-warning" : ""}${isMatch ? " is-match" : ""}`,
        });
      }
      marker.bindPopup(buildMarkerPopup(entry), {
        maxWidth: 260,
      });
      marker.on("mouseover", () => marker.openPopup());
      marker.on("mouseout", () => marker.closePopup());
      marker.on("click", () => setSelectedLocation(entry.id, { scrollToDetail: isWarning }));
      markersLayer.addLayer(marker);
      const highlightIcon = createSearchHighlightIcon(entry);
      if (highlightIcon) {
        const halo = L.marker([entry.lat, entry.lng], {
          icon: highlightIcon,
          interactive: false,
          keyboard: false,
          zIndexOffset: -500,
        });
        markersLayer.addLayer(halo);
      }
    }

    bounds.push([entry.lat, entry.lng]);
  });

  renderDetail(selectedLocationId ? locations.find((entry) => entry.id === selectedLocationId) || null : null);
  updateAdminMarker();
  updateGuideLine();
  if (selectedLocationId && preselectedUserId === selectedLocationId && preselectedFocusMode === "emergency") {
    scrollToDetails();
    preselectedUserId = null;
    preselectedFocusMode = null;
  }

  if (preserveViewport) {
    return;
  }

  if (selectedLocationId && adminLocation) {
    return;
  }

  const allBounds = adminLocation ? [[adminLocation.lat, adminLocation.lng], ...bounds] : bounds;

  if (allBounds.length === 1) {
    map?.setView(allBounds[0], 13);
    return;
  }

  if (allBounds.length > 1) {
    map?.fitBounds(allBounds, { padding: [28, 28] });
  }
}

async function handleEmergencyResponse(status) {
  const selectedEntry = currentLocations.find((entry) => entry.id === selectedLocationId);
  if (!selectedEntry?.id || responding) return;

  const reason = responseReason?.value.trim() || "";
  if (status === "declined" && !reason) {
    showToast(t("tracker_decline_reason_required"), "warn");
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
    showToast(t("tracker_response_sent"), "success");
  } catch (error) {
    console.error("Failed to respond to emergency:", error);
    showToast(error?.message || t("tracker_response_failed"), "error");
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
trackerSearch?.addEventListener("input", () => {
  trackerSearchQuery = trackerSearch.value || "";
  renderLocations(currentLocations);
});

observeAuth((user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  if (!isAdmin(user)) {
    window.location.href = "profile.html";
    return;
  }

  setSuperAdminNavVisible(isSuperAdmin(user));
  trackerUsername.textContent = user.displayName || user.email?.split("@")[0] || "--";
  trackerEmail.textContent = user.email || "--";
  trackerRole.textContent = isSuperAdmin(user) ? "Super Admin" : "Administrator";
  updateAdminLocationStatus();
  startAdminLocationTracking();

  unsubscribeSharedLocations?.();
  unsubscribeSharedLocations = observeSharedLocations((locations) => {
    renderLocations(locations);
  });
});

window.addEventListener("beforeunload", () => {
  if (unsubscribeSharedLocations) unsubscribeSharedLocations();
  if (adminGeoWatchId !== null && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(adminGeoWatchId);
    } catch (error) {}
  }
});

window.addEventListener("load", () => {
  if (currentLocations.length || selectedLocationId !== null) {
    renderLocations(currentLocations);
  } else {
    ensureMap();
  }
});

window.addEventListener("language-changed", () => {
  renderLocations(currentLocations);
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
initAdminEmergencyNotifications();
