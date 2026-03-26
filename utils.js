// utils.js - Shared utilities for Bicol IP Hub
// Virtual scrolling, skeleton loaders, connection monitoring, performance utils

import { showToast } from "./ui.js";

// ==========================================
// Connection State Monitoring
// ==========================================

export const connectionState = {
  isOnline: navigator.onLine,
  connectionType: null,
  downlink: null,
  rtt: null,
  saveData: false,
  listeners: new Set()
};

/**
 * Initialize connection monitoring
 */
export function initConnectionMonitor() {
  // Update initial state
  updateConnectionState();
  
  // Listen for online/offline events
  window.addEventListener('online', () => {
    connectionState.isOnline = true;
    notifyListeners();
    showConnectionToast(true);
  });
  
  window.addEventListener('offline', () => {
    connectionState.isOnline = false;
    notifyListeners();
    showConnectionToast(false);
  });
  
  // Listen for connection changes (Chrome/Edge)
  if ('connection' in navigator) {
    const conn = navigator.connection;
    conn.addEventListener('change', () => {
      updateConnectionState();
      notifyListeners();
    });
  }
  
  // Create indicator element
  createConnectionIndicator();
  
  console.log('[Utils] Connection monitor initialized');
}

function updateConnectionState() {
  connectionState.isOnline = navigator.onLine;
  
  if ('connection' in navigator) {
    const conn = navigator.connection;
    connectionState.connectionType = conn.effectiveType || conn.type;
    connectionState.downlink = conn.downlink;
    connectionState.rtt = conn.rtt;
    connectionState.saveData = conn.saveData;
  }
}

function notifyListeners() {
  connectionState.listeners.forEach(cb => cb(connectionState));
}

export function onConnectionChange(callback) {
  connectionState.listeners.add(callback);
  callback(connectionState); // Immediate call with current state
  
  // Return unsubscribe function
  return () => connectionState.listeners.delete(callback);
}

function createConnectionIndicator() {
  if (document.getElementById('connection-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'connection-indicator';
  indicator.innerHTML = `
    <span class="indicator-dot"></span>
    <span class="indicator-text">Online</span>
  `;
  indicator.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    padding: 8px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    z-index: 9999;
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.3s ease;
    pointer-events: none;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    #connection-indicator.online .indicator-dot {
      background: #5a9a6a;
      box-shadow: 0 0 8px #5a9a6a;
    }
    #connection-indicator.offline .indicator-dot {
      background: #c0392b;
      box-shadow: 0 0 8px #c0392b;
    }
    #connection-indicator.slow .indicator-dot {
      background: #f39c12;
      box-shadow: 0 0 8px #f39c12;
    }
    .indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: all 0.3s ease;
    }
    #connection-indicator.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(indicator);
  
  // Update indicator on state change
  onConnectionChange((state) => {
    indicator.className = state.isOnline ? 
      (state.connectionType === '2g' || state.connectionType === 'slow-2g' ? 'slow' : 'online') : 
      'offline';
    indicator.querySelector('.indicator-text').textContent = state.isOnline ? 
      (state.saveData ? 'Data Saver On' : 'Online') : 'Offline';
    indicator.classList.add('visible');
    
    // Hide after 3 seconds if online
    if (state.isOnline) {
      setTimeout(() => indicator.classList.remove('visible'), 3000);
    }
  });
}

function showConnectionToast(isOnline) {
  // Import from ui.js or create simple toast
  const toast = document.getElementById('toast');
  if (toast && typeof showToast === 'function') {
    showToast(
      isOnline ? 'Back online' : 'You are offline. Changes will sync when reconnected.',
      isOnline ? 'success' : 'warn'
    );
  }
}

// ==========================================
// Skeleton Loading Screens
// ==========================================

export const skeletonStyles = `
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--card) 25%,
      var(--border) 50%,
      var(--card) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 8px;
  }
  
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  
  .skeleton-text {
    height: 1em;
    margin-bottom: 0.5em;
  }
  
  .skeleton-text.short { width: 60%; }
  .skeleton-text.medium { width: 80%; }
  .skeleton-text.long { width: 100%; }
  
  .skeleton-title {
    height: 1.5em;
    width: 70%;
    margin-bottom: 1em;
  }
  
  .skeleton-avatar {
    width: 44px;
    height: 44px;
    border-radius: 12px;
  }
  
  .skeleton-image {
    height: 200px;
    width: 100%;
    border-radius: 12px;
  }
  
  .skeleton-card {
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 16px;
  }
  
  .skeleton-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  
  .skeleton-stat {
    height: 60px;
    border-radius: 8px;
  }
  
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--border);
    }
  }
`;

