// Genera, a partir de content/referencia/plantas.json, worker/src/species-seed.js (sinónimos científicos y nombres comunes) y
// worker/src/reference-context.js (el texto de referencia de cada especie, que el Worker da a la IA al generar su ficha).
// Uso: node tools/build-species-seed.mjs          → escribe el archivo
//      node tools/build-species-seed.mjs --check  → sale con código 1 si el archivo no está al día (se usa en las pruebas)
import { readFileSync, writeFileSync } from "node:fs";
import { rawSpeciesKey, normName } from "../worker/src/species.js";

// species.js importa species-seed.js, que aún puede no existir o estar viejo: aquí solo se usan las funciones de normalización puras.
const doc = JSON.parse(readFileSync(new URL("../content/referencia/plantas.json", import.meta.url), "utf8"));
const OUT = new URL("../worker/src/species-seed.js", import.meta.url);
const OUT_CONTEXT = new URL("../worker/src/reference-context.js", import.meta.url);

// Nombres comunes que NO se siembran: cubren varias plantas distintas y servirían la ficha equivocada.
const AMBIGUOUS = new Set(["ficus", "orquidea", "hydrangea", "menta", "crassula"]);
// Añadidos a mano (no están en plantas.json). Cada uno, con el motivo.
const EXTRA_SYNONYMS = {
  "pelargonium zonale": "pelargonium hortorum", // nombre con el que la IA suele devolver el geranio común
  "lycopersicon esculentum": "solanum lycopersicum", // nombre antiguo del tomate
  "scindapsus aureus": "epipremnum aureum", // nombre antiguo del potos
  "crassula argentea": "crassula ovata", // sinónimo habitual del árbol de jade
  "crassula portulacea": "crassula ovata", // ídem
  "aloe barbadensis": "aloe vera", // sinónimo habitual del aloe vera
  "rosa hybrida": "rosa", // la ficha cubre «Rosa spp.»: el rosal común que devuelve la IA
  "phalaenopsis amabilis": "phalaenopsis", // la ficha cubre «Phalaenopsis spp.»
  "phalaenopsis hybrid": "phalaenopsis",
};
const EXTRA_ALIASES = {
  "limon": "citrus limon", "tomatero": "solanum lycopersicum", "sansevieria": "dracaena trifasciata",
};

const synonyms = {};
const aliases = {};
const notes = [];
const canonicalOf = {};
const speciesOf = (text, genus) => {
  // «L. x intermedia» / «B. spectabilis»: la inicial abrevia el género de la primera especie.
  const t = text.trim().replace(/^([A-Z])\.\s+/, (_, l) => `${genus} `.startsWith(l) ? `${genus} ` : `${l}. `);
  return rawSpeciesKey(t);
};

// Las fichas completas («plantas») y las parciales («parciales»: solo unos datos de una fuente de confianza) se tratan igual para nombres y sinónimos.
const all = [...doc.plantas, ...(doc.parciales ?? [])];
for (const p of all) {
  // Parte «(antes X)», «(Aloe barbadensis)», «(y otras Mentha)» aparte del nombre principal.
  const sci = p.nombre_cientifico;
  const paren = [...sci.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const main = sci.replace(/\([^)]*\)/g, "").trim();
  const parts = main.split("/").map((s) => s.trim()).filter(Boolean);
  const genus = parts[0].split(/\s+/)[0];
  const canonical = rawSpeciesKey(parts[0]);
  if (!canonical) throw new Error(`${p.id}: sin especie en «${sci}»`);
  if (Object.values(canonicalOf).includes(canonical)) throw new Error(`${p.id}: «${canonical}» ya tiene otra ficha`);
  canonicalOf[p.id] = canonical;
  // Varias especies en la misma ficha: todas apuntan a la primera.
  for (const extra of parts.slice(1)) { const k = speciesOf(extra, genus); if (k && k !== canonical) { synonyms[k] = canonical; notes.push(`${k} → ${canonical} (agrupada en la ficha «${p.id}»)`); } }
  for (const inside of paren) {
    const name = inside.replace(/^antes\s+/i, "").replace(/^y otras\s+.*/i, "").trim();
    if (!name) continue;
    const k = speciesOf(name, genus);
    if (k && k !== canonical && k.includes(" ")) { synonyms[k] = canonical; notes.push(`${k} → ${canonical} (nombre en la ficha «${p.id}»)`); }
  }
}
for (const [k, v] of Object.entries(EXTRA_SYNONYMS)) { synonyms[k] = v; notes.push(`${k} → ${v} (añadido a mano)`); }
// Una especie canónica nunca es sinónimo de otra (evita cadenas).
for (const [from, to] of Object.entries(synonyms)) if (synonyms[to]) synonyms[from] = synonyms[to];
for (const k of Object.keys(synonyms)) if (Object.values(canonicalOf).includes(k)) delete synonyms[k];

