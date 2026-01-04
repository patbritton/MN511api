import { fetch511Graphql } from "../services/fetch511.js";
import { normalizeWeatherStations } from "../services/normalizeNew.js";
import { WEATHER_STATIONS_QUERY, buildListArgsVariables } from "../services/queries.js";

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
    clauses.push("status = @status");
    params.status = String(query.status);
  }

  if (query.route) {
    clauses.push("route_designator = @route");
    params.route = String(query.route);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

function listWeatherStations(app, req) {
  const limit = Math.min(Math.max(toNumberOrNull(req.query.limit) ?? 200, 1), 1000);
  const offset = Math.max(toNumberOrNull(req.query.offset) ?? 0, 0);

  const { where, params } = buildWhere(req.query);

  const sql = `
    SELECT
      id, uri, title, description, status, color, icon,
      route_designator, lat, lon,
      weather_fields,
      source,
      first_seen_at, last_seen_at, last_updated_at, last_updated_timestamp
    FROM weather_stations
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

async function listWeatherStationsLive(app, req, reply) {
  const bbox = parseBboxParam(req.query.bbox);
  if (!bbox) {
    reply.code(400);
    return { ok: false, error: "INVALID_BBOX" };
  }

  const variables = buildListArgsVariables(bbox);
  const json = await fetch511Graphql({ query: WEATHER_STATIONS_QUERY, variables });
  const normalized = normalizeWeatherStations(json);

  const features = normalized.map((station) => ({
    type: "Feature",
    id: station.id,
    geometry: null, // Weather stations typically don't have explicit coordinates
    properties: {
      uri: station.uri,
      title: station.title,
      description: station.description,
      status: station.status,
      color: station.color,
      icon: station.icon,
      routeDesignator: station.route_designator,
      weatherFields: station.weather_fields,
      lastUpdatedTimestamp: station.last_updated_timestamp,
      raw: station.raw
    }
  }));

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

  let weatherFields;
  try {
    weatherFields = r.weather_fields ? JSON.parse(r.weather_fields) : {};
  } catch {
    weatherFields = {};
  }

  return {
    type: "Feature",
    id: r.id,
    geometry,
    properties: {
      uri: r.uri,
      title: r.title,
      description: r.description,
      status: r.status,
      color: r.color,
      icon: r.icon,
      routeDesignator: r.route_designator,
      weatherFields,
      source: r.source,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      lastUpdatedAt: r.last_updated_at,
      lastUpdatedTimestamp: r.last_updated_timestamp
    }
  };
}

export async function weatherStationRoutes(app) {
  app.get("/v1/weather-stations", async (req) => {
    return listWeatherStations(app, req);
  });

  app.get("/api/weather-stations", async (req, reply) => {
    return listWeatherStationsLive(app, req, reply);
  });

  app.get("/v1/weather-stations/:id", async (req, reply) => {
    const id = String(req.params.id);
    const row = app.db
      .prepare(
        `SELECT
          id, uri, title, description, status, color, icon,
          route_designator, lat, lon,
          weather_fields, raw_json,
          source, first_seen_at, last_seen_at, last_updated_at, last_updated_timestamp
        FROM weather_stations
        WHERE id = ?`
      )
      .get(id);

    if (!row) {
      reply.code(404);
      return { ok: false, error: "NOT_FOUND" };
    }

    const feature = toGeoJsonFeature(row);
    try {
      feature.properties.raw = row.raw_json ? JSON.parse(row.raw_json) : null;
    } catch {
      feature.properties.raw = null;
    }

    return { ok: true, feature };
  });
}
