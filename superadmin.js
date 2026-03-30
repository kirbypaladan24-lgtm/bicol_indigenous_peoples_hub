import {
  observeAuth,
  observeAdminActivityLogs,
  fetchAdminActivityLogs,
  fetchAdminDirectory,
  updateAdminAccessState,
  getAdminRoleLabel,
  getUserProfile,
  logout,
  changePassword,
  isSuperAdmin,
  ADMIN_OPERATOR_UIDS,
  VALID_ADMIN_ROLES,
} from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";
import { initAdminEmergencyNotifications } from "./admin-emergency-notifications.js";
import { setSuperAdminNavVisible } from "./role-nav.js";

const themeToggle = document.getElementById("themeToggle");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const logoutBtn = document.getElementById("logoutBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const changePassBtn = document.getElementById("changePassBtn");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");
const superAdminStatus = document.getElementById("superAdminStatus");
const superAdminUsername = document.getElementById("superAdminUsername");
const superAdminEmail = document.getElementById("superAdminEmail");
const superAdminRole = document.getElementById("superAdminRole");
const superAdminTrackedOperations = document.getElementById("superAdminTrackedOperations");
const superAdminActiveAdmins = document.getElementById("superAdminActiveAdmins");
const superAdminLastUpdated = document.getElementById("superAdminLastUpdated");
const superAdminMetricOperations = document.getElementById("superAdminMetricOperations");
const superAdminMetricPostOps = document.getElementById("superAdminMetricPostOps");
const superAdminMetricLandmarkOps = document.getElementById("superAdminMetricLandmarkOps");
const superAdminMetricEmergencyOps = document.getElementById("superAdminMetricEmergencyOps");
const superAdminMetricActiveAdmins = document.getElementById("superAdminMetricActiveAdmins");
const superAdminOperators = document.getElementById("superAdminOperators");
const superAdminRecentActivity = document.getElementById("superAdminRecentActivity");
const rangeButtons = Array.from(document.querySelectorAll("[data-range]"));
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

const THEME_KEY = "bicol-ip-theme";
const RANGE_CONFIG = {
  "7": { days: 7, label: "7 days" },
  "30": { days: 30, label: "30 days" },
  "90": { days: 90, label: "90 days" },
  all: { days: null, label: "All time" },
};
const ADMIN_COLORS = ["#6c8968", "#6e8088", "#a56b43"];
const OPERATION_COLORS = {
  post_created: "#6c8968",
  post_updated: "#7d9a79",
  post_deleted: "#8c6058",
  landmark_created: "#6e8088",
  landmark_updated: "#829398",
  landmark_deleted: "#9e7558",
  emergency_responded: "#a56b43",
};
const OPERATION_LABELS = {
  post_created: "Posts created",
  post_updated: "Posts edited",
  post_deleted: "Posts deleted",
  landmark_created: "Landmarks added",
  landmark_updated: "Landmarks edited",
  landmark_deleted: "Landmarks deleted",
  emergency_responded: "Emergency responses",
};
const ADMIN_OPERATORS = ADMIN_OPERATOR_UIDS.map((uid, index) => ({
  uid,
  label: `Admin ${index + 1}`,
  defaultRole: VALID_ADMIN_ROLES[index] || "content_admin",
  color: ADMIN_COLORS[index % ADMIN_COLORS.length],
}));
const DEFAULT_ROLE_BY_UID = new Map(ADMIN_OPERATORS.map((entry) => [entry.uid, entry.defaultRole]));

