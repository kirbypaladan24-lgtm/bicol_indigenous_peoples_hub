import {
  savePost,
  deletePost,
  fetchPosts,
  fetchPost,
  isAdmin,
  getUserProfile,
  fetchLandmarks,
  saveLandmark,
  deleteLandmark,
} from "./auth.js";
import { uploadImages } from "./imgbb.js";
import { showToast } from "./ui.js";

const adminPanel = document.getElementById("adminPanel");
const adminStatus = document.getElementById("adminStatus");
const postTitle = document.getElementById("postTitle");
const imageInput = document.getElementById("imageInput");
const imagePreviewAdmin = document.getElementById("imagePreviewAdmin");
const editor = document.getElementById("richEditor");
const saveBtn = document.getElementById("savePostBtn");
const resetBtn = document.getElementById("resetPostBtn");
const listContainer = document.getElementById("adminPosts");
const landmarkName = document.getElementById("landmarkName");
const landmarkLat = document.getElementById("landmarkLat");
const landmarkLng = document.getElementById("landmarkLng");
const landmarkSummary = document.getElementById("landmarkSummary");
const landmarkCoverInput = document.getElementById("landmarkCoverInput");
const landmarkColor = document.getElementById("landmarkColor");
const saveLandmarkBtn = document.getElementById("saveLandmarkBtn");
const resetLandmarkBtn = document.getElementById("resetLandmarkBtn");
const landmarksList = document.getElementById("adminLandmarks");
const landmarkPickBtn = document.getElementById("landmarkPickBtn");
const landmarkMapEl = document.getElementById("landmarkMap");

let currentId = null;
let currentUser = null;
let cachedAuthorName = null;
let currentMedia = [];
let currentLandmarkId = null;
let currentLandmarkCover = null;
let landmarkMap = null;
let landmarkMarker = null;
let pickingMode = false;

/* Toolbar binding (uses document.execCommand for simple rich editor controls) */
function bindToolbar() {
  const toolbar = adminPanel?.querySelector(".toolbar");
  const buttons = toolbar ? Array.from(toolbar.querySelectorAll("button")) : [];
  const selects = toolbar ? Array.from(toolbar.querySelectorAll("select")) : [];
  const stateful = [
    "bold",
    "italic",
    "underline",
    "insertOrderedList",
    "insertUnorderedList",
    "justifyLeft",
    "justifyCenter",
    "justifyRight",
  ];
  const focusEditor = () => editor?.focus({ preventScroll: true });
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
        } catch (e) {
          // some commands may throw in some browsers; ignore
        }
      }
    });
  }

  toolbar?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;
    focusEditor();
    if (cmd === "createLink") {
      const url = prompt("Enter URL (https://...)");
      if (url) document.execCommand(cmd, false, url);
    } else if (cmd === "formatBlock") {
      try {
        document.execCommand(cmd, false, normalizeBlockValue(value || "p"));
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    } else {
      try {
        document.execCommand(cmd, false, value);
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    }
    updateStates();
  });
  toolbar?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  selects.forEach((sel) =>
    sel.addEventListener("change", () => {
      const cmd = sel.dataset.cmd;
      const value = sel.value || "";
      if (!cmd || !value) return;
      focusEditor();
      if (cmd === "formatBlock") {
        try {
          document.execCommand(cmd, false, normalizeBlockValue(value));
        } catch (err) {
          console.warn("execCommand failed:", cmd, err);
        }
        return;
      }
      try {
        document.execCommand(cmd, false, value);
      } catch (err) {
        console.warn("execCommand failed:", cmd, err);
      }
    })
  );

  editor?.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });
  editor?.addEventListener("keydown", (e) => {
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

  ["keyup", "mouseup", "blur"].forEach((evt) =>
    editor?.addEventListener(evt, () => {
      updateStates();
    })
  );
}

/* Resolve author name using profile, displayName, or email */
async function resolveAuthorName() {
  if (!currentUser) return "Contributor";
  if (isAdmin(currentUser)) return "Admin";
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
  return "Contributor";
}

/* Render admin preview tiles for existing media URLs */
function renderAdminPreviews(urls = []) {
  if (!imagePreviewAdmin) return;
  imagePreviewAdmin.innerHTML = "";
  urls.forEach((u, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-tile";
    wrapper.innerHTML = `<img src="${u}" alt="media ${idx + 1}" /><button class="remove" data-idx="${idx}" title="Remove image">✕</button>`;
    imagePreviewAdmin.appendChild(wrapper);
  });
  // attach remove handlers
  imagePreviewAdmin.querySelectorAll(".remove").forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      currentMedia.splice(idx, 1);
      renderAdminPreviews(currentMedia);
    })
  );
}

