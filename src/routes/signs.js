import { fetch511Graphql } from "../services/fetch511.js";
import { normalizeSigns } from "../services/normalizeNew.js";
import { SIGNS_QUERY, buildListArgsVariables } from "../services/queries.js";

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

function buildWhere(query) {
  const clauses = [];
  const params = {};

  if (query.status) {
    clauses.push("sign_status = @status");
    params.status = String(query.status);
  }

  if (query.route) {
    clauses.push("route_designator = @route");
    params.route = String(query.route);
  }

  if (query.bbox) {
    const parts = String(query.bbox).split(",").map((x) => Number(x.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minLon, minLat, maxLon, maxLat] = parts;
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

function listSigns(app, req) {
  const limit = Math.min(Math.max(toNumberOrNull(req.query.limit) ?? 200, 1), 1000);
  const offset = Math.max(toNumberOrNull(req.query.offset) ?? 0, 0);

  const { where, params } = buildWhere(req.query);

  const sql = `
    SELECT
      id, uri, title, city_reference, sign_display_type, sign_status, color, icon,
      route_designator, primary_linear_reference, secondary_linear_reference,
      lat, lon, bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
      views, gantry_signs,
      source,
      first_seen_at, last_seen_at, last_updated_at
    FROM signs
    ${where}
    ORDER BY
      route_designator ASC,
      title ASC
    LIMIT @limit OFFSET @offset
  `;

  const rows = app.db.prepare(sql).all({ ...params, limit, offset });

  const features = rows.map((r) => toGeoJsonFeature(r));

  return {
    ok: true,
    count: features.length,
    type: "FeatureCollection",
    features
  };
}

async function listSignsLive(app, req, reply) {
  const bbox = parseBboxParam(req.query.bbox);
  if (!bbox) {
    reply.code(400);
    return { ok: false, error: "INVALID_BBOX" };
  }

  const variables = buildListArgsVariables(bbox);
  const json = await fetch511Graphql({ query: SIGNS_QUERY, variables });
  const normalized = normalizeSigns(json);

  const features = normalized.map((sign) => {
    const bbox =
      sign.bbox_min_lon !== null ? [sign.bbox_min_lon, sign.bbox_min_lat, sign.bbox_max_lon, sign.bbox_max_lat] : undefined;

    const geometry =
      Number.isFinite(sign.lon) && Number.isFinite(sign.lat)
        ? { type: "Point", coordinates: [sign.lon, sign.lat] }
        : null;

    return {
      type: "Feature",
      id: sign.id,
      geometry,
      bbox,
      properties: {
        uri: sign.uri,
        title: sign.title,
        cityReference: sign.city_reference,
        signDisplayType: sign.sign_display_type,
        signStatus: sign.sign_status,
        color: sign.color,
        icon: sign.icon,
        routeDesignator: sign.route_designator,
        primaryLinearReference: sign.primary_linear_reference,
        secondaryLinearReference: sign.secondary_linear_reference,
        views: sign.views,
        gantrySigns: sign.gantry_signs
      }
    };
  });

  return {
    ok: true,
    count: features.length,
    type: "FeatureCollection",
    features
  };
}

function toGeoJsonFeature(r) {
  const geometry =
    Number.isFinite(r.lon) && Number.isFinite(r.lat)
      ? { type: "Point", coordinates: [r.lon, r.lat] }
      : null;

  const bbox = [r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat].every(
    (v) => v !== null && v !== undefined
  )
    ? [r.bbox_min_lon, r.bbox_min_lat, r.bbox_max_lon, r.bbox_max_lat]
    : undefined;

  let views, gantrySigns;
  try {
    views = r.views ? JSON.parse(r.views) : [];
    gantrySigns = r.gantry_signs ? JSON.parse(r.gantry_signs) : [];
  } catch {
    views = [];
    gantrySigns = [];
  }

  return {
    type: "Feature",
    id: r.id,
    geometry,
    bbox,
    properties: {
      uri: r.uri,
      title: r.title,
      cityReference: r.city_reference,
      signDisplayType: r.sign_display_type,
      signStatus: r.sign_status,
      color: r.color,
      icon: r.icon,
      routeDesignator: r.route_designator,
      primaryLinearReference: r.primary_linear_reference,
      secondaryLinearReference: r.secondary_linear_reference,
      views,
      gantrySigns,
      source: r.source,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      lastUpdatedAt: r.last_updated_at
    }
  };
}

export async function signRoutes(app) {
  app.get("/v1/signs", async (req) => {
    return listSigns(app, req);
  });

  app.get("/api/signs", async (req, reply) => {
    return listSignsLive(app, req, reply);
  });

  app.get("/v1/signs/:id", async (req, reply) => {
    const id = String(req.params.id);
    const row = app.db
      .prepare(
        `SELECT
          id, uri, title, city_reference, sign_display_type, sign_status, color, icon,
          route_designator, primary_linear_reference, secondary_linear_reference,
          lat, lon, bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
          views, gantry_signs,
          source, first_seen_at, last_seen_at, last_updated_at
        FROM signs
        WHERE id = ?`
      )
      .get(id);

    if (!row) {
      reply.code(404);
      return { ok: false, error: "NOT_FOUND" };
    }

    const feature = toGeoJsonFeature(row);
    return { ok: true, feature };
  });
}
