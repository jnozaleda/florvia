// Builds the evergreen pages (content/**/*.md → es/<tipo>/<slug>/index.html), the two hubs and sitemap.xml.
// No dependencies: `node tools/build-blog.mjs` (`--check`: only checks the posts, see tools/check-blog.mjs). Rules for writing posts: content/GUIA.md
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPages, report } from "./check-blog.mjs";
import { ALIASES } from "../worker/src/species-seed.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://florvia.app";
const TYPES = { plantas: { label: "Plantas", hub: "Fichas de plantas", hubIntro: "Cuidados, riego, poda y ubicación de las plantas más habituales." }, guias: { label: "Guías", hub: "Guías de jardinería", hubIntro: "Respuestas concretas: cuándo podar, cada cuánto regar, qué plantas elegir." } };
const normName = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
// The accepted species of a plant name (worker/src/species-seed.js), for its picture: the same seed as in the web explorer.
const speciesOf = (plant) => ALIASES[normName(plant)] ?? "";
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
// The season and step pictures (img/estilo, tools/creatividades.py): a texture and white line drawing on top.
const SEASON_KEY = { primavera: "primavera", verano: "verano", "otoño": "otono", invierno: "invierno" };
const SEASON_CLS = { primavera: "s1", verano: "s2", otono: "s3", invierno: "s4" };
const crea = (key) => `<div class="crea" style="background-image:url(/img/estilo/${key}.webp)"><img src="/img/estilo/${key}.svg" alt="" loading="lazy"></div>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Simple line icons (same style as the app), decorative only: aria-hidden, no text of their own.
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  droplet: '<path d="M7.5 19.4a7.2 7.2 0 0 0 9 0 6.5 6.5 0 0 0 1.6-8.5l-4.9-7.3a1.4 1.4 0 0 0-2.4 0l-4.9 7.3a6.5 6.5 0 0 0 1.6 8.5z"/>',
  flask: '<path d="M9 3h6M10 9h4M10 3v6l-4 11a.7.7 0 0 0 .5 1h11a.7.7 0 0 0 .5-1l-4-11V3"/>',
  scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6L19 19M8.6 15.4L19 5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  pot: '<path d="M5 10h14l-1.6 9.1a1 1 0 0 1-1 .9H7.6a1 1 0 0 1-1-.9z"/><path d="M12 10V6"/><path d="M12 6c0-2 1.5-3 3.5-3 0 2-1.5 3-3.5 3zM12 7.5C12 6 10.8 5 9 5c0 1.5 1.2 2.5 3 2.5z"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>',
  sprout: '<path d="M12 20v-8"/><path d="M12 12c0-3 2-5 5.5-5 0 3-2 5-5.5 5zM12 14c0-2.5-1.8-4-4.5-4 0 2.5 1.8 4 4.5 4z"/>',
};
const ico = (name) => (ICON_PATHS[name] ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>` : "");
const ROW_ICON = [[/^luz|^sol/i, "sun"], [/^riego/i, "droplet"], [/^abono/i, "flask"], [/^poda/i, "scissors"], [/^temperatura|^frío|^heladas/i, "snow"], [/^dificultad/i, "check"], [/^maceta/i, "pot"]];
const SEASON_ICON = { primavera: "sprout", verano: "sun", otoño: "leaf", invierno: "snow" };
const rowIcon = (label) => ico((ROW_ICON.find(([re]) => re.test(label.trim())) ?? [])[1]);
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// schema.org wants a full ISO 8601 date-time with a time zone (a bare date raises warnings): noon UTC keeps the day right everywhere.
const isoStamp = (d) => `${d}T12:00:00Z`;
const fmtMonth = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;

// ---- front matter
function parseFront(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("falta el front matter");
  const meta = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (meta[key] ??= []).push(item[1].trim()); continue; }
    const kv = line.match(/^([A-Za-z][\w]*):\s*(.*)$/);
    if (kv) { key = kv[1]; if (kv[2] !== "") meta[key] = kv[2].trim(); else meta[key] = []; }
  }
  return { meta, body: m[2] };
}

