// Explorador web: busca una planta en las fichas que ya tenemos (GET /explore, GET /explore/plants) y, si no está, la prepara con la IA
// (POST /care, como al añadirla en la app). Al cambiar este archivo, sube el ?v= de su <script> en explorar/index.html (si no, el navegador mezcla versiones). Cada planta lleva una imagen propia: la textura de su grupo (explorar/img, tools/texturas.py)
// y encima una ilustración dibujada aquí según su forma, con la semilla sacada del nombre (siempre la misma para la misma planta).
(() => {
  const API = "https://api.florvia.app";
  const ZONE = { lat: 40.4, lon: -3.7, place: "Madrid" };
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === "class") n.className = v; else if (k === "style") n.style.cssText = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const appLink = (name) => `/app/?ref=explorar#anadir=${encodeURIComponent(name)}`;
  let plants = [];

  // ---------- Iconos ----------
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    drop: '<path d="M7.5 19.4a7.2 7.2 0 0 0 9 0 6.5 6.5 0 0 0 1.6-8.5l-4.9-7.3a1.4 1.4 0 0 0-2.4 0l-4.9 7.3a6.5 6.5 0 0 0 1.6 8.5z"/>',
    temp: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
    feed: '<path d="M9 3h6M10 9h4M10 3v6l-4 11a.7.7 0 0 0 .5 1h11a.7.7 0 0 0 .5-1l-4-11V3"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.3"/>',
    spring: '<path d="M12 20v-8"/><path d="M12 12c0-3 2-5 5.5-5 0 3-2 5-5.5 5zM12 14c0-2.5-1.8-4-4.5-4 0 2.5 1.8 4 4.5 4z"/>',
    autumn: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>',
    winter: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  };
  const ic = (k) => { const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("class", "ic"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[k]; return s; };

  const { banner } = window.FlorviaArte;

  // ---------- Textos ----------
  const SEASONS = [["spring", "Primavera", "spring", "s1"], ["summer", "Verano", "sun", "s2"], ["autumn", "Otoño", "autumn", "s3"], ["winter", "Invierno", "winter", "s4"]];
  const every = (n) => (n >= 300 ? "1 vez al año" : `Cada ${n} días`);
  const SUN = { sun: "Pleno sol", partial: "Media sombra", shade: "Sombra" };
  const WHERE = { maceta: "Mejor en maceta", suelo: "Mejor en suelo", ambos: "En maceta o en suelo" };
  const toxicText = (g) => [{ mascotas: "Tóxica para mascotas", personas: "Tóxica para personas", ambos: "Tóxica para mascotas y personas" }[g.toxic] ?? (g.toxicNote ? "" : "No consta que sea tóxica"), g.toxicNote].filter(Boolean).join(". ");
  const tile = (icon, label, value) => el("div", { class: "tile" }, ic(icon), el("small", {}, label), el("b", {}, value));

  function renderFound(r) {
    const g = r.general, z = r.zone;
    const feeds = z?.seasons ? SEASONS.map(([k]) => Number(z.seasons[k]?.feed) || 0).filter((n) => n > 0) : [];
    const tiles = [
      SUN[g.sunNeed] ? tile("sun", "Luz", SUN[g.sunNeed]) : null,
      z?.seasons ? tile("drop", "Riego en verano", every(Number(z.seasons.summer?.water) || 0)) : null,
      g.minTemp != null ? tile("temp", "Frío", `Hasta ${g.minTemp} °C`) : null,
      z?.seasons ? tile("feed", "Abono", feeds.length ? every(Math.min(...feeds)) : "No necesita") : null,
    ].filter(Boolean);
    const info = [["Cómo regar", g.waterHow], ["Dónde", [WHERE[g.plantIn], g.potAdvice].filter(Boolean).join(". ")], [`En ${z?.place ?? "tu zona"}`, z?.climateNote], ["Toxicidad", toxicText(g)]].filter(([, v]) => v);
    const pin = z ? el("span", { class: "zone pill glass" }, ic("pin"), ` ${z.place}`) : null;
    const phone = el("div", { class: "ph" }, el("img", { src: "/img/ficha.jpg", width: "540", height: "1169", alt: "La ficha de una planta en la app", loading: "lazy" }));
    return el("article", { class: "card", id: "ficha" },
      banner({ name: g.commonName, species: g.species, group: r.group }, pin),
      el("div", { class: "body" },
        g.notes ? el("p", { class: "lead" }, g.notes) : null,
        tiles.length ? el("div", { class: "tiles" }, tiles) : null,
        z?.seasons ? [el("h3", {}, `Su año en ${z.place}`), el("div", { class: "seasons" }, SEASONS.map(([k, label, icon, cls]) => {
          const s = z.seasons[k] ?? {};
          const key = { spring: "primavera", summer: "verano", autumn: "otono", winter: "invierno" }[k];
          const crea = el("div", { class: "crea", style: `background-image:url(/img/estilo/${key}.webp)` }, el("img", { src: `/img/estilo/${key}.svg`, alt: "", loading: "lazy" }));
          return el("div", { class: `season ${cls}` }, crea, el("div", { class: "in" }, el("em", {}, label), el("b", {}, every(Number(s.water) || 0)), Number(s.feed) > 0 ? el("span", { class: "feed" }, `Abono: ${every(Number(s.feed)).toLowerCase()}`) : null, z.tips?.[k] ? el("p", {}, z.tips[k]) : null));
        })), el("p", { class: "note" }, "Días de riego orientativos, para una maceta mediana al aire libre. En suelo, mucho menos.")] : null,
        info.length ? el("dl", { class: "more-info" }, info.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v)))) : null,
        el("div", { class: "cta" }, el("div", { class: "txt" }, el("b", {}, "¿La tienes en casa?"), el("p", {}, "Añádela a Florvia y te avisamos cuándo regarla, abonarla o protegerla, con el tiempo de tu zona."), el("a", { class: "pill cream", href: appLink(g.commonName) }, "Añadir a mi jardín")), phone)));
  }
  const panel = (name, ...kids) => el("article", { class: "card" }, banner({ name, species: "", group: "" }), el("div", { class: "body" }, kids));
  const loading = (name) => { const c = panel(name, el("p", {}, el("span", { class: "spin", "aria-hidden": "true" }), "Todavía no la teníamos: estamos preparando su ficha. Tarda unos segundos…")); c.classList.add("loading"); return c; };
  const problem = (name, title, text) => panel(name, el("h3", { style: "margin-top:0" }, title), el("p", {}, text), el("a", { class: "pill line", href: "#plantas" }, "Ver otras plantas"));

  // A plant we don't have yet: the AI writes its sheet (for the reference zone) and it is kept for everyone.
  const GENERAL = ["commonName", "species", "difficulty", "sunNeed", "sunSensitive", "frostSensitive", "minTemp", "plantIn", "potAdvice", "waterHow", "toxic", "toxicNote", "notes"];
  async function generate(name) {
    const res = await fetch(`${API}/care`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...ZONE, src: "explore" }) });
    if (res.status === 422) return problem(name, `«${name}» no parece una planta`, "Revisa cómo está escrito o prueba con su nombre común o científico.");
    if (res.status === 429 || res.status === 503) return problem(name, "Hoy no podemos preparar fichas nuevas", "Hemos llegado al límite de consultas de hoy. Vuelve mañana, o mira una de las plantas que ya tenemos.");
    if (!res.ok) throw new Error();
    const c = await res.json();
    const group = String(c.knowledge ?? "").split("@")[0];
    if (!plants.some((p) => p.name === c.commonName)) plants.push({ name: c.commonName, species: c.species, group });
    return renderFound({ group, general: Object.fromEntries(GENERAL.map((k) => [k, c[k]])), zone: c.seasons ? { place: ZONE.place, seasons: c.seasons, feedTypes: c.feedTypes, tips: c.tips, climateNote: c.climateNote } : null });
  }

  async function search(name, push = true) {
    const out = $("out");
    name = name.trim().slice(0, 80);
    $("q").value = name;
    if (!name) { out.replaceChildren(); document.title = "Explorar plantas: cuidados por zona | Florvia"; return; }
    if (push) history.pushState({}, "", `?q=${encodeURIComponent(name)}`);
    const show = (node) => { out.replaceChildren(node); if (push) node.scrollIntoView({ behavior: "smooth", block: "start" }); };
    try {
      const res = await fetch(`${API}/explore?name=${encodeURIComponent(name)}`);
      if (res.status === 429) return show(problem(name, "Muchas búsquedas por hoy", "Vuelve mañana o abre la app para seguir."));
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.found) show(loading(name));
      const view = data.found ? renderFound(data) : await generate(name);
      show(view);
      const title = view.querySelector("h2")?.textContent;
      if (title) document.title = `${title}: cuidados por zona | Florvia`;
    } catch { show(problem(name, "No hemos podido buscar ahora", "Inténtalo de nuevo en un momento.")); }
  }

  // ---------- Plantas para explorar ----------
  const FIRST = 9;
  const mini = (p) => el("a", { class: "mini", href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, banner(p), el("span", {}, "Ver su ficha →"));
  function renderHub(all = false) {
    $("hub").replaceChildren(...(all ? plants : plants.slice(0, FIRST)).map(mini));
    $("all").hidden = all || plants.length <= FIRST;
    $("all").textContent = `Ver todas (${plants.length})`;
  }

  async function init() {
    $("form").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
    document.addEventListener("click", (e) => { const a = e.target.closest("[data-q]"); if (a) { e.preventDefault(); search(a.dataset.q); } });
    $("all").addEventListener("click", () => renderHub(true));
    window.addEventListener("popstate", () => search(new URLSearchParams(location.search).get("q") ?? "", false));
    try { const res = await fetch(`${API}/explore/plants`); if (res.ok) plants = (await res.json()).plants ?? []; } catch {}
    const rank = { revisada: 0, fuentes: 1, ia: 2 };
    plants.sort((a, b) => ((rank[a.level] ?? 3) - (rank[b.level] ?? 3)) || a.name.localeCompare(b.name, "es"));
    $("chips").replaceChildren(...plants.slice(0, 6).map((p) => el("li", {}, el("a", { href: `?q=${encodeURIComponent(p.name)}`, "data-q": p.name }, p.name))));
    renderHub();
    const q = new URLSearchParams(location.search).get("q");
    if (q) search(q, false);
  }
  init();
})();
