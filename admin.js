import {
  savePost,
  deletePost,
  fetchPosts,
  fetchPost,
  isAdmin,
  getAdminRoleLabel,
  canManagePosts,
  canManageLandmarks,
  getUserProfile,
  fetchUsers,
  fetchUsersCount,
  fetchLandmarks,
  saveLandmark,
  deleteLandmark,
} from "./auth.js";
import { uploadImages } from "./imgbb.js";
import { t } from "./i18n.js";
import { showToast } from "./ui.js";

const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const profileEditTools = document.getElementById("profileEditTools");
const landmarkWorkspace = document.getElementById("landmarkWorkspace");
const postTitle = document.getElementById("postTitle");
const imageInput = document.getElementById("imageInput");
const imagePreviewAdmin = document.getElementById("imagePreviewAdmin");
const editor = document.getElementById("richEditor");
const saveBtn = document.getElementById("savePostBtn");
const resetBtn = document.getElementById("resetPostBtn");
const listContainer = document.getElementById("adminPosts");
const landmarkName = document.getElementById("landmarkName");
const landmarkLat = document.getElementById("landmarkLat");
const landmarkLng = document.getElementById("landmarkLng");
const landmarkSummary = document.getElementById("landmarkSummary");
const landmarkCoverInput = document.getElementById("landmarkCoverInput");
const landmarkColor = document.getElementById("landmarkColor");
const saveLandmarkBtn = document.getElementById("saveLandmarkBtn");
const resetLandmarkBtn = document.getElementById("resetLandmarkBtn");
const landmarksList = document.getElementById("adminLandmarks");
const landmarkPickBtn = document.getElementById("landmarkPickBtn");
const landmarkMapEl = document.getElementById("landmarkMap");
const adminMetricPosts = document.getElementById("adminMetricPosts");
const adminMetricUsers = document.getElementById("adminMetricUsers");
const adminMetricLandmarks = document.getElementById("adminMetricLandmarks");
const adminMetricEngagement = document.getElementById("adminMetricEngagement");
const adminPostsChart = document.getElementById("adminPostsChart");
const adminUsersChart = document.getElementById("adminUsersChart");
const adminLandmarksChart = document.getElementById("adminLandmarksChart");
const adminEngagementChart = document.getElementById("adminEngagementChart");
const adminWorkspacePosts = document.getElementById("adminWorkspacePosts");
const adminWorkspaceLandmarks = document.getElementById("adminWorkspaceLandmarks");
const adminWorkspaceUpdated = document.getElementById("adminWorkspaceUpdated");
const adminPostsCount = document.getElementById("adminPostsCount");
const adminLandmarksCount = document.getElementById("adminLandmarksCount");

let currentId = null;
let currentUser = null;
let cachedAuthorName = null;
let currentMedia = [];
let currentPostAuthorId = null;
let currentPostAuthorName = null;
let currentLandmarkId = null;
let currentLandmarkCover = null;
let landmarkMap = null;
let landmarkMarker = null;
let pickingMode = false;
let toolbarBound = false;
let landmarkBindingsBound = false;
let chartBindingsBound = false;
let latestAdminChartPayload = null;

