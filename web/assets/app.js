// API Configuration
const urlParams = new URLSearchParams(window.location.search);
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const localApiBase = `${window.location.protocol}//${window.location.hostname}:8787`;
const rawApiBase = urlParams.get("apiBase") || window.MN511_API_BASE;
const rawWpBase = urlParams.get("wpBase") || window.MN511_WP_BASE || (!isLocalHost ? window.location.origin : null);

function normalizeApiBase(base) {
  if (!base) return base;
  return base.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
}

function normalizeWpBase(base) {
  if (!base) return base;
  return base.replace(/\/wp-json\/?$/i, "").replace(/\/+$/, "");
}

const API_BASE =
  normalizeApiBase(rawApiBase) ||
  (isLocalHost ? localApiBase : "https://511.mp.ls");
const WP_BASE = normalizeWpBase(rawWpBase);
const WP_API_BASE = WP_BASE ? `${WP_BASE}/wp-json/mn511/v1` : null;
const WP_AUTH_STORAGE_KEY = "mn511WpAuth";
const DEFAULT_CENTER = [44.9778, -93.265];
const DEFAULT_ZOOM = 10;

// Categorized Layer Definitions
const LAYER_CATEGORIES = {
  traffic: {
    title: "Traffic Events",
    icon: "⚠️",
    layers: [
      { id: "incidents", label: "Crashes & Incidents", icon: "🚨", color: "#dc3545", endpoint: "/api/incidents", enabled: true },
      { id: "closures", label: "Road Closures", icon: "🚧", color: "#fd7e14", endpoint: "/api/closures", enabled: true },
      { id: "construction", label: "Construction", icon: "👷", color: "#ffc107", endpoint: "/v1/events?category=CONSTRUCTION", enabled: false },
      { id: "surface-incidents", label: "Surface Incidents", icon: "!", color: "#e8590c", endpoint: "/api/iceout", enabled: false },
      { id: "cameras", label: "Traffic Cameras", icon: "📹", color: "#0066cc", endpoint: "/api/cameras", enabled: false }
    ]
  },
  weather: {
    title: "Weather & Conditions",
    icon: "🌡️",
    layers: [
      { id: "weather-stations", label: "RWIS Stations", icon: "🌡️", color: "#6f42c1", endpoint: "/api/rwss", enabled: false },
      { id: "signs", label: "Message Signs", icon: "🚦", color: "#28a745", endpoint: "/v1/signs", enabled: false },
      { id: "plows", label: "Snow Plows", icon: "🚜", color: "#17a2b8", endpoint: "/api/plows", enabled: false },
      { id: "road-conditions", label: "Road Conditions", icon: "🛣️", color: "#6c757d", endpoint: "/api/road-conditions", enabled: false },
      { id: "weather-events", label: "Weather Events", icon: "❄️", color: "#b197fc", endpoint: "/api/weather-events", enabled: false }
    ]
  },
  services: {
    title: "Services & Info",
    icon: "📍",
    layers: [
      { id: "rest-areas", label: "Rest Areas", icon: "🅿️", color: "#20c997", endpoint: "/api/rest-areas", enabled: false },
      { id: "weigh-stations", label: "Weigh Stations", icon: "⚖️", color: "#63e6be", endpoint: "/api/weigh-stations", enabled: false },
      { id: "fueling-stations", label: "Fuel Stations", icon: "⛽", color: "#ffd43b", endpoint: "/api/fueling-stations", enabled: false },
      { id: "alerts", label: "Travel Alerts", icon: "📢", color: "#e03131", endpoint: "/api/alerts", enabled: false }
    ]
  }
};

// Map initialization
const map = L.map("map").setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  subdomains: "abcd",
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
}).addTo(map);

// State management
const layerGroups = {};
let allFeatures = [];
let currentFilter = "all";
let refreshInProgress = false;
let refreshPending = false;
const layerControllers = {};
const layerCache = {};
const layerMarkers = {};
const featureIndex = new Map();
let authState = {
  token: null,
  user: null,
  favorites: []
};
const favoriteIds = new Set();

// Helper functions
function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    let ms = value;
    if (ms < 2000000000) ms *= 1000;
    return ms;
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return normalizeTimestamp(asNumber);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractUpdatedMs(feature) {
  const p = (feature && feature.properties) || {};
  const raw = p.raw || {};
  const candidates = [
    p.lastUpdatedAt,
    p.last_updated_at,
    p.updated_at,
    p.lastUpdated,
    p.updateTime,
    raw.lastUpdated?.timestamp,
    raw.lastUpdated?.time,
    raw.updateTime?.time,
    raw._eventReport?.lastUpdated?.timestamp,
    raw._eventReport?.updateTime?.time
  ];

  for (const value of candidates) {
    const ms = normalizeTimestamp(value);
    if (ms !== null) return ms;
  }
  return null;
}

function formatTimestamp(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;

  const now = Date.now();
  const diff = now - ms;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString();
}

function formatRelativeTime(ms) {
  if (!Number.isFinite(ms)) return "Unknown";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Unknown";

  const now = Date.now();
  const diff = now - ms;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(diff / 86400000);
  return `${days} days ago`;
}

function buildLayerUrl(endpoint, bbox) {
  const bboxStr = [bbox.west, bbox.south, bbox.east, bbox.north].map(n => n.toFixed(5)).join(",");
  // For endpoints that need bbox parameter
  if (endpoint.includes("/api/")) {
    const zoom = map.getZoom();
    return `${API_BASE}${endpoint}?bbox=${bboxStr}&zoom=${zoom}`;
  }
  // For /v1/ endpoints (cached data)
  if (endpoint.includes("/v1/")) {
    const sep = endpoint.includes("?") ? "&" : "?";
    return `${API_BASE}${endpoint}${sep}bbox=${bboxStr}`;
  }
  return `${API_BASE}${endpoint}`;
}

function escapeAttr(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isImageUrl(url) {
  return typeof url === "string" && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

function isVideoUrl(url) {
  return typeof url === "string" && /\.(mp4|m3u8)(\?|$)/i.test(url);
}

function getCurrentBbox() {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth()
  };
}

function getBboxKey(bbox) {
  if (!bbox) return "none";
  const zoom = map.getZoom();
  return [
    zoom,
    bbox.west.toFixed(5),
    bbox.south.toFixed(5),
    bbox.east.toFixed(5),
    bbox.north.toFixed(5)
  ].join("|");
}

function cacheLayerData(layerId, bbox, geojson) {
  if (!geojson) return;
  layerCache[layerId] = {
    key: getBboxKey(bbox),
    geojson,
    fetchedAt: Date.now()
  };
}

function getCachedLayer(layerId, bbox) {
  const cached = layerCache[layerId];
  if (!cached) return null;
  if (cached.key !== getBboxKey(bbox)) return null;
  return cached.geojson;
}

function getSeverityClass(severity) {
  if (severity >= 4) return "high";
  if (severity >= 2) return "medium";
  return "low";
}

function getLayerInfo(layerId) {
  const allLayers = Object.values(LAYER_CATEGORIES).flatMap(cat => cat.layers);
  return allLayers.find(layer => layer.id === layerId) || null;
}

function normalizeFavoriteId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getFeatureId(feature, layerId) {
  const p = feature?.properties || {};
  const rawId = feature?.id || p.id || p.uri || p.uniqueId || p.cameraId;
  let candidate = rawId;
  if (!candidate && feature?.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)) {
    candidate = feature.geometry.coordinates.join("-");
  }
  if (!candidate && p.title) {
    candidate = p.title;
  }
  const baseId = normalizeFavoriteId(candidate || "unknown");
  return normalizeFavoriteId(`${layerId}:${baseId || "unknown"}`);
}

