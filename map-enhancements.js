// map-enhancements.js - Advanced map features for Bicol IP Hub
// Marker clustering, geofencing, offline tiles, proximity alerts

import { t } from './i18n.js';
import { showToast } from './ui.js';

// ==========================================
// Marker Clustering
// ==========================================

let markerClusterGroup = null;
let clusterLayerAdded = false;

/**
 * Initialize marker clustering (loads plugin dynamically)
 */
export async function initMarkerClustering(map) {
  // Check if already loaded
  if (window.L.markerClusterGroup) {
    return createClusterGroup(map);
  }
  
  // Load CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
  document.head.appendChild(link);
  
  const link2 = document.createElement('link');
  link2.rel = 'stylesheet';
  link2.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
  document.head.appendChild(link2);
  
  // Load JS
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  
  return createClusterGroup(map);
}

function createClusterGroup(map) {
  markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: true,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 80,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      let size = 'small';
      let color = '#5a9a6a';
      
      if (count >= 100) {
        size = 'large';
        color = '#c36b2a';
      } else if (count >= 10) {
        size = 'medium';
        color = '#2f5c3a';
      }
      
      return L.divIcon({
        html: `<div style="
          background: ${color};
          color: white;
          border-radius: 50%;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        ">${count}</div>`,
        className: `marker-cluster marker-cluster-${size}`,
        iconSize: size === 'large' ? [50, 50] : size === 'medium' ? [40, 40] : [30, 30]
      });
    }
  });
  
  return markerClusterGroup;
}

/**
 * Add markers to cluster group
 */
export function addMarkersToCluster(markers) {
  if (!markerClusterGroup) return;
  markerClusterGroup.addLayers(markers);
}

/**
 * Clear all clusters
 */
export function clearClusters() {
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  }
}

// ==========================================
// Geofencing & Proximity Alerts
// ==========================================

const PROXIMITY_THRESHOLD = 500; // meters
const notifiedLandmarks = new Set();
let geofenceWatcher = null;

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Check if user is near any culturally sensitive landmarks
 */
export function checkProximity(userLat, userLng, landmarks) {
  landmarks.forEach(landmark => {
    const distance = calculateDistance(
      userLat, 
      userLng, 
      landmark.lat || landmark.position?.lat, 
      landmark.lng || landmark.position?.lng
    );
    
    const landmarkId = landmark.id || landmark.name;
    
    // Within proximity threshold and not recently notified
    if (distance < PROXIMITY_THRESHOLD && !notifiedLandmarks.has(landmarkId)) {
      notifiedLandmarks.add(landmarkId);
      
      // Show respectful proximity alert
      showToast(
        t('proximity_alert', { 
          name: landmark.name, 
          distance: Math.round(distance) 
        }),
        'info'
      );
      
      // Auto-clear notification after 10 minutes
      setTimeout(() => {
        notifiedLandmarks.delete(landmarkId);
      }, 10 * 60 * 1000);
    }
  });
}

/**
 * Start geofence monitoring
 */
export function startGeofencing(userLat, userLng, landmarks) {
  // Initial check
  checkProximity(userLat, userLng, landmarks);
  
  // Set up periodic checks (every 30 seconds)
  if (geofenceWatcher) clearInterval(geofenceWatcher);
  
  geofenceWatcher = setInterval(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          checkProximity(
            position.coords.latitude,
            position.coords.longitude,
            landmarks
          );
        },
        () => {}, // Silent fail
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
  }, 30000);
}

/**
 * Stop geofence monitoring
 */
export function stopGeofencing() {
  if (geofenceWatcher) {
    clearInterval(geofenceWatcher);
    geofenceWatcher = null;
  }
  notifiedLandmarks.clear();
}

// ==========================================
// Offline Map Tiles
// ==========================================

const TILE_CACHE_NAME = 'bicol-ip-map-tiles-v1';
const MAX_CACHED_TILES = 500;

/**
 * Initialize offline tile storage
 */
export async function initOfflineTiles() {
  if (!('caches' in window)) {
    console.warn('[Map] Caches API not available');
    return false;
  }
  
  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    console.log('[Map] Offline tile cache initialized');
    return true;
  } catch (err) {
    console.error('[Map] Failed to init tile cache:', err);
    return false;
  }
}

/**
 * Cache tiles for a specific area (for offline use)
 */
