import {
  observeAuth,
  logout,
  changePassword,
  getUserProfile,
  isAdmin,
  fetchPosts,
  fetchLandmarks,
  fetchUsers,
  fetchEmergencyAlerts,
} from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";
import { initAdminEmergencyNotifications } from "./admin-emergency-notifications.js";

const themeToggle = document.getElementById("themeToggle");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const logoutBtn = document.getElementById("logoutBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const changePassBtn = document.getElementById("changePassBtn");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");

const metricHistoryTopLabel = document.getElementById("metricHistoryTopLabel");
const metricHistoryTitle = document.getElementById("metricHistoryTitle");
const metricHistoryNote = document.getElementById("metricHistoryNote");
const metricHistoryRange = document.getElementById("metricHistoryRange");
const metricHistoryUpdated = document.getElementById("metricHistoryUpdated");
const metricHistoryTotal = document.getElementById("metricHistoryTotal");
const metricHistoryCount = document.getElementById("metricHistoryCount");
const metricHistorySectionTitle = document.getElementById("metricHistorySectionTitle");
const metricHistorySectionNote = document.getElementById("metricHistorySectionNote");
const metricHistoryList = document.getElementById("metricHistoryList");

const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

const THEME_KEY = "bicol-ip-theme";
const RANGE_CONFIG = {
  "7": { days: 7, labelKey: "range_7_days" },
  "30": { days: 30, labelKey: "range_30_days" },
  "90": { days: 90, labelKey: "range_90_days" },
  all: { days: null, labelKey: "range_all_time" },
};

const urlParams = new URLSearchParams(window.location.search);
const currentMetric = urlParams.get("metric") || "posts";
const currentRange = RANGE_CONFIG[urlParams.get("range")] ? urlParams.get("range") : "all";
let lastMetaState = { totalCount: 0, updatedAt: null };

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
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

