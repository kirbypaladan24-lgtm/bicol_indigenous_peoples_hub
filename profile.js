import {
  observeAuth,
  fetchPosts,
  savePost,
  deletePost,
  logout,
  changePassword,
  auth,
  getUserProfile,
  isAdmin,
  fetchLandmarks,
  fetchSharedLocation,
  observeSharedLocation,
  acknowledgeLocationConsent,
  saveCurrentUserSharedLocation,
  submitEmergencyReport,
} from "./auth.js";
import { uploadImages } from "./imgbb.js";
import { initI18n, t } from "./i18n.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";
import { initRevealAnimations } from "./motion.js";

const themeToggle = document.getElementById("themeToggle");
const logoutBtn = document.getElementById("logoutBtn");
const changePassBtn = document.getElementById("changePassBtn");
const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileThemeToggle = document.getElementById("mobileThemeToggle");
const mobileChangePassBtn = document.getElementById("mobileChangePassBtn");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");

const profileStatus = document.getElementById("profileStatus");
const profilePosts = document.getElementById("profilePosts");
const profileEmpty = document.getElementById("profileEmpty");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileRole = document.getElementById("profileRole");
const profileOwnedCount = document.getElementById("profileOwnedCount");
const profileCommunityCount = document.getElementById("profileCommunityCount");
const profileLandmarkCount = document.getElementById("profileLandmarkCount");
const profileAdminTools = document.getElementById("profileAdminTools");
const profileWorkspaceNote = document.getElementById("profileWorkspaceNote");
const adminToolsSidebarLink = document.getElementById("adminToolsSidebarLink");
const chartsSidebarLink = document.getElementById("chartsSidebarLink");
const trackerSidebarLink = document.getElementById("trackerSidebarLink");
const mobileAdminToolsLink = document.getElementById("mobileAdminToolsLink");
const mobileChartsLink = document.getElementById("mobileChartsLink");
const mobileTrackerLink = document.getElementById("mobileTrackerLink");
const trackerQuickAction = document.getElementById("trackerQuickAction");
const trackerActionLink = document.getElementById("trackerActionLink");
const locationShareSection = document.getElementById("locationShareSection");
const shareLocationQuickAction = document.getElementById("shareLocationQuickAction");
const emergencyQuickAction = document.getElementById("emergencyQuickAction");
const shareLocationBtn = document.getElementById("shareLocationBtn");
const emergencyBtn = document.getElementById("emergencyBtn");
const emergencyResponseCard = document.getElementById("emergencyResponseCard");
const emergencyResponseTitle = document.getElementById("emergencyResponseTitle");
const emergencyResponseBadge = document.getElementById("emergencyResponseBadge");
const emergencyResponseText = document.getElementById("emergencyResponseText");

const editDialog = document.getElementById("profileEditDialog");
const closeEdit = document.getElementById("closeProfileEdit");
const profilePostTitle = document.getElementById("profilePostTitle");
const profileImageInput = document.getElementById("profileImageInput");
const profileImagePreview = document.getElementById("profileImagePreview");
const profileEditor = document.getElementById("profileEditor");
const profileToolbar = document.getElementById("profileToolbar");
const profileSaveBtn = document.getElementById("profileSaveBtn");
const changePassDialog = document.getElementById("changePassDialog");
const closeChangePass = document.getElementById("closeChangePass");
const changePassForm = document.getElementById("changePassForm");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const locationConsentDialog = document.getElementById("locationConsentDialog");
const closeLocationConsent = document.getElementById("closeLocationConsent");
const locationConsentDecline = document.getElementById("locationConsentDecline");
const locationConsentAgree = document.getElementById("locationConsentAgree");
const emergencyDialog = document.getElementById("emergencyDialog");
const closeEmergencyDialog = document.getElementById("closeEmergencyDialog");
const cancelEmergencyBtn = document.getElementById("cancelEmergencyBtn");
const sendEmergencyBtn = document.getElementById("sendEmergencyBtn");
const emergencyMessage = document.getElementById("emergencyMessage");
const emergencyImageInput = document.getElementById("emergencyImageInput");
const emergencyImagePreview = document.getElementById("emergencyImagePreview");

const THEME_KEY = "bicol-ip-theme";
const MAX_IMAGES_PER_POST = 10;

