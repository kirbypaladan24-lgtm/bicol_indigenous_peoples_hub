// app.js
import {
  observeAuth,
  loginWithEmail,
  createAccount,
  logout,
  changePassword,
  fetchPosts,
  observePosts,
  isAdmin,
  savePost,
  auth,
  getUserProfile,
  fetchUsersCount,
  setPublicUserCount,
  fetchLandmarks,
  ensureAnonAuth,
} from "./auth.js";
import { initAdmin } from "./admin.js";
import { renderPosts, showToast, setStats } from "./ui.js";
import { uploadImages } from "./imgbb.js";

// UI Elements
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const profileBtn = document.getElementById("profileBtn");
const changePassBtn = document.getElementById("changePassBtn");
const themeToggle = document.getElementById("themeToggle");
const menuToggle = document.getElementById("menuToggle");
const authDialog = document.getElementById("authDialog");
const closeAuth = document.getElementById("closeAuth");
const emailForm = document.getElementById("emailForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const toggleLoginPass = document.getElementById("toggleLoginPass");
const newPostBtn = document.getElementById("newPostBtn");
const ctaLoginBtn = document.getElementById("ctaLoginBtn");
const exploreBtn = document.getElementById("exploreBtn");
const scrollMapBtn = document.getElementById("scrollMapBtn");
const mobileMenu = document.getElementById("mobileMenu");
const mobileLoginBtn = document.getElementById("mobileLoginBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const mobileProfileBtn = document.getElementById("mobileProfileBtn");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const userPostDialog = document.getElementById("userPostDialog");
const closeUserPost = document.getElementById("closeUserPost");
const userPostTitle = document.getElementById("userPostTitle");
const userImageInput = document.getElementById("userImageInput");
const imagePreviewUser = document.getElementById("imagePreviewUser");
const userEditor = document.getElementById("userEditor");
const userSavePostBtn = document.getElementById("userSavePostBtn");
const userToolbar = document.getElementById("userToolbar");
const trackLocationBtn = document.getElementById("trackLocationBtn");
const mapInfo = document.getElementById("mapInfo");
const accuracyIndicator = document.getElementById("accuracyIndicator"); // optional small UI element for signal
const policyDialog = document.getElementById("policyDialog");
const policyProceed = document.getElementById("policyProceed");
const policyNote = document.getElementById("policyNote");
const postSearchInput = document.getElementById("postSearch");
const clearPostSearch = document.getElementById("clearPostSearch");
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

// Global Map State
let userMarker = null;
let userAccuracyCircle = null;
let mapInstance = null;
let mapMarkersLayer = null;
let geoWatchId = null;
let isTracking = false;
let userPostSubmitting = false;
let pollIntervalId = null;
let postsUnsub = null;

// Settings to tune
const POSITION_BUFFER_SIZE = 8;
const MAX_ACCEPTABLE_ACCURACY = 50; // meters for claiming "precise"
const MAX_IGNORABLE_AGE_MS = 25_000; // consider readings older than this stale
const INITIAL_POLL_DURATION_MS = 30_000; // how long to aggressively poll getCurrentPosition
const INITIAL_POLL_INTERVAL_MS = 3000; // poll every 3s during initial period
const TOAST_THROTTLE_MS = 12000;
const MAX_IMAGES_PER_POST = 10;
let cachedAuthorName = null;
const THEME_KEY = "bicol-ip-theme";
const POLICY_KEY = "bicol-ip-policy-v1";
const LANDMARK_CACHE_KEY = "bicol-ip-landmarks-cache-v1";
const LANDMARK_CACHE_TTL_MS = 1000 * 60 * 30;
const USER_COUNT_CACHE_KEY = "bicol-ip-user-count";
let allPostsCache = [];

// Buffers and state
let positionsBuffer = []; // {lat,lng,accuracy,timestamp}
let bestAccuracySeen = Infinity;
let lastToastAt = 0;

// --- Kalman filter (simple) for smoothing coordinates ---
// (unchanged from your original file)
class Kalman1D {
  constructor(processNoise = 1e-3, initialEstimate = 0, initialUncertainty = 1e3) {
    this.q = processNoise;
    this.x = initialEstimate;
    this.p = initialUncertainty;
  }
  predict() {
    this.p += this.q;
  }
  update(measurement, r) {
    const k = this.p / (this.p + r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }
}

class Kalman2D {
  constructor(processNoise = 1e-4) {
    this.kx = new Kalman1D(processNoise);
    this.ky = new Kalman1D(processNoise);
    this.initialized = false;
  }
  init(lat, lng, measurementVar = 100 * 100) {
    this.kx.x = lat;
    this.ky.x = lng;
    const initUncertainty = Math.max(1, measurementVar);
    this.kx.p = initUncertainty;
    this.ky.p = initUncertainty;
    this.initialized = true;
  }
  update(lat, lng, accuracy) {
    const varr = accuracy && accuracy > 0 ? Math.max(1, accuracy * accuracy) : 10000;
    if (!this.initialized) {
      this.init(lat, lng, varr);
      return { lat, lng, accuracy };
    }
    this.kx.predict();
    this.ky.predict();
    const sx = this.kx.update(lat, varr);
    const sy = this.ky.update(lng, varr);
    const estVariance = (this.kx.p + this.ky.p) / 2;
    const estAccuracy = Math.sqrt(Math.max(estVariance, 0));
    return { lat: sx, lng: sy, accuracy: estAccuracy };
  }
}
const kalman = new Kalman2D(1e-6);

// --- Theme handling ---
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

function initPolicyGate() {
  if (!policyDialog) return;
  if (localStorage.getItem(POLICY_KEY) === "agreed") return;
  policyDialog.addEventListener("cancel", (e) => e.preventDefault());
  policyDialog.showModal();

  const choices = Array.from(document.querySelectorAll('input[name="policyChoice"]'));
  const updateState = () => {
    const selected = choices.find((c) => c.checked)?.value;
    if (selected === "agree") {
      policyProceed.disabled = false;
      policyNote.textContent = "Thanks for agreeing. You can proceed.";
      policyNote.style.color = "var(--accent-2)";
    } else if (selected === "disagree") {
      policyProceed.disabled = true;
      policyNote.textContent = "You must agree to continue using the site.";
      policyNote.style.color = "var(--muted)";
    } else {
      policyProceed.disabled = true;
      policyNote.textContent = "Select an option to continue.";
      policyNote.style.color = "var(--muted)";
    }
  };
  choices.forEach((c) => c.addEventListener("change", updateState));
  updateState();

  policyProceed?.addEventListener("click", () => {
    const selected = choices.find((c) => c.checked)?.value;
    if (selected !== "agree") return;
    localStorage.setItem(POLICY_KEY, "agreed");
    policyDialog.close();
    showToast("Thanks for agreeing to the policy.", "success");
  });
}

function normalizeContent(html) {
  if (!html) return "";
  const hasTags = /<\s*(p|div|br|ul|ol|li|blockquote|h\d)\b/i.test(html);
  if (!hasTags && html.includes("\n")) {
    return html.replace(/\n/g, "<br>");
  }
  return html;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || tmp.innerText || "";
}

function filterPostsByQuery(posts, query) {
  const q = normalizeSearchText(query);
  if (!q) return posts;
  return posts.filter((p) => {
    const haystack = normalizeSearchText(
      `${p.title || ""} ${p.author || ""} ${stripHtml(p.content || "")}`
    );
    return haystack.includes(q);
  });
}

function applyPostFilter() {
  const query = postSearchInput?.value || "";
  const filtered = filterPostsByQuery(allPostsCache, query);
  const empty = document.getElementById("postsEmpty");
  if (empty) {
    empty.textContent = query ? "No posts match your search." : "No posts yet. Sign in to add the first story.";
  }
  renderPosts(filtered);
}

async function resolveAuthorName() {
  const user = auth?.currentUser;
  if (!user) return "Contributor";
  if (cachedAuthorName) return cachedAuthorName;
  try {
    const profile = await getUserProfile(user.uid);
    if (profile?.username) {
      cachedAuthorName = profile.username;
      return cachedAuthorName;
    }
  } catch (e) {
    console.warn("Profile lookup failed", e);
  }
  if (user.displayName) {
    cachedAuthorName = user.displayName;
    return cachedAuthorName;
  }
  if (user.email) {
    cachedAuthorName = user.email.split("@")[0];
    return cachedAuthorName;
  }
  return "Contributor";
}
// --- Utility: haversine distance (meters) ---
function haversineDistanceMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

// --- Heuristics to detect likely provider/source ---
function detectLikelySource(position) {
  const coords = position.coords || {};
  const acc = typeof coords.accuracy === "number" ? coords.accuracy : null;
  // altitude/heading/speed presence is a strong indicator of GPS
  if (coords.altitude !== null || coords.heading !== null || coords.speed !== null) return "gps";
  if (acc !== null && acc <= 50) return "gps";
  if (acc !== null && acc <= 1000) return "wifi/cell";
  return "ip/coarse";
}

// Optional: fetch IP geolocation to corroborate coarse sources
let _cachedIpLocation = null;
async function fetchIpLocation() {
  if (_cachedIpLocation) return _cachedIpLocation;
  try {
    const res = await fetch("https://ipapi.co/json/"); // swap provider if needed
    if (!res.ok) return null;
    const json = await res.json();
    const lat = Number(json.latitude ?? json.lat);
    const lng = Number(json.longitude ?? json.lon ?? json.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      _cachedIpLocation = { lat, lng };
      return _cachedIpLocation;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// --- Position buffer / smoothing helpers ---
function clearPositionsBuffer() {
  positionsBuffer = [];
  bestAccuracySeen = Infinity;
  kalman.initialized = false;
}

function acceptPositionIfValid(position) {
  const { latitude: lat, longitude: lng, accuracy } = position.coords || {};
  const timestamp = position.timestamp || Date.now();

  if (!isFinite(lat) || !isFinite(lng)) {
    console.warn("Ignored invalid coordinates.");
    return false;
  }

  if (Date.now() - timestamp > MAX_IGNORABLE_AGE_MS) {
    console.warn("Ignored stale reading.");
    return false;
  }

  const acc = typeof accuracy === "number" && accuracy >= 0 ? accuracy : null;
  positionsBuffer.push({ lat, lng, accuracy: acc, timestamp });
  if (positionsBuffer.length > POSITION_BUFFER_SIZE) positionsBuffer.shift();
  if (acc !== null) bestAccuracySeen = Math.min(bestAccuracySeen, acc);
  return true;
}

function getSmoothedPositionFromBuffer() {
  if (!positionsBuffer.length) return null;

  const veryAccurate = positionsBuffer.find((p) => p.accuracy !== null && p.accuracy <= 3);
  if (veryAccurate) {
    kalman.init(veryAccurate.lat, veryAccurate.lng, (veryAccurate.accuracy ?? 1) ** 2);
    return { lat: veryAccurate.lat, lng: veryAccurate.lng, accuracy: veryAccurate.accuracy ?? 3 };
  }

  let res = null;
  for (const p of positionsBuffer) {
    if (!kalman.initialized) {
      kalman.init(p.lat, p.lng, (p.accuracy ?? 50) ** 2);
      res = { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? 50 };
      continue;
    }
    res = kalman.update(p.lat, p.lng, p.accuracy ?? 50);
  }
  return res || null;
}

function safeShowToast(message, type = "info") {
  if (Date.now() - lastToastAt > TOAST_THROTTLE_MS) {
    showToast(message, type);
    lastToastAt = Date.now();
  }
}

function updateMapInfoPanel(accuracy, precise, source) {
  if (!mapInfo) return;
  const accText = accuracy ? `${Math.round(accuracy)} m` : "unknown";
  mapInfo.classList.remove("hidden");
  mapInfo.innerHTML = `<strong>Location:</strong> ${precise ? "Precise" : "Approximate"} (${source || "unknown"}, accuracy ~ ${accText})`;
  if (accuracyIndicator) {
    const quality = accuracy ? (accuracy <= 50 ? "good" : accuracy <= 200 ? "fair" : "poor") : "unknown";
    accuracyIndicator.dataset.quality = quality; // style via CSS using data-quality attribute
    accuracyIndicator.textContent = quality === "good" ? "GPS ✓" : quality === "fair" ? "Wi‑Fi" : "Coarse";
  }
}

// --- Map helpers: accuracy circle ---
function ensureAccuracyCircle(latlng, accuracyMeters) {
  if (!mapInstance) return;
  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(latlng);
    userAccuracyCircle.setRadius(accuracyMeters);
  } else {
    userAccuracyCircle = L.circle(latlng, {
      radius: accuracyMeters,
      color: "#3388ff",
      weight: 1,
      fillColor: "#3388ff",
      fillOpacity: 0.12,
    }).addTo(mapInstance);
  }
}

// --- Core handlers: success / error ---
async function onLocationSuccess(position) {
  const accepted = acceptPositionIfValid(position);
  if (!accepted) return;

  // detect probable source
  const source = detectLikelySource(position);

  // optional IP comparison for coarse indications
  if ((source === "ip/coarse" || source === "wifi/cell") && position.coords && (position.coords.accuracy ?? 9999) > 300) {
    const ipLoc = await fetchIpLocation();
    if (ipLoc) {
      const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
      const d = haversineDistanceMeters(pos, ipLoc);
      if (d < 3000 && (position.coords.accuracy ?? 9999) > 500) {
        safeShowToast("Location looks coarse and may be based on IP/Wi‑Fi database, not device GPS. Move outdoors and enable device GPS for better accuracy.", "warn");
      }
    } else {
      safeShowToast("Location accuracy is poor; the browser may be using network/IP-based location instead of device GPS.", "info");
    }
  }

  const smoothed = getSmoothedPositionFromBuffer();
  if (!smoothed) return;
  const effectiveAccuracy = smoothed.accuracy ?? (isFinite(bestAccuracySeen) ? bestAccuracySeen : null);
  const isPrecise = effectiveAccuracy !== null && effectiveAccuracy <= MAX_ACCEPTABLE_ACCURACY;

  if (!mapInstance) return;
  const latlng = [smoothed.lat, smoothed.lng];

  if (!userMarker) {
    const userIcon = L.divIcon({
      className: "user-location-wrapper",
      html: '<div class="pulse-marker"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    userMarker = L.marker(latlng, { icon: userIcon }).addTo(mapInstance);
    if (isPrecise) {
      mapInstance.setView(latlng, 16);
    } else {
      mapInstance.setView(latlng, 13);
    }
  } else {
    userMarker.setLatLng(latlng);
  }

  // show accuracy circle
  if (effectiveAccuracy && effectiveAccuracy > 0) {
    ensureAccuracyCircle(latlng, effectiveAccuracy);
  } else if (userAccuracyCircle) {
    try {
      mapInstance.removeLayer(userAccuracyCircle);
    } catch (e) {}
    userAccuracyCircle = null;
  }

  const accuracyText = effectiveAccuracy ? `${Math.round(effectiveAccuracy)} m` : "unknown";
  const label = isPrecise
    ? `You are here (accuracy ~ ${accuracyText})`
    : `Approximate location (accuracy ~ ${accuracyText}). Move outdoors for better GPS.`;

  userMarker.bindTooltip(label, { permanent: false, direction: "top" });
  userMarker.openTooltip();

  updateMapInfoPanel(effectiveAccuracy, isPrecise, source);

  if (isPrecise) {
    safeShowToast(`Location locked (accuracy ~ ${Math.round(effectiveAccuracy)} m)`, "success");
  } else {
    safeShowToast(`Approximate location (accuracy ~ ${accuracyText}). Waiting for better GPS...`, "info");
  }
}

function onLocationError(error) {
  console.error("Location error:", error);
  switch (error.code) {
    case error.PERMISSION_DENIED:
      safeShowToast("Location permission denied. Allow access in your browser settings.", "error");
      break;
    case error.POSITION_UNAVAILABLE:
      safeShowToast("Position unavailable. Ensure device location services are enabled.", "warn");
      break;
    case error.TIMEOUT:
      safeShowToast("Location request timed out. Try again or move to a location with better signal.", "warn");
      break;
    default:
      safeShowToast("Unable to retrieve location. Check permissions and try again.", "warn");
      break;
  }
  stopTracking();
}

// --- Aggressive initial polling to "wake" GPS hardware (best-effort) ---
function startInitialPolling() {
  const start = Date.now();
  // poll getCurrentPosition at short intervals for INITIAL_POLL_DURATION_MS
  pollIntervalId = setInterval(() => {
    if (!isTracking) return;
    if (Date.now() - start > INITIAL_POLL_DURATION_MS) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
      return;
    }
    // call getCurrentPosition once to attempt a fresh GPS fix
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // onLocationSuccess will be triggered through acceptPositionIfValid etc.
        onLocationSuccess(pos);
      },
      (err) => {
        // don't spam errors; only surface if persistent
        console.warn("Initial poll getCurrentPosition failed:", err);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }, INITIAL_POLL_INTERVAL_MS);
}

// --- Start/stop tracking UI and core logic ---
function stopTracking(cleanupOnly = false) {
  if (geoWatchId !== null) {
    try {
      navigator.geolocation.clearWatch(geoWatchId);
    } catch (e) {
      console.warn("Failed to clear geolocation watch:", e);
    }
  }
  geoWatchId = null;
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (userMarker && mapInstance) {
    try {
      mapInstance.removeLayer(userMarker);
    } catch (e) {}
  }
  if (userAccuracyCircle && mapInstance) {
    try {
      mapInstance.removeLayer(userAccuracyCircle);
    } catch (e) {}
  }
  userMarker = null;
  userAccuracyCircle = null;
  clearPositionsBuffer();
  isTracking = false;
  if (!cleanupOnly) {
    trackLocationBtn?.classList.remove("active");
    if (trackLocationBtn) trackLocationBtn.innerHTML = `<span class="icon">⌖</span> My Location`;
    safeShowToast("Location tracking stopped.", "info");
  }
}

async function toggleLocationTracking() {
  if (isTracking) {
    stopTracking();
    return;
  }

  if (!navigator.geolocation) {
    safeShowToast("Geolocation is not supported by your browser.", "error");
    return;
  }

  // Permission quick-check (best-effort)
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const perm = await navigator.permissions.query({ name: "geolocation" });
      if (perm.state === "denied") {
        safeShowToast("Location access is denied. Please enable it in your browser.", "error");
        return;
      }
    } catch (e) {
      // ignore; we'll request permission via getCurrentPosition
    }
  }

  // Clear previous state and UI
  clearPositionsBuffer();
  if (userMarker && mapInstance) {
    try {
      mapInstance.removeLayer(userMarker);
    } catch (e) {}
    userMarker = null;
  }
  if (userAccuracyCircle && mapInstance) {
    try {
      mapInstance.removeLayer(userAccuracyCircle);
    } catch (e) {}
    userAccuracyCircle = null;
  }

  // Update UI
  trackLocationBtn?.classList.add("active");
  if (trackLocationBtn) trackLocationBtn.innerHTML = `<span class="icon">⌖</span> Starting...`;
  if (trackLocationBtn) trackLocationBtn.disabled = true;

  // Start tracking
  isTracking = true;

  try {
    geoWatchId = navigator.geolocation.watchPosition(onLocationSuccess, onLocationError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  } catch (e) {
    console.error("Failed to start watchPosition:", e);
    safeShowToast("Failed to start location tracking.", "error");
    isTracking = false;
    if (trackLocationBtn) trackLocationBtn.disabled = false;
    return;
  }

  // Seed with an initial getCurrentPosition (and start aggressive polling) to improve chance of GPS fix
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onLocationSuccess(pos); // handle and seed
      if (trackLocationBtn) trackLocationBtn.disabled = false;
    },
    (err) => {
      console.warn("Initial getCurrentPosition failed:", err);
      if (trackLocationBtn) trackLocationBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );

  // Start aggressive polling for a while to "wake" GPS chip (best-effort; power-hungry)
  startInitialPolling();

  // Warn after some time if still not precise
  setTimeout(() => {
    if (!isTracking) return;
    const currentBest = isFinite(bestAccuracySeen) ? bestAccuracySeen : null;
    if (!currentBest || currentBest > MAX_ACCEPTABLE_ACCURACY) {
      safeShowToast("Still acquiring a precise GPS fix. Try moving outdoors, enable device GPS, and turn off battery saver.", "info");
    }
  }, 25000);

  if (trackLocationBtn) {
    trackLocationBtn.innerHTML = `<span class="icon">⌖</span> Tracking...`;
    trackLocationBtn.disabled = false;
  }
}

// Global Event Listeners
trackLocationBtn?.addEventListener("click", toggleLocationTracking);

// --- Map & app initialization (kept minimal; ensure Leaflet is loaded before initMap) ---
const defaultLandmarks = [
  {
    name: "Agta of Mt. Isarog",
    position: { lat: 13.6693, lng: 123.3307 },
    summary: "Upland Agta community preserving hunting traditions and forest stewardship.",
  },
  {
    name: "Agta of Mt. Malinao",
    position: { lat: 13.3818, lng: 123.7089 },
    summary: "Known for rattan craft and forest-based livelihoods.",
  },
  {
    name: "Agta of Mt. Bulusan",
    position: { lat: 12.7556, lng: 124.0504 },
    summary: "Communities near Bulusan maintain oral histories and music traditions.",
  },
];

function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("leaflet-fallback");
    if (existing) {
      existing.addEventListener("load", () => (window.L ? resolve() : reject()));
      existing.addEventListener("error", reject);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.id = "leaflet-fallback";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    script.defer = true;
    script.onload = () => (window.L ? resolve() : reject());
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function initMap() {
  const mapEl = document.getElementById("mapCanvas");
  if (!mapEl) return;
  mapEl.innerHTML = "";

  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
  }).setView([13.3, 123.5], 8);
  mapInstance = map;

  const layers = {
    Streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }),
    Terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17 }),
    Satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 }
    ),
  };

  layers.Streets.addTo(map);
  L.control.layers(layers, null, { position: "topright", collapsed: false }).addTo(map);

  mapMarkersLayer = L.layerGroup().addTo(map);
  loadLandmarksToMap();
  setTimeout(() => map.invalidateSize(), 150);
}

