import Fastify from "fastify";
import cors from "@fastify/cors";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";

import { config } from "./config.js";
import { openDb } from "./db.js";

import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { runIngestOnce } from "./services/ingest.js";

const app = Fastify({
  logger: config.logPretty
    ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } }
    : true
});

app.decorate("db", openDb());

await app.register(cors, {
  origin: config.corsOrigin,
  methods: ["GET", "OPTIONS"]
});

await app.register(etag);

await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute"
});

await healthRoutes(app);
await eventRoutes(app);

// Run once on startup (optional)
try {
  await runIngestOnce(app);
} catch (e) {
  app.log.error({ err: e }, "Initial ingest failed");
}

// Schedule ingest
cron.schedule(config.ingestCron, async () => {
  try {
    await runIngestOnce(app);
  } catch (e) {
    app.log.error({ err: e }, "Scheduled ingest failed");
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
      "/api/incidents",
      "/api/closures",
      "/api/cameras",
      "/api/plows",
      "/api/road-conditions",
      "/api/weather-events",
      "/api/alerts",
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
