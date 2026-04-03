import {
  observeAuth,
  observeAdminActivityLogs,
  fetchAdminActivityLogs,
  getUserProfile,
  logout,
  changePassword,
  isSuperAdmin,
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
const trackedActivityStatus = document.getElementById("trackedActivityStatus");
const trackedActivityUsername = document.getElementById("trackedActivityUsername");
const trackedActivityEmail = document.getElementById("trackedActivityEmail");
const trackedActivityRole = document.getElementById("trackedActivityRole");
const trackedActivityTotal = document.getElementById("trackedActivityTotal");
const trackedActivityAdmins = document.getElementById("trackedActivityAdmins");
const trackedActivityUpdated = document.getElementById("trackedActivityUpdated");
const trackedPostsCount = document.getElementById("trackedPostsCount");
const trackedLandmarksCount = document.getElementById("trackedLandmarksCount");
const trackedEmergenciesCount = document.getElementById("trackedEmergenciesCount");
const trackedPostsContent = document.getElementById("trackedPostsContent");
const trackedLandmarksContent = document.getElementById("trackedLandmarksContent");
const trackedEmergenciesContent = document.getElementById("trackedEmergenciesContent");
const rangeButtons = Array.from(document.querySelectorAll("[data-range]"));
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const queryParams = new URLSearchParams(window.location.search);
const selectedActorUid = String(queryParams.get("uid") || "").trim();
const selectedActorLabelHint = String(queryParams.get("label") || "").trim();

const THEME_KEY = "bicol-ip-theme";
const RANGE_CONFIG = {
  "7": { days: 7, label: "7 days" },
  "30": { days: 30, label: "30 days" },
  "90": { days: 90, label: "90 days" },
  all: { days: null, label: "All time" },
};
const SECTION_CONFIG = {
  posts: {
    title: "Post activity",
    actionTypes: new Set(["post_created", "post_updated", "post_deleted"]),
    container: trackedPostsContent,
    countEl: trackedPostsCount,
    emptyMessage: "No tracked post activity in this range.",
  },
  landmarks: {
    title: "Landmark activity",
    actionTypes: new Set(["landmark_created", "landmark_updated", "landmark_deleted"]),
    container: trackedLandmarksContent,
    countEl: trackedLandmarksCount,
    emptyMessage: "No tracked landmark activity in this range.",
  },
  emergencies: {
    title: "Emergency activity",
    actionTypes: new Set(["emergency_responded"]),
    container: trackedEmergenciesContent,
    countEl: trackedEmergenciesCount,
    emptyMessage: "No tracked emergency activity in this range.",
  },
};
const POST_ACTIVITY_COLUMNS = [
  {
    actionType: "post_created",
    title: "Created posts",
    emptyMessage: "No created posts in this range.",
  },
  {
    actionType: "post_updated",
    title: "Edited posts",
    emptyMessage: "No edited posts in this range.",
  },
  {
    actionType: "post_deleted",
    title: "Deleted posts",
    emptyMessage: "No deleted posts in this range.",
  },
];
const LANDMARK_ACTIVITY_COLUMNS = [
  {
    actionType: "landmark_created",
    title: "Created landmarks",
    emptyMessage: "No created landmarks in this range.",
  },
  {
    actionType: "landmark_updated",
    title: "Edited landmarks",
    emptyMessage: "No edited landmarks in this range.",
  },
  {
    actionType: "landmark_deleted",
    title: "Deleted landmarks",
    emptyMessage: "No deleted landmarks in this range.",
  },
];

let currentRange = "30";
let latestLogs = [];
let unsubscribeActivityLogs = null;
let selectedActorProfile = null;

function applyTheme(theme) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", value === "light" ? "#f6f6f1" : "#0b120d");
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
    const createdAt = toDate(entry?.createdAt);
    if (!createdAt) return false;
    const normalized = new Date(createdAt);
    normalized.setHours(0, 0, 0, 0);
    return normalized >= start;
  });
}

function getActionLabel(actionType) {
  const labels = {
    post_created: "Post created",
    post_updated: "Post updated",
    post_deleted: "Post deleted",
    landmark_created: "Landmark created",
    landmark_updated: "Landmark updated",
    landmark_deleted: "Landmark deleted",
    emergency_responded: "Emergency responded",
  };
  return labels[actionType] || actionType || "Tracked action";
}

function getRoleLabel(role) {
  if (role === "content_admin") return "Content Admin";
  if (role === "landmark_admin") return "Landmark Admin";
  if (role === "emergency_admin") return "Emergency Admin";
  if (role === "super_admin") return "Super Admin";
  return role || "Unknown";
}