async function loadLandmarksToMap() {
  if (!mapInstance || !mapMarkersLayer) return;
  mapMarkersLayer.clearLayers();

  const normalizeLandmarks = (items) =>
    Array.isArray(items)
      ? items.map((l) => {
          const lat = l?.position?.lat ?? l?.lat;
          const lng = l?.position?.lng ?? l?.lng;
          return {
            id: l?.id,
            name: l?.name || "Landmark",
            position: { lat: Number(lat), lng: Number(lng) },
            summary: l?.summary || "",
            coverUrl: l?.coverUrl || null,
            color: l?.color || null,
          };
        })
      : [];

  const renderLandmarks = (items) => {
    mapMarkersLayer.clearLayers();
    const valid = items.filter((m) => isFinite(m.position.lat) && isFinite(m.position.lng));
    const data = valid.length ? valid : defaultLandmarks;
    const infoBox = document.getElementById("mapInfo");
    data.forEach((m) => {
      if (!isFinite(m.position.lat) || !isFinite(m.position.lng)) return;
      const marker = L.circleMarker([m.position.lat, m.position.lng], {
        radius: 7,
        color: m.color || "#5a9a6a",
        fillColor: m.color || "#5a9a6a",
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(mapMarkersLayer);
      if (m.name) {
        marker.bindTooltip(m.name, { permanent: true, direction: "top", offset: [0, -10] }).openTooltip();
      }
      marker.on("click", () => {
        infoBox.classList.remove("hidden");
        infoBox.innerHTML = `<h4>${m.name}</h4><p>${m.summary || ""}</p>`;
        if (m.id) {
          window.location.href = `landmark.html?id=${encodeURIComponent(m.id)}`;
        }
      });
    });
    setStats({ groupCount: data.length });
  };

  const readLandmarkCache = () => {
    try {
      const raw = localStorage.getItem(LANDMARK_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.data || !Array.isArray(parsed.data)) return null;
      if (Date.now() - parsed.savedAt > LANDMARK_CACHE_TTL_MS) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  };

  const writeLandmarkCache = (data) => {
    try {
      localStorage.setItem(
        LANDMARK_CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), data })
      );
    } catch (e) {}
  };

  const cached = readLandmarkCache();
  if (cached) {
    renderLandmarks(normalizeLandmarks(cached));
  }

  await ensureAnonAuth();
  let landmarks = [];
  try {
    landmarks = await fetchLandmarks(true);
    writeLandmarkCache(landmarks);
  } catch (e) {
    console.warn("Failed to fetch landmarks, using defaults.", e);
  }

  const normalized = normalizeLandmarks(landmarks);
  renderLandmarks(normalized);
}

