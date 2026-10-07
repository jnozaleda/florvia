// Prueba de «una ficha por especie»: nombres distintos de la misma planta dan la misma ficha, el alias evita volver a preguntar a la IA, las fichas
// antiguas (por nombre escrito) se unen a su especie al pedirlas, y otra zona o la confianza «baja» se tratan aparte. Uso: node tools/test-care-alias.mjs
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




// La KV simulada del encabezado devuelve texto: aquí hace falta que, con el tipo «json», devuelva el objeto como la real.
env.CACHE.get = async (k, type) => { const v = kv.get(k) ?? null; return type === "json" && v !== null ? JSON.parse(v) : v; };
const RAW = { isPlant: true, commonName: "Aspidistra", species: "Aspidistra elatior", confidence: "alta", sunNeed: "sombra", sunSensitive: true, frostSensitive: true, minTemp: -5, climateFit: "bien", climateNote: "Aguanta.",
  water_spring: 10, water_summer: 6, water_autumn: 12, water_winter: 20, feed_spring: 30, feed_summer: 30, feed_autumn: 0, feed_winter: 0, notes: "nota A" };
const setAI = (patch) => { gemini = { m1: { status: 200, json: { ...RAW, ...patch } }, m2: { status: 200, json: { ...RAW, ...patch } } }; };
const ask = (name, { lat = 40.4, lon = -3.7 } = {}) => call("/care", { name, lat, lon, place: "Madrid" });
const kvKeys = () => [...kv.keys()];
const calls = () => sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'ai' AND name = 'care'").get().n;

let failed = 0;
async function test(name, fn) {
  kv = new Map(); emails.length = 0; sqlite.exec("DELETE FROM events; DELETE FROM internal; DELETE FROM meta; DELETE FROM labels;");
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("dos formas de escribir la misma planta dan la misma ficha (la primera) y quedan guardadas por especie y alias", async () => {
  setAI({ notes: "nota A" });
  const a = await ask("Aspidistra");
  assert.equal(a.status, 200); assert.equal(a.body.notes, "nota A");
  setAI({ notes: "nota B" });
  const b = await ask("aspidistra aspidistra elatior");
  assert.equal(b.status, 200); assert.equal(b.body.notes, "nota A", "se sirve la ficha que ya existía para la especie");
  assert.deepEqual(kvKeys().filter((k) => k.startsWith("species:")), ["species:v16:aspidistra elatior:40:-4"]);
  assert.deepEqual(kvKeys().filter((k) => k.startsWith("alias:")).sort(), ["alias:v16:aspidistra aspidistra elatior:40:-4", "alias:v16:aspidistra:40:-4"]);
});
await test("repetir un nombre ya visto no llama a la IA y entrega la ficha de la especie", async () => {
  setAI({ notes: "nota A" });
  await ask("Aspidistra");
  setAI({ notes: "otra" });
  const n = calls();
  const r = await ask("aspidistra");
  assert.equal(r.body.notes, "nota A"); assert.equal(r.body.cached, true);
  assert.equal(calls(), n, "sin consulta nueva");
});
await test("«Citrus × limon», «Citrus limon (L.) Osbeck» y «Citrus limon» son la misma especie", async () => {
  setAI({ species: "Citrus × limon", commonName: "Limonero", notes: "limón 1" });
  await ask("limonero");
  setAI({ species: "Citrus limon (L.) Osbeck", notes: "limón 2" });
  assert.equal((await ask("limón")).body.notes, "limón 1");
  setAI({ species: "Citrus limon", notes: "limón 3" });
  assert.equal((await ask("citrus limon")).body.notes, "limón 1");
  assert.equal(kvKeys().filter((k) => k.startsWith("species:")).length, 1);
});
await test("especies distintas no se mezclan, y otra zona climática tiene su propia ficha", async () => {
  setAI({ notes: "madrid" });
  await ask("aspidistra");
  setAI({ species: "Cycas revoluta", commonName: "Cica", notes: "cica" });
  assert.equal((await ask("cica")).body.notes, "cica");
  setAI({ notes: "málaga" });
  assert.equal((await ask("aspidistra", { lat: 36.7, lon: -4.4 })).body.notes, "málaga", "otra celda: ficha nueva");
  assert.equal(kvKeys().filter((k) => k.startsWith("species:")).length, 3);
});
await test("fichas antiguas por nombre escrito: la primera en pedirse se queda como la de la especie y las demás se unen a ella", async () => {
  const sheet = (notes) => JSON.stringify({ ...RAW, notes, seasons: { spring: { water: 10, feed: 30 }, summer: { water: 6, feed: 30 }, autumn: { water: 12, feed: 0 }, winter: { water: 20, feed: 0 } } });
  kv.set("care:v16:aspidistra:40:-4", sheet("vieja 1"));
  kv.set("care:v16:aspidistra elatior:40:-4", sheet("vieja 2"));
  setAI({ notes: "nueva" });
  const n = calls();
  assert.equal((await ask("aspidistra elatior")).body.notes, "vieja 2");
  assert.equal((await ask("aspidistra")).body.notes, "vieja 2", "ya hay ficha de la especie: la otra antigua se descarta");
  assert.equal(calls(), n, "sin consultas a la IA");
});
await test("confianza «baja»: no se guarda ni se crea alias (se vuelve a preguntar)", async () => {
  setAI({ confidence: "baja", notes: "dudosa" });
  assert.equal((await ask("aspidistra")).body.notes, "dudosa");
  assert.deepEqual(kvKeys().filter((k) => k.startsWith("species:") || k.startsWith("alias:") || k.startsWith("care:")), []);
  const n = calls();
  await ask("aspidistra");
  assert.equal(calls(), n + 1);
});
await test("una respuesta que no parece una planta se rechaza y no se guarda", async () => {
  setAI({ species: "planta rara", notes: "rara" });
  const r = await ask("rarita");
  assert.equal(r.status, 422, "no parece una planta: la IA lo marca y no se guarda");
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de ficha por especie pasan");
