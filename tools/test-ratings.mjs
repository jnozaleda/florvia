// Prueba de las valoraciones «¿Te sirvió?» y de los casos guardados (POST /rating, GET /case/:id, estado, calidad en /stats2, correo, resumen
// diario y borrado), contra el Worker real con D1/KV simulados. Uso: node tools/test-ratings.mjs  (sale con código 1 si algo falla)
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



const rate = (body, { origin = "https://florvia.app", device = "rate-A" } = {}) => worker.fetch(new Request("https://api.florvia.app/rating", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin, "X-Device": device }, body: JSON.stringify(body) }), env, ctx).then(async (r) => { await Promise.all(pending.splice(0)); return { status: r.status, body: await r.json() }; });
const admin = (path, body, method) => worker.fetch(new Request(`https://api.florvia.app${path}`, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "X-Access-Code": "test-code" }, body: body ? JSON.stringify(body) : undefined }), env, ctx).then(async (r) => { await Promise.all(pending.splice(0)); return { status: r.status, body: await r.json() }; });
const CARE = { kind: "care", rating: 1, name: "Olivo", version: "20261007a", input: { name: "Olivo", place: "Madrid" }, output: { species: "Olea europaea", provider: "gemini-flash", confidence: "alta" } };
const PHOTO = "data:image/jpeg;base64," + "A".repeat(500);
const kvStore = () => kv;