// --- Posts/auth/UI plumbing (kept as in your original file) ---
loginBtn.addEventListener("click", () => authDialog.showModal());
ctaLoginBtn.addEventListener("click", () => authDialog.showModal());
closeAuth.addEventListener("click", () => authDialog.close());

exploreBtn.addEventListener("click", () => document.getElementById("posts").scrollIntoView({ behavior: "smooth" }));
scrollMapBtn?.addEventListener("click", () => document.getElementById("map").scrollIntoView({ behavior: "smooth" }));

postSearchInput?.addEventListener("input", () => applyPostFilter());
clearPostSearch?.addEventListener("click", () => {
  if (!postSearchInput) return;
  postSearchInput.value = "";
  applyPostFilter();
  postSearchInput.focus();
});

menuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

document.querySelectorAll(".mobile-links a").forEach((link) =>
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    target?.scrollIntoView({ behavior: "smooth" });
    mobileMenu.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  })
);

mobileLoginBtn?.addEventListener("click", () => {
  authDialog.showModal();
  mobileMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

mobileLogoutBtn?.addEventListener("click", async () => {
  await logout();
  showToast("Logged out successfully.", "success");
  mobileMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

document.querySelectorAll(".nav a").forEach((link) =>
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    target?.scrollIntoView({ behavior: "smooth" });
  })
);

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
}

themeToggle?.addEventListener("click", toggleTheme);
mobileThemeToggle?.addEventListener("click", () => {
  toggleTheme();
  mobileMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!/\S+@\S+\.\S+/.test(email)) {
    showToast("Please enter a valid email address.", "warn");
    return;
  }
  if (password.length < 6) {
    showToast("Password must be at least 6 characters.", "warn");
    return;
  }
  try {
    await loginWithEmail(email, password);
    showToast("Logged in successfully.", "success");
    authDialog.close();
  } catch (err) {
    showToast("Email sign-in failed: " + err.message, "error");
  }
});

