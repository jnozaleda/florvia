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
  ms INTEGER NOT NULL DEFAULT 0,
  tin INTEGER NOT NULL DEFAULT 0,   -- model input tokens of an AI call
  tout INTEGER NOT NULL DEFAULT 0   -- model output tokens (incl. thinking)
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device);
CREATE INDEX IF NOT EXISTS idx_events_garden ON events(garden);
-- Ids (device or garden hashes) Noza marked as their own: their rows are reported apart from real use.
CREATE TABLE IF NOT EXISTS internal (id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
-- Names Noza gave to people (person id = garden hash, or device hash when not synced).
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- Comments sent from the app (Ajustes → Enviar comentario) and technical errors reported by the app.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, day TEXT NOT NULL, src TEXT NOT NULL,
  type TEXT NOT NULL,             -- idea | bug | other
  text TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', tech TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '', garden TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'   -- new | read | done
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE TABLE IF NOT EXISTS errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, day TEXT NOT NULL, src TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '', msg TEXT NOT NULL, at TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '', garden TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_errors_day ON errors(day);

-- Plans (phase 1 of the paywall). `garden` is the garden hash derived from the garden key (X-Key); plan = premium | lifetime.
-- The free trial is not stored: it is 30 days from the later of a person's first event and meta.paywall_start (computed from events).
CREATE TABLE IF NOT EXISTS entitlements (
  garden TEXT PRIMARY KEY, plan TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
  since INTEGER NOT NULL, until INTEGER, note TEXT NOT NULL DEFAULT ''
);
-- Who tapped «Quiero Premium» (interest test before payments exist).
CREATE TABLE IF NOT EXISTS premium_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, src TEXT NOT NULL,
  choice TEXT NOT NULL,            -- monthly | yearly | lifetime
  contact TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', garden TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_intent_day ON premium_intent(day);

-- Migration already applied on 2026-10-05 (run once; not idempotent):
--   ALTER TABLE events ADD COLUMN tin INTEGER NOT NULL DEFAULT 0;   -- model input tokens of an AI call
--   ALTER TABLE events ADD COLUMN tout INTEGER NOT NULL DEFAULT 0;  -- model output tokens (incl. thinking)
-- Launch date of the paywall (YYYY-MM-DD): INSERT OR REPLACE INTO meta(k,v) VALUES('paywall_start','2026-10-19');

-- Handy view for reading people in the D1 console: one row per person (synced garden, or a device that isn't synced).
CREATE VIEW IF NOT EXISTS people AS
WITH dg AS (SELECT device, MAX(garden) AS garden FROM events WHERE garden <> '' AND device <> '' GROUP BY device),
ev AS (
  SELECT e.*, CASE WHEN e.garden <> '' THEN e.garden WHEN dg.garden IS NOT NULL THEN dg.garden WHEN e.device <> '' THEN e.device ELSE 'anon' END AS person
  FROM events e LEFT JOIN dg ON dg.device = e.device
)
SELECT person, CASE WHEN length(person) = 16 THEN 'jardin' WHEN person = 'anon' THEN 'anon' ELSE 'movil' END AS kind,
  MIN(day) AS first_seen, MAX(day) AS last_seen, COUNT(DISTINCT day) AS active_days,
  SUM(kind = 'event' AND name = 'app_open') AS opens,
  SUM(kind = 'ai' AND name NOT LIKE '%!_hit' ESCAPE '!' AND name NOT IN ('error', 'limit', 'not_plant')) AS ai_calls,
  SUM(tin) AS tokens_in, SUM(tout) AS tokens_out,
  GROUP_CONCAT(DISTINCT src) AS origins,
  (SELECT label FROM labels WHERE id = person) AS label,
  EXISTS (SELECT 1 FROM internal i WHERE i.id = person) AS internal
FROM ev GROUP BY person;

-- First-touch source of each device (?ref=<page> on the app link from the blog): visit → app → plant added.
CREATE TABLE IF NOT EXISTS referrals (
  device TEXT PRIMARY KEY, ref TEXT NOT NULL, day TEXT NOT NULL, src TEXT NOT NULL DEFAULT ''
);

-- Web visits (landing + blog), see «Web visits» in worker.js. Counts only: one visitor per day and page.
-- pv_seen / pv_seen_day hold a one-way daily hash for 2 days (to count each visitor once) and are then deleted.
-- kind: person | search (Googlebot, Bingbot…) | ai (GPTBot, ClaudeBot…) | preview (WhatsApp, Slack…) | bot (other robots).
-- src: direct | google | search | social | ai | other | internal.
CREATE TABLE IF NOT EXISTS pv_seen (day TEXT NOT NULL, h TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (day, h, path));
CREATE TABLE IF NOT EXISTS pv_seen_day (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h));
CREATE TABLE IF NOT EXISTS pv_page (day TEXT NOT NULL, path TEXT NOT NULL, src TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path, src, kind));
CREATE TABLE IF NOT EXISTS pv_site (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
-- People per UTC hour (first visit of the day of each person), for the 24-hour chart in «Uso de la app». Only counts; exists since 2026-10-06.
CREATE TABLE IF NOT EXISTS pv_hour (day TEXT NOT NULL, hr INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, hr));

-- What people ask for, anonymous: only counts per day, kind and normalised name (a plant, a symptom, a preference). No device, no garden.
-- kind: care (ficha al añadir), explore, identify (species recognised from a photo), added (plant added to the garden), diagnose (plant), symptom,
-- place («¿Dónde está mejor?», plant), suggest_pref and suggest_pick («Qué planto aquí»). internal = 1 when it came from a device marked as Noza's.
CREATE TABLE IF NOT EXISTS topics (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, src TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key, src, internal));

-- Friends-and-family access: codes Noza creates (invites) and who used them (invite_uses, with the email they gave).
-- A use grants an entitlement (source = 'invite', note = 'invite:CODE'); revoking a code removes those entitlements.
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0,
  access_days INTEGER,            -- NULL = Premium until revoked
  expires INTEGER,                -- the code stops working after this time (ms), NULL = never
  active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, code TEXT NOT NULL, email TEXT NOT NULL,
  who TEXT NOT NULL,              -- garden hash or device hash the plan was given to
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invite_uses_code ON invite_uses(code);