const seen = new Map();
const addAlias = (name, key, from) => {
  const n = normName(name.replace(/\([^)]*\)/g, ""));
  if (!n || AMBIGUOUS.has(n)) return;
  if (seen.has(n) && seen.get(n) !== key) { aliases[n] = null; notes.push(`«${n}» está en dos plantas distintas: no se siembra`); return; }
  seen.set(n, key);
  if (aliases[n] !== null) aliases[n] = key;
};
for (const p of all) {
  const key = canonicalOf[p.id];
  addAlias(p.nombre_comun, key, p.id);
  for (const o of p.otros_nombres ?? []) addAlias(o, key, p.id);
  // Un nombre científico entre paréntesis de «otros_nombres» («Cantueso (Lavandula stoechas)») también sirve de nombre.
  for (const o of p.otros_nombres ?? []) for (const m of o.matchAll(/\(([^)]*)\)/g)) { const k = rawSpeciesKey(m[1]); if (k.includes(" ") && k !== key) synonyms[k] = key; }
  // Género o nombre científico completo como nombre.
  addAlias(rawSpeciesKey(p.nombre_cientifico.split("/")[0]), key, p.id);
}
for (const [n, k] of Object.entries(EXTRA_ALIASES)) { aliases[normName(n)] = k; notes.push(`«${n}» → ${k} (añadido a mano)`); }
for (const n of Object.keys(aliases)) if (aliases[n] === null) delete aliases[n];


