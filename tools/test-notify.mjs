// Prueba de los avisos de actividad por correo (planta añadida, foto identificada, diagnóstico), de sus interruptores y de las horas
// de «Uso de la app», contra el Worker real con D1/KV simulados. Uso: node tools/test-notify.mjs  (sale con código 1 si algo falla)
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// El Worker importa "cloudflare:email", que solo existe en Cloudflare: lo sustituimos por una clase que guarda lo que se envía.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) { return s === "cloudflare:email" ? { url: "data:text/javascript," + encodeURIComponent("export class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }"), shortCircuit: true } : next(s, c); }
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
let kv = new Map();
const emails = [];
const env = {
  DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) },
  CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k), list: async () => ({ keys: [], list_complete: true }) },
  EMAIL: { send: async (m) => void emails.push(m) }, NOTIFY_EMAIL: "noza@example.com",
  AI: { run: async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } }, MODEL: "test",
  ACCESS_CODE: "test-code", REQUIRE_CODE: "off", ALLOWED_ORIGINS: "https://florvia.app",
  PROVIDER: "gemini:m1,gemini:m2,workers-ai", GEMINI_API_KEY: "k", GEMINI_MODEL: "m1", DAILY_LIMIT: "1000", IP_DAILY_LIMIT: "1000",
};
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

// Gemini simulado: cada modelo responde lo que diga `gemini[modelo]`.
let gemini = {};
const OK = { photoSeen: "", photo: "sin_foto", isPlant: true, urgency: "media", summary: "Parece exceso de riego.", causes: [{ title: "Exceso de riego", likelihood: "alta", why: "Tierra húmeda.", check: "Toca la tierra.", action: "Riega menos." }], watch: "", needMore: "" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/generativelanguage\.googleapis\.com\/v1beta\/models\/([^:]+):/);
  if (!m) return realFetch(url, init);
  const r = gemini[m[1]] ?? { status: 500, body: "boom" };
  if (r.status !== 200) return new Response(r.body ?? "error", { status: r.status });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(r.json ?? OK) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
};
const QUOTA = { status: 429, body: '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}' };
const FAIL = { status: 500, body: "internal error" };