document.getElementById("createAccountBtn")?.addEventListener("click", () => {
  window.location.href = "signup.html";
});
logoutBtn?.addEventListener("click", async () => {
  await logout();
  showToast("Logged out successfully.", "success");
});

async function triggerPasswordReset() {
  if (!changePassDialog) return;
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  changePassDialog.showModal();
}

changePassBtn?.addEventListener("click", triggerPasswordReset);
mobileChangePassBtn?.addEventListener("click", () => {
  triggerPasswordReset();
  mobileMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

closeChangePass?.addEventListener("click", () => changePassDialog.close());

changePassForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = currentPassword.value.trim();
  const next = newPassword.value.trim();
  const confirm = confirmPassword.value.trim();
  if (!current || !next || !confirm) {
    showToast("Please fill in all password fields.", "warn");
    return;
  }
  if (next.length < 6) {
    showToast("New password must be at least 6 characters.", "warn");
    return;
  }
  if (next !== confirm) {
    showToast("New passwords do not match.", "warn");
    return;
  }
  try {
    await changePassword({ currentPassword: current, newPassword: next });
    showToast("Password updated successfully.", "success");
    changePassDialog.close();
  } catch (err) {
    showToast("Current password is incorrect.", "error");
  }
});

// Password toggle (login)
toggleLoginPass?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleLoginPass.textContent = isHidden ? "Hide" : "Show";
  toggleLoginPass.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

