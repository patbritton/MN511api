import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function openDb() {
  ensureDir(config.sqlitePath);
  const db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  ensureEventVersioning(db);

  return db;
}

function ensureEventVersioning(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(events)").all().map((row) => row.name));
  const addColumn = (name, definition) => {
    if (!columns.has(name)) {
      db.prepare(`ALTER TABLE events ADD COLUMN ${name} ${definition}`).run();
      columns.add(name);
    }
  };

  addColumn("source_id", "TEXT");
  addColumn("source_updated_at", "TEXT");
  addColumn("source_updated_timestamp", "INTEGER");
  addColumn("source_version", "INTEGER DEFAULT 1");
  addColumn("source_fingerprint", "TEXT");

  db.prepare(
    `UPDATE events
     SET source_id = COALESCE(NULLIF(source_id, ''), uri, id)
     WHERE source_id IS NULL OR source_id = ''`
  ).run();

  db.prepare(
    `UPDATE events
     SET source_version = 1
     WHERE source_version IS NULL`
  ).run();

  db.prepare(
    `UPDATE events
     SET source_updated_at = last_updated_at
     WHERE source_updated_at IS NULL AND last_updated_at IS NOT NULL`
  ).run();
}