let currentUser = null;
let cachedAuthorName = null;
let currentEditPost = null;
let currentMedia = [];
let saving = false;
let locationBusy = false;
let currentLocationRecord = null;
let emergencyBusy = false;
let sharedLocationUnsub = null;

function enhancePreviewImage(imgEl) {
  if (!imgEl) return;
  imgEl.loading = "lazy";
  imgEl.decoding = "async";
  imgEl.width = 96;
  imgEl.height = 96;
  imgEl.classList.add("progressive-image");

  const markReady = () => {
    imgEl.classList.remove("is-loading");
    imgEl.classList.add("is-ready");
  };

  if (imgEl.complete) {
    markReady();
    return;
  }

  imgEl.classList.add("is-loading");
  imgEl.addEventListener("load", markReady, { once: true });
  imgEl.addEventListener("error", () => imgEl.classList.remove("is-loading"), { once: true });
}

function renderProfileIdentity({ username = "--", email = "--" } = {}) {
  if (profileUsername) profileUsername.textContent = username;
  if (profileEmail) profileEmail.textContent = email;
}

function renderWorkspaceSummary({ role = t("guest_role"), ownedCount = 0, communityCount = 0, landmarkCount = 0, admin = false } = {}) {
  if (profileRole) profileRole.textContent = role;
  if (profileOwnedCount) profileOwnedCount.textContent = String(ownedCount);
  if (profileCommunityCount) profileCommunityCount.textContent = String(communityCount);
  if (profileLandmarkCount) profileLandmarkCount.textContent = String(landmarkCount);
  if (profileAdminTools) profileAdminTools.textContent = admin ? t("admin_tools") : t("profile");
  if (profileWorkspaceNote) {
    profileWorkspaceNote.textContent = admin
      ? t("workspace_note_admin")
      : t("workspace_note_profile");
  }
  adminToolsSidebarLink?.classList.toggle("hidden", !admin);
  chartsSidebarLink?.classList.toggle("hidden", !admin);
  trackerSidebarLink?.classList.toggle("hidden", !admin);
  mobileAdminToolsLink?.classList.toggle("hidden", !admin);
  mobileChartsLink?.classList.toggle("hidden", !admin);
  mobileTrackerLink?.classList.toggle("hidden", !admin);
  trackerQuickAction?.classList.toggle("hidden", !admin);
  trackerActionLink?.classList.toggle("hidden", !admin);
  locationShareSection?.classList.toggle("hidden", admin);
  shareLocationQuickAction?.classList.toggle("hidden", admin);
  emergencyQuickAction?.classList.toggle("hidden", admin);
  shareLocationBtn?.classList.toggle("hidden", admin);
  emergencyBtn?.classList.toggle("hidden", admin);
}

function hasSharedCoordinates(record) {
  return (
    record?.sharingEnabled === true &&
    Number.isFinite(record?.lat) &&
    Number.isFinite(record?.lng)
  );
}

function formatTimestamp(timestamp) {
  const date =
    timestamp?.toDate?.() ||
    (timestamp instanceof Date ? timestamp : null);

  return date
    ? date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
}