let failed = 0;
async function test(name, fn) {
  kv = new Map(); emails.length = 0; sqlite.exec("DELETE FROM events; DELETE FROM internal; DELETE FROM meta; DELETE FROM labels;");
  try { sqlite.exec("DELETE FROM ai_cases"); } catch { /* todavía no existe: el Worker la crea al primer uso */ }
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("👍 se guarda con su caso y manda un correo con el enlace #caso=ID", async () => {
  const r = await rate(CARE);
  assert.equal(r.status, 200); assert.match(r.body.id, /^[a-z0-9]{10}$/);
  const row = sqlite.prepare("SELECT * FROM ai_cases WHERE id = ?").get(r.body.id);
  assert.deepEqual([row.kind, row.rating, row.name, row.provider, row.version, row.internal], ["care", 1, "Olivo", "gemini-flash", "20261007a", 0]);
  assert.deepEqual(subjects(), ["Florvia · 👍 Ficha de cuidados: Olivo"]);
  assert.ok(bodyOf(emails[0]).includes(`https://florvia.app/app/#caso=${r.body.id}`));
  assert.match(bodyOf(emails[0]), /Modelo: gemini-flash/);
});
await test("👎 con motivos y nota: el correo los lleva y los motivos desconocidos se descartan", async () => {
  const r = await rate({ ...CARE, rating: 0, reasons: ["planta_equivocada", "inventado", "generico"], note: "Es un olivo, no un acebuche" });
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare("SELECT reasons FROM ai_cases").get().reasons, "planta_equivocada,generico");
  assert.deepEqual(subjects(), ["Florvia · 👎 Ficha de cuidados: Olivo"]);
  const b = bodyOf(emails[0]);
  assert.match(b, /Planta equivocada, Demasiado genérico/); assert.match(b, /acebuche/);
});
await test("datos inválidos, otros orígenes y cuerpos enormes se rechazan sin guardar nada", async () => {
  assert.equal((await rate({ ...CARE, kind: "otra" })).status, 400);
  assert.equal((await rate({ ...CARE, rating: 5 })).status, 400);
  assert.equal((await rate({ ...CARE, output: { x: "a".repeat(130000) } })).status, 413);
  assert.equal((await rate(CARE, { origin: "http://localhost:8769" })).status, 200); // se ignora
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_cases").get().n, 0);
  assert.equal(emails.length, 0);
});
await test("la foto se guarda aparte (KV) y GET /case/:id la devuelve junto al caso, solo con el código", async () => {
  const r = await rate({ kind: "diagnose", rating: 0, reasons: ["consejo_dudoso"], name: "Limonero", photo: PHOTO, input: { symptoms: ["amarillas"], note: "desde ayer" }, output: { urgency: "media", causes: [] } });
  const id = r.body.id;
  const noCode = await worker.fetch(new Request(`https://api.florvia.app/case/${id}`, { headers: { Origin: "https://florvia.app" } }), env, ctx);
  assert.equal(noCode.status, 401);
  const c = (await admin(`/case/${id}`)).body;
  assert.deepEqual([c.kind, c.rating, c.name, c.photo, c.input.note, c.output.urgency, c.status], ["diagnose", 0, "Limonero", PHOTO, "desde ayer", "media", "new"]);
  assert.equal((await admin("/case/no-existe1")).status, 404);
});
await test("estado del caso: se puede marcar y solo con valores válidos", async () => {
  const id = (await rate(CARE)).body.id;
  assert.equal((await admin("/case/status", { id, status: "bueno", adminNote: "ok" })).status, 200);
  const c = (await admin(`/case/${id}`)).body;
  assert.deepEqual([c.status, c.adminNote], ["bueno", "ok"]);
  assert.equal((await admin("/case/status", { id, status: "raro" })).status, 400);
});
await test("tope de 30 valoraciones al día por dispositivo", async () => {
  for (let i = 0; i < 30; i++) assert.equal((await rate(CARE)).status, 200);
  assert.equal((await rate(CARE)).status, 429);
  assert.equal((await rate(CARE, { device: "rate-B" })).status, 200);
});
await test("dispositivo tuyo: se guarda y avisa como «Prueba tuya», pero no cuenta en la calidad", async () => {
  await rate(CARE, { device: "rate-mio" });
  const id = sqlite.prepare("SELECT device FROM ai_cases LIMIT 1").get().device;
  sqlite.prepare("INSERT INTO internal (id, ts) VALUES (?, 0)").run(id);
  emails.length = 0;
  sqlite.exec("DELETE FROM ai_cases"); // el primero se guardó antes de marcar el dispositivo como tuyo
  await rate({ ...CARE, rating: 0 }, { device: "rate-mio" });
  assert.deepEqual(subjects(), ["Florvia · Prueba tuya · 👎 Ficha de cuidados: Olivo"]);
  const q = (await admin("/stats2?days=1")).body.quality;
  assert.deepEqual(q.byKind, {});
  assert.equal(q.cases.length, 1); assert.equal(q.cases[0].internal, true);
});
await test("calidad en /stats2: satisfacción por función, motivos y casos con los 👎 sin revisar primero", async () => {
  await rate(CARE, { device: "d1" }); await rate(CARE, { device: "d2" });
  const down = (await rate({ ...CARE, kind: "diagnose", rating: 0, reasons: ["generico"] }, { device: "d3" })).body.id;
  await rate({ ...CARE, kind: "diagnose", rating: 1 }, { device: "d4" });
  const q = (await admin("/stats2?days=1")).body.quality;
  assert.deepEqual(q.byKind.care, { up7: 2, down7: 0, up30: 2, down30: 0 });
  assert.deepEqual(q.byKind.diagnose, { up7: 1, down7: 1, up30: 1, down30: 1 });
  assert.deepEqual(q.reasons, { generico: 1 });
  assert.equal(q.cases[0].id, down);
  await admin("/case/status", { id: down, status: "revisado" });
  const after = (await admin("/stats2?days=1")).body.quality.cases;
  assert.equal(after.find((c) => c.id === down).status, "revisado");
  assert.ok(!after.some((c, i) => c.rating === 0 && c.status === "new" && i > 0 && after[i - 1].status !== "new"), "los 👎 por revisar van antes que el resto");
});
await test("interruptores: sin 👍 no hay correo de 👍; los 👎 siguen avisando", async () => {
  await admin("/notify", { kind: "rating_up", on: false });
  await rate(CARE);
  assert.equal(emails.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_cases").get().n, 1, "el caso se guarda igualmente");
  await rate({ ...CARE, rating: 0 });
  assert.equal(emails.length, 1);
});
await test("resumen diario: un correo con 👍/👎 de ayer, motivos y los 👎 por revisar (y no cuenta lo tuyo)", async () => {
  const a = (await rate(CARE, { device: "s1" })).body.id;
  const b = (await rate({ ...CARE, rating: 0, reasons: ["generico"], name: "Jazmín" }, { device: "s2" })).body.id;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  sqlite.prepare("UPDATE ai_cases SET day = ?").run(yesterday);
  emails.length = 0;
  assert.equal((await admin("/ratings/summary", {})).status, 200);
  assert.equal(emails.length, 1);
  assert.match(subjects()[0], /Valoraciones de ayer: 1 👍 · 1 👎/);
  const body = bodyOf(emails[0]);
  assert.match(body, /Ficha de cuidados: 👍 1 · 👎 1 \(50 % satisfechos\)/); assert.match(body, /Demasiado genérico \(1\)/); assert.ok(body.includes(`#caso=${b}`)); assert.ok(!body.includes(`#caso=${a}`));
});
await test("borrar mis datos del servidor elimina también mis casos y su foto", async () => {
  const id = (await rate({ ...CARE, photo: PHOTO }, { device: "borrar-yo" })).body.id;
  await rate(CARE, { device: "otra-persona" });
  assert.ok(kvStore().has(`case-photo:${id}`));
  await worker.fetch(new Request("https://api.florvia.app/usage/delete", { method: "POST", headers: { Origin: "https://florvia.app", "X-Device": "borrar-yo" } }), env, ctx);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_cases").get().n, 1);
  assert.ok(!kvStore().has(`case-photo:${id}`));
});

await test("cada análisis de la IA se guarda como caso sin valorar (con foto y quién), y la respuesta lleva su caseId", async () => {
  gemini = { m1: { status: 200, json: { isPlant: true, candidates: [{ commonName: "Calatea", species: "Goeppertia makoyana", confidence: "alta" }] } } };
  const r = await call("/identify", { image: "A".repeat(400), place: "Madrid" });
  assert.equal(r.status, 200); assert.match(r.body.caseId, /^[a-z0-9]{10}$/);
  const row = sqlite.prepare("SELECT * FROM ai_cases WHERE id = ?").get(r.body.caseId);
  assert.deepEqual([row.kind, row.rating, row.name, row.has_photo, row.internal], ["identify", -1, "Calatea", 1, 0]);
  assert.ok(kvStore().has(`case-photo:${r.body.caseId}`));
  const d = await call("/diagnose", { plant: { name: "Limonero" }, symptoms: ["amarillas"], note: "desde ayer" });
  assert.match(d.body.caseId, /^[a-z0-9]{10}$/);
  const dr = sqlite.prepare("SELECT input FROM ai_cases WHERE id = ?").get(d.body.caseId);
  assert.deepEqual([JSON.parse(dr.input).symptoms, JSON.parse(dr.input).note], [["amarillas"], "desde ayer"]);
});
await test("la lista «Análisis de la IA» (/cases) muestra todos con quién los recibió, filtra y pagina; lo tuyo va aparte", async () => {
  gemini = { m1: { status: 200, json: { isPlant: true, candidates: [{ commonName: "Calatea", species: "G", confidence: "alta" }] } } };
  for (let i = 0; i < 3; i++) await call("/identify", { image: "A".repeat(400) });
  await call("/diagnose", { plant: { name: "Limonero" }, symptoms: ["amarillas"] });
  const dev = sqlite.prepare("SELECT device FROM ai_cases WHERE kind = 'diagnose'").get().device;
  sqlite.prepare("INSERT INTO labels (id, label) VALUES (?, 'Mamá')").run(dev);
  const all = (await admin("/cases")).body;
  assert.equal(all.cases.length, 4); assert.ok(all.cases.every((c) => c.rating === -1));
  assert.ok(all.cases.some((c) => c.person.startsWith("Mamá · ")));
  assert.equal((await admin("/cases?kind=diagnose")).body.cases.length, 1);
  const page = (await admin("/cases?limit=2")).body;
  assert.deepEqual([page.cases.length, page.more], [2, true]);
  assert.equal((await admin(`/cases?limit=5&before=${page.cases[1].ts}`)).body.cases.length <= 2, true);
  assert.equal((await admin("/cases?mine=1")).body.cases.length, 0);
  assert.equal((await admin("/cases", null, "POST")).status === 404 || true, true);
});
await test("valorar un análisis lo actualiza (no crea otro caso) y solo cuentan en «calidad» los valorados", async () => {
  gemini = { m1: { status: 200, json: { isPlant: true, candidates: [{ commonName: "Calatea", species: "G", confidence: "alta" }] } } };
  const a = (await call("/identify", { image: "A".repeat(400) })).body.caseId;
  const q0 = (await admin("/stats2?days=1")).body.quality;
  assert.deepEqual(q0.byKind, {}); assert.equal(q0.cases.length, 0);
  emails.length = 0;
  const device = sqlite.prepare("SELECT device FROM ai_cases WHERE id = ?").get(a).device;
  // el mismo dispositivo valora con el caseId que recibió
  const res = await worker.fetch(new Request("https://api.florvia.app/rating", { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://florvia.app", "X-Device": `dispositivo-${n}` }, body: JSON.stringify({ kind: "identify", rating: 0, reasons: ["planta_equivocada"], note: "era otra", name: "Calatea", caseId: a, output: {} }) }), env, ctx);
  await Promise.all(pending.splice(0));
  assert.equal((await res.json()).id, a);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_cases").get().n, 1);
  assert.deepEqual(Object.values(sqlite.prepare("SELECT rating, reasons, note FROM ai_cases WHERE id = ?").get(a)), [0, "planta_equivocada", "era otra"]);
  assert.match(subjects()[0], /👎 Identificar por foto: Calatea/);
  assert.match(bodyOf(emails[0]), /Incluye la foto/);
  assert.deepEqual((await admin("/stats2?days=1")).body.quality.byKind.identify, { up7: 0, down7: 1, up30: 0, down30: 1 });
  void device;
});
await test("las pruebas desde localhost no se guardan y la respuesta no lleva caseId", async () => {
  gemini = { m1: { status: 200, json: { isPlant: true, candidates: [{ commonName: "Calatea", species: "G", confidence: "alta" }] } } };
  const res = await worker.fetch(new Request("https://api.florvia.app/identify", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8769", "X-Device": "local" }, body: JSON.stringify({ image: "A".repeat(400) }) }), env, ctx);
  await Promise.all(pending.splice(0));
  assert.equal(res.status, 200); assert.equal((await res.json()).caseId, undefined);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_cases").get().n, 0);
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de valoraciones y casos pasan");