/**
 * Inject skeleton styles
 */
export function injectSkeletonStyles() {
  if (document.getElementById('skeleton-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'skeleton-styles';
  style.textContent = skeletonStyles;
  document.head.appendChild(style);
}

/**
 * Create skeleton element
 */
export function createSkeleton(type, className = '') {
  const div = document.createElement('div');
  div.className = `skeleton skeleton-${type} ${className}`;
  div.setAttribute('aria-hidden', 'true');
  return div;
}

/**
 * Show skeleton loading state for posts
 */
export function showPostsSkeleton(container, count = 3) {
  injectSkeletonStyles();
  container.innerHTML = '';
  
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
      <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        ${createSkeleton('avatar').outerHTML}
        <div style="flex: 1;">
          ${createSkeleton('text', 'short').outerHTML}
          ${createSkeleton('text', 'short').outerHTML}
        </div>
      </div>
      ${createSkeleton('title').outerHTML}
      ${createSkeleton('text', 'long').outerHTML}
      ${createSkeleton('text', 'medium').outerHTML}
      ${createSkeleton('image').outerHTML}
    `;
    container.appendChild(card);
  }
}

/**
 * Show skeleton for stats
 */
export function showStatsSkeleton() {
  injectSkeletonStyles();
  const statsContainer = document.querySelector('.hero-card');
  if (!statsContainer) return;
  
  statsContainer.innerHTML = `
    <div class="skeleton-stats">
      ${createSkeleton('stat').outerHTML}
      ${createSkeleton('stat').outerHTML}
      ${createSkeleton('stat').outerHTML}
      ${createSkeleton('stat').outerHTML}
    </div>
  `;
}

// ==========================================
// Virtual Scrolling
// ==========================================

export class VirtualScroller {
  constructor(options) {
    this.container = options.container;
    this.itemHeight = options.itemHeight || 100;
    this.bufferSize = options.bufferSize || 5;
    this.totalItems = options.totalItems || 0;
    this.renderItem = options.renderItem;
    this.onVisibleRangeChange = options.onVisibleRangeChange;
    
    this.scrollTop = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.scrollHandler = this.handleScroll.bind(this);
    
    this.init();
  }
  
  init() {
    // Create scroll container
    this.viewport = document.createElement('div');
    this.viewport.style.cssText = `
      position: relative;
      height: ${this.container.clientHeight}px;
      overflow-y: auto;
      overflow-x: hidden;
    `;
    
    // Create content spacer
    this.spacer = document.createElement('div');
    this.spacer.style.height = `${this.totalItems * this.itemHeight}px`;
    
    // Create visible items container
    this.visibleContainer = document.createElement('div');
    this.visibleContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    `;
    
    this.viewport.appendChild(this.spacer);
    this.viewport.appendChild(this.visibleContainer);
    this.container.innerHTML = '';
    this.container.appendChild(this.viewport);
    
    this.viewport.addEventListener('scroll', this.scrollHandler, { passive: true });
    this.updateVisibleItems();
  }
  
  handleScroll() {
    this.scrollTop = this.viewport.scrollTop;
    requestAnimationFrame(() => this.updateVisibleItems());
  }
  
  updateVisibleItems() {
    const start = Math.floor(this.scrollTop / this.itemHeight);
    const visibleCount = Math.ceil(this.viewport.clientHeight / this.itemHeight);
    
    const newStart = Math.max(0, start - this.bufferSize);
    const newEnd = Math.min(this.totalItems, start + visibleCount + this.bufferSize);
    
    if (newStart === this.visibleStart && newEnd === this.visibleEnd) return;
    
    this.visibleStart = newStart;
    this.visibleEnd = newEnd;
    
    // Update visible container position
    this.visibleContainer.style.transform = `translateY(${newStart * this.itemHeight}px)`;
    
    // Render items
    this.visibleContainer.innerHTML = '';
    for (let i = newStart; i < newEnd; i++) {
      const item = this.renderItem(i);
      item.style.height = `${this.itemHeight}px`;
      this.visibleContainer.appendChild(item);
    }
    
    if (this.onVisibleRangeChange) {
      this.onVisibleRangeChange(newStart, newEnd);
    }
  }
  
  setTotalItems(count) {
    this.totalItems = count;
    this.spacer.style.height = `${count * this.itemHeight}px`;
    this.updateVisibleItems();
  }
  
  destroy() {
    this.viewport.removeEventListener('scroll', this.scrollHandler);
  }
}

// ==========================================
// Lazy Loading with Intersection Observer
// ==========================================

const lazyImageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      loadLazyImage(img);
      lazyImageObserver.unobserve(img);
    }
  });
}, {
  rootMargin: '50px 0px',
  threshold: 0.01
});

