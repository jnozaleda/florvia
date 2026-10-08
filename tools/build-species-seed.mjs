// Genera worker/src/species-seed.js (sinónimos científicos y nombres comunes) a partir de content/referencia/plantas.json.
// Uso: node tools/build-species-seed.mjs          → escribe el archivo
//      node tools/build-species-seed.mjs --check  → sale con código 1 si el archivo no está al día (se usa en las pruebas)
import { readFileSync, writeFileSync } from "node:fs";
import { rawSpeciesKey, normName } from "../worker/src/species.js";

// species.js importa species-seed.js, que aún puede no existir o estar viejo: aquí solo se usan las funciones de normalización puras.
const doc = JSON.parse(readFileSync(new URL("../content/referencia/plantas.json", import.meta.url), "utf8"));
const OUT = new URL("../worker/src/species-seed.js", import.meta.url);

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

for (const p of doc.plantas) {
  // Parte «(antes X)», «(Aloe barbadensis)», «(y otras Mentha)» aparte del nombre principal.
  const sci = p.nombre_cientifico;
  const paren = [...sci.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const main = sci.replace(/\([^)]*\)/g, "").trim();
  const parts = main.split("/").map((s) => s.trim()).filter(Boolean);
  const genus = parts[0].split(/\s+/)[0];
  const canonical = rawSpeciesKey(parts[0]);
  if (!canonical) throw new Error(`${p.id}: sin especie en «${sci}»`);
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
for (const p of doc.plantas) {
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

const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const body = `// Generado por tools/build-species-seed.mjs desde content/referencia/plantas.json: no editar a mano.
// SYNONYMS: nombre científico antiguo o alternativo → especie aceptada. ALIASES: nombre común (sin tildes) → especie.
export const SYNONYMS = ${JSON.stringify(sort(synonyms), null, 2)};
export const ALIASES = ${JSON.stringify(sort(aliases), null, 2)};
`;
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* no existe */ }
  if (current !== body) { console.log("worker/src/species-seed.js no está al día: ejecuta node tools/build-species-seed.mjs"); process.exit(1); }
  console.log(`Semillas de especies al día: ${Object.keys(synonyms).length} sinónimos · ${Object.keys(aliases).length} nombres comunes`);
} else {
  writeFileSync(OUT, body);
  console.log(notes.join("\n"));
  console.log(`\nEscrito worker/src/species-seed.js: ${Object.keys(synonyms).length} sinónimos · ${Object.keys(aliases).length} nombres comunes`);
}
