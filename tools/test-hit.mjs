// Prueba de POST /hit y GET /stats/web (visitas a la web) contra el Worker real, con D1 simulada en SQLite en memoria.
// Uso: node tools/test-hit.mjs   (Node 22.13+; sale con código 1 si algo falla)
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// El Worker importa "cloudflare:email", que solo existe en Cloudflare: lo sustituimos por una clase vacía.
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

const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const PERSON = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
async function hit(body, { origin = "https://florvia.app", ua = PERSON, ip = "1.1.1.1", raw } = {}) {
  const headers = { "Content-Type": "text/plain", "User-Agent": ua, "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(new Request("https://api.florvia.app/hit", { method: "POST", headers, body: raw ?? JSON.stringify(body) }), env, ctx);
  await Promise.all(pending.splice(0));
  return res;
}
const stats = async () => (await worker.fetch(new Request("https://api.florvia.app/stats/web?days=1", { headers: { "X-Access-Code": "test-code", Origin: "https://florvia.app" } }), env, ctx)).json();

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); }
}

await test("una visita de persona se cuenta y responde 204", async () => {
  const r = await hit({ path: "/es/plantas/ficus/", ref: "www.google.com" });
  assert.equal(r.status, 204);
  const s = await stats();
  assert.equal(s.totals.person, 1);
  assert.deepEqual(s.pages, [{ path: "/es/plantas/ficus/", n: 1 }]);
  assert.deepEqual(s.sources, [{ src: "google", n: 1 }]);
});
await test("la visita también se cuenta en las horas del día (24 cubos, la última con la visita)", async () => {
  const res = await worker.fetch(new Request("https://api.florvia.app/stats/web?days=1", { headers: { "X-Access-Code": "test-code", Origin: "https://florvia.app" } }), env, ctx);
  const { hours } = await res.json();
  assert.equal(hours.length, 24);
  assert.equal(hours.reduce((a, h) => a + h.person, 0), 1);
  assert.equal(hours[23].person, 1);
});
await test("la misma persona, página y día no se cuenta dos veces", async () => {
  await hit({ path: "/es/plantas/ficus/" });
  assert.equal((await stats()).totals.person, 1);
});
await test("la misma persona en otra página sube la página pero no el total del sitio", async () => {
  await hit({ path: "/es/guias/" });
  const s = await stats();
  assert.equal(s.totals.person, 1);
  assert.equal(s.pages.length, 2);
});
await test("otra persona (otra IP) suma", async () => {
  await hit({ path: "/es/plantas/ficus/" }, { ip: "2.2.2.2" });
  assert.equal((await stats()).totals.person, 2);
});
await test("los robots se clasifican aparte y no cuentan como personas", async () => {
  await hit({ path: "/" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", ip: "3.3.3.3" });
  await hit({ path: "/" }, { ua: "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.1)", ip: "4.4.4.4" });
  await hit({ path: "/" }, { ua: "WhatsApp/2.23", ip: "5.5.5.5" });
  await hit({ path: "/" }, { ua: "curl/8.4.0", ip: "6.6.6.6" });
  await hit({ path: "/" }, { ua: "", ip: "7.7.7.7" });
  const t = (await stats()).totals;
  assert.deepEqual([t.person, t.search, t.ai, t.preview, t.bot], [2, 1, 1, 1, 2]);
});
await test("sin Origin de florvia.app no se cuenta (curl, localhost, web antigua)", async () => {
  const before = JSON.stringify((await stats()).totals);
  for (const origin of [null, "http://localhost:8769", "https://jnozaleda.github.io", "https://evil.example"]) {
    assert.equal((await hit({ path: "/es/guias/" }, { origin, ip: "8.8.8.8" })).status, 204);
  }
  assert.equal(JSON.stringify((await stats()).totals), before);
});
await test("rutas no permitidas y cuerpos rotos se ignoran sin error", async () => {
  const before = JSON.stringify((await stats()).totals);
  for (const path of ["/app/", "/privacidad/", "/es/plantas/../../etc", "/es/plantas/Ficus/", "//evil.com/", "x"]) {
    assert.equal((await hit({ path }, { ip: "9.9.9.9" })).status, 204);
  }
  assert.equal((await hit(null, { ip: "9.9.9.9", raw: "esto no es json" })).status, 204);
  assert.equal(JSON.stringify((await stats()).totals), before);
});
await test("«index.html» al final se normaliza a la carpeta", async () => {
  await hit({ path: "/es/guias/index.html" }, { ip: "10.0.0.1" });
  assert.ok((await stats()).pages.some((p) => p.path === "/es/guias/"));
});
await test("procedencias: interna se oculta, desconocida es «other», vacía es «direct»", async () => {
  await hit({ path: "/es/guias/", ref: "florvia.app" }, { ip: "11.0.0.1" });
  await hit({ path: "/es/guias/", ref: "chatgpt.com" }, { ip: "11.0.0.2" });
  await hit({ path: "/es/guias/", ref: "algun-blog.example" }, { ip: "11.0.0.3" });
  await hit({ path: "/es/guias/" }, { ip: "11.0.0.4" });
  const src = Object.fromEntries((await stats()).sources.map((x) => [x.src, x.n]));
  assert.equal(src.internal, undefined);
  assert.ok(src.ai >= 1 && src.other >= 1 && src.direct >= 1);
});
await test("el informe exige el código de acceso", async () => {
  const res = await worker.fetch(new Request("https://api.florvia.app/stats/web", { headers: { Origin: "https://florvia.app" } }), env, ctx);
  assert.equal(res.status, 401);
});
await test("no se guardan IP ni User-Agent en claro", async () => {
  const dump = JSON.stringify([...sqlite.prepare("SELECT * FROM pv_seen").all(), ...sqlite.prepare("SELECT * FROM pv_page").all(), ...sqlite.prepare("SELECT * FROM pv_site").all()]);
  for (const secret of ["1.1.1.1", "2.2.2.2", "iPhone", "Googlebot"]) assert.ok(!dump.includes(secret), `aparece «${secret}» en la base de datos`);
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de /hit pasan");