// Texto de referencia de una planta, compacto, para el prompt de la IA. Lo «confirmado» va aparte y prevalece.
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const referenceText = (p) => {
  const lines = [`Planta de referencia: ${p.nombre_comun} (${p.nombre_cientifico}). Dificultad: ${p.dificultad}. Ubicación habitual: ${p.ubicacion}.`];
  lines.push(`Luz: ${clip(p.luz, 400)}`);
  lines.push(`Temperatura: ${clip(p.temperatura?.ideal, 200)} Frío: ${clip(p.temperatura?.resistencia_frio, 400)}`);
  lines.push(`Sustrato y maceta: ${clip(p.sustrato_y_maceta, 400)}`);
  for (const [k, label] of [["primavera", "Primavera"], ["verano", "Verano"], ["otono", "Otoño"], ["invierno", "Invierno"]]) {
    const e = p.estaciones?.[k];
    if (e) lines.push(`${label}: riego: ${clip(e.riego, 260)} abono: ${clip(e.abono, 260)} tareas: ${clip(e.tareas, 260)}`);
  }
  lines.push(`Poda: ${clip(p.poda, 450)}`);
  const tox = p.toxicidad ?? {};
  lines.push(`Toxicidad: mascotas: ${clip(tox.mascotas, 250)} personas: ${clip(tox.personas, 150)}`);
  if (p.plagas_y_problemas?.length) lines.push(`Problemas frecuentes: ${p.plagas_y_problemas.map((x) => clip(x.problema, 70)).join("; ")}.`);
  const decided = (p.contraste ?? []).filter((c) => c.estado === "confirmado");
  if (decided.length) lines.push(`DECISIONES CONFIRMADAS (prevalecen sobre todo lo anterior): ${decided.map((c) => `${c.dato}: ${clip(c.decision, 300)}`).join(" | ")}`);
  const unknown = (p.contraste ?? []).filter((c) => c.estado === "sin_fuente");
  if (unknown.length) lines.push(`Sin dato fiable: ${unknown.map((c) => `${c.dato} (${clip(c.decision, 120)})`).join("; ")}.`);
  return lines.join("\n");
};
// Ficha parcial: solo los datos que da la fuente; el resto lo completa la IA (y se le dice).
const partialText = (p) => [`Planta de referencia: ${p.nombre_comun} (${p.nombre_cientifico}). FICHA PARCIAL: solo estos datos vienen de una fuente de confianza; respétalos y completa el resto con criterio prudente, sin falsa precisión.`, ...p.datos.map((x) => `- ${clip(x, 400)}`)].join("\n");
const context = {};
for (const p of doc.plantas) context[canonicalOf[p.id]] = referenceText(p);
for (const p of doc.parciales ?? []) context[canonicalOf[p.id]] = partialText(p);
// Procedencia de cada especie de referencia (se guarda junto a su ficha en D1): planta, fuentes y decisiones confirmadas.
const meta = {};
for (const p of doc.parciales ?? []) meta[canonicalOf[p.id]] = { planta: p.id, parcial: true, fuentes: p.fuentes.map((f) => ({ titulo: f.titulo, url: f.url, tipo: f.tipo })), confirmadas: [] };
for (const p of doc.plantas) meta[canonicalOf[p.id]] = { planta: p.id, fuentes: p.fuentes.map((f) => ({ titulo: f.titulo, url: f.url, tipo: f.tipo })), confirmadas: (p.contraste ?? []).filter((c) => c.estado === "confirmado").map((c) => ({ dato: c.dato, por: c.confirmado_por ?? "", fecha: c.fecha ?? "" })) };

const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const body = `// Generado por tools/build-species-seed.mjs desde content/referencia/plantas.json: no editar a mano.
// SYNONYMS: nombre científico antiguo o alternativo → especie aceptada. ALIASES: nombre común (sin tildes) → especie.
export const SYNONYMS = ${JSON.stringify(sort(synonyms), null, 2)};
export const ALIASES = ${JSON.stringify(sort(aliases), null, 2)};
`;
const bodyContext = `// Generado por tools/build-species-seed.mjs desde content/referencia/plantas.json (v${doc.version}): no editar a mano.
// Texto de referencia por especie (clave = especie aceptada), que se añade al prompt de la IA al generar su ficha.
export const REFERENCE_VERSION = ${JSON.stringify(doc.version)};
export const REFERENCE = ${JSON.stringify(sort(context), null, 2)};
export const REFERENCE_META = ${JSON.stringify(sort(meta), null, 2)};
`;
if (process.argv.includes("--check")) {
  const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
  if (read(OUT) !== body || read(OUT_CONTEXT) !== bodyContext) { console.log("worker/src/species-seed.js o reference-context.js no están al día: ejecuta node tools/build-species-seed.mjs"); process.exit(1); }
  console.log(`Semillas de especies al día: ${Object.keys(synonyms).length} sinónimos · ${Object.keys(aliases).length} nombres comunes · ${Object.keys(context).length} textos de referencia (v${doc.version})`);
} else {
  writeFileSync(OUT, body);
  writeFileSync(OUT_CONTEXT, bodyContext);
  console.log(notes.join("\n"));
  console.log(`\nEscrito worker/src/species-seed.js (${Object.keys(synonyms).length} sinónimos · ${Object.keys(aliases).length} nombres comunes) y worker/src/reference-context.js (${Object.keys(context).length} especies, ${Math.round(bodyContext.length / 1024)} KB)`);
}