function getFeatureTitle(feature) {
  const p = feature?.properties || {};
  return p.title || p.tooltip || p.road || "Location";
}

function getFeatureSubtitle(feature) {
  const p = feature?.properties || {};
  return [p.category, p.road, p.routeDesignator].filter(Boolean).join(" | ");
}

function getFeatureCoordinates(feature) {
  if (!feature?.geometry || feature.geometry.type !== "Point") return null;
  const coords = feature.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

function buildFavoritePayload(feature, layerId) {
  const favoriteId = feature?.properties?.favoriteId || getFeatureId(feature, layerId);
  const updatedMs = extractUpdatedMs(feature);
  const layer = getLayerInfo(layerId);
  return {
    id: favoriteId,
    layerId,
    title: getFeatureTitle(feature),
    subtitle: getFeatureSubtitle(feature),
    icon: layer ? layer.icon : "",
    updatedAt: updatedMs ? new Date(updatedMs).toISOString() : "",
    coordinates: getFeatureCoordinates(feature)
  };
}

function rebuildFeatureIndex() {
  featureIndex.clear();
  allFeatures.forEach(feature => {
    const layerId = feature.properties?.layerId || "unknown";
    const favoriteId = feature.properties?.favoriteId || getFeatureId(feature, layerId);
    if (!feature.properties) feature.properties = {};
    feature.properties.favoriteId = favoriteId;
    featureIndex.set(favoriteId, feature);
  });
}

function setFavorites(favorites) {
  authState.favorites = Array.isArray(favorites) ? favorites : [];
  favoriteIds.clear();
  authState.favorites.forEach(fav => {
    if (fav && fav.id) favoriteIds.add(fav.id);
  });
  renderFavoritesList();
  renderList();
  syncFavoriteButtons();
  updateFavoriteMarkers();
}

function syncFavoriteButtons() {
  document.querySelectorAll("[data-favorite-id]").forEach((el) => {
    const favoriteId = el.dataset.favoriteId;
    if (!favoriteId) return;
    const isFavorite = favoriteIds.has(favoriteId);
    if (el.classList.contains("favorite-toggle")) {
      el.classList.toggle("is-favorite", isFavorite);
      const star = el.querySelector(".favorite-star");
      const text = el.querySelector(".favorite-text");
      if (star) star.textContent = isFavorite ? "★" : "☆";
      if (text) text.textContent = isFavorite ? "Saved" : "Save";
    }
    if (el.classList.contains("panel-item-favorite")) {
      el.classList.toggle("is-favorite", isFavorite);
      el.textContent = isFavorite ? "★" : "☆";
    }
  });
}

function updateFavoriteMarkers() {
  Object.values(layerMarkers).forEach((markers) => {
    markers.forEach((marker, favoriteId) => {
      const el = marker.getElement();
      if (!el) return;
      el.classList.toggle("is-favorite", favoriteIds.has(favoriteId));
    });
  });
}

function loadStoredAuth() {
  if (!WP_API_BASE) return null;
  try {
    const raw = window.localStorage.getItem(WP_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.token) {
      return data;
    }
  } catch (err) {
    console.warn("Failed to load stored auth:", err);
  }
  return null;
}

function saveStoredAuth() {
  if (!WP_API_BASE) return;
  const payload = {
    token: authState.token,
    user: authState.user
  };
  window.localStorage.setItem(WP_AUTH_STORAGE_KEY, JSON.stringify(payload));
}

function clearAuthState() {
  authState.token = null;
  authState.user = null;
  authState.favorites = [];
  if (WP_API_BASE) {
    window.localStorage.removeItem(WP_AUTH_STORAGE_KEY);
  }
  updateAuthUI();
  setFavorites([]);
}

function updateAuthUI() {
  const loginBtn = document.getElementById("auth-login");
  const logoutBtn = document.getElementById("auth-logout");
  const userEl = document.getElementById("auth-user");
  const userNameEl = document.getElementById("auth-user-name");
  const favoritesAuth = document.getElementById("favorites-auth");
  const favoritesLogin = document.getElementById("favorites-login");
  const favoritesActions = document.getElementById("favorites-actions");
  const favoritesLogout = document.getElementById("favorites-logout");
  const favoritesTitle = favoritesAuth?.querySelector(".favorites-auth-title");

  if (!WP_API_BASE) {
    if (loginBtn) {
      loginBtn.textContent = "WP Offline";
      loginBtn.disabled = true;
    }
    if (favoritesLogin) {
      favoritesLogin.textContent = "Unavailable";
      favoritesLogin.disabled = true;
    }
    if (favoritesTitle) {
      favoritesTitle.textContent = "WordPress integration is not configured.";
    }
    if (favoritesAuth) favoritesAuth.classList.remove("hidden");
    if (favoritesActions) favoritesActions.classList.add("hidden");
    if (favoritesLogout) favoritesLogout.disabled = true;
    if (userEl) userEl.classList.add("hidden");
    return;
  }

  if (authState.token) {
    if (loginBtn) loginBtn.classList.add("hidden");
    if (userEl) userEl.classList.remove("hidden");
    if (userNameEl) {
      const name = authState.user?.name || authState.user?.username || "Account";
      userNameEl.textContent = name;
    }
    if (favoritesAuth) favoritesAuth.classList.add("hidden");
    if (favoritesActions) favoritesActions.classList.remove("hidden");
    if (favoritesLogout) favoritesLogout.disabled = false;
  } else {
    if (loginBtn) {
      loginBtn.classList.remove("hidden");
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
    if (userEl) userEl.classList.add("hidden");
    if (favoritesAuth) favoritesAuth.classList.remove("hidden");
    if (favoritesActions) favoritesActions.classList.add("hidden");
    if (favoritesTitle) favoritesTitle.textContent = "Sign in to save and sync favorites.";
  }

  if (logoutBtn) logoutBtn.disabled = !authState.token;
}

async function wpFetch(path, { method = "GET", body = null, auth = true } = {}) {
  if (!WP_API_BASE) {
    throw new Error("WordPress integration is not configured.");
  }
  const headers = { "Content-Type": "application/json" };
  if (auth && authState.token) {
    headers.Authorization = `Bearer ${authState.token}`;
  }
  const res = await fetch(`${WP_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  return res;
}

async function loginWithCredentials(username, password) {
  const res = await wpFetch("/login", {
    method: "POST",
    body: { username, password },
    auth: false
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || "Login failed.";
    throw new Error(message);
  }
  if (!data.token) {
    throw new Error("Login failed.");
  }
  authState.token = data.token;
  authState.user = data.user;
  saveStoredAuth();
  updateAuthUI();
  await refreshFavorites();
}

async function refreshFavorites() {
  if (!authState.token) {
    setFavorites([]);
    return;
  }
  try {
    const res = await wpFetch("/favorites");
    if (res.status === 401 || res.status === 403) {
      clearAuthState();
      return;
    }
    const data = await res.json().catch(() => ({}));
    const favorites = Array.isArray(data) ? data : data.favorites;
    setFavorites(favorites || []);
  } catch (err) {
    console.warn("Failed to load favorites:", err);
  }
}

async function logout() {
  if (authState.token) {
    try {
      await wpFetch("/logout", { method: "POST" });
    } catch (err) {
      console.warn("Logout failed:", err);
    }
  }
  clearAuthState();
}

async function addFavorite(favorite) {
  const res = await wpFetch("/favorites", {
    method: "POST",
    body: { favorite }
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    clearAuthState();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const message = data?.message || "Failed to save favorite.";
    throw new Error(message);
  }
  setFavorites(data.favorites || []);
}

async function removeFavorite(favoriteId) {
  const res = await wpFetch(`/favorites/${favoriteId}`, {
    method: "DELETE"
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    clearAuthState();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const message = data?.message || "Failed to remove favorite.";
    throw new Error(message);
  }
  setFavorites(data.favorites || []);
}

async function toggleFavorite(favoriteId) {
  if (!favoriteId) return;
  if (!WP_API_BASE) {
    alert("WordPress integration is not configured.");
    return;
  }
  if (!authState.token) {
    showAuthModal();
    return;
  }
  if (favoriteIds.has(favoriteId)) {
    await removeFavorite(favoriteId);
    return;
  }
  const feature = featureIndex.get(favoriteId);
  if (!feature) return;
  const layerId = feature.properties?.layerId || "unknown";
  const favorite = buildFavoritePayload(feature, layerId);
  await addFavorite(favorite);
}

function renderFavoritesList() {
  const listEl = document.getElementById("favorites-list");
  const countEl = document.getElementById("favorites-count");
  if (!listEl || !countEl) return;

  if (!authState.token) {
    listEl.innerHTML = "";
    countEl.textContent = "0";
    return;
  }

  const favorites = authState.favorites || [];
  countEl.textContent = String(favorites.length);
  listEl.innerHTML = "";

  if (!favorites.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">☆</div>
        <div class="empty-state-text">No favorites yet</div>
      </div>
    `;
    return;
  }

  favorites.forEach((favorite) => {
    const layerInfo = getLayerInfo(favorite.layerId);
    const title = favorite.title || "Favorite";
    const subtitle = favorite.subtitle || (layerInfo ? layerInfo.label : favorite.layerId);
    const icon = favorite.icon || layerInfo?.icon || "★";
    const updatedAt = favorite.updatedAt ? new Date(favorite.updatedAt).toLocaleString() : "";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "panel-item";
    item.dataset.favoriteId = favorite.id;
    item.innerHTML = `
      <div class="panel-item-title">${icon} ${title}</div>
      ${subtitle ? `<div class="panel-item-meta">${subtitle}</div>` : ""}
      ${updatedAt ? `<div class="panel-item-time">${updatedAt}</div>` : ""}
      <span role="button" class="panel-item-favorite is-favorite" data-favorite-id="${escapeAttr(favorite.id)}" title="Remove favorite" tabindex="0">★</span>
    `;

    item.addEventListener("click", () => {
      const feature = featureIndex.get(favorite.id);
      if (feature) {
        focusOnFeature(feature);
        return;
      }
      if (Array.isArray(favorite.coordinates) && favorite.coordinates.length === 2) {
        map.setView([favorite.coordinates[0], favorite.coordinates[1]], Math.max(map.getZoom(), 13), { animate: true });
      }
    });

    listEl.appendChild(item);
  });
}

function ensureAuthModal() {
  if (document.getElementById("auth-modal")) return;

  const modal = document.createElement("div");
  modal.id = "auth-modal";
  modal.className = "auth-modal hidden";
  modal.innerHTML = `
    <div class="auth-modal-backdrop" data-auth-close="true"></div>
    <div class="auth-modal-dialog" role="dialog" aria-modal="true">
      <div class="auth-modal-header">
        <div class="auth-modal-title">Sign in to WordPress</div>
        <button type="button" class="auth-modal-close" data-auth-close="true">x</button>
      </div>
      <form class="auth-modal-body" id="auth-form">
        <label class="auth-field">
          <span>Username or Email</span>
          <input type="text" name="username" autocomplete="username" required />
        </label>
        <label class="auth-field">
          <span>Password</span>
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <div class="auth-modal-actions">
          <button type="submit" class="auth-btn">Sign In</button>
          <button type="button" class="auth-btn secondary" data-auth-close="true">Cancel</button>
        </div>
        <div class="auth-modal-error hidden" id="auth-modal-error"></div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target?.dataset?.authClose) {
      hideAuthModal();
    }
  });

  const form = modal.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const errorEl = modal.querySelector("#auth-modal-error");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }

    if (!username || !password) {
      if (errorEl) {
        errorEl.textContent = "Username and password are required.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    try {
      await loginWithCredentials(username, password);
      form.reset();
      hideAuthModal();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || "Login failed.";
        errorEl.classList.remove("hidden");
      }
    }
  });
}

function showAuthModal() {
  ensureAuthModal();
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("hidden");
}

function hideAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.add("hidden");
}

async function initAuth() {
  updateAuthUI();
  if (!WP_API_BASE) return;
  const stored = loadStoredAuth();
  if (stored) {
    authState.token = stored.token;
    authState.user = stored.user;
    updateAuthUI();
    await refreshFavorites();
  }
}

// Popup builders
function buildTrafficPopup(feature) {
  const p = feature.properties || {};
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">🚨</span>
        <div class="popup-title">${p.title || "Traffic Event"}</div>
      </div>
      ${p.category ? `<div class="popup-meta">📋 ${p.category}</div>` : ""}
      ${p.road ? `<div class="popup-meta">🛣️ ${p.road} ${p.direction || ""}</div>` : ""}
      ${p.severity !== null && p.severity !== undefined ? `<span class="popup-badge ${getSeverityClass(p.severity)}">Severity ${p.severity}</span>` : ""}
      ${p.tooltip ? `<div class="popup-detail">${p.tooltip}</div>` : ""}
      ${updatedText ? `<div class="popup-time">🕒 Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function buildSurfacePopup(feature) {
  const p = feature.properties || {};
  const reportedMs = normalizeTimestamp(
    p.reported_at || p.incident_time || p.incidentTime || p.last_updated_at
  );
  const reportedText = reportedMs ? new Date(reportedMs).toLocaleString() : null;
  const location = p.location_description || p.locationDescription || p.location || "";

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">!</span>
        <div class="popup-title">${p.title || "Surface incident"}</div>
      </div>
      ${location ? `<div class="popup-meta">Location: ${location}</div>` : ""}
      ${p.category ? `<div class="popup-meta">${p.category}</div>` : ""}
      ${reportedText ? `<div class="popup-time">Reported ${reportedText}</div>` : ""}
    </div>
  `;
}
function buildWeatherStationPopup(feature) {
  const p = feature.properties || {};
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);

  let weatherHtml = "";
  if (p.weatherFields) {
    const fields = p.weatherFields;
    const items = [];

    if (fields.TEMP_AIR_TEMPERATURE) {
      items.push(`<div class="weather-item">
        <div class="weather-label">🌡️ Air Temp</div>
        <div class="weather-value">${fields.TEMP_AIR_TEMPERATURE.displayValue || "N/A"}</div>
      </div>`);
    }
    if (fields.TEMP_SURFACE_TEMPERATURE) {
      items.push(`<div class="weather-item">
        <div class="weather-label">🛣️ Surface</div>
        <div class="weather-value">${fields.TEMP_SURFACE_TEMPERATURE.displayValue || "N/A"}</div>
      </div>`);
    }
    if (fields.WIND_AVG_SPEED) {
      items.push(`<div class="weather-item">
        <div class="weather-label">💨 Wind</div>
        <div class="weather-value">${fields.WIND_AVG_SPEED.displayValue || "N/A"}</div>
      </div>`);
    }
    if (fields.PRECIP_RATE) {
      items.push(`<div class="weather-item">
        <div class="weather-label">🌧️ Precip</div>
        <div class="weather-value">${fields.PRECIP_RATE.displayValue || "N/A"}</div>
      </div>`);
    }
    if (fields.VISIBILITY) {
      items.push(`<div class="weather-item">
        <div class="weather-label">👁️ Visibility</div>
        <div class="weather-value">${fields.VISIBILITY.displayValue || "N/A"}</div>
      </div>`);
    }
    if (fields.SURFACE_STATUS) {
      items.push(`<div class="weather-item">
        <div class="weather-label">🧊 Surface</div>
        <div class="weather-value">${fields.SURFACE_STATUS.displayValue || "N/A"}</div>
      </div>`);
    }

    if (items.length > 0) {
      weatherHtml = `<div class="weather-grid">${items.join("")}</div>`;
    }
  }

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">🌡️</span>
        <div class="popup-title">${p.title || "Weather Station"}</div>
      </div>
      ${p.routeDesignator ? `<div class="popup-meta">🛣️ ${p.routeDesignator}</div>` : ""}
      ${p.status ? `<span class="popup-badge ${p.status === "FREEZING" ? "high" : "low"}">${p.status}</span>` : ""}
      ${weatherHtml}
      ${updatedText ? `<div class="popup-time">🕒 Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function buildSignPopup(feature) {
  const p = feature.properties || {};
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);

  let viewsHtml = "";
  if (p.views && Array.isArray(p.views) && p.views.length > 0) {
    const view = p.views[0];
    if (view.textView && view.textView.lines) {
      const lines = view.textView.lines.filter(l => l.text).map(l => l.text);
      if (lines.length > 0) {
        viewsHtml = `<div class="popup-detail"><strong>Message:</strong><br>${lines.join("<br>")}</div>`;
      }
    }
  }

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">🚦</span>
        <div class="popup-title">${p.title || "Message Sign"}</div>
      </div>
      ${p.routeDesignator ? `<div class="popup-meta">🛣️ ${p.routeDesignator}</div>` : ""}
      ${p.signStatus ? `<span class="popup-badge ${p.signStatus === "ACTIVE" ? "low" : "medium"}">${p.signStatus}</span>` : ""}
      ${viewsHtml}
      ${updatedText ? `<div class="popup-time">🕒 Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function buildCameraPopup(feature) {
  const p = feature.properties || {};
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);
  const views = Array.isArray(p.cameraViews) ? p.cameraViews : [];

  const mediaItems = [];
  const viewItems = views.map((view) => {
    const sources = Array.isArray(view.sources) ? view.sources : [];
    const sourceUrls = sources.map((s) => s && s.src).filter(Boolean);

    let imageSrc = null;
    let videoSrc = null;

    // For both IMAGE and VIDEO categories, the view.url returns a JPEG image
    if (view.url && /\/cameras\/MN\//.test(view.url)) {
      // Use view.url directly - it returns a JPEG image
      imageSrc = view.url;

      // For VIDEO category, also get the HLS stream URL from sources
      if (view.category === 'VIDEO') {
        videoSrc = sourceUrls.find(url => /\.m3u8(\?|$)/i.test(url));
      }
    }
    // Fallback: check for image/video URLs in sources
    else {
      imageSrc = sourceUrls.find(isImageUrl);
      videoSrc = sourceUrls.find(isVideoUrl);
    }

    const link = view.url || sourceUrls[0] || imageSrc || videoSrc || null;
    const title = view.title || view.category || "Camera View";
    const isHls = typeof videoSrc === "string" && /\.m3u8(\?|$)/i.test(videoSrc);
    let mediaIndex = -1;

    if (imageSrc || videoSrc || link) {
      mediaIndex = mediaItems.length;
      mediaItems.push({ title, videoSrc, imageSrc, link });
    }

    return { title, imageSrc, videoSrc, link, isHls, mediaIndex };
  });

  const mediaPayload = mediaItems.length ? encodeURIComponent(JSON.stringify(mediaItems)) : "";

  const items = viewItems.slice(0, 4).map((item) => {
    const { title, imageSrc, videoSrc, link, isHls, mediaIndex } = item;

    const dataAttrs = mediaIndex >= 0 ? [
      `data-title="${escapeAttr(title)}"`,
      `data-video="${escapeAttr(videoSrc || "")}"`,
      `data-image="${escapeAttr(imageSrc || "")}"`,
      `data-link="${escapeAttr(link || "")}"`,
      mediaPayload ? `data-media="${escapeAttr(mediaPayload)}"` : "",
      `data-index="${mediaIndex}"`
    ].filter(Boolean).join(" ") : "";

    let mediaHtml = "";
    if (imageSrc && mediaIndex >= 0) {
      // Show image with click to open modal
      mediaHtml = `
        <button class="camera-modal-trigger" type="button" ${dataAttrs}>
          <img class="popup-media-item" src="${imageSrc}" alt="${escapeAttr(title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=popup-media-placeholder>Image unavailable</div>'" />
          <div class="popup-play-overlay">
            <div class="popup-play-button">▶</div>
          </div>
        </button>
      `;
    } else if (videoSrc && mediaIndex >= 0) {
      // Video without image - show play button
      mediaHtml = `
        <button class="camera-modal-trigger popup-media-placeholder" type="button" ${dataAttrs}>
          ▶ Play ${isHls ? 'Live Stream' : 'Video'}
        </button>
      `;
    } else if (link && mediaIndex >= 0) {
      mediaHtml = `
        <button class="camera-modal-trigger popup-media-placeholder" type="button" ${dataAttrs}>
          View Camera
        </button>
      `;
    } else {
      mediaHtml = `
        <div class="popup-media-placeholder">
          No media available
        </div>
      `;
    }

    return `
      <div class="popup-media-card">
        <div class="popup-media-title">${title}</div>
        ${mediaHtml}
      </div>
    `;
  });

  const mediaBlock = items.length
    ? `<div class="popup-media-grid">${items.join("")}</div>`
    : `<div class="popup-detail">No camera media available.</div>`;

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">📹</span>
        <div class="popup-title">${p.title || "Traffic Camera"}</div>
      </div>
      ${p.road ? `<div class="popup-meta">🛣️ ${p.road} ${p.direction || ""}</div>` : ""}
      ${mediaBlock}
      ${updatedText ? `<div class="popup-time">⏱ Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function buildDefaultPopup(feature) {
  const p = feature.properties || {};
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);

  return `
    <div class="popup">
      <div class="popup-header">
        <span class="popup-icon">📍</span>
        <div class="popup-title">${p.title || "Location"}</div>
      </div>
      ${p.category ? `<div class="popup-meta">${p.category}</div>` : ""}
      ${p.tooltip ? `<div class="popup-detail">${p.tooltip}</div>` : ""}
      ${updatedText ? `<div class="popup-time">🕒 Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function buildHoverContent(feature, layerId) {
  const p = feature.properties || {};
  const title = p.title || p.tooltip || "Details";
  const updatedMs = extractUpdatedMs(feature);
  const updatedText = formatTimestamp(updatedMs);

  // Special handling for cameras - show preview image
  if (layerId === 'cameras' && p.cameraViews && Array.isArray(p.cameraViews)) {
    const views = p.cameraViews;
    const firstView = views[0];
    if (firstView) {
      let imageSrc = null;

      // For both IMAGE and VIDEO categories, the view.url returns a JPEG image
      if (firstView.url && /\/cameras\/MN\//.test(firstView.url)) {
        imageSrc = firstView.url;
      }
      // Fallback: check sources for image URLs
      else {
        const sources = Array.isArray(firstView.sources) ? firstView.sources : [];
        const sourceUrls = sources.map((s) => s && s.src).filter(Boolean);
        imageSrc = sourceUrls.find(isImageUrl) || (isImageUrl(firstView.url) ? firstView.url : null);
      }

      if (imageSrc) {
        return `
          <div class="hover-tip hover-camera">
            <img src="${imageSrc}" alt="${escapeAttr(title)}" class="hover-camera-preview" />
            <div class="hover-title">${title}</div>
            ${updatedText ? `<div class="hover-time">Updated ${updatedText}</div>` : ""}
          </div>
        `;
      }
    }
  }

  return `
    <div class="hover-tip">
      <div class="hover-title">${title}</div>
      ${updatedText ? `<div class="hover-time">Updated ${updatedText}</div>` : ""}
    </div>
  `;
}

function getPopupContent(feature, layerId) {
  let content = "";
  if (layerId === "weather-stations") content = buildWeatherStationPopup(feature);
  else if (layerId === "signs") content = buildSignPopup(feature);
  else if (layerId === "cameras") content = buildCameraPopup(feature);
  else if (["incidents", "closures", "construction"].includes(layerId)) content = buildTrafficPopup(feature);
  else if (layerId === "surface-incidents") content = buildSurfacePopup(feature);
  else content = buildDefaultPopup(feature);

  return appendPopupActions(content, feature, layerId);
}

function appendPopupActions(content, feature, layerId) {
  const favoriteId = feature?.properties?.favoriteId || getFeatureId(feature, layerId);
  if (!feature.properties) feature.properties = {};
  feature.properties.favoriteId = favoriteId;
  const isFavorite = favoriteIds.has(favoriteId);
  const buttonHtml = `
    <div class="popup-actions">
      <button type="button" class="favorite-toggle ${isFavorite ? "is-favorite" : ""}" data-favorite-id="${escapeAttr(favoriteId)}">
        <span class="favorite-star">${isFavorite ? "★" : "☆"}</span>
        <span class="favorite-text">${isFavorite ? "Saved" : "Save"}</span>
      </button>
    </div>
  `;

  return content.replace(/<\/div>\s*$/, `${buttonHtml}</div>`);
}

// Layer rendering
function getMarkerIcon(layerId) {
  const allLayers = Object.values(LAYER_CATEGORIES).flatMap(cat => cat.layers);
  const layer = allLayers.find(l => l.id === layerId);
  return layer ? layer.icon : "📍";
}

function addGeoJsonLayer(layerId, geojson) {
  const allLayers = Object.values(LAYER_CATEGORIES).flatMap(cat => cat.layers);
  const layerConfig = allLayers.find(l => l.id === layerId);
  const color = layerConfig ? layerConfig.color : "#0066cc";
  const markersForLayer = new Map();
  layerMarkers[layerId] = markersForLayer;

  // Create marker cluster group with custom options
  const clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 60,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 15,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let size = 'small';
      if (count >= 10) size = 'medium';
      if (count >= 50) size = 'large';

      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: `marker-cluster marker-cluster-${size}`,
        iconSize: L.point(40, 40)
      });
    }
  });

  const geoJsonLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) => {
      const icon = getMarkerIcon(layerId);
      const favoriteId = feature?.properties?.favoriteId || getFeatureId(feature, layerId);
      if (!feature.properties) feature.properties = {};
      feature.properties.favoriteId = favoriteId;
      const markerHtml = `
        <div style="font-size: 24px; line-height: 1; text-shadow: 0 0 3px white;">${icon}</div>
        <div class="marker-favorite">★</div>
      `;
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          html: markerHtml,
          className: `custom-marker${favoriteIds.has(favoriteId) ? " is-favorite" : ""}`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      });
      markersForLayer.set(favoriteId, marker);
      return marker;
    },
    style: () => ({ color, weight: 3, opacity: 0.7 }),
    onEachFeature: (feature, layer) => {
      const popupContent = getPopupContent(feature, layerId);
      const hoverContent = buildHoverContent(feature, layerId);

      // Use larger popup for cameras to accommodate videos
      const popupMaxWidth = (layerId === 'cameras') ? 500 : 300;

      layer.bindPopup(popupContent, {
        maxWidth: popupMaxWidth,
        closeOnClick: false,
        autoClose: true,
        closeButton: true
      });
      layer.on("popupopen", () => {
        layer.setPopupContent(getPopupContent(feature, layerId));
      });
      layer.bindTooltip(hoverContent, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
        className: "feature-tooltip"
      });
    }
  });

  // Add all markers to the cluster group
  clusterGroup.addLayer(geoJsonLayer);
  clusterGroup.on("layeradd", (event) => {
    const marker = event.layer;
    const favoriteId = marker?.feature?.properties?.favoriteId;
    if (!favoriteId || !marker.getElement) return;
    const el = marker.getElement();
    if (el) {
      el.classList.toggle("is-favorite", favoriteIds.has(favoriteId));
    }
  });

  if (layerGroups[layerId]) {
    map.removeLayer(layerGroups[layerId]);
  }
  layerGroups[layerId] = clusterGroup;
  clusterGroup.addTo(map);
}