function renderLocationShareState(record = currentLocationRecord) {
  currentLocationRecord = record || null;
  const hasLocation = hasSharedCoordinates(record);
  const responseStatus = record?.responseStatus || null;
  const responseReason = String(record?.responseReason || "").trim();
  const emergencyActive = record?.emergencyActive === true;
  const buttonLabel = locationBusy
    ? "Getting your location..."
    : hasLocation
      ? "Update Shared Location"
      : "Share My Location";
  const emergencyLabel = emergencyBusy
    ? "Sending alert..."
    : emergencyActive
      ? "Update Emergency Alert"
      : "Emergency Alert";

  if (shareLocationBtn) {
    shareLocationBtn.textContent = buttonLabel;
    shareLocationBtn.disabled = !currentUser || locationBusy;
  }

  if (shareLocationQuickAction) {
    shareLocationQuickAction.textContent = buttonLabel;
    shareLocationQuickAction.disabled = !currentUser || locationBusy;
  }

  if (emergencyBtn) {
    emergencyBtn.textContent = emergencyLabel;
    emergencyBtn.disabled = !currentUser || !hasLocation || emergencyBusy;
  }

  if (emergencyQuickAction) {
    emergencyQuickAction.textContent = emergencyLabel;
    emergencyQuickAction.disabled = !currentUser || !hasLocation || emergencyBusy;
  }

  if (!currentUser) {
    if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Log in to use emergency alerts";
    if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Unavailable";
    if (emergencyResponseText) emergencyResponseText.textContent = "Share your location first, then you can send an emergency alert with image proof if something urgent happens.";
    emergencyResponseCard?.classList.remove("is-pending", "is-approved", "is-help", "is-declined");
    emergencyResponseCard?.classList.add("is-neutral");
    return;
  }

  if (emergencyResponseText) {
    if (!hasLocation) {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Location sharing required";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Waiting";
      emergencyResponseText.textContent = "Share your location first, then you can send an emergency alert with image proof if something urgent happens.";
      emergencyResponseCard?.classList.remove("is-pending", "is-approved", "is-help", "is-declined");
      emergencyResponseCard?.classList.add("is-neutral");
    } else if (record?.emergencyStatus === "pending" && !responseStatus) {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Emergency report sent";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Pending Review";
      emergencyResponseText.textContent = "Your latest emergency report is waiting for an admin response.";
      emergencyResponseCard?.classList.remove("is-neutral", "is-approved", "is-help", "is-declined");
      emergencyResponseCard?.classList.add("is-pending");
    } else if (responseStatus === "approved") {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Request approved";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Approved";
      emergencyResponseText.textContent = responseReason || "Your emergency report was approved by the admin.";
      emergencyResponseCard?.classList.remove("is-neutral", "is-pending", "is-help", "is-declined");
      emergencyResponseCard?.classList.add("is-approved");
    } else if (responseStatus === "help_on_the_way") {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Help is on the way";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Responding";
      emergencyResponseText.textContent = responseReason || "Help is on the way according to the admin response.";
      emergencyResponseCard?.classList.remove("is-neutral", "is-pending", "is-approved", "is-declined");
      emergencyResponseCard?.classList.add("is-help");
    } else if (responseStatus === "declined") {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Request declined";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "Declined";
      emergencyResponseText.textContent = responseReason || "Your emergency report was declined by the admin.";
      emergencyResponseCard?.classList.remove("is-neutral", "is-pending", "is-approved", "is-help");
      emergencyResponseCard?.classList.add("is-declined");
    } else {
      if (emergencyResponseTitle) emergencyResponseTitle.textContent = "Ready if you need help";
      if (emergencyResponseBadge) emergencyResponseBadge.textContent = "No Active Alert";
      emergencyResponseText.textContent = "If there is an emergency in your area, send a clear message with image proof so the admin can review it quickly.";
      emergencyResponseCard?.classList.remove("is-pending", "is-approved", "is-help", "is-declined");
      emergencyResponseCard?.classList.add("is-neutral");
    }
  }
}