export async function cacheAreaTiles(bounds, zoomLevels = [10, 11, 12, 13]) {
  const cache = await caches.open(TILE_CACHE_NAME);
  const tilesToCache = [];
  
  // Generate tile URLs for the bounds at each zoom level
  for (const z of zoomLevels) {
    const nw = latLngToTile(bounds.getNorthWest(), z);
    const se = latLngToTile(bounds.getSouthEast(), z);
    
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        const url = `https://{s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
        tilesToCache.push(url.replace('{s}', 'a'));
        tilesToCache.push(url.replace('{s}', 'b'));
        tilesToCache.push(url.replace('{s}', 'c'));
      }
    }
  }
  
  // Limit cache size
  if (tilesToCache.length > MAX_CACHED_TILES) {
    console.warn('[Map] Too many tiles, limiting to', MAX_CACHED_TILES);
    tilesToCache.length = MAX_CACHED_TILES;
  }
  
  // Cache tiles
  let cached = 0;
  for (const url of tilesToCache) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        cached++;
      }
    } catch (err) {
      // Ignore failed tiles
    }
  }
  
  showToast(t('tiles_cached', { count: cached }), 'success');
  return cached;
}

function latLngToTile(latLng, zoom) {
  const latRad = latLng.lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor((latLng.lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

// ==========================================
// Custom Map Controls
// ==========================================

/**
 * Add custom locate button with enhanced functionality
 */
export function addEnhancedLocateControl(map, onLocate) {
  const control = L.control({ position: 'topright' });
  
  control.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    div.innerHTML = `
      <a href="#" title="${t('my_location')}" style="
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: white;
        color: #333;
        text-decoration: none;
        font-size: 18px;
      ">⌖</a>
    `;
    
    div.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      onLocate();
    });
    
    return div;
  };
  
  control.addTo(map);
  return control;
}

/**
 * Add layer control with offline indicator
 */
export function addLayerControlWithOffline(map, layers) {
  const baseLayers = {
    [t('streets')]: layers.streets,
    [t('terrain')]: layers.terrain,
    [t('satellite')]: layers.satellite
  };
  
  const control = L.control.layers(baseLayers, null, {
    position: 'topright',
    collapsed: true
  });
  
  control.addTo(map);
  
  // Add offline indicator
  const container = control.getContainer();
  const offlineBadge = document.createElement('div');
  offlineBadge.className = 'offline-badge';
  offlineBadge.style.cssText = `
    position: absolute;
    top: -8px;
    right: -8px;
    background: #c0392b;
    color: white;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    display: none;
  `;
  offlineBadge.textContent = t('offline');
  container.style.position = 'relative';
  container.appendChild(offlineBadge);
  
  // Show badge when offline
  window.addEventListener('offline', () => {
    offlineBadge.style.display = 'block';
  });
  window.addEventListener('online', () => {
    offlineBadge.style.display = 'none';
  });
  
  return control;
}

// ==========================================
// Map Accessibility Enhancements
// ==========================================

/**
 * Add keyboard navigation for markers
 */
export function makeMarkersAccessible(markers, map) {
  markers.forEach((marker, index) => {
    const element = marker.getElement();
    if (!element) return;
    
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', 
      t('marker_label', { 
        name: marker.options.title || t('landmark'),
        index: index + 1 
      })
    );
    
    // Keyboard activation
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        marker.fire('click');
      }
    });
  });
}

/**
 * Add screen reader announcements for map updates
 */
export function announceMapUpdate(message) {
  const announcer = document.getElementById('map-announcer') || createAnnouncer();
  announcer.textContent = message;
}

function createAnnouncer() {
  const div = document.createElement('div');
  div.id = 'map-announcer';
  div.setAttribute('aria-live', 'polite');
  div.setAttribute('aria-atomic', 'true');
  div.style.cssText = `
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  `;
  document.body.appendChild(div);
  return div;
}

// ==========================================
// Sacred Site Protection
// ==========================================

const SACRED_SITES = new Set(); // IDs of sacred sites

/**
 * Mark a landmark as sacred (restricts detail level)
 */
export function markAsSacred(landmarkId) {
  SACRED_SITES.add(landmarkId);
}

/**
 * Check if coordinates are near a sacred site
 */
export function isNearSacredSite(lat, lng, landmarks) {
  return landmarks.some(landmark => {
    if (!SACRED_SITES.has(landmark.id)) return false;
    const distance = calculateDistance(
      lat, lng,
      landmark.lat || landmark.position?.lat,
      landmark.lng || landmark.position?.lng
    );
    return distance < 1000; // 1km buffer
  });
}

/**
 * Get appropriate zoom level for landmark (respects sacred sites)
 */
export function getAppropriateZoom(landmark, userLat, userLng) {
  const isSacred = SACRED_SITES.has(landmark.id);
  const distance = calculateDistance(
    userLat, userLng,
    landmark.lat || landmark.position?.lat,
    landmark.lng || landmark.position?.lng
  );
  
  // For sacred sites, limit zoom when user is far away
  if (isSacred && distance > 5000) {
    return 12; // Don't zoom too close from far away
  }
  
  return 16; // Normal zoom
}

// ==========================================
// Initialize All Map Enhancements
// ==========================================

export async function initMapEnhancements(map, options = {}) {
  const { landmarks = [], enableClustering = true, enableGeofencing = true } = options;
  
  // Initialize offline tiles
  await initOfflineTiles();
  
  // Initialize clustering
  if (enableClustering) {
    await initMarkerClustering(map);
  }
  
  // Start geofencing if user location available
  if (enableGeofencing && options.userLat && options.userLng) {
    startGeofencing(options.userLat, options.userLng, landmarks);
  }
  
  console.log('[Map Enhancements] Initialized');
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopGeofencing();
});