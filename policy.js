import { observeAuth, logout, changePassword, isSuperAdmin, canAccessAdminWorkspace, canAccessCharts, canAccessTracker } from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";
import { setSuperAdminNavVisible } from "./role-nav.js";

const THEME_KEY = "bicol-ip-theme";

const themeToggle = document.getElementById("themeToggle");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const profileBtn = document.getElementById("profileBtn");
const adminToolsBtn = document.getElementById("adminToolsBtn");
const chartsBtn = document.getElementById("chartsBtn");
const trackerBtn = document.getElementById("trackerBtn");
const changePassBtn = document.getElementById("changePassBtn");
const mobileLoginBtn = document.getElementById("mobileLoginBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const mobileProfileBtn = document.getElementById("mobileProfileBtn");
const mobileAdminToolsBtn = document.getElementById("mobileAdminToolsBtn");
const mobileChartsBtn = document.getElementById("mobileChartsBtn");
const mobileTrackerBtn = document.getElementById("mobileTrackerBtn");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

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
  menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

mobileMenu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});

async function triggerPasswordReset() {
  if (!changePassDialog) return;
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  changePassDialog.showModal();
}

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

observeAuth((user) => {
  const authed = !!user;
  setSuperAdminNavVisible(isSuperAdmin(user));

  loginBtn?.classList.toggle("hidden", authed);
  logoutBtn?.classList.toggle("hidden", !authed);
  profileBtn?.classList.toggle("hidden", !authed);
  changePassBtn?.classList.toggle("hidden", !authed);
  mobileLoginBtn?.classList.toggle("hidden", authed);
  mobileLogoutBtn?.classList.toggle("hidden", !authed);
  mobileProfileBtn?.classList.toggle("hidden", !authed);
  mobileChangePassBtn?.classList.toggle("hidden", !authed);
  adminToolsBtn?.classList.toggle("hidden", !canAccessAdminWorkspace(user));
  chartsBtn?.classList.toggle("hidden", !canAccessCharts(user));
  trackerBtn?.classList.toggle("hidden", !canAccessTracker(user));
  mobileAdminToolsBtn?.classList.toggle("hidden", !canAccessAdminWorkspace(user));
  mobileChartsBtn?.classList.toggle("hidden", !canAccessCharts(user));
  mobileTrackerBtn?.classList.toggle("hidden", !canAccessTracker(user));
});

initI18n();
initTheme();
initRevealAnimations();
registerServiceWorker();
