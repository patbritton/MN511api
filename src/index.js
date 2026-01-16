import Fastify from "fastify";
import cors from "@fastify/cors";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";

import { config } from "./config.js";
import { openDb } from "./db.js";

import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { weatherStationRoutes } from "./routes/weatherStations.js";
import { signRoutes } from "./routes/signs.js";
import { iceOutRoutes } from "./routes/iceout.js";
import { runEventsIngest, runStaticIngest, runIngestOnce } from "./services/ingest.js";

const app = Fastify({
  logger: config.logPretty
    ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } }
    : true
});

app.decorate("db", openDb());

const corsOrigins = config.corsOrigin
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const corsWildcards = corsOrigins.filter((v) => v.startsWith("*.")).map((v) => v.slice(2));
const corsExact = corsOrigins.filter((v) => !v.startsWith("*."));

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (corsExact.includes(origin)) return cb(null, true);
    if (corsWildcards.length) {
      try {
        const host = new URL(origin).hostname.toLowerCase();
        const ok = corsWildcards.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
        if (ok) return cb(null, true);
      } catch {
        return cb(null, false);
      }
    }
    return cb(null, false);
  },
  methods: ["GET", "OPTIONS"]
});

app.addHook("onSend", async (_req, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  return payload;
});

await app.register(etag);

await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute"
});

await healthRoutes(app);
await eventRoutes(app);
await weatherStationRoutes(app);
await signRoutes(app);
await iceOutRoutes(app);

// Run once on startup (optional)
try {
  await runIngestOnce(app);
} catch (e) {
  app.log.error({ err: e }, "Initial ingest failed");
}

// Schedule ingest
cron.schedule(config.ingestEventsCron, async () => {
  try {
    await runEventsIngest(app);
  } catch (e) {
    app.log.error({ err: e }, "Events ingest failed");
  }
});

cron.schedule(config.ingestStaticCron, async () => {
  try {
    await runStaticIngest(app);
  } catch (e) {
    app.log.error({ err: e }, "Static ingest failed");
  }
});

app.get("/", async () => {
  return {
    ok: true,
    name: "mn511-api",
    endpoints: [
      "/health",
      "/v1/meta/status",
      "/v1/events",
      "/v1/weather-stations",
      "/v1/signs",
      "/api/incidents",
      "/api/closures",
      "/api/cameras",
      "/api/plows",
      "/api/road-conditions",
      "/api/weather-events",
      "/api/weather-stations",
      "/api/signs",
      "/api/alerts",
      "/api/iceout",
      "/api/rest-areas",
      "/api/weigh-stations",
      "/api/fueling-stations",
      "/api/rwss",
      "/traffic",
      "/incidents",
      "/cameras",
      "/closures",
      "/conditions"
    ]
  };
});

await app.listen({ port: config.port, host: config.host });
app.log.info(`Listening on http://${config.host}:${config.port}`);
