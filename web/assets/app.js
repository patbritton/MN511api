// API Configuration
const urlParams = new URLSearchParams(window.location.search);
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const localApiBase = `${window.location.protocol}//${window.location.hostname}:8787`;
const rawApiBase = urlParams.get("apiBase") || window.MN511_API_BASE;

function normalizeApiBase(base) {
  if (!base) return base;
  return base.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
}

const API_BASE =
  normalizeApiBase(rawApiBase) ||
  (isLocalHost ? localApiBase : "https://511.mp.ls");
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

  const items = views.slice(0, 4).map((view, idx) => {
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

    const dataAttrs = [
      `data-title="${escapeAttr(title)}"`,
      `data-video="${escapeAttr(videoSrc || "")}"`,
      `data-image="${escapeAttr(imageSrc || "")}"`,
      `data-link="${escapeAttr(link || "")}"`
    ].join(" ");

    let mediaHtml = "";
    if (imageSrc) {
      // Show image with click to open modal
      mediaHtml = `
        <button class="camera-modal-trigger" type="button" ${dataAttrs}>
          <img class="popup-media-item" src="${imageSrc}" alt="${escapeAttr(title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=popup-media-placeholder>Image unavailable</div>'" />
          <div class="popup-play-overlay">
            <div class="popup-play-button">▶</div>
          </div>
        </button>
      `;
    } else if (videoSrc) {
      // Video without image - show play button
      mediaHtml = `
        <button class="camera-modal-trigger popup-media-placeholder" type="button" ${dataAttrs}>
          ▶ Play ${isHls ? 'Live Stream' : 'Video'}
        </button>
      `;
    } else if (link) {
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
  if (layerId === "weather-stations") return buildWeatherStationPopup(feature);
  if (layerId === "signs") return buildSignPopup(feature);
  if (layerId === "cameras") return buildCameraPopup(feature);
  if (["incidents", "closures", "construction"].includes(layerId)) return buildTrafficPopup(feature);
  return buildDefaultPopup(feature);
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
      const markerHtml = `<div style="font-size: 24px; line-height: 1; text-shadow: 0 0 3px white;">${icon}</div>`;
      return L.marker(latlng, {
        icon: L.divIcon({
          html: markerHtml,
          className: "custom-marker",
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      });
    },
    style: () => ({ color, weight: 3, opacity: 0.7 }),
    onEachFeature: (feature, layer) => {
      const popupContent = getPopupContent(feature, layerId);
      const hoverContent = buildHoverContent(feature, layerId);

      // Use larger popup for cameras to accommodate videos
      const popupMaxWidth = (layerId === 'cameras') ? 500 : 300;

      layer.bindPopup(popupContent, { maxWidth: popupMaxWidth });
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
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      console.error(`Failed to load ${layerId}: ${res.status}`);
      return { features: [] };
    }
    const data = await res.json();
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
    renderList();
    return true;
  }

  if (layerGroups[layerId]) {
    map.removeLayer(layerGroups[layerId]);
    delete layerGroups[layerId];
  }
  allFeatures = allFeatures.filter(f => f.properties?.layerId !== layerId);
  renderList();
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
    }
  });

  allFeatures = [];

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
      <div class="camera-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.close) {
      hideCameraModal();
    }
  });
}

let currentHls = null;

function showCameraModal({ title, videoSrc, imageSrc, link }) {
  ensureCameraModal();
  const modal = document.getElementById("camera-modal");
  const titleEl = modal.querySelector(".camera-modal-title");
  const bodyEl = modal.querySelector(".camera-modal-body");

  titleEl.textContent = title || "Camera View";
  bodyEl.innerHTML = "";

  // Clean up any existing HLS instance
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }

  // HLS stream (.m3u8)
  if (videoSrc && /\.m3u8(\?|$)/i.test(videoSrc)) {
    const video = document.createElement("video");
    video.className = "camera-modal-media";
    video.controls = true;
    video.autoplay = true;
    video.muted = false;
    video.playsInline = true;
    bodyEl.appendChild(video);

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
              bodyEl.innerHTML = '<div class="camera-modal-empty">Failed to load video stream</div>';
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
      bodyEl.innerHTML = `
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
    bodyEl.appendChild(video);
  }
  // Show image
  else if (imageSrc) {
    const img = document.createElement("img");
    img.className = "camera-modal-media";
    img.src = imageSrc;
    img.alt = title || "Camera view";
    bodyEl.appendChild(img);
  }
  // Fallback to link
  else if (link) {
    const linkEl = document.createElement("a");
    linkEl.className = "camera-modal-link";
    linkEl.href = link;
    linkEl.target = "_blank";
    linkEl.rel = "noopener";
    linkEl.textContent = "Open camera view";
    bodyEl.appendChild(linkEl);
  }
  // No media
  else {
    const empty = document.createElement("div");
    empty.className = "camera-modal-empty";
    empty.textContent = "No media available.";
    bodyEl.appendChild(empty);
  }

  modal.classList.remove("hidden");
}

function hideCameraModal() {
  const modal = document.getElementById("camera-modal");
  if (!modal) return;
  modal.classList.add("hidden");

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
  const trigger = event.target.closest(".camera-modal-trigger");
  if (!trigger) return;
  event.preventDefault();
  showCameraModal({
    title: trigger.dataset.title || "",
    videoSrc: trigger.dataset.video || "",
    imageSrc: trigger.dataset.image || "",
    link: trigger.dataset.link || ""
  });
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

  await preloadAllLayers();

  // Auto-refresh every 2 minutes
  setInterval(() => {
    refreshAllLayers();
  }, 120000);
}

// Start the app
init();
