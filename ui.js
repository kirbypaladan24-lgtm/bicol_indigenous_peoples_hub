// ui.js
import { t } from "./i18n.js";
const toastEl = document.getElementById("toast");
const lightbox = document.getElementById("mediaLightbox");
const lightboxCloseBtn = document.getElementById("lightboxClose");
const lightboxPrevBtn = document.getElementById("lightboxPrev");
const lightboxNextBtn = document.getElementById("lightboxNext");

// Lightbox slider state
let lightboxItems = [];
let lightboxIndex = 0;
let _isTransitioning = false;
let sliderContainer = null;
let imgA = null;
let imgB = null;
let activeIsA = true;
let captionEl = null;

/* ---------- Lightbox slider (single instance) ---------- */
function ensureLightboxSlider() {
  if (sliderContainer) return;
  const existingImg = document.getElementById("lightboxImg");
  sliderContainer = document.createElement("div");
  sliderContainer.className = "lightbox-slider";
  sliderContainer.style.maxWidth = "96vw";
  sliderContainer.style.maxHeight = "92vh";
  sliderContainer.style.position = "relative";

  imgA = document.createElement("img");
  imgB = document.createElement("img");
  imgA.className = "slide-img";
  imgB.className = "slide-img";

  [imgA, imgB].forEach((imgEl) => {
    imgEl.style.maxWidth = "96vw";
    imgEl.style.maxHeight = "92vh";
    imgEl.style.objectFit = "contain";
    imgEl.style.display = "block";
  });

  captionEl = document.createElement("div");
  captionEl.className = "lightbox-caption";
  captionEl.style.position = "absolute";
  captionEl.style.bottom = "18px";
  captionEl.style.left = "50%";
  captionEl.style.transform = "translateX(-50%)";
  captionEl.style.color = "white";
  captionEl.style.fontWeight = "700";
  captionEl.style.background = "rgba(0,0,0,0.45)";
  captionEl.style.padding = "6px 10px";
  captionEl.style.borderRadius = "10px";
  captionEl.style.zIndex = "6";
  captionEl.style.fontSize = "14px";

  sliderContainer.appendChild(imgA);
  sliderContainer.appendChild(imgB);
  sliderContainer.appendChild(captionEl);

  if (existingImg && existingImg.parentElement) {
    existingImg.parentElement.replaceChild(sliderContainer, existingImg);
  } else {
    lightbox.appendChild(sliderContainer);
  }

  if (lightbox) lightbox.style.zIndex = "100000";
}

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

function updateCaption(index) {
  if (!captionEl) return;
  const total = lightboxItems.length || 1;
  const item = lightboxItems[index] || {};
  const title = item.alt || "";
  captionEl.textContent = `${index + 1} / ${total}${title ? " — " + title : ""}`;
}

function updateLightboxNav() {
  const count = lightboxItems.length || 0;
  if (!lightboxPrevBtn || !lightboxNextBtn) return;
  if (count < 2) {
    lightboxPrevBtn.classList.add("hidden");
    lightboxNextBtn.classList.add("hidden");
    return;
  }
  lightboxPrevBtn.classList.toggle("hidden", lightboxIndex <= 0);
  lightboxNextBtn.classList.toggle("hidden", lightboxIndex >= count - 1);
}

function setLightboxImageImmediate(index) {
  ensureLightboxSlider();
  if (!lightboxItems.length) return;
  index = ((index % lightboxItems.length) + lightboxItems.length) % lightboxItems.length;
  const item = lightboxItems[index];
  const active = activeIsA ? imgA : imgB;
  const other = activeIsA ? imgB : imgA;
  if (sliderContainer && item?.width && item?.height) {
    sliderContainer.style.aspectRatio = `${item.width} / ${item.height}`;
  }
  active.src = item.src;
  active.alt = item.alt || t("post_media_alt");
  active.style.visibility = "visible";
  other.style.visibility = "hidden";
  other.src = "";
  active.style.transform = "translateX(0)";
  other.style.transform = "translateX(0)";
  lightboxIndex = index;
  updateCaption(lightboxIndex);
  updateLightboxNav();
  active.onload = () => {
    if (sliderContainer && active.naturalWidth && active.naturalHeight) {
      sliderContainer.style.aspectRatio = `${active.naturalWidth} / ${active.naturalHeight}`;
      item.width = active.naturalWidth;
      item.height = active.naturalHeight;
    }
  };
}

