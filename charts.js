import {
  observeAuth,
  observePosts,
  observeUsers,
  observeLandmarks,
  logout,
  changePassword,
  getUserProfile,
  isAdmin,
  fetchPosts,
  fetchLandmarks,
  fetchUsers,
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
const adminTopPosts = document.getElementById("adminTopPosts");
const rangeButtons = Array.from(document.querySelectorAll("[data-range]"));
const chartRangeLabels = Array.from(document.querySelectorAll("[data-chart-range-label]"));

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

let latestChartPayload = null;
let currentIdentity = null;
let currentRange = "7";
let liveChartUnsubs = [];

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

function getRangeDays(range = currentRange) {
  return RANGE_CONFIG[range]?.days ?? RANGE_CONFIG["7"].days;
}

function getRangeLabel(range = currentRange) {
  return t(RANGE_CONFIG[range]?.labelKey || RANGE_CONFIG["7"].labelKey);
}

function getRangeStart(range = currentRange) {
  const days = getRangeDays(range);
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

function buildMonthlySeries(items, resolveDate) {
  const dates = (items || [])
    .map((item) => resolveDate(item))
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!dates.length) return [];

  const start = new Date(dates[0]);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setDate(1);
  end.setHours(0, 0, 0, 0);

  const buckets = [];
  const bucketMap = new Map();
  const cursor = new Date(start);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const bucket = {
      key,
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      count: 0,
    };
    buckets.push(bucket);
    bucketMap.set(key, bucket);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  (items || []).forEach((item) => {
    const date = resolveDate(item);
    if (!date) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = bucketMap.get(key);
    if (bucket) bucket.count += 1;
  });

  return buckets;
}

function buildSeriesForRange(items, resolveDate, range = currentRange) {
  const days = getRangeDays(range);
  return days ? buildDailySeries(items, resolveDate, days) : buildMonthlySeries(items, resolveDate);
}

function renderMetric(element, value) {
  if (element) element.textContent = formatCompactNumber(value);
}

function buildYAxisTicks(maxValue, maxTicks = 4) {
  if (maxValue <= 0) return [0];

  if (Number.isInteger(maxValue) && maxValue <= 4) {
    return Array.from({ length: maxValue + 1 }, (_, index) => index);
  }

  const roughStep = maxValue / Math.max(maxTicks - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;

  let niceStep = 1;
  if (residual <= 1) niceStep = 1;
  else if (residual <= 2) niceStep = 2;
  else if (residual <= 5) niceStep = 5;
  else niceStep = 10;

  niceStep *= magnitude;

  const axisMax = Math.ceil(maxValue / niceStep) * niceStep;
  const ticks = [];
  for (let value = 0; value <= axisMax + niceStep * 0.5; value += niceStep) {
    ticks.push(value);
  }

  return ticks;
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

  const yAxisTicks = buildYAxisTicks(maxValue);
  const axisMax = yAxisTicks[yAxisTicks.length - 1] || maxValue;
  const points = series.map((item, index) => {
    const x = padding.left + (index / Math.max(series.length - 1, 1)) * innerWidth;
    const y = padding.top + innerHeight - (item.count / axisMax) * innerHeight;
    return { x, y, label: item.label, value: item.count };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
  const xLabelIndexes = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));

  const gridLines = yAxisTicks.map((value) => {
    const ratio = axisMax === 0 ? 0 : value / axisMax;
    const y = padding.top + innerHeight - ratio * innerHeight;
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

function renderTopPosts(container, posts = []) {
  if (!container) return;

  if (!posts.length) {
    container.innerHTML = `<p class="admin-chart-empty">${escapeHtml(t("top_posts_empty"))}</p>`;
    return;
  }

  container.innerHTML = posts
    .map((post, index) => {
      const likes = Math.max(0, Number(post.likes || 0));
      const dislikes = Math.max(0, Number(post.dislikes || 0));
      const engagement = likes + dislikes;
      const published = getDateValue(post, ["createdAt", "updatedAt"]);
      return `
        <article class="admin-top-post">
          <div class="admin-top-post-rank">${index + 1}</div>
          <div class="admin-top-post-main">
            <div class="admin-top-post-head">
              <h5>${escapeHtml(post.title || t("untitled_post"))}</h5>
              <span class="admin-top-post-author">${escapeHtml(post.author || t("contributor"))}</span>
            </div>
            <div class="admin-top-post-stats">
              <span>${escapeHtml(t("likes_label"))}: <strong>${formatCompactNumber(likes)}</strong></span>
              <span>${escapeHtml(t("dislikes_label"))}: <strong>${formatCompactNumber(dislikes)}</strong></span>
              <span>${escapeHtml(t("engagement_label"))}: <strong>${formatCompactNumber(engagement)}</strong></span>
              <span>${published ? escapeHtml(published.toLocaleDateString()) : "--"}</span>
            </div>
          </div>
        </article>
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

function stopLiveChartObservers() {
  liveChartUnsubs.forEach((unsubscribe) => {
    try {
      unsubscribe?.();
    } catch (error) {
      console.warn("Failed to unsubscribe chart listener:", error);
    }
  });
  liveChartUnsubs = [];
}

function updateChartPayload(partial = {}) {
  const nextPayload = {
    posts: latestChartPayload?.posts || [],
    landmarks: latestChartPayload?.landmarks || [],
    users: latestChartPayload?.users || [],
    userCount: latestChartPayload?.userCount || 0,
    ...partial,
  };

  if (Array.isArray(nextPayload.users)) {
    nextPayload.userCount = nextPayload.users.length;
  }

  renderCharts(nextPayload);
  if (chartsStatus) chartsStatus.textContent = t("data_charts_subtitle");
}

function startLiveChartObservers() {
  stopLiveChartObservers();

  liveChartUnsubs = [
    observePosts((posts) => {
      updateChartPayload({ posts });
    }),
    observeLandmarks((landmarks) => {
      updateChartPayload({ landmarks });
    }),
    observeUsers((users) => {
      updateChartPayload({ users, userCount: users.length });
    }),
  ];
}

function renderCharts(payload) {
  latestChartPayload = payload;

  const {
    posts = [],
    landmarks = [],
    users = [],
    userCount = 0,
  } = payload || {};

  const filteredPosts = filterItemsByRange(posts, ["createdAt", "updatedAt"], currentRange);
  const filteredLandmarks = filterItemsByRange(landmarks, ["createdAt", "updatedAt"], currentRange);
  const filteredUsers = filterItemsByRange(users, ["lastLoginAt", "createdAt"], currentRange);
  const filteredLikes = filteredPosts.reduce((sum, post) => sum + Math.max(0, Number(post.likes || 0)), 0);
  const filteredDislikes = filteredPosts.reduce((sum, post) => sum + Math.max(0, Number(post.dislikes || 0)), 0);
  const totalEngagement = filteredLikes + filteredDislikes;

  renderMetric(adminMetricPosts, filteredPosts.length);
  renderMetric(adminMetricUsers, currentRange === "all" ? userCount : filteredUsers.length);
  renderMetric(adminMetricLandmarks, filteredLandmarks.length);
  renderMetric(adminMetricEngagement, totalEngagement);

  chartRangeLabels.forEach((label) => {
    label.textContent = getRangeLabel();
  });

  renderLineChart(
    adminPostsChart,
    buildSeriesForRange(filteredPosts, (item) => getDateValue(item, ["createdAt", "updatedAt"]), currentRange),
    { lineColor: "#5a9a6a", fillColor: "rgba(90, 154, 106, 0.16)" }
  );
  renderLineChart(
    adminUsersChart,
    buildSeriesForRange(filteredUsers, (item) => getDateValue(item, ["lastLoginAt", "createdAt"]), currentRange),
    { lineColor: "#2b7bff", fillColor: "rgba(43, 123, 255, 0.14)" }
  );
  renderLineChart(
    adminLandmarksChart,
    buildSeriesForRange(filteredLandmarks, (item) => getDateValue(item, ["createdAt", "updatedAt"]), currentRange),
    { lineColor: "#c36b2a", fillColor: "rgba(195, 107, 42, 0.14)" }
  );
  renderBarChart(adminEngagementChart, [
    { label: t("likes_label"), value: filteredLikes, color: "#5a9a6a" },
    { label: t("dislikes_label"), value: filteredDislikes, color: "#c36b2a" },
    { label: t("total_interactions"), value: totalEngagement, color: "#2f5c3a" },
  ]);

  renderTopPosts(
    adminTopPosts,
    [...filteredPosts]
      .sort((a, b) => {
        const engagementA = Math.max(0, Number(a.likes || 0)) + Math.max(0, Number(a.dislikes || 0));
        const engagementB = Math.max(0, Number(b.likes || 0)) + Math.max(0, Number(b.dislikes || 0));
        if (engagementB !== engagementA) return engagementB - engagementA;
        const likesA = Math.max(0, Number(a.likes || 0));
        const likesB = Math.max(0, Number(b.likes || 0));
        if (likesB !== likesA) return likesB - likesA;
        const dateA = getDateValue(a, ["updatedAt", "createdAt"])?.getTime() || 0;
        const dateB = getDateValue(b, ["updatedAt", "createdAt"])?.getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 5)
  );
}

function setRange(range) {
  if (!RANGE_CONFIG[range]) return;
  currentRange = range;
  rangeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.range === range);
  });
  if (latestChartPayload) renderCharts(latestChartPayload);
}

async function loadCharts() {
  if (chartsStatus) chartsStatus.textContent = t("loading_workspace");

  const [posts, landmarks, users] = await Promise.all([
    fetchPosts(true),
    fetchLandmarks(true),
    fetchUsers(true),
  ]);

  renderCharts({
    posts,
    landmarks,
    users,
    userCount: users.length,
  });

  if (chartsStatus) chartsStatus.textContent = t("data_charts_subtitle");
  startLiveChartObservers();
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

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setRange(button.dataset.range);
  });
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
  rangeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.range === currentRange);
  });
  if (currentIdentity) renderIdentity(currentIdentity);
  if (latestChartPayload) renderCharts(latestChartPayload);
  if (chartsStatus && latestChartPayload) chartsStatus.textContent = t("data_charts_subtitle");
});

observeAuth(async (user) => {
  if (!user || !isAdmin(user)) {
    stopLiveChartObservers();
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

window.addEventListener("beforeunload", stopLiveChartObservers);

initI18n();
initTheme();
setRange(currentRange);
registerServiceWorker();
