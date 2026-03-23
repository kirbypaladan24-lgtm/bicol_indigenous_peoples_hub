import { observeAuth, fetchPosts, savePost, logout, changePassword, auth, getUserProfile } from "./auth.js";
import { uploadImages } from "./imgbb.js";
import { showToast } from "./ui.js";

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

const THEME_KEY = "bicol-ip-theme";
const MAX_IMAGES_PER_POST = 10;

let currentUser = null;
let cachedAuthorName = null;
let currentEditPost = null;
let currentMedia = [];
let saving = false;

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
  if (!currentUser) return "Contributor";
  if (cachedAuthorName) return cachedAuthorName;
  try {
    const profile = await getUserProfile(currentUser.uid);
    if (profile?.username) {
      cachedAuthorName = profile.username;
      return cachedAuthorName;
    }
  } catch (e) {}
  if (currentUser.displayName) {
    cachedAuthorName = currentUser.displayName;
    return cachedAuthorName;
  }
  if (currentUser.email) {
    cachedAuthorName = currentUser.email.split("@")[0];
    return cachedAuthorName;
  }
  return "Contributor";
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
          <p class="post-author">${p.author || "Contributor"}</p>
          <p class="post-meta">${updated ? `Updated ${updated.toLocaleDateString()}` : "Recently shared"}</p>
        </div>
      </header>
      <h4 class="post-title">${p.title || "Untitled post"}</h4>
      <div class="post-body">${p.content || ""}</div>
      <div class="post-actions">
        <button class="ghost small" data-action="edit" data-id="${p.id}">Edit</button>
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
      const url = prompt("Enter URL");
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
    tile.innerHTML = `<img src="${src}" alt="Existing media" loading="lazy" />`;
    profileImagePreview.appendChild(tile);
  });
}

async function loadProfilePosts() {
  if (!currentUser) return;
  const authorName = await resolveAuthorName();
  const posts = await fetchPosts();
  const owned = posts.filter((p) => isOwnedPost(p, authorName));
  profileStatus.textContent = owned.length ? `You have ${owned.length} post(s).` : "You haven't shared any posts yet.";
  renderPosts(owned);
}

profilePosts?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action='edit']");
  if (!btn) return;
  const id = btn.dataset.id;
  const postCard = btn.closest(".post-row");
  const posts = Array.from(profilePosts.querySelectorAll(".post-row"));
  const idx = posts.indexOf(postCard);
  const postData = idx >= 0 ? null : null;
  loadEditById(id);
});

async function loadEditById(id) {
  const posts = await fetchPosts();
  const target = posts.find((p) => p.id === id);
  if (!target) {
    showToast("Post not found.", "warn");
    return;
  }
  currentEditPost = target;
  currentMedia = Array.isArray(target.media) ? target.media : target.coverUrl ? [target.coverUrl] : [];
  profilePostTitle.value = target.title || "";
  profileEditor.innerHTML = target.content || "";
  profileImageInput.value = "";
  showExistingMedia(currentMedia);
  editDialog.showModal();
}

profileImageInput?.addEventListener("change", () => {
  const files = Array.from(profileImageInput.files || []).slice(0, MAX_IMAGES_PER_POST);
  if (files.length > MAX_IMAGES_PER_POST) {
    showToast(`You can upload up to ${MAX_IMAGES_PER_POST} images.`, "warn");
  }
  profileImagePreview.innerHTML = "";
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    const tile = document.createElement("div");
    tile.className = "preview-tile";
    tile.innerHTML = `<img src="${url}" alt="${file.name}" loading="lazy" />`;
    profileImagePreview.appendChild(tile);
  });
});

profileSaveBtn?.addEventListener("click", async () => {
  if (saving || !currentEditPost) return;
  const title = profilePostTitle.value.trim();
  const content = normalizeContent(profileEditor.innerHTML.trim());
  if (!title || !content) {
    showToast("Title and content are required.", "warn");
    return;
  }

  saving = true;
  profileSaveBtn.textContent = "Saving...";
  profileSaveBtn.disabled = true;

  let media = currentMedia;
  const selected = Array.from(profileImageInput.files || []).slice(0, MAX_IMAGES_PER_POST);
  if (selected.length) {
    try {
      media = await uploadImages(selected);
    } catch (e) {
      showToast("Image upload failed. Keeping existing images.", "warn");
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
    showToast("Post updated successfully.", "success");
    editDialog.close();
    await loadProfilePosts();
  } catch (e) {
    showToast("Update failed: " + (e.message || e), "error");
  } finally {
    saving = false;
    profileSaveBtn.textContent = "Save changes";
    profileSaveBtn.disabled = false;
  }
});

closeEdit?.addEventListener("click", () => editDialog.close());

logoutBtn?.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
});

mobileLogoutBtn?.addEventListener("click", async () => {
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
  currentUser = user || null;
  if (!currentUser) {
    profileStatus.textContent = "Please log in to view your profile.";
    profileEmpty?.classList.remove("hidden");
    profilePosts.innerHTML = "";
    return;
  }
  await loadProfilePosts();
});

initTheme();
bindToolbar(profileEditor, profileToolbar);