// Data loading
async function loadLayer(layerId, bbox) {
  const allLayers = Object.values(LAYER_CATEGORIES).flatMap(cat => cat.layers);
  const layer = allLayers.find(l => l.id === layerId);
  if (!layer) return { features: [] };

  const url = buildLayerUrl(layer.endpoint, bbox);

  try {
    if (layerControllers[layerId]) {
      layerControllers[layerId].abort();
    }
    const controller = new AbortController();
    layerControllers[layerId] = controller;
    const res = await fetch(url, { cache: "no-cache", signal: controller.signal });
    if (res.status === 304) {
      const cached = getCachedLayer(layerId, bbox);
      return cached || { features: [] };
    }
    if (!res.ok) {
      console.error(`Failed to load ${layerId}: ${res.status}`);
      return { features: [] };
    }
    const data = await res.json();
    if (layerId === "surface-incidents" && data && Array.isArray(data.features)) {
      data.features = data.features.map((feature) => {
        const p = feature.properties || {};
        const location = p.location_description || p.locationDescription || p.location || "";
        const incidentTime = p.incident_time || p.incidentTime || null;
        return {
          ...feature,
          properties: {
            ...p,
            title: p.title || "Surface incident",
            tooltip: location || p.tooltip || "",
            category: p.category || "Surface hazard",
            location_description: location || p.location_description || "",
            reported_at: p.reported_at || incidentTime || null,
            last_updated_at: p.last_updated_at || incidentTime || null
          }
        };
      });
    }
    return data.features ? data : { features: [] };
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { features: [] };
    }
    console.error(`Error loading ${layerId}:`, err);
    return { features: [] };
  }
}

