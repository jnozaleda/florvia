// Checks the blog posts against the rules in content/GUIA.md. Used by build-blog.mjs (`node tools/build-blog.mjs --check` only checks).
// Errors stop the build; warnings are advice (length, number of links...).
const REQUIRED = ["title", "h1", "description", "updated", "published", "ctaTitle", "ctaText", "ctaButton"];
const PLANT_SECTIONS = [[/^cuidados rápidos$/i, "Cuidados rápidos"], [/^dónde colocar /i, "Dónde colocar…"], [/^cada cuánto regar /i, "Cada cuánto regar…"], [/^cuándo abonar /i, "Cuándo abonar…"], [/temperatura/i, "Temperatura…"], [/^problemas frecuentes$/i, "Problemas frecuentes"], [/^cuidados por estación$/i, "Cuidados por estación"], [/^preguntas frecuentes$/i, "Preguntas frecuentes"]];
const SEASONS = ["primavera", "verano", "otoño", "invierno"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const headings = (body) => body.split("\n").map((l) => l.match(/^(#{1,6})\s+(.*)$/)).filter(Boolean).map((m) => ({ level: m[1].length, text: m[2].trim() }));

function faqBlocks(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+preguntas frecuentes\s*$/i.test(l));
  if (start < 0) return null;
  const blocks = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    if (/^###\s/.test(lines[i])) blocks.push({ q: lines[i].replace(/^###\s+/, ""), a: [] });
    else if (blocks.length) blocks[blocks.length - 1].a.push(lines[i]);
  }
  return blocks;
}

export function checkPages(pages) {
  const issues = [];
  const paths = new Set(pages.map((p) => p.path));
  const keys = new Set(pages.map((p) => `${p.type}/${p.slug}`));
  for (const p of pages) {
    const m = p.meta;
    const file = `content/${p.type}/${p.slug}.md`;
    const err = (msg) => issues.push({ level: "error", file, msg });
    const warn = (msg) => issues.push({ level: "warn", file, msg });

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) err("el nombre del archivo debe ir en minúsculas, sin tildes y con guiones");
    for (const k of REQUIRED) if (!m[k] || Array.isArray(m[k])) err(`falta el campo «${k}» en la cabecera`);
    if (m.title && !/ \| Florvia$/.test(m.title)) err("«title» debe terminar en « | Florvia»");
    for (const k of ["updated", "published"]) if (m[k] && !DATE.test(m[k])) err(`«${k}» debe tener el formato AAAA-MM-DD`);
    if (DATE.test(m.updated ?? "") && DATE.test(m.published ?? "") && m.updated < m.published) err("«updated» es anterior a «published»");
    if (m.ctaHash && !/^(explorar|none)$/.test(m.ctaHash)) err("«ctaHash» solo admite «explorar» o «none»");
    if (p.type === "plantas" && !m.plant) warn("una ficha de planta debería llevar «plant» para que el botón abra la app con esa planta");
    if (!m.ctaFinalTitle || !m.ctaFinalText) warn("faltan «ctaFinalTitle» / «ctaFinalText»: el cierre repetirá el texto del CTA del medio");
    if (m.title && m.title.length > 60) warn(`«title» mide ${m.title.length} caracteres (recomendado: 60 o menos)`);
    if (m.description && (m.description.length < 90 || m.description.length > 155)) warn(`«description» mide ${m.description.length} caracteres (recomendado: entre 90 y 155)`);

    const rel = m.related ?? [];
    for (const r of rel) { const key = r.split("|")[0].trim(); if (!keys.has(key)) err(`«related» apunta a un post que no existe: ${key}`); else if (key === `${p.type}/${p.slug}`) err("«related» enlaza el propio post"); }
    if (rel.length < 3 || rel.length > 5) warn(`«related» tiene ${rel.length} enlaces (recomendado: de 3 a 5)`);

    const words = p.body.split(/\s+/).filter(Boolean).length;
    if (words < 400 || words > 1000) warn(`el texto tiene ${words} palabras (orientativo: entre 400 y 1.000)`);

    const ctas = p.body.split("\n").filter((l) => l.trim() === "{{CTA}}").length;
    if (ctas !== 1) err(`debe haber un único {{CTA}} en una línea sola (hay ${ctas})`);
    if (/\{\{(?!CTA\}\})/.test(p.body)) err("hay llaves {{…}} que no son {{CTA}}");
    if (/!\[[^\]]*\]\(/.test(p.body)) err("las imágenes no están soportadas");

    const hs = headings(p.body);
    if (hs.some((h) => h.level === 1 || h.level > 3)) err("solo se usan títulos ## y ###");
    for (const [, href] of p.body.matchAll(/\]\((\/es\/[^)\s]*)\)/g)) if (!paths.has(href)) err(`enlace interno roto: ${href}`);

    const faq = faqBlocks(p.body);
    if (!faq) err("falta la sección «## Preguntas frecuentes»");
    else {
      if (faq.length !== 4) err(`debe haber 4 preguntas frecuentes (hay ${faq.length})`);
      for (const f of faq) {
        const lines = f.a.map((l) => l.trim());
        if (!lines.some(Boolean)) err(`la pregunta «${f.q}» no tiene respuesta`);
        if (lines.some((l) => /^([-*>|]|\d+\.)\s?/.test(l))) err(`la respuesta de «${f.q}» lleva lista, tabla o cita: debe ser un párrafo`);
        else if (lines.join("\n").trim().split(/\n\s*\n/).length > 1) warn(`la respuesta de «${f.q}» tiene varios párrafos: se unirán en uno`);
      }
      if (hs.filter((h) => /^preguntas frecuentes$/i.test(h.text)).length > 1) err("«Preguntas frecuentes» aparece más de una vez");
    }

    if (p.type === "plantas") {
      const h2 = hs.filter((h) => h.level === 2).map((h) => h.text);
      let from = 0;
      for (const [re, label] of PLANT_SECTIONS) {
        const at = h2.findIndex((t, i) => i >= from && re.test(t));
        if (at < 0) { err(h2.some((t) => re.test(t)) ? `la sección «${label}» está fuera de orden` : `falta la sección «${label}»`); continue; }
        from = at + 1;
      }
      if (!h2.some((t) => /poda/i.test(t))) warn("no hay ninguna sección sobre poda");
      const rapidos = p.body.match(/^##\s+cuidados rápidos\s*\n+(\|.*)/im);
      if (rapidos && !/^\|\s*necesidad\s*\|/i.test(rapidos[1])) err("la tabla de «Cuidados rápidos» debe empezar con la cabecera «Necesidad»");
      const i = hs.findIndex((h) => /^cuidados por estación$/i.test(h.text));
      if (i >= 0) {
        const seasons = [];
        for (const h of hs.slice(i + 1)) { if (h.level === 2) break; if (h.level === 3) seasons.push(h.text.toLowerCase()); }
        if (seasons.join() !== SEASONS.join()) err(`«Cuidados por estación» debe tener ### Primavera, Verano, Otoño e Invierno en ese orden (tiene: ${seasons.join(", ") || "nada"})`);
      }
    }
  }
  return issues;
}

export function report(issues) {
  for (const level of ["error", "warn"]) {
    const list = issues.filter((i) => i.level === level);
    if (!list.length) continue;
    console.log(`\n${level === "error" ? "ERRORES (impiden generar el blog)" : "AVISOS (consejos, no impiden nada)"}`);
    for (const i of list) console.log(`  ${i.file}: ${i.msg}`);
  }
  const e = issues.filter((i) => i.level === "error").length;
  const w = issues.length - e;
  console.log(`\nComprobación del blog: ${e} errores, ${w} avisos`);
  return e;
}
