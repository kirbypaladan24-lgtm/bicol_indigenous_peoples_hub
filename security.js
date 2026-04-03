// security.js - Security utilities for Bicol IP Hub
// CSP, input sanitization, XSS prevention, error boundaries

// ==========================================
// Content Security Policy Configuration
// ==========================================

export const CSP_POLICY = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for inline event handlers (consider moving to external)
    'https://unpkg.com',
    'https://www.gstatic.com',
    'https://*.googleapis.com',
    'https://*.firebaseio.com'
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for dynamic styles
    'https://fonts.googleapis.com',
    'https://unpkg.com'
  ],
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
    'data:'
  ],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https:',
    'https://i.ibb.co', // ImgBB
    'https://img.youtube.com',
    'https://*.tile.openstreetmap.org',
    'https://*.tile.opentopomap.org',
    'https://server.arcgisonline.com',
    'https://raw.githubusercontent.com'
  ],
  'connect-src': [
    "'self'",
    'https://unpkg.com',
    'https://www.gstatic.com',
    'https://*.gstatic.com',
    'https://*.firebaseio.com',
    'https://*.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://ipapi.co',
    'https://api.imgbb.com',
    'https://*.cloudfunctions.net',
    'https://plausible.io'
  ],
  'frame-src': [
    "'self'",
    'https://www.youtube.com',
    'https://youtube.com'
  ],
  'media-src': ["'self'", 'https:'],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"]
};

const isProductionRuntime =
  typeof import.meta !== "undefined" && import.meta.env
    ? Boolean(import.meta.env.PROD)
    : !["localhost", "127.0.0.1"].includes(location.hostname);

const errorLogEndpoint =
  typeof window !== "undefined" && typeof window.__ERROR_LOG_ENDPOINT__ === "string"
    ? window.__ERROR_LOG_ENDPOINT__
    : null;
const LOCALHOST_FALLBACK_BACKEND_URL = "https://bicol-indigenous-peoples-hub-1.onrender.com";
let devToolsWarningShown = false;

function isLocalDevelopmentHost() {
  return typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function getOriginFromUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return new URL(value, window.location.href).origin;
  } catch {
    return null;
  }
}

function buildRuntimeCspPolicy() {
  const policy = Object.fromEntries(
    Object.entries(CSP_POLICY).map(([directive, sources]) => [directive, [...sources]])
  );

  const runtimeOrigins = new Set();
  const backendBaseUrl =
    window.__PUBLIC_BACKEND_CONFIG__?.baseUrl ||
    (isLocalDevelopmentHost() ? LOCALHOST_FALLBACK_BACKEND_URL : "");
  const backendOrigin = getOriginFromUrl(backendBaseUrl);
  const errorOrigin = getOriginFromUrl(errorLogEndpoint);

  if (backendOrigin) runtimeOrigins.add(backendOrigin);
  if (errorOrigin) runtimeOrigins.add(errorOrigin);

  runtimeOrigins.forEach((origin) => {
    if (!policy["connect-src"].includes(origin)) {
      policy["connect-src"].push(origin);
    }
  });

  return policy;
}

/**
 * Apply CSP as meta tag (for static hosting without server headers)
 */
export function applyCSP() {
  const cspString = Object.entries(buildRuntimeCspPolicy())
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
  
  // Remove existing CSP if present
  const existing = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (existing) existing.remove();
  
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = cspString;
  document.head.prepend(meta); // Prepend to apply immediately
  
  console.log('[Security] CSP applied');
}

/**
 * Generate nonce for inline scripts (advanced usage)
 */
export function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

// ==========================================
// DOMPurify-style HTML Sanitization
// ==========================================

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
  'img', 'figure', 'figcaption', 'div', 'span', 'hr'
]);

const ALLOWED_ATTRS = new Set([
  'href', 'title', 'alt', 'src', 'width', 'height', 'class', 'id',
  'target', 'rel', 'data-*' // data attributes allowed
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Sanitize HTML content to prevent XSS
 * @param {string} html - Raw HTML input
 * @returns {string} - Sanitized HTML
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const walker = document.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );
  
  const nodesToRemove = [];
  const nodesToReplace = [];
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const tagName = node.tagName.toLowerCase();
    
    // Remove disallowed tags
    if (!ALLOWED_TAGS.has(tagName)) {
      nodesToReplace.push(node);
      continue;
    }
    
    // Sanitize attributes
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      const attrName = attr.name.toLowerCase();
      
      // Remove event handlers
      if (attrName.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      
      // Check allowed attributes
      const isDataAttr = attrName.startsWith('data-');
      if (!ALLOWED_ATTRS.has(attrName) && !isDataAttr) {
        node.removeAttribute(attr.name);
        continue;
      }
      
      // Sanitize URLs
      if (['href', 'src'].includes(attrName)) {
        const url = attr.value.trim();
        if (!isSafeUrl(url)) {
          node.removeAttribute(attr.name);
        } else if (attrName === 'href' && !url.startsWith('#')) {
          // Force external links to open safely
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer nofollow');
        }
      }
      
      // Prevent javascript: protocol
      if (attr.value.toLowerCase().includes('javascript:')) {
        node.removeAttribute(attr.name);
      }
    }
    
    // Special handling for images
    if (tagName === 'img') {
      node.setAttribute('loading', 'lazy');
      if (!node.hasAttribute('alt')) {
        node.setAttribute('alt', ''); // Require alt text
      }
    }
  }
  
  // Replace disallowed tags with their text content
  for (const node of nodesToReplace) {
    const text = document.createTextNode(node.textContent);
    node.parentNode.replaceChild(text, node);
  }
  
  return doc.body.innerHTML;
}