async function animateToIndex(targetIndex, direction = 1) {
  if (!lightboxItems.length || _isTransitioning) return;
  targetIndex = ((targetIndex % lightboxItems.length) + lightboxItems.length) % lightboxItems.length;
  if (targetIndex === lightboxIndex) return;
  _isTransitioning = true;
  ensureLightboxSlider();
  const active = activeIsA ? imgA : imgB;
  const incoming = activeIsA ? imgB : imgA;
  const item = lightboxItems[targetIndex];
  try {
    const img = await preloadImage(item.src);
    if (sliderContainer && img?.naturalWidth && img?.naturalHeight) {
      sliderContainer.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      item.width = img.naturalWidth;
      item.height = img.naturalHeight;
    }
  } catch (e) {
    console.warn("Lightbox preload failed:", item?.src, e);
  }
  incoming.style.transition = "none";
  active.style.transition = "none";
  incoming.style.visibility = "visible";
  incoming.style.transform = `translateX(${direction > 0 ? "100%" : "-100%"})`;
  incoming.src = item.src;
  incoming.alt = item.alt || t("post_media_alt");
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  incoming.offsetHeight;
  const dur = 360;
  incoming.style.transition = `transform ${dur}ms cubic-bezier(.2,.8,.2,1)`;
  active.style.transition = `transform ${dur}ms cubic-bezier(.2,.8,.2,1)`;
  requestAnimationFrame(() => {
    incoming.style.transform = "translateX(0)";
    active.style.transform = `translateX(${direction > 0 ? "-100%" : "100%"})`;
  });
  const onTransitionEnd = () => {
    active.style.transition = "none";
    active.style.visibility = "hidden";
    active.src = "";
    active.style.transform = "translateX(0)";
    incoming.style.transition = "none";
    incoming.style.transform = "translateX(0)";
    incoming.style.visibility = "visible";
    activeIsA = !activeIsA;
    lightboxIndex = targetIndex;
    updateCaption(lightboxIndex);
    updateLightboxNav();
    incoming.removeEventListener("transitionend", onTransitionEnd);
    setTimeout(() => {
      _isTransitioning = false;
    }, 24);
  };
  incoming.addEventListener("transitionend", onTransitionEnd);
  // safety fallback
  setTimeout(() => {
    if (_isTransitioning) onTransitionEnd();
  }, dur + 150);
}

/* Open/close lightbox */
function normalizeItems(itemsOrNull) {
  if (!itemsOrNull || !Array.isArray(itemsOrNull)) return null;
  return itemsOrNull.map((it) => {
    const src = it && it.src ? String(it.src) : "";
    const alt = it && it.alt ? String(it.alt) : "";
    try {
      return { src: new URL(src, location.href).href, alt };
    } catch (e) {
      return { src, alt };
    }
  });
}

function openLightbox(src, alt = t("post_media_full"), items = null, startIndex = 0) {
  const norm = normalizeItems(items) || (src ? [{ src: new URL(String(src), location.href).href, alt }] : [{ src, alt }]);
  const seen = new Set();
  lightboxItems = norm.filter((it) => {
    if (!it?.src) return false;
    if (seen.has(it.src)) return false;
    seen.add(it.src);
    return true;
  });
  const resolvedSrc = new URL(String(src), location.href).href;
  let si = Number(startIndex) || 0;
  const found = lightboxItems.findIndex((it) => it.src === resolvedSrc);
  if (found >= 0) si = found;
  si = Math.max(0, Math.min(si, lightboxItems.length - 1));
  lightboxIndex = si;
  ensureLightboxSlider();
  setLightboxImageImmediate(lightboxIndex);

  try {
    if (typeof lightbox.showModal === "function") {
      lightbox.showModal();
    } else {
      lightbox.setAttribute("open", "");
    }
  } catch (e) {
    lightbox.setAttribute("open", "");
  }
}

