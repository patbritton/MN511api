import { fetch511Graphql } from "./fetch511.js";
import {
  normalizeWeatherStations,
  normalizeSigns,
  normalizeCameraViews
} from "./normalizeNew.js";
import {
  WEATHER_STATIONS_QUERY,
  SIGNS_QUERY,
  CAMERA_VIEWS_QUERY,
  buildListArgsVariables
} from "./queries.js";

function upsertWeatherStation(db, station, nowIso) {
  const existing = db
    .prepare(`SELECT id, first_seen_at FROM weather_stations WHERE id = ?`)
    .get(station.id);

  const firstSeen = existing?.first_seen_at ?? nowIso;

  db.prepare(
    `INSERT INTO weather_stations (
      id, uri, title, description, status, color, icon,
      route_designator, lat, lon,
      weather_fields, source, raw_json,
      first_seen_at, last_seen_at, last_updated_at, last_updated_timestamp
    )
    VALUES (
      @id, @uri, @title, @description, @status, @color, @icon,
      @route_designator, @lat, @lon,
      @weather_fields, @source, @raw_json,
      @first_seen_at, @last_seen_at, @last_updated_at, @last_updated_timestamp
    )
    ON CONFLICT(id) DO UPDATE SET
      uri=excluded.uri,
      title=excluded.title,
      description=excluded.description,
      status=excluded.status,
      color=excluded.color,
      icon=excluded.icon,
      route_designator=excluded.route_designator,
      lat=excluded.lat,
      lon=excluded.lon,
      weather_fields=excluded.weather_fields,
      source=excluded.source,
      raw_json=excluded.raw_json,
      last_seen_at=excluded.last_seen_at,
      last_updated_at=excluded.last_updated_at,
      last_updated_timestamp=excluded.last_updated_timestamp
    `
  ).run({
    ...station,
    weather_fields: JSON.stringify(station.weather_fields),
    raw_json: JSON.stringify(station.raw),
    source: station.source || "mn511-graphql",
    first_seen_at: firstSeen,
    last_seen_at: nowIso,
    last_updated_at: nowIso
  });
}

function upsertSign(db, sign, nowIso) {
  const existing = db.prepare(`SELECT id, first_seen_at FROM signs WHERE id = ?`).get(sign.id);

  const firstSeen = existing?.first_seen_at ?? nowIso;

  db.prepare(
    `INSERT INTO signs (
      id, uri, title, city_reference, sign_display_type, sign_status, color, icon,
      route_designator, primary_linear_reference, secondary_linear_reference,
      lat, lon, bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
      views, gantry_signs, source, raw_json,
      first_seen_at, last_seen_at, last_updated_at
    )
    VALUES (
      @id, @uri, @title, @city_reference, @sign_display_type, @sign_status, @color, @icon,
      @route_designator, @primary_linear_reference, @secondary_linear_reference,
      @lat, @lon, @bbox_min_lon, @bbox_min_lat, @bbox_max_lon, @bbox_max_lat,
      @views, @gantry_signs, @source, @raw_json,
      @first_seen_at, @last_seen_at, @last_updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      uri=excluded.uri,
      title=excluded.title,
      city_reference=excluded.city_reference,
      sign_display_type=excluded.sign_display_type,
      sign_status=excluded.sign_status,
      color=excluded.color,
      icon=excluded.icon,
      route_designator=excluded.route_designator,
      primary_linear_reference=excluded.primary_linear_reference,
      secondary_linear_reference=excluded.secondary_linear_reference,
      lat=excluded.lat,
      lon=excluded.lon,
      bbox_min_lon=excluded.bbox_min_lon,
      bbox_min_lat=excluded.bbox_min_lat,
      bbox_max_lon=excluded.bbox_max_lon,
      bbox_max_lat=excluded.bbox_max_lat,
      views=excluded.views,
      gantry_signs=excluded.gantry_signs,
      source=excluded.source,
      raw_json=excluded.raw_json,
      last_seen_at=excluded.last_seen_at,
      last_updated_at=excluded.last_updated_at
    `
  ).run({
    ...sign,
    views: JSON.stringify(sign.views),
    gantry_signs: JSON.stringify(sign.gantry_signs),
    raw_json: JSON.stringify(sign.raw),
    source: sign.source || "mn511-graphql",
    first_seen_at: firstSeen,
    last_seen_at: nowIso,
    last_updated_at: nowIso
  });
}

