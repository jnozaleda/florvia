// Prueba de los planes (GET /me): el mes de Premium gratis, el plan gratuito al acabarlo, lo pagado y lo interno. Uso: node tools/test-plans.mjs
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) { return s === "cloudflare:email" ? { url: "data:text/javascript,export class EmailMessage {}", shortCircuit: true } : next(s, c); }
`));
const { default: worker } = await import(new URL("../worker/src/worker.js", import.meta.url));

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.run())) }, ALLOWED_ORIGINS: "https://florvia.app" };
const ctx = { waitUntil: () => {} };

const sha = (t) => createHash("sha256").update(t).digest("hex");
const deviceHash = (id) => sha(`mj:${id}`).slice(0, 12);
const gardenHash = (key) => sha(`usage:${key}`).slice(0, 16);
const isoDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const setStart = (d) => sqlite.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('paywall_start', ?)").run(d);
const seen = (id, daysAgo) => sqlite.prepare("INSERT INTO events (ts, day, src, kind, name, device) VALUES (?, ?, 'prod', 'event', 'app_open', ?)").run(Date.now(), isoDay(-daysAgo), deviceHash(id));
async function me(device, key) {
  const headers = { Origin: "https://florvia.app", "X-Device": device };
  if (key) headers["X-Key"] = key;
  return (await worker.fetch(new Request("https://api.florvia.app/me", { headers }), env, ctx)).json();
}

let failed = 0;
async function test(name, fn) { try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

await test("antes del lanzamiento todos tienen el mes gratis, contado desde la fecha de lanzamiento", async () => {
  setStart("2099-01-01");
  seen("viejo", 100);
  const a = await me("nuevo"), b = await me("viejo");
  for (const m of [a, b]) { assert.equal(m.plan, "trial"); assert.equal(m.premium, true); assert.equal(m.enforced, false); assert.equal(m.trialEnds, "2099-01-31"); }
});
await test("tras el lanzamiento, quien llega nuevo tiene 30 días desde hoy", async () => {
  setStart("2000-01-01");
  const m = await me("recien-llegado");
  assert.equal(m.plan, "trial"); assert.equal(m.trialEnds, isoDay(30)); assert.equal(m.enforced, true);
  assert.equal(m.limits.suggest, 30);
});
await test("a mitad de la prueba sigue siendo Premium y cuenta los días desde su primer uso", async () => {
  seen("a-mitad", 10);
  const m = await me("a-mitad");
  assert.equal(m.plan, "trial"); assert.equal(m.trialEnds, isoDay(20));
});
await test("acabado el mes pasa al plan gratuito con sus límites", async () => {
  seen("caducado", 60);
  const m = await me("caducado");
  assert.equal(m.plan, "free"); assert.equal(m.premium, false); assert.equal(m.limits.suggest, 5); assert.equal(m.limits.plants, 8);
  assert.ok(m.trialEnds < isoDay(0));
});
await test("lo pagado por el jardín gana a la prueba caducada", async () => {
  const key = "ABCDEFGHJKLMNPQR";
  seen("pagador", 90);
  sqlite.prepare("INSERT INTO entitlements (garden, plan, source, since, until, note) VALUES (?, 'premium', 'polar', ?, NULL, '')").run(gardenHash(key), Date.now());
  const m = await me("pagador", key);
  assert.equal(m.plan, "premium"); assert.equal(m.source, "paid");
});
await test("un dispositivo marcado como tuyo es Premium aunque la prueba haya caducado", async () => {
  seen("yo", 90);
  sqlite.prepare("INSERT INTO internal (id, ts) VALUES (?, ?)").run(deviceHash("yo"), Date.now());
  const m = await me("yo");
  assert.equal(m.plan, "premium"); assert.equal(m.source, "internal");
});
await test("el plan gratuito se ofrece también como freeLimits a quien está en prueba", async () => {
  const m = await me("a-mitad");
  assert.deepEqual({ ...m.freeLimits }, { plants: 8, suggest: 5, identify: 5, diagnose: 5 });
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de planes pasan");