function getLocationErrorMessage(error) {
  switch (error?.code) {
    case 1:
      return "Location permission was denied for this account.";
    case 2:
      return "Your device could not find a location right now.";
    case 3:
      return "Location request timed out. Try again in a place with a better signal.";
    default:
      return error?.message || "Could not get your location.";
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser does not support location sharing."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });
}

async function syncSharedLocation() {
  if (!currentUser || locationBusy) return;

  locationBusy = true;
  renderLocationShareState();

  try {
    const position = await getCurrentPosition();
    const saved = await saveCurrentUserSharedLocation({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });

    renderLocationShareState(saved);
    showToast("Your latest location is now synced for the admin tracker.", "success");
  } catch (error) {
    console.error("Location sync failed:", error);
    showToast(getLocationErrorMessage(error), "error");
    renderLocationShareState();
  } finally {
    locationBusy = false;
    renderLocationShareState();
  }
}

function requestLocationShare() {
  if (!currentUser) {
    showToast("Please log in first before sharing your location.", "warn");
    return;
  }

  const hasConsent = Boolean(currentLocationRecord?.consentAccepted || currentLocationRecord?.consentAcceptedAt);
  if (!hasConsent) {
    locationConsentDialog?.showModal();
    return;
  }

  syncSharedLocation();
}

function openEmergencyDialog() {
  if (!currentUser) {
    showToast("Please log in first before sending an emergency alert.", "warn");
    return;
  }

  if (!hasSharedCoordinates(currentLocationRecord)) {
    showToast("Share your current location first before sending an emergency alert.", "warn");
    return;
  }

  emergencyDialog?.showModal();
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

function normalizeContent(html) {
  if (!html) return "";
  const hasTags = /<\s*(p|div|br|ul|ol|li|blockquote|h\d)\b/i.test(html);
  if (!hasTags && html.includes("\n")) {
    return html.replace(/\n/g, "<br>");
  }
  return html;
}

async function resolveAuthorName() {
  if (!currentUser) return t("contributor");
  if (cachedAuthorName) return cachedAuthorName;
  try {
    const profile = await getUserProfile(currentUser.uid);
    if (profile?.username) {
      cachedAuthorName = profile.username;
      return cachedAuthorName;
    }
  } catch (e) {
    console.warn("Profile lookup failed", e);
  }
  if (currentUser.displayName) {
    cachedAuthorName = currentUser.displayName;
    return cachedAuthorName;
  }
  if (currentUser.email) {
    cachedAuthorName = currentUser.email.split("@")[0];
    return cachedAuthorName;
  }
  return t("contributor");
}

function isOwnedPost(post, authorName) {
  if (!post) return false;
  if (post.authorId && currentUser && post.authorId === currentUser.uid) return true;
  const author = (post.author || "").toLowerCase();
  if (authorName && author === authorName.toLowerCase()) return true;
  if (currentUser?.email) {
    const prefix = currentUser.email.split("@")[0].toLowerCase();
    if (author === prefix) return true;
  }
  return false;
}

function renderPosts(posts) {
  if (!profilePosts) return;
  profilePosts.innerHTML = "";
  if (!posts.length) {
    profileEmpty?.classList.remove("hidden");
    return;
  }
  profileEmpty?.classList.add("hidden");

  posts.forEach((p) => {
    const article = document.createElement("article");
    article.className = "post-row";
    const updated = p.updatedAt?.toDate ? p.updatedAt.toDate() : null;
    article.innerHTML = `
      <header class="post-head">
        <div class="post-avatar">${(p.author || "C")[0]?.toUpperCase() || "C"}</div>
        <div>
          <p class="post-author">${p.author || t("contributor")}</p>
          <p class="post-meta">${updated ? t("updated_prefix") + " " + updated.toLocaleDateString() : t("recently_shared")}</p>
        </div>
      </header>
      <h4 class="post-title">${p.title || t("untitled_post")}</h4>
      <div class="post-body">${p.content || ""}</div>
      <div class="post-actions">
        <button class="ghost small" data-action="edit" data-id="${p.id}">${t("edit_post")}</button>
        <button class="ghost small danger" data-action="delete" data-id="${p.id}">${t("delete")}</button>
      </div>
    `;
    profilePosts.appendChild(article);
  });
}

function bindToolbar(editor, toolbar) {
  if (!editor || !toolbar) return;
  const buttons = Array.from(toolbar.querySelectorAll("button"));
  const selects = Array.from(toolbar.querySelectorAll("select"));
  const stateful = ["bold", "italic", "underline", "insertOrderedList", "insertUnorderedList", "justifyLeft", "justifyCenter", "justifyRight"];
  const focusEditor = () => editor.focus({ preventScroll: true });
  const normalizeBlockValue = (value) => {
    if (!value) return value;
    if (value.startsWith("<")) return value;
    return `<${value}>`;
  };

  function updateStates() {
    buttons.forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (stateful.includes(cmd)) {
        try {
          const active = document.queryCommandState(cmd);
          btn.classList.toggle("active", !!active);
        } catch (e) {}
      }
    });
  }

  toolbar.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;
    focusEditor();
    if (cmd === "createLink") {
      const url = prompt(t("prompt_enter_url"));
      if (url) document.execCommand(cmd, false, url);
    } else if (cmd === "formatBlock") {
      document.execCommand(cmd, false, normalizeBlockValue(value || "p"));
    } else {
      document.execCommand(cmd, false, value);
    }
    updateStates();
  });

  selects.forEach((sel) =>
    sel.addEventListener("change", () => {
      const cmd = sel.dataset.cmd;
      const value = sel.value || "";
      if (!cmd || !value) return;
      focusEditor();
      if (cmd === "formatBlock") {
        document.execCommand(cmd, false, normalizeBlockValue(value));
        return;
      }
      document.execCommand(cmd, false, value);
    })
  );

  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });

  editor.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (!["b", "i", "u"].includes(key)) return;
    e.preventDefault();
    focusEditor();
    if (key === "b") document.execCommand("bold");
    if (key === "i") document.execCommand("italic");
    if (key === "u") document.execCommand("underline");
    updateStates();
  });

  ["keyup", "mouseup", "blur"].forEach((evt) => editor.addEventListener(evt, updateStates));
}

