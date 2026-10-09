// Administra las fichas de especie que guarda el Worker en D1 (species_parent / species_child / species_alias), con wrangler. Uso:
//   node tools/ficha-admin.mjs listar                     lista las especies: estado, referencia, zonas
//   node tools/ficha-admin.mjs ver <especie|nombre>       datos del padre, procedencia y zonas
//   node tools/ficha-admin.mjs bloquear <especie|nombre>  el padre no se sustituye ni caduca
//   node tools/ficha-admin.mjs desbloquear <especie|nombre>
//   node tools/ficha-admin.mjs invalidar <especie|nombre> [--forzar]   borra el padre (si no está bloqueado), las zonas y el calendario: se genera de nuevo al pedirla
//   node tools/ficha-admin.mjs retiradas                  las fichas que el Worker ha retirado por quejas (👎 o «Malo»), con el motivo y el caso
//   node tools/ficha-admin.mjs recuperar <especie|nombre> [--forzar]   vuelve a poner la última ficha retirada (con --forzar, aunque ya se haya escrito otra)
// Con --local actúa sobre la base de datos local en vez de la de producción.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { speciesKey, seedAlias } from "../worker/src/species.js";

const WORKER_DIR = fileURLToPath(new URL("../worker/", import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const [command, ...rest] = args;
const remote = flags.has("--local") ? [] : ["--remote"];

const wrangler = (list) => execFileSync("npx", ["wrangler", ...list], { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const query = (sql) => JSON.parse(wrangler(["d1", "execute", "florvia-usage", ...remote, "--json", "--command", sql]))[0].results ?? [];
// Lo escrito se reduce a la clave de especie (letras, números y espacios), así que se puede poner en la consulta sin riesgo.
const resolve = (text) => {
  const key = (seedAlias(text) || speciesKey(text)).replace(/[^a-z0-9 ]/g, "");
  if (!key) { console.log(`No entiendo «${text}».`); process.exit(1); }
  return key;
};
const need = () => { if (!rest.length) { console.log("Falta la especie."); process.exit(1); } return resolve(rest.join(" ")); };
const row = (key) => query(`SELECT species, status, grounded, locked, provenance, created_at FROM species_parent WHERE species = '${key}'`)[0];

if (command === "listar") {
  const rows = query("SELECT p.species, p.status, p.grounded, p.locked, (SELECT COUNT(*) FROM species_child c WHERE c.species = p.species) AS zonas, json_extract(p.data, '$.commonName') AS nombre FROM species_parent p ORDER BY p.status DESC, p.species");
  for (const r of rows) console.log(`${r.locked ? "🔒" : "  "} ${r.species.padEnd(28)} ${r.status.padEnd(15)} ref=${(r.grounded || "-").padEnd(4)} zonas=${r.zonas}  ${r.nombre ?? ""}`);
  console.log(`\n${rows.length} especies · ${rows.filter((r) => r.locked).length} bloqueadas · ${rows.filter((r) => r.grounded).length} con referencia`);
} else if (command === "ver") {
  const key = need();
  const r = row(key);
  if (!r) { console.log(`No hay ficha de «${key}».`); process.exit(0); }
  const data = JSON.parse(query(`SELECT data FROM species_parent WHERE species = '${key}'`)[0].data);
  console.log(`${key} · ${r.status} · referencia ${r.grounded || "ninguna"} · generada ${new Date(r.created_at).toISOString().slice(0, 10)}\n`);
  console.log(JSON.stringify(data, null, 1));
  console.log("\nProcedencia:", JSON.stringify(JSON.parse(r.provenance), null, 1));
  console.log("\nZonas:", query(`SELECT cell, created_at FROM species_child WHERE species = '${key}'`).map((c) => `${c.cell} (${new Date(c.created_at).toISOString().slice(0, 10)})`).join(", "));
} else if (command === "bloquear" || command === "desbloquear") {
  const key = need();
  if (!row(key)) { console.log(`No hay ficha de «${key}»: pídela primero en la app o con una petición.`); process.exit(1); }
  const lock = command === "bloquear";
  query(`UPDATE species_parent SET locked = ${lock ? 1 : 0}, status = CASE WHEN ${lock ? 1 : 0} = 1 THEN 'bloqueada' WHEN grounded <> '' THEN 'con_referencia' ELSE 'generada' END, updated_at = ${Date.now()} WHERE species = '${key}'`);
  console.log(`${key}: ${lock ? "bloqueada 🔒" : "desbloqueada"}`);
} else if (command === "invalidar") {
  const key = need();
  const r = row(key);
  if (r?.locked && !flags.has("--forzar")) { console.log(`«${key}» está bloqueada: desbloquéala o usa --forzar.`); process.exit(1); }
  query(`DELETE FROM species_child WHERE species = '${key}'`);
  query(`DELETE FROM species_parent WHERE species = '${key}'`);
  // El calendario del año vive en KV, por especie y zona.
  let deleted = 0;
  try {
    const list = JSON.parse(wrangler(["kv", "key", "list", "--binding", "CACHE", ...remote, "--prefix", `cal:v4:${key}:`]));
    for (const k of list) { wrangler(["kv", "key", "delete", k.name, "--binding", "CACHE", ...remote]); deleted++; }
  } catch { /* sin calendario */ }
  console.log(`${key}: ficha y zonas borradas${deleted ? `, ${deleted} calendario(s)` : ""}. Se genera de nuevo la próxima vez que alguien la pida.`);
} else if (command === "retiradas") {
  const rows = query("SELECT species, ts, why, by, case_id, name, json_extract(parent, '$.commonName') AS nombre, json_array_length(children) AS zonas FROM species_retired ORDER BY ts DESC LIMIT 50");
  if (!rows.length) console.log("No se ha retirado ninguna ficha.");
  for (const r of rows) console.log(`${new Date(r.ts).toISOString().slice(0, 16).replace("T", " ")}  ${r.species.padEnd(26)} ${r.why.padEnd(18)} ${r.by.padEnd(5)} zonas=${r.zonas}  «${r.name}» → caso ${r.case_id}  ${r.nombre ?? ""}`);
} else if (command === "recuperar") {
  const key = need();
  const last = query(`SELECT id, parent, children FROM species_retired WHERE species = '${key}' ORDER BY ts DESC LIMIT 1`)[0];
  if (!last) { console.log(`No hay ninguna ficha retirada de «${key}».`); process.exit(1); }
  if (row(key) && !flags.has("--forzar")) { console.log(`«${key}» ya tiene una ficha nueva: usa --forzar para sustituirla por la retirada.`); process.exit(1); }
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const parent = JSON.parse(last.parent);
  const now = Date.now();
  query(`INSERT OR REPLACE INTO species_parent (species, data, grounded, locked, status, provenance, created_at, updated_at) VALUES (${q(key)}, ${q(last.parent)}, ${q(parent.grounded ?? "")}, 0, ${q(parent.grounded ? "con_referencia" : "generada")}, '{}', ${now}, ${now})`);
  const children = JSON.parse(last.children);
  for (const c of children) query(`INSERT OR REPLACE INTO species_child (species, cell, data, created_at) VALUES (${q(key)}, ${q(c.cell)}, ${q(c.data)}, ${now})`);
  console.log(`${key}: ficha recuperada con ${children.length} zona(s).`);
} else {
  console.log("Uso: node tools/ficha-admin.mjs listar | ver <especie> | bloquear <especie> | desbloquear <especie> | invalidar <especie> [--forzar] | retiradas | recuperar <especie> [--forzar]");
  process.exit(command ? 1 : 0);
}