let n = 0;
const call = async (path, body) => {
  const res = await worker.fetch(new Request(`https://api.florvia.app${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "CF-Connecting-IP": "9.9.9.9", "X-Device": `dispositivo-${++n}` }, body: JSON.stringify(body) }), env, ctx);
  await Promise.all(pending.splice(0));
  return { status: res.status, body: await res.json() };
};
const care = () => call("/care", { name: "Limonero", lat: 40.4, lon: -3.7, place: "Madrid" });
const diagnose = () => call("/diagnose", { plant: { name: "Limonero" }, symptoms: ["amarillas"] });
const subjects = () => emails.map((m) => { const b = m.raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1]; return b ? Buffer.from(b, "base64").toString("utf8") : ""; });
const bodyOf = (m) => Buffer.from(m.raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
const aiEvents = () => sqlite.prepare("SELECT name, COUNT(*) AS n FROM events WHERE kind = 'ai' GROUP BY name ORDER BY name").all().map((r) => `${r.name}=${r.n}`);


const OKID = { isPlant: true, candidates: [{ commonName: "Calatea", species: "Goeppertia makoyana", confidence: "alta" }] };
gemini = { m1: { status: 200, json: OKID }, m2: { status: 200, json: OKID } };
const event = (events, { origin = "https://florvia.app", device = "dev-A", garden = "" } = {}) => worker.fetch(new Request("https://api.florvia.app/event", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin }, body: JSON.stringify({ device, garden, events }) }), env, ctx).then(async (r) => { await Promise.all(pending.splice(0)); return r; });
const admin = (path, body) => worker.fetch(new Request(`https://api.florvia.app${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "X-Access-Code": "test-code" }, body: body ? JSON.stringify(body) : undefined }), env, ctx).then(async (r) => { await Promise.all(pending.splice(0)); return r.json(); });
const identify = () => call("/identify", { image: "A".repeat(400), place: "Madrid" });

let failed = 0;
async function test(name, fn) {
  kv = new Map(); emails.length = 0; sqlite.exec("DELETE FROM events; DELETE FROM internal; DELETE FROM meta; DELETE FROM labels;");
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("planta añadida: un correo con el nombre, cómo se añadió y quién", async () => {
  await event(["plant_add_ai|Olivo"]);
  assert.equal(emails.length, 1);
  assert.deepEqual(subjects(), ["Florvia · Nueva planta: Olivo"]);
  const b = bodyOf(emails[0]);
  assert.match(b, /Olivo/); assert.match(b, /cuidados de la IA/); assert.match(b, /código /); assert.match(b, /Madrid/);
});
await test("a mano también avisa; los eventos que no son de alta no", async () => {
  await event(["plant_add_manual|Geranio", "app_open", "water_done"]);
  assert.deepEqual(subjects(), ["Florvia · Nueva planta: Geranio"]);
  assert.match(bodyOf(emails[0]), /a mano/);
});
await test("foto identificada: avisa con la especie más probable", async () => {
  const r = await identify();
  assert.equal(r.status, 200);
  assert.deepEqual(subjects(), ["Florvia · Planta identificada por foto: Calatea"]);
  assert.match(bodyOf(emails[0]), /Goeppertia makoyana/);
});
await test("diagnóstico: avisa con la planta y los síntomas", async () => {
  const r = await diagnose();
  assert.equal(r.status, 200);
  assert.deepEqual(subjects(), ["Florvia · Diagnóstico: Limonero"]);
  assert.match(bodyOf(emails[0]), /hojas amarillas/);
});
await test("los dispositivos marcados como tuyos no avisan", async () => {
  await event(["plant_add_ai|Olivo"], { device: "dev-mio" });
  const before = emails.length;
  // marcamos como interno el id con el que el Worker guarda ese dispositivo (el del evento anterior)
  const id = sqlite.prepare("SELECT device FROM events WHERE device <> '' LIMIT 1").get().device;
  sqlite.prepare("INSERT INTO internal (id, ts) VALUES (?, 0)").run(id);
  await event(["plant_add_ai|Olivo 2"], { device: "dev-mio" });
  assert.equal(emails.length, before);
});
await test("pruebas desde localhost o sin origen no avisan", async () => {
  await event(["plant_add_ai|Olivo"], { origin: "http://localhost:8769" });
  await event(["plant_add_ai|Olivo"], { origin: "https://evil.example" });
  assert.equal(emails.length, 0);
});
await test("interruptores: se apagan por tipo, y el informe los devuelve", async () => {
  assert.deepEqual((await admin("/stats2?days=1")).notify, { plant: true, identify: true, diagnose: true });
  const r = await admin("/notify", { kind: "plant", on: false });
  assert.deepEqual(r.notify, { plant: false, identify: true, diagnose: true });
  await event(["plant_add_ai|Olivo"]);
  assert.equal(emails.length, 0);
  await identify();
  assert.equal(emails.length, 1);
  assert.deepEqual((await admin("/stats2?days=1")).notify.plant, false);
});
await test("el interruptor exige el código y valida lo que recibe", async () => {
  const noCode = await worker.fetch(new Request("https://api.florvia.app/notify", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://florvia.app" }, body: JSON.stringify({ kind: "plant", on: false }) }), env, ctx);
  assert.equal(noCode.status, 401);
  assert.equal((await admin("/notify", { kind: "otra", on: false })).error, "input");
  assert.equal((await admin("/notify", { kind: "plant", on: "no" })).error, "input");
});
await test("tope diario: tras 40 avisos manda uno de límite y para", async () => {
  for (let i = 0; i < 45; i++) await event(["plant_add_ai|Planta " + i]);
  assert.equal(emails.length, 41);
  assert.equal(subjects()[40], "Florvia · Límite diario de avisos de actividad");
});
await test("las horas de «Uso de la app»: 24 cubos y las aperturas reales de la última hora", async () => {
  sqlite.prepare("DELETE FROM meta").run();
  sqlite.prepare("INSERT INTO meta (k, v) VALUES ('clean_start', '2020-01-01')").run();
  await event(["app_open", "app_open"], { device: "dev-B" });
  await event(["app_open"], { device: "dev-C" });
  const { hours } = await admin("/stats2?days=1");
  assert.equal(hours.length, 24);
  const last = hours[23];
  assert.deepEqual([last.opens, last.people], [3, 2]);
  assert.equal(hours.slice(0, 23).reduce((a, h) => a + h.opens, 0), 0);
});
await test("horas de la web: sin datos todavía → 24 cubos a cero", async () => {
  const w = await admin("/stats/web?days=1");
  assert.equal(w.hours.length, 24);
  assert.equal(w.hours.reduce((a, h) => a + h.person, 0), 0);
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de avisos de actividad y horas pasan");