function showExistingMedia(media) {
  profileImagePreview.innerHTML = "";
  (media || []).forEach((src) => {
    const tile = document.createElement("div");
    tile.className = "preview-tile";
    tile.innerHTML = `<img src="${src}" alt="${t("cover_images_optional")}" loading="lazy" />`;
    profileImagePreview.appendChild(tile);
    enhancePreviewImage(tile.querySelector("img"));
  });
}

async function loadProfilePosts() {
  if (!currentUser) return;
  profilePosts?.classList.add("loading");
  profilePosts?.setAttribute("aria-busy", "true");
  if (profileStatus) profileStatus.textContent = t("loading_your_stories");
  const authorName = await resolveAuthorName();
  try {
    const posts = await fetchPosts(true);
    const owned = posts.filter((p) => isOwnedPost(p, authorName));
    profileStatus.textContent = owned.length ? t("profile_posts_count", { count: owned.length }) : t("profile_no_posts");
    if (profileOwnedCount) profileOwnedCount.textContent = String(owned.length);
    if (profileCommunityCount) profileCommunityCount.textContent = String(posts.length);
    renderPosts(owned);
  } catch (e) {
    console.error("Failed to load profile posts:", e);
    profileStatus.textContent = t("profile_load_error");
    showToast(t("toast_failed_load_posts", { error: e.message || e }), "error");
  } finally {
    profilePosts?.classList.remove("loading");
    profilePosts?.setAttribute("aria-busy", "false");
  }
}

async function loadLandmarkSummary() {
  try {
    const landmarks = await fetchLandmarks(true);
    if (profileLandmarkCount) profileLandmarkCount.textContent = String(landmarks.length);
  } catch (e) {
    console.warn("Failed to load landmark count:", e);
  }
}

// Handle both edit and delete button clicks
profilePosts?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  
  if (action === "edit") {
    loadEditById(id);
  } else if (action === "delete") {
    await handleDeletePost(id, btn);
  }
});

async function handleDeletePost(id, btn) {
  if (!confirm(t("confirm_delete_post"))) {
    return;
  }
  
  // Disable button during operation
  btn.disabled = true;
  btn.textContent = t("deleting");
  
  try {
    await deletePost(id);
    showToast(t("toast_post_deleted"), "success");
    // Reload posts to reflect deletion
    await loadProfilePosts();
  } catch (e) {
    console.error("Delete failed:", e);
    showToast(t("toast_delete_failed", { error: e.message || e }), "error");
    btn.disabled = false;
    btn.textContent = t("delete");
  }
}

async function loadEditById(id) {
  try {
    const posts = await fetchPosts(true);
    const target = posts.find((p) => p.id === id);
    if (!target) {
      showToast(t("toast_post_not_found"), "warn");
      return;
    }
    currentEditPost = target;
    currentMedia = Array.isArray(target.media) ? target.media : target.coverUrl ? [target.coverUrl] : [];
    profilePostTitle.value = target.title || "";
    profileEditor.innerHTML = target.content || "";
    profileImageInput.value = "";
    showExistingMedia(currentMedia);
    editDialog.showModal();
  } catch (e) {
    console.error("Failed to load post for editing:", e);
    showToast(t("toast_failed_load_post", { error: e.message || e }), "error");
  }
}

profileImageInput?.addEventListener("change", () => {
  const files = Array.from(profileImageInput.files || []).slice(0, MAX_IMAGES_PER_POST);
  if (files.length > MAX_IMAGES_PER_POST) {
    showToast(t("toast_profile_upload_limit", { limit: MAX_IMAGES_PER_POST }), "warn");
  }
  profileImagePreview.innerHTML = "";
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    const tile = document.createElement("div");
    tile.className = "preview-tile";
    tile.innerHTML = `<img src="${url}" alt="${file.name}" loading="lazy" />`;
    profileImagePreview.appendChild(tile);
    enhancePreviewImage(tile.querySelector("img"));
  });
});

