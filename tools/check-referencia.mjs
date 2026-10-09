// Comprueba content/referencia/plantas.json: que cada planta mantenga su procedencia (fuentes con enlace, tipo y lo verificado/pendiente) y que
// las decisiones del «contraste» estén bien formadas. Uso: node tools/check-referencia.mjs   (sale con código 1 si hay errores)
import { readFileSync } from "node:fs";

const file = new URL("../content/referencia/plantas.json", import.meta.url);
const doc = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const REQUIRED = ["id", "nombre_comun", "nombre_cientifico", "ubicacion", "dificultad", "luz", "temperatura", "estaciones", "toxicidad", "fuentes", "verificacion"];
const SEASONS = ["primavera", "verano", "otono", "invierno"];
const ESTADOS = ["propuesta", "confirmado", "sin_fuente"];

for (const k of ["version", "fecha", "ambito", "notas", "historial", "plantas"]) if (!(k in doc)) err("documento", `falta «${k}»`);
if (!/^\d+\.\d+$/.test(String(doc.version))) err("documento", "«version» debe ser tipo 0.3");
if (!Array.isArray(doc.historial) || doc.historial.at(-1)?.version !== doc.version) err("documento", "el último «historial» debe ser la versión actual");

const ids = new Set();
for (const p of doc.plantas ?? []) {
  const id = p.id ?? "(sin id)";
  if (ids.has(id)) err(id, "id repetido");
  ids.add(id);
  if (!/^[a-z0-9-]+$/.test(id)) err(id, "el id solo lleva minúsculas, números y guiones");
  for (const k of REQUIRED) if (!(k in p)) err(id, `falta «${k}»`);
  for (const s of SEASONS) if (!p.estaciones?.[s]?.riego) err(id, `falta el riego de ${s}`);
  if (!Array.isArray(p.fuentes) || !p.fuentes.length) err(id, "sin fuentes");
  for (const f of p.fuentes ?? []) {
    if (!/^https:\/\/[^\s]+$/.test(f.url ?? "")) err(id, `fuente sin enlace https: «${f.titulo ?? "?"}»`);
    if (!f.titulo || !f.tipo) err(id, `fuente sin título o tipo: ${f.url ?? "?"}`);
  }
  if (new Set((p.fuentes ?? []).map((f) => f.url)).size !== (p.fuentes ?? []).length) err(id, "fuentes con el mismo enlace repetido");
  if (!Array.isArray(p.verificacion?.verificado) || !Array.isArray(p.verificacion?.pendiente)) err(id, "«verificacion» necesita las listas «verificado» y «pendiente»");
  for (const c of p.contraste ?? []) {
    if (!c.dato || !c.decision) err(id, "una fila de «contraste» sin dato o decisión");
    if (!ESTADOS.includes(c.estado)) err(id, `«contraste» «${c.dato}»: estado «${c.estado}» no válido (${ESTADOS.join(", ")})`);
    if (!c.fuentes || !Object.keys(c.fuentes).length) err(id, `«contraste» «${c.dato}»: sin fuentes`);
  }
}

// Fichas parciales: solo unos datos de una fuente de confianza (la IA completa el resto).
for (const p of doc.parciales ?? []) {
  const id = p.id ?? "(sin id)";
  if (ids.has(id)) err(id, "id repetido");
  ids.add(id);
  if (!/^[a-z0-9-]+$/.test(id)) err(id, "el id solo lleva minúsculas, números y guiones");
  for (const k of ["nombre_comun", "nombre_cientifico", "datos", "fuentes"]) if (!(k in p)) err(id, `falta «${k}»`);
  if (!Array.isArray(p.datos) || !p.datos.length || p.datos.some((x) => typeof x !== "string" || !x.trim())) err(id, "«datos» debe ser una lista de frases");
  if (!Array.isArray(p.fuentes) || !p.fuentes.length) err(id, "sin fuentes");
  for (const f of p.fuentes ?? []) {
    if (!/^https:\/\/[^\s]+$/.test(f.url ?? "")) err(id, `fuente sin enlace https: «${f.titulo ?? "?"}»`);
    if (!f.titulo || !f.tipo) err(id, `fuente sin título o tipo: ${f.url ?? "?"}`);
  }
}

const sources = doc.plantas.reduce((a, p) => a + p.fuentes.length, 0);
const pending = doc.plantas.reduce((a, p) => a + (p.verificacion?.pendiente?.length ?? 0), 0);
const contrasted = doc.plantas.filter((p) => p.contraste?.length).length;
if (errors.length) { console.log(errors.map((e) => `ERROR ${e}`).join("\n")); console.log(`\n${errors.length} error(es)`); process.exit(1); }
console.log(`Fichas de referencia v${doc.version}: ${doc.plantas.length} plantas · ${(doc.parciales ?? []).length} parciales · ${sources} fuentes · ${pending} puntos pendientes · ${contrasted} con contraste entre fuentes`);
