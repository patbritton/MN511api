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

  // In your sample, LineString uses an encoded string.
  // We'll keep geom_type as "LineString" but not decode coordinates here.
  if (g.type === "LineString") {
    const coords = Array.isArray(g.coordinates) ? g.coordinates : null;
    return { geom_type: "LineString", lat: null, lon: null, coords };
  }

  return { geom_type: String(g.type ?? null), lat: null, lon: null, coords: null };
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
