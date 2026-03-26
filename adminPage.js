import { observeAuth, logout, isAdmin, changePassword, auth } from "./auth.js";
import { initAdmin } from "./admin.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";

const logoutBtn = document.getElementById("logoutBtn");
const themeToggle = document.getElementById("themeToggle");
const changePassBtn = document.getElementById("changePassBtn");
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const THEME_KEY = "bicol-ip-theme";

logoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (e) {
    console.error("Logout failed:", e);
    showToast("Logout failed: " + (e.message || e), "error");
  }
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
  mobileMenu?.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
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
    console.error("Password change failed:", err);
    showToast("Current password is incorrect.", "error");
  }
});

mobileLogoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (e) {
    console.error("Logout failed:", e);
    showToast("Logout failed: " + (e.message || e), "error");
  }
});

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

observeAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  if (!isAdmin(user)) {
    showToast("Admin access required.", "error");
    await logout();
    window.location.href = "index.html";
    return;
  }
  
  // Log connection info for debugging
  console.log('Admin page loaded for user:', user.uid);
  console.log('Run verifyFirestore() in console to test connection');
  
  await initAdmin(user);
});

initTheme();
registerServiceWorker();
