import { createAccountWithProfile, loginWithEmail } from "./auth.js";
import { registerServiceWorker } from "./pwa.js";

const form = document.getElementById("signupForm");
const toast = document.getElementById("signupToast");
const passwordInput = document.getElementById("passwordInput");
const toggleSignupPass = document.getElementById("toggleSignupPass");

function showToast(msg, variant = "info") {
  toast.textContent = msg;
  toast.dataset.variant = variant;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2500);
}

toggleSignupPass?.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleSignupPass.textContent = isHidden ? "Hide" : "Show";
  toggleSignupPass.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("usernameInput").value.trim();
  const phone = document.getElementById("phoneInput").value.trim();
  const birthdate = document.getElementById("birthdateInput").value;
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value.trim();

  if (!/\S+@\S+\.\S+/.test(email)) {
    showToast("Enter a valid email address.", "warn");
    return;
  }
  if (password.length < 6) {
    showToast("Password must be at least 6 characters.", "warn");
    return;
  }
  if (!username) {
    showToast("Username is required.", "warn");
    return;
  }
  
  console.log('Starting account creation for:', email);
  
  try {
    const user = await createAccountWithProfile({ email, password, username, phone, birthdate });
    console.log('Account created successfully:', user.uid);
    showToast("Account created! Redirecting to login...", "success");
    setTimeout(() => (window.location.href = "index.html"), 1200);
  } catch (err) {
    console.error("Signup error:", err);
    
    if (err.code === "auth/email-already-in-use") {
      // Try to log in with the same credentials; if password is wrong, inform the user.
      try {
        console.log('Email already in use, attempting login...');
        await loginWithEmail(email, password);
        showToast("Email already registered. Logging you in...", "success");
        setTimeout(() => (window.location.href = "index.html"), 800);
        return;
      } catch (loginErr) {
        console.error("Auto-login failed:", loginErr);
        showToast("Email already in use. Use Login or reset your password.", "error");
        return;
      }
    }
    
    // Handle specific Firestore errors
    if (err.message && err.message.includes('Firestore sync failed')) {
      showToast("Account created but profile sync failed. Please contact support.", "error");
      return;
    }
    
    showToast("Signup failed: " + err.message, "error");
  }
});

registerServiceWorker();