let currentRange = "30";
let latestLogs = [];
let adminProfiles = new Map();
let adminAccessDirectory = new Map();
let unsubscribeActivityLogs = null;
let adminAccessBusy = false;

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
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatTimestamp(date) {
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

function getRangeStart(range = currentRange) {
  const days = RANGE_CONFIG[range]?.days ?? null;
  if (!days) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function filterLogsByRange(logs = [], range = currentRange) {
  const start = getRangeStart(range);
  if (!start) return [...logs];
  return logs.filter((entry) => {
    const date = toDate(entry?.createdAt);
    if (!date) return false;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized >= start;
  });
}

function buildDailySeries(items, days = 30) {
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
  items.forEach((item) => {
    const date = toDate(item?.createdAt);
    if (!date) return;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const bucket = bucketMap.get(normalized.toISOString().slice(0, 10));
    if (bucket) bucket.count += 1;
  });
  return buckets;
}

function buildMonthlySeries(items = []) {
  const dates = items.map((item) => toDate(item?.createdAt)).filter(Boolean).sort((a, b) => a - b);
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
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const bucket = {
      key,
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      count: 0,
    };
    buckets.push(bucket);
    bucketMap.set(key, bucket);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  items.forEach((item) => {
    const date = toDate(item?.createdAt);
    if (!date) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = bucketMap.get(key);
    if (bucket) bucket.count += 1;
  });
  return buckets;
}

function buildSeriesForRange(items, range = currentRange) {
  return RANGE_CONFIG[range]?.days ? buildDailySeries(items, RANGE_CONFIG[range].days) : buildMonthlySeries(items);
}

function buildYAxisTicks(maxValue, maxTicks = 4) {
  if (maxValue <= 0) return [0];
  if (Number.isInteger(maxValue) && maxValue <= 4) return Array.from({ length: maxValue + 1 }, (_, index) => index);
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
  for (let value = 0; value <= axisMax + niceStep * 0.5; value += niceStep) ticks.push(value);
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
    svgEl.innerHTML = `<rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="transparent"></rect><text x="50%" y="50%" text-anchor="middle" fill="var(--muted)" font-size="14">${escapeHtml(t("chart_empty"))}</text>`;
    return;
  }
  const yAxisTicks = buildYAxisTicks(maxValue);
  const axisMax = yAxisTicks[yAxisTicks.length - 1] || maxValue;
  const points = series.map((item, index) => {
    const x = padding.left + (index / Math.max(series.length - 1, 1)) * innerWidth;
    const y = padding.top + innerHeight - (item.count / axisMax) * innerHeight;
    return { x, y, label: item.label, value: item.count };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
  const xLabelIndexes = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));
  const gridLines = yAxisTicks.map((value) => {
    const ratio = axisMax === 0 ? 0 : value / axisMax;
    const y = padding.top + innerHeight - ratio * innerHeight;
    return `<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="var(--border)" stroke-width="1" opacity="0.7"></line><text x="${padding.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="var(--muted)" font-size="11">${value}</text>`;
  }).join("");
  const xLabels = xLabelIndexes.map((index) => {
    const point = points[index];
    return `<text x="${point.x.toFixed(2)}" y="${(height - 8).toFixed(2)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(point.label)}</text>`;
  }).join("");
  const dots = points.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5" fill="${lineColor}"></circle><title>${escapeHtml(point.label)}: ${point.value}</title>`).join("");
  svgEl.innerHTML = `<rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="transparent"></rect>${gridLines}<g><path d="${areaPath}" fill="${fillColor}"></path><path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>${dots}</g>${xLabels}`;
}

function renderBarChart(container, items) {
  if (!container) return;
  const maxValue = Math.max(...items.map((item) => item.value), 0);
  if (!items.length || maxValue === 0) {
    container.innerHTML = `<p class="admin-chart-empty">${escapeHtml(t("chart_empty"))}</p>`;
    return;
  }
  container.innerHTML = items.map((item) => {
    const width = Math.max((item.value / maxValue) * 100, item.value > 0 ? 8 : 0);
    return `<div class="admin-bar-row"><div class="admin-bar-copy"><span class="admin-bar-label">${escapeHtml(item.label)}</span><strong>${formatCompactNumber(item.value)}</strong></div><div class="admin-bar-track"><span class="admin-bar-fill" style="width:${width}%; background:${item.color};"></span></div></div>`;
  }).join("");
}

function getActionLabel(actionType) {
  return OPERATION_LABELS[actionType] || actionType;
}

function getRoleLabel(role) {
  if (role === "content_admin") return "Content Admin";
  if (role === "landmark_admin") return "Landmark Admin";
  if (role === "emergency_admin") return "Emergency Admin";
  if (role === "super_admin") return "Super Admin";
  return role || "Unknown";
}

function getTargetHref(entry) {
  if (entry?.targetType === "post" && entry?.targetId) return `posts.html?post=${encodeURIComponent(entry.targetId)}#posts`;
  if (entry?.targetType === "landmark" && entry?.targetId) return `landmark.html?id=${encodeURIComponent(entry.targetId)}`;
  if (entry?.targetType === "emergency" && entry?.targetId) return `tracker.html?user=${encodeURIComponent(entry.targetId)}&focus=warning`;
  return null;
}

function createActivityItem(entry) {
  const href = getTargetHref(entry);
  const wrapperTag = href ? "a" : "div";
  const wrapperAttrs = href ? `class="admin-history-item admin-history-item-link" href="${href}"` : `class="admin-history-item"`;
  return `<${wrapperTag} ${wrapperAttrs}><div class="admin-history-head"><h5>${escapeHtml(getActionLabel(entry.actionType))}</h5><span class="admin-history-badge">${escapeHtml(entry.actorName || entry.actorEmail || entry.actorUid || "--")}</span></div><div class="admin-history-meta"><span>${escapeHtml(entry.targetLabel || entry.targetId || entry.targetType || "--")}</span><span>${formatTimestamp(entry.createdAt)}</span></div><p class="admin-history-copy">${escapeHtml(entry.summary || "No summary provided.")}</p></${wrapperTag}>`;
}

function countOperations(logs = []) {
  const counts = { total: logs.length, post: 0, landmark: 0, emergency: 0 };
  logs.forEach((entry) => {
    if (String(entry?.actionType || "").startsWith("post_")) counts.post += 1;
    if (String(entry?.actionType || "").startsWith("landmark_")) counts.landmark += 1;
    if (entry?.actionType === "emergency_responded") counts.emergency += 1;
  });
  return counts;
}

function getOperatorIdentity(operator, logs = []) {
  const profile = adminProfiles.get(operator.uid);
  const access = adminAccessDirectory.get(operator.uid);
  const latest = logs.find((entry) => entry?.actorUid === operator.uid) || null;
  return {
    name: profile?.username || latest?.actorName || profile?.email?.split("@")[0] || latest?.actorEmail?.split("@")[0] || operator.label,
    email: profile?.email || latest?.actorEmail || operator.uid,
    role: access?.role || operator.defaultRole || "content_admin",
    active: access?.active !== false,
  };
}

function buildOperatorSummaries(logs = []) {
  return ADMIN_OPERATORS.map((operator) => {
    const operatorLogs = logs.filter((entry) => entry?.actorUid === operator.uid);
    const counts = countOperations(operatorLogs);
    return {
      ...operator,
      identity: getOperatorIdentity(operator, operatorLogs),
      logs: operatorLogs,
      counts,
      perActionCounts: Object.keys(OPERATION_LABELS).map((actionType) => ({
        actionType,
        label: getActionLabel(actionType),
        value: operatorLogs.filter((entry) => entry?.actionType === actionType).length,
        color: OPERATION_COLORS[actionType],
      })),
      series: buildSeriesForRange(operatorLogs, currentRange),
      lastActivity: operatorLogs[0]?.createdAt || null,
    };
  });
}

function renderOverview(logs, operatorSummaries) {
  const counts = countOperations(logs);
  const activeAdmins = operatorSummaries.filter((entry) => entry.counts.total > 0).length;
  if (superAdminTrackedOperations) superAdminTrackedOperations.textContent = formatCompactNumber(counts.total);
  if (superAdminActiveAdmins) superAdminActiveAdmins.textContent = formatCompactNumber(activeAdmins);
  if (superAdminLastUpdated) superAdminLastUpdated.textContent = formatTimestamp(logs[0]?.createdAt || null);
  if (superAdminMetricOperations) superAdminMetricOperations.textContent = formatCompactNumber(counts.total);
  if (superAdminMetricPostOps) superAdminMetricPostOps.textContent = formatCompactNumber(counts.post);
  if (superAdminMetricLandmarkOps) superAdminMetricLandmarkOps.textContent = formatCompactNumber(counts.landmark);
  if (superAdminMetricEmergencyOps) superAdminMetricEmergencyOps.textContent = formatCompactNumber(counts.emergency);
  if (superAdminMetricActiveAdmins) superAdminMetricActiveAdmins.textContent = formatCompactNumber(activeAdmins);
  if (superAdminStatus) {
    const rangeLabel = RANGE_CONFIG[currentRange]?.label || RANGE_CONFIG.all.label;
    superAdminStatus.textContent = `${formatCompactNumber(counts.total)} tracked operations across ${activeAdmins} active admins in the ${rangeLabel.toLowerCase()} window.`;
  }
}

function renderOperatorPanels(operatorSummaries) {
  if (!superAdminOperators) return;
  superAdminOperators.innerHTML = operatorSummaries.map((operator, index) => `
    <article class="superadmin-operator-panel">
      <div class="superadmin-operator-head">
        <div>
          <p class="admin-card-eyebrow">${escapeHtml(operator.label)}</p>
          <h4>${escapeHtml(operator.identity.name)}</h4>
          <p class="admin-card-note">${escapeHtml(operator.identity.email)}</p>
        </div>
        <div class="superadmin-operator-meta">
          <span>${operator.identity.active ? "Active admin" : "Temporarily disabled"}</span>
          <strong>${escapeHtml(getRoleLabel(operator.identity.role))}</strong>
        </div>
      </div>
      <div class="superadmin-access-controls">
        <label class="superadmin-access-control">
          <span>Assigned role</span>
          <select data-admin-role-select="${operator.uid}">
            ${VALID_ADMIN_ROLES.map((role) => `
              <option value="${role}" ${operator.identity.role === role ? "selected" : ""}>${escapeHtml(getRoleLabel(role))}</option>
            `).join("")}
          </select>
        </label>
        <div class="superadmin-access-actions">
          <button type="button" class="ghost small" data-admin-toggle="${operator.uid}">
            ${operator.identity.active ? "Disable Admin" : "Re-enable Admin"}
          </button>
          <button type="button" class="solid small" data-admin-save="${operator.uid}">
            Save Access
          </button>
        </div>
      </div>
      <div class="superadmin-mini-metrics">
        <article class="superadmin-mini-metric"><span>Total operations</span><strong>${formatCompactNumber(operator.counts.total)}</strong></article>
        <article class="superadmin-mini-metric"><span>Post changes</span><strong>${formatCompactNumber(operator.counts.post)}</strong></article>
        <article class="superadmin-mini-metric"><span>Landmark changes</span><strong>${formatCompactNumber(operator.counts.landmark)}</strong></article>
        <article class="superadmin-mini-metric"><span>Emergency responses</span><strong>${formatCompactNumber(operator.counts.emergency)}</strong></article>
      </div>
      <div class="superadmin-operator-visuals">
        <section class="superadmin-visual">
          <p class="admin-card-eyebrow">Activity trend</p>
          <svg id="superAdminLineChart${index}" class="admin-line-chart" viewBox="0 0 520 220" role="img" aria-label="${escapeHtml(operator.label)} activity trend"></svg>
        </section>
        <section class="superadmin-visual">
          <p class="admin-card-eyebrow">Operation mix</p>
          <div id="superAdminBarChart${index}" class="admin-bar-chart" aria-live="polite"></div>
        </section>
      </div>
      <section class="superadmin-recent-block">
        <p class="admin-card-eyebrow">Latest tracked activity</p>
        <div id="superAdminRecent${index}" class="admin-history-list superadmin-history-list"></div>
      </section>
    </article>
  `).join("");

  operatorSummaries.forEach((operator, index) => {
    renderLineChart(document.getElementById(`superAdminLineChart${index}`), operator.series, {
      lineColor: operator.color,
      fillColor: `${operator.color}22`,
    });
    renderBarChart(document.getElementById(`superAdminBarChart${index}`), operator.perActionCounts);
    const recentList = document.getElementById(`superAdminRecent${index}`);
    if (recentList) {
      recentList.innerHTML = operator.logs.length
        ? operator.logs.slice(0, 5).map(createActivityItem).join("")
        : `<p class="admin-history-empty">No tracked admin activity in this range.</p>`;
    }
  });

  bindAdminAccessControls();
}

function renderRecentActivity(logs = []) {
  if (!superAdminRecentActivity) return;
  superAdminRecentActivity.innerHTML = logs.length
    ? logs.slice(0, 12).map(createActivityItem).join("")
    : `<p class="admin-history-empty">No tracked admin activity in this range.</p>`;
}

function renderDashboard() {
  const filteredLogs = filterLogsByRange(latestLogs, currentRange);
  const operatorSummaries = buildOperatorSummaries(filteredLogs);
  renderOverview(filteredLogs, operatorSummaries);
  renderOperatorPanels(operatorSummaries);
  renderRecentActivity(filteredLogs);
}

async function loadAdminProfiles() {
  const entries = await Promise.all(
    ADMIN_OPERATORS.map(async (operator) => {
      try {
        return [operator.uid, (await getUserProfile(operator.uid)) || null];
      } catch (error) {
        console.warn("Failed to load admin profile:", operator.uid, error);
        return [operator.uid, null];
      }
    })
  );
  adminProfiles = new Map(entries);
}

async function loadAdminDirectory() {
  const entries = await fetchAdminDirectory(true);
  adminAccessDirectory = new Map(
    entries.map((entry) => [
      entry.uid,
      {
        role: entry?.access?.role || DEFAULT_ROLE_BY_UID.get(entry.uid) || "content_admin",
        active: entry?.access?.active !== false,
        updatedAt: entry?.access?.updatedAt || null,
        updatedBy: entry?.access?.updatedBy || null,
      },
    ])
  );
}

async function persistAdminAccess(uid, { role, active }) {
  if (adminAccessBusy) return;
  adminAccessBusy = true;
  try {
    const state = await updateAdminAccessState(uid, { role, active });
    adminAccessDirectory.set(uid, {
      role: state?.role || role,
      active: state?.active !== false,
      updatedAt: state?.updatedAt || null,
      updatedBy: state?.updatedBy || null,
    });
    renderDashboard();
    showToast("Admin access updated.", "success");
  } catch (error) {
    console.error("Failed to update admin access:", error);
    showToast(error?.message || "Failed to update admin access.", "error");
  } finally {
    adminAccessBusy = false;
  }
}

function bindAdminAccessControls() {
  if (!superAdminOperators) return;

  superAdminOperators.querySelectorAll("[data-admin-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const uid = button.dataset.adminSave;
      const roleSelect = superAdminOperators.querySelector(`[data-admin-role-select="${uid}"]`);
      if (!uid || !roleSelect) return;
      await persistAdminAccess(uid, {
        role: roleSelect.value,
        active: adminAccessDirectory.get(uid)?.active !== false,
      });
    });
  });

  superAdminOperators.querySelectorAll("[data-admin-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const uid = button.dataset.adminToggle;
      const currentState = adminAccessDirectory.get(uid) || { role: DEFAULT_ROLE_BY_UID.get(uid) || "content_admin", active: true };
      await persistAdminAccess(uid, {
        role: currentState.role,
        active: !(currentState.active !== false),
      });
    });
  });
}

