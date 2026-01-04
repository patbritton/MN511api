(function () {
  const DEFAULTS = {
    apiBase: "https://511.mp.ls/api",
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
        L.geoJSON(geo).addTo(map);
        listEl.innerHTML = geo.features
          .slice(0, 10)
          .map((f) => {
            const p = f.properties || {};
            const titleText = p.title || "Alert";
            const meta = [p.category, p.severity ? `sev ${p.severity}` : ""]
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