function closeLightbox() {
  if (!lightbox) return;
  try {
    if (typeof lightbox.close === "function") lightbox.close();
    else lightbox.removeAttribute("open");
  } catch (e) {
    lightbox.removeAttribute("open");
  }
  if (imgA) imgA.src = "";
  if (imgB) imgB.src = "";
  lightboxItems = [];
  lightboxIndex = 0;
}

lightboxCloseBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeLightbox();
});
lightboxPrevBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (lightboxItems.length < 2) return;
  if (lightboxIndex <= 0) return;
  animateToIndex(lightboxIndex - 1, -1);
});
lightboxNextBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (lightboxItems.length < 2) return;
  if (lightboxIndex >= lightboxItems.length - 1) return;
  animateToIndex(lightboxIndex + 1, 1);
});

lightbox?.addEventListener("click", (e) => {
  if (e.target.closest(".lightbox-nav") || e.target.closest(".lightbox-close") || e.target.closest(".lightbox-slider")) {
    return;
  }
  if (lightbox?.open || lightbox.hasAttribute("open")) closeLightbox();
});

window.addEventListener("keydown", (e) => {
  if (!(lightbox?.open || lightbox?.hasAttribute("open"))) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeLightbox();
    return;
  }
  if (lightboxItems.length < 2) return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    if (lightboxIndex >= lightboxItems.length - 1) return;
    animateToIndex(lightboxIndex + 1, 1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    if (lightboxIndex <= 0) return;
    animateToIndex(lightboxIndex - 1, -1);
  }
});

/* ---------- Inline Instagram-style carousel (per-post) ---------- */
function buildInstaCarousel(media = [], title = "") {
  const count = Array.isArray(media) ? media.length : 0;
  if (!count) return null;

  const container = document.createElement("div");
  container.className = "insta-carousel";

  const track = document.createElement("div");
  track.className = "insta-track";
  container.appendChild(track);

  const slides = [];
  const buildSlide = (src, realIndex, isClone = false) => {
    const slide = document.createElement("div");
    slide.className = "insta-slide";
    if (isClone) slide.dataset.clone = "true";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = src;
    img.alt = title || `Image ${realIndex + 1}`;
    img.draggable = false;
    img.dataset.realIndex = String(realIndex);
    slide.appendChild(img);
    track.appendChild(slide);
    slides.push(slide);
  };

  if (count > 1) {
    // clone last -> [last] [0..n-1] [first]
    buildSlide(media[count - 1], count - 1, true);
    media.forEach((src, i) => buildSlide(src, i, false));
    buildSlide(media[0], 0, true);
  } else {
    buildSlide(media[0], 0, false);
  }

  // Single click handler for all slides (no drag/swipe)
  track.addEventListener("click", (ev) => {
    const img = ev.target.closest("img");
    if (!img) return;
    ev.stopPropagation();
    const realIndex = Number(img.dataset.realIndex) || 0;
    const items = media.map((u) => ({ src: u, alt: title || t("post_media_alt") }));
    openLightbox(media[realIndex], title || t("post_media_alt"), items, realIndex);
  });

  if (count > 1) {
    let idx = 1; // start at first real slide (after leading clone)
    const updateTrack = (animate = true) => {
      const percent = -idx * 100;
      if (!animate) {
        track.style.transition = "none";
      } else {
        track.style.transition = "transform 360ms cubic-bezier(.2,.8,.2,1)";
      }
      track.style.transform = `translateX(${percent}%)`;
      const active = (idx - 1 + count) % count;
      dotsContainer.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === active));
    };

    const prevBtn = document.createElement("button");
    prevBtn.className = "insta-nav insta-prev";
    prevBtn.type = "button";
    prevBtn.title = t("previous");
    prevBtn.innerHTML = "‹";
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      idx -= 1;
      updateTrack();
    });

    const nextBtn = document.createElement("button");
    nextBtn.className = "insta-nav insta-next";
    nextBtn.type = "button";
    nextBtn.title = t("next");
    nextBtn.innerHTML = "›";
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      idx += 1;
      updateTrack();
    });

    container.appendChild(prevBtn);
    container.appendChild(nextBtn);

    const dotsContainer = document.createElement("div");
    dotsContainer.className = "insta-dots";
    for (let i = 0; i < count; i++) {
      const d = document.createElement("button");
      d.className = "dot";
      d.type = "button";
      if (i === 0) d.classList.add("active");
      d.addEventListener("click", (e) => {
        e.stopPropagation();
        idx = i + 1;
        updateTrack();
      });
      dotsContainer.appendChild(d);
    }
    container.appendChild(dotsContainer);

    // seamless wrap after transition completes
    track.addEventListener("transitionend", () => {
      if (idx === 0) {
        idx = count;
        updateTrack(false);
      } else if (idx === count + 1) {
        idx = 1;
        updateTrack(false);
      }
    });

    // drag/swipe disabled to ensure reliable tap-to-open lightbox

    container.tabIndex = 0;
    container.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        idx -= 1;
        updateTrack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        idx += 1;
        updateTrack();
      }
    });

    slides.forEach((s) => (s.style.flex = "0 0 100%"));
    updateTrack(false);
    container.setAttribute("aria-roledescription", "carousel");
  } else {
    track.style.transform = "translateX(0)";
  }

  return container;
}

