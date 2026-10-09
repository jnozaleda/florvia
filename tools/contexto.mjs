// Prepara el contexto del proyecto para pegarlo en un prompt de otra sesión.
// Une docs/CONTEXTO.md con el estado real del repo (rama, últimos cambios, versión, cambios sin guardar).
// Uso:  node tools/contexto.mjs                 → escribe el texto en pantalla
//       node tools/contexto.mjs "tu tarea"      → lo añade al final como «Tarea de hoy»
//       node tools/contexto.mjs --copiar        → además lo copia al portapapeles, si hay herramienta para ello
//       node tools/contexto.mjs --solo-archivo  → sin el estado del repo
import { readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const task = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

const parts = ["Vas a continuar un trabajo ya empezado en el repo jnozaleda/florvia. Lee primero este contexto y úsalo como punto de partida; si algo no cuadra con el código, fíate del código y avísame.", "", readFileSync(join(ROOT, "docs", "CONTEXTO.md"), "utf8").trim()];

if (!flags.has("--solo-archivo")) {
  const version = readFileSync(join(ROOT, "app", "index.html"), "utf8").match(/\?v=(\d{8}[a-z]?)/)?.[1] ?? "desconocida";
  const sucio = git("status --short");
  parts.push("", "## Estado del repo ahora mismo",
    `- Rama: ${git("rev-parse --abbrev-ref HEAD") || "?"}`,
    `- Versión de la app: ${version}`,
    `- Cambios sin guardar: ${sucio ? "\n" + sucio.split("\n").map((l) => "  " + l).join("\n") : "ninguno"}`,
    "- Últimos 10 cambios:", ...git("log -10 --format=%h%x20%ad%x20%s --date=short").split("\n").filter(Boolean).map((l) => "  " + l));
}
if (task) parts.push("", "## Tarea de hoy", task);

const text = parts.join("\n") + "\n";
process.stdout.write(text);

if (flags.has("--copiar")) {
  const tools = [["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"], ["clip"]];
  const ok = tools.some(([c, ...a]) => spawnSync(c, a, { input: text }).status === 0);
  console.error(ok ? "\n(Copiado al portapapeles)" : "\n(No encontré herramienta de portapapeles: copia el texto de arriba o usa  node tools/contexto.mjs > contexto.txt)");
}