// Post UI (kept brief)
function bindUserToolbar() {
  if (!userToolbar) return;
  const buttons = Array.from(userToolbar.querySelectorAll("button"));
  const selects = Array.from(userToolbar.querySelectorAll("select"));
  const stateful = ["bold", "italic", "underline", "insertOrderedList", "insertUnorderedList", "justifyLeft", "justifyCenter", "justifyRight"];
  const focusEditor = () => userEditor?.focus({ preventScroll: true });
  const normalizeBlockValue = (value) => {
    if (!value) return value;
    if (value.startsWith("<")) return value;
    return `<${value}>`;
  };
  function updateStates() {
    buttons.forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (stateful.includes(cmd)) {
        const active = document.queryCommandState(cmd);
        btn.classList.toggle("active", !!active);
      }
    });
  }
  userToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;
    focusEditor();
    if (cmd === "createLink") {
      const url = prompt("Enter URL");
      if (url) document.execCommand(cmd, false, url);
    } else if (cmd === "formatBlock") {
      document.execCommand(cmd, false, normalizeBlockValue(value || "p"));
    } else {
      document.execCommand(cmd, false, value);
    }
    updateStates();
  });
  userToolbar.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  selects.forEach((sel) =>
    sel.addEventListener("change", () => {
      const cmd = sel.dataset.cmd;
      const value = sel.value || "";
      if (!cmd || !value) return;
      focusEditor();
      if (cmd === "formatBlock") {
        document.execCommand(cmd, false, normalizeBlockValue(value));
        return;
      }
      document.execCommand(cmd, false, value);
    })
  );
  userEditor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });
  userEditor.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (!["b", "i", "u"].includes(key)) return;
    e.preventDefault();
    focusEditor();
    if (key === "b") document.execCommand("bold");
    if (key === "i") document.execCommand("italic");
    if (key === "u") document.execCommand("underline");
    updateStates();
  });
  ["keyup", "mouseup", "blur"].forEach((evt) => userEditor.addEventListener(evt, updateStates));
}
bindUserToolbar();

