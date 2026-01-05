import dotenv from "dotenv";
dotenv.config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8787),
  logPretty: (process.env.LOG_PRETTY ?? "true").toLowerCase() === "true",

  corsOrigin: process.env.CORS_ORIGIN ?? "",
  exposeRaw: (process.env.EXPOSE_RAW ?? "false").toLowerCase() === "true",

  sqlitePath: process.env.SQLITE_PATH ?? "./data/mn511.sqlite",

  ingestCron: process.env.INGEST_CRON ?? "*/5 * * * *",
  ingestEventsCron:
    process.env.INGEST_EVENTS_CRON ?? process.env.INGEST_CRON ?? "*/2 * * * *",
  ingestStaticCron: process.env.INGEST_STATIC_CRON ?? "0 3 * * *",

  staleAfterMinutes: Number(process.env.STALE_AFTER_MINUTES ?? 30),
  hardExpireMinutes: Number(process.env.HARD_EXPIRE_MINUTES ?? 180),

  mn511GraphqlUrl: must("MN511_GRAPHQL_URL"),
  mn511UserAgent: process.env.MN511_USER_AGENT ?? "mn511-api/1.0",

  layerMap: {
    incidents: parseLayers(process.env.LAYERS_INCIDENTS, ["incidents"]),
    closures: parseLayers(process.env.LAYERS_CLOSURES, ["closures"]),
    cameras: parseLayers(process.env.LAYERS_CAMERAS, ["cameras"]),
    plows: parseLayers(process.env.LAYERS_PLOWS, ["plowCameras"]),
    "road-conditions": parseLayers(process.env.LAYERS_ROAD_CONDITIONS, ["roadConditions"]),
    "weather-events": parseLayers(process.env.LAYERS_WEATHER_EVENTS, ["weatherEvents"]),
    alerts: parseLayers(process.env.LAYERS_ALERTS, ["incidents", "closures", "weatherEvents"]),
    "rest-areas": parseLayers(process.env.LAYERS_REST_AREAS, ["restAreas"]),
    "weigh-stations": parseLayers(process.env.LAYERS_WEIGH_STATIONS, ["weighStations"]),
    "fueling-stations": parseLayers(process.env.LAYERS_FUELING_STATIONS, ["fuelingStations"]),
    rwss: parseLayers(process.env.LAYERS_RWSS, ["rwis"])
  }
};

function parseLayers(value, fallback) {
  if (!value) return fallback;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}
