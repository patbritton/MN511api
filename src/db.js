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

  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
}