/* ---------- Rendering posts (uses buildInstaCarousel) ---------- */
export function renderPosts(posts) {
  const grid = document.getElementById("postsGrid");
  const empty = document.getElementById("postsEmpty");
  if (!grid) return;
  grid.className = "posts-feed";
  grid.innerHTML = "";
  if (!posts || !posts.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  posts.forEach((p) => {
    const article = document.createElement("article");
    article.className = "post-row";
    const author = (p.author || t("contributor")).trim();
    const avatar = author ? author.charAt(0).toUpperCase() : "C";

    // parse update date
    let updated = null;
    if (p.updatedAt?.toDate) {
      updated = p.updatedAt.toDate();
    } else if (typeof p.updatedAt === "number" || typeof p.updatedAt === "string") {
      const parsed = new Date(p.updatedAt);
      if (!isNaN(parsed)) updated = parsed;
    } else if (p.updatedAt?.seconds) {
      const parsed = new Date(p.updatedAt.seconds * 1000);
      if (!isNaN(parsed)) updated = parsed;
    }
    const meta = updated
      ? `${t("updated_prefix")} ${updated.toLocaleDateString()}`
      : t("recently_shared");

    // header
    const header = document.createElement("header");
    header.className = "post-head";
    header.innerHTML = `
      <div class="post-avatar">${avatar}</div>
      <div>
        <p class="post-author">${author}</p>
        <p class="post-meta">${meta}</p>
      </div>
    `;
    article.appendChild(header);

    // title & body
    const titleEl = document.createElement("h4");
    titleEl.className = "post-title";
    titleEl.textContent = p.title || t("untitled_post");
    article.appendChild(titleEl);

    const body = document.createElement("div");
    body.className = "post-body";
    body.innerHTML = p.content || "";
    linkifyElement(body);
    addYouTubePreviews(body);
    article.appendChild(body);

    // media -> carousel
    const mediaArray = Array.isArray(p.media) && p.media.length ? p.media : (p.coverUrl ? [p.coverUrl] : []);
    const carousel = buildInstaCarousel(mediaArray, p.title || "");
    if (carousel) {
      const wrapper = document.createElement("div");
      wrapper.className = "post-media";
      wrapper.appendChild(carousel);
      article.appendChild(wrapper);
    }

    // collapse long bodies
    const toggleLimit = 280;
    if (body) {
      requestAnimationFrame(() => {
        if (body.scrollHeight > toggleLimit * 1.05) {
          body.classList.add("collapsed");
          const toggleBtn = document.createElement("button");
          toggleBtn.className = "post-toggle";
          toggleBtn.textContent = t("see_more");
          toggleBtn.addEventListener("click", () => {
            const isCollapsed = body.classList.toggle("collapsed");
            toggleBtn.textContent = isCollapsed ? t("see_more") : t("see_less");
          });
          body.after(toggleBtn);
        }
      });
    }

    // clickable images: combine media + inline images and bind handlers
    const resolveUrl = (s) => {
      try {
        return new URL(String(s), location.href).href;
      } catch (e) {
        return String(s);
      }
    };

    const bodyImgs = Array.from(body.querySelectorAll("img")).map((i) => resolveUrl(i.src)).filter(Boolean);
    const mediaResolved = (mediaArray || []).map((m) => resolveUrl(m));
    const allItemsSrc = Array.from(new Set([...mediaResolved, ...bodyImgs]));
    const items = allItemsSrc.map((src) => ({ src, alt: p.title || t("post_media_alt") }));

    const images = Array.from(article.querySelectorAll("img"));
    images.forEach((imgEl) => {
      if (imgEl.closest(".insta-carousel")) return;
      if (!imgEl.loading) imgEl.loading = "lazy";
      imgEl.style.cursor = "pointer";
      imgEl.draggable = false;
      if (imgEl.__lightboxBound) return;
      imgEl.__lightboxBound = true;
      imgEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const anchor = imgEl.closest("a");
        if (anchor) ev.preventDefault();
        const clickedSrc = resolveUrl(imgEl.src);
        const startIndex = items.findIndex((it) => it.src === clickedSrc);
        openLightbox(clickedSrc, p.title || t("post_media_alt"), items, startIndex >= 0 ? startIndex : 0);
      });
    });

    // reactions row
    const reactions = document.createElement("div");
    reactions.className = "post-reactions";
    const likes = Math.max(0, Number(p.likes || 0));
    const dislikes = Math.max(0, Number(p.dislikes || 0));
    reactions.innerHTML = `
      <button class="react-btn" data-action="like">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 10V5.5c0-1.6 1-3 2.5-3 .7 0 1.2.6 1.1 1.3l-.6 3.2H18c1.1 0 2 .9 2 2 0 .2 0 .4-.1.6l-1.6 6.4c-.2.9-1 1.5-1.9 1.5H9.5c-.8 0-1.5-.7-1.5-1.5V10H9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M5 10h3v8H5c-.6 0-1-.4-1-1v-6c0-.6.4-1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <span class="count">${likes}</span>
      </button>
      <button class="react-btn" data-action="dislike">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 14v4.5c0 1.6-1 3-2.5 3-.7 0-1.2-.6-1.1-1.3l.6-3.2H6c-1.1 0-2-.9-2-2 0-.2 0-.4.1-.6l1.6-6.4c.2-.9 1-1.5 1.9-1.5H14.5c.8 0 1.5.7 1.5 1.5V14H15Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M19 14h-3V6h3c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <span class="count">${dislikes}</span>
      </button>
    `;
    article.appendChild(reactions);

    const share = document.createElement("div");
    share.className = "post-share";
    share.innerHTML = `
      <button class="share-btn" type="button">${t("share")}</button>
      <div class="share-menu hidden">
        <button class="share-item" data-action="copy">${t("copy_link")}</button>
        <a class="share-item" data-platform="facebook" target="_blank" rel="noopener noreferrer">Facebook</a>
        <a class="share-item" data-platform="twitter" target="_blank" rel="noopener noreferrer">X (Twitter)</a>
        <a class="share-item" data-platform="messenger" target="_blank" rel="noopener noreferrer">Messenger</a>
        <a class="share-item" data-platform="whatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a class="share-item" data-platform="telegram" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a class="share-item" data-platform="viber" target="_blank" rel="noopener noreferrer">Viber</a>
        <a class="share-item" data-platform="email" target="_blank" rel="noopener noreferrer">Email</a>
      </div>
    `;
    article.appendChild(share);

    bindReactions(article, p);
    bindShare(article, p);
    grid.appendChild(article);
  });
}

