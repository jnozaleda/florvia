// Prueba de las coordenadas escritas a mano (app/weather.js: parseCoords). Uso: node tools/test-coords.mjs
import assert from "node:assert/strict";
import { parseCoords } from "../app/weather.js";
let failed = 0;
function test(name, fn) { try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FALLA", name, "\n     ", e.message); } }
test("formato de Google Maps: «36.7213, -4.4214»", () => assert.deepEqual(parseCoords("36.7213, -4.4214"), { lat: 36.721, lon: -4.421 }));
test("separado por espacio o punto y coma", () => {
  assert.deepEqual(parseCoords("40.4168 -3.7038"), { lat: 40.417, lon: -3.704 });
  assert.deepEqual(parseCoords("40.4168; -3.7038"), { lat: 40.417, lon: -3.704 });
});
test("coma decimal española con punto y coma", () => assert.deepEqual(parseCoords("36,7213; -4,4214"), { lat: 36.721, lon: -4.421 }));
test("con grados y letras: 36.72°N 4.42°W y 33.9° S, 18.4° E", () => {
  assert.deepEqual(parseCoords("36.72°N 4.42°W"), { lat: 36.72, lon: -4.42 });
  assert.deepEqual(parseCoords("33.9° S, 18.4° E"), { lat: -33.9, lon: 18.4 });
});
test("lo inválido devuelve null", () => {
  for (const bad of ["", "Málaga", "91, 10", "10, 181", "36.7", "1;2;3", "abc, def", null, undefined]) assert.equal(parseCoords(bad), null, String(bad));
});
if (failed) { console.log(`\n${failed} prueba(s) fallan`); process.exit(1); }
console.log("\nTodas las pruebas de coordenadas pasan");