profileSaveBtn?.addEventListener("click", async () => {
  if (saving || !currentEditPost) return;
  const title = profilePostTitle.value.trim();
  const content = normalizeContent(profileEditor.innerHTML.trim());
  if (!title || !content) {
    showToast(t("toast_title_content_required"), "warn");
    return;
  }

  saving = true;
  profileSaveBtn.textContent = t("saving");
  profileSaveBtn.disabled = true;

  let media = currentMedia;
  const selected = Array.from(profileImageInput.files || []).slice(0, MAX_IMAGES_PER_POST);
  if (selected.length) {
    try {
      media = await uploadImages(selected);
    } catch (e) {
      console.error("Image upload failed:", e);
      showToast(t("toast_profile_image_upload_failed"), "warn");
      media = currentMedia;
    }
  }

  try {
    const authorName = await resolveAuthorName();
    await savePost({
      id: currentEditPost.id,
      title,
      content,
      media,
      author: authorName,
      authorId: currentUser.uid,
    });
    showToast(t("toast_post_updated"), "success");
    editDialog.close();
    await loadProfilePosts();
  } catch (e) {
    console.error("Update failed:", e);
    showToast(t("toast_profile_update_failed", { error: e.message || e }), "error");
  } finally {
    saving = false;
    profileSaveBtn.textContent = t("save_changes");
    profileSaveBtn.disabled = false;
  }
});

closeEdit?.addEventListener("click", () => editDialog.close());

logoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (e) {
    console.error("Logout failed:", e);
    showToast(t("toast_logout_failed", { error: e.message || e }), "error");
  }
});

mobileLogoutBtn?.addEventListener("click", async () => {
  try {
    await logout();
    window.location.href = "index.html";
  } catch (e) {
    console.error("Logout failed:", e);
    showToast(t("toast_logout_failed", { error: e.message || e }), "error");
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
  } catch (err) {
    console.error("Password change failed:", err);
    showToast(t("toast_current_pass_wrong"), "error");
  }
});

themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  applyTheme(current === "light" ? "dark" : "light");
});

mobileThemeToggle?.addEventListener("click", () => {
  themeToggle?.click();
  mobileMenu?.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
});

shareLocationBtn?.addEventListener("click", requestLocationShare);
shareLocationQuickAction?.addEventListener("click", requestLocationShare);
emergencyBtn?.addEventListener("click", openEmergencyDialog);
emergencyQuickAction?.addEventListener("click", openEmergencyDialog);
closeLocationConsent?.addEventListener("click", () => locationConsentDialog?.close());
locationConsentDecline?.addEventListener("click", () => locationConsentDialog?.close());
locationConsentAgree?.addEventListener("click", async () => {
  if (!currentUser) {
    locationConsentDialog?.close();
    showToast("Please log in first before sharing your location.", "warn");
    return;
  }

  try {
    locationConsentAgree.disabled = true;
    const savedConsent = await acknowledgeLocationConsent();
    currentLocationRecord = savedConsent || currentLocationRecord;
    locationConsentDialog?.close();
    renderLocationShareState(savedConsent);
    await syncSharedLocation();
  } catch (error) {
    console.error("Failed to save location consent:", error);
    showToast(error?.message || "Could not save your location agreement.", "error");
  } finally {
    locationConsentAgree.disabled = false;
  }
});

function resetEmergencyDialog() {
  if (emergencyMessage) emergencyMessage.value = "";
  if (emergencyImageInput) emergencyImageInput.value = "";
  if (emergencyImagePreview) emergencyImagePreview.innerHTML = "";
}

closeEmergencyDialog?.addEventListener("click", () => emergencyDialog?.close());
cancelEmergencyBtn?.addEventListener("click", () => emergencyDialog?.close());
emergencyDialog?.addEventListener("close", resetEmergencyDialog);

emergencyImageInput?.addEventListener("change", () => {
  const file = emergencyImageInput.files?.[0];
  emergencyImagePreview.innerHTML = "";
  if (!file) return;

  const url = URL.createObjectURL(file);
  const tile = document.createElement("div");
  tile.className = "preview-tile";
  tile.innerHTML = `<img src="${url}" alt="${file.name}" loading="lazy" />`;
  emergencyImagePreview.appendChild(tile);
  enhancePreviewImage(tile.querySelector("img"));
});