function openUserPostDialog() {
  document.getElementById("userPostTitle").value = "";
  userEditor.innerHTML = "";
  userImageInput.value = "";
  imagePreviewUser.innerHTML = "";
  userPostDialog.showModal();
}
document.getElementById("createAccountBtn")?.addEventListener("click", () => window.location.href = "signup.html");
document.getElementById("newPostBtn")?.addEventListener("click", () => {
  const user = auth?.currentUser;
  if (!user) {
    showToast("Login to create a post.", "warn");
    authDialog.showModal();
    return;
  }
  openUserPostDialog();
});
closeUserPost?.addEventListener("click", () => {
  userPostDialog.close();
});

// show local previews for user dialog and enforce max images
userImageInput?.addEventListener("change", () => {
  const files = Array.from(userImageInput.files || []);
  // trim to allowed max
  const trimmed = files.slice(0, MAX_IMAGES_PER_POST);
  if (files.length > MAX_IMAGES_PER_POST) {
    showToast(`You can upload up to ${MAX_IMAGES_PER_POST} images. Only the first ${MAX_IMAGES_PER_POST} were selected.`, "warn");
  }
  // clear previous previews and create new ones
  imagePreviewUser.innerHTML = "";
  const objectUrls = [];
  trimmed.forEach((f) => {
    const url = URL.createObjectURL(f);
    objectUrls.push(url);
    const wrapper = document.createElement("div");
    wrapper.className = "preview-tile";
    wrapper.innerHTML = `<img src="${url}" alt="${f.name}" />`;
    imagePreviewUser.appendChild(wrapper);
  });
  // revoke object URLs when dialog closes or input changes again (we can't easily track removal per tile here)
  // revoke after a moment when likely not needed, or rely on reset/submit to revoke
  setTimeout(() => objectUrls.forEach((u) => URL.revokeObjectURL(u)), 60_000);
});

