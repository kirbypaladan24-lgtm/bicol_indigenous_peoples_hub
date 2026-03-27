import { fetchLandmark } from "./auth.js";
import { showToast } from "./ui.js";
import { registerServiceWorker } from "./pwa.js";

const THEME_KEY = "bicol-ip-theme";

const themeToggle = document.getElementById("themeToggle");

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
    showToast("Landmark not found.", "error");
    return;
  }

  summaryEl?.classList.add("loading");
  summaryEl?.setAttribute("aria-busy", "true");
  if (coverEl) coverEl.classList.add("loading");

  try {
    const item = await fetchLandmark(id, true);

    if (!item) {
      showToast("Landmark not found.", "error");
      return;
    }

    if (titleEl) titleEl.textContent = item.name || "Landmark";
    document.title = `${item.name || "Landmark"} | Bicol IP Hub`;

    if (summaryEl) {
      summaryEl.textContent = item.summary || "";
      linkifyElement(summaryEl);
      addYouTubePreviews(summaryEl);
    }

    if (item.coverUrl && coverEl) {
      coverEl.style.display = "block";
      coverEl.innerHTML = `<img src="${item.coverUrl}" alt="${item.name || "Landmark"}" style="width:100%; border-radius:12px; display:block;"/>`;
    } else if (coverEl) {
      coverEl.style.display = "none";
      coverEl.innerHTML = "";
    }
  } catch (e) {
    console.error("Load landmark failed:", e);
    showToast("Failed to load landmark: " + (e.message || e), "error");
  } finally {
    summaryEl?.classList.remove("loading");
    summaryEl?.setAttribute("aria-busy", "false");
    coverEl?.classList.remove("loading");
  }
}

initTheme();
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
        <img src="${thumb}" alt="YouTube preview" loading="lazy" />
        <div class="link-meta">
          <span class="link-title">YouTube Video</span>
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