// ---- tiny markdown (headings, paragraphs, lists, tables, quotes, bold/italic/links)
const inline = (t) => esc(t)
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, h) => `<a href="${h.replace(/&amp;/g, "&amp;")}">${a}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
const slugify = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function markdown(src, { cta }) {
  const lines = src.split("\n");
  const out = [];
  let i = 0;
  let inFaq = false;
  let inSeasons = false;
  const faq = [];
  // «Cuidados por estación» and «Problemas frecuentes»: each ### with its text becomes a card; the cards of a section are laid out together.
  let cardKind = null;
  let cards = [];
  const flushCards = () => {
    if (!cards.length) return;
    out.push(cardKind === "seasons"
      ? `<div class="seasons">${cards.map((c) => { const key = SEASON_KEY[c.title.toLowerCase()] ?? "primavera"; return `<div class="season ${SEASON_CLS[key]}">${crea(key)}<div class="in"><em>${inline(c.title)}</em>${c.body}</div></div>`; }).join("")}</div>`
      : `<div class="probs">${cards.map((c) => `<div class="prob"><b>${inline(c.title)}</b>${c.body}</div>`).join("")}</div>`);
    cards = [];
  };
  const flushPara = (buf) => { if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`); };
  let para = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(para); para = []; i++; continue; }
    if (line.trim() === "{{CTA}}") { flushPara(para); para = []; out.push(cta()); i++; continue; }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      flushPara(para); para = [];
      const level = h[1].length;
      if (level === 2) { flushCards(); inFaq = /^preguntas frecuentes$/i.test(h[2].trim()); inSeasons = /por estación/i.test(h[2]); cardKind = inSeasons ? "seasons" : /^problemas/i.test(h[2].trim()) ? "probs" : null; }
      if (cardKind && level === 3) {
        const title = h[2].trim();
        const text = [];
        i++;
        while (i < lines.length && !/^#{2,3}\s/.test(lines[i])) { text.push(lines[i]); i++; }
        cards.push({ title, body: markdown(text.join("\n"), { cta }) });
        continue;
      }
      if (inFaq && level === 3) {
        const q = h[2].trim();
        const ans = [];
        i++;
        while (i < lines.length && !/^#{2,3}\s/.test(lines[i])) { ans.push(lines[i]); i++; }
        faq.push({ q, a: ans.join(" ").replace(/\s+/g, " ").trim() });
        continue;
      }
      if (inFaq && level === 2) { out.push(`<h2 id="${slugify(h[2])}">${inline(h[2])}</h2>`); out.push("%%FAQ%%"); i++; continue; }
      out.push(`<h${level} id="${slugify(h[2])}">${level === 3 && inSeasons ? ico(SEASON_ICON[h[2].trim().toLowerCase()]) : ""}${inline(h[2])}</h${level}>`);
      i++; continue;
    }
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? "")) {
      flushPara(para); para = [];
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      const careTable = /^necesidad$/i.test(head[0]);
      if (careTable) { out.push(`<div class="tiles">${rows.map(([k, v]) => `<div class="tile">${rowIcon(k)}<small>${inline(k)}</small><b>${inline(v)}</b></div>`).join("")}</div>`); continue; }
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c, ci) => `<th>${!careTable && ci > 0 ? rowIcon(c) : ""}${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, ci) => `<${careTable && ci === 0 ? 'th scope="row"' : "td"}>${careTable && ci === 0 ? rowIcon(c) : ""}${inline(c)}</${careTable && ci === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara(para); para = [];
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(para); para = [];
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  flushCards();
  const faqHtml = faq.length ? `<div class="faq">${faq.map((f) => `<details><summary>${inline(f.q)}</summary><p>${inline(f.a)}</p></details>`).join("")}</div>` : "";
  return out.join("\n").replace("%%FAQ%%", faqHtml);
}

