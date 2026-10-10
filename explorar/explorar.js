// Explorador web: busca una planta en las fichas que ya tenemos (GET /explore, GET /explore/plants) y, si no está, la prepara con la IA
// (POST /care, como al añadirla en la app). Cada planta lleva una imagen propia: la textura de su grupo (explorar/img, tools/texturas.py)
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

  // ---------- La imagen de cada planta ----------
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f1 = (n) => n.toFixed(1);
  function leaf(x, y, a, len, wid, cls = "lf") {
    const ca = Math.cos(a), sa = Math.sin(a), tx = x + ca * len, ty = y + sa * len, nx = -sa * wid, ny = ca * wid;
    const mx = x + ca * len * 0.45, my = y + sa * len * 0.45;
    return `<path class="${cls}" d="M${f1(x)} ${f1(y)} Q${f1(mx + nx)} ${f1(my + ny)} ${f1(tx)} ${f1(ty)} Q${f1(mx - nx)} ${f1(my - ny)} ${f1(x)} ${f1(y)}Z"/><path class="nv" d="M${f1(x)} ${f1(y)} L${f1(tx)} ${f1(ty)}"/>`;
  }
  const curve = (x0, y0, x1, y1, bend, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [x0 + (x1 - x0) * t + Math.sin(t * Math.PI) * bend, y0 + (y1 - y0) * t]; });
  const stem = (pts) => `<path class="st" d="M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L")}"/>`;
  const uni = (r, a, b) => a + r() * (b - a);
  const pickOf = (r, list) => list[Math.floor(r() * list.length)];
  function art(kind, seed, w = 600, h = 260) {
    const r = rng(seed), out = [];
    const branch = (count, leafLen, leafWid, opposite, fruit) => {
      for (let b = 0; b < count; b++) {
        const x0 = 90 + b * (w - 140) / Math.max(1, count - 1) + uni(r, -30, 30);
        const pts = curve(x0, h + 10, x0 + uni(r, -60, 120), uni(r, 20, 80), uni(r, -45, 45));
        out.push(stem(pts));
        for (let i = 2; i < pts.length - 1; i += 3) {
          const [x, y] = pts[i], a = Math.atan2(pts[i + 1][1] - y, pts[i + 1][0] - x);
          if (opposite) for (const s of [-1, 1]) out.push(leaf(x, y, a + s * uni(r, 0.5, 0.8), uni(r, leafLen * 0.8, leafLen * 1.1), leafWid));
          else out.push(leaf(x, y, a + (i % 2 ? 1 : -1) * uni(r, 0.7, 1.1), uni(r, leafLen * 0.8, leafLen * 1.1), leafWid));
        }
        if (fruit) for (let k = 0; k < fruit.n; k++) { const [x, y] = pickOf(r, pts.slice(5, -3)); out.push(`<ellipse class="${fruit.cls}" cx="${f1(x + uni(r, -16, 16))}" cy="${f1(y + 14)}" rx="${fruit.rx}" ry="${fruit.ry}"/>`); }
      }
    };
    if (kind === "olivo") branch(3, 46, 6, true, { n: 3, cls: "fr", rx: 6, ry: 8 });
    else if (kind === "rama") branch(3, 44, 9, true, null);
    else if (kind === "limonero") branch(3, 56, 14, false, { n: 1, cls: "fr lemon", rx: 17, ry: 13 });
    else if (kind === "huerto") branch(4, 40, 13, false, { n: 2, cls: "fr berry", rx: 9, ry: 9 });
    else if (kind === "lavanda") {
      for (let s = 0; s < 9; s++) {
        const x0 = 40 + s * 64 + uni(r, -18, 18), pts = curve(x0, h + 10, x0 + uni(r, -25, 25), uni(r, 25, 90), uni(r, -12, 12), 16);
        out.push(stem(pts));
        for (let i = 0; i < 6; i++) { const [x, y] = pts[pts.length - 1 - i]; for (const k of [-1, 1]) out.push(`<ellipse class="fl" cx="${f1(x + k * 5)}" cy="${f1(y + 2)}" rx="4.2" ry="6.5" transform="rotate(${k * 25} ${f1(x + k * 5)} ${f1(y + 2)})"/>`); }
      }
    } else if (kind === "buganvilla") {
      for (let b = 0; b < 2; b++) out.push(stem(curve(80 + b * 300, h + 10, 280 + b * 300, -10, 60)));
      for (let b = 0; b < 14; b++) { const cx = uni(r, 30, w - 30), cy = uni(r, 30, h - 30); for (let k = 0; k < 3; k++) out.push(leaf(cx, cy, k * 2.094 + uni(r, -0.2, 0.2), uni(r, 22, 30), uni(r, 11, 14), "br")); }
    } else if (kind === "roseta") {
      for (let b = 0; b < 3; b++) {
        const cx = 110 + b * 190 + uni(r, -30, 30), cy = uni(r, 120, 200), n = 9 + Math.floor(r() * 4);
        for (let k = 0; k < n; k++) out.push(leaf(cx, cy, (k / n) * Math.PI * 2 + uni(r, -0.1, 0.1), uni(r, 50, 70), uni(r, 13, 17)));
        for (let k = 0; k < 6; k++) out.push(leaf(cx, cy, (k / 6) * Math.PI * 2 + 0.5, uni(r, 22, 30), 9));
      }
    } else if (kind === "grande") {
      for (let b = 0; b < 4; b++) {
        const x0 = 70 + b * 150 + uni(r, -30, 30), pts = curve(x0, h + 10, x0 + uni(r, -50, 50), uni(r, 90, 150), uni(r, -30, 30), 12);
        out.push(stem(pts)); const [x, y] = pts[pts.length - 1];
        out.push(leaf(x, y, -Math.PI / 2 + uni(r, -0.9, 0.9), uni(r, 100, 130), uni(r, 34, 44)));
      }
    }
    return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out.join("")}</svg>`;
  }
  const KIND = { mediterraneas: "olivo", citricos: "limonero", "arbustos-de-flor": "buganvilla", suculentas: "roseta", interior: "grande", huerto: "huerto" };
  function look(name, species, group) {
    const lav = /^lavandula/i.test(species ?? "") || /lavanda|espliego/.test(norm(name));
    const texture = lav ? "lavanda" : KIND[group] ? group : "otras";
    return { kind: lav ? "lavanda" : KIND[group] ?? "rama", texture, seed: hash(norm(species || name)) };
  }
  function banner({ name, species, group }, extra = null) {
    const lk = look(name, species, group);
    const b = el("div", { class: "banner", style: `background-image:url(/explorar/img/grupo-${lk.texture}.webp);background-position:${lk.seed % 100}% ${(lk.seed >>> 8) % 100}%` });
    b.insertAdjacentHTML("afterbegin", art(lk.kind, lk.seed));
    if (extra) b.append(extra);
    b.append(el("div", { class: "t" }, el("h2", {}, name), species ? el("p", {}, species) : null));
    return b;
  }

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
          return el("div", { class: `season ${cls}` }, ic(icon), el("em", {}, label), el("b", {}, every(Number(s.water) || 0)), Number(s.feed) > 0 ? el("span", { class: "feed" }, `Abono: ${every(Number(s.feed)).toLowerCase()}`) : null, z.tips?.[k] ? el("p", {}, z.tips[k]) : null);
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
