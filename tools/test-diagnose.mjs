// Prueba de POST /diagnose («¿Qué le pasa?») contra el Worker real, con D1 simulada en SQLite y la IA (Gemini) simulada.
// Comprueba sobre todo que una foto que no es de la planta (o que no es de una planta) NO se diagnostica ni gasta una consulta.
// Uso: node tools/test-diagnose.mjs   (Node 22.13+; sale con código 1 si algo falla)
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
const env = {
  DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) },
  CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
  ACCESS_CODE: "test-code", REQUIRE_CODE: "off", ALLOWED_ORIGINS: "https://florvia.app",
  PROVIDER: "gemini:test-model", GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model", DAILY_LIMIT: "1000", IP_DAILY_LIMIT: "1000",
};
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

// La IA simulada: devuelve lo que diga `aiReply` y guarda lo que se le pidió.
let aiReply = {};
let aiPrompt = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("generativelanguage.googleapis.com")) return realFetch(url, init);
  aiPrompt = JSON.parse(init.body).contents[0].parts.map((p) => p.text ?? "").join("");
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiReply) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }), { status: 200 });
};
const CAUSE = { title: "Exceso de riego", likelihood: "alta", why: "La tierra está muy húmeda.", check: "Toca la tierra.", action: "Riega menos." };
const reply = (extra) => ({ photoSeen: "", photo: "sin_foto", isPlant: true, urgency: "media", summary: "Parece exceso de riego.", causes: [CAUSE], watch: "", needMore: "", ...extra });
const IMG = "A".repeat(400); // base64 válido de ejemplo (el Worker solo comprueba el formato y el tamaño)
const PLANT = { name: "Limonero", species: "Citrus limon", zone: "Terraza", pot: true, sun: "sun", waterEvery: 5, lastWatered: 3, lastFed: 40 };

async function diagnose(body, { ip = "9.9.9.9" } = {}) {
  const res = await worker.fetch(new Request("https://api.florvia.app/diagnose", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "CF-Connecting-IP": ip, "X-Device": "dispositivo-de-prueba" }, body: JSON.stringify(body) }), env, ctx);
  await Promise.all(pending.splice(0));
  return { status: res.status, body: await res.json() };
}
const usedThisMonth = async () => (await (await worker.fetch(new Request("https://api.florvia.app/me", { headers: { Origin: "https://florvia.app", "CF-Connecting-IP": "9.9.9.9", "X-Device": "dispositivo-de-prueba" } }), env, ctx)).json()).used?.diagnose;
const aiEvents = () => sqlite.prepare("SELECT name, COUNT(*) AS n FROM events WHERE kind = 'ai' GROUP BY name ORDER BY name").all().map((r) => `${r.name}=${r.n}`);

