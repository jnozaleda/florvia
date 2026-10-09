// Prueba de dos cosas de las fichas de cuidados: (1) la IA recibe la ficha de conocimiento del grupo de la planta (content/conocimiento) y nada
// cuando no se sabe el grupo; (2) una ficha con quejas (👎 o «Malo») se retira y se escribe de nuevo, con sus límites (bloqueadas, una vez al día,
// solo personas reales). Uso: node tools/test-knowledge-retire.mjs   (Node 22.13+; sale con código 1 si algo falla)
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) { return s === "cloudflare:email" ? { url: "data:text/javascript," + encodeURIComponent("export class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }"), shortCircuit: true } : next(s, c); }
`));
const { default: worker } = await import(new URL("../worker/src/worker.js", import.meta.url));
const { GROUPS, KNOWLEDGE_VERSION } = await import(new URL("../worker/src/knowledge.js", import.meta.url));

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
});
const kv = new Map();
const emails = [];
const env = {
  DB: { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) },
  CACHE: { get: async (k, type) => { const v = kv.get(k) ?? null; return type === "json" && v !== null ? JSON.parse(v) : v; }, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k), list: async () => ({ keys: [], list_complete: true }) },
  EMAIL: { send: async (m) => void emails.push(m) }, NOTIFY_EMAIL: "noza@example.com",
  ACCESS_CODE: "test-code", REQUIRE_CODE: "off", ALLOWED_ORIGINS: "https://florvia.app",
  PROVIDER: "gemini:m1", GEMINI_API_KEY: "k", GEMINI_MODEL: "m1", DAILY_LIMIT: "1000", IP_DAILY_LIMIT: "1000",
};
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

// Gemini simulado: responde la ficha de `answer` y guarda el prompt.
let answer = {};
let prompts = [];
globalThis.fetch = async (url, init) => {
  if (!/generativelanguage/.test(String(url))) throw new Error(`fetch inesperado: ${url}`);
  prompts.push(String(init?.body ?? ""));
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
};
const sheetOf = (commonName, species) => ({ isPlant: true, commonName, species, confidence: "alta", sunNeed: "media", sunSensitive: false, frostSensitive: true, minTemp: 0, climateFit: "bien", climateNote: "Bien.",
  water_spring: 7, water_summer: 4, water_autumn: 8, water_winter: 14, feed_spring: 30, feed_summer: 30, feed_autumn: 0, feed_winter: 0, notes: "nota" });
const CAL = { tasks: [{ title: "Podar ramas secas", months: [2] }], risks: [] };

const post = async (path, body, { device = "persona-1", code = false } = {}) => {
  const res = await worker.fetch(new Request(`https://api.florvia.app${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "CF-Connecting-IP": "9.9.9.9", "X-Device": device, ...(code ? { "X-Access-Code": "test-code" } : {}) }, body: JSON.stringify(body) }), env, ctx);
  await Promise.all(pending.splice(0));
  return { status: res.status, body: await res.json() };
};
const ask = (name, species, device) => { answer = sheetOf(name, species); prompts = []; return post("/care", { name, lat: 40.4, lon: -3.7, place: "Madrid" }, { device }); };
const rate = (r, reasons, device) => post("/rating", { kind: "care", rating: 0, reasons, name: r.body.commonName, caseId: r.body.caseId }, { device });
const parent = (sk) => sqlite.prepare("SELECT data, locked FROM species_parent WHERE species = ?").get(sk);
const retired = (sk) => sqlite.prepare("SELECT why, by FROM species_retired WHERE species = ? ORDER BY id").all(sk).map((r) => `${r.why}/${r.by}`);
const subjects = () => emails.splice(0).map((m) => { const b = m.raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1]; return b ? Buffer.from(b, "base64").toString("utf8") : ""; });
const block = () => prompts.join("").includes("CONOCIMIENTO GENERAL DEL GRUPO");

