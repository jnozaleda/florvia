// Genera las fichas de ejemplo de la landing («Plantas populares»): app/demo/<planta>.json con la ficha de cuidados y el calendario que da la IA
// para Madrid, y una foto de referencia (iNaturalist, con crédito). La landing enlaza a /app/#ejemplo=<planta>, que abre la ficha tal como se ve en la app.
// Sin Origin, las consultas cuentan como «sin origen»: no entran en las métricas ni se guardan como casos.
// Uso: node tools/make-demos.mjs [planta ...]   (por defecto, las fichas con «popular» del blog)  ·  Node 22
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const API = "https://api.florvia.app";
const MADRID = { lat: 40.4168, lon: -3.7038, place: "Madrid" };

const popular = readdirSync(join(ROOT, "content/plantas")).filter((f) => f.endsWith(".md")).map((f) => {
  const text = readFileSync(join(ROOT, "content/plantas", f), "utf8");
  return { slug: f.replace(/\.md$/, ""), plant: text.match(/^plant: (.*)$/m)?.[1], popular: Number(text.match(/^popular: (\d+)$/m)?.[1]) };
}).filter((p) => p.popular).sort((a, b) => a.popular - b.popular);
const wanted = process.argv.slice(2);
const list = wanted.length ? popular.filter((p) => wanted.includes(p.slug)) : popular;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${json.error ?? ""}`);
  return json;
}
async function refPhoto(species) {
  const r = await fetch(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(species)}&per_page=5`, { signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch(() => ({}));
  const hit = (r.results ?? []).find((t) => t.default_photo?.license_code && t.default_photo.medium_url);
  return hit ? { url: hit.default_photo.medium_url, credit: `${hit.default_photo.attribution.replace(/^\(c\)\s*/, "").replace(/,.*$/, "")} · iNaturalist`, source: "inaturalist" } : null;
}

mkdirSync(join(ROOT, "app/demo"), { recursive: true });
for (const p of list) {
  process.stdout.write(`${p.plant}… `);
  const care = await post("/care", { name: p.plant, ...MADRID, src: "explore" });
  delete care.caseId; delete care.cached;
  let calendar = null;
  try { calendar = await post("/calendar", { name: p.plant, species: care.species, ...MADRID }); delete calendar.caseId; delete calendar.cached; } catch (e) { process.stdout.write(`(sin calendario: ${e.message}) `); }
  const photo = await refPhoto(care.species);
  writeFileSync(join(ROOT, "app/demo", `${p.slug}.json`), JSON.stringify({ care, calendar, refPhoto: photo, place: MADRID.place, made: new Date().toISOString().slice(0, 10) }));
  console.log(`${care.species} ✓${calendar ? " + calendario" : ""}${photo ? " + foto" : ""}`);
}