function getTargetHref(entry) {
  if (entry?.targetType === "post" && entry?.targetId) {
    return `posts.html?post=${encodeURIComponent(entry.targetId)}#posts`;
  }
  if (entry?.targetType === "landmark" && entry?.targetId) {
    return `landmark.html?id=${encodeURIComponent(entry.targetId)}`;
  }
  if (entry?.targetType === "emergency" && entry?.targetId) {
    return `tracker.html?user=${encodeURIComponent(entry.targetId)}&focus=warning`;
  }
  return null;
}

function createActivityItem(entry) {
  const href = getTargetHref(entry);
  const wrapperTag = href ? "a" : "div";
  const wrapperAttrs = href
    ? `class="admin-history-item admin-history-item-link" href="${href}"`
    : `class="admin-history-item"`;
  return `<${wrapperTag} ${wrapperAttrs}>
    <div class="admin-history-head">
      <h5>${escapeHtml(getActionLabel(entry.actionType))}</h5>
      <span class="admin-history-badge">${escapeHtml(entry.actorName || entry.actorEmail || entry.actorUid || "--")}</span>
    </div>
    <div class="admin-history-meta">
      <span>${escapeHtml(entry.targetLabel || entry.targetId || entry.targetType || "--")}</span>
      <span>${formatTimestamp(entry.createdAt)}</span>
    </div>
    <p class="admin-history-copy">${escapeHtml(entry.summary || "No summary provided.")}</p>
  </${wrapperTag}>`;
}

function getSelectedActorLabel() {
  if (selectedActorProfile?.username) return selectedActorProfile.username;
  if (selectedActorProfile?.email) return selectedActorProfile.email.split("@")[0];
  if (selectedActorLabelHint) return selectedActorLabelHint;
  const matchedLog = latestLogs.find((entry) => entry?.actorUid === selectedActorUid);
  return (
    matchedLog?.actorName ||
    matchedLog?.actorEmail?.split("@")[0] ||
    selectedActorUid ||
    "selected admin"
  );
}

function getSectionForLog(entry) {
  if (!entry?.actionType) return null;
  if (SECTION_CONFIG.posts.actionTypes.has(entry.actionType)) return "posts";
  if (SECTION_CONFIG.landmarks.actionTypes.has(entry.actionType)) return "landmarks";
  if (SECTION_CONFIG.emergencies.actionTypes.has(entry.actionType)) return "emergencies";
  return null;
}

function groupLogsByActor(entries = []) {
  const groups = new Map();
  entries.forEach((entry) => {
    const actorUid = entry?.actorUid || "unknown";
    const existing = groups.get(actorUid) || {
      actorUid,
      actorName: entry?.actorName || entry?.actorEmail || actorUid,
      actorEmail: entry?.actorEmail || null,
      actorRole: entry?.actorRole || null,
      logs: [],
      lastActivity: null,
    };
    existing.logs.push(entry);
    const createdAt = toDate(entry?.createdAt);
    if (!existing.lastActivity || (createdAt && createdAt > existing.lastActivity)) {
      existing.lastActivity = createdAt;
    }
    groups.set(actorUid, existing);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      total: group.logs.length,
      logs: group.logs.sort((a, b) => {
        const aTime = toDate(a?.createdAt)?.getTime() || 0;
        const bTime = toDate(b?.createdAt)?.getTime() || 0;
        return bTime - aTime;
      }),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return (b.lastActivity?.getTime() || 0) - (a.lastActivity?.getTime() || 0);
    });
}

function renderSection(sectionKey, logs = []) {
  const section = SECTION_CONFIG[sectionKey];
  if (!section?.container || !section?.countEl) return;

  section.countEl.textContent = formatCompactNumber(logs.length);

  if (!logs.length) {
    section.container.innerHTML = `<p class="admin-history-empty">${escapeHtml(section.emptyMessage)}</p>`;
    return;
  }

  const grouped = groupLogsByActor(logs);
  const splitColumns =
    sectionKey === "posts"
      ? POST_ACTIVITY_COLUMNS
      : sectionKey === "landmarks"
        ? LANDMARK_ACTIVITY_COLUMNS
        : null;
  section.container.innerHTML = grouped
    .map((group) => `
      <article class="tracked-admin-card">
        <div class="tracked-admin-head">
          <div>
            <p class="admin-card-eyebrow">${escapeHtml(getRoleLabel(group.actorRole))}</p>
            <h4>${escapeHtml(group.actorName || group.actorUid)}</h4>
            <p class="admin-card-note">${escapeHtml(group.actorEmail || group.actorUid || "--")}</p>
          </div>
          <div class="tracked-admin-meta">
            <span>Operations</span>
            <strong>${formatCompactNumber(group.total)}</strong>
            <span>Last activity: ${escapeHtml(formatTimestamp(group.lastActivity))}</span>
          </div>
        </div>
        ${
          splitColumns
            ? `
              <div class="tracked-post-columns">
                ${splitColumns.map((column) => {
                  const columnLogs = group.logs.filter((entry) => entry?.actionType === column.actionType);
                  return `
                    <section class="tracked-post-column">
                      <div class="tracked-post-column-head">
                        <span>${escapeHtml(column.title)}</span>
                        <strong>${formatCompactNumber(columnLogs.length)}</strong>
                      </div>
                      <div class="tracked-post-column-list admin-history-list">
                        ${
                          columnLogs.length
                            ? columnLogs.slice(0, 10).map(createActivityItem).join("")
                            : `<p class="admin-history-empty">${escapeHtml(column.emptyMessage)}</p>`
                        }
                      </div>
                    </section>
                  `;
                }).join("")}
              </div>
            `
            : `
              <div class="tracked-admin-log-list admin-history-list">
                ${group.logs.slice(0, 12).map(createActivityItem).join("")}
              </div>
            `
        }
      </article>
    `)
    .join("");
}