// UI builders
function buildLayerControls() {
  Object.entries(LAYER_CATEGORIES).forEach(([categoryKey, category]) => {
    const containerEl = document.getElementById(`${categoryKey}-layers`);
    if (!containerEl) return;

    containerEl.innerHTML = "";
    category.layers.forEach(layer => {
      const item = document.createElement("div");
      item.className = "layer-item";
      item.innerHTML = `
        <label class="layer-label">
          <span class="layer-icon">${layer.icon}</span>
          ${layer.label}
        </label>
        <input class="layer-toggle" type="checkbox" data-layer="${layer.id}" ${layer.enabled ? "checked" : ""} />
      `;
      containerEl.appendChild(item);
    });
  });

  // Bind toggle events
  document.querySelectorAll("input.layer-toggle").forEach(el => {
    el.addEventListener("change", handleLayerToggle);
  });
}

function buildLegend() {
  const legendEl = document.getElementById("legend");
  if (!legendEl) return;

  legendEl.innerHTML = "";
  Object.values(LAYER_CATEGORIES).forEach(category => {
    category.layers.forEach(layer => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <span class="legend-icon">${layer.icon}</span>
        <div>
          <div class="legend-label">${layer.label}</div>
          <div class="legend-desc">View ${layer.label.toLowerCase()} on the map</div>
        </div>
      `;
      legendEl.appendChild(item);
    });
  });
}

// List rendering
function renderList() {
  const listEl = document.getElementById("list");
  const countEl = document.getElementById("list-count");
  if (!listEl) return;

  let filtered = [...allFeatures];

  // Apply filters
  if (currentFilter === "high") {
    filtered = filtered.filter(f => {
      const p = f.properties || {};
      const sev = p.severity ?? p.priority ?? 0;
      return sev >= 3;
    });
  } else if (currentFilter === "recent") {
    const hourAgo = Date.now() - 3600000;
    filtered = filtered.filter(f => {
      const ms = extractUpdatedMs(f);
      return ms && ms > hourAgo;
    });
  }

  // Sort by severity and time
  filtered.sort((a, b) => {
    const aSev = a.properties?.severity ?? a.properties?.priority ?? 0;
    const bSev = b.properties?.severity ?? b.properties?.priority ?? 0;
    if (aSev !== bSev) return bSev - aSev;

    const aTime = extractUpdatedMs(a) || 0;
    const bTime = extractUpdatedMs(b) || 0;
    return bTime - aTime;
  });

  // Limit to 50 items
  filtered = filtered.slice(0, 50);

  if (countEl) countEl.textContent = filtered.length;

  listEl.innerHTML = "";
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">No items to display</div>
      </div>
    `;
    return;
  }

  filtered.forEach((feature, idx) => {
    const p = feature.properties || {};
    const severity = p.severity ?? p.priority ?? null;
    const title = p.title || "Alert";
    const updatedMs = extractUpdatedMs(feature);
    const updatedText = formatRelativeTime(updatedMs);
    const layerId = p.layerId || "unknown";
    const favoriteId = p.favoriteId || getFeatureId(feature, layerId);

    const meta = [p.category, p.road, p.routeDesignator].filter(Boolean).join(" • ");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "panel-item";
    if (severity !== null && severity >= 3) item.classList.add("severity-high");
    else if (severity !== null && severity >= 2) item.classList.add("severity-medium");
    else if (severity !== null) item.classList.add("severity-low");

    item.dataset.featureIndex = idx;
    item.innerHTML = `
      <div class="panel-item-title">${title}</div>
      ${meta ? `<div class="panel-item-meta">${meta}</div>` : ""}
      <div class="panel-item-time">${updatedText}</div>
      ${severity !== null && severity >= 3 ? `<span class="panel-badge high">High</span>` : ""}
      ${severity !== null && severity === 2 ? `<span class="panel-badge medium">Medium</span>` : ""}
      <span role="button" class="panel-item-favorite ${favoriteIds.has(favoriteId) ? "is-favorite" : ""}" data-favorite-id="${escapeAttr(favoriteId)}" title="Save favorite" tabindex="0">${favoriteIds.has(favoriteId) ? "★" : "☆"}</span>
    `;

    item.addEventListener("click", () => focusOnFeature(feature));
    listEl.appendChild(item);
  });
}

function focusOnFeature(feature) {
  if (!feature) return;

  const geometry = feature.geometry || {};

  // Try bbox first
  if (Array.isArray(feature.bbox) && feature.bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [50, 50], maxZoom: 14 });
      return;
    }
  }

  // Try point geometry
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map.setView([lat, lon], Math.max(map.getZoom(), 13), { animate: true });
    }
  }
}