function formatHistoryTimestamp(date) {
  const parsed = toDate(date);
  if (!parsed) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function getRangeLabel(range = currentRange) {
  return t(RANGE_CONFIG[range]?.labelKey || RANGE_CONFIG.all.labelKey);
}

function getRangeStart(range = currentRange) {
  const days = RANGE_CONFIG[range]?.days ?? null;
  if (!days) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function filterItemsByRange(items, keys = [], range = currentRange) {
  const start = getRangeStart(range);
  if (!start) return [...(items || [])];

  return (items || []).filter((item) => {
    const date = getDateValue(item, keys);
    if (!date) return false;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized >= start;
  });
}

function getMetricTitle(metric) {
  switch (metric) {
    case "posts":
      return t("community_posts_label");
    case "users":
      return t("stat_users");
    case "landmarks":
      return t("mapped_landmarks_label");
    case "engagement":
      return t("engagement_label");
    case "emergencies":
      return t("emergency_alerts_label");
    default:
      return t("metric_history_title");
  }
}

function getMetricNote(metric) {
  switch (metric) {
    case "posts":
      return t("metric_history_posts_note");
    case "users":
      return t("metric_history_users_note");
    case "landmarks":
      return t("metric_history_landmarks_note");
    case "engagement":
      return t("metric_history_engagement_note");
    case "emergencies":
      return t("metric_history_emergencies_note");
    default:
      return t("metric_history_note");
  }
}

function sortByDate(items, keys) {
  return [...items].sort((a, b) => {
    const aTime = getDateValue(a, keys)?.getTime() || 0;
    const bTime = getDateValue(b, keys)?.getTime() || 0;
    return bTime - aTime;
  });
}

function renderMeta(totalCount, updatedAt) {
  lastMetaState = { totalCount, updatedAt };
  if (metricHistoryTopLabel) metricHistoryTopLabel.textContent = getMetricTitle(currentMetric);
  if (metricHistoryTitle) metricHistoryTitle.textContent = getMetricTitle(currentMetric);
  if (metricHistorySectionTitle) metricHistorySectionTitle.textContent = getMetricTitle(currentMetric);
  if (metricHistoryNote) metricHistoryNote.textContent = getMetricNote(currentMetric);
  if (metricHistorySectionNote) metricHistorySectionNote.textContent = getMetricNote(currentMetric);
  if (metricHistoryRange) metricHistoryRange.textContent = getRangeLabel(currentRange);
  if (metricHistoryUpdated) metricHistoryUpdated.textContent = formatHistoryTimestamp(updatedAt);
  if (metricHistoryTotal) metricHistoryTotal.textContent = formatCompactNumber(totalCount);
  if (metricHistoryCount) metricHistoryCount.textContent = formatCompactNumber(totalCount);
}

function renderEmpty() {
  if (!metricHistoryList) return;
  metricHistoryList.innerHTML = `<p class="admin-history-empty">${escapeHtml(t("metric_history_empty"))}</p>`;
}

function renderPosts(posts) {
  const entries = sortByDate(filterItemsByRange(posts, ["updatedAt", "createdAt"]), ["updatedAt", "createdAt"]);
  renderMeta(entries.length, entries[0] ? getDateValue(entries[0], ["updatedAt", "createdAt"]) : null);
  if (!entries.length) return renderEmpty();
  metricHistoryList.innerHTML = entries.map((entry) => `
    <a class="admin-history-item admin-history-item-link" href="posts.html?post=${encodeURIComponent(entry.id)}#posts">
      <div class="admin-history-head">
        <h5>${escapeHtml(entry.title || t("untitled_post"))}</h5>
        <span class="admin-history-badge">${formatCompactNumber((entry.likes || 0) + (entry.dislikes || 0))}</span>
      </div>
      <div class="admin-history-meta">
        <span>${escapeHtml(entry.author || t("contributor"))}</span>
        <span>${formatHistoryTimestamp(getDateValue(entry, ["updatedAt", "createdAt"]))}</span>
      </div>
      <p class="admin-history-copy">${escapeHtml((entry.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || t("metric_history_no_summary"))}</p>
    </a>
  `).join("");
}

function renderUsers(users) {
  const entries = sortByDate(filterItemsByRange(users, ["lastLoginAt", "createdAt"]), ["lastLoginAt", "createdAt"]);
  renderMeta(entries.length, entries[0] ? getDateValue(entries[0], ["lastLoginAt", "createdAt"]) : null);
  if (!entries.length) return renderEmpty();
  metricHistoryList.innerHTML = entries.map((entry) => `
    <article class="admin-history-item">
      <div class="admin-history-head">
        <h5>${escapeHtml(entry.username || "--")}</h5>
        <span class="admin-history-badge is-info">${escapeHtml(t("profile"))}</span>
      </div>
      <div class="admin-history-meta">
        <span>${escapeHtml(entry.email || "--")}</span>
        <span>${formatHistoryTimestamp(getDateValue(entry, ["lastLoginAt", "createdAt"]))}</span>
      </div>
    </article>
  `).join("");
}

function renderLandmarks(landmarks) {
  const entries = sortByDate(filterItemsByRange(landmarks, ["updatedAt", "createdAt"]), ["updatedAt", "createdAt"]);
  renderMeta(entries.length, entries[0] ? getDateValue(entries[0], ["updatedAt", "createdAt"]) : null);
  if (!entries.length) return renderEmpty();
  metricHistoryList.innerHTML = entries.map((entry) => `
    <a class="admin-history-item admin-history-item-link" href="landmark.html?id=${encodeURIComponent(entry.id)}">
      <div class="admin-history-head">
        <h5>${escapeHtml(entry.name || "--")}</h5>
        <span class="admin-history-badge">${escapeHtml(t("landmark"))}</span>
      </div>
      <div class="admin-history-meta">
        <span>${formatHistoryTimestamp(getDateValue(entry, ["updatedAt", "createdAt"]))}</span>
        <span>${Number(entry.lat).toFixed(4)}, ${Number(entry.lng).toFixed(4)}</span>
      </div>
      <p class="admin-history-copy">${escapeHtml(String(entry.summary || "").trim().slice(0, 220) || t("metric_history_no_summary"))}</p>
    </a>
  `).join("");
}

function renderEngagement(posts) {
  const entries = filterItemsByRange(posts, ["updatedAt", "createdAt"]);
  const likes = entries.reduce((sum, post) => sum + Math.max(0, Number(post.likes || 0)), 0);
  const dislikes = entries.reduce((sum, post) => sum + Math.max(0, Number(post.dislikes || 0)), 0);
  const total = likes + dislikes;
  const topPosts = [...entries]
    .sort((a, b) => {
      const engagementA = Math.max(0, Number(a.likes || 0)) + Math.max(0, Number(a.dislikes || 0));
      const engagementB = Math.max(0, Number(b.likes || 0)) + Math.max(0, Number(b.dislikes || 0));
      if (engagementB !== engagementA) return engagementB - engagementA;
      const dateA = getDateValue(a, ["updatedAt", "createdAt"])?.getTime() || 0;
      const dateB = getDateValue(b, ["updatedAt", "createdAt"])?.getTime() || 0;
      return dateB - dateA;
    })
    .slice(0, 10);

  renderMeta(total, topPosts[0] ? getDateValue(topPosts[0], ["updatedAt", "createdAt"]) : null);
  metricHistoryList.innerHTML = `
    <div class="admin-history-split">
      <article class="admin-history-summary">
        <span class="admin-history-badge">${escapeHtml(t("likes_label"))}</span>
        <strong>${formatCompactNumber(likes)}</strong>
      </article>
      <article class="admin-history-summary">
        <span class="admin-history-badge is-warn">${escapeHtml(t("dislikes_label"))}</span>
        <strong>${formatCompactNumber(dislikes)}</strong>
      </article>
      <article class="admin-history-summary">
        <span class="admin-history-badge is-info">${escapeHtml(t("total_interactions"))}</span>
        <strong>${formatCompactNumber(total)}</strong>
      </article>
    </div>
    ${
      topPosts.length
        ? topPosts.map((post) => {
            const likesCount = Math.max(0, Number(post.likes || 0));
            const dislikesCount = Math.max(0, Number(post.dislikes || 0));
            return `
              <a class="admin-history-item admin-history-item-link" href="posts.html?post=${encodeURIComponent(post.id)}#posts">
                <div class="admin-history-head">
                  <h5>${escapeHtml(post.title || t("untitled_post"))}</h5>
                  <span class="admin-history-badge is-info">${formatCompactNumber(likesCount + dislikesCount)}</span>
                </div>
                <div class="admin-history-meta">
                  <span>${escapeHtml(t("likes_label"))}: ${formatCompactNumber(likesCount)}</span>
                  <span>${escapeHtml(t("dislikes_label"))}: ${formatCompactNumber(dislikesCount)}</span>
                  <span>${escapeHtml(post.author || t("contributor"))}</span>
                </div>
              </a>
            `;
          }).join("")
        : `<p class="admin-history-empty">${escapeHtml(t("metric_history_empty"))}</p>`
    }
  `;
}

function renderEmergencies(alerts) {
  const entries = sortByDate(filterItemsByRange(alerts, ["submittedAt", "updatedAt"]), ["submittedAt", "updatedAt"]);
  renderMeta(entries.length, entries[0] ? getDateValue(entries[0], ["submittedAt", "updatedAt"]) : null);
  if (!entries.length) return renderEmpty();
  metricHistoryList.innerHTML = entries.map((entry) => `
    <article class="admin-history-item">
      <div class="admin-history-head">
        <h5>${escapeHtml(entry.username || entry.email || "--")}</h5>
      </div>
      <div class="admin-history-meta">
        <span>${escapeHtml(entry.email || "--")}</span>
        <span>${formatHistoryTimestamp(getDateValue(entry, ["submittedAt", "updatedAt"]))}</span>
      </div>
      <p class="admin-history-copy">${escapeHtml(String(entry.message || "").trim().slice(0, 220) || t("metric_history_no_summary"))}</p>
    </article>
  `).join("");
}

async function loadMetricHistory() {
  switch (currentMetric) {
    case "posts":
      return renderPosts(await fetchPosts(true));
    case "users":
      return renderUsers(await fetchUsers(true));
    case "landmarks":
      return renderLandmarks(await fetchLandmarks(true));
    case "engagement":
      return renderEngagement(await fetchPosts(true));
    case "emergencies":
      return renderEmergencies(await fetchEmergencyAlerts(true));
    default:
      renderMeta(0, null);
      return renderEmpty();
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

logoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (error) {
    showToast(t("toast_logout_failed", { error: error.message || error }), "error");
  }
});

mobileLogoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (error) {
    showToast(t("toast_logout_failed", { error: error.message || error }), "error");
  }
});

