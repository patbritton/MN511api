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

  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  sqlitePath: process.env.SQLITE_PATH ?? "./data/mn511.sqlite",

  ingestCron: process.env.INGEST_CRON ?? "*/5 * * * *",

  staleAfterMinutes: Number(process.env.STALE_AFTER_MINUTES ?? 30),
  hardExpireMinutes: Number(process.env.HARD_EXPIRE_MINUTES ?? 180),

  mn511GraphqlUrl: must("MN511_GRAPHQL_URL"),
  mn511UserAgent: process.env.MN511_USER_AGENT ?? "mn511-api/1.0"
};