/**
 * Check if URL is safe
 */
function isSafeUrl(url) {
  if (!url) return false;
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./')) return true;
  
  try {
    const parsed = new URL(url, window.location.href);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitize plain text (for titles, names, etc.)
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate phone number (Philippines format)
 */
export function isValidPhone(phone) {
  // Accepts: +63 XXX XXX XXXX, 09XX XXX XXXX, etc.
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  const re = /^(?:\+63|0)\d{10}$/;
  return re.test(cleaned);
}

// ==========================================
// Error Boundaries
// ==========================================

export class ErrorBoundary {
  constructor(componentName, fallbackFn) {
    this.componentName = componentName;
    this.fallbackFn = fallbackFn || this.defaultFallback;
    this.hasError = false;
    this.error = null;
  }
  
  defaultFallback(error) {
    return `
      <div class="error-boundary" role="alert" style="
        padding: 20px;
        border: 2px solid #c0392b;
        border-radius: 12px;
        background: rgba(192, 57, 43, 0.1);
        margin: 10px 0;
      ">
        <h3 style="color: #c0392b; margin: 0 0 10px;">Something went wrong</h3>
        <p style="margin: 0; color: var(--text);">The ${this.componentName} component failed to load.</p>
        <button onclick="location.reload()" style="
          margin-top: 10px;
          padding: 8px 16px;
          background: var(--accent);
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
        ">Reload Page</button>
      </div>
    `;
  }
  
  wrap(fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        this.hasError = true;
        this.error = error;
        console.error(`[ErrorBoundary] ${this.componentName}:`, error);
        this.reportError(error);
        return this.fallbackFn(error);
      }
    };
  }
  
  async wrapAsync(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.hasError = true;
        this.error = error;
        console.error(`[ErrorBoundary] ${this.componentName}:`, error);
        this.reportError(error);
        return this.fallbackFn(error);
      }
    };
  }
  
  reportError(error) {
    // Send to analytics in production
    if (typeof gtag !== 'undefined') {
      gtag('event', 'exception', {
        description: `${this.componentName}: ${error.message}`,
        fatal: false
      });
    }
    
    // Send to a custom endpoint only when one is explicitly configured.
    if (errorLogEndpoint && navigator.onLine) {
      fetch(errorLogEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          component: this.componentName,
          message: error.message,
          stack: error.stack,
          url: location.href,
          timestamp: new Date().toISOString()
        }),
        keepalive: true
      }).catch(() => {});
    }
  }
}

// Global error boundary for critical sections
export const postErrorBoundary = new ErrorBoundary('Posts Feed');
export const mapErrorBoundary = new ErrorBoundary('Map');
export const authErrorBoundary = new ErrorBoundary('Authentication');

// ==========================================
// Rate Limiting & Abuse Prevention
// ==========================================

const RATE_LIMITS = {
  post: { max: 5, window: 60 * 1000 },      // 5 posts per minute
  reaction: { max: 20, window: 60 * 1000 }, // 20 reactions per minute
  login: { max: 5, window: 5 * 60 * 1000 }  // 5 login attempts per 5 minutes
};

const rateLimitStore = new Map();

/**
 * Check if action is rate limited
 */
export function checkRateLimit(action, key) {
  const limit = RATE_LIMITS[action];
  if (!limit) return { allowed: true };
  
  const now = Date.now();
  const storeKey = `${action}:${key}`;
  const history = rateLimitStore.get(storeKey) || [];
  
  // Clean old entries
  const valid = history.filter(t => now - t < limit.window);
  
  if (valid.length >= limit.max) {
    const oldest = valid[0];
    const retryAfter = Math.ceil((oldest + limit.window - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  valid.push(now);
  rateLimitStore.set(storeKey, valid);
  return { allowed: true };
}

// ==========================================
// Secure Storage Helpers
// ==========================================

/**
 * Store sensitive data with expiration
 */
export function setSecureItem(key, value, ttlMinutes = 60) {
  const data = {
    value,
    expires: Date.now() + (ttlMinutes * 60 * 1000)
  };
  localStorage.setItem(key, JSON.stringify(data));
}

export function getSecureItem(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  
  try {
    const data = JSON.parse(raw);
    if (Date.now() > data.expires) {
      localStorage.removeItem(key);
      return null;
    }
    return data.value;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

// ==========================================
// Initialize Security Features
// ==========================================

export function initSecurity() {
  // In production, CSP is delivered as an HTTP header by Vercel.
  if (!isProductionRuntime) {
    applyCSP();
  }
  
  // Add global error handler
  window.addEventListener('error', (e) => {
    console.error('[Global Error]', e.error);
    // Prevent default for known error types
    if (e.message?.includes('ResizeObserver')) {
      e.preventDefault();
    }
  });
  
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled Promise]', e.reason);
  });
  
  // Detect and warn about dev tools (optional, for production)
  if (isProductionRuntime) {
    const checkDevTools = () => {
      const threshold = 160;
      const widthExceeded = window.outerWidth - window.innerWidth > threshold;
      const heightExceeded = window.outerHeight - window.innerHeight > threshold;
      if (widthExceeded || heightExceeded) {
        if (devToolsWarningShown) return;
        devToolsWarningShown = true;
        console.log('%cStop!', 'color: red; font-size: 50px; font-weight: bold;');
        console.log('%cThis is a browser feature intended for developers.', 'font-size: 16px;');
      } else {
        devToolsWarningShown = false;
      }
    };
    setInterval(checkDevTools, 1000);
  }
  
  console.log('[Security] Initialized');
}