sendEmergencyBtn?.addEventListener("click", async () => {
  if (!currentUser || emergencyBusy) return;

  const message = emergencyMessage?.value.trim() || "";
  const file = emergencyImageInput?.files?.[0] || null;

  if (!message) {
    showToast("Please explain the emergency before sending.", "warn");
    return;
  }

  if (!file) {
    showToast("Image proof is required before sending the emergency alert.", "warn");
    return;
  }

  emergencyBusy = true;
  renderLocationShareState();
  sendEmergencyBtn.disabled = true;

  try {
    const position = await getCurrentPosition();
    const uploaded = await uploadImages([file]);
    const imageUrl = uploaded?.[0];
    if (!imageUrl) {
      throw new Error("Could not upload the emergency image proof.");
    }

    currentLocationRecord = await submitEmergencyReport({
      message,
      imageUrl,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });

    renderLocationShareState(currentLocationRecord);
    emergencyDialog?.close();
    showToast("Your emergency alert was sent to the admin tracker.", "success");
  } catch (error) {
    console.error("Emergency submission failed:", error);
    showToast(error?.message || "Could not send the emergency alert.", "error");
  } finally {
    emergencyBusy = false;
    sendEmergencyBtn.disabled = false;
    renderLocationShareState();
  }
});

menuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenu?.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

observeAuth(async (user) => {
  if (typeof sharedLocationUnsub === "function") {
    try {
      sharedLocationUnsub();
    } catch (error) {
      console.warn("Failed to unsubscribe shared location listener:", error);
    }
  }
  sharedLocationUnsub = null;

  currentUser = user || null;
  if (!currentUser) {
    profileStatus.textContent = t("profile_login_required");
    renderProfileIdentity({ username: "--", email: "--" });
    renderWorkspaceSummary({ role: t("guest_role"), ownedCount: 0, communityCount: 0, landmarkCount: 0, admin: false });
    renderLocationShareState(null);
    profileEmpty?.classList.remove("hidden");
    profilePosts.innerHTML = "";
    return;
  }
  
  try {
    const profile = await getUserProfile(currentUser.uid);
    const username =
      profile?.username ||
      currentUser.displayName ||
      (currentUser.email ? currentUser.email.split("@")[0] : t("contributor"));
    const email = profile?.email || currentUser.email || "--";
    cachedAuthorName = username;
    renderProfileIdentity({ username, email });
  } catch (e) {
    console.warn("Failed to load profile, using fallback:", e);
    const fallbackName = currentUser.email ? currentUser.email.split("@")[0] : t("contributor");
    cachedAuthorName = fallbackName;
    renderProfileIdentity({ username: fallbackName, email: currentUser.email || "--" });
  }

  const adminUser = isAdmin(currentUser);
  renderWorkspaceSummary({
    role: adminUser ? t("administrator_role") : t("member_role"),
    admin: adminUser,
  });

  try {
    currentLocationRecord = await fetchSharedLocation(currentUser.uid, true);
  } catch (error) {
    console.warn("Failed to load shared location state:", error);
    currentLocationRecord = null;
  }

  renderLocationShareState(currentLocationRecord);
  sharedLocationUnsub = observeSharedLocation(currentUser.uid, (record) => {
    currentLocationRecord = record;
    renderLocationShareState(currentLocationRecord);
  });

  await Promise.all([
    loadProfilePosts(),
    loadLandmarkSummary(),
  ]);
});

window.addEventListener("posts-updated", () => {
  if (currentUser) loadProfilePosts();
});

window.addEventListener("landmarks-updated", () => {
  if (currentUser) loadLandmarkSummary();
});

window.addEventListener("beforeunload", () => {
  if (typeof sharedLocationUnsub === "function") {
    try {
      sharedLocationUnsub();
    } catch (error) {
      console.warn("Failed to clean up shared location listener:", error);
    }
  }
  sharedLocationUnsub = null;
});

initI18n();
initTheme();
initRevealAnimations();
bindToolbar(profileEditor, profileToolbar);
registerServiceWorker();