/**
 * Setup lazy loading for images
 */
export function setupLazyImages(container = document) {
  const images = container.querySelectorAll('img[data-src]');
  images.forEach(img => {
    img.classList.add('lazy-image');
    lazyImageObserver.observe(img);
  });
}

function loadLazyImage(img) {
  const src = img.dataset.src;
  const srcset = img.dataset.srcset;
  
  if (!src) return;
  
  // Create new image to preload
  const preload = new Image();
  
  preload.onload = () => {
    img.src = src;
    if (srcset) img.srcset = srcset;
    img.classList.add('loaded');
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
  };
  
  preload.onerror = () => {
    img.classList.add('error');
    img.dispatchEvent(new CustomEvent('lazyError', { detail: { src } }));
  };
  
  preload.src = src;
}

// Add lazy loading styles
export const lazyStyles = `
  .lazy-image {
    opacity: 0;
    transition: opacity 0.3s ease;
    background: var(--card);
  }
  
  .lazy-image.loaded {
    opacity: 1;
  }
  
  .lazy-image.error {
    opacity: 1;
    background: var(--border);
  }
`;

// ==========================================
// Responsive Image Srcset Generator
// ==========================================

export function generateSrcset(url, widths = [400, 800, 1200, 1600]) {
  // For ImgBB and similar, we can't generate real srcsets
  // This is a placeholder for when you use a proper image CDN
  if (!url || url.includes('ibb.co')) {
    return { src: url, srcset: null };
  }
  
  // Example for Cloudinary or similar CDN
  const srcset = widths
    .map(w => `${url.replace(/(\.[^.]+)$/, `_${w}$1`)} ${w}w`)
    .join(', ');
    
  return {
    src: url.replace(/(\.[^.]+)$/, `_${widths[0]}$1`),
    srcset
  };
}

// ==========================================
// Performance Utilities
// ==========================================

/**
 * Debounce function
 */
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Measure performance
 */
export function measurePerformance(name, fn) {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  console.log(`[Performance] ${name}: ${(end - start).toFixed(2)}ms`);
  return result;
}

/**
 * Preload critical resources
 */
export function preloadResource(href, as = 'script') {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = href;
  link.as = as;
  if (as === 'font') link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

// ==========================================
// Storage Utilities with Quota Management
// ==========================================

export const storage = {
  async getQuota() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      return navigator.storage.estimate();
    }
    return null;
  },
  
  async isLowStorage() {
    const estimate = await this.getQuota();
    if (!estimate) return false;
    const used = estimate.usage || 0;
    const total = estimate.quota || Infinity;
    return (used / total) > 0.85; // 85% full
  },
  
  clearOldCache(maxAgeDays = 30) {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    Object.keys(localStorage).forEach(key => {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (data && data.cachedAt && (now - data.cachedAt > maxAge)) {
          localStorage.removeItem(key);
        }
      } catch {}
    });
  }
};

// ==========================================
// Initialize All Utilities
// ==========================================

export function initUtils() {
  injectSkeletonStyles();
  initConnectionMonitor();
  
  // Add lazy styles
  const style = document.createElement('style');
  style.textContent = lazyStyles;
  document.head.appendChild(style);
  
  console.log('[Utils] Initialized');
}