// ---- page template
const CSS = `:root{--deep:#0f4628;--deep2:#0b3320;--leaf:#2f8f4e;--leaf-d:#23773f;--sage:#a9cba7;--mist:#e6efe3;--cream:#fbf9f4;--ink:#17261c;--mut:#5b6a5f;--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:18px/1.65 var(--sans);-webkit-text-size-adjust:100%}a{color:var(--leaf-d)}img{max-width:100%;height:auto}
.wrap{max-width:980px;margin:0 auto;padding:0 22px}.top{background:var(--deep);color:var(--cream);position:sticky;top:0;z-index:50}.nav{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 0}.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;text-decoration:none;color:var(--cream)}.brand img{width:34px;height:34px;border-radius:9px}
.nav nav{display:flex;align-items:center;gap:20px;font-size:15px}.nav nav a{color:#d6e6d3;text-decoration:none}.nav nav a.btn{color:var(--deep)}
@media(max-width:430px){.nav nav{gap:12px;font-size:14px}.brand{font-size:0}.brand img{width:38px;height:38px}}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 22px;border-radius:999px;background:var(--leaf);color:#fff;font:inherit;font-weight:700;font-size:16px;text-decoration:none;line-height:1.2}.btn.cream{background:var(--cream);color:var(--deep)}.btn.small{padding:9px 18px;font-size:15px}
.crumbs{font-size:14px;color:var(--mut);padding:22px 0 0}.crumbs a{color:var(--mut)}
article{max-width:720px;padding-bottom:20px}h1{font-family:var(--serif);font-weight:600;letter-spacing:-.015em;font-size:clamp(32px,5.2vw,46px);line-height:1.1;margin:14px 0 16px}
h2{font-family:var(--serif);font-weight:600;letter-spacing:-.01em;font-size:clamp(25px,3.6vw,32px);line-height:1.2;margin:42px 0 10px}h3{font-size:20px;margin:26px 0 6px}
.meta{color:var(--mut);font-size:14.5px;margin:0 0 22px}.lead{font-size:20px;color:#2b3b30}
.tbl{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:16px;background:#fff;border:1px solid #e2e8de;border-radius:12px;overflow:hidden}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #e8ece4;vertical-align:top}thead th{background:var(--mist);font-size:14.5px}tbody th{font-weight:700;white-space:nowrap}tr:last-child td,tr:last-child th{border-bottom:0}
.ic{width:19px;height:19px;stroke:var(--leaf);fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;vertical-align:-4px;margin-right:8px;flex:none}h3 .ic{width:22px;height:22px;vertical-align:-4px}
@media(max-width:600px){body{font-size:17px}table{font-size:14px}th,td{padding:9px 6px}thead th{font-size:12.5px;overflow-wrap:anywhere}.ic{width:16px;height:16px;margin-right:4px}thead .ic{display:block;margin:0 0 3px}.tbl{margin-left:-2px;margin-right:-2px}}
ul,ol{padding-left:24px}li{margin:6px 0}blockquote{margin:18px 0;padding:14px 18px;border-left:4px solid var(--leaf);background:var(--mist);border-radius:0 12px 12px 0;color:#2b3b30}
.cta{margin:30px 0;padding:24px;border-radius:22px;background:var(--deep);color:var(--cream)}.cta b{display:block;font-family:var(--serif);font-size:24px;line-height:1.2;margin-bottom:8px}.cta p{margin:0 0 16px;color:#cfe0cc}
details{border-bottom:1px solid #dfe5da;padding:2px 0}summary{cursor:pointer;font-weight:700;padding:14px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}summary::-webkit-details-marker{display:none}summary:after{content:"+";color:var(--leaf);font-size:24px;line-height:1}details[open] summary:after{content:"–"}details p{margin:0 0 14px;color:var(--mut)}
.plantcard{display:block;margin:22px 0;padding:18px 20px;border-radius:20px;background:var(--mist);border:1px solid #d8e4d4;color:var(--ink);text-decoration:none}.plantcard .pc-k{display:block;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--leaf-d)}.plantcard b{display:block;font-family:var(--serif);font-size:22px;margin:4px 0 2px}.plantcard span.pc-d{display:block;color:var(--mut);font-size:16px}.plantcard em{display:block;margin-top:8px;font-style:normal;font-weight:700;color:var(--leaf-d)}.note{font-size:15px;color:var(--mut);margin-top:30px}.related{display:grid;gap:8px;padding:0;list-style:none}.related a{display:block;padding:12px 16px;background:#fff;border:1px solid #e2e8de;border-radius:14px;text-decoration:none;font-weight:600}
.hub{display:grid;gap:12px;padding:0;list-style:none;margin:20px 0 40px}.hub a{display:block;padding:18px 20px;background:#fff;border:1px solid #e2e8de;border-radius:16px;text-decoration:none;color:var(--ink)}.hub b{display:block;font-size:19px}.hub span{color:var(--mut);font-size:15.5px}
footer{background:var(--deep2);color:#b9d1b6;margin-top:60px;padding:30px 0;font-size:15px}footer .wrap{display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap}footer a{color:#d6e6d3}
.phero{position:relative;color:var(--cream);background:#0b3320 url(/explorar/img/luz-entre-hojas.webp) center/cover;overflow:hidden;padding:0 0 56px;min-height:300px}
.phero[data-planta]{background-size:170% auto;background-repeat:no-repeat}
.phero:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,33,15,.55),rgba(6,33,15,.25) 45%,rgba(6,33,15,.72))}
.phero .wrap{position:relative;z-index:1}.phero .art{position:absolute;inset:0;width:100%;height:100%;opacity:.55}
.art .st{fill:none;stroke:rgba(255,255,255,.75);stroke-width:2.2;stroke-linecap:round}.art .lf{fill:rgba(255,255,255,.22);stroke:rgba(255,255,255,.85);stroke-width:1.4}.art .nv{stroke:rgba(255,255,255,.55);stroke-width:.9}
.art .fr{fill:rgba(255,255,255,.35);stroke:#fff;stroke-width:1.2}.art .lemon{fill:rgba(243,227,166,.85)}.art .berry{fill:rgba(231,120,100,.75)}.art .fl{fill:rgba(255,255,255,.55);stroke:rgba(255,255,255,.9);stroke-width:.8}.art .br{fill:rgba(255,220,230,.35);stroke:rgba(255,255,255,.9);stroke-width:1.2}
.phero .crumbs{color:#cfe0cc;padding:4px 0 0}.phero .crumbs a{color:#cfe0cc}
.phero h1{color:#fff;font-size:clamp(34px,5.6vw,54px);max-width:14em;margin:20px 0 12px;text-shadow:0 2px 18px rgba(6,33,15,.5)}
.phero .meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:#e6efe3;margin:0}.pillg{display:inline-block;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);font-style:italic;font-weight:600}
.phero .lead{color:#e6efe3;max-width:34em;margin:0}
.nav nav a.on{color:#fff;border-bottom:2px solid #f3e3a6}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:18px 0}.tile{background:#fff;border:1px solid #e2e8de;border-radius:18px;padding:14px 16px;box-shadow:0 10px 26px rgba(15,70,40,.06)}
.tile .ic{display:block;width:22px;height:22px;margin:0 0 6px}.tile small{display:block;color:var(--mut);font-size:13px}.tile b{display:block;font-size:16px;line-height:1.35;font-weight:600}
.seasons{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin:18px 0}.season{border-radius:20px;overflow:hidden}.season .in{padding:14px 16px 18px}
.season em{display:block;font-style:normal;font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px}.season p{margin:0;font-size:15.5px;line-height:1.5}
.crea{position:relative;height:110px;background-size:cover;background-position:center}.crea img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.s1{background:#e3f0dd;color:#23502f}.s2{background:#fbf0cf;color:#5e4a0c}.s3{background:#f6e2d4;color:#6b3618}.s4{background:#e6ecf1;color:#2c4052}
.probs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin:18px 0}.prob{background:#fff;border:1px solid #e2e8de;border-radius:18px;padding:16px 18px}.prob b{display:block;margin-bottom:4px}.prob p{margin:0;font-size:16px;color:#2b3b30}
.cta{background:#0b3320 url(/explorar/img/savia-clara.webp) center/cover;position:relative;overflow:hidden}.cta:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,51,32,.96) 40%,rgba(11,51,32,.6))}.cta>*{position:relative}
.cta.final{display:grid;grid-template-columns:1.3fr .7fr;align-items:end;padding:0;min-height:280px}.cta.final .txt{padding:28px}.cta.final .ph{justify-self:center;width:180px;margin-top:24px;border-radius:28px 28px 0 0;border:7px solid #10251a;border-bottom:0;overflow:hidden;max-height:300px;box-shadow:0 -10px 40px rgba(0,0,0,.35)}.cta.final .ph img{display:block;width:100%;height:auto}
.rel{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin:14px 0 24px;padding:0;list-style:none}.rel a{display:block;height:100%;padding:16px 18px;border-radius:18px;background:var(--mist);text-decoration:none;color:var(--ink)}.rel span{display:block;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--leaf-d)}.rel b{display:block;font-size:17px;margin-top:4px;line-height:1.35}
.another{display:block;margin:34px 0 10px;border-radius:24px;color:var(--cream);background:#0b3320 url(/explorar/img/luz-entre-hojas.webp) center/cover;padding:24px 26px;text-decoration:none}.another b{display:block;font-family:var(--serif);font-size:24px;margin-bottom:12px;color:#fff}
.another span{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.95);color:var(--mut);border-radius:999px;padding:12px 18px;font-size:16px}.another .ic{stroke:var(--mut);margin:0}
.minis{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin:24px 0 40px;padding:0;list-style:none}.minis a{display:block;border-radius:20px;overflow:hidden;background:#fff;border:1px solid #e2e8de;text-decoration:none;color:var(--ink)}
.minis .ban{position:relative;height:120px;background-size:170% auto;background-repeat:no-repeat;display:flex;align-items:flex-end;padding:14px 16px;color:#fff}.minis .ban:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,33,15,0) 30%,rgba(6,33,15,.55))}
.minis .ban .art{position:absolute;inset:0;width:100%;height:100%;opacity:.5}.minis .ban b{position:relative;font-family:var(--serif);font-size:26px;line-height:1;text-shadow:0 2px 14px rgba(6,33,15,.55)}.minis span{display:block;padding:12px 16px;font-size:15px;color:var(--mut)}
.plantcard{background:#fff}
@media(max-width:700px){.cta.final{grid-template-columns:1fr}.cta.final .ph{width:160px}.phero{padding-bottom:34px}}`;
const head = ({ title, description, path, extra = "", type = "article" }) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src https://api.florvia.app; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${SITE}${path}">
<meta name="theme-color" content="#0f4628"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/app/favicon-96.png" type="image/png" sizes="96x96"><link rel="icon" href="/app/favicon-48.png" type="image/png" sizes="48x48"><link rel="apple-touch-icon" href="/app/icon-180.png">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="${type}"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/app/og.png">
${extra}<style>${CSS}</style></head><body>`;
// The header of every page: its picture (the plant's, or the light-through-leaves one), the nav, the breadcrumbs and the title.
const NAV = (on) => `<div class="nav"><a class="brand" href="/" aria-label="Florvia"><img src="/app/icon-rounded.png" width="34" height="34" alt="">Florvia</a><nav><a href="/explorar/">Explorar</a><a href="/es/plantas/"${on === "plantas" ? ' class="on"' : ""}>Plantas</a><a href="/es/guias/"${on === "guias" ? ' class="on"' : ""}>Guías</a><a class="btn cream small" href="/app/">Abrir</a></nav></div>`;
const hero = ({ on, crumbs, title, meta = "", plant = "", group = "" }) => {
  const sp = plant ? speciesOf(plant) : "";
  const pic = plant ? ` data-planta="${esc(plant)}" data-especie="${esc(sp)}" data-grupo="${esc(group)}"` : "";
  return `<header class="phero"${pic}><div class="wrap">${NAV(on)}<div class="crumbs">${crumbs}</div><h1>${esc(title)}</h1>${meta}</div></header>`;
};
const ART_JS = `<script src="/img/estilo/plantas.js?v=20261010d" defer></script>`;
const SEARCH_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const another = `<a class="another" href="/explorar/"><b>¿Otra planta?</b><span>${SEARCH_IC}Búscala en el explorador: olivo, lavanda, monstera…</span></a>`;
const foot = `<footer><div class="wrap"><span>© Florvia</span><span><a href="/">Inicio</a> · <a href="/explorar/">Explorar</a> · <a href="/privacidad/">Privacidad</a> · <a href="mailto:hello@florvia.app">hello@florvia.app</a></span></div></footer>${ART_JS}<script src="/track.js" defer></script></body></html>`;
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>\n`;