function bindShare(article, post) {
  const btn = article.querySelector(".share-btn");
  const menu = article.querySelector(".share-menu");
  if (!btn || !menu) return;
  const id = post?.id || "";
  const title = post?.title || t("page_title");
  const url = id ? `${location.origin}${location.pathname}#post-${id}` : location.href;
  article.id = id ? `post-${id}` : "";

  const links = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    messenger: `https://www.facebook.com/dialog/send?link=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(title + " " + url)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    viber: `viber://forward?text=${encodeURIComponent(title + " " + url)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  };

  menu.querySelectorAll("[data-platform]").forEach((a) => {
    const platform = a.dataset.platform;
    a.href = links[platform] || url;
  });

  const closeMenu = () => menu.classList.add("hidden");

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // fallback to menu
      }
    }
    menu.classList.toggle("hidden");
  });

  menu.querySelector('[data-action="copy"]')?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      const tmp = document.createElement("input");
      tmp.value = url;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      document.body.removeChild(tmp);
    }
    closeMenu();
  });

  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !article.contains(e.target)) closeMenu();
  });
}

function bindReactions(article, post) {
  const id = post?.id;
  if (!id) return;
  const key = `post-reaction:${id}`;
  const stored = localStorage.getItem(key); // "like" | "dislike" | null
  const likeBtn = article.querySelector('.react-btn[data-action="like"]');
  const dislikeBtn = article.querySelector('.react-btn[data-action="dislike"]');
  if (!likeBtn || !dislikeBtn) return;
  const likeCountEl = likeBtn.querySelector(".count");
  const dislikeCountEl = dislikeBtn.querySelector(".count");
  if (stored === "like") likeBtn.classList.add("active");
  if (stored === "dislike") dislikeBtn.classList.add("active");

  const getCount = (el) => Math.max(0, Number(el?.textContent || 0));
  const setCount = (el, val) => { if (el) el.textContent = Math.max(0, val); };
  const adjust = (el, delta) => setCount(el, getCount(el) + delta);

  const setActive = (likeActive, dislikeActive) => {
    likeBtn.classList.toggle("active", likeActive);
    dislikeBtn.classList.toggle("active", dislikeActive);
  };

  likeBtn.addEventListener("click", async () => {
    if (!requireLoginOrPrompt()) return;
    const current = localStorage.getItem(key);
    let likeDelta = 0;
    let dislikeDelta = 0;
    if (current === "like") {
      // remove like
      likeDelta = -1;
      adjust(likeCountEl, -1);
      localStorage.removeItem(key);
      setActive(false, false);
    } else {
      // add like, remove dislike if exists
      likeDelta = 1;
      adjust(likeCountEl, 1);
      if (current === "dislike") {
        if (getCount(dislikeCountEl) > 0) {
          dislikeDelta = -1;
          adjust(dislikeCountEl, -1);
        }
      }
      localStorage.setItem(key, "like");
      setActive(true, false);
    }
    try {
      const { updatePostReactions } = await import("./auth.js");
      await updatePostReactions(id, { likeDelta, dislikeDelta });
      console.log('✅ Like updated for post:', id);
    } catch (e) {
      console.error('❌ Like failed for post:', id, e);
      // revert on failure
      if (likeDelta) adjust(likeCountEl, -likeDelta);
      if (dislikeDelta) adjust(dislikeCountEl, -dislikeDelta);
      showToast("Failed to save like. Please try again.", "error");
    }
  });

  dislikeBtn.addEventListener("click", async () => {
    if (!requireLoginOrPrompt()) return;
    const current = localStorage.getItem(key);
    let likeDelta = 0;
    let dislikeDelta = 0;
    if (current === "dislike") {
      if (getCount(dislikeCountEl) > 0) {
        dislikeDelta = -1;
        adjust(dislikeCountEl, -1);
      }
      localStorage.removeItem(key);
      setActive(false, false);
    } else {
      dislikeDelta = 1;
      adjust(dislikeCountEl, 1);
      if (current === "like") {
        if (getCount(likeCountEl) > 0) {
          likeDelta = -1;
          adjust(likeCountEl, -1);
        }
      }
      localStorage.setItem(key, "dislike");
      setActive(false, true);
    }
    try {
      const { updatePostReactions } = await import("./auth.js");
      await updatePostReactions(id, { likeDelta, dislikeDelta });
      console.log('✅ Dislike updated for post:', id);
    } catch (e) {
      console.error('❌ Dislike failed for post:', id, e);
      if (likeDelta) adjust(likeCountEl, -likeDelta);
      if (dislikeDelta) adjust(dislikeCountEl, -dislikeDelta);
      showToast("Failed to save dislike. Please try again.", "error");
    }
  });
}