function setRange(range) {
  if (!RANGE_CONFIG[range]) return;
  currentRange = range;
  rangeButtons.forEach((button) => button.classList.toggle("active", button.dataset.range === range));
  renderDashboard();
}

function renderSuperAdminIdentity(profile, user) {
  if (superAdminUsername) superAdminUsername.textContent = profile?.username || user.displayName || (user.email ? user.email.split("@")[0] : "Super Admin");
  if (superAdminEmail) superAdminEmail.textContent = profile?.email || user.email || "--";
  if (superAdminRole) superAdminRole.textContent = "Super Admin";
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

mobileMenu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileMenu?.classList.remove("open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
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
  if (!current || !next || !confirm) return showToast(t("toast_fill_password_fields"), "warn");
  if (next.length < 6) return showToast(t("toast_new_pass_short"), "warn");
  if (next !== confirm) return showToast(t("toast_pass_not_match"), "warn");
  try {
    await changePassword({ currentPassword: current, newPassword: next });
    showToast(t("toast_pass_updated"), "success");
    changePassDialog.close();
  } catch (error) {
    showToast(t("toast_current_pass_wrong"), "error");
  }
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => setRange(button.dataset.range || "30"));
});

window.addEventListener("beforeunload", () => {
  try {
    unsubscribeActivityLogs?.();
  } catch (error) {}
});