function upsertCameraView(db, view, nowIso) {
  const existing = db.prepare(`SELECT id, first_seen_at FROM camera_views WHERE id = ?`).get(view.id);

  const firstSeen = existing?.first_seen_at ?? nowIso;

  db.prepare(
    `INSERT INTO camera_views (
      id, uri, title, category, icon, url,
      sources, parent_uri, parent_title, parent_icon, parent_color, parent_route_designator,
      lat, lon, source, raw_json,
      first_seen_at, last_seen_at, last_updated_at, last_updated_timestamp
    )
    VALUES (
      @id, @uri, @title, @category, @icon, @url,
      @sources, @parent_uri, @parent_title, @parent_icon, @parent_color, @parent_route_designator,
      @lat, @lon, @source, @raw_json,
      @first_seen_at, @last_seen_at, @last_updated_at, @last_updated_timestamp
    )
    ON CONFLICT(id) DO UPDATE SET
      uri=excluded.uri,
      title=excluded.title,
      category=excluded.category,
      icon=excluded.icon,
      url=excluded.url,
      sources=excluded.sources,
      parent_uri=excluded.parent_uri,
      parent_title=excluded.parent_title,
      parent_icon=excluded.parent_icon,
      parent_color=excluded.parent_color,
      parent_route_designator=excluded.parent_route_designator,
      lat=excluded.lat,
      lon=excluded.lon,
      source=excluded.source,
      raw_json=excluded.raw_json,
      last_seen_at=excluded.last_seen_at,
      last_updated_at=excluded.last_updated_at,
      last_updated_timestamp=excluded.last_updated_timestamp
    `
  ).run({
    ...view,
    sources: JSON.stringify(view.sources),
    raw_json: JSON.stringify(view.raw),
    source: view.source || "mn511-graphql",
    first_seen_at: firstSeen,
    last_seen_at: nowIso,
    last_updated_at: nowIso
  });
}

export async function ingestWeatherStations(app, bbox = {}) {
  const nowIso = new Date().toISOString();
  const variables = buildListArgsVariables(bbox);

  const json = await fetch511Graphql({ query: WEATHER_STATIONS_QUERY, variables });
  const normalized = normalizeWeatherStations(json);

  const tx = app.db.transaction(() => {
    for (const station of normalized) {
      upsertWeatherStation(app.db, station, nowIso);
    }
  });

  tx();

  app.log.info({ count: normalized.length }, "Weather stations ingest complete");
  return { ok: true, ingested: normalized.length };
}

export async function ingestSigns(app, bbox = {}) {
  const nowIso = new Date().toISOString();
  const variables = buildListArgsVariables(bbox);

  const json = await fetch511Graphql({ query: SIGNS_QUERY, variables });
  const normalized = normalizeSigns(json);

  const tx = app.db.transaction(() => {
    for (const sign of normalized) {
      upsertSign(app.db, sign, nowIso);
    }
  });

  tx();

  app.log.info({ count: normalized.length }, "Signs ingest complete");
  return { ok: true, ingested: normalized.length };
}

export async function ingestCameraViews(app, bbox = {}) {
  const nowIso = new Date().toISOString();
  const variables = buildListArgsVariables(bbox);

  const json = await fetch511Graphql({ query: CAMERA_VIEWS_QUERY, variables });
  const normalized = normalizeCameraViews(json);

  const tx = app.db.transaction(() => {
    for (const view of normalized) {
      upsertCameraView(app.db, view, nowIso);
    }
  });

  tx();

  app.log.info({ count: normalized.length }, "Camera views ingest complete");
  return { ok: true, ingested: normalized.length };
}