/* When admin selects new files, show previews (object URLs). They will be uploaded on Save */
imageInput?.addEventListener("change", () => {
  const files = Array.from(imageInput.files || []);
  const trimmed = files.slice(0, 10);
  if (files.length > 10) {
    showToast("Only the first 10 selected images will be used.", "warn");
  }

  // First render existing media
  renderAdminPreviews(currentMedia);

  // Then append selected-file previews
  trimmed.forEach((f) => {
    const url = URL.createObjectURL(f);
    const wrapper = document.createElement("div");
    wrapper.className = "preview-tile";
    wrapper.innerHTML = `<img src="${url}" alt="${f.name}" />`;
    imagePreviewAdmin.appendChild(wrapper);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
});

/* Save handler: uploads newly selected files and merges with existing media */
async function handleSave() {
  const title = postTitle.value.trim();
  const content = normalizeContent(editor.innerHTML.trim());
  if (!title || !content) return showToast("Title and content are required", "warn");

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const selectedFiles = Array.from(imageInput.files || []);
    let uploadedUrls = [];
    if (selectedFiles.length) {
      uploadedUrls = await uploadImages(selectedFiles, {
        onProgress: (i, uploaded, total) => {
          saveBtn.textContent = `Uploading ${uploaded}/${total}...`;
        },
      });
    }

    // Merge preserved currentMedia with uploadedUrls; enforce cap
    const media = [...currentMedia, ...uploadedUrls].slice(0, 10);

    const authorName = await resolveAuthorName();
    await savePost({ id: currentId, title, content, media, author: authorName, authorId: currentUser?.uid || null });

    showToast(currentId ? "Post updated successfully." : "Post published successfully.", "success");
    
    // CRITICAL: Force server read to ensure fresh data
    await loadAdminPosts();
    window.dispatchEvent(new Event("posts-updated"));
    resetForm();
  } catch (e) {
    console.error("Save failed — full error:", e);
    showToast("Save failed: " + (e?.code ? `${e.code} — ${e.message}` : (e.message || e)), "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Publish / Update";
  }
}

function resetForm() {
  currentId = null;
  currentMedia = [];
  postTitle.value = "";
  editor.innerHTML = "";
  imageInput.value = "";
  if (imagePreviewAdmin) imagePreviewAdmin.innerHTML = "";
}

function normalizeContent(html) {
  if (!html) return "";
  const hasTags = /<\s*(p|div|br|ul|ol|li|blockquote|h\d)\b/i.test(html);
  if (!hasTags && html.includes("\n")) {
    return html.replace(/\n/g, "<br>");
  }
  return html;
}

function resetLandmarkForm() {
  currentLandmarkId = null;
  currentLandmarkCover = null;
  if (landmarkName) landmarkName.value = "";
  if (landmarkLat) landmarkLat.value = "";
  if (landmarkLng) landmarkLng.value = "";
  if (landmarkSummary) landmarkSummary.value = "";
  if (landmarkCoverInput) landmarkCoverInput.value = "";
  if (landmarkColor) landmarkColor.value = "#2f5c3a";
  if (landmarkMarker && landmarkMap) {
    landmarkMap.removeLayer(landmarkMarker);
    landmarkMarker = null;
  }
  if (landmarkMap) {
    landmarkMap.setView([12.8797, 121.7740], 6);
  }
  pickingMode = false;
  if (landmarkPickBtn) landmarkPickBtn.classList.remove("active");
}

function setLandmarkMarker(lat, lng, pan = true) {
  if (!landmarkMap || !isFinite(lat) || !isFinite(lng)) return;
  if (!landmarkMarker) {
    landmarkMarker = L.marker([lat, lng]).addTo(landmarkMap);
  } else {
    landmarkMarker.setLatLng([lat, lng]);
  }
  if (pan) landmarkMap.setView([lat, lng], landmarkMap.getZoom() || 11);
}

async function ensureLeaflet() {
  if (window.L) return;
  await new Promise((resolve, reject) => {
    const existing = document.getElementById("leaflet-fallback");
    if (existing) {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.id = "leaflet-fallback";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initLandmarkMap() {
  if (!landmarkMapEl) return;
  await ensureLeaflet();
  landmarkMapEl.innerHTML = "";
  landmarkMap = L.map(landmarkMapEl, {
    zoomControl: true,
    attributionControl: false,
  }).setView([12.8797, 121.7740], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(landmarkMap);

  landmarkMap.on("move", () => {
    if (!pickingMode) return;
    const center = landmarkMap.getCenter();
    if (landmarkLat) landmarkLat.value = center.lat.toFixed(6);
    if (landmarkLng) landmarkLng.value = center.lng.toFixed(6);
    setLandmarkMarker(center.lat, center.lng, false);
  });

  // if inputs already have values (non-empty), show marker
  const latRaw = landmarkLat?.value;
  const lngRaw = landmarkLng?.value;
  if (latRaw !== "" && lngRaw !== "") {
    const latVal = Number(latRaw);
    const lngVal = Number(lngRaw);
    if (isFinite(latVal) && isFinite(lngVal)) {
      setLandmarkMarker(latVal, lngVal);
    }
  }
}

async function handleSaveLandmark() {
  const name = landmarkName?.value.trim();
  const latRaw = landmarkLat?.value;
  const lngRaw = landmarkLng?.value;
  const lat = latRaw !== "" ? Number(latRaw) : NaN;
  const lng = lngRaw !== "" ? Number(lngRaw) : NaN;
  const summary = landmarkSummary?.value.trim() || "";
  const color = landmarkColor?.value || "#2f5c3a";
  if (!name || !isFinite(lat) || !isFinite(lng)) {
    return showToast("Name, latitude, and longitude are required.", "warn");
  }
  saveLandmarkBtn.disabled = true;
  saveLandmarkBtn.textContent = "Saving...";
  try {
    let coverUrl = currentLandmarkCover || null;
    if (landmarkCoverInput?.files?.length) {
      const [file] = landmarkCoverInput.files;
      const uploaded = await uploadImages([file]);
      coverUrl = uploaded[0] || coverUrl;
    }
    await saveLandmark({ id: currentLandmarkId, name, lat, lng, summary, coverUrl, color });
    showToast(currentLandmarkId ? "Landmark updated successfully." : "Landmark added successfully.", "success");
    
    // CRITICAL: Force server read to ensure fresh data
    await loadLandmarks();
    window.dispatchEvent(new Event("landmarks-updated"));
    resetLandmarkForm();
  } catch (e) {
    console.error("Save landmark failed", e);
    showToast("Save failed: " + (e.message || e), "error");
  } finally {
    saveLandmarkBtn.disabled = false;
    saveLandmarkBtn.textContent = "Save Landmark";
  }
}

async function loadLandmarks() {
  if (!landmarksList) return;
  landmarksList.innerHTML = "Loading...";
  try {
    // CRITICAL: Force server read for production P2P reliability
    const items = await fetchLandmarks(true);
    if (!items.length) {
      landmarksList.innerHTML = "<p class='hint'>No landmarks yet.</p>";
      return;
    }
    landmarksList.innerHTML = "";
    items.forEach((l) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div>
          <strong>${l.name || "Unnamed"}</strong>
          <div class="chip">${Number(l.lat).toFixed(5)}, ${Number(l.lng).toFixed(5)}</div>
        </div>
        <div class="list-actions">
          <button data-id="${l.id}" class="ghost small edit-landmark">Edit</button>
          <button data-id="${l.id}" class="ghost small delete-landmark">Delete</button>
        </div>
      `;
      landmarksList.appendChild(item);
    });

    landmarksList.querySelectorAll(".edit-landmark").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const item = items.find((it) => it.id === id);
        if (!item) return;
        currentLandmarkId = id;
        landmarkName.value = item.name || "";
        landmarkLat.value = item.lat ?? "";
        landmarkLng.value = item.lng ?? "";
        landmarkSummary.value = item.summary || "";
        currentLandmarkCover = item.coverUrl || null;
        if (landmarkColor) landmarkColor.value = item.color || "#2f5c3a";
        setLandmarkMarker(Number(item.lat), Number(item.lng));
      })
    );

    landmarksList.querySelectorAll(".delete-landmark").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete this landmark?")) return;
        try {
          await deleteLandmark(id);
          showToast("Landmark deleted successfully.", "success");
          // CRITICAL: Force server read after delete
          await loadLandmarks();
          window.dispatchEvent(new Event("landmarks-updated"));
        } catch (e) {
          console.error("Delete landmark failed", e);
          showToast("Delete failed: " + (e.message || e), "error");
        }
      })
    );
  } catch (e) {
    console.error("Load landmarks failed", e);
    landmarksList.innerHTML = "<p class='hint'>Unable to load landmarks.</p>";
    showToast("Failed to load landmarks: " + (e.message || e), "error");
  }
}

/* Load admin posts and populate list with Edit/Delete handlers */
async function loadAdminPosts() {
  if (!listContainer) return;
  listContainer.innerHTML = "Loading...";
  try {
    // CRITICAL: Force server read for production P2P reliability
    const posts = await fetchPosts(true);
    if (!posts || posts.length === 0) {
      listContainer.innerHTML = "<p class='hint'>No posts yet.</p>";
      return;
    }
    listContainer.innerHTML = "";
    posts.forEach((p) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div>
          <strong>${p.title || "Untitled"}</strong>
          <div class="chip">${p.author || "Unknown"}</div>
        </div>
        <div class="list-actions">
          <button data-id="${p.id}" class="ghost small edit">Edit</button>
          <button data-id="${p.id}" class="ghost small delete">Delete</button>
        </div>
      `;
      listContainer.appendChild(item);
    });

    // wire edit buttons
    listContainer.querySelectorAll(".edit").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          // CRITICAL: Force server read for edit to get fresh data
          const post = await fetchPost(id, true);
          if (!post) {
            showToast("Post not found.", "warn");
            return;
          }
          currentId = id;
          postTitle.value = post.title || "";
          editor.innerHTML = post.content || "";
          currentMedia = Array.isArray(post.media) ? post.media.slice() : (post.coverUrl ? [post.coverUrl] : []);
          renderAdminPreviews(currentMedia);
          // scroll to editor for convenience
          adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
          console.error("Failed to fetch post for edit:", e);
          showToast("Failed to load post for editing: " + (e.message || e), "error");
        }
      })
    );

    // wire delete buttons
    listContainer.querySelectorAll(".delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete this post?")) return;
        try {
          await deletePost(id);
          showToast("Post deleted successfully.", "success");
          // CRITICAL: Force server read after delete
          await loadAdminPosts();
          window.dispatchEvent(new Event("posts-updated"));
        } catch (e) {
          console.error("Delete failed — full error:", e);
          showToast("Delete failed: " + (e?.code ? `${e.code} — ${e.message}` : (e.message || e)), "error");
        }
      })
    );
  } catch (e) {
    console.error("Load posts failed:", e);
    listContainer.innerHTML = "<p class='hint'>Unable to load posts right now.</p>";
    showToast("Failed to load posts: " + (e.message || e), "error");
  }
}