window.addEventListener("language-changed", () => {
  renderDashboard();
});

observeAuth(async (user) => {
  if (!user || !isSuperAdmin(user)) {
    try {
      unsubscribeActivityLogs?.();
    } catch (error) {}
    window.location.href = "profile.html";
    return;
  }

  setSuperAdminNavVisible(true, { currentPage: true });

  try {
    await Promise.all([loadAdminProfiles(), loadAdminDirectory()]);
    const [profile, initialLogs] = await Promise.all([
      getUserProfile(user.uid),
      fetchAdminActivityLogs().catch(() => []),
    ]);
    renderSuperAdminIdentity(profile, user);
    latestLogs = initialLogs;
    renderDashboard();

    try {
      unsubscribeActivityLogs?.();
    } catch (error) {}
    unsubscribeActivityLogs = observeAdminActivityLogs((logs) => {
      latestLogs = logs;
      renderDashboard();
    });
  } catch (error) {
    console.error("Failed to load super admin workspace:", error);
    if (superAdminStatus) superAdminStatus.textContent = "Super admin data could not be loaded right now.";
    showToast("Failed to load the super admin workspace.", "error");
  }
});

initI18n();
initTheme();
initRevealAnimations();
setRange(currentRange);
registerServiceWorker();
initAdminEmergencyNotifications();