function autoResizeTextarea(textarea, maxHeight = 260) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function showPostsSkeleton(container, count = 3) {
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>Loading...</strong>
        <div class="chip">Please wait</div>
      </div>
    `;
    container.appendChild(item);
  }
}

function enhancePreviewImage(imgEl) {
  if (!imgEl) return;
  imgEl.loading = "lazy";
  imgEl.decoding = "async";
  imgEl.width = 96;
  imgEl.height = 96;
  imgEl.classList.add("progressive-image");

  const markReady = () => {
    imgEl.classList.remove("is-loading");
    imgEl.classList.add("is-ready");
  };

  if (imgEl.complete) {
    markReady();
    return;
  }

  imgEl.classList.add("is-loading");
  imgEl.addEventListener("load", markReady, { once: true });
  imgEl.addEventListener("error", () => imgEl.classList.remove("is-loading"), { once: true });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateValue(record, keys = []) {
  for (const key of keys) {
    const date = toDate(record?.[key]);
    if (date) return date;
  }
  return null;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatWorkspaceTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function updateAdminWorkspaceMeta({ postsCount, landmarksCount, updatedAt = new Date() } = {}) {
  if (typeof postsCount === "number") {
    const value = formatCompactNumber(postsCount);
    if (adminWorkspacePosts) adminWorkspacePosts.textContent = value;
    if (adminPostsCount) adminPostsCount.textContent = value;
  }
  if (typeof landmarksCount === "number") {
    const value = formatCompactNumber(landmarksCount);
    if (adminWorkspaceLandmarks) adminWorkspaceLandmarks.textContent = value;
    if (adminLandmarksCount) adminLandmarksCount.textContent = value;
  }
  if (adminWorkspaceUpdated) {
    adminWorkspaceUpdated.textContent = formatWorkspaceTimestamp(updatedAt);
  }
}

function buildDailySeries(items, resolveDate, days = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
    };
  });

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  (items || []).forEach((item) => {
    const date = resolveDate(item);
    if (!date) return;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const key = normalized.toISOString().slice(0, 10);
    const bucket = bucketMap.get(key);
    if (bucket) bucket.count += 1;
  });

  return buckets;
}

function renderMetric(element, value) {
  if (element) element.textContent = formatCompactNumber(value);
}

function renderLineChart(svgEl, series, { lineColor = "#5a9a6a", fillColor = "rgba(90, 154, 106, 0.16)" } = {}) {
  if (!svgEl) return;

  const width = 520;
  const height = 220;
  const padding = { top: 18, right: 16, bottom: 32, left: 24 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...series.map((item) => item.count), 0);

  if (!series.length || maxValue === 0) {
    svgEl.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="transparent"></rect>
      <text x="50%" y="50%" text-anchor="middle" fill="var(--muted)" font-size="14">${escapeHtml(t("chart_empty"))}</text>
    `;
    return;
  }

  const points = series.map((item, index) => {
    const x = padding.left + (index / Math.max(series.length - 1, 1)) * innerWidth;
    const y = padding.top + innerHeight - (item.count / maxValue) * innerHeight;
    return { x, y, label: item.label, value: item.count };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
  const xLabelIndexes = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const y = padding.top + innerHeight - ratio * innerHeight;
    const value = Math.round(ratio * maxValue);
    return `
      <line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="var(--border)" stroke-width="1" opacity="0.7"></line>
      <text x="${padding.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="var(--muted)" font-size="11">${value}</text>
    `;
  }).join("");

  const xLabels = xLabelIndexes
    .map((index) => {
      const point = points[index];
      return `<text x="${point.x.toFixed(2)}" y="${(height - 8).toFixed(2)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(point.label)}</text>`;
    })
    .join("");

  const dots = points
    .map(
      (point) => `
        <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5" fill="${lineColor}"></circle>
        <title>${escapeHtml(point.label)}: ${point.value}</title>
      `
    )
    .join("");

  svgEl.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="transparent"></rect>
    ${gridLines}
    <path d="${areaPath}" fill="${fillColor}"></path>
    <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    ${dots}
    ${xLabels}
  `;
}

function renderBarChart(container, items) {
  if (!container) return;
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  if (!items.length || maxValue === 0) {
    container.innerHTML = `<p class="admin-chart-empty">${escapeHtml(t("chart_empty"))}</p>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const width = Math.max((item.value / maxValue) * 100, item.value > 0 ? 8 : 0);
      return `
        <div class="admin-bar-row">
          <div class="admin-bar-copy">
            <span class="admin-bar-label">${escapeHtml(item.label)}</span>
            <strong>${formatCompactNumber(item.value)}</strong>
          </div>
          <div class="admin-bar-track">
            <span class="admin-bar-fill" style="width:${width}%; background:${item.color};"></span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAdminCharts(payload) {
  latestAdminChartPayload = payload;

  const {
    posts = [],
    landmarks = [],
    users = [],
    userCount = 0,
    totalLikes = 0,
    totalDislikes = 0,
  } = payload || {};

  const totalEngagement = totalLikes + totalDislikes;

  renderMetric(adminMetricPosts, posts.length);
  renderMetric(adminMetricUsers, userCount);
  renderMetric(adminMetricLandmarks, landmarks.length);
  renderMetric(adminMetricEngagement, totalEngagement);

  renderLineChart(
    adminPostsChart,
    buildDailySeries(posts, (item) => getDateValue(item, ["createdAt", "updatedAt"])),
    { lineColor: "#6c8968", fillColor: "rgba(108, 137, 104, 0.14)" }
  );
  renderLineChart(
    adminUsersChart,
    buildDailySeries(users, (item) => getDateValue(item, ["lastLoginAt", "createdAt"])),
    { lineColor: "#6e8088", fillColor: "rgba(110, 128, 136, 0.12)" }
  );
  renderLineChart(
    adminLandmarksChart,
    buildDailySeries(landmarks, (item) => getDateValue(item, ["createdAt", "updatedAt"])),
    { lineColor: "#a56b43", fillColor: "rgba(165, 107, 67, 0.12)" }
  );
  renderBarChart(adminEngagementChart, [
    { label: t("likes_label"), value: totalLikes, color: "#5a9a6a" },
    { label: t("dislikes_label"), value: totalDislikes, color: "#c36b2a" },
    { label: t("total_interactions"), value: totalEngagement, color: "#2f5c3a" },
  ]);
}

async function refreshAdminCharts({ posts = null, landmarks = null } = {}) {
  if (!adminMetricPosts && !adminPostsChart && !adminEngagementChart) return;

  const [resolvedPosts, resolvedLandmarks, userCountResult, users] = await Promise.all([
    posts ? Promise.resolve(posts) : fetchPosts(true),
    landmarks ? Promise.resolve(landmarks) : fetchLandmarks(true),
    fetchUsersCount(),
    fetchUsers(true),
  ]);

  const totalLikes = (resolvedPosts || []).reduce((sum, post) => sum + Math.max(0, Number(post.likes || 0)), 0);
  const totalDislikes = (resolvedPosts || []).reduce((sum, post) => sum + Math.max(0, Number(post.dislikes || 0)), 0);

  renderAdminCharts({
    posts: resolvedPosts || [],
    landmarks: resolvedLandmarks || [],
    users: users || [],
    userCount: userCountResult?.count ?? users?.length ?? 0,
    totalLikes,
    totalDislikes,
  });
}

/* Toolbar binding (uses document.execCommand for simple rich editor controls) */
function bindToolbar() {
  if (toolbarBound) return;
  const toolbar = adminPanel?.querySelector(".toolbar");
  const buttons = toolbar ? Array.from(toolbar.querySelectorAll("button")) : [];
  const selects = toolbar ? Array.from(toolbar.querySelectorAll("select")) : [];
  const stateful = [
    "bold",
    "italic",
    "underline",
    "insertOrderedList",
    "insertUnorderedList",
    "justifyLeft",
    "justifyCenter",
    "justifyRight",
  ];
  const focusEditor = () => editor?.focus({ preventScroll: true });
  const normalizeBlockValue = (value) => {
    if (!value) return value;
    if (value.startsWith("<")) return value;
    return `<${value}>`;
  };

  function updateStates() {
    buttons.forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (stateful.includes(cmd)) {
        try {
          const active = document.queryCommandState(cmd);
          btn.classList.toggle("active", !!active);
        } catch (e) {
          // some commands may throw in some browsers; ignore
        }
      }
    });
  }

  toolbar?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;
    focusEditor();
    if (cmd === "createLink") {
      const url = prompt("Enter URL (https://...)");
      if (url) document.execCommand(cmd, false, url);
    } else if (cmd === "formatBlock") {
      try {
        document.execCommand(cmd, false, normalizeBlockValue(value || "p"));
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    } else {
      try {
        document.execCommand(cmd, false, value);
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    }
    updateStates();
  });
  toolbar?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  selects.forEach((sel) =>
    sel.addEventListener("change", () => {
      const cmd = sel.dataset.cmd;
      const value = sel.value || "";
      if (!cmd || !value) return;
      focusEditor();
      if (cmd === "formatBlock") {
        try {
          document.execCommand(cmd, false, normalizeBlockValue(value));
        } catch (err) {
          console.warn("execCommand failed:", cmd, err);
        }
        return;
      }
      try {
        document.execCommand(cmd, false, value);
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    })
  );

  editor?.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });
  editor?.addEventListener("keydown", (e) => {
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

  ["keyup", "mouseup", "blur"].forEach((evt) =>
    editor?.addEventListener(evt, () => {
      updateStates();
    })
  );

  toolbarBound = true;
}

/* Resolve author name using profile, displayName, or email */
async function resolveAuthorName() {
  if (!currentUser) return "Contributor";
  if (isAdmin(currentUser)) return "Admin";
  if (cachedAuthorName) return cachedAuthorName;
  try {
    const profile = await getUserProfile(currentUser.uid);
    if (profile?.username) {
      cachedAuthorName = profile.username;
      return cachedAuthorName;
    }
  } catch (e) {
    console.warn("Profile lookup failed", e);
  }
  if (currentUser.displayName) {
    cachedAuthorName = currentUser.displayName;
    return cachedAuthorName;
  }
  if (currentUser.email) {
    cachedAuthorName = currentUser.email.split("@")[0];
    return cachedAuthorName;
  }
  return "Contributor";
}

/* Render admin preview tiles for existing media URLs */
function renderAdminPreviews(urls = []) {
  if (!imagePreviewAdmin) return;
  imagePreviewAdmin.innerHTML = "";
  urls.forEach((u, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-tile";
    wrapper.innerHTML = `<img src="${u}" alt="media ${idx + 1}" /><button class="remove" data-idx="${idx}" title="Remove image">✕</button>`;
    imagePreviewAdmin.appendChild(wrapper);
    enhancePreviewImage(wrapper.querySelector("img"));
  });
  // attach remove handlers
  imagePreviewAdmin.querySelectorAll(".remove").forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      currentMedia.splice(idx, 1);
      renderAdminPreviews(currentMedia);
    })
  );
}

/* When admin selects new files, show previews (object URLs). They will be uploaded on Save */
imageInput?.addEventListener("change", () => {
  const files = Array.from(imageInput.files || []);
  const trimmed = files.slice(0, 10);
  if (files.length > 10) {
    showToast("Only the first 10 selected images will be used.", "warn");
  }

  // First render existing media
  renderAdminPreviews(currentMedia);

  // Then append selected-file previews
  trimmed.forEach((f) => {
    const url = URL.createObjectURL(f);
    const wrapper = document.createElement("div");
    wrapper.className = "preview-tile";
    wrapper.innerHTML = `<img src="${url}" alt="${f.name}" />`;
    imagePreviewAdmin.appendChild(wrapper);
    enhancePreviewImage(wrapper.querySelector("img"));
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
});

/* Save handler: uploads newly selected files and merges with existing media */
async function handleSave() {
  const title = postTitle.value.trim();
  const content = normalizeContent(editor.innerHTML.trim());
  if (!title || !content) return showToast("Title and content are required", "warn");

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const selectedFiles = Array.from(imageInput.files || []);
    let uploadedUrls = [];
    if (selectedFiles.length) {
      uploadedUrls = await uploadImages(selectedFiles, {
        onProgress: (i, uploaded, total) => {
          saveBtn.textContent = `Uploading ${uploaded}/${total}...`;
        },
      });
    }

    // Merge preserved currentMedia with uploadedUrls; enforce cap
    const media = [...currentMedia, ...uploadedUrls].slice(0, 10);

    const authorName = currentId
      ? (currentPostAuthorName || await resolveAuthorName())
      : await resolveAuthorName();
    const authorId = currentId
      ? currentPostAuthorId
      : (currentUser?.uid || null);

    await savePost({
      id: currentId,
      title,
      content,
      media,
      author: authorName,
      authorId,
    });

    showToast(currentId ? "Post updated successfully." : "Post published successfully.", "success");
    
    // CRITICAL: Force server read to ensure fresh data
    const posts = await loadAdminPosts();
    await refreshAdminCharts({ posts });
    window.dispatchEvent(new Event("posts-updated"));
    resetForm();
  } catch (e) {
    console.error("Save failed — full error:", e);
    showToast("Save failed: " + (e?.code ? `${e.code} — ${e.message}` : (e.message || e)), "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Publish / Update";
  }
}

function resetForm() {
  currentId = null;
  currentMedia = [];
  currentPostAuthorId = null;
  currentPostAuthorName = null;
  postTitle.value = "";
  editor.innerHTML = "";
  imageInput.value = "";
  if (imagePreviewAdmin) imagePreviewAdmin.innerHTML = "";
}

function normalizeContent(html) {
  if (!html) return "";
  const hasTags = /<\s*(p|div|br|ul|ol|li|blockquote|h\d)\b/i.test(html);
  if (!hasTags && html.includes("\n")) {
    return html.replace(/\n/g, "<br>");
  }
  return html;
}

function resetLandmarkForm() {
  currentLandmarkId = null;
  currentLandmarkCover = null;
  if (landmarkName) landmarkName.value = "";
  if (landmarkLat) landmarkLat.value = "";
  if (landmarkLng) landmarkLng.value = "";
  if (landmarkSummary) landmarkSummary.value = "";
  autoResizeTextarea(landmarkSummary);
  if (landmarkCoverInput) landmarkCoverInput.value = "";
  if (landmarkColor) landmarkColor.value = "#2f5c3a";
  if (landmarkMarker && landmarkMap) {
    landmarkMap.removeLayer(landmarkMarker);
    landmarkMarker = null;
  }
  if (landmarkMap) {
    landmarkMap.setView([12.8797, 121.7740], 6);
  }
  pickingMode = false;
  if (landmarkPickBtn) landmarkPickBtn.classList.remove("active");
}

function setLandmarkMarker(lat, lng, pan = true) {
  if (!landmarkMap || !isFinite(lat) || !isFinite(lng)) return;
  if (!landmarkMarker) {
    landmarkMarker = L.marker([lat, lng]).addTo(landmarkMap);
  } else {
    landmarkMarker.setLatLng([lat, lng]);
  }
  if (pan) landmarkMap.setView([lat, lng], landmarkMap.getZoom() || 11);
}

async function ensureLeaflet() {
  if (window.L) return;
  await new Promise((resolve, reject) => {
    const existing = document.getElementById("leaflet-fallback");
    if (existing) {
      existing.addEventListener("load", resolve);
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
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initLandmarkMap() {
  if (!landmarkMapEl) return;
  await ensureLeaflet();
  landmarkMapEl.innerHTML = "";
  if (landmarkMap) {
    landmarkMap.remove();
    landmarkMap = null;
    landmarkMarker = null;
  }
  landmarkMap = L.map(landmarkMapEl, {
    zoomControl: true,
    attributionControl: false,
  }).setView([12.8797, 121.7740], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(landmarkMap);

  landmarkMap.on("move", () => {
    if (!pickingMode) return;
    const center = landmarkMap.getCenter();
    if (landmarkLat) landmarkLat.value = center.lat.toFixed(6);
    if (landmarkLng) landmarkLng.value = center.lng.toFixed(6);
    setLandmarkMarker(center.lat, center.lng, false);
  });

  // if inputs already have values (non-empty), show marker
  const latRaw = landmarkLat?.value;
  const lngRaw = landmarkLng?.value;
  if (latRaw !== "" && lngRaw !== "") {
    const latVal = Number(latRaw);
    const lngVal = Number(lngRaw);
    if (isFinite(latVal) && isFinite(lngVal)) {
      setLandmarkMarker(latVal, lngVal);
    }
  }
}

async function handleSaveLandmark() {
  const name = landmarkName?.value.trim();
  const latRaw = landmarkLat?.value;
  const lngRaw = landmarkLng?.value;
  const lat = latRaw !== "" ? Number(latRaw) : NaN;
  const lng = lngRaw !== "" ? Number(lngRaw) : NaN;
  const summary = landmarkSummary?.value.trim() || "";
  const color = landmarkColor?.value || "#2f5c3a";
  if (!name || !isFinite(lat) || !isFinite(lng)) {
    return showToast("Name, latitude, and longitude are required.", "warn");
  }
  saveLandmarkBtn.disabled = true;
  saveLandmarkBtn.textContent = "Saving...";
  try {
    let coverUrl = currentLandmarkCover || null;
    if (landmarkCoverInput?.files?.length) {
      const [file] = landmarkCoverInput.files;
      const uploaded = await uploadImages([file]);
      coverUrl = uploaded[0] || coverUrl;
    }
    await saveLandmark({ id: currentLandmarkId, name, lat, lng, summary, coverUrl, color });
    showToast(currentLandmarkId ? "Landmark updated successfully." : "Landmark added successfully.", "success");
    
    // CRITICAL: Force server read to ensure fresh data
    const landmarks = await loadLandmarks();
    await refreshAdminCharts({ landmarks });
    window.dispatchEvent(new Event("landmarks-updated"));
    resetLandmarkForm();
  } catch (e) {
    console.error("Save landmark failed", e);
    showToast("Save failed: " + (e.message || e), "error");
  } finally {
    saveLandmarkBtn.disabled = false;
    saveLandmarkBtn.textContent = "Save Landmark";
  }
}

async function loadLandmarks() {
  if (!landmarksList) return;
  landmarksList.innerHTML = "Loading...";
  try {
    // CRITICAL: Force server read for production P2P reliability
    const items = await fetchLandmarks(true);
    updateAdminWorkspaceMeta({ landmarksCount: items.length });
    if (!items.length) {
      landmarksList.innerHTML = "<p class='hint'>No landmarks yet.</p>";
      return [];
    }
    landmarksList.innerHTML = "";
    items.forEach((l) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div>
          <strong>${l.name || "Unnamed"}</strong>
          <div class="chip">${Number(l.lat).toFixed(5)}, ${Number(l.lng).toFixed(5)}</div>
        </div>
        <div class="list-actions">
          <button data-id="${l.id}" class="ghost small edit-landmark">Edit</button>
          <button data-id="${l.id}" class="ghost small delete-landmark">Delete</button>
        </div>
      `;
      landmarksList.appendChild(item);
    });

    landmarksList.querySelectorAll(".edit-landmark").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const item = items.find((it) => it.id === id);
        if (!item) return;
        currentLandmarkId = id;
        landmarkName.value = item.name || "";
        landmarkLat.value = item.lat ?? "";
        landmarkLng.value = item.lng ?? "";
        landmarkSummary.value = item.summary || "";
        autoResizeTextarea(landmarkSummary);
        currentLandmarkCover = item.coverUrl || null;
        if (landmarkColor) landmarkColor.value = item.color || "#2f5c3a";
        setLandmarkMarker(Number(item.lat), Number(item.lng));
      })
    );

    landmarksList.querySelectorAll(".delete-landmark").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete this landmark?")) return;
        try {
          await deleteLandmark(id);
          showToast("Landmark deleted successfully.", "success");
          // CRITICAL: Force server read after delete
          const landmarks = await loadLandmarks();
          await refreshAdminCharts({ landmarks });
          window.dispatchEvent(new Event("landmarks-updated"));
        } catch (e) {
          console.error("Delete landmark failed", e);
          showToast("Delete failed: " + (e.message || e), "error");
        }
      })
    );
    return items;
  } catch (e) {
    console.error("Load landmarks failed", e);
    landmarksList.innerHTML = "<p class='hint'>Unable to load landmarks.</p>";
    showToast("Failed to load landmarks: " + (e.message || e), "error");
    return [];
  }
}