userSavePostBtn?.addEventListener("click", async () => {
  if (userPostSubmitting) return;
  const title = userPostTitle.value.trim();
  const content = normalizeContent(userEditor.innerHTML.trim());
  if (!title || !content) {
    showToast("Title and content are required.", "warn");
    return;
  }
  const user = auth?.currentUser;
  if (!user) {
    showToast("Login to publish.", "warn");
    return;
  }
  const authorName = await resolveAuthorName();
  userPostSubmitting = true;
  userSavePostBtn.textContent = "Publishing...";
  userSavePostBtn.disabled = true;

  // Upload multiple images if provided
  let media = [];
  const selected = Array.from(userImageInput.files || []).slice(0, MAX_IMAGES_PER_POST);
  if (selected.length) {
    try {
      media = await uploadImages(selected, {
        onProgress: (i, uploaded, total) => {
          userSavePostBtn.textContent = `Uploading ${uploaded}/${total}...`;
        },
      });
    } catch (e) {
      console.error("Image uploads failed:", e);
      showToast("One or more image uploads failed.", "warn");
    }
  }

  try {
    await savePost({ title, content, media, author: authorName, authorId: user.uid });
    showToast("Post published successfully.", "success");
    userPostDialog.close();
    await loadPosts();
  } catch (e) {
    showToast("Failed to publish: " + (e.message || e), "error");
  } finally {
    userPostSubmitting = false;
    userSavePostBtn.textContent = "Publish";
    userSavePostBtn.disabled = false;
    // cleanup previews and object URLs
    imagePreviewUser.innerHTML = "";
    userImageInput.value = "";
  }
});