function triggerPasswordReset() {
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  changePassDialog.showModal();
}

changePassBtn?.addEventListener("click", triggerPasswordReset);
mobileChangePassBtn?.addEventListener("click", () => {
  triggerPasswordReset();
  mobileMenu?.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
});

closeChangePass?.addEventListener("click", () => changePassDialog.close());

changePassForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = currentPassword.value.trim();
  const next = newPassword.value.trim();
  const confirm = confirmPassword.value.trim();

  if (!current || !next || !confirm) {
    showToast(t("toast_fill_password_fields"), "warn");
    return;
  }
  if (next.length < 6) {
    showToast(t("toast_new_pass_short"), "warn");
    return;
  }
  if (next !== confirm) {
    showToast(t("toast_pass_not_match"), "warn");
    return;
  }

  try {
    await changePassword({ currentPassword: current, newPassword: next });
    showToast(t("toast_pass_updated"), "success");
    changePassDialog.close();
  } catch {
    showToast(t("toast_current_pass_wrong"), "error");
  }
});

window.addEventListener("language-changed", () => {
  renderMeta(lastMetaState.totalCount, lastMetaState.updatedAt);
});

observeAuth(async (user) => {
  if (!user || !isAdmin(user)) {
    window.location.href = "profile.html";
    return;
  }

  try {
    await getUserProfile(user.uid);
    await loadMetricHistory();
  } catch (error) {
    console.error("Failed to load metric history:", error);
    renderEmpty();
    showToast(t("profile_load_error"), "error");
  }
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
initAdminEmergencyNotifications();
