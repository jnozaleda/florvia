// La imagen de cada planta en la web (explorador, portada, blog): la textura de su grupo (explorar/img, tools/texturas.py) y encima una
// ilustración dibujada aquí según su forma, con la semilla sacada del nombre: siempre la misma imagen para la misma planta.
//   FlorviaArte.banner({ name, species, group }, extraNode)  → <div class="banner"> con imagen, nombre y especie
//   Cualquier elemento con data-planta="Nombre" [data-especie] [data-grupo] recibe la imagen de fondo y el dibujo al cargar la página.
(() => {
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === "class") n.className = v; else if (k === "style") n.style.cssText = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
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
    } else if (kind === "hortensia") {
      // Big round heads made of small four-petal florets, broad leaves underneath.
      for (let b = 0; b < 3; b++) out.push(leaf(80 + b * 200 + uni(r, -20, 20), h + 5, -Math.PI / 2 + uni(r, -0.8, 0.8), uni(r, 80, 100), uni(r, 24, 30)));
      for (let b = 0; b < 4; b++) {
        const cx = 90 + b * 140 + uni(r, -25, 25), cy = uni(r, 70, 130), rad = uni(r, 42, 56);
        for (let k = 0; k < 26; k++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s2 = uni(r, 4.5, 6.5), rot = uni(r, 0, 90);
          for (let q = 0; q < 4; q++) out.push(`<ellipse class="fl" cx="${f1(x)}" cy="${f1(y - s2)}" rx="${f1(s2 * 0.55)}" ry="${f1(s2)}" transform="rotate(${f1(rot + q * 90)} ${f1(x)} ${f1(y)})"/>`);
        }
      }
    } else if (kind === "jazmin") {
      // A climbing stem with pairs of small leaves and white five-petal stars.
      for (let b = 0; b < 2; b++) {
        const pts = curve(-10 + b * 330, h + 10, 300 + b * 300, -10, uni(r, -70, 70), 30);
        out.push(stem(pts));
        for (let i = 2; i < pts.length - 1; i += 3) {
          const [x, y] = pts[i], a = Math.atan2(pts[i + 1][1] - y, pts[i + 1][0] - x);
          for (const sg of [-1, 1]) out.push(leaf(x, y, a + sg * 0.9, uni(r, 22, 30), 7));
          if (r() < 0.6) {
            const fx = x + uni(r, -26, 26), fy = y + uni(r, -26, 26);
            for (let q = 0; q < 5; q++) out.push(`<ellipse class="fl star" cx="${f1(fx)}" cy="${f1(fy - 7)}" rx="3.6" ry="7.5" transform="rotate(${q * 72} ${f1(fx)} ${f1(fy)})"/>`);
          }
        }
      }
    } else if (kind === "geranio") {
      // Rounded scalloped leaves low down and stems ending in round clusters of flowers.
      for (let b = 0; b < 5; b++) { const cx = 60 + b * 120 + uni(r, -20, 20), cy = h - uni(r, 10, 40); out.push(`<circle class="lf" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(uni(r, 26, 34))}"/><circle class="nv" fill="none" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(uni(r, 12, 16))}"/>`); }
      for (let b = 0; b < 4; b++) {
        const x0 = 90 + b * 140 + uni(r, -25, 25), pts = curve(x0, h - 20, x0 + uni(r, -30, 30), uni(r, 50, 100), uni(r, -15, 15), 12);
        out.push(stem(pts));
        const [cx, cy] = pts[pts.length - 1];
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2, x = cx + Math.cos(a) * 16, y = cy + Math.sin(a) * 14;
          for (let q = 0; q < 5; q++) out.push(`<ellipse class="fl" cx="${f1(x)}" cy="${f1(y - 5)}" rx="4" ry="5.5" transform="rotate(${q * 72} ${f1(x)} ${f1(y)})"/>`);
        }
      }
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
  // Plants with a picture of their own, by species (genus) or common name; the rest take their group's.
  const OWN = [
    [/^lavandula/, /lavanda|espliego|cantueso/, "lavanda", "lavanda"],
    [/^hydrangea/, /hortensia/, "hortensia", "hortensia"],
    [/^(jasminum|trachelospermum)/, /jazmin/, "jazmin", "jazmin"],
    [/^pelargonium/, /geranio|gitanilla|pelargonio/, "geranio", "geranio"],
    [/^bougainvillea/, /buganvilla/, "buganvilla", "buganvilla"],
  ];
  function look(name, species, group) {
    const sp = norm(species), nm = norm(name);
    const own = OWN.find(([re, words]) => re.test(sp) || words.test(nm));
    const seed = hash(norm(species || name));
    if (own) return { kind: own[2], texture: own[3], seed };
    return { kind: KIND[group] ?? "rama", texture: KIND[group] ? group : "otras", seed };
  }
  function banner({ name, species, group }, extra = null) {
    const lk = look(name, species, group);
    const b = el("div", { class: "banner", style: `background-image:url(/explorar/img/grupo-${lk.texture}.webp);background-position:${lk.seed % 100}% ${(lk.seed >>> 8) % 100}%` });
    b.insertAdjacentHTML("afterbegin", art(lk.kind, lk.seed));
    if (extra) b.append(extra);
    b.append(el("div", { class: "t" }, el("h2", {}, name), species ? el("p", {}, species) : null));
    return b;
  }

  function paint(node) {
    const lk = look(node.dataset.planta, node.dataset.especie, node.dataset.grupo);
    node.style.backgroundImage = `url(/explorar/img/grupo-${lk.texture}.webp)`;
    node.style.backgroundPosition = `${lk.seed % 100}% ${(lk.seed >>> 8) % 100}%`;
    node.insertAdjacentHTML("afterbegin", art(lk.kind, lk.seed));
  }
  window.FlorviaArte = { banner, art, look, paint };
  const run = () => document.querySelectorAll("[data-planta]").forEach(paint);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
