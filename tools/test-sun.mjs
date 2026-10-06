// Prueba de la alerta de sol según el lugar (app/rules.js: sunStrength, sunAdvice, weatherChecks). Uso: node tools/test-sun.mjs
import assert from "node:assert/strict";
import { sunStrength, sunAdvice, weatherChecks } from "../app/rules.js";

const wx = (uv, max = 25) => ({ today: 2, days: Array.from({ length: 9 }, (_, i) => ({ date: `2026-07-${String(10 + i).padStart(2, "0")}`, max, min: 15, rain: 0, rainProb: 0, gust: 10, code: 0, uv })) });
const maple = { id: "m", name: "Arce japonés", sunSensitive: true, sunNeed: "partial", sun: "sun" };
let failed = 0;
function test(name, fn) { try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

test("el UV manda: 9 es extremo, 6 fuerte, 4 medio, 1 bajo", () => {
  assert.equal(sunStrength(wx(9)).level, "extreme"); assert.equal(sunStrength(wx(6)).level, "high");
  assert.equal(sunStrength(wx(4)).level, "mid"); assert.equal(sunStrength(wx(1)).level, "low");
});
test("sin UV se usa la temperatura máxima", () => {
  assert.equal(sunStrength(wx(null, 36)).level, "extreme"); assert.equal(sunStrength(wx(null, 12)).level, "low");
});
test("sin previsión no hay corrección: queda el aviso de siempre", () => {
  const a = sunAdvice(maple, {}, null);
  assert.equal(a.level, "no"); assert.match(a.text, /mejor en sombra\.$/);
});
test("Málaga en verano (UV 9): arce en pleno sol = urgente y lo dice", () => {
  const a = sunAdvice(maple, {}, wx(9));
  assert.equal(a.level, "no"); assert.match(a.text, /aprieta mucho.*UV 9.*quemarán/);
});
test("norte o invierno (UV 1): el mismo arce es solo un aviso suave", () => {
  const a = sunAdvice(maple, {}, wx(1));
  assert.equal(a.level, "warn"); assert.match(a.text, /sol es suave.*en verano le quemará/);
});
test("sensible a media sombra: con sol débil sin aviso, con sol normal aviso y con sol extremo urgente", () => {
  const half = { ...maple, sun: "partial" };
  assert.equal(sunAdvice(half, {}, wx(1)), null);
  assert.equal(sunAdvice(half, {}, wx(4)).level, "warn");
  assert.equal(sunAdvice(half, {}, wx(9)).level, "no");
});
test("a la sombra no avisa nunca, haga el sol que haga", () => assert.equal(sunAdvice({ ...maple, sun: "shade" }, {}, wx(10)), null));
test("planta de pleno sol en pleno sol: no avisa (no es exceso)", () => assert.equal(sunAdvice({ id: "l", name: "Lavanda", sunNeed: "sun", sun: "sun" }, {}, wx(10)), null));
test("alerta del jardín: UV ≥ 8 sin calor extremo también pide sombra para la sensible", () => {
  const c = weatherChecks([maple], wx(9, 26), "2026-07-12", {}).find((x) => x.kind === "heat");
  assert.ok(c); assert.match(c.title, /Sol muy fuerte.*UV 9/);
});
test("alerta del jardín: con UV 3 y 26° no sale", () => assert.equal(weatherChecks([maple], wx(3, 26), "2026-07-12", {}).find((x) => x.kind === "heat"), undefined));

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de sol pasan");