function requireLoginOrPrompt() {
  try {
    const authDialog = document.getElementById("authDialog");
    const isAuthed = window.__currentUser != null;
    if (isAuthed) return true;
    if (authDialog?.showModal) authDialog.showModal();
    return false;
  } catch (e) {
    const authDialog = document.getElementById("authDialog");
    if (authDialog?.showModal) authDialog.showModal();
    return false;
  }
}

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

/* ---------- Capture-phase pointer tap detector (robust for carousels) ---------- */
(function installCaptureTapDetector() {
  const TAP_MOVE_THRESHOLD = 12; // px
  const TAP_TIME_THRESHOLD = 450; // ms
  const activePointers = new Map(); // pointerId -> {x,y,t,target}

  document.addEventListener(
    "pointerdown",
    (e) => {
      try {
        const img = e.target.closest("img");
        const article = e.target.closest(".post-row");
        if (!img || !article) return;
        if (img.closest(".insta-carousel")) return;
        // only primary
        if (e.button && e.button !== 0) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), target: img, article });
      } catch (err) {}
    },
    { capture: true }
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      try {
        const rec = activePointers.get(e.pointerId);
        if (!rec) return;
        const dx = e.clientX - rec.x;
        const dy = e.clientY - rec.y;
        if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) {
          // movement exceeded threshold => not a tap
          activePointers.delete(e.pointerId);
        }
      } catch (err) {}
    },
    { capture: true }
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      try {
        const rec = activePointers.get(e.pointerId);
        if (!rec) return activePointers.delete(e.pointerId);
        activePointers.delete(e.pointerId);
        const dt = Date.now() - rec.t;
        if (dt > TAP_TIME_THRESHOLD) return;
        // confirm pointerup target is same image or inside same article and target is an image
        const upImg = e.target.closest("img");
        if (!upImg) return;
        const article = rec.article;
        if (!article || !article.contains(upImg)) return;
        // Prevent double handling if per-image click handler already fired immediately
        if (upImg.__lightboxBound && upImg.__lastOpenAt && Date.now() - upImg.__lastOpenAt < 300) return;
        // Build items for article
        const resolveUrl = (s) => {
          try {
            return new URL(String(s), location.href).href;
          } catch (err) {
            return String(s);
          }
        };
        const allImgs = Array.from(article.querySelectorAll("img")).map((i) => resolveUrl(i.src));
        // Try to include carousel-provided media as first (if any)
        // If the post's carousel exists, it will create .insta-slide images; order preserved by DOM
        const uniq = Array.from(new Set(allImgs));
        const title = article.querySelector(".post-title")?.textContent || "";
        const items = uniq.map((src) => ({ src, alt: title || t("post_media_alt") }));
        const clickedSrc = resolveUrl(upImg.src);
        const idx = uniq.indexOf(clickedSrc);
        // mark time to prevent immediate duplicate
        upImg.__lastOpenAt = Date.now();
        openLightbox(clickedSrc, title || t("post_media_alt"), items, idx >= 0 ? idx : 0);
        // prevent default navigation when image inside anchor
        const anchor = upImg.closest("a");
        if (anchor) e.preventDefault();
        e.stopPropagation();
      } catch (err) {}
    },
    { capture: true }
  );

  document.addEventListener(
    "pointercancel",
    (e) => {
      try {
        activePointers.delete(e.pointerId);
      } catch (err) {}
    },
    { capture: true }
  );
})();

