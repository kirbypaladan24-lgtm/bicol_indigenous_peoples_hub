import { observeAuth, logout, isAdmin, changePassword, auth } from "./auth.js";
import { initAdmin } from "./admin.js";
import { showToast } from "./ui.js";

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

logoutBtn?.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
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
    showToast("Current password is incorrect.", "error");
  }
});

mobileLogoutBtn?.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
});

// reuse theme toggle logic
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "light") document.documentElement.setAttribute("data-theme", "light");
themeToggle?.addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("theme", "light");
  }
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
  await initAdmin(user);
});