// Event handlers
async function handleLayerToggle(event) {
  const layerId = event.target.dataset.layer;
  const isEnabled = event.target.checked;

  // Update layer config
  Object.values(LAYER_CATEGORIES).forEach(category => {
    const layer = category.layers.find(l => l.id === layerId);
    if (layer) layer.enabled = isEnabled;
  });

  if (isEnabled) {
    const bbox = getCurrentBbox();
    const cached = getCachedLayer(layerId, bbox);
    if (cached) {
      renderLayer(layerId, cached);
      refreshLayer(layerId, bbox);
    } else {
      await refreshLayer(layerId, bbox);
    }
  } else {
    if (layerGroups[layerId]) {
      map.removeLayer(layerGroups[layerId]);
      delete layerGroups[layerId];
    }
    if (layerMarkers[layerId]) {
      delete layerMarkers[layerId];
    }
    // Remove from allFeatures
    allFeatures = allFeatures.filter(f => f.properties?.layerId !== layerId);
    renderList();
  }
}

function renderLayer(layerId, geojson) {
  if (geojson.features && geojson.features.length > 0) {
    // Tag features with layerId
    geojson.features.forEach(f => {
      if (!f.properties) f.properties = {};
      f.properties.layerId = layerId;
      f.properties.favoriteId = f.properties.favoriteId || getFeatureId(f, layerId);
    });

    // Merge new features with existing ones (prevent disappearing)
    const existingFeatures = allFeatures.filter(f => f.properties?.layerId === layerId);
    const newFeaturesMap = new Map();

    // Create map of new features by unique ID
    geojson.features.forEach(f => {
      const id = f.id || f.properties?.id || JSON.stringify(f.geometry?.coordinates);
      newFeaturesMap.set(id, f);
    });

    // Add existing features that aren't in new data
    existingFeatures.forEach(f => {
      const id = f.id || f.properties?.id || JSON.stringify(f.geometry?.coordinates);
      if (!newFeaturesMap.has(id)) {
        newFeaturesMap.set(id, f);
      }
    });

    // Create merged geojson
    const mergedGeojson = {
      type: 'FeatureCollection',
      features: Array.from(newFeaturesMap.values())
    };

    addGeoJsonLayer(layerId, mergedGeojson);

    // Update allFeatures
    allFeatures = allFeatures.filter(f => f.properties?.layerId !== layerId);
    allFeatures.push(...mergedGeojson.features);
    rebuildFeatureIndex();
    renderList();
    renderFavoritesList();
    return true;
  }

  if (layerGroups[layerId]) {
    map.removeLayer(layerGroups[layerId]);
    delete layerGroups[layerId];
  }
  allFeatures = allFeatures.filter(f => f.properties?.layerId !== layerId);
  rebuildFeatureIndex();
  renderList();
  renderFavoritesList();
  return false;
}

