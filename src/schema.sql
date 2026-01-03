PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  uri TEXT,
  title TEXT,
  tooltip TEXT,
  category TEXT,
  road TEXT,
  direction TEXT,
  severity INTEGER,
  priority INTEGER,

  geom_type TEXT,
  lat REAL,
  lon REAL,
  -- bbox: minLon,minLat,maxLon,maxLat (stored as four columns for fast filtering)
  bbox_min_lon REAL,
  bbox_min_lat REAL,
  bbox_max_lon REAL,
  bbox_max_lat REAL,

  icon TEXT,
  status TEXT, -- active|cleared|unknown

  source TEXT,
  raw_json TEXT,

  first_seen_at TEXT,
  last_seen_at TEXT,
  last_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_last_seen ON events(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_events_bbox ON events(bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);