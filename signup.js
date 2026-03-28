import { createAccountWithProfile, loginWithEmail } from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { registerServiceWorker } from "./pwa.js";

const form = document.getElementById("signupForm");
const toast = document.getElementById("signupToast");
const passwordInput = document.getElementById("passwordInput");
const toggleSignupPass = document.getElementById("toggleSignupPass");
const birthdateError = document.getElementById("birthdateError");

function showToast(msg, variant = "info") {
  toast.textContent = msg;
  toast.dataset.variant = variant;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2500);
}

toggleSignupPass?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleSignupPass.textContent = isHidden ? t("hide") : t("show");
  toggleSignupPass.setAttribute("aria-label", isHidden ? t("hide") : t("show"));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("usernameInput").value.trim();
  const phone = document.getElementById("phoneInput").value.trim();
  const birthdate = document.getElementById("birthdateInput").value;
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();

  if (!/\S+@\S+\.\S+/.test(email)) {
    showToast(t("toast_valid_email"), "warn");
    return;
  }
  if (password.length < 6) {
    showToast(t("toast_pass_short"), "warn");
    return;
  }
  if (!username) {
    showToast(t("toast_signup_username_required"), "warn");
    return;
  }
  
  console.log('Starting account creation for:', email);
  
  try {
    const user = await createAccountWithProfile({ email, password, username, phone, birthdate });
    console.log('Account created successfully:', user.uid);
    showToast(t("toast_signup_created_redirect"), "success");
    setTimeout(() => (window.location.href = "index.html"), 1200);
  } catch (err) {
    console.error("Signup error:", err);
    
    if (err.code === "auth/email-already-in-use") {
      // Try to log in with the same credentials; if password is wrong, inform the user.
      try {
        console.log('Email already in use, attempting login...');
        await loginWithEmail(email, password);
        showToast(t("toast_signup_email_registered_login"), "success");
        setTimeout(() => (window.location.href = "index.html"), 800);
        return;
      } catch (loginErr) {
        console.error("Auto-login failed:", loginErr);
        showToast(t("toast_signup_email_in_use"), "error");
        return;
      }
    }
    
    // Handle specific Firestore errors
    if (err.message && err.message.includes('Firestore sync failed')) {
      showToast(t("toast_signup_profile_sync_failed"), "error");
      return;
    }
    
    showToast(t("toast_signup_failed", { error: err.message }), "error");
  }
});

initI18n();
if (birthdateError) {
  birthdateError.dataset.invalidMessage = t("birthdate_error_invalid");
  birthdateError.dataset.completeMessage = t("birthdate_error_complete");
}
registerServiceWorker();
