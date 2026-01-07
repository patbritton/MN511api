import { fetch511Graphql } from "./fetch511.js";
import { normalizeMapFeaturesResponse } from "./normalize.js";
import { buildMapFeaturesRequest } from "./mapFeatures.js";
import { fetchDashboardCollections } from "./dashboard.js";
import { ingestWeatherStations, ingestSigns, ingestCameraViews } from "./ingestNew.js";

let eventsIngestInProgress = false;
let staticIngestInProgress = false;

function hashString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

function syncCoordinates(db) {
  db.prepare(
    `
    UPDATE weather_stations
    SET
      lat = (SELECT lat FROM events WHERE events.uri = weather_stations.uri AND events.lat IS NOT NULL),
      lon = (SELECT lon FROM events WHERE events.uri = weather_stations.uri AND events.lon IS NOT NULL)
    WHERE EXISTS (
      SELECT 1 FROM events
      WHERE events.uri = weather_stations.uri
      AND events.lat IS NOT NULL
    )
    `
  ).run();

  db.prepare(
    `
    UPDATE camera_views
    SET
      lat = (SELECT lat FROM events WHERE events.uri = camera_views.parent_uri AND events.lat IS NOT NULL),
      lon = (SELECT lon FROM events WHERE events.uri = camera_views.parent_uri AND events.lon IS NOT NULL)
    WHERE EXISTS (
      SELECT 1 FROM events
      WHERE events.uri = camera_views.parent_uri
      AND events.lat IS NOT NULL
    )
    `
  ).run();
}

function upsertEvent(db, ev, nowIso) {
  const existing = db
    .prepare(
      `SELECT
        id,
        first_seen_at,
        last_updated_at,
        source_updated_timestamp,
        source_fingerprint,
        source_version
      FROM events
      WHERE id = ?`
    )
    .get(ev.id);

  const firstSeen = existing?.first_seen_at ?? nowIso;
  const rawJson = JSON.stringify(ev.raw ?? {});
  const sourceFingerprint = hashString(rawJson);
  const sourceUpdatedTimestamp = ev.last_updated_timestamp ?? null;
  const sourceUpdatedAt = ev.last_updated_at ?? null;

  const hasSourceUpdate =
    (Number.isFinite(sourceUpdatedTimestamp) && sourceUpdatedTimestamp !== existing?.source_updated_timestamp) ||
    (sourceFingerprint !== null && sourceFingerprint !== existing?.source_fingerprint);

  const nextVersion = existing
    ? (existing.source_version ?? 1) + (hasSourceUpdate ? 1 : 0)
    : 1;

  const lastUpdatedAt = hasSourceUpdate
    ? (sourceUpdatedAt ?? nowIso)
    : (existing?.last_updated_at ?? sourceUpdatedAt ?? nowIso);
  const sourceId = ev.uri ?? ev.id ?? null;

  db.prepare(
    `INSERT INTO events (
      id, uri, title, tooltip, category, road, direction, severity, priority,
      geom_type, lat, lon,
      bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
      icon, status, source, raw_json,
      source_id, source_updated_at, source_updated_timestamp, source_version, source_fingerprint,
      first_seen_at, last_seen_at, last_updated_at
    )
    VALUES (
      @id, @uri, @title, @tooltip, @category, @road, @direction, @severity, @priority,
      @geom_type, @lat, @lon,
      @bbox_min_lon, @bbox_min_lat, @bbox_max_lon, @bbox_max_lat,
      @icon, @status, @source, @raw_json,
      @source_id, @source_updated_at, @source_updated_timestamp, @source_version, @source_fingerprint,
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
      source_id=excluded.source_id,
      source_updated_at=excluded.source_updated_at,
      source_updated_timestamp=excluded.source_updated_timestamp,
      source_version=excluded.source_version,
      source_fingerprint=excluded.source_fingerprint,
      last_seen_at=excluded.last_seen_at,
      last_updated_at=excluded.last_updated_at
    `
  ).run({
    ...ev,
    raw_json: rawJson,
    source_id: sourceId,
    source_updated_at: sourceUpdatedAt,
    source_updated_timestamp: sourceUpdatedTimestamp,
    source_version: nextVersion,
    source_fingerprint: sourceFingerprint,
    first_seen_at: firstSeen,
    last_seen_at: nowIso,
    last_updated_at: lastUpdatedAt
  });
}