// ---- build
const pages = [];
for (const type of Object.keys(TYPES)) {
  const dir = join(ROOT, "content", type);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const { meta, body } = parseFront(readFileSync(join(dir, file), "utf8"));
    const slug = file.replace(/\.md$/, "");
    pages.push({ type, slug, meta, body, path: `/es/${type}/${slug}/` });
  }
}
const byKey = Object.fromEntries(pages.map((p) => [`${p.type}/${p.slug}`, p]));
if (report(checkPages(pages)) > 0) { console.log("No se ha generado nada: corrige los errores y vuelve a ejecutar."); process.exit(1); }
if (process.argv.includes("--check")) process.exit(0);
for (const p of pages) {
  const m = p.meta;
  const ref = `${p.type === "plantas" ? "planta" : "guia"}-${p.slug}`;
  const appLink = (hash) => `/app/?ref=${encodeURIComponent(ref)}${hash ? `#${hash}` : ""}`;
  const ctaHash = m.ctaHash === "none" ? "" : m.ctaHash || (m.plant ? `anadir=${encodeURIComponent(m.plant)}` : "explorar");
  const cta = (final = false) => final
    ? `<div class="cta final"><div class="txt"><b>${esc(m.ctaFinalTitle || m.ctaTitle)}</b><p>${esc(m.ctaFinalText || m.ctaText)}</p><a class="btn cream" href="${appLink(ctaHash)}">${esc(m.ctaButton)}</a></div><div class="ph"><img src="/img/ficha.jpg" width="540" height="1169" alt="La ficha de una planta en la app" loading="lazy"></div></div>`
    : `<div class="cta"><b>${esc(m.ctaTitle)}</b><p>${esc(m.ctaText)}</p><a class="btn cream" href="${appLink(ctaHash)}">${esc(m.ctaButton)}</a></div>`;
  let html = markdown(p.body, { cta: () => cta(false) });
  // A guide about one plant carries that plant's card (its ficha) right after the intro.
  const ficha = p.type === "guias" && m.plant ? pages.find((q) => q.type === "plantas" && String(q.meta.plant).toLowerCase() === String(m.plant).toLowerCase()) : null;
  if (ficha) html = html.replace("</p>", `</p><a class="plantcard" href="${ficha.path}"><span class="pc-k">Ficha de la planta</span><b>${esc(ficha.meta.plant)}</b><span class="pc-d">${esc(ficha.meta.description)}</span><em>Ver la ficha completa →</em></a>`);
  const related = (m.related ?? []).map((r) => { const [key, label] = r.split("|").map((x) => x.trim()); return byKey[key] ? `<li><a href="${byKey[key].path}"><span>${byKey[key].type === "plantas" ? "Planta" : "Guía"}</span><b>${esc(label || byKey[key].meta.h1)}</b></a></li>` : ""; }).join("");
  const crumbs = [{ n: "Florvia", u: `${SITE}/` }, { n: TYPES[p.type].label, u: `${SITE}/es/${p.type}/` }, { n: m.h1, u: `${SITE}${p.path}` }];
  const jsonld = ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.n, item: c.u })) })
    + ld({ "@context": "https://schema.org", "@type": "Article", headline: m.h1, description: m.description, dateModified: isoStamp(m.updated), datePublished: isoStamp(m.published || m.updated), image: [`${SITE}/app/og.png`], inLanguage: "es", mainEntityOfPage: `${SITE}${p.path}`, author: { "@type": "Organization", name: "Florvia", url: `${SITE}/` }, publisher: { "@type": "Organization", name: "Florvia", url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/app/icon-512.png` } } });
  const page = `${head({ title: m.title, description: m.description, path: p.path, extra: jsonld })}
${hero({ on: p.type, crumbs: `<a href="/">Florvia</a> › <a href="/es/${p.type}/">${TYPES[p.type].label}</a> › ${esc(m.plant || m.h1)}`, title: m.h1, plant: m.plant || "", group: m.grupo || "",
  meta: `<p class="meta">${m.plant && speciesOf(m.plant) ? `<span class="pillg">${esc(capital(speciesOf(m.plant)))}</span>` : ""}<span>Actualizado: ${esc(fmtMonth(m.updated))}</span></p>` })}
<div class="wrap"><article>
${html}
${cta(true)}
${related ? `<h2>Te puede interesar</h2><ul class="rel">${related}</ul>` : ""}
${another}
<p class="note">${esc(m.disclaimer || "Las recomendaciones son orientativas y pueden variar según el clima, la ubicación, la variedad y las condiciones de cultivo.")}</p></article></div>
${foot}`;
  const out = join(ROOT, "es", p.type, p.slug);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), page);
}
for (const type of Object.keys(TYPES)) {
  const list = pages.filter((p) => p.type === type);
  const html = `${head({ title: `${TYPES[type].hub} | Florvia`, description: TYPES[type].hubIntro, path: `/es/${type}/`, type: "website" })}
${hero({ on: type, crumbs: `<a href="/">Florvia</a> › ${TYPES[type].label}`, title: TYPES[type].hub, meta: `<p class="lead">${esc(TYPES[type].hubIntro)}</p>` })}
<div class="wrap">${type === "plantas"
  ? `<ul class="minis">${list.map((p) => `<li><a href="${p.path}"><div class="ban" data-planta="${esc(p.meta.plant)}" data-especie="${esc(speciesOf(p.meta.plant))}" data-grupo="${esc(p.meta.grupo || "")}"><b>${esc(p.meta.plant)}</b></div><span>${esc(p.meta.description)}</span></a></li>`).join("")}</ul>`
  : `<ul class="rel" style="margin-top:28px">${list.map((p) => `<li><a href="${p.path}"><span>Guía</span><b>${esc(p.meta.h1)}</b></a></li>`).join("")}</ul>`}
${another}</div>
${foot}`;
  mkdirSync(join(ROOT, "es", type), { recursive: true });
  writeFileSync(join(ROOT, "es", type, "index.html"), html);
}
// «Aprende» de la landing: las guías con «featured: N» (de menor a mayor) entre las marcas aprende:start/end de index.html.
const featured = pages.filter((p) => p.meta.featured).sort((a, b) => Number(a.meta.featured) - Number(b.meta.featured));
const cards = featured.map((p) => `<a href="${p.path}"><b>${esc(p.meta.h1)}</b><span>${esc(p.meta.description)}</span><em>${p.type === "plantas" ? "Ver la ficha" : "Leer la guía"} →</em></a>`).join("\n");
// «Plantas populares» de la landing: las fichas con «popular: N» (de menor a mayor) entre las marcas populares:start/end. Es una selección editorial
// de plantas muy comunes, NO un ranking de uso de Florvia: cuando haya datos suficientes se podrá cambiar por «las más analizadas» con datos reales.
const popular = pages.filter((p) => p.meta.popular).sort((a, b) => Number(a.meta.popular) - Number(b.meta.popular));
const popCards = popular.map((p) => `<div class="pcard"><div class="ban" data-planta="${esc(p.meta.plant)}" data-especie="${esc(speciesOf(p.meta.plant))}" data-grupo="${esc(p.meta.grupo || "")}"><b>${esc(p.meta.plant)}</b></div><span>${esc(p.meta.description)}</span><div class="pl"><a href="/app/#ejemplo=${p.slug}">Verla en la app →</a><a class="alt" href="${p.path}">Leer la ficha</a></div></div>`).join("\n");
let landing = readFileSync(join(ROOT, "index.html"), "utf8");
const popMarks = /(<!-- populares:start[^>]*-->\n)[\s\S]*?(\n<!-- populares:end -->)/;
if (!popMarks.test(landing)) { console.log("index.html no tiene las marcas <!-- populares:start --> / <!-- populares:end -->"); process.exit(1); }
landing = landing.replace(popMarks, (_, a, z) => a + popCards + z);
const marks = /(<!-- aprende:start[^>]*-->\n)[\s\S]*?(\n<!-- aprende:end -->)/;
if (!marks.test(landing)) { console.log("index.html no tiene las marcas <!-- aprende:start --> / <!-- aprende:end -->"); process.exit(1); }
const nextLanding = landing.replace(marks, (_, a, b) => a + cards + b);
if (nextLanding !== readFileSync(join(ROOT, "index.html"), "utf8")) writeFileSync(join(ROOT, "index.html"), nextLanding);
// Sitemap: only what should rank (the privacy page stays public but is not listed). lastmod = the post's «updated»; a hub's = the newest of its posts;
// the landing has no date of its own, so it carries none.
const lastOf = (list) => list.map((p) => p.meta.updated).filter(Boolean).sort().pop();
const entries = [
  { u: "/" },
  { u: "/explorar/" },
  ...Object.keys(TYPES).map((type) => ({ u: `/es/${type}/`, d: lastOf(pages.filter((p) => p.type === type)) })),
  ...pages.map((p) => ({ u: p.path, d: p.meta.updated })),
];
writeFileSync(join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${SITE}${e.u}</loc>${e.d ? `<lastmod>${e.d}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
console.log(`${pages.length} páginas + 2 índices · sitemap con ${entries.length} URL`);