let failed = 0;
async function test(name, fn) { try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

// ---------- 1. Conocimiento por grupo ----------
await test("el limonero recibe la ficha del grupo «Cítricos» y la ficha lo apunta", async () => {
  const r = await ask("Limonero", "Citrus limon");
  assert.ok(block(), "sin bloque de grupo");
  assert.ok(prompts[0].includes("Cítricos y frutales en maceta"));
  assert.equal(JSON.parse(parent("citrus limon").data).knowledge, `citricos@${KNOWLEDGE_VERSION}`);
  assert.equal(r.status, 200);
});
await test("un nombre científico encuentra el grupo por su género (Aspidistra → interior)", async () => {
  await ask("Aspidistra elatior", "Aspidistra elatior");
  assert.ok(prompts[0].includes("Plantas de interior"));
});
await test("una especie concreta gana a su género: Dracaena trifasciata es suculenta", async () => {
  await ask("Dracaena trifasciata", "Dracaena trifasciata");
  assert.ok(prompts[0].includes("Suculentas y cactus"));
});
await test("una planta sin grupo conocido no recibe ninguna pauta de grupo", async () => {
  await ask("Planta rarísima", "Rarissima planta");
  assert.ok(!block());
  assert.equal(JSON.parse(parent("rarissima planta").data).knowledge, undefined);
});
await test("«rosa del desierto» no pasa por un rosal (tres palabras: no se mira el género)", async () => {
  await ask("Rosa del desierto", "Adenium obesum");
  assert.ok(!block());
});
await test("la higuera (Ficus carica) no cae en «interior» por ser un Ficus", async () => {
  await ask("Ficus carica", "Ficus carica");
  assert.ok(!block());
});
await test("el calendario del año también recibe la ficha del grupo", async () => {
  answer = CAL; prompts = [];
  await post("/calendar", { name: "Romero", lat: 40.4, lon: -3.7, place: "Madrid" });
  assert.ok(prompts[0].includes("Mediterráneas de sol y poco riego"));
});
await test("cada grupo ocupa menos de 1.400 caracteres en el prompt", () => {
  for (const [g, v] of Object.entries(GROUPS)) assert.ok(v.text.length <= 1400, `${g}: ${v.text.length}`);
});

// ---------- 2. Retirada de fichas con quejas ----------
let first;
await test("un 👎 «Consejo dudoso» retira la ficha y avisa a Noza", async () => {
  first = await ask("Monstera", "Monstera deliciosa", "persona-1");
  subjects();
  await rate(first, ["consejo_dudoso"], "persona-1");
  assert.equal(parent("monstera deliciosa"), undefined);
  assert.deepEqual(retired("monstera deliciosa"), ["consejo_dudoso/auto"]);
  assert.ok(subjects().some((s) => s.includes("Ficha retirada")));
});
let second;
await test("la siguiente petición escribe la ficha de nuevo con la IA", async () => {
  second = await ask("Monstera", "Monstera deliciosa", "persona-2");
  assert.equal(prompts.length, 1);
  assert.ok(parent("monstera deliciosa"));
});
await test("como mucho una retirada por especie y día", async () => {
  await rate(second, ["consejo_dudoso"], "persona-2");
  assert.ok(parent("monstera deliciosa"));
  assert.equal(retired("monstera deliciosa").length, 1);
});
await test("un 👎 sin motivo grave no basta; el de una segunda persona sí", async () => {
  const a = await ask("Hortensia", "Hydrangea macrophylla", "persona-3");
  await rate(a, ["generico"], "persona-3");
  assert.ok(parent("hydrangea macrophylla"), "retirada con un solo 👎");
  const b = await ask("Hortensia", "Hydrangea macrophylla", "persona-4");
  await rate(b, ["generico"], "persona-4");
  assert.equal(parent("hydrangea macrophylla"), undefined);
  assert.deepEqual(retired("hydrangea macrophylla"), ["dos_negativas/auto"]);
});
await test("dos 👎 de la misma persona cuentan como uno", async () => {
  const a = await ask("Geranio", "Pelargonium hortorum", "persona-5");
  await rate(a, ["generico"], "persona-5");
  const b = await ask("Geranio", "Pelargonium hortorum", "persona-5");
  await rate(b, ["otro"], "persona-5");
  assert.ok(parent("pelargonium hortorum"));
});
await test("los 👎 de los dispositivos de Noza no retiran nada solos", async () => {
  const hash = createHash("sha256").update("mj:noza-movil").digest("hex").slice(0, 12);
  sqlite.prepare("INSERT INTO internal (id, ts) VALUES (?, 0)").run(hash);
  const a = await ask("Buganvilla", "Bougainvillea glabra", "noza-movil");
  await rate(a, ["consejo_dudoso"], "noza-movil");
  assert.ok(parent("bougainvillea glabra"));
});
await test("una ficha bloqueada no se retira: llega un correo para revisarla", async () => {
  const a = await ask("Lavanda", "Lavandula angustifolia", "persona-6");
  sqlite.prepare("UPDATE species_parent SET locked = 1, status = 'bloqueada' WHERE species = 'lavandula angustifolia'").run();
  subjects();
  await rate(a, ["planta_equivocada"], "persona-6");
  assert.ok(parent("lavandula angustifolia"));
  assert.ok(subjects().some((s) => s.includes("bloqueada con quejas")));
});
await test("«Malo» de Noza retira la ficha aunque el caso sea suyo y sin 👎", async () => {
  const a = await ask("Jazmín", "Jasminum officinale", "noza-movil");
  const res = await post("/case/status", { id: a.body.caseId, status: "malo" }, { code: true });
  assert.equal(res.body.retired?.why, "malo");
  assert.deepEqual(retired("jasminum officinale"), ["malo/noza"]);
});
await test("«Malo» en un caso anterior a la ficha actual no la toca", async () => {
  await ask("Monstera", "Monstera deliciosa", "persona-7"); // la ficha escrita de nuevo sigue
  const res = await post("/case/status", { id: first.body.caseId, status: "malo" }, { code: true });
  assert.equal(res.body.retired?.why, "ya_regenerada");
  assert.ok(parent("monstera deliciosa"));
});
await test("«Planta equivocada» olvida a qué especie apunta ese nombre", async () => {
  const a = await ask("Romero", "Salvia rosmarinus", "persona-8");
  assert.ok(sqlite.prepare("SELECT 1 FROM species_alias WHERE name = 'romero'").get());
  await rate(a, ["planta_equivocada"], "persona-8");
  assert.equal(sqlite.prepare("SELECT 1 FROM species_alias WHERE name = 'romero'").get(), undefined);
  assert.equal(parent("salvia rosmarinus"), undefined);
});
await test("un 👎 a otra cosa que no es una ficha (identificación) no retira nada", async () => {
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM species_retired").get().n;
  await post("/rating", { kind: "identify", rating: 0, reasons: ["planta_equivocada"], name: "Geranio", output: { species: "Pelargonium hortorum" } }, { device: "persona-9" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM species_retired").get().n, before);
});

// ---------- 3. Fichas escritas con información antigua ----------
const setFp = (sk, fp) => {
  for (const t of ["species_parent", "species_child"]) {
    for (const r of sqlite.prepare(`SELECT rowid, data FROM ${t} WHERE species = ?`).all(sk)) {
      const d = JSON.parse(r.data); d[t === "species_parent" ? "fp" : "fpc"] = fp;
      sqlite.prepare(`UPDATE ${t} SET data = ? WHERE rowid = ?`).run(JSON.stringify(d), r.rowid);
    }
  }
};
const refreshes = () => sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'ai' AND name = 'care_refresh'").get().n;
await test("una ficha escrita con información antigua se escribe de nuevo al pedirla, y no cuenta en el cupo de la persona", async () => {
  await ask("Calamondín", "Citrofortunella microcarpa", "persona-10");
  setFp("citrofortunella microcarpa", "viejo");
  const before = refreshes();
  answer = { ...sheetOf("Calamondín", "Citrofortunella microcarpa"), notes: "nota nueva" }; prompts = [];
  const r = await post("/care", { name: "Calamondín", lat: 40.4, lon: -3.7, place: "Madrid" }, { device: "persona-11" });
  assert.equal(r.body.notes, "nota nueva");
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes("Cítricos y frutales"));
  assert.equal(refreshes(), before + 1);
  assert.notEqual(JSON.parse(parent("citrofortunella microcarpa").data).fp, "viejo");
});
await test("como mucho una puesta al día por especie, zona y día", async () => {
  setFp("citrofortunella microcarpa", "viejo");
  answer = { ...sheetOf("Calamondín", "Citrofortunella microcarpa"), notes: "otra más" }; prompts = [];
  const r = await post("/care", { name: "Calamondín", lat: 40.4, lon: -3.7, place: "Madrid" }, { device: "persona-12" });
  assert.equal(prompts.length, 0);
  assert.equal(r.body.cached, true);
});
await test("una ficha sin referencia ni grupo no se rehace aunque no tenga huella", async () => {
  await ask("Zelkova", "Zelkova serrata", "persona-13");
  setFp("zelkova serrata", undefined);
  prompts = [];
  await post("/care", { name: "Zelkova", lat: 40.4, lon: -3.7, place: "Madrid" }, { device: "persona-14" });
  assert.equal(prompts.length, 0);
});
await test("si la IA responde otra especie, se sigue sirviendo la ficha guardada", async () => {
  await ask("Naranjo", "Citrus sinensis", "persona-15");
  setFp("citrus sinensis", "viejo");
  answer = sheetOf("Mandarino", "Citrus reticulata"); prompts = [];
  const r = await post("/care", { name: "Naranjo", lat: 40.4, lon: -3.7, place: "Madrid" }, { device: "persona-16" });
  assert.equal(prompts.length, 1);
  assert.equal(r.body.species, "Citrus sinensis");
});
await test("una ficha bloqueada con información nueva no se toca: correo a Noza y solo se renueva la parte de la zona", async () => {
  await ask("Tomillo", "Thymus vulgaris", "persona-17");
  sqlite.prepare("UPDATE species_parent SET locked = 1, status = 'bloqueada' WHERE species = 'thymus vulgaris'").run();
  setFp("thymus vulgaris", "viejo");
  const lockedData = parent("thymus vulgaris").data;
  subjects();
  answer = { ...sheetOf("Tomillo", "Thymus vulgaris"), notes: "intento", water_spring: 3 }; prompts = [];
  const r = await post("/care", { name: "Tomillo", lat: 40.4, lon: -3.7, place: "Madrid" }, { device: "persona-18" });
  assert.equal(parent("thymus vulgaris").data, lockedData, "el padre bloqueado no cambia");
  assert.equal(r.body.notes, "nota");
  assert.equal(r.body.seasons.spring.water, 3, "la parte de la zona sí se renueva");
  assert.ok(subjects().some((x) => x.includes("información nueva de una ficha bloqueada")));
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de conocimiento y retirada pasan");
