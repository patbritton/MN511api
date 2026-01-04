import { fetch511Graphql } from "./fetch511.js";
import { normalizeMapFeaturesResponse } from "./normalize.js";
import { purgeAndMark } from "./purge.js";
import { buildMapFeaturesRequest } from "./mapFeatures.js";
import { ingestWeatherStations, ingestSigns, ingestCameraViews } from "./ingestNew.js";

function upsertEvent(db, ev, nowIso) {
  const existing = db.prepare(`SELECT id, first_seen_at FROM events WHERE id = ?`).get(ev.id);

  const firstSeen = existing?.first_seen_at ?? nowIso;

  db.prepare(
    `INSERT INTO events (
      id, uri, title, tooltip, category, road, direction, severity, priority,
      geom_type, lat, lon,
      bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
      icon, status, source, raw_json,
      first_seen_at, last_seen_at, last_updated_at
    )
    VALUES (
      @id, @uri, @title, @tooltip, @category, @road, @direction, @severity, @priority,
      @geom_type, @lat, @lon,
      @bbox_min_lon, @bbox_min_lat, @bbox_max_lon, @bbox_max_lat,
      @icon, @status, @source, @raw_json,
      @first_seen_at, @last_seen_at, @last_updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      uri=excluded.uri,
      title=excluded.title,
      tooltip=excluded.tooltip,
      category=excluded.category,
      road=excluded.road,
      direction=excluded.direction,
      severity=excluded.severity,
      priority=excluded.priority,
      geom_type=excluded.geom_type,
      lat=excluded.lat,
      lon=excluded.lon,
      bbox_min_lon=excluded.bbox_min_lon,
      bbox_min_lat=excluded.bbox_min_lat,
      bbox_max_lon=excluded.bbox_max_lon,
      bbox_max_lat=excluded.bbox_max_lat,
      icon=excluded.icon,
      status='active',
      source=excluded.source,
      raw_json=excluded.raw_json,
      last_seen_at=excluded.last_seen_at,
      last_updated_at=excluded.last_updated_at
    `
  ).run({
    ...ev,
    raw_json: JSON.stringify(ev.raw),
    first_seen_at: firstSeen,
    last_seen_at: nowIso,
    last_updated_at: nowIso
  });
}

export async function runIngestOnce(app) {
  const nowIso = new Date().toISOString();

  // IMPORTANT:
  // You should pass bbox/zoom vars based on your desired region.
  // For statewide coverage you may need multiple bbox tiles.
  const { query, variables } = buildMapFeaturesRequest({
    bbox: {
      // Example: Twin Cities-ish bbox; replace with yours
      north: 45.3,
      south: 44.6,
      east: -92.7,
      west: -93.8
    },
    zoom: 10,
    layerSlugs: ["incidents", "closures", "cameras", "roadConditions", "weatherEvents"]
  });

  const json = await fetch511Graphql({ query, variables });

  const normalized = normalizeMapFeaturesResponse(json);

  const tx = app.db.transaction(() => {
    for (const ev of normalized) upsertEvent(app.db, ev, nowIso);
    purgeAndMark(app.db);
  });

  tx();

  app.log.info({ count: normalized.length }, "Events ingest complete");

  // Ingest new data types
  const bbox = {
    north: 45.3,
    south: 44.6,
    east: -92.7,
    west: -93.8
  };

  try {
    await ingestWeatherStations(app, bbox);
  } catch (e) {
    app.log.error({ err: e }, "Weather stations ingest failed");
  }

  try {
    await ingestSigns(app, bbox);
  } catch (e) {
    app.log.error({ err: e }, "Signs ingest failed");
  }

  try {
    await ingestCameraViews(app, bbox);
  } catch (e) {
    app.log.error({ err: e }, "Camera views ingest failed");
  }

  return { ok: true, ingested: normalized.length };
}
