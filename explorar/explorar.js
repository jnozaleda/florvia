// Explorador web: busca una planta en las fichas que ya tenemos (GET /explore y GET /explore/plants). Solo lectura: no llama a la IA.
(() => {
  const API = "https://api.florvia.app";
  const $ = (id) => document.getElementById(id);
  const LEVEL = {
    revisada: { badge: "Ficha revisada", note: "Escrita a mano a partir de fuentes de referencia y comprobada por Claude. Todavía no la ha revisado un experto." },
    fuentes: { badge: "Con datos de fuentes", note: "Generada con IA a partir de datos de fuentes de referencia." },
    ia: { badge: "Generada con IA", note: "Generada con IA. Puede tener errores: contrástala antes de actuar." },
  };
  const SEASONS = [["spring", "Primavera"], ["summer", "Verano"], ["autumn", "Otoño"], ["winter", "Invierno"]];
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === "class") n.className = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const appLink = (name) => `/app/?ref=explorar#anadir=${encodeURIComponent(name)}`;
  const longDate = (iso) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(+d) ? "" : d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }); };
  let plants = [];

  function every(n) { return n >= 300 ? "1 vez al año" : `cada ${n} días`; }
  function feedText(zone) {
    if (!zone?.seasons) return "";
    const parts = SEASONS.filter(([k]) => Number(zone.seasons[k]?.feed) > 0).map(([k, label]) => `${label}: ${every(Number(zone.seasons[k].feed))}${zone.feedTypes?.[k] ? `. ${zone.feedTypes[k]}` : ""}`);
    return parts.length ? parts.join(" · ") : "Normalmente no necesita abono.";
  }
  const SUN = { sun: "Sol directo, 6 horas o más", partial: "Media sombra: sol suave o unas horas", shade: "Sombra" };
  const WHERE = { maceta: "Mejor en maceta", suelo: "Mejor en suelo", ambos: "Vale en maceta o en suelo" };
  const DIFF = { facil: "Fácil", media: "Media", exigente: "Exigente" };
  function toxicText(g) {
    const who = { mascotas: "Tóxica para mascotas", personas: "Tóxica para personas", ambos: "Tóxica para mascotas y personas" }[g.toxic];
    return [who ?? (g.toxicNote ? "" : "No consta que sea tóxica"), g.toxicNote].filter(Boolean).join(". ");
  }
  function row(label, text) { return text ? el("tr", {}, el("th", { scope: "row" }, label), el("td", {}, text)) : null; }

  function renderFound(r) {
    const g = r.general, z = r.zone, lvl = LEVEL[r.level] ?? LEVEL.ia;
    const rows = [
      row("Luz", [SUN[g.sunNeed], g.sunSensitive ? "El sol directo puede dañarla." : ""].filter(Boolean).join(". ")),
      row("Riego", g.waterHow),
      row("Abono", feedText(z)),
      row("Temperatura", [g.minTemp != null ? `Aguanta hasta ${g.minTemp} °C` : "", z?.climateNote ?? ""].filter(Boolean).join(". ")),
      row("Dónde", [WHERE[g.plantIn], g.potAdvice].filter(Boolean).join(". ")),
      row("Dificultad", DIFF[g.difficulty]),
      row("Toxicidad", toxicText(g)),
    ].filter(Boolean);
    const out = el("section", {},
      el("h2", { id: "ficha" }, g.commonName),
      el("p", { class: "meta" }, z ? el("span", { class: "zone" }, `Zona de referencia: ${z.place}`) : null, " ", el("span", { class: "badge" }, `${lvl.badge}${r.updated ? ` · ${longDate(r.updated)}` : ""}`)),
      g.species ? el("p", { class: "meta" }, g.species) : null,
      g.notes ? el("p", {}, g.notes) : null,
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Necesidad"), el("th", {}, "Recomendación"))), el("tbody", {}, rows))),
    );
    if (z?.seasons) {
      out.append(el("h3", {}, `Por estación en ${z.place}`));
      out.append(el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Estación"), el("th", {}, "Qué hacer"))), el("tbody", {}, SEASONS.map(([k, label]) => {
        const s = z.seasons[k] ?? {};
        const line = [`Regar ${every(Number(s.water) || 0)}`, Number(s.feed) > 0 ? `Abonar ${every(Number(s.feed))}` : "Sin abono"].join(" · ");
        return el("tr", {}, el("th", { scope: "row" }, label), el("td", {}, el("b", {}, line), z.tips?.[k] ? el("br") : null, z.tips?.[k] ?? ""));
      })))));
      out.append(el("p", { class: "meta" }, "Los días de riego son orientativos, para una maceta mediana al aire libre. En suelo, mucho menos."));
    }
    out.append(el("div", { class: "cta" }, el("b", {}, "¿La tienes en casa?"),
      el("p", {}, "Añádela a Florvia y te diremos cuándo regarla, abonarla o podarla según la época del año y el tiempo donde vives."),
      el("a", { class: "btn cream", href: appLink(g.commonName) }, "Añadir a mi jardín")));
    out.append(el("p", { class: "meta" }, lvl.note));
    return out;
  }

  function similar(typed) {
    const t = norm(typed);
    if (!t) return [];
    return plants.filter((p) => { const n = norm(p.name), s = norm(p.species); return n.includes(t) || t.includes(n) || s.includes(t) || t.split(" ").some((w) => w.length > 3 && (n.includes(w) || s.includes(w))); }).slice(0, 4);
  }
  function renderMissing(name) {
    const sim = similar(name);
    return el("section", {},
      el("div", { class: "empty" }, el("b", {}, `Todavía no tenemos «${name}»`),
        el("p", {}, "Aún no hemos preparado su ficha. Ábrela en la app: la IA la prepara para tu zona en unos segundos y la guardamos para el resto."),
        el("a", { class: "btn", href: appLink(name) }, "Abrir en la app"), " ", el("a", { class: "btn line", href: "#plantas" }, "Ver otras plantas")),
      sim.length ? [el("h3", {}, "Quizá buscabas"), el("ul", { class: "chips" }, sim.map((p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, p.name))))] : null);
  }
  const msg = (text) => el("p", { class: "meta" }, text);

  async function search(name, push = true) {
    const out = $("out");
    name = name.trim().slice(0, 80);
    $("q").value = name;
    if (!name) { out.replaceChildren(); return; }
    if (push) history.pushState({}, "", `?q=${encodeURIComponent(name)}`);
    out.replaceChildren(msg("Buscando…"));
    try {
      const res = await fetch(`${API}/explore?name=${encodeURIComponent(name)}`);
      if (res.status === 429) return out.replaceChildren(msg("Has hecho muchas búsquedas hoy. Vuelve mañana o abre la app."));
      if (!res.ok) throw new Error();
      const data = await res.json();
      out.replaceChildren(data.found ? renderFound(data) : renderMissing(name));
      if (data.found) document.title = `${data.general.commonName}: cuidados por zona | Florvia`;
    } catch { out.replaceChildren(msg("No hemos podido buscar ahora. Inténtalo de nuevo en un momento.")); }
  }

  async function init() {
    $("form").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
    document.addEventListener("click", (e) => { const a = e.target.closest("[data-q]"); if (a) { e.preventDefault(); search(a.dataset.q); window.scrollTo({ top: 0, behavior: "smooth" }); } });
    window.addEventListener("popstate", () => search(new URLSearchParams(location.search).get("q") ?? "", false));
    try {
      const res = await fetch(`${API}/explore/plants`);
      if (res.ok) plants = (await res.json()).plants ?? [];
    } catch {}
    const rank = { revisada: 0, fuentes: 1, ia: 2 };
    plants.sort((a, b) => (rank[a.level] - rank[b.level]) || a.name.localeCompare(b.name, "es"));
    // Arriba, las fichas revisadas o con datos de fuentes; las generadas solo con IA van aparte y avisadas (se pueden buscar igualmente).
    const good = plants.filter((p) => p.level !== "ia"), raw = plants.filter((p) => p.level === "ia");
    const card = (p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, el("b", {}, p.name), el("span", {}, `${p.species ?? ""}${p.species ? " · " : ""}${(LEVEL[p.level] ?? LEVEL.ia).badge}`)));
    $("chips").replaceChildren(...good.slice(0, 7).map((p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, p.name))));
    $("hub").replaceChildren(...good.map(card));
    if (raw.length) $("more").replaceChildren(el("details", {}, el("summary", {}, `Otras plantas (${raw.length}), generadas con IA y sin revisar`), el("ul", { class: "hub" }, raw.map(card))));
    const q = new URLSearchParams(location.search).get("q");
    if (q) search(q, false);
  }
  init();
})();
