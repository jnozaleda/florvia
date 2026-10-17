// Prueba de las plantas de interior (app/rules.js): sin avisos del tiempo y sin lluvia. Uso: node tools/test-indoor.mjs
import assert from "node:assert/strict";
import { isIndoor, indoorGuess, weatherAlerts, weatherChecks, rainCredits, dueTasks, sunAdvice } from "../app/rules.js";

const TODAY = "2026-10-10";
const iso = (back) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
// Helada mañana (-3°), calor (38°), viento (80 km/h), lluvia ayer (12 mm) y mañana (10 mm)
const wx = { today: 7, days: Array.from({ length: 14 }, (_, i) => ({ date: iso(7 - i), max: i === 9 ? 38 : 22, min: i === 8 ? -3 : 12, rain: i === 6 ? 12 : i === 8 ? 10 : 0, rainProb: i === 8 ? 90 : 0, gust: i === 8 ? 80 : 10, code: 1, uv: 10 })) };
const seasons = { spring: { water: 4, feed: 0 }, summer: { water: 4, feed: 0 }, autumn: { water: 4, feed: 0 }, winter: { water: 4, feed: 0 } };
const plant = (id, name, extra = {}) => ({ id, name, rainReaches: true, inPot: true, frostSensitive: true, created: iso(30), seasons, ...extra });
const monstera = plant("m", "Monstera", { species: "Monstera deliciosa" });
const marked = plant("p", "Planta del salón", { indoor: true });
const olive = plant("o", "Olivo", { species: "Olea europaea" });
const fig = plant("h", "Higuera", { species: "Ficus carica" });
let failed = 0;
function test(name, fn) { try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

test("adivina interior por especie, género o nombre común", () => {
  assert.equal(indoorGuess(monstera), true);
  assert.equal(indoorGuess({ name: "Ficus del salón" }), true);
  assert.equal(indoorGuess({ name: "Mi planta", species: "Epipremnum aureum" }), true);
  assert.equal(indoorGuess({ name: "Orquídea" }), true);
});
test("no confunde las de exterior (la higuera es Ficus, pero no de interior)", () => {
  assert.equal(indoorGuess(olive), false);
  assert.equal(indoorGuess(fig), false);
  assert.equal(indoorGuess({ name: "Geranio" }), false);
});
test("el grupo manda sobre el nombre, y lo que elige la persona manda sobre todo", () => {
  assert.equal(indoorGuess({ name: "Ficus", group: "mediterraneas" }), false);
  assert.equal(isIndoor({ ...monstera, indoor: false }), false);
  assert.equal(isIndoor(marked), true);
});
test("avisos de helada, calor y viento: solo para las de fuera", () => {
  const a = weatherAlerts([monstera, marked, olive], wx, TODAY);
  assert.ok(a.length >= 2);
  for (const x of a) assert.ok(!/Monstera|Planta del salón/.test(x.text), x.text);
  assert.match(a.find((x) => x.icon === "🥶").text, /Olivo/);
});
test("con todas las plantas dentro, ningún aviso del tiempo", () => assert.deepEqual(weatherAlerts([monstera, marked], wx, TODAY), []));
test("comprobaciones de la semana (noches frías, calor): sin las de dentro", () => {
  for (const c of weatherChecks([monstera, marked, olive], wx, TODAY)) assert.ok(!c.plantIds.includes("m") && !c.plantIds.includes("p"));
});
test("la lluvia no riega a las de dentro", () => assert.deepEqual(rainCredits([monstera, marked, olive], [], wx, TODAY).map((c) => c.plantId), ["o"]));
test("su riego no espera a la lluvia ni se adelanta por el calor", () => {
  const t = dueTasks([monstera, olive], [], wx, TODAY, 40, 7).filter((x) => x.type === "water");
  assert.equal(t.find((x) => x.plant.id === "m").advice, null);
  assert.ok(t.find((x) => x.plant.id === "o").advice);
});
test("la luz se sigue comprobando dentro, pero sin el sol fuerte de fuera", () => {
  const shy = { ...marked, sunNeed: "shade", sunSensitive: true, sun: "sun" };
  const a = sunAdvice(shy, {}, wx);
  assert.ok(a && !/aprieta|fuerte ahora/.test(a.text), a?.text);
});

if (failed) { console.log(`\n${failed} pruebas fallan`); process.exit(1); }
console.log("\nTodas las pruebas de plantas de interior pasan");
