// Prueba de los fallos de la IA y de los avisos a Noza, contra el Worker real, con D1/KV simulados y los proveedores de IA simulados.
// Comprueba: «cuota agotada» frente a otros fallos (respuesta y métrica), un solo aviso por tipo y día (correo), los avisos de tope diario
// (80 % y 100 %) y el desglose que se ve en «Uso de la app» (/stats2).
// Uso: node tools/test-ai-alerts.mjs   (Node 22.13+; sale con código 1 si algo falla)
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

let failed = 0;
async function test(name, fn) {
  kv = new Map(); emails.length = 0; sqlite.exec("DELETE FROM events");
  // Aquí solo se prueban los avisos de fallos de la IA: los avisos de actividad (planta, foto, diagnóstico) tienen su propia prueba (test-notify.mjs).
  sqlite.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('notify', ?)").run(JSON.stringify({ plant: false, identify: false, diagnose: false }));
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("todos los modelos sin cuota: error «quota» (503), métrica «quota» y UN correo; el segundo fallo del día no repite el aviso", async () => {
  gemini = { m1: QUOTA, m2: QUOTA };
  const r = await care();
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "quota");
  assert.deepEqual(aiEvents(), ["quota=1"]);
  assert.deepEqual(subjects(), ["Florvia · La IA no responde: cuota agotada"]);
  assert.equal(emails[0].to, "noza@example.com");
  await care();
  assert.equal(emails.length, 1, "no debe repetirse el correo el mismo día");
  assert.deepEqual(aiEvents(), ["quota=2"]);
});
await test("un fallo que no es de cuota: error «ai» (502), métrica «error» y ningún correo", async () => {
  gemini = { m1: FAIL, m2: FAIL };
  env.AI = { run: async () => { throw new Error("modelo roto"); } };
  const r = await care();
  env.AI = { run: async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } };
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "ai");
  assert.deepEqual(aiEvents(), ["error=1"]);
  assert.equal(emails.length, 0);
});
await test("el último recurso (Workers AI) también se reconoce como cuota agotada", async () => {
  gemini = { m1: FAIL, m2: FAIL }; // los modelos de Gemini fallan por otra razón, Workers AI por la cuota diaria
  const r = await care();
  assert.equal(r.body.error, "quota");
  assert.deepEqual(subjects(), ["Florvia · La IA no responde: cuota agotada"]);
});
await test("un modelo sin cuota pero otro responde: la persona recibe respuesta y a Noza le llega un aviso (una vez por modelo y día)", async () => {
  gemini = { m1: QUOTA, m2: { status: 200 } };
  const r = await diagnose();
  assert.equal(r.status, 200);
  assert.equal(r.body.causes.length, 1);
  assert.deepEqual(subjects(), ["Florvia · Un modelo de IA ha agotado su cuota"]);
  assert.match(bodyOf(emails[0]), /gemini:m1/);
  await diagnose();
  assert.equal(emails.length, 1);
  assert.deepEqual(aiEvents(), ["diagnose=2"]);
});
await test("tope diario: aviso al 80 %, aviso al 100 %, y a partir de ahí «limit» sin más correos", async () => {
  gemini = { m1: { status: 200 }, m2: { status: 200 } };
  env.DAILY_LIMIT = "10";
  for (let i = 1; i <= 7; i++) await diagnose();
  assert.equal(emails.length, 0, "con 7 de 10 aún no hay aviso");
  await diagnose(); // 8 de 10
  assert.deepEqual(subjects(), ["Florvia · La IA lleva el 80 % del tope diario"]);
  await diagnose(); await diagnose(); // 9 y 10 de 10
  assert.deepEqual(subjects(), ["Florvia · La IA lleva el 80 % del tope diario", "Florvia · La IA ha llegado al tope diario"]);
  const r = await diagnose(); // la 11 ya no cabe
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "limit");
  assert.equal(emails.length, 2, "ningún aviso más");
  assert.match(aiEvents().join(), /limit=1/);
  env.DAILY_LIMIT = "1000";
});
await test("«Uso de la app» (/stats2) separa tope diario, cuota, otros fallos y «no era una planta», y da el consumo de hoy", async () => {
  gemini = { m1: QUOTA, m2: QUOTA }; await care(); await care();
  gemini = { m1: FAIL, m2: FAIL }; env.AI = { run: async () => { throw new Error("modelo roto"); } }; await care();
  env.AI = { run: async () => { throw new Error("4006: neurons"); } };
  sqlite.prepare("INSERT INTO events (ts, day, src, kind, name, device) VALUES (?, ?, 'prod', 'ai', 'not_plant', 'zzz')").run(Date.now(), new Date().toISOString().slice(0, 10));
  sqlite.prepare("INSERT INTO events (ts, day, src, kind, name, device) VALUES (?, ?, 'prod', 'ai', 'limit', 'yyy')").run(Date.now(), new Date().toISOString().slice(0, 10));
  const res = await worker.fetch(new Request("https://api.florvia.app/stats2?days=7", { headers: { "X-Access-Code": "test-code", Origin: "https://florvia.app" } }), env, ctx);
  const s = await res.json();
  const today = s.days[s.days.length - 1].ai;
  assert.deepEqual({ quota: today.quota, errors: today.errors, limits: today.limits, notPlant: today.notPlant }, { quota: 2, errors: 1, limits: 1, notPlant: 1 });
  assert.equal(s.cap.limit, 1000);
  assert.equal(typeof s.cap.used, "number");
});

globalThis.fetch = realFetch;
if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de fallos y avisos de la IA pasan");