async function refreshLayer(layerId, bbox) {
  const targetBbox = bbox || getCurrentBbox();
  const geojson = await loadLayer(layerId, targetBbox);
  cacheLayerData(layerId, targetBbox, geojson);
  renderLayer(layerId, geojson);
}

async function refreshAllLayers() {
  if (refreshInProgress) {
    refreshPending = true;
    return;
  }
  refreshInProgress = true;

  const enabledLayers = Object.values(LAYER_CATEGORIES)
    .flatMap(cat => cat.layers)
    .filter(layer => layer.enabled);

  const bbox = getCurrentBbox();

  const enabledIds = new Set(enabledLayers.map(layer => layer.id));
  Object.keys(layerGroups).forEach(layerId => {
    if (!enabledIds.has(layerId)) {
      map.removeLayer(layerGroups[layerId]);
      delete layerGroups[layerId];
      if (layerMarkers[layerId]) delete layerMarkers[layerId];
    }
  });

  allFeatures = [];
  rebuildFeatureIndex();

  enabledLayers.forEach(layer => {
    const cached = getCachedLayer(layer.id, bbox);
    if (cached) renderLayer(layer.id, cached);
  });

  await Promise.all(enabledLayers.map(layer => refreshLayer(layer.id, bbox)));

  updateLastUpdateTime();

  refreshInProgress = false;
  if (refreshPending) {
    refreshPending = false;
    refreshAllLayers();
  }
}

