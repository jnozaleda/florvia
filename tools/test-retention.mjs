// Prueba de la retención en GET /stats2 contra el Worker real, con D1 simulada en SQLite en memoria.
// Uso: node tools/test-retention.mjs   (Node 22.13+; sale con código 1 si algo falla)
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) }, ACCESS_CODE: "test-code", ALLOWED_ORIGINS: "https://florvia.app" };
const ctx = { waitUntil() {} };

const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
sqlite.prepare("INSERT INTO meta (k, v) VALUES ('clean_start', ?)").run(day(60));
const visit = (device, back, src = "prod") => sqlite.prepare("INSERT INTO events (ts, day, src, kind, name, device, garden) VALUES (?, ?, ?, 'event', 'app_open', ?, '')").run(Date.now(), day(back), src, device);
// A: first 20 days ago, back next day and on day 10 · B: first 20 days ago, never back · C: first 5 days ago, back next day (week window not yet elapsed)
// D: first today (nothing elapsed) · E: mine (internal) · F: test traffic (dev)
visit("aaaaaaaaaaaa", 20); visit("aaaaaaaaaaaa", 19); visit("aaaaaaaaaaaa", 10);
visit("bbbbbbbbbbbb", 20);
visit("cccccccccccc", 5); visit("cccccccccccc", 4);
visit("dddddddddddd", 0);
visit("eeeeeeeeeeee", 20); sqlite.prepare("INSERT INTO internal (id, ts) VALUES ('eeeeeeeeeeee', 0)").run();
visit("ffffffffffff", 20, "dev");

const res = await worker.fetch(new Request("https://api.florvia.app/stats2?days=30", { headers: { "X-Access-Code": "test-code", Origin: "https://florvia.app" } }), env, ctx);
const { retention: r } = await res.json();

let failed = 0;
function test(name, fn) { try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

test("solo cuentan las personas reales (A, B, C, D)", () => assert.equal(r.overall.people, 4));
test("D1: A y B y C ya han tenido tiempo, y vuelven A y C", () => assert.deepEqual(r.overall.d1, { n: 3, back: 2 }));
test("semana: A y B han cumplido 7 días (C no); vuelve solo A", () => assert.deepEqual(r.overall.w1, { n: 2, back: 1 }));
test("mes (días 8–30): ninguna cohorte ha cumplido 30 días", () => assert.deepEqual(r.overall.m1, { n: 0, back: 0 }));
test("las cohortes se agrupan por semana y suman el total", () => assert.equal(r.cohorts.reduce((a, c) => a + c.people, 0), 4));
test("la persona de hoy no entra en ninguna ventana", () => assert.ok(r.cohorts.every((c) => c.d1.n <= c.people)));

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de retención pasan");