let failed = 0;
async function test(name, fn) {
  sqlite.exec("DELETE FROM events");
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("sin foto: diagnostica, cuenta como una consulta y la foto figura como «sin_foto»", async () => {
  aiReply = reply({ isPlant: false }); // sin foto, «isPlant» no tiene sentido y se ignora
  const r = await diagnose({ plant: PLANT, symptoms: ["amarillas"] });
  assert.equal(r.status, 200);
  assert.equal(r.body.isPlant, true);
  assert.equal(r.body.photo, "sin_foto");
  assert.equal(r.body.causes.length, 1);
  assert.deepEqual(aiEvents(), ["diagnose=1"]);
});
await test("foto que coincide con la planta: diagnóstico normal", async () => {
  aiReply = reply({ photo: "coincide", photoSeen: "limonero" });
  const r = await diagnose({ plant: PLANT, symptoms: ["amarillas"], image: IMG });
  assert.equal(r.body.photo, "coincide");
  assert.equal(r.body.photoSeen, "limonero");
  assert.equal(r.body.causes.length, 1);
  assert.deepEqual(aiEvents(), ["diagnose=1"]);
  assert.equal(await usedThisMonth(), 1); // este sí cuenta
});
await test("foto de OTRA planta (aspidistra en un limonero): sin diagnóstico y NO gasta una consulta", async () => {
  aiReply = reply({ photo: "otra_planta", photoSeen: "aspidistra" }); // aunque la IA devuelva causas, se descartan
  const r = await diagnose({ plant: PLANT, symptoms: ["marrones"], image: IMG });
  assert.equal(r.status, 200);
  assert.equal(r.body.photo, "otra_planta");
  assert.equal(r.body.photoSeen, "aspidistra");
  assert.equal(r.body.isPlant, true);
  assert.deepEqual(r.body.causes, []);
  assert.equal(r.body.summary, "");
  assert.deepEqual(aiEvents(), ["not_plant=1"]); // no hay «diagnose»: no cuenta para el límite mensual
  assert.equal(await usedThisMonth(), 0); // el contador de la pantalla Premium («x de 5 este mes») no sube
});
await test("foto que no es una planta (captura de pantalla): sin diagnóstico y sin gastar consulta", async () => {
  aiReply = reply({ photo: "no_es_planta", photoSeen: "captura de pantalla" });
  const r = await diagnose({ plant: PLANT, note: "se le caen las hojas", image: IMG });
  assert.equal(r.body.photo, "no_es_planta");
  assert.equal(r.body.isPlant, false);
  assert.deepEqual(r.body.causes, []);
  assert.deepEqual(aiEvents(), ["not_plant=1"]);
});
await test("«isPlant: false» con foto cuenta como «no es una planta» aunque el campo «photo» diga otra cosa", async () => {
  aiReply = reply({ photo: "coincide", isPlant: false });
  const r = await diagnose({ plant: PLANT, symptoms: ["mustia"], image: IMG });
  assert.equal(r.body.photo, "no_es_planta");
  assert.equal(r.body.isPlant, false);
  assert.deepEqual(r.body.causes, []);
  assert.deepEqual(aiEvents(), ["not_plant=1"]);
});
await test("foto dudosa: se diagnostica, avisando de que no se ve bien", async () => {
  aiReply = reply({ photo: "dudosa", photoSeen: "una hoja verde" });
  const r = await diagnose({ plant: PLANT, symptoms: ["manchas"], image: IMG });
  assert.equal(r.body.photo, "dudosa");
  assert.equal(r.body.causes.length, 1);
  assert.deepEqual(aiEvents(), ["diagnose=1"]);
});
await test("un valor raro en «photo» no rompe nada: se trata como «coincide»", async () => {
  aiReply = reply({ photo: "quizás", photoSeen: "x".repeat(300) });
  const r = await diagnose({ plant: PLANT, symptoms: ["manchas"], image: IMG });
  assert.equal(r.body.photo, "coincide");
  assert.ok(r.body.photoSeen.length <= 80);
});
await test("a la IA se le pide comprobar que la foto es de la planta indicada", async () => {
  aiReply = reply({ photo: "coincide" });
  await diagnose({ plant: PLANT, symptoms: ["amarillas"], image: IMG });
  assert.match(aiPrompt, /Limonero/);
  assert.match(aiPrompt, /otra_planta/);
  assert.match(aiPrompt, /ANTES de diagnosticar/);
  await diagnose({ plant: PLANT, symptoms: ["amarillas"] }); // sin foto no se le pide nada de eso
  assert.doesNotMatch(aiPrompt, /ANTES de diagnosticar/);
});
await test("entradas inválidas se rechazan antes de llamar a la IA", async () => {
  assert.equal((await diagnose({ plant: { ...PLANT, name: "" }, symptoms: ["amarillas"] })).status, 400);
  assert.equal((await diagnose({ plant: PLANT })).status, 400); // ni síntomas, ni nota, ni foto
  assert.equal((await diagnose({ plant: PLANT, image: "no es base64!!" })).status, 400);
  assert.deepEqual(aiEvents(), []);
});

globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} prueba(s) fallan` : "\nTodo bien");
process.exit(failed ? 1 : 0);
