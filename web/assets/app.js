const API_BASE = "https://511.mp.ls/api";
const DEFAULT_BBOX = "-93.35,44.90,-93.15,45.02";
const DEFAULT_ZOOM = 12;

const LAYERS = [
  { id: "incidents", label: "Incidents", color: "#ff4d4d", enabled: true },
  { id: "closures", label: "Closures", color: "#ff9f1c", enabled: true },
  { id: "cameras", label: "Cameras", color: "#4dabf7", enabled: false },
  { id: "plows", label: "Plows", color: "#74c69d", enabled: false },
  { id: "road-conditions", label: "Road Conditions", color: "#f4d35e", enabled: false },
  { id: "weather-events", label: "Weather Events", color: "#b197fc", enabled: false },
  { id: "alerts", label: "Alerts", color: "#e03131", enabled: false },
  { id: "rest-areas", label: "Rest Areas", color: "#a5d8ff", enabled: false },
  { id: "weigh-stations", label: "Weigh Stations", color: "#63e6be", enabled: false },
  { id: "fueling-stations", label: "Fueling Stations", color: "#ffd43b", enabled: false },
  { id: "rwss", label: "RWIS Stations", color: "#ced4da", enabled: false }
];

const map = L.map("map").setView([44.9778, -93.265], DEFAULT_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap &copy; CARTO"
}).addTo(map);

const layerGroups = {};
const listEl = document.getElementById("list");
const layerListEl = document.getElementById("layer-list");
const legendEl = document.getElementById("legend");
let lastListItems = [];

function buildUrl(endpoint, bbox, zoom) {
  return `${API_BASE}/${endpoint}?bbox=${bbox}&zoom=${zoom}`;
}

function buildLayerList() {
  layerListEl.innerHTML = "";
  LAYERS.forEach((layer) => {
    const row = document.createElement("div");
    row.className = "layer-item";
    row.innerHTML = `
      <label class="layer-label">
        <span class="layer-swatch" style="background:${layer.color}"></span>
        ${layer.label}
      </label>
      <input class="layer-toggle" type="checkbox" data-layer="${layer.id}" ${
        layer.enabled ? "checked" : ""
      } />
    `;
    layerListEl.appendChild(row);
  });
}

function buildLegend() {
  legendEl.innerHTML = "";
  LAYERS.forEach((layer) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="layer-swatch" style="background:${layer.color}"></span>
      <span class="legend-label">${layer.label}</span>
    `;
    legendEl.appendChild(item);
  });
}

function renderList(items) {
  listEl.innerHTML = "";
  lastListItems = items
    .sort((a, b) => {
      const ap = a.properties || {};
      const bp = b.properties || {};
      return (bp.severity || bp.priority || 0) - (ap.severity || ap.priority || 0);
    })
    .slice(0, 40);

  lastListItems.forEach((f, idx) => {
    const p = f.properties || {};
    const severity = p.severity ?? p.priority ?? null;
    const title = p.title || "Alert";
    const meta = [p.category, p.road, p.direction].filter(Boolean).join(" ");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "panel-item";
    item.dataset.idx = String(idx);
    item.innerHTML = `
      <div class="panel-item-title">${title}</div>
      <div class="panel-item-meta">${meta || "General"}</div>
      ${severity !== null ? `<span class="panel-badge">Sev ${severity}</span>` : ""}
    `;
    listEl.appendChild(item);
  });
}

async function loadLayer(endpoint, bbox, zoom) {
  const url = buildUrl(endpoint, bbox, zoom);
  const res = await fetch(url);
  if (!res.ok) return { features: [] };
  return res.json();
}

function addGeoJson(endpoint, geojson) {
  const color = (LAYERS.find((l) => l.id === endpoint) || {}).color || "#ffffff";
  const group = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.7
      }),
    style: () => ({ color, weight: 3 }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const title = p.title || "Alert";
      const meta = [p.category, p.road, p.direction].filter(Boolean).join(" ");
      const severity = p.severity ?? p.priority ?? null;
      const html = `
        <div class="popup">
          <div class="popup-title">${title}</div>
          <div class="popup-meta">${meta || "General"}</div>
          ${severity !== null ? `<div class="popup-sev">Severity ${severity}</div>` : ""}
          ${p.tooltip ? `<div class="popup-tip">${p.tooltip}</div>` : ""}
        </div>
      `;
      layer.bindPopup(html, { maxWidth: 320 });
    }
  });

  if (layerGroups[endpoint]) {
    map.removeLayer(layerGroups[endpoint]);
  }
  layerGroups[endpoint] = group;
  group.addTo(map);
}

async function refresh() {
  const bounds = map.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    .map((n) => n.toFixed(5))
    .join(",");
  const zoom = map.getZoom();

  const checks = Array.from(document.querySelectorAll("input[data-layer]"));
  const active = checks.filter((c) => c.checked).map((c) => c.dataset.layer);

  const allItems = [];
  for (const endpoint of active) {
    const geo = await loadLayer(endpoint, bbox, zoom);
    if (geo && geo.features) {
      addGeoJson(endpoint, geo);
      allItems.push(...geo.features);
    }
  }

  renderList(allItems);
}

function focusFeature(feature) {
  if (!feature) return;
  const geometry = feature.geometry || {};
  if (Array.isArray(feature.bbox) && feature.bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      map.fitBounds(
        [
          [minLat, minLon],
          [maxLat, maxLon]
        ],
        { padding: [40, 40] }
      );
      return;
    }
  }
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map.setView([lat, lon], Math.max(map.getZoom(), 12), { animate: true });
    }
  }
}

function bindTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab-btn"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${target}`);
      });
    });
  });
}

function bindLayerToggles() {
  Array.from(document.querySelectorAll("input[data-layer]")).forEach((el) => {
    el.addEventListener("change", refresh);
  });
}

listEl.addEventListener("click", (event) => {
  const target = event.target.closest(".panel-item");
  if (!target) return;
  const idx = Number(target.dataset.idx);
  const feature = lastListItems[idx];
  focusFeature(feature);
});

let refreshTimer = null;
map.on("moveend", () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 250);
});

buildLayerList();
buildLegend();
bindTabs();
bindLayerToggles();
refresh();
