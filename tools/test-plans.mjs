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
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.run())) }, ALLOWED_ORIGINS: "https://florvia.app", ACCESS_CODE: "adm" };
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

// ---- códigos de amigos y familia
const call = async (path, body, { device = "d-x", key, admin = false, method = "POST" } = {}) => {
  const headers = { Origin: "https://florvia.app", "Content-Type": "application/json", "X-Device": device };
  if (key) headers["X-Key"] = key;
  if (admin) headers["X-Access-Code"] = "adm";
  const r = await worker.fetch(new Request(`https://api.florvia.app${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }), env, ctx);
  return { status: r.status, body: await r.json() };
};
let CODE = "";
await test("sin el código de acceso no se pueden crear ni listar códigos", async () => {
  assert.equal((await call("/invites", { label: "x" })).status, 401);
  assert.equal((await call("/invites", null, { method: "GET" })).status, 401);
});
await test("se crea un código de 8 letras para 1 persona", async () => {
  const r = await call("/invites", { label: "Ana", maxUses: 1 }, { admin: true });
  assert.equal(r.status, 200); CODE = r.body.code; assert.match(CODE, /^[A-Z2-9]{8}$/);
});
await test("canjear necesita un email válido y un código que exista", async () => {
  assert.equal((await call("/invite/redeem", { code: CODE, email: "no-es-email" }, { device: "amiga" })).status, 400);
  assert.equal((await call("/invite/redeem", { code: "ZZZZZZZZ", email: "ana@example.com" }, { device: "amiga" })).status, 404);
});
await test("canjear da Premium sin pagar y guarda el email", async () => {
  seen("amiga", 90);
  const r = await call("/invite/redeem", { code: CODE.toLowerCase(), email: "Ana@Example.com" }, { device: "amiga" });
  assert.equal(r.status, 200);
  const m = await me("amiga");
  assert.equal(m.plan, "premium"); assert.equal(m.source, "invite");
  assert.equal(sqlite.prepare("SELECT email FROM invite_uses WHERE code = ?").get(CODE).email, "ana@example.com");
});
await test("canjear dos veces en el mismo dispositivo no gasta otro uso", async () => {
  assert.equal((await call("/invite/redeem", { code: CODE, email: "ana@example.com" }, { device: "amiga" })).status, 200);
  assert.equal(sqlite.prepare("SELECT uses FROM invites WHERE code = ?").get(CODE).uses, 1);
});
await test("un código de 1 uso no sirve a otra persona", async () => {
  assert.equal((await call("/invite/redeem", { code: CODE, email: "otro@example.com" }, { device: "otra" })).status, 409);
});
await test("si luego sincroniza el jardín, sigue siendo Premium", async () => {
  const m = await me("amiga", "QRSTUVWXYZABCDEF");
  assert.equal(m.plan, "premium");
});
await test("el listado enseña el código y quién lo usó", async () => {
  const r = await call("/invites", null, { admin: true, method: "GET" });
  assert.equal(r.body.codes[0].code, CODE); assert.equal(r.body.uses[0].email, "ana@example.com");
});
await test("retirar el acceso de una persona la devuelve a gratis (tras la prueba)", async () => {
  const r = await call("/invites/revoke", { code: CODE, email: "ana@example.com" }, { admin: true });
  assert.equal(r.body.removed, 1);
  assert.equal((await me("amiga")).plan, "free");
});
await test("retirar un código lo apaga: ya no se puede canjear", async () => {
  const r2 = await call("/invites", { label: "Grupo", maxUses: 5 }, { admin: true });
  const c2 = r2.body.code;
  await call("/invite/redeem", { code: c2, email: "b@example.com" }, { device: "b" });
  await call("/invite/redeem", { code: c2, email: "c@example.com" }, { device: "c" });
  assert.equal((await call("/invites/revoke", { code: c2 }, { admin: true })).body.removed, 2);
  assert.equal((await call("/invite/redeem", { code: c2, email: "d@example.com" }, { device: "d" })).status, 404);
});
await test("un código con duración limitada da Premium hasta esa fecha", async () => {
  const c = (await call("/invites", { label: "Mes", maxUses: 1, accessDays: 30 }, { admin: true })).body.code;
  seen("temporal", 90);
  const r = await call("/invite/redeem", { code: c, email: "t@example.com" }, { device: "temporal" });
  assert.ok(r.body.until > Date.now() && r.body.until < Date.now() + 31 * 86400000);
  const m = await me("temporal");
  assert.equal(m.plan, "premium"); assert.equal(m.source, "invite");
  assert.ok(m.accessUntil > Date.now() && m.accessUntil <= Date.now() + 30 * 86400000);
});
await test("la persona puede dejar el código: vuelve a gratis y el código recupera su uso", async () => {
  const c = (await call("/invites", { label: "Salir", maxUses: 1 }, { admin: true })).body.code;
  seen("saliente", 90);
  assert.equal((await call("/invite/redeem", { code: c, email: "s@example.com" }, { device: "saliente" })).status, 200);
  assert.equal((await me("saliente")).plan, "premium");
  assert.equal((await call("/invite/leave", {}, { device: "saliente" })).body.left, 1);
  assert.equal((await me("saliente")).plan, "free");
  assert.equal(sqlite.prepare("SELECT uses FROM invites WHERE code = ?").get(c).uses, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM invite_uses WHERE code = ?").get(c).n, 0);
  assert.equal((await call("/invite/redeem", { code: c, email: "otra@example.com" }, { device: "otro-movil" })).status, 200);
});
await test("el dueño edita un código: nombre, usos, duración (también a quien ya lo usa) y apagado", async () => {
  const c = (await call("/invites", { label: "Editable", maxUses: 2, accessDays: 30 }, { admin: true })).body.code;
  seen("editado", 90);
  await call("/invite/redeem", { code: c, email: "e@example.com" }, { device: "editado" });
  const until0 = sqlite.prepare("SELECT until FROM entitlements WHERE note = ?").get(`invite:${c}`).until;
  assert.equal((await call("/invites/update", { code: c, label: "Nuevo", accessDays: 100 })).status, 401);
  assert.equal((await call("/invites/update", { code: c, label: "Nuevo", maxUses: 5, accessDays: 100 }, { admin: true })).status, 200);
  const row = sqlite.prepare("SELECT label, max_uses, access_days FROM invites WHERE code = ?").get(c);
  assert.deepEqual({ ...row }, { label: "Nuevo", max_uses: 5, access_days: 100 });
  assert.ok(sqlite.prepare("SELECT until FROM entitlements WHERE note = ?").get(`invite:${c}`).until > until0 + 60 * 86400000);
  assert.equal((await call("/invites/update", { code: c, accessDays: null }, { admin: true })).status, 200);
  assert.equal(sqlite.prepare("SELECT until FROM entitlements WHERE note = ?").get(`invite:${c}`).until, null);
  assert.equal((await call("/invites/update", { code: c, active: false }, { admin: true })).status, 200);
  assert.equal((await call("/invite/redeem", { code: c, email: "x@example.com" }, { device: "otro-x" })).status, 404);
  assert.equal((await call("/invites/update", { code: c, active: true }, { admin: true })).status, 200);
  assert.equal((await call("/invite/redeem", { code: c, email: "x@example.com" }, { device: "otro-x" })).status, 200);
  assert.equal((await call("/invites/update", { code: c, maxUses: 1 }, { admin: true })).status, 400); // ya lo usan 2
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de planes pasan");
