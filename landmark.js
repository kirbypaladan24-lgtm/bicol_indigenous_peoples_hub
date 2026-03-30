import { fetchLandmark, observeAuth, logout, changePassword, isSuperAdmin, canAccessAdminWorkspace, canAccessCharts, canAccessTracker } from "./auth.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";
import { setSuperAdminNavVisible } from "./role-nav.js";

const THEME_KEY = "bicol-ip-theme";

const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const themeToggles = Array.from(document.querySelectorAll("#themeToggle, #mobileThemeToggle"));
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

themeToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    applyTheme(current === "light" ? "dark" : "light");
    if (toggle.id === "mobileThemeToggle") {
      mobileMenu?.classList.remove("open");
      menuToggle?.setAttribute("aria-expanded", "false");
    }
  });
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

function getLandmarkId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

async function loadLandmark() {
  const id = getLandmarkId();
  const titleEl = document.getElementById("landmarkTitleMain");
  const summaryEl = document.getElementById("landmarkSummary");
  const coverEl = document.getElementById("landmarkCover");
  if (!id) {
    showToast(t("toast_landmark_not_found"), "error");
    return;
  }

  summaryEl?.classList.add("loading");
  summaryEl?.setAttribute("aria-busy", "true");
  if (coverEl) coverEl.classList.add("loading");

  try {
    const item = await fetchLandmark(id, true);

    if (!item) {
      showToast(t("toast_landmark_not_found"), "error");
      return;
    }

    if (titleEl) titleEl.textContent = item.name || "Landmark";
    document.title = `${item.name || t("landmark")} | Bicol Indigenous Peoples Hub`;

    if (summaryEl) {
      summaryEl.textContent = item.summary || "";
      linkifyElement(summaryEl);
      addYouTubePreviews(summaryEl);
    }

    if (item.coverUrl && coverEl) {
      coverEl.style.display = "block";
      coverEl.innerHTML = `<img src="${item.coverUrl}" alt="${item.name || "Landmark"}" loading="lazy" decoding="async" class="progressive-image is-loading" style="width:100%; border-radius:12px; display:block;"/>`;
      const coverImg = coverEl.querySelector("img");
      if (coverImg) {
        const markReady = () => {
          coverImg.classList.remove("is-loading");
          coverImg.classList.add("is-ready");
        };
        if (coverImg.complete && coverImg.naturalWidth > 0) markReady();
        else coverImg.addEventListener("load", markReady, { once: true });
      }
    } else if (coverEl) {
      coverEl.style.display = "none";
      coverEl.innerHTML = "";
    }
  } catch (e) {
    console.error("Load landmark failed:", e);
    showToast(t("toast_failed_load_landmark", { error: e.message || e }), "error");
  } finally {
    summaryEl?.classList.remove("loading");
    summaryEl?.setAttribute("aria-busy", "false");
    coverEl?.classList.remove("loading");
  }
}

initI18n();
initTheme();
initRevealAnimations();
loadLandmark();
registerServiceWorker();

function linkifyElement(root) {
  if (!root) return;
  const urlRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const text = node.nodeValue;
    if (!text || !urlRegex.test(text)) {
      urlRegex.lastIndex = 0;
      return;
    }
    urlRegex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const urlText = match[0];
      const start = match.index;
      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const a = document.createElement("a");
      const href = urlText.startsWith("http") ? urlText : `https://${urlText}`;
      a.href = href;
      a.textContent = urlText;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      frag.appendChild(a);
      lastIndex = start + urlText.length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode.replaceChild(frag, node);
  });
}

function addYouTubePreviews(root) {
  if (!root) return;
  const anchors = Array.from(root.querySelectorAll("a[href]"));
  anchors.forEach((a) => {
    if (a.dataset.previewed === "1") return;
    const href = a.getAttribute("href") || "";
    const id = getYouTubeId(href);
    if (!id) return;
    a.dataset.previewed = "1";
    const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const wrapper = document.createElement("div");
    wrapper.className = "link-preview";
    wrapper.innerHTML = `
      <a href="${href}" target="_blank" rel="noopener noreferrer">
        <img src="${thumb}" alt="${t("youtube_preview_alt")}" loading="lazy" />
        <div class="link-meta">
          <span class="link-title">${t("youtube_video")}</span>
          <span class="link-url">${href}</span>
        </div>
      </a>
    `;
    a.parentNode.insertBefore(wrapper, a.nextSibling);
  });
}

function getYouTubeId(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace("/", "");
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/watch")) return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    }
  } catch (e) {
    return null;
  }
  return null;
}