function renderDashboard() {
  const rangedLogs = filterLogsByRange(latestLogs, currentRange);
  const filteredLogs = selectedActorUid
    ? rangedLogs.filter((entry) => entry?.actorUid === selectedActorUid)
    : rangedLogs;
  const postLogs = filteredLogs.filter((entry) => getSectionForLog(entry) === "posts");
  const landmarkLogs = filteredLogs.filter((entry) => getSectionForLog(entry) === "landmarks");
  const emergencyLogs = filteredLogs.filter((entry) => getSectionForLog(entry) === "emergencies");
  const activeAdmins = new Set(filteredLogs.map((entry) => entry?.actorUid).filter(Boolean)).size;
  const rangeLabel = RANGE_CONFIG[currentRange]?.label || RANGE_CONFIG.all.label;
  const selectedActorLabel = getSelectedActorLabel();

  if (trackedActivityTotal) trackedActivityTotal.textContent = formatCompactNumber(filteredLogs.length);
  if (trackedActivityAdmins) trackedActivityAdmins.textContent = formatCompactNumber(activeAdmins);
  if (trackedActivityUpdated) trackedActivityUpdated.textContent = formatTimestamp(filteredLogs[0]?.createdAt || null);
  if (trackedActivityStatus) {
    trackedActivityStatus.textContent = selectedActorUid
      ? `${formatCompactNumber(filteredLogs.length)} tracked operations for ${selectedActorLabel} in the ${rangeLabel.toLowerCase()} window.`
      : `${formatCompactNumber(filteredLogs.length)} tracked operations across ${activeAdmins} admins in the ${rangeLabel.toLowerCase()} window.`;
  }

  renderSection("posts", postLogs);
  renderSection("landmarks", landmarkLogs);
  renderSection("emergencies", emergencyLogs);
}

function setRange(range) {
  if (!RANGE_CONFIG[range]) return;
  currentRange = range;
  rangeButtons.forEach((button) => button.classList.toggle("active", button.dataset.range === range));
  renderDashboard();
}

function renderSuperAdminIdentity(profile, user) {
  if (trackedActivityUsername) {
    trackedActivityUsername.textContent =
      profile?.username || user.displayName || (user.email ? user.email.split("@")[0] : "Super Admin");
  }
  if (trackedActivityEmail) trackedActivityEmail.textContent = profile?.email || user.email || "--";
  if (trackedActivityRole) trackedActivityRole.textContent = "Super Admin";
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
  } catch (_error) {}
});

window.addEventListener("language-changed", () => {
  renderDashboard();
});

observeAuth(async (user) => {
  if (!user || !isSuperAdmin(user)) {
    try {
      unsubscribeActivityLogs?.();
    } catch (_error) {}
    window.location.href = "profile.html";
    return;
  }

  setSuperAdminNavVisible(true);

  try {
    const [profile, initialLogs, actorProfile] = await Promise.all([
      getUserProfile(user.uid),
      fetchAdminActivityLogs().catch(() => []),
      selectedActorUid ? getUserProfile(selectedActorUid).catch(() => null) : Promise.resolve(null),
    ]);
    renderSuperAdminIdentity(profile, user);
    selectedActorProfile = actorProfile;
    latestLogs = initialLogs;
    renderDashboard();

    try {
      unsubscribeActivityLogs?.();
    } catch (_error) {}
    unsubscribeActivityLogs = observeAdminActivityLogs((logs) => {
      latestLogs = logs;
      renderDashboard();
    });
  } catch (error) {
    console.error("Failed to load tracked activity workspace:", error);
    if (trackedActivityStatus) {
      trackedActivityStatus.textContent = "Tracked activity could not be loaded right now.";
    }
    showToast("Failed to load tracked activity.", "error");
  }
});

initI18n();
initTheme();
initRevealAnimations();
setRange(currentRange);
registerServiceWorker();
initAdminEmergencyNotifications();