function normalizeDashboardTimestamp(value) {
  if (value === null || value === undefined) return null;
  let ts = Number(value);
  if (!Number.isFinite(ts)) return null;
  if (ts < 2000000000) ts *= 1000;
  return ts;
}

function buildTiles(bbox, rows, cols) {
  const tiles = [];
  const latStep = (bbox.north - bbox.south) / rows;
  const lonStep = (bbox.east - bbox.west) / cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = bbox.south + r * latStep;
      const north = south + latStep;
      const west = bbox.west + c * lonStep;
      const east = west + lonStep;
      tiles.push({ north, south, east, west });
    }
  }

  return tiles;
}

const METRO_BBOX = {
  north: 48.06282,
  south: 44.48805,
  east: -90.78558,
  west: -96.58636
};

export async function runEventsIngest(app) {
  if (eventsIngestInProgress) {
    app.log.warn("Events ingest already running, skipping new run");
    return { ok: false, skipped: true };
  }

  eventsIngestInProgress = true;
  const nowIso = new Date().toISOString();

  try {
    const tiles = buildTiles(METRO_BBOX, 3, 3);
    const byId = new Map();

    for (const tile of tiles) {
      const { query, variables } = buildMapFeaturesRequest({
        bbox: tile,
        zoom: 8,
        layerSlugs: ["metroTrafficMap"]
      });

      const json = await fetch511Graphql({ query, variables });
      const normalized = normalizeMapFeaturesResponse(json);

      for (const ev of normalized) {
        if (!byId.has(ev.id)) {
          byId.set(ev.id, ev);
        }
      }
    }

    const normalized = Array.from(byId.values());

    try {
      const collections = await fetchDashboardCollections([
        "constructionReports",
        "roadConditions",
        "ferryReports",
        "towingProhibitedReports",
        "truckersReports",
        "wazeReports",
        "weatherWarningsAreaEvents",
        "winterDriving",
        "roadReports",
        "wazeJams",
        "metroTrafficMap",
        "future"
      ]);
      const updates = new Map();
      for (const item of collections) {
        const uri = item?.uri;
        const ts = normalizeDashboardTimestamp(item?.lastUpdated?.timestamp);
        if (uri && ts) updates.set(uri, ts);
      }
      for (const ev of normalized) {
        if (!ev.uri || ev.last_updated_timestamp) continue;
        const ts = updates.get(ev.uri);
        if (ts) {
          ev.last_updated_timestamp = ts;
          ev.last_updated_at = new Date(ts).toISOString();
        }
      }
    } catch (e) {
      app.log.warn({ err: e }, "Dashboard enrichment failed");
    }

    const tx = app.db.transaction(() => {
      for (const ev of normalized) upsertEvent(app.db, ev, nowIso);
      app.db
        .prepare(
          `DELETE FROM events
           WHERE source = @source AND last_seen_at < @nowIso`
        )
        .run({ source: "MN 511", nowIso });
    });

    tx();

    app.log.info({ count: normalized.length }, "Events ingest complete");

    return { ok: true, ingested: normalized.length };
  } finally {
    eventsIngestInProgress = false;
  }
}

export async function runStaticIngest(app) {
  if (staticIngestInProgress) {
    app.log.warn("Static ingest already running, skipping new run");
    return { ok: false, skipped: true };
  }

  staticIngestInProgress = true;

  try {
    try {
      await ingestWeatherStations(app, METRO_BBOX);
    } catch (e) {
      app.log.error({ err: e }, "Weather stations ingest failed");
    }

    try {
      await ingestSigns(app, METRO_BBOX);
    } catch (e) {
      app.log.error({ err: e }, "Signs ingest failed");
    }

    try {
      await ingestCameraViews(app, METRO_BBOX);
    } catch (e) {
      app.log.error({ err: e }, "Camera views ingest failed");
    }

    try {
      syncCoordinates(app.db);
      app.log.info("Coordinate sync complete");
    } catch (e) {
      app.log.error({ err: e }, "Coordinate sync failed");
    }

    return { ok: true };
  } finally {
    staticIngestInProgress = false;
  }
}

export async function runIngestOnce(app) {
  await runEventsIngest(app);
  await runStaticIngest(app);
}
