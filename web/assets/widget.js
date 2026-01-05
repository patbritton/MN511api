(function () {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const localApiBase = `${window.location.protocol}//${window.location.hostname}:8787`;
  const baseOverride = window.MN511_API_BASE || "";
  const normalizedBase = baseOverride.replace(/\/api\/?$/i, "").replace(/\/+$/, "");

  const DEFAULTS = {
    apiBase: normalizedBase || (isLocalHost ? localApiBase : "https://511.mp.ls/api"),
    bbox: "-93.35,44.90,-93.15,45.02",
    zoom: 12,
    endpoint: "incidents",
    title: "MN511 Alerts"
  };

  function loadLeaflet(cb) {
    if (window.L) return cb();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    link.crossOrigin = "";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "";
    script.onload = cb;
    document.body.appendChild(script);
  }

  function fetchGeo(apiBase, endpoint, bbox, zoom) {
    const url = `${apiBase}/${endpoint}?bbox=${bbox}&zoom=${zoom}`;
    return fetch(url).then((r) => (r.ok ? r.json() : { features: [] }));
  }

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
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
  }

  function renderWidget(el) {
    const apiBase = el.dataset.apiBase || DEFAULTS.apiBase;
    const bbox = el.dataset.bbox || DEFAULTS.bbox;
    const zoom = Number(el.dataset.zoom || DEFAULTS.zoom);
    const endpoint = el.dataset.endpoint || DEFAULTS.endpoint;
    const title = el.dataset.title || DEFAULTS.title;

    el.classList.add("mn511-widget");
    el.innerHTML = `
      <div class="mn511-widget-header">${title}</div>
      <div class="mn511-widget-map"></div>
      <div class="mn511-widget-list"></div>
    `;

    const mapEl = el.querySelector(".mn511-widget-map");
    const listEl = el.querySelector(".mn511-widget-list");

    const map = L.map(mapEl).setView([44.9778, -93.265], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    fetchGeo(apiBase, endpoint, bbox, zoom).then((geo) => {
      if (geo && geo.features) {
        L.geoJSON(geo, {
          onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            const titleText = p.title || "Alert";
            const updatedMs = extractUpdatedMs(feature);
            const updatedText = formatTimestamp(updatedMs);
            const html = `
              <div class="mn511-widget-popup">
                <div class="mn511-widget-title">${titleText}</div>
                ${updatedText ? `<div class="mn511-widget-meta">Updated ${updatedText}</div>` : ""}
              </div>
            `;
            layer.bindPopup(html, { maxWidth: 260 });
          }
        }).addTo(map);
        listEl.innerHTML = geo.features
          .slice(0, 10)
          .map((f) => {
            const p = f.properties || {};
            const titleText = p.title || "Alert";
            const updatedMs = extractUpdatedMs(f);
            const updatedText = formatTimestamp(updatedMs);
            const meta = [p.category, p.severity ? `sev ${p.severity}` : "", updatedText]
              .filter(Boolean)
              .join(" ? ");
            return `
              <div class="mn511-widget-item">
                <div class="mn511-widget-title">${titleText}</div>
                <div class="mn511-widget-meta">${meta}</div>
              </div>
            `;
          })
          .join("");
      }
    });
  }

  function boot() {
    const css = document.createElement("link");
    const scriptSrc = (document.currentScript && document.currentScript.src) || "";
    const base = scriptSrc ? scriptSrc.replace(/\/[^/]*$/, "/") : "";
    css.rel = "stylesheet";
    css.href = base + "widget.css";
    document.head.appendChild(css);

    const widgets = document.querySelectorAll(".mn511-widget");
    widgets.forEach(renderWidget);
  }

  loadLeaflet(boot);
})();