async function preloadAllLayers() {
  const allLayers = Object.values(LAYER_CATEGORIES).flatMap(cat => cat.layers);
  const bbox = getCurrentBbox();

  await Promise.all(
    allLayers.map(async layer => {
      const geojson = await loadLayer(layer.id, bbox);
      cacheLayerData(layer.id, bbox, geojson);
      if (layer.enabled) {
        renderLayer(layer.id, geojson);
      }
    })
  );

  updateLastUpdateTime();
}

function updateLastUpdateTime() {
  const el = document.getElementById("last-update");
  if (el) {
    const now = new Date();
    el.textContent = `Updated ${now.toLocaleTimeString()}`;
  }
}

// Section toggles
function setupSectionToggles() {
  document.querySelectorAll(".section-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section;
      const category = LAYER_CATEGORIES[section];
      if (!category) return;

      // Check current state
      const allEnabled = category.layers.every(l => l.enabled);
      const targetState = !allEnabled;

      // Update all layer toggles in this section
      category.layers.forEach(layer => {
        layer.enabled = targetState;
        const checkbox = document.querySelector(`input[data-layer="${layer.id}"]`);
        if (checkbox) checkbox.checked = targetState;
      });

      // Update button text
      btn.textContent = targetState ? "Deselect All" : "Select All";

      // Refresh layers
      refreshAllLayers();
    });
  });
}

// Filter chips
function setupFilterChips() {
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.dataset.filter;
      renderList();
    });
  });
}

// Tabs
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.toggle("active", panel.id === `tab-${target}`);
      });
    });
  });
}

