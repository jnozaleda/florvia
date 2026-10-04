-- Usage log (Cloudflare D1, database florvia-usage). One row per event or AI call; nothing personal:
-- ids are hashes (device = hash of the install id, garden = hash derived by the app from the garden key).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,            -- UTC YYYY-MM-DD
  src TEXT NOT NULL,            -- prod | old | dev | none (from the Origin header)
  kind TEXT NOT NULL,           -- event | ai
  name TEXT NOT NULL,           -- app_open, plant_add_ai… | care, care_hit, calendar, place, error, limit…
  device TEXT NOT NULL DEFAULT '',
  garden TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device);
CREATE INDEX IF NOT EXISTS idx_events_garden ON events(garden);
-- Ids (device or garden hashes) Noza marked as their own: their rows are reported apart from real use.
CREATE TABLE IF NOT EXISTS internal (id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
-- Names Noza gave to people (person id = garden hash, or device hash when not synced).
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
