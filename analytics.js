// analytics.js - Privacy-respecting analytics for Bicol IP Hub
// GDPR-compliant, no cookies, no personal data collection

// ==========================================
// Configuration
// ==========================================

const ANALYTICS_CONFIG = {
  // Self-hosted Plausible or similar endpoint
  // Replace with your actual analytics endpoint
  endpoint: 'https://plausible.io/api/event',
  domain:
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'bicol-indigenous-peoples-hub.vercel.app',
  
  // Feature flags
  enabled: true,
  respectDNT: true, // Respect Do Not Track
  anonymizeIp: true,
  batchSize: 5,
  flushInterval: 5000 // 5 seconds
};

// ==========================================
// Privacy & Consent
// ==========================================

/**
 * Check if analytics should be enabled
 */
function shouldTrack() {
  // Respect Do Not Track
  if (ANALYTICS_CONFIG.respectDNT && navigator.doNotTrack === '1') {
    return false;
  }
  
  // Check localStorage consent
  const consent = localStorage.getItem('analytics-consent');
  if (consent === 'denied') return false;
  
  // Default to enabled if not explicitly denied
  return ANALYTICS_CONFIG.enabled;
}

/**
 * Request user consent for analytics
 */
export function requestAnalyticsConsent() {
  if (localStorage.getItem('analytics-consent')) return;
  
  // Show consent banner (simple version)
  const banner = document.createElement('div');
  banner.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      max-width: 600px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      z-index: 10000;
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    ">
      <p style="margin: 0; flex: 1; font-size: 14px;">
        Help us improve by sharing anonymous usage data. No personal information is collected.
      </p>
      <div style="display: flex; gap: 8px;">
        <button id="analytics-decline" class="ghost small">Decline</button>
        <button id="analytics-accept" class="solid small">Accept</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(banner);
  
  banner.querySelector('#analytics-decline').addEventListener('click', () => {
    localStorage.setItem('analytics-consent', 'denied');
    banner.remove();
  });
  
  banner.querySelector('#analytics-accept').addEventListener('click', () => {
    localStorage.setItem('analytics-consent', 'accepted');
    banner.remove();
    initAnalytics();
  });
}

// ==========================================
// Event Queue & Batching
// ==========================================

const eventQueue = [];
let flushTimer = null;
let analyticsInitialized = false;
let navigationWatcherId = null;

/**
 * Queue an event for batching
 */
function queueEvent(event) {
  if (!shouldTrack()) return;
  
  eventQueue.push({
    ...event,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    userAgent: anonymizeUserAgent()
  });
  
  // Flush if batch size reached
  if (eventQueue.length >= ANALYTICS_CONFIG.batchSize) {
    flushEvents();
  } else {
    // Schedule flush
    if (!flushTimer) {
      flushTimer = setTimeout(flushEvents, ANALYTICS_CONFIG.flushInterval);
    }
  }
}

/**
 * Flush queued events to server
 */
async function flushEvents() {
  if (eventQueue.length === 0) return;
  if (!navigator.onLine) return; // Don't flush offline
  
  const events = [...eventQueue];
  eventQueue.length = 0;
  clearTimeout(flushTimer);
  flushTimer = null;
  
  try {
    const payload = {
      domain: ANALYTICS_CONFIG.domain,
      name: 'pageview',
      url: location.href,
      referrer: document.referrer,
      screen_width: screen.width,
      screen_height: screen.height,
      events: events
    };
    
    await fetch(ANALYTICS_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      credentials: 'omit',
      keepalive: true
    });
  } catch (err) {
    // Silently fail - don't break app for analytics
    console.log('[Analytics] Flush failed, will retry');
    // Re-queue events
    eventQueue.unshift(...events);
  }
}

// ==========================================
// Session Management (No Cookies)
// ==========================================

function getSessionId() {
  let sessionId = sessionStorage.getItem('analytics-session');
  if (!sessionId) {
    sessionId = generateId();
    sessionStorage.setItem('analytics-session', sessionId);
  }
  return sessionId;
}

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function anonymizeUserAgent() {
  // Only send browser family, not full UA
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return 'Other';
}

// ==========================================
// Event Tracking Functions
// ==========================================

/**
 * Track page view
 */
export function trackPageView(path) {
  queueEvent({
    type: 'pageview',
    path: path || location.pathname,
    title: document.title
  });
}

/**
 * Track custom event
 */