function ensureCameraModal() {
  if (document.getElementById("camera-modal")) return;

  const modal = document.createElement("div");
  modal.id = "camera-modal";
  modal.className = "camera-modal hidden";
  modal.innerHTML = `
    <div class="camera-modal-backdrop" data-close="true"></div>
    <div class="camera-modal-dialog" role="dialog" aria-modal="true">
      <div class="camera-modal-header">
        <div class="camera-modal-title"></div>
        <button class="camera-modal-close" type="button" data-close="true">×</button>
      </div>
      <div class="camera-modal-body">
        <button class="camera-modal-nav prev" type="button" data-nav="prev" aria-label="Previous media">‹</button>
        <div class="camera-modal-stage"></div>
        <button class="camera-modal-nav next" type="button" data-nav="next" aria-label="Next media">›</button>
      </div>
      <div class="camera-modal-footer">
        <div class="camera-modal-counter"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.close) {
      hideCameraModal();
    }
    if (event.target && event.target.dataset && event.target.dataset.nav) {
      const direction = event.target.dataset.nav;
      if (direction === "prev") setCameraModalIndex(cameraModalIndex - 1);
      if (direction === "next") setCameraModalIndex(cameraModalIndex + 1);
    }
  });
}

let currentHls = null;
let cameraModalItems = [];
let cameraModalIndex = 0;

function renderCameraModalMedia() {
  const modal = document.getElementById("camera-modal");
  if (!modal) return;

  const titleEl = modal.querySelector(".camera-modal-title");
  const stageEl = modal.querySelector(".camera-modal-stage");
  const counterEl = modal.querySelector(".camera-modal-counter");
  const prevBtn = modal.querySelector(".camera-modal-nav.prev");
  const nextBtn = modal.querySelector(".camera-modal-nav.next");

  const current = cameraModalItems[cameraModalIndex];
  if (!current) return;

  titleEl.textContent = current.title || "Camera View";
  stageEl.innerHTML = "";

  // Clean up any existing HLS instance
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }

  const { videoSrc, imageSrc, link, title } = current;

  // HLS stream (.m3u8)
  if (videoSrc && /\.m3u8(\?|$)/i.test(videoSrc)) {
    const video = document.createElement("video");
    video.className = "camera-modal-media";
    video.controls = true;
    video.autoplay = true;
    video.muted = false;
    video.playsInline = true;
    stageEl.appendChild(video);

    // Use HLS.js if supported, otherwise try native HLS support (Safari)
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(err => {
          console.log('Autoplay prevented:', err);
        });
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.log('Fatal error, destroying HLS...');
              hls.destroy();
              stageEl.innerHTML = '<div class="camera-modal-empty">Failed to load video stream</div>';
              break;
          }
        }
      });
      currentHls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = videoSrc;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(err => {
          console.log('Autoplay prevented:', err);
        });
      });
    } else {
      stageEl.innerHTML = `
        <div class="camera-modal-empty">
          HLS streaming not supported in this browser.
          <a href="${videoSrc}" target="_blank" rel="noopener" class="camera-modal-link" style="margin-top: 12px;">Open stream directly</a>
        </div>
      `;
    }
  }
  // Regular video file
  else if (videoSrc) {
    const video = document.createElement("video");
    video.className = "camera-modal-media";
    video.controls = true;
    video.autoplay = true;
    video.preload = "metadata";
    video.src = videoSrc;
    stageEl.appendChild(video);
  }
  // Show image
  else if (imageSrc) {
    const img = document.createElement("img");
    img.className = "camera-modal-media";
    img.src = imageSrc;
    img.alt = title || "Camera view";
    stageEl.appendChild(img);
  }
  // Fallback to link
  else if (link) {
    const linkEl = document.createElement("a");
    linkEl.className = "camera-modal-link";
    linkEl.href = link;
    linkEl.target = "_blank";
    linkEl.rel = "noopener";
    linkEl.textContent = "Open camera view";
    stageEl.appendChild(linkEl);
  }
  // No media
  else {
    const empty = document.createElement("div");
    empty.className = "camera-modal-empty";
    empty.textContent = "No media available.";
    stageEl.appendChild(empty);
  }

  if (counterEl) {
    counterEl.textContent = cameraModalItems.length > 1
      ? `${cameraModalIndex + 1} of ${cameraModalItems.length}`
      : "";
  }
  if (prevBtn) prevBtn.disabled = cameraModalItems.length < 2;
  if (nextBtn) nextBtn.disabled = cameraModalItems.length < 2;
}

function setCameraModalIndex(nextIndex) {
  if (!cameraModalItems.length) return;
  const total = cameraModalItems.length;
  cameraModalIndex = ((nextIndex % total) + total) % total;
  renderCameraModalMedia();
}

function showCameraModal({ title, videoSrc, imageSrc, link, items, index }) {
  ensureCameraModal();
  const modal = document.getElementById("camera-modal");

  if (Array.isArray(items) && items.length) {
    cameraModalItems = items;
    cameraModalIndex = Number.isFinite(index) ? Math.min(Math.max(index, 0), items.length - 1) : 0;
  } else {
    cameraModalItems = [{ title, videoSrc, imageSrc, link }];
    cameraModalIndex = 0;
  }

  renderCameraModalMedia();
  modal.classList.remove("hidden");
}

function hideCameraModal() {
  const modal = document.getElementById("camera-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  cameraModalItems = [];
  cameraModalIndex = 0;

  // Clean up video
  const video = modal.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  // Clean up HLS instance
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
}

document.addEventListener("click", (event) => {
  const favoriteBtn = event.target.closest(".favorite-toggle, .panel-item-favorite");
  if (!favoriteBtn) return;
  event.preventDefault();
  event.stopPropagation();
  const favoriteId = favoriteBtn.dataset.favoriteId;
  toggleFavorite(favoriteId).catch(err => {
    console.warn("Favorite toggle failed:", err);
    alert(err.message || "Unable to update favorite.");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const favoriteBtn = event.target.closest(".panel-item-favorite");
  if (!favoriteBtn) return;
  event.preventDefault();
  const favoriteId = favoriteBtn.dataset.favoriteId;
  toggleFavorite(favoriteId).catch(err => {
    console.warn("Favorite toggle failed:", err);
    alert(err.message || "Unable to update favorite.");
  });
});

document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".camera-modal-trigger");
  if (!trigger) return;
  event.preventDefault();

  const mediaRaw = trigger.dataset.media || "";
  if (mediaRaw) {
    try {
      const items = JSON.parse(decodeURIComponent(mediaRaw));
      if (Array.isArray(items) && items.length) {
        const idx = Number(trigger.dataset.index);
        showCameraModal({ items, index: Number.isFinite(idx) ? idx : 0 });
        return;
      }
    } catch (err) {
      console.warn("Failed to parse camera media list:", err);
    }
  }

  showCameraModal({
    title: trigger.dataset.title || "",
    videoSrc: trigger.dataset.video || "",
    imageSrc: trigger.dataset.image || "",
    link: trigger.dataset.link || ""
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const authModal = document.getElementById("auth-modal");
  if (authModal && !authModal.classList.contains("hidden")) {
    hideAuthModal();
  }
});

document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("camera-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  if (event.key === "ArrowLeft") setCameraModalIndex(cameraModalIndex - 1);
  if (event.key === "ArrowRight") setCameraModalIndex(cameraModalIndex + 1);
  if (event.key === "Escape") hideCameraModal();
});

// Map controls
function setupMapControls() {
  const zoomIn = document.getElementById("zoom-in");
  const zoomOut = document.getElementById("zoom-out");
  const locate = document.getElementById("locate");
  const refresh = document.getElementById("refresh");

  if (zoomIn) zoomIn.addEventListener("click", () => map.zoomIn());
  if (zoomOut) zoomOut.addEventListener("click", () => map.zoomOut());

  if (locate) {
    locate.addEventListener("click", () => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 12, { animate: true });
          },
          err => {
            console.error("Geolocation error:", err);
            alert("Could not get your location");
          }
        );
      } else {
        alert("Geolocation not supported");
      }
    });
  }

  if (refresh) {
    refresh.addEventListener("click", () => {
      refreshAllLayers();
    });
  }
}

// Map events
let refreshTimer = null;
map.on("moveend", () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshAllLayers();
  }, 500);
});

map.on("click", (event) => {
  const target = event.originalEvent && event.originalEvent.target;
  if (target && (target.closest(".leaflet-popup") || target.closest(".leaflet-marker-icon") || target.closest(".marker-cluster"))) {
    return;
  }
  map.closePopup();
});

// Panel resize functionality
function setupPanelResize() {
  const panel = document.getElementById('map-panel');
  if (!panel) return;

  const minWidth = 260;
  const minHeight = 260;
  const maxWidth = window.innerWidth * 0.8;
  const maxHeight = window.innerHeight - 32;

  let isResizing = false;
  let resizeType = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startRight = 0;
  let startTop = 0;

  const handles = panel.querySelectorAll('.resize-handle');

  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      resizeType = handle.dataset.resize;

      startX = e.clientX;
      startY = e.clientY;
      startWidth = panel.offsetWidth;
      startHeight = panel.offsetHeight;

      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;

      document.body.style.cursor = handle.style.cursor;
      document.body.style.userSelect = 'none';
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    e.preventDefault();

    const deltaX = startX - e.clientX;
    const deltaY = e.clientY - startY;

    if (resizeType === 'corner') {
      // Resize both width and height (from bottom-left corner)
      const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth);
      const newHeight = Math.min(Math.max(startHeight + deltaY, minHeight), maxHeight);

      panel.style.width = newWidth + 'px';
      panel.style.height = newHeight + 'px';
    } else if (resizeType === 'right') {
      // Resize width only (from left edge)
      const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth);
      panel.style.width = newWidth + 'px';
    } else if (resizeType === 'bottom') {
      // Resize height only
      const newHeight = Math.min(Math.max(startHeight + deltaY, minHeight), maxHeight);
      panel.style.height = newHeight + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizeType = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Initialize
async function init() {
  buildLayerControls();
  buildLegend();
  setupTabs();
  setupSectionToggles();
  setupFilterChips();
  setupMapControls();
  setupPanelResize();
  updateAuthUI();

  const loginBtn = document.getElementById("auth-login");
  const favoritesLogin = document.getElementById("favorites-login");
  const logoutBtn = document.getElementById("auth-logout");
  const favoritesLogout = document.getElementById("favorites-logout");

  if (loginBtn) loginBtn.addEventListener("click", showAuthModal);
  if (favoritesLogin) favoritesLogin.addEventListener("click", showAuthModal);
  if (logoutBtn) logoutBtn.addEventListener("click", () => logout());
  if (favoritesLogout) favoritesLogout.addEventListener("click", () => logout());

  await initAuth();

  await preloadAllLayers();

  // Auto-refresh every 2 minutes
  setInterval(() => {
    refreshAllLayers();
  }, 120000);
}

// Start the app
init();