export async function initAdmin(user) {
  currentUser = user;
  const canAdmin = isAdmin(user);
  adminStatus.textContent = canAdmin ? "Admin access granted" : "Restricted";
  if (adminStatus?.previousElementSibling) {
    adminStatus.previousElementSibling.style.background = canAdmin ? "limegreen" : "crimson";
  }
  if (!canAdmin) {
    adminPanel.classList.add("hidden");
    return;
  }
  adminPanel.classList.remove("hidden");

  // Initialize toolbar and handlers
  bindToolbar();
  saveBtn.onclick = handleSave;
  resetBtn.onclick = resetForm;

  // load posts with forced server read
  await loadAdminPosts();

  // landmarks panel (if present)
  if (saveLandmarkBtn && resetLandmarkBtn && landmarksList) {
    saveLandmarkBtn.onclick = handleSaveLandmark;
    resetLandmarkBtn.onclick = resetLandmarkForm;
    landmarkPickBtn?.addEventListener("click", () => {
      pickingMode = !pickingMode;
      landmarkPickBtn.classList.toggle("active", pickingMode);
      landmarkMapEl?.classList.toggle("picking", pickingMode);
      showToast(pickingMode ? "Click the map to select a location." : "Map selection off.", "info");
      if (pickingMode && landmarkMap) {
        const center = landmarkMap.getCenter();
        if (landmarkLat) landmarkLat.value = center.lat.toFixed(6);
        if (landmarkLng) landmarkLng.value = center.lng.toFixed(6);
        setLandmarkMarker(center.lat, center.lng, false);
      }
    });
    landmarkLat?.addEventListener("change", () => {
      const latRaw = landmarkLat.value;
      const lngRaw = landmarkLng?.value;
      if (latRaw === "" || lngRaw === "") {
        if (landmarkMarker && landmarkMap) {
          landmarkMap.removeLayer(landmarkMarker);
          landmarkMarker = null;
        }
        return;
      }
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (isFinite(lat) && isFinite(lng)) setLandmarkMarker(lat, lng);
    });
    landmarkLng?.addEventListener("change", () => {
      const latRaw = landmarkLat?.value;
      const lngRaw = landmarkLng.value;
      if (latRaw === "" || lngRaw === "") {
        if (landmarkMarker && landmarkMap) {
          landmarkMap.removeLayer(landmarkMarker);
          landmarkMarker = null;
        }
        return;
      }
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (isFinite(lat) && isFinite(lng)) setLandmarkMarker(lat, lng);
    });
    await initLandmarkMap();
    // Load landmarks with forced server read
    await loadLandmarks();
  }
}
