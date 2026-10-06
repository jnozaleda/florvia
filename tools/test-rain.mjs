// Prueba de la lluvia como riego (app/rules.js: rainCredits, dueTasks). Uso: node tools/test-rain.mjs
import assert from "node:assert/strict";
import { rainCredits, dueTasks } from "../app/rules.js";

const TODAY = "2026-10-10";
const iso = (back) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
// 7 past days (index 0 = 7 days ago … 6 = yesterday), today (7) and 6 more
const wx = (rainBy = {}, future = {}) => ({ today: 7, days: Array.from({ length: 14 }, (_, i) => ({ date: iso(7 - i), max: 22, min: 14, rain: i < 7 ? (rainBy[7 - i] ?? 0) : (future[i - 7] ?? 0), rainProb: i < 7 ? 0 : (future[i - 7] ? 90 : 0), gust: 10, code: 1, uv: 4 })) });
const seasons = { spring: { water: 4, feed: 0 }, summer: { water: 4, feed: 0 }, autumn: { water: 4, feed: 0 }, winter: { water: 4, feed: 0 } };
const out = { id: "a", name: "Lavanda", rainReaches: true, created: iso(30), seasons };
const covered = { id: "b", name: "Geranio", rainReaches: false, created: iso(30), seasons };
const drip = { id: "c", name: "Tomate", rainReaches: true, autoWater: true, created: iso(30), seasons };
const water = (plantId, back) => ({ id: `w${plantId}${back}`, plantId, type: "water", date: iso(back) });
let failed = 0;
function test(name, fn) { try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }

test("12 mm anteayer: la lluvia cuenta como riego de ese día, solo para la planta a la que le llega", () => {
  const c = rainCredits([out, covered, drip], [], wx({ 2: 12 }), TODAY);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].plantId, c[0].date, c[0].type, c[0].note, c[0].auto, c[0].mm], ["a", iso(2), "water", "Lluvia", true, 12]);
});
test("llovizna de 3 mm no cuenta", () => assert.equal(rainCredits([out], [], wx({ 1: 3 }), TODAY).length, 0));
test("si regaste después de la lluvia, no cuenta; si regaste antes, sí", () => {
  assert.equal(rainCredits([out], [water("a", 1)], wx({ 3: 10 }), TODAY).length, 0);
  assert.equal(rainCredits([out], [water("a", 5)], wx({ 3: 10 }), TODAY).length, 1);
});
test("regar el mismo día que llovió tampoco se duplica", () => assert.equal(rainCredits([out], [water("a", 3)], wx({ 3: 10 }), TODAY).length, 0));
test("varios días de lluvia: solo se anota el último", () => {
  const c = rainCredits([out], [], wx({ 5: 8, 2: 15 }), TODAY);
  assert.deepEqual(c.map((x) => x.date), [iso(2)]);
});
test("la lluvia de hoy (previsión) no se anota", () => assert.equal(rainCredits([out], [], wx({}, { 0: 20 }), TODAY).length, 0));
test("lo deshecho no vuelve (tombstone) y no se duplica lo ya anotado", () => {
  const id = `rain-a-${iso(2)}`;
  assert.equal(rainCredits([out], [], wx({ 2: 12 }), TODAY, { [id]: 1 }).length, 0);
  assert.equal(rainCredits([out], [{ id, plantId: "a", type: "water", date: iso(2) }], wx({ 2: 12 }), TODAY).length, 0);
});
test("lluvia anterior a que existiera la planta no cuenta", () => {
  assert.equal(rainCredits([{ ...out, created: iso(1) }], [], wx({ 3: 12 }), TODAY).length, 0);
});
test("efecto en el calendario: sin lluvia el riego está atrasado; con ella toca más adelante", () => {
  const log = [water("a", 6)]; // regada hace 6 días, cada 4: atrasada 2 días
  const before = dueTasks([out], log, wx({ 2: 12 }), TODAY, 40, 0);
  assert.equal(before.find((t) => t.type === "water").days, -2);
  const after = dueTasks([out], [...log, ...rainCredits([out], log, wx({ 2: 12 }), TODAY)], wx({ 2: 12 }), TODAY, 40, 0);
  assert.equal(after.find((t) => t.type === "water"), undefined); // próxima: iso(2)+4 = dentro de 2 días
});
test("el aviso de «ayer cayó» ya no sale en la tarea (lo resuelve el registro)", () => {
  const t = dueTasks([out], [water("a", 6)], wx({ 1: 12 }), TODAY, 40, 0).find((x) => x.type === "water");
  assert.equal(t.advice, null);
});
test("la lluvia prevista hoy o mañana sigue avisando", () => {
  const t = dueTasks([out], [water("a", 6)], wx({}, { 0: 9 }), TODAY, 40, 0).find((x) => x.type === "water");
  assert.equal(t.advice.kind, "skip"); assert.match(t.advice.text, /Se esperan 9 mm hoy/);
});

if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de lluvia pasan");
