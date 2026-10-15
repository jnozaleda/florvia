// Prueba del embudo del alta y del modo de uso (instalada / navegador) en GET /stats2, y del traspaso Safari → app instalada
// (/handoff), contra el Worker real con D1 simulada en SQLite y KV en memoria (#68).
// Uso: node tools/test-funnel.mjs   (Node 22.13+; sale con código 1 si algo falla)
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
const kv = new Map();
const CACHE = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) }, CACHE, ACCESS_CODE: "test-code", ALLOWED_ORIGINS: "https://florvia.app" };
const ctx = { waitUntil() {} };

const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
sqlite.prepare("INSERT INTO meta (k, v) VALUES ('clean_start', ?)").run(day(60));
const ev = (device, name, back = 1) => sqlite.prepare("INSERT INTO events (ts, day, src, kind, name, device, garden) VALUES (?, ?, 'prod', 'event', ?, ?, '')").run(Date.now(), day(back), name, device);
// A: browser on iPhone, starts, sees the sheet, adds · B: installed Android, starts, leaves a draft · C: browser iPhone, only opens
// D: opened from the browser and later installed (counts as installed) · E: an old visit outside the 30 days
for (const n of ["app_open", "open_browser_ios", "add_start", "add_sheet", "plant_identify", "add_auto", "plant_add_ai"]) ev("aaaaaaaaaaaa", n);
for (const n of ["app_open", "open_installed_android", "add_start", "add_sheet", "add_draft"]) ev("bbbbbbbbbbbb", n);
for (const n of ["app_open", "open_browser_ios"]) ev("cccccccccccc", n);
for (const n of ["app_open", "open_browser_ios", "add_start"]) ev("dddddddddddd", n, 3);
for (const n of ["app_open", "open_installed_ios", "install_claimed"]) ev("dddddddddddd", n, 1);
for (const n of ["app_open", "add_start"]) ev("eeeeeeeeeeee", n, 50);

let failed = 0;
async function test(name, fn) { try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

const res = await worker.fetch(new Request("https://api.florvia.app/stats2?days=30", { headers: { "X-Access-Code": "test-code", Origin: "https://florvia.app" } }), env, ctx);
const { funnel: f } = await res.json();
await test("embudo: personas por paso en el periodo", () => assert.deepEqual(f.steps.map((s) => s.people), [4, 3, 2, 1]));
await test("embudo: escaneos, altas solas y borradores", () => { assert.equal(f.scans.people, 1); assert.equal(f.auto.added, 1); assert.equal(f.drafts.saved, 1); });
await test("modo: instalada si alguna apertura fue desde el icono", () => { assert.equal(f.modes.installed, 2); assert.equal(f.modes.browser, 2); });
await test("modo: sistemas y aperturas", () => { assert.equal(f.modes.ios, 3); assert.equal(f.modes.android, 1); assert.equal(f.modes.opens.browser, 3); assert.equal(f.modes.opens.installed, 2); });
await test("modo: con planta según cómo la usan", () => { assert.equal(f.modes.plantedBrowser, 1); assert.equal(f.modes.plantedInstalled, 0); });
await test("instalar: jardines recuperados", () => assert.equal(f.install.claimed, 1));

const call = (path, { method = "GET", body, ip = "1.2.3.4" } = {}) => worker.fetch(new Request(`https://api.florvia.app${path}`, { method, headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "CF-Connecting-IP": ip }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
await test("traspaso: nada pendiente al principio", async () => assert.equal((await (await call("/handoff")).json()).pending, false));
let code;
await test("traspaso: rechaza una clave que no es de jardín", async () => assert.equal((await call("/handoff", { method: "POST", body: { key: "nope" } })).status, 400));
await test("traspaso: Safari deja la clave y recibe un código de 4 cifras", async () => { code = (await (await call("/handoff", { method: "POST", body: { key: "ABCD1234EFGH5678" } })).json()).code; assert.match(code, /^\d{4}$/); });
await test("traspaso: la app instalada ve que hay uno pendiente", async () => assert.equal((await (await call("/handoff")).json()).pending, true));
await test("traspaso: desde otra conexión no hay nada", async () => { assert.equal((await (await call("/handoff", { ip: "9.9.9.9" })).json()).pending, false); assert.equal((await call("/handoff/claim", { method: "POST", body: { code }, ip: "9.9.9.9" })).status, 404); });
await test("traspaso: un código equivocado no vale", async () => assert.equal((await call("/handoff/claim", { method: "POST", body: { code: code === "1111" ? "2222" : "1111" } })).status, 404));
await test("traspaso: con el código, la clave", async () => assert.equal((await (await call("/handoff/claim", { method: "POST", body: { code } })).json()).key, "ABCD1234EFGH5678"));
await test("traspaso: máximo 10 intentos por hora", async () => { for (let i = 0; i < 8; i++) await call("/handoff/claim", { method: "POST", body: { code: "0000" } }); assert.equal((await call("/handoff/claim", { method: "POST", body: { code } })).status, 429); });

if (failed) { console.log(`\n${failed} pruebas fallan`); process.exit(1); }
console.log("\nTodas las pruebas del embudo y del traspaso pasan");
