import { fetch511Graphql } from "../services/fetch511.js";
import { normalizeMapFeaturesResponse } from "../services/normalize.js";
import { buildMapFeaturesRequest } from "../services/mapFeatures.js";

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBboxParam(bboxParam) {
  if (!bboxParam) return null;
  const parts = String(bboxParam).split(",").map((x) => Number(x.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  return { west: minLon, south: minLat, east: maxLon, north: maxLat };
}

function parseZoomParam(zoomParam) {
  const zoom = toNumberOrNull(zoomParam);
  return zoom === null ? null : Math.max(0, Math.floor(zoom));
}

function parseSinceValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    const ms = asNumber < 2000000000 ? asNumber * 1000 : asNumber;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function buildWhere(query, opts = {}) {
  const clauses = [];
  const params = {};

  const status = opts.status ?? query.status;
  if (status) {
    clauses.push("status = @status");
    params.status = String(status);
  }

  const categories = Array.isArray(opts.categories)
    ? opts.categories
    : String(query.category ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  if (categories.length === 1) {
    clauses.push("category = @category");
    params.category = categories[0];
  } else if (categories.length > 1) {
    const keys = categories.map((_, i) => `@category_${i}`);
    clauses.push(`category IN (${keys.join(", ")})`);
    categories.forEach((c, i) => {
      params[`category_${i}`] = c;
    });
  }

  if (query.severity !== undefined) {
    const severity = Number(query.severity);
    if (Number.isFinite(severity)) {
      clauses.push("severity = @severity");
      params.severity = severity;
    }
  }

  if (query.min_severity !== undefined) {
    const minSeverity = Number(query.min_severity);
    if (Number.isFinite(minSeverity)) {
      clauses.push("severity >= @min_severity");
      params.min_severity = minSeverity;
    }
  }

  if (query.max_severity !== undefined) {
    const maxSeverity = Number(query.max_severity);
    if (Number.isFinite(maxSeverity)) {
      clauses.push("severity <= @max_severity");
      params.max_severity = maxSeverity;
    }
  }

  const sinceVersion = toNumberOrNull(query.since_version);
  if (sinceVersion !== null) {
    clauses.push("source_version > @since_version");
    params.since_version = sinceVersion;
  }

  const sinceUpdatedAt = parseSinceValue(query.since_updated_at);
  if (sinceUpdatedAt) {
    clauses.push("last_updated_at > @since_updated_at");
    params.since_updated_at = sinceUpdatedAt;
  }

  const sinceSourceUpdated = toNumberOrNull(query.since_source_updated_timestamp);
  if (sinceSourceUpdated !== null) {
    clauses.push("source_updated_timestamp > @since_source_updated_timestamp");
    params.since_source_updated_timestamp = sinceSourceUpdated;
  }

  // bbox=minLon,minLat,maxLon,maxLat
  if (query.bbox) {
    const parts = String(query.bbox).split(",").map((x) => Number(x.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLon, minLat, maxLon, maxLat] = parts;
      // overlap test
      clauses.push(
        `NOT (
          bbox_max_lon < @minLon OR
          bbox_min_lon > @maxLon OR
          bbox_max_lat < @minLat OR
          bbox_min_lat > @maxLat
        )`
      );
      params.minLon = minLon;
      params.minLat = minLat;
      params.maxLon = maxLon;
      params.maxLat = maxLat;
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

function hashString(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function buildCacheMeta(rows) {
  let maxUpdatedMs = 0;
  let maxSourceVersion = 0;
  let hash = 0;

  for (const row of rows) {
    const updatedMs = Date.parse(row.last_updated_at ?? row.last_seen_at ?? row.first_seen_at ?? "");
    if (Number.isFinite(updatedMs) && updatedMs > maxUpdatedMs) {
      maxUpdatedMs = updatedMs;
    }
    const version = Number.isFinite(row.source_version) ? row.source_version : 0;
    if (version > maxSourceVersion) maxSourceVersion = version;

    const key = `${row.id}|${row.source_version ?? ""}|${row.last_updated_at ?? ""}|${row.status ?? ""}`;
    hash = (hash + hashString(key)) >>> 0;
  }

  const etag = `W/"${rows.length}-${hash.toString(16)}"`;
  const lastModified = maxUpdatedMs ? new Date(maxUpdatedMs).toUTCString() : null;

  return { etag, lastModified, maxSourceVersion };
}

function applyCacheHeaders(req, reply, meta) {
  if (!meta) return false;
  if (meta.etag) reply.header("ETag", meta.etag);
  if (meta.lastModified) reply.header("Last-Modified", meta.lastModified);
  reply.header("Cache-Control", "public, max-age=60, must-revalidate");

  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && meta.etag && ifNoneMatch === meta.etag) {
    reply.code(304).send();
    return true;
  }

  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince && meta.lastModified) {
    const sinceMs = Date.parse(ifModifiedSince);
    const lastMs = Date.parse(meta.lastModified);
    if (Number.isFinite(sinceMs) && Number.isFinite(lastMs) && sinceMs >= lastMs) {
      reply.code(304).send();
      return true;
    }
  }

  return false;
}

function listEvents(app, req, reply, opts) {
  const limit = Math.min(Math.max(toNumberOrNull(req.query.limit) ?? 200, 1), 1000);
  const offset = Math.max(toNumberOrNull(req.query.offset) ?? 0, 0);

  const { where, params } = buildWhere(req.query, opts);

  const sql = `
    SELECT
      id, uri, title, tooltip, category, road, direction,
      severity, priority,
      geom_type, lat, lon,
      bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
      icon, status,
      source,
      source_id, source_updated_at, source_updated_timestamp, source_version,
      first_seen_at, last_seen_at, last_updated_at
    FROM events
    ${where}
    ORDER BY
      CASE WHEN status='active' THEN 0 ELSE 1 END,
      COALESCE(severity, 0) DESC,
      COALESCE(priority, 0) DESC,
      last_updated_at DESC
    LIMIT @limit OFFSET @offset
  `;

  const rows = app.db.prepare(sql).all({ ...params, limit, offset });

  let features = rows.map((r) => toGeoJsonFeatureFromRow(r));

  if (opts?.withCameraViews) {
    const cameraViewsByParent = loadCameraViewsByParent(app, rows);
    if (cameraViewsByParent) {
      features = features.map((feature) => {
        const uri = feature.properties?.uri;
        if (uri && cameraViewsByParent[uri]) {
          feature.properties.cameraViews = cameraViewsByParent[uri];
        }
        return feature;
      });
    }
  }

  const meta = buildCacheMeta(rows);
  if (reply && applyCacheHeaders(req, reply, meta)) {
    return null;
  }

  return {
    ok: true,
    count: features.length,
    type: "FeatureCollection",
    features,
    meta: {
      max_source_version: meta.maxSourceVersion,
      last_modified: meta.lastModified
    }
  };
}

async function listLive(app, req, reply, layerKey, opts = {}) {
  const bbox = parseBboxParam(req.query.bbox);
  if (!bbox) {
    reply.code(400);
    return { ok: false, error: "INVALID_BBOX" };
  }

  const zoom = parseZoomParam(req.query.zoom) ?? 0;
  const layerSlugs = config.layerMap[layerKey];
  if (!layerSlugs || layerSlugs.length === 0) {
    reply.code(500);
    return { ok: false, error: "LAYER_MAP_MISSING" };
  }
  const { query, variables } = buildMapFeaturesRequest({
    bbox,
    zoom,
    layerSlugs
  });

  const json = await fetch511Graphql({ query, variables });
  const normalized = normalizeMapFeaturesResponse(json);
  const filtered = Array.isArray(opts.categories)
    ? normalized.filter((ev) => opts.categories.includes(ev.category))
    : normalized;
  const cameraViewsByParent =
    layerKey === "cameras" ? loadCameraViewsByParent(app, filtered) : null;
  const features = filtered.map((ev) => {
    if (cameraViewsByParent && ev.uri && cameraViewsByParent[ev.uri]) {
      ev.camera_views = cameraViewsByParent[ev.uri];
    }
    return toGeoJsonFeatureFromNormalized(ev);
  });

  return { ok: true, count: features.length, type: "FeatureCollection", features };
}

function loadCameraViewsByParent(app, events) {
  const uris = events.map((ev) => ev.uri).filter(Boolean);
  if (uris.length === 0) return null;

  const placeholders = uris.map(() => "?").join(",");
  const rows = app.db
    .prepare(
      `SELECT
        parent_uri,
        uri,
        title,
        category,
        icon,
        url,
        sources,
        last_updated_timestamp
      FROM camera_views
      WHERE parent_uri IN (${placeholders})`
    )
    .all(...uris);

  const map = {};
  for (const row of rows) {
    let sources = null;
    if (row.sources) {
      try {
        sources = JSON.parse(row.sources);
      } catch {
        sources = null;
      }
    }
    const view = {
      uri: row.uri,
      title: row.title,
      category: row.category,
      icon: row.icon,
      url: row.url,
      sources,
      last_updated_timestamp: row.last_updated_timestamp
    };
    if (!map[row.parent_uri]) map[row.parent_uri] = [];
    map[row.parent_uri].push(view);
  }

  return map;
}

function toGeoJsonFeatureFromRow(r) {
  const geometry =
    r.geom_type === "Point" && Number.isFinite(r.lon) && Number.isFinite(r.lat)
      ? { type: "Point", coordinates: [r.lon, r.lat] }
      : null;

  const bbox = [r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat].every(
    (v) => v !== null && v !== undefined
  )
    ? [r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat]
    : undefined;

  return {
    type: "Feature",
    id: r.id,
    geometry,
    bbox,
    properties: {
      uri: r.uri,
      title: r.title,
      tooltip: r.tooltip,
      category: r.category,
      road: r.road,
      direction: r.direction,
      severity: r.severity,
      priority: r.priority,
      icon: r.icon,
      status: r.status,
      source: r.source,
      source_id: r.source_id,
      source_updated_at: r.source_updated_at,
      source_updated_timestamp: r.source_updated_timestamp,
      source_version: r.source_version,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      last_updated_at: r.last_updated_at
    }
  };
}

function toGeoJsonFeatureFromNormalized(ev) {
  let geometry = null;
  if (ev.geom_type === "Point" && Number.isFinite(ev.lon) && Number.isFinite(ev.lat)) {
    geometry = { type: "Point", coordinates: [ev.lon, ev.lat] };
  } else if (ev.geom_type === "LineString" && Array.isArray(ev.geom_coords)) {
    geometry = { type: "LineString", coordinates: ev.geom_coords };
  }

  const bbox = [ev.bbox_min_lon, ev.bbox_min_lat, ev.bbox_max_lon, ev.bbox_max_lat].every(
    (v) => v !== null && v !== undefined
  )
    ? [ev.bbox_min_lon, ev.bbox_min_lat, ev.bbox_max_lon, ev.bbox_max_lat]
    : undefined;

  if (!geometry && bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;
    if (Number.isFinite(centerLon) && Number.isFinite(centerLat)) {
      geometry = { type: "Point", coordinates: [centerLon, centerLat] };
    }
  }

  return {
    type: "Feature",
    id: ev.id,
    geometry,
    bbox,
    properties: {
      uri: ev.uri,
      title: ev.title,
      tooltip: ev.tooltip,
      category: ev.category,
      road: ev.road,
      direction: ev.direction,
      severity: ev.severity,
      priority: ev.priority,
      last_updated_at: ev.last_updated_at ?? null,
      last_updated_timestamp: ev.last_updated_timestamp ?? null,
      ...(Array.isArray(ev.camera_views) && ev.camera_views.length > 0
        ? { cameraViews: ev.camera_views }
        : {}),
      ...(typeof ev.camera_active === "boolean" ? { cameraActive: ev.camera_active } : {}),
      icon: ev.icon,
      status: ev.status,
      source: ev.source
    }
  };
}

export async function eventRoutes(app) {
  app.get("/v1/events", async (req, reply) => {
    const result = listEvents(app, req, reply);
    return result === null ? reply : result;
  });

  app.get("/v1/cameras", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CAMERA"],
      withCameraViews: true
    });
    return result === null ? reply : result;
  });

  app.get("/traffic", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CRASH", "INCIDENT", "CONSTRUCTION", "CLOSURE"]
    });
    return result === null ? reply : result;
  });

  app.get("/incidents", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CRASH", "INCIDENT"]
    });
    return result === null ? reply : result;
  });

  app.get("/cameras", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CAMERA"],
      withCameraViews: true
    });
    return result === null ? reply : result;
  });

  app.get("/closures", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CLOSURE"]
    });
    return result === null ? reply : result;
  });

  app.get("/conditions", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CONDITION", "WEATHER", "PLOW"]
    });
    return result === null ? reply : result;
  });

  app.get("/v1/events/:id", async (req, reply) => {
    const id = String(req.params.id);
    const row = app.db
      .prepare(
        `SELECT
          id, uri, title, tooltip, category, road, direction,
          severity, priority,
          geom_type, lat, lon,
          bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
          icon, status,
          source,
          source_id, source_updated_at, source_updated_timestamp, source_version,
          first_seen_at, last_seen_at, last_updated_at
        FROM events
        WHERE id = ?`
      )
      .get(id);

    if (!row) {
      reply.code(404);
      return { ok: false, error: "NOT_FOUND" };
    }

    const meta = buildCacheMeta([row]);
    if (applyCacheHeaders(req, reply, meta)) {
      return reply;
    }

    const feature = toGeoJsonFeatureFromRow(row);
    return { ok: true, feature };
  });

  app.get("/api/incidents", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CRASH", "INCIDENT"]
    });
    return result === null ? reply : result;
  });
  app.get("/api/closures", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CLOSURE"]
    });
    return result === null ? reply : result;
  });
  app.get("/api/cameras", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CAMERA"],
      withCameraViews: true
    });
    return result === null ? reply : result;
  });
  app.get("/api/plows", async (req, reply) =>
    listLive(app, req, reply, "plows", { categories: ["PLOW"] })
  );
  app.get("/api/road-conditions", async (req, reply) =>
    listLive(app, req, reply, "road-conditions")
  );
  app.get("/api/weather-events", async (req, reply) =>
    listLive(app, req, reply, "weather-events")
  );
  app.get("/api/alerts", async (req, reply) => {
    const result = listEvents(app, req, reply, {
      status: "active",
      categories: ["CRASH", "INCIDENT", "CLOSURE", "CONSTRUCTION", "WEATHER"]
    });
    return result === null ? reply : result;
  });
  app.get("/api/rest-areas", async (req, reply) => listLive(app, req, reply, "rest-areas"));
  app.get("/api/weigh-stations", async (req, reply) =>
    listLive(app, req, reply, "weigh-stations")
  );
  app.get("/api/fueling-stations", async (req, reply) =>
    listLive(app, req, reply, "fueling-stations")
  );
  app.get("/api/rwss", async (req, reply) => listLive(app, req, reply, "rwss"));
}
