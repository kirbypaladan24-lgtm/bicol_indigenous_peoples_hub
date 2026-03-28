import {
  observeAuth,
  logout,
  changePassword,
  getUserProfile,
  isAdmin,
  fetchPosts,
  fetchLandmarks,
  fetchUsers,
  fetchUsersCount,
} from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";

const themeToggle = document.getElementById("themeToggle");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const logoutBtn = document.getElementById("logoutBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const changePassBtn = document.getElementById("changePassBtn");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");

const chartsStatus = document.getElementById("chartsStatus");
const chartUsername = document.getElementById("chartUsername");
const chartEmail = document.getElementById("chartEmail");
const chartRole = document.getElementById("chartRole");
const adminMetricPosts = document.getElementById("adminMetricPosts");
const adminMetricUsers = document.getElementById("adminMetricUsers");
const adminMetricLandmarks = document.getElementById("adminMetricLandmarks");
const adminMetricEngagement = document.getElementById("adminMetricEngagement");
const adminPostsChart = document.getElementById("adminPostsChart");
const adminUsersChart = document.getElementById("adminUsersChart");
const adminLandmarksChart = document.getElementById("adminLandmarksChart");
const adminEngagementChart = document.getElementById("adminEngagementChart");

const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

const THEME_KEY = "bicol-ip-theme";
let latestChartPayload = null;
let currentIdentity = null;

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

function renderIdentity(identity) {
  currentIdentity = identity;
  if (chartUsername) chartUsername.textContent = identity?.username || "--";
  if (chartEmail) chartEmail.textContent = identity?.email || "--";
  if (chartRole) chartRole.textContent = t("administrator_role");
}

function renderCharts(payload) {
  latestChartPayload = payload;

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
    { lineColor: "#5a9a6a", fillColor: "rgba(90, 154, 106, 0.16)" }
  );
  renderLineChart(
    adminUsersChart,
    buildDailySeries(users, (item) => getDateValue(item, ["lastLoginAt", "createdAt"])),
    { lineColor: "#2b7bff", fillColor: "rgba(43, 123, 255, 0.14)" }
  );
  renderLineChart(
    adminLandmarksChart,
    buildDailySeries(landmarks, (item) => getDateValue(item, ["createdAt", "updatedAt"])),
    { lineColor: "#c36b2a", fillColor: "rgba(195, 107, 42, 0.14)" }
  );
  renderBarChart(adminEngagementChart, [
    { label: t("likes_label"), value: totalLikes, color: "#5a9a6a" },
    { label: t("dislikes_label"), value: totalDislikes, color: "#c36b2a" },
    { label: t("total_interactions"), value: totalEngagement, color: "#2f5c3a" },
  ]);
}

async function loadCharts() {
  if (chartsStatus) chartsStatus.textContent = t("loading_workspace");

  const [posts, landmarks, users, userCountResult] = await Promise.all([
    fetchPosts(true),
    fetchLandmarks(true),
    fetchUsers(true),
    fetchUsersCount(),
  ]);

  const totalLikes = posts.reduce((sum, post) => sum + Math.max(0, Number(post.likes || 0)), 0);
  const totalDislikes = posts.reduce((sum, post) => sum + Math.max(0, Number(post.dislikes || 0)), 0);

  renderCharts({
    posts,
    landmarks,
    users,
    userCount: userCountResult?.count ?? users.length,
    totalLikes,
    totalDislikes,
  });

  if (chartsStatus) chartsStatus.textContent = t("data_charts_subtitle");
}

async function triggerPasswordReset() {
  if (!changePassDialog) return;
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  changePassDialog.showModal();
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
  } catch (error) {
    showToast(t("toast_current_pass_wrong"), "error");
  }
});

window.addEventListener("language-changed", () => {
  if (currentIdentity) renderIdentity(currentIdentity);
  if (latestChartPayload) renderCharts(latestChartPayload);
  if (chartsStatus && latestChartPayload) chartsStatus.textContent = t("data_charts_subtitle");
});

observeAuth(async (user) => {
  if (!user) {
    window.location.href = "profile.html";
    return;
  }
  if (!isAdmin(user)) {
    window.location.href = "profile.html";
    return;
  }

  try {
    const profile = await getUserProfile(user.uid);
    const identity = {
      username:
        profile?.username ||
        user.displayName ||
        (user.email ? user.email.split("@")[0] : t("administrator_role")),
      email: profile?.email || user.email || "--",
    };
    renderIdentity(identity);
    await loadCharts();
  } catch (error) {
    console.error("Failed to load charts page:", error);
    if (chartsStatus) chartsStatus.textContent = t("profile_load_error");
    showToast(t("profile_load_error"), "error");
  }
});

initI18n();
initTheme();
registerServiceWorker();
