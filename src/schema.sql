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

  source_id TEXT,
  source_updated_at TEXT,
  source_updated_timestamp INTEGER,
  source_version INTEGER DEFAULT 1,
  source_fingerprint TEXT,

  first_seen_at TEXT,
  last_seen_at TEXT,
  last_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_last_seen ON events(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_events_bbox ON events(bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);

-- Weather Stations (RWIS - Road Weather Information Stations)
CREATE TABLE IF NOT EXISTS weather_stations (
  id TEXT PRIMARY KEY,
  uri TEXT,
  title TEXT,
  description TEXT,
  status TEXT, -- FREEZING, NORMAL, WARNING, etc.
  color TEXT,
  icon TEXT,

  -- Location
  route_designator TEXT,
  lat REAL,
  lon REAL,

  -- Weather fields stored as JSON for flexibility
  weather_fields TEXT, -- JSON object with all weatherStationFields

  source TEXT,
  raw_json TEXT,

  first_seen_at TEXT,
  last_seen_at TEXT,
  last_updated_at TEXT,
  last_updated_timestamp INTEGER
);

CREATE INDEX IF NOT EXISTS idx_weather_stations_status ON weather_stations(status);
CREATE INDEX IF NOT EXISTS idx_weather_stations_last_seen ON weather_stations(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_weather_stations_route ON weather_stations(route_designator);

-- Digital Message Signs (DMS)
CREATE TABLE IF NOT EXISTS signs (
  id TEXT PRIMARY KEY,
  uri TEXT,
  title TEXT,
  city_reference TEXT,
  sign_display_type TEXT,
  sign_status TEXT,
  color TEXT,
  icon TEXT,

  -- Location
  route_designator TEXT,
  primary_linear_reference TEXT,
  secondary_linear_reference TEXT,
  lat REAL,
  lon REAL,
  bbox_min_lon REAL,
  bbox_min_lat REAL,
  bbox_max_lon REAL,
  bbox_max_lat REAL,

  -- Sign content stored as JSON (can have multiple views)
  views TEXT, -- JSON array of sign views (text/image/combo)
  gantry_signs TEXT, -- JSON array of gantry signs if applicable

  source TEXT,
  raw_json TEXT,

  first_seen_at TEXT,
  last_seen_at TEXT,
  last_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_signs_status ON signs(sign_status);
CREATE INDEX IF NOT EXISTS idx_signs_last_seen ON signs(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_signs_bbox ON signs(bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_signs_route ON signs(route_designator);

-- Camera Views (enhanced camera data with video sources)
CREATE TABLE IF NOT EXISTS camera_views (
  id TEXT PRIMARY KEY,
  uri TEXT,
  title TEXT,
  category TEXT,
  icon TEXT,
  url TEXT, -- Primary image/stream URL

  -- Video sources stored as JSON
  sources TEXT, -- JSON array of {type, src} objects (HLS, RTSP, etc.)

  -- Parent camera collection info
  parent_uri TEXT,
  parent_title TEXT,
  parent_icon TEXT,
  parent_color TEXT,
  parent_route_designator TEXT,

  -- Location (from parent)
  lat REAL,
  lon REAL,

  source TEXT,
  raw_json TEXT,

  first_seen_at TEXT,
  last_seen_at TEXT,
  last_updated_at TEXT,
  last_updated_timestamp INTEGER
);

CREATE INDEX IF NOT EXISTS idx_camera_views_last_seen ON camera_views(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_camera_views_parent ON camera_views(parent_uri);
CREATE INDEX IF NOT EXISTS idx_camera_views_category ON camera_views(category);