/* ---------- Delegated fallback click handler (extra safety) ---------- */
document.addEventListener("click", (ev) => {
  try {
    const img = ev.target.closest("img");
    if (!img) return;
    const article = img.closest(".post-row");
    if (!article) return;
    if (img.__lightboxBound) return;
    ev.preventDefault?.();
    const resolveUrl = (s) => {
      try {
        return new URL(String(s), location.href).href;
      } catch (e) {
        return String(s);
      }
    };
    const allImgs = Array.from(article.querySelectorAll("img")).map((i) => resolveUrl(i.src));
    const uniq = Array.from(new Set(allImgs));
    const title = article.querySelector(".post-title")?.textContent || "";
    const items = uniq.map((src) => ({ src, alt: title || t("post_media_alt") }));
    const clickedSrc = resolveUrl(img.src);
    const idx = uniq.indexOf(clickedSrc);
    img.__lightboxBound = true;
    img.style.cursor = "pointer";
    openLightbox(clickedSrc, title || t("post_media_alt"), items, idx >= 0 ? idx : 0);
  } catch (e) {}
});

/* ---------- Utilities: toast & stats ---------- */
export function showToast(message, variant = "info") {
  if (!toastEl) {
    console.warn("Toast element missing:", message);
    return;
  }
  const payload = {
    message,
    variant,
    duration: 3200,
  };

  if (!toastEl.__queue) {
    toastEl.__queue = [];
    toastEl.__active = false;
    toastEl.__lastMessage = "";
    toastEl.__lastAt = 0;
  }

  const now = Date.now();
  if (message === toastEl.__lastMessage && now - toastEl.__lastAt < 1800) {
    return;
  }
  toastEl.__lastMessage = message;
  toastEl.__lastAt = now;

  toastEl.__queue.push(payload);
  if (toastEl.__active) return;

  const runNext = () => {
    const next = toastEl.__queue.shift();
    if (!next) {
      toastEl.__active = false;
      return;
    }
    toastEl.__active = true;
    const icon =
      next.variant === "success"
        ? "✓"
        : next.variant === "error"
          ? "!"
          : next.variant === "warn"
            ? "⚠"
            : "ℹ";
    toastEl.classList.remove("hidden");
    toastEl.dataset.variant = next.variant;
    toastEl.innerHTML = `
      <span class="toast-inner">
        <span class="toast-icon" aria-hidden="true">${icon}</span>
        <span class="toast-message">${next.message}</span>
      </span>
    `;
    clearTimeout(toastEl.__timer);
    toastEl.__timer = setTimeout(() => {
      toastEl.classList.add("hidden");
      setTimeout(runNext, 180);
    }, next.duration);
  };

  runNext();
}

export function setStats({ postCount, groupCount, lastUpdated, userCount }) {
  if (postCount !== undefined) document.getElementById("postCount").textContent = postCount;
  if (groupCount !== undefined) document.getElementById("groupCount").textContent = groupCount;
  if (userCount !== undefined) document.getElementById("userCount").textContent = userCount;
  if (lastUpdated) document.getElementById("lastUpdated").textContent = lastUpdated;
}