/* Load admin posts and populate list with Edit/Delete handlers */
async function loadAdminPosts() {
  if (!listContainer) return;
  showPostsSkeleton(listContainer, 3);
  try {
    // CRITICAL: Force server read for production P2P reliability
    const posts = await fetchPosts(true);
    updateAdminWorkspaceMeta({ postsCount: posts?.length || 0 });
    if (!posts || posts.length === 0) {
      listContainer.innerHTML = "<p class='hint'>No posts yet.</p>";
      return [];
    }
    listContainer.innerHTML = "";
    posts.forEach((p) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div>
          <strong>${p.title || "Untitled"}</strong>
          <div class="chip">${p.author || "Unknown"}</div>
        </div>
        <div class="list-actions">
          <button data-id="${p.id}" class="ghost small edit">Edit</button>
          <button data-id="${p.id}" class="ghost small delete">Delete</button>
        </div>
      `;
      listContainer.appendChild(item);
    });

    // wire edit buttons
    listContainer.querySelectorAll(".edit").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          // CRITICAL: Force server read for edit to get fresh data
          const post = await fetchPost(id, true);
          if (!post) {
            showToast("Post not found.", "warn");
            return;
          }
          currentId = id;
          currentPostAuthorId = post.authorId ?? null;
          currentPostAuthorName = post.author || null;
          postTitle.value = post.title || "";
          editor.innerHTML = post.content || "";
          currentMedia = Array.isArray(post.media) ? post.media.slice() : (post.coverUrl ? [post.coverUrl] : []);
          renderAdminPreviews(currentMedia);
          // scroll to editor for convenience
          adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
          console.error("Failed to fetch post for edit:", e);
          showToast("Failed to load post for editing: " + (e.message || e), "error");
        }
      })
    );

    // wire delete buttons
    listContainer.querySelectorAll(".delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete this post?")) return;
        try {
          await deletePost(id);
          showToast("Post deleted successfully.", "success");
          // CRITICAL: Force server read after delete
          const posts = await loadAdminPosts();
          await refreshAdminCharts({ posts });
          window.dispatchEvent(new Event("posts-updated"));
        } catch (e) {
          console.error("Delete failed — full error:", e);
          showToast("Delete failed: " + (e?.code ? `${e.code} — ${e.message}` : (e.message || e)), "error");
        }
      })
    );
    return posts;
  } catch (e) {
    console.error("Load posts failed:", e);
    listContainer.innerHTML = "<p class='hint'>Unable to load posts right now.</p>";
    showToast("Failed to load posts: " + (e.message || e), "error");
    return [];
  }
}

export async function initAdmin(user) {
  currentUser = user;
  const canAdmin = isAdmin(user);
  const postToolsAllowed = canManagePosts(user);
  const landmarkToolsAllowed = canManageLandmarks(user);
  const roleLabel = getAdminRoleLabel(user);
  adminStatus.textContent = canAdmin ? `${roleLabel} access granted` : "Restricted";
  if (adminStatus?.previousElementSibling) {
    adminStatus.previousElementSibling.style.background = canAdmin ? "var(--signal-success)" : "var(--signal-danger)";
  }
  if (!canAdmin) {
    adminPanel.classList.add("hidden");
    return;
  }
  adminPanel.classList.remove("hidden");
  profileEditTools?.classList.toggle("hidden", !postToolsAllowed);
  landmarkWorkspace?.classList.toggle("hidden", !landmarkToolsAllowed);

  if (!chartBindingsBound) {
    window.addEventListener("language-changed", () => {
      if (latestAdminChartPayload) renderAdminCharts(latestAdminChartPayload);
    });
    chartBindingsBound = true;
  }

  // Initialize toolbar and handlers
  if (postToolsAllowed) {
    bindToolbar();
    saveBtn.onclick = handleSave;
    resetBtn.onclick = resetForm;
  } else {
    saveBtn.onclick = null;
    resetBtn.onclick = null;
  }

  let posts = [];
  if (postToolsAllowed) {
    try {
      posts = await loadAdminPosts();
    } catch (error) {
      console.error("Admin posts bootstrap failed:", error);
      showToast("Failed to load admin posts.", "error");
    }
  }

  // landmarks panel (if present)
  if (landmarkToolsAllowed && saveLandmarkBtn && resetLandmarkBtn && landmarksList) {
    saveLandmarkBtn.onclick = handleSaveLandmark;
    resetLandmarkBtn.onclick = resetLandmarkForm;
    if (!landmarkBindingsBound) {
      autoResizeTextarea(landmarkSummary);
      landmarkSummary?.addEventListener("input", () => autoResizeTextarea(landmarkSummary));
      landmarkPickBtn?.addEventListener("click", () => {
        pickingMode = !pickingMode;
        landmarkPickBtn.classList.toggle("active", pickingMode);
        landmarkMapEl?.classList.toggle("picking", pickingMode);
        showToast(pickingMode ? "Click the map to select a location." : "Map selection off.", "info");
        if (pickingMode && landmarkMap) {
          const center = landmarkMap.getCenter();
          if (landmarkLat) landmarkLat.value = center.lat.toFixed(6);
          if (landmarkLng) landmarkLng.value = center.lng.toFixed(6);
          setLandmarkMarker(center.lat, center.lng, false);
        }
      });
      landmarkLat?.addEventListener("change", () => {
        const latRaw = landmarkLat.value;
        const lngRaw = landmarkLng?.value;
        if (latRaw === "" || lngRaw === "") {
          if (landmarkMarker && landmarkMap) {
            landmarkMap.removeLayer(landmarkMarker);
            landmarkMarker = null;
          }
          return;
        }
        const lat = Number(latRaw);
        const lng = Number(lngRaw);
        if (isFinite(lat) && isFinite(lng)) setLandmarkMarker(lat, lng);
      });
      landmarkLng?.addEventListener("change", () => {
        const latRaw = landmarkLat?.value;
        const lngRaw = landmarkLng.value;
        if (latRaw === "" || lngRaw === "") {
          if (landmarkMarker && landmarkMap) {
            landmarkMap.removeLayer(landmarkMarker);
            landmarkMarker = null;
          }
          return;
        }
        const lat = Number(latRaw);
        const lng = Number(lngRaw);
        if (isFinite(lat) && isFinite(lng)) setLandmarkMarker(lat, lng);
      });
      landmarkBindingsBound = true;
    }
    try {
      await initLandmarkMap();
    } catch (error) {
      console.error("Admin landmark map failed to initialize:", error);
      showToast("Failed to load the admin map.", "error");
    }

    let landmarks = [];
    try {
      landmarks = await loadLandmarks();
    } catch (error) {
      console.error("Admin landmarks bootstrap failed:", error);
      showToast("Failed to load landmarks.", "error");
    }

    try {
      await refreshAdminCharts({ posts, landmarks });
    } catch (error) {
      console.error("Admin charts bootstrap failed:", error);
      showToast("Failed to load data charts.", "error");
    }
    return;
  }

  try {
    await refreshAdminCharts({ posts, landmarks: [] });
  } catch (error) {
    console.error("Admin charts bootstrap failed:", error);
    showToast("Failed to load data charts.", "error");
  }
}
