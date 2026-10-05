// Prueba de los pagos con Polar: firma del webhook y cambios de plan (D1 simulada en SQLite). Uso: node tools/test-polar.mjs
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
const SECRET_RAW = "polar-test-secret-bytes";
const env = {
  DB: { prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.run())) },
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from(SECRET_RAW).toString("base64")}`,
  ALLOWED_ORIGINS: "https://florvia.app", POLAR_ACCESS_TOKEN: "x", POLAR_ENV: "sandbox",
  POLAR_PRODUCT_MONTHLY: "m-id", POLAR_PRODUCT_YEARLY: "y-id", POLAR_PRODUCT_LIFETIME: "l-id",
};
const ctx = { waitUntil: () => {} };
const GARDEN = "0123456789abcdef";

async function sign(body, { id = "msg_1", ts = Math.floor(Date.now() / 1000), key = Buffer.from(SECRET_RAW) } = {}) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${body}`))).toString("base64");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${mac}` };
}
async function hook(type, data, opts = {}) {
  const body = JSON.stringify({ type, data });
  const headers = opts.headers ?? (await sign(body, opts));
  return worker.fetch(new Request("https://api.florvia.app/polar/webhook", { method: "POST", headers, body }), env, ctx);
}
const ent = () => sqlite.prepare("SELECT plan, source, until FROM entitlements WHERE garden = ?").get(GARDEN) ?? null;
const customer = { external_id: GARDEN };

let failed = 0;
async function test(name, fn) { try { await fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

await test("una firma incorrecta se rechaza y no cambia nada", async () => {
  const r = await hook("order.paid", { product_id: "l-id", customer }, { headers: { "webhook-id": "x", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,AAAA" } });
  assert.equal(r.status, 401); assert.equal(ent(), null);
});
await test("una marca de tiempo vieja se rechaza", async () => {
  assert.equal((await hook("order.paid", { product_id: "l-id", customer }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
});
await test("un secreto antiguo (texto plano, sin whsec_) también se acepta", async () => {
  const saved = env.POLAR_WEBHOOK_SECRET; env.POLAR_WEBHOOK_SECRET = SECRET_RAW;
  try { assert.equal((await hook("subscription.active", { product_id: "m-id", status: "active", customer })).status, 200); } finally { env.POLAR_WEBHOOK_SECRET = saved; }
  assert.equal(ent().plan, "premium"); sqlite.exec("DELETE FROM entitlements");
});
await test("suscripción activa → Premium", async () => {
  assert.equal((await hook("subscription.active", { product_id: "y-id", status: "active", customer })).status, 200);
  assert.deepEqual({ ...ent() }, { plan: "premium", source: "polar", until: null });
});
await test("cancelada con fin futuro → sigue Premium hasta esa fecha", async () => {
  const end = new Date(Date.now() + 10 * 86400000).toISOString();
  await hook("subscription.canceled", { product_id: "y-id", status: "active", ends_at: end, customer });
  assert.equal(ent().plan, "premium"); assert.ok(ent().until > Date.now());
});
await test("revocada → vuelve a gratis", async () => {
  await hook("subscription.revoked", { product_id: "y-id", status: "canceled", customer });
  assert.equal(ent(), null);
});
await test("pago único «de por vida» → lifetime, y una suscripción no se lo quita", async () => {
  await hook("order.paid", { product_id: "l-id", status: "paid", customer });
  assert.equal(ent().plan, "lifetime");
  await hook("subscription.active", { product_id: "m-id", status: "active", customer });
  assert.equal(ent().plan, "lifetime");
  await hook("subscription.revoked", { product_id: "m-id", customer });
  assert.equal(ent().plan, "lifetime");
});
await test("el reembolso del pago único retira el plan", async () => {
  await hook("order.refunded", { product_id: "l-id", customer });
  assert.equal(ent(), null);
});
await test("producto desconocido o cliente sin garden se ignoran con 200", async () => {
  assert.equal((await hook("order.paid", { product_id: "otro", customer })).status, 200);
  assert.equal((await hook("order.paid", { product_id: "l-id", customer: { external_id: "no-valido" } })).status, 200);
  assert.equal(ent(), null);
});
await test("el garden también se lee de metadata si el cliente no lo trae", async () => {
  await hook("subscription.active", { product_id: "m-id", status: "active", customer: {}, metadata: { garden: GARDEN } });
  assert.equal(ent().plan, "premium");
});
await test("el checkout está cerrado para quien no es de los tuyos mientras sea sandbox", async () => {
  const r = await worker.fetch(new Request("https://api.florvia.app/polar/checkout", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://florvia.app", "X-Device": "d1", "X-Key": "ABCDEFGHJKLMNPQR" }, body: JSON.stringify({ choice: "monthly" }) }), env, ctx);
  assert.equal(r.status, 403);
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de Polar pasan");
