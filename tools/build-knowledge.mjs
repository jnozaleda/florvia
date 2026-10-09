// Genera worker/src/knowledge.js a partir de content/conocimiento/*.md: el texto de cada grupo de plantas (pautas por estación y errores
// comunes) que el Worker da a la IA como contexto, y qué especies, géneros y nombres comunes son de cada grupo.
// Uso: node tools/build-knowledge.mjs          → escribe el archivo
//      node tools/build-knowledge.mjs --check  → sale con código 1 si el archivo no está al día o algo está mal (se usa en las pruebas)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { normName, speciesKey } from "../worker/src/species.js";

const DIR = new URL("../content/conocimiento/", import.meta.url);
const OUT = new URL("../worker/src/knowledge.js", import.meta.url);
const MAX_TEXT = 1400; // caracteres por grupo en el prompt: lo que cuesta en tokens cada ficha generada
const SECTIONS = ["Primavera", "Verano", "Otoño", "Invierno", "Errores comunes"];

const problems = [];
const groups = {};
const bySpecies = {};
const byName = {};
let version = "";
const claim = (map, key, group, what) => {
  if (!key) return;
  if (map[key] && map[key] !== group) problems.push(`${what} «${key}» está en dos grupos: ${map[key]} y ${group}`);
  map[key] = group;
};

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
  const text = readFileSync(new URL(file, DIR), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { problems.push(`${file}: sin cabecera`); continue; }
  const head = Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  const group = head.grupo;
  if (`${group}.md` !== file) problems.push(`${file}: «grupo: ${group}» no coincide con el nombre del archivo`);
  for (const k of ["nombre", "clima", "especies", "nombres", "updated"]) if (!head[k]) problems.push(`${file}: falta «${k}» en la cabecera`);
  if (head.updated > version) version = head.updated;
  // Apartados «## Estación» con sus viñetas, en una línea cada uno y sin marcas de formato.
  const parts = {};
  let current = null;
  for (const line of m[2].split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { current = h[1]; parts[current] = []; continue; }
    const b = line.match(/^\s*-\s+(.*)$/);
    if (b && current) parts[current].push(b[1].replace(/\*\*|__|`/g, "").trim());
  }
  for (const s of SECTIONS) if (!parts[s]?.length) problems.push(`${file}: falta el apartado «## ${s}» o está vacío`);
  const body = [`Grupo: ${head.nombre} (pautas pensadas para: ${head.clima}).`, ...SECTIONS.filter((s) => parts[s]?.length).map((s) => `${s}: ${parts[s].map((x) => x.replace(/[.;]\s*$/, "")).join("; ")}.`)].join("\n");
  if (body.length > MAX_TEXT) problems.push(`${file}: el texto para la IA ocupa ${body.length} caracteres (máximo ${MAX_TEXT}); acórtalo`);
  groups[group] = { nombre: head.nombre, updated: head.updated, text: body };
  // «Citrus» (género) o «Ficus elastica» (especie); una especie concreta gana a su género al buscar.
  for (const s of (head.especies ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const words = normName(s).split(" ");
    claim(bySpecies, words.length === 1 ? words[0] : speciesKey(s), group, "La especie o género");
  }
  for (const n of (head.nombres ?? "").split(",").map((x) => normName(x)).filter(Boolean)) claim(byName, n, group, "El nombre");
}

const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const out = `// Generado por tools/build-knowledge.mjs desde content/conocimiento/*.md: no editar a mano.
// GROUPS: texto de cada grupo para el prompt de la IA. GROUP_BY_SPECIES: especie aceptada o género → grupo. GROUP_BY_NAME: nombre común (sin tildes) → grupo.
export const KNOWLEDGE_VERSION = ${JSON.stringify(version)};
export const GROUPS = ${JSON.stringify(sort(groups), null, 2)};
export const GROUP_BY_SPECIES = ${JSON.stringify(sort(bySpecies), null, 2)};
export const GROUP_BY_NAME = ${JSON.stringify(sort(byName), null, 2)};
`;

if (problems.length) { console.log(problems.map((p) => `✗ ${p}`).join("\n")); process.exit(1); }
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch {}
  if (current !== out) { console.log("worker/src/knowledge.js no está al día: ejecuta «node tools/build-knowledge.mjs» y sube el cambio."); process.exit(1); }
  console.log(`Fichas de conocimiento al día: ${Object.keys(groups).length} grupos · ${Object.keys(bySpecies).length} especies o géneros · ${Object.keys(byName).length} nombres`);
} else {
  writeFileSync(OUT, out);
  console.log(`Escrito worker/src/knowledge.js: ${Object.keys(groups).length} grupos (${Object.values(groups).map((g) => g.text.length).join(", ")} caracteres)`);
}