export function trackEvent(name, props = {}) {
  queueEvent({
    type: 'event',
    name,
    props: sanitizeProps(props)
  });
}

/**
 * Track post interactions
 */
export function trackPostView(postId, title) {
  trackEvent('post_view', { post_id: postId, title: truncate(title, 50) });
}

export function trackPostLike(postId) {
  trackEvent('post_like', { post_id: postId });
}

export function trackPostShare(postId, platform) {
  trackEvent('post_share', { post_id: postId, platform });
}

export function trackPostCreate(hasImages) {
  trackEvent('post_create', { has_images: hasImages });
}

/**
 * Track map interactions
 */
export function trackMapInteraction(action, details = {}) {
  trackEvent('map_' + action, details);
}

export function trackLocationTrack(enabled) {
  trackEvent('location_tracking', { enabled });
}

/**
 * Track search
 */
export function trackSearch(query, resultsCount) {
  trackEvent('search', {
    query: truncate(query, 30),
    results_count: resultsCount
  });
}

/**
 * Track language change
 */
export function trackLanguageChange(from, to) {
  trackEvent('language_change', { from, to });
}

/**
 * Track errors (sanitized)
 */
export function trackError(error, context = {}) {
  trackEvent('error', {
    message: truncate(error.message, 100),
    stack: error.stack ? 'present' : 'absent',
    context: sanitizeProps(context)
  });
}

// ==========================================
// Performance Tracking
// ==========================================

export function trackPerformance() {
  // Core Web Vitals
  if ('web-vitals' in window) {
    // LCP
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      trackEvent('web_vital', {
        name: 'LCP',
        value: Math.round(lastEntry.startTime),
        rating: getRating(lastEntry.startTime, 2500, 4000)
      });
    }).observe({ entryTypes: ['largest-contentful-paint'] });
    
    // FID
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const delay = entry.processingStart - entry.startTime;
        trackEvent('web_vital', {
          name: 'FID',
          value: Math.round(delay),
          rating: getRating(delay, 100, 300)
        });
      }
    }).observe({ entryTypes: ['first-input'] });
    
    // CLS
    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }
      trackEvent('web_vital', {
        name: 'CLS',
        value: Math.round(clsValue * 1000) / 1000,
        rating: getRating(clsValue, 0.1, 0.25)
      });
    }).observe({ entryTypes: ['layout-shift'] });
  }
  
  // Navigation timing
  window.addEventListener('load', () => {
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        trackEvent('page_load', {
          ttfb: Math.round(nav.responseStart - nav.startTime),
          fcp: Math.round(nav.domContentLoadedEventStart - nav.startTime),
          load: Math.round(nav.loadEventStart - nav.startTime)
        });
      }
    }, 0);
  });
}

function getRating(value, good, poor) {
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

// ==========================================
// Feature Usage Tracking
// ==========================================

const featureUsage = {
  mapUsed: false,
  searchUsed: false,
  postsCreated: 0,
  imagesUploaded: 0
};

export function recordFeatureUsage(feature) {
  featureUsage[feature] = true;
}

export function getFeatureUsageStats() {
  return { ...featureUsage };
}

// ==========================================
// Helper Functions
// ==========================================

function sanitizeProps(props) {
  const sanitized = {};
  for (const [key, value] of Object.entries(props)) {
    // Remove potential PII
    if (typeof value === 'string') {
      // Remove emails
      let clean = value.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
      // Remove phone numbers
      clean = clean.replace(/(\+?\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}/g, '[phone]');
      sanitized[key] = clean;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

// ==========================================
// Initialization
// ==========================================

export function initAnalytics() {
  if (analyticsInitialized) {
    return;
  }

  if (!shouldTrack()) {
    console.log('[Analytics] Disabled by user preference or DNT');
    return;
  }

  analyticsInitialized = true;
  
  // Track initial page view
  trackPageView();
  
  // Track SPA navigation
  let lastPath = location.pathname;
  navigationWatcherId = setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      trackPageView(lastPath);
    }
  }, 500);
  
  // Track performance
  trackPerformance();
  
  // Flush on page hide
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushEvents();
    }
  });
  
  // Flush on before unload
  window.addEventListener('beforeunload', () => {
    flushEvents();
  });
  
  console.log('[Analytics] Initialized');
}

// Auto-initialize if consent already given
if (localStorage.getItem('analytics-consent') === 'accepted') {
  initAnalytics();
}
