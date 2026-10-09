// Fichas escritas a mano (por Claude en una sesión con Noza) en content/fichas/<planta>.json: la parte general de la especie y, por zona
// (celda lat:lon redondeada, p. ej. "40:-4" = Madrid), su parte de clima y su calendario del año. Se suben a D1/KV bloqueadas: la IA de la
// app no las sustituye ni caducan, y si cambia su información de referencia llega un correo para reescribirlas.
// Uso: node tools/fichas-curadas.mjs                 comprueba todas (formato, recortes, especie)
//      node tools/fichas-curadas.mjs subir <planta>  la sube a producción (--local: a la base de datos local)
import { register } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

// El Worker importa "cloudflare:email", que solo existe en Cloudflare.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) { return s === "cloudflare:email" ? { url: "data:text/javascript,export class EmailMessage {}", shortCircuit: true } : next(s, c); }
`));
const { infoFor, sanitize, sanitizeCalendar, splitSheet, referenceProvenance, CARE_SCHEMA } = await import(new URL("../worker/src/worker.js", import.meta.url));
const { speciesKey, normName } = await import(new URL("../worker/src/species.js", import.meta.url));
const { REFERENCE_VERSION } = await import(new URL("../worker/src/reference-context.js", import.meta.url));
const { KNOWLEDGE_VERSION } = await import(new URL("../worker/src/knowledge.js", import.meta.url));

const DIR = new URL("../content/fichas/", import.meta.url);
const WORKER_DIR = fileURLToPath(new URL("../worker/", import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const local = process.argv.includes("--local");
const ZONE_KEYS = ["lugar", "calendario", "climateFit", "climateNote", "plantMonths", "plantWhen", "bloomMonths", "bloomWhat", ...["spring", "summer", "autumn", "winter"].flatMap((k) => [`water_${k}`, `feed_${k}`, `feedtype_${k}`, `tip_${k}`])];

// Lo que la app recibiría: la ficha general + la zona, pasadas por el mismo saneado que una respuesta de la IA.
function build(doc, cell) {
  const zone = doc.zonas[cell];
  const raw = { ...doc.ficha, ...Object.fromEntries(Object.entries(zone).filter(([k]) => k !== "lugar" && k !== "calendario")) };
  const sheet = sanitize(raw);
  const sk = speciesKey(sheet.species);
  const info = infoFor(sk, sheet.commonName);
  const curated = `${doc.autor} · ${doc.fecha}`;
  const full = { ...sheet, provider: "claude-a-mano", ...(info.reference ? { grounded: REFERENCE_VERSION } : {}), ...(info.group ? { knowledge: `${info.group}@${KNOWLEDGE_VERSION}` } : {}), fp: info.fp, fpc: info.fp, curated, curatedZone: curated };
  const { parent, child } = splitSheet(full);
  const calendar = zone.calendario ? { ...sanitizeCalendar(zone.calendario), provider: "claude-a-mano", fp: info.fp, curated } : null;
  return { raw, sheet, sk, info, parent, child, calendar };
}

// Avisa de lo que el saneado recorta o cambia (la app vería otra cosa que lo escrito).
function check(id, doc) {
  const problems = [];
  for (const k of ["planta", "autor", "fecha", "ficha", "zonas"]) if (!(k in doc)) problems.push(`falta «${k}»`);
  if (problems.length) return problems;
  const known = new Set(Object.keys(CARE_SCHEMA.properties));
  for (const k of Object.keys(doc.ficha)) if (!known.has(k) || ZONE_KEYS.includes(k)) problems.push(`«ficha.${k}» no es un campo de la parte general`);
  for (const [cell, zone] of Object.entries(doc.zonas)) {
    if (!/^-?\d{1,2}:-?\d{1,3}$/.test(cell)) problems.push(`zona «${cell}»: debe ser «lat:lon» redondeados`);
    for (const k of Object.keys(zone)) if (!ZONE_KEYS.includes(k)) problems.push(`zona ${cell}: «${k}» no es un campo de zona`);
    const { raw, sheet, sk, info, calendar } = build(doc, cell);
    if (!sheet.isPlant) problems.push("no pasa como planta (¿nombre científico?)");
    if (!info.reference) problems.push(`«${sk}» no tiene datos de referencia en plantas.json`);
    const texts = { climateNote: sheet.climateNote, potAdvice: sheet.potAdvice, waterHow: sheet.waterHow, plantWhen: sheet.plantWhen, matureNote: sheet.matureNote, bloomWhat: sheet.bloomWhat, toxicNote: sheet.toxicNote, notes: sheet.notes, ...Object.fromEntries(Object.entries(sheet.tips).map(([k, v]) => [`tip_${k}`, v])) };
    for (const [k, v] of Object.entries(texts)) if ((raw[k] ?? "").trim() !== v) problems.push(`zona ${cell}: «${k}» se recorta a «${v}»`);
    sheet.buyTips.forEach((t, i) => { if (t !== raw.buyTips[i].trim()) problems.push(`«buyTips[${i}]» se recorta a «${t}»`); });
    for (const s of ["spring", "summer", "autumn", "winter"]) {
      if (sheet.seasons[s].water !== raw[`water_${s}`]) problems.push(`zona ${cell}: riego de ${s} cambia a ${sheet.seasons[s].water}`);
      if (sheet.seasons[s].feed !== raw[`feed_${s}`]) problems.push(`zona ${cell}: abono de ${s} cambia a ${sheet.seasons[s].feed} (los días de abono se redondean)`);
    }
    if (calendar) {
      const given = zone.calendario.tasks ?? [];
      if (calendar.tasks.length !== given.length) problems.push(`zona ${cell}: el calendario se queda en ${calendar.tasks.length} de ${given.length} tareas`);
      calendar.tasks.forEach((t) => { const g = given.find((x) => x.title === t.title); if (g && g.how.trim() !== t.how) problems.push(`calendario «${t.title}»: «how» se recorta a «${t.how}»`); });
    }
  }
  return problems;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));

if (args[0] === "subir") {
  const id = args[1];
  if (!files.includes(`${id}.json`)) { console.log(`No existe content/fichas/${id}.json`); process.exit(1); }
  const doc = load(`${id}.json`);
  const problems = check(id, doc);
  if (problems.length) { console.log(problems.map((p) => `✗ ${p}`).join("\n")); process.exit(1); }
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const now = Date.now();
  const cells = Object.keys(doc.zonas);
  const first = build(doc, cells[0]);
  const provenance = { ...referenceProvenance(first.sk), autor: doc.autor, fecha: doc.fecha, revisado_por: doc.revisado_por ?? "", archivo: `content/fichas/${id}.json` };
  const sql = [`INSERT OR REPLACE INTO species_parent (species, data, grounded, locked, status, provenance, created_at, updated_at) VALUES (${q(first.sk)}, ${q(JSON.stringify(first.parent))}, ${q(first.parent.grounded ?? "")}, 1, 'bloqueada', ${q(JSON.stringify(provenance))}, ${now}, ${now});`];
  for (const cell of cells) sql.push(`INSERT OR REPLACE INTO species_child (species, cell, data, created_at) VALUES (${q(first.sk)}, ${q(cell)}, ${q(JSON.stringify(build(doc, cell).child))}, ${now});`);
  const tmp = mkdtempSync(join(tmpdir(), "fichas-"));
  writeFileSync(join(tmp, "subir.sql"), sql.join("\n"));
  const wrangler = (list) => execFileSync("npx", ["wrangler", ...list], { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  wrangler(["d1", "execute", "florvia-usage", ...(local ? ["--local"] : ["--remote"]), "--file", join(tmp, "subir.sql")]);
  // El calendario vive en KV con la clave del nombre científico que manda la app (el de la ficha) y la zona; sin caducidad.
  let cals = 0;
  for (const cell of cells) {
    const { calendar, sheet } = build(doc, cell);
    if (!calendar) continue;
    const file = join(tmp, `cal-${cell.replace(":", "_")}.json`);
    writeFileSync(file, JSON.stringify(calendar));
    wrangler(["kv", "key", "put", `cal:v4:${normName(sheet.species)}:${cell}`, "--path", file, "--binding", "CACHE", ...(local ? ["--local"] : ["--remote"])]);
    cals++;
  }
  console.log(`${first.sk}: ficha general bloqueada, ${cells.length} zona(s) (${cells.join(", ")}) y ${cals} calendario(s) subidos${local ? " (local)" : ""}.`);
} else {
  let bad = 0;
  for (const f of files) {
    const problems = check(f, load(f));
    if (problems.length) { bad++; console.log(`${f}:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`); }
    else console.log(`✓ ${f}`);
  }
  if (!files.length) console.log("No hay fichas escritas a mano todavía.");
  if (bad) process.exit(1);
}
