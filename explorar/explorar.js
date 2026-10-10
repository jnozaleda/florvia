// Explorador web: busca una planta en las fichas que ya tenemos (GET /explore y GET /explore/plants). Solo lectura: no llama a la IA.
(() => {
  const API = "https://api.florvia.app";
  const $ = (id) => document.getElementById(id);
  const SEASONS = [["spring", "Primavera"], ["summer", "Verano"], ["autumn", "Otoño"], ["winter", "Invierno"]];
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === "class") n.className = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const appLink = (name) => `/app/?ref=explorar#anadir=${encodeURIComponent(name)}`;
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
    const g = r.general, z = r.zone;
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
      z ? el("p", { class: "meta" }, el("span", { class: "zone" }, `Zona de referencia: ${z.place}`)) : null,
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
    return out;
  }

  function similar(typed) {
    const t = norm(typed);
    if (!t) return [];
    return plants.filter((p) => { const n = norm(p.name), s = norm(p.species); return n.includes(t) || t.includes(n) || s.includes(t) || t.split(" ").some((w) => w.length > 3 && (n.includes(w) || s.includes(w))); }).slice(0, 4);
  }
  function renderProblem(title, text) {
    return el("section", {}, el("div", { class: "empty" }, el("b", {}, title), el("p", {}, text), el("a", { class: "btn line", href: "#plantas" }, "Ver otras plantas")));
  }
  // A plant we don't have yet: the AI writes its sheet (for the reference zone) and it is kept for everyone.
  const GENERAL = ["commonName", "species", "difficulty", "sunNeed", "sunSensitive", "frostSensitive", "minTemp", "plantIn", "potAdvice", "waterHow", "toxic", "toxicNote", "notes"];
  async function generate(name) {
    const res = await fetch(`${API}/care`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, lat: 40.4, lon: -3.7, place: "Madrid", src: "explore" }) });
    if (res.status === 422) return renderProblem(`«${name}» no parece una planta`, "Revisa cómo está escrito o prueba con su nombre común o científico.");
    if (res.status === 429 || res.status === 503) return renderProblem("Hoy no podemos preparar fichas nuevas", "Hemos llegado al límite de consultas de hoy. Vuelve mañana, o busca una planta que ya tengamos.");
    if (!res.ok) throw new Error();
    const c = await res.json();
    if (!plants.some((p) => p.name === c.commonName)) plants.push({ name: c.commonName, species: c.species });
    return renderFound({ general: Object.fromEntries(GENERAL.map((k) => [k, c[k]])), zone: c.seasons ? { place: "Madrid", seasons: c.seasons, feedTypes: c.feedTypes, tips: c.tips, climateNote: c.climateNote } : null });
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
      if (!data.found) out.replaceChildren(msg("Todavía no la teníamos: estamos preparando su ficha, tarda unos segundos…"));
      const view = data.found ? renderFound(data) : await generate(name);
      out.replaceChildren(view);
      const title = view.querySelector("h2")?.textContent;
      if (title) document.title = `${title}: cuidados por zona | Florvia`;
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
    const card = (p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, el("b", {}, p.name), p.species ? el("span", {}, p.species) : null));
    $("chips").replaceChildren(...plants.slice(0, 7).map((p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, p.name))));
    $("hub").replaceChildren(...plants.map(card));
    const q = new URLSearchParams(location.search).get("q");
    if (q) search(q, false);
  }
  init();
})();