async function loadPosts() {
  try {
    await ensureAnonAuth();
    const posts = await fetchPosts();
    allPostsCache = posts;
    applyPostFilter();
    setStats({
      postCount: posts.length || "--",
      lastUpdated: posts[0]?.updatedAt?.toDate?.().toLocaleDateString?.() || "N/A",
    });
  } catch (e) {
    showToast("Failed to load posts: " + e.message, "error");
  }
}

async function loadUserCount() {
  const cachedRaw = localStorage.getItem(USER_COUNT_CACHE_KEY);
  const cached = cachedRaw === null ? NaN : Number(cachedRaw);
  const hasCached = Number.isFinite(cached) && cached >= 0;
  try {
    await ensureAnonAuth();
    let { count, source } = await fetchUsersCount();

    // If public stats are stale at 0, recompute from /users for signed-in non-anonymous sessions.
    if (
      source === "stats" &&
      count === 0 &&
      auth?.currentUser &&
      auth.currentUser.isAnonymous !== true
    ) {
      const recalculated = await fetchUsersCount({ forceUsers: true });
      count = recalculated.count;
      source = recalculated.source;
    }

    if (Number.isFinite(count) && count >= 0) {
      if (source === "stats" && count === 0 && hasCached && cached > 0) {
        setStats({ userCount: cached });
      } else {
        setStats({ userCount: count });
        localStorage.setItem(USER_COUNT_CACHE_KEY, String(count));
      }
      if (source === "users" && auth?.currentUser && auth.currentUser.isAnonymous !== true) {
        try {
          await setPublicUserCount(count);
        } catch (e) {}
      }
    }
  } catch (e) {
    if (hasCached) setStats({ userCount: cached });
  }
}

observeAuth(async (user) => {
  const authed = !!user;
  loginBtn.classList.toggle("hidden", authed);
  logoutBtn.classList.toggle("hidden", !authed);
  profileBtn?.classList.toggle("hidden", !authed);
  changePassBtn?.classList.toggle("hidden", !authed);
  mobileLoginBtn?.classList.toggle("hidden", authed);
  mobileLogoutBtn?.classList.toggle("hidden", !authed);
  mobileProfileBtn?.classList.toggle("hidden", !authed);
  mobileChangePassBtn?.classList.toggle("hidden", !authed);
  const isAdminUser = isAdmin(user);
  newPostBtn.classList.toggle("hidden", !authed || isAdminUser);
  cachedAuthorName = null;

  // expose auth state for UI helpers (e.g., reactions gating)
  window.__currentUser = user || null;

  const adminSection = document.getElementById("adminPanel");
  if (authed && isAdminUser) {
    adminSection?.classList.remove("hidden");
    initAdmin(user);
  } else {
    adminSection?.classList.add("hidden");
  }

  // Re-evaluate user count when auth state changes so public stats can self-heal.
  loadUserCount();
});

// Listen for admin updates to refresh feed immediately
window.addEventListener("posts-updated", () => {
  loadPosts();
});

window.addEventListener("landmarks-updated", () => {
  loadLandmarksToMap();
});

// Initial Execution
initTheme();
initPolicyGate();
loadUserCount();
// Real-time posts
postsUnsub = observePosts((posts) => {
  allPostsCache = posts;
  applyPostFilter();
  setStats({
    postCount: posts.length || "--",
    lastUpdated: posts[0]?.updatedAt?.toDate?.().toLocaleDateString?.() || "N/A",
  });
});

ensureLeaflet()
  .then(initMap)
  .catch(() => showToast("Map library failed to load.", "error"));
