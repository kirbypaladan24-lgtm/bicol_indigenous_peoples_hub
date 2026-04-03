import { observeAuth, logout, changePassword, getUserProfile, isSuperAdmin, getAdminRoleLabel, canAccessAdminWorkspace } from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initAdmin } from "./admin.js";
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

const adminWorkspaceStatus = document.getElementById("adminWorkspaceStatus");
const adminUsername = document.getElementById("adminUsername");
const adminEmail = document.getElementById("adminEmail");
const adminRole = document.getElementById("adminRole");

const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

const THEME_KEY = "bicol-ip-theme";
let currentIdentity = null;

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

function renderIdentity(identity) {
  currentIdentity = identity;
  if (adminUsername) adminUsername.textContent = identity?.username || "--";
  if (adminEmail) adminEmail.textContent = identity?.email || "--";
  if (adminRole) adminRole.textContent = identity?.roleLabel || t("administrator_role");
  if (adminWorkspaceStatus) adminWorkspaceStatus.textContent = identity?.workspaceNote || t("admin_subtitle");
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
});

observeAuth(async (user) => {
  if (!user || !canAccessAdminWorkspace(user)) {
    window.location.href = "profile.html";
    return;
  }
  setSuperAdminNavVisible(isSuperAdmin(user));

  try {
    const profile = await getUserProfile(user.uid);
    const roleLabel = getAdminRoleLabel(user);
    const identity = {
      username:
        profile?.username ||
        user.displayName ||
        (user.email ? user.email.split("@")[0] : t("administrator_role")),
      email: profile?.email || user.email || "--",
      roleLabel,
      workspaceNote:
        roleLabel === "Content Admin"
          ? "Content Admin workspace for posts, editing, and moderation."
          : roleLabel === "Landmark Admin"
            ? "Landmark Admin workspace for map entries and landmark records."
            : "Super Admin workspace with full access.",
    };
    renderIdentity(identity);
    await initAdmin(user);
  } catch (error) {
    console.error("Failed to load admin workspace:", error);
    if (adminWorkspaceStatus) adminWorkspaceStatus.textContent = t("profile_load_error");
    showToast(t("profile_load_error"), "error");
  }
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
initAdminEmergencyNotifications();
