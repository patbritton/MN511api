function extractRoadDirection(title = "") {
  // e.g. "MN 13 northbound: Traffic incident reported."
  const m = title.match(/^([A-Z]{1,3}\s?\d+)\s+(northbound|southbound|eastbound|westbound)\b/i);
  if (!m) return { road: null, direction: null };
  return { road: m[1].toUpperCase().replace(/\s+/g, " "), direction: m[2].toLowerCase() };
}

function categoryFromIcon(iconUrl = "") {
  const u = iconUrl.toLowerCase();
  if (u.includes("camera")) return "CAMERA";
  if (u.includes("crash")) return "CRASH";
  if (u.includes("incident")) return "INCIDENT";
  if (u.includes("construction")) return "CONSTRUCTION";
  if (u.includes("closure")) return "CLOSURE";
  if (u.includes("plow")) return "PLOW";
  if (u.includes("condition")) return "CONDITION";
  if (u.includes("weather") || u.includes("snow") || u.includes("ice")) return "WEATHER";
  return "ROAD";
}

function pickGeometry(feature) {
  // We only store a representative point if Point.
  // For LineString (encoded polyline in your samples), you can store null here
  // and rely on bbox filtering for WordPress list views.
  const g = feature?.geometry;
  if (!g) return { geom_type: null, lat: null, lon: null };

  if (g.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const [lon, lat] = g.coordinates;
    return { geom_type: "Point", lat, lon, coords: [lon, lat] };
  }

  // Handle LineString encoded polylines so map clients can render them.
  if (g.type === "LineString") {
    let coords = Array.isArray(g.coordinates) ? g.coordinates : null;
    if (!coords && typeof g.coordinates === "string") {
      coords = decodePolyline(g.coordinates);
    }
    coords = normalizeLineCoords(coords);
    return { geom_type: "LineString", lat: null, lon: null, coords };
  }

  return { geom_type: String(g.type ?? null), lat: null, lon: null, coords: null };
}

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return null;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    // GeoJSON expects [lon, lat]
    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates.length ? coordinates : null;
}

function normalizeLineCoords(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return coords;
  const first = coords[0];
  if (!Array.isArray(first) || first.length < 2) return coords;
  const [a, b] = first;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return coords;
  const looksSwapped = Math.abs(a) <= 90 && Math.abs(b) > 90;
  if (!looksSwapped) return coords;
  return coords.map(([x, y]) => [y, x]);
}

function normalizeTimestampValue(value) {
  if (value === null || value === undefined) return null;
  let ts = Number(value);
  if (!Number.isFinite(ts)) return null;
  if (ts < 2000000000) {
    ts *= 1000;
  }
  return ts;
}

export function normalizeMapFeaturesResponse(json) {
  const out = [];
  const events = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(events)) return out;

  for (const e of events) {
    const firstFeature = Array.isArray(e.features) ? e.features[0] : null;

    const iconUrl = firstFeature?.properties?.icon?.url ?? "";
    const { road, direction } = extractRoadDirection(e.title ?? "");

    const bbox = Array.isArray(e.bbox) && e.bbox.length === 4 ? e.bbox : [null, null, null, null];
    const [minLon, minLat, maxLon, maxLat] = bbox;

    const { geom_type, lat, lon, coords } = pickGeometry(firstFeature);

    const category = categoryFromIcon(iconUrl);

    // ID strategy: prefer the "uri" suffix or the feature id base
    const id =
      (e.uri && String(e.uri).includes("/") ? String(e.uri).split("/").pop() : null) ??
      (firstFeature?.id ? String(firstFeature.id).split("-").slice(0, 2).join("-") : null) ??
      cryptoRandomIdFallback(e);

    const lastUpdatedMs = normalizeTimestampValue(e?.lastUpdated?.timestamp ?? null);
    const lastUpdatedAt = lastUpdatedMs ? new Date(lastUpdatedMs).toISOString() : null;

    out.push({
      id,
      uri: e.uri ?? null,
      title: e.title ?? null,
      tooltip: e.tooltip ?? null,
      category,
      road,
      direction,
      severity: typeof e.priority === "number" ? e.priority : null, // you can change mapping later
      priority: typeof e.priority === "number" ? e.priority : null,
      last_updated_timestamp: lastUpdatedMs,
      last_updated_at: lastUpdatedAt,

      geom_type,
      lat,
      lon,
      geom_coords: coords,

      bbox_min_lon: minLon ?? null,
      bbox_min_lat: minLat ?? null,
      bbox_max_lon: maxLon ?? null,
      bbox_max_lat: maxLat ?? null,

      icon: iconUrl ? iconUrl.split("/").pop().replace(".svg", "") : null,
      status: "active",
      source: "MN 511",
      raw: e
    });
  }

  return out;
}

function cryptoRandomIdFallback(e) {
  // Safe fallback without requiring extra deps
  const s = JSON.stringify(e)?.slice(0, 200) ?? String(Date.now());
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `EVT-${h}`;
}
