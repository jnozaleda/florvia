"""Imágenes «fluidas» de Florvia, generadas por código (sin fotos ni licencias). Mismo método que las de Hera.

  python3 tools/texturas.py   → escribe explorar/img/*.webp (se suben al repo; no hace falta volver a generarlas)

Motivos:
  luz-entre-hojas-*  Sol que se cuela entre las hojas: sombras de hoja y destellos de luz
  savia-*            Tinta en agua en verdes (deformación de dominio sobre ruido fractal)
  seda-*             Seda verde en movimiento
  planta-*           Una imagen propia para cada planta: la semilla sale del nombre y los colores de cómo es (flor, hoja, sol)
Semillas fijas: el resultado es siempre el mismo.
"""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "explorar" / "img"

def hexrgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float) / 255

C = {k: hexrgb(v) for k, v in dict(
    deep='#0f4628', deep2='#0b3320', night='#06210f', leaf='#2f8f4e', leafd='#23773f', sage='#a9cba7', mist='#e6efe3',
    cream='#fbf9f4', sun='#f3e3a6', gold='#e9c46a', olive='#9aa77a', silver='#c9d3c0', lav='#9b8ac4', lavd='#5d4f8a',
    lemon='#f2d64b', terra='#c8754b', rose='#e7a3b0').items()}

# ── Ruido ──────────────────────────────────────────────────────────────────────
class Noise:
    def __init__(self, seed):
        r = np.random.default_rng(seed)
        self.p = np.concatenate([r.permutation(256)] * 2)
        self.v = r.random(256)

    def value(self, x, y):
        xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
        xf, yf = x - xi, y - yi
        u, v = xf ** 3 * (xf * (xf * 6 - 15) + 10), yf ** 3 * (yf * (yf * 6 - 15) + 10)
        xi, yi = xi & 255, yi & 255
        p, val = self.p, self.v
        a = val[p[p[xi] + yi]]; b = val[p[p[xi + 1] + yi]]
        c = val[p[p[xi] + yi + 1]]; d = val[p[p[xi + 1] + yi + 1]]
        return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v

    def fbm(self, x, y, octaves=5, lac=2.0, gain=0.5):
        s, amp, norm = 0.0, 1.0, 0.0
        for i in range(octaves):
            ca, sa = np.cos(0.5 * i), np.sin(0.5 * i)
            s = s + amp * self.value((x * ca - y * sa) * lac ** i + i * 17.3, (x * sa + y * ca) * lac ** i - i * 9.1)
            norm += amp; amp *= gain
        return s / norm

def grid(w, h, scale):
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    return xs / w * scale * (w / h), ys / h * scale, xs / w, ys / h

def ramp(t, stops):
    """t en [0,1] → color interpolando entre [(pos, rgb), …]"""
    t = np.clip(t, 0, 1)[..., None]
    out = np.zeros(t.shape[:-1] + (3,))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = ((t >= p0) & (t <= p1)).astype(float)
        k = np.clip((t - p0) / max(p1 - p0, 1e-6), 0, 1)
        k = k * k * (3 - 2 * k)
        out = out * (1 - m) + (c0 + (c1 - c0) * k) * m
    return out

def save(arr, name, blur=0, grain=0.012, seed=0):
    arr = np.clip(arr, 0, 1)
    if grain:  # grano fino de película: evita bandas en los degradados
        arr = np.clip(arr + np.random.default_rng(seed).normal(0, grain, arr.shape[:2])[..., None], 0, 1)
    img = Image.fromarray((arr * 255).astype(np.uint8))
    if blur: img = img.filter(ImageFilter.GaussianBlur(blur))
    img.save(OUT / f'{name}.webp', quality=82, method=6)
    print(name, img.size, round((OUT / f'{name}.webp').stat().st_size / 1024), 'KB')

# ── 2. Tinta en agua ──────────────────────────────────────────────────────────
def tinta(name, w, h, seed, stops, scale=1.1, swirl=2.6, blur=7):
    n = Noise(seed)
    X, Y, u, v = grid(w, h, scale)
    qx = n.fbm(X, Y, 5); qy = n.fbm(X + 5.2, Y + 1.3, 5)
    rx = n.fbm(X + swirl * qx + 1.7, Y + swirl * qy + 9.2, 4)
    ry = n.fbm(X + swirl * qx + 8.3, Y + swirl * qy + 2.8, 4)
    f = n.fbm(X + swirl * rx, Y + swirl * ry, 4)
    t = (f - f.min()) / (f.max() - f.min())
    t = 0.75 * t + 0.25 * np.clip(np.hypot(qx - 0.5, ry - 0.5) * 2.2, 0, 1)
    save(ramp(t, stops), name, blur=blur, seed=seed)

# ── 3. Seda ───────────────────────────────────────────────────────────────────
def seda(name, w, h, seed, stops, angle=0.55, freq=7.0):
    n = Noise(seed)
    X, Y, u, v = grid(w, h, 1.0)
    asp = w / h
    warp = n.fbm(X * 0.9, Y * 0.9, 2) - 0.5
    warp2 = n.fbm(X * 0.5 + 7, Y * 0.5 - 3, 2) - 0.5
    ph = (u * asp * np.cos(angle) + v * np.sin(angle)) * freq + warp * 6.0 + np.sin(v * 3.0 + warp2 * 4) * 1.2
    hgt = np.sin(ph) + 0.35 * np.sin(ph * 2.1 + warp2 * 3)
    gy, gx = np.gradient(hgt)
    k = min(w, h) * 0.06
    nx, ny, nz = -gx * k, -gy * k, np.ones_like(gx)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    L = np.array([-0.45, -0.55, 0.7]); L /= np.linalg.norm(L)
    diff = np.clip((nx * L[0] + ny * L[1] + nz * L[2]) / ln, 0, 1)
    spec = np.clip(diff, 0, 1) ** 18
    t = np.clip(0.1 + 0.9 * diff ** 1.6 + 0.15 * (u - 0.5), 0, 1)
    img = ramp(t, stops) + 0.3 * spec[..., None] * C['cream']
    save(img, name, blur=2.5, seed=seed)



# ── 4. Luz entre hojas ──────────────────────────────────────────────────────
def luz_entre_hojas(name, w, h, seed, dark=True):
    n = Noise(seed)
    X, Y, u, v = grid(w, h, 2.4)
    # Fondo: verde profundo con un degradado de luz desde arriba a la derecha
    base = ramp(np.clip(0.35 + 0.65 * (v * 0.7 + (1 - u) * 0.5) + 0.15 * (n.fbm(X * 0.6, Y * 0.6, 3) - 0.5), 0, 1),
                [(0, C['leaf']), (0.45, C['deep']), (0.8, C['deep2']), (1, C['night'])] if dark else
                [(0, C['cream']), (0.4, C['mist']), (0.75, C['sage']), (1, C['olive'])])
    # Sombras de hojas: manchas alargadas (ruido estirado y girado)
    ang = 0.6
    Xr, Yr = X * np.cos(ang) - Y * np.sin(ang), X * np.sin(ang) + Y * np.cos(ang)
    leaves = n.fbm(Xr * 1.6, Yr * 4.2, 5)
    shade = np.clip((leaves - 0.48) * 3.2, 0, 1)
    # Destellos: luz que pasa entre las hojas (bokeh suave)
    r = np.random.default_rng(seed + 3)
    bok = np.zeros((h, w))
    for _ in range(int(w * h / 26000)):
        cx, cy = r.uniform(0, 1), r.uniform(0, 1)
        rad = r.uniform(0.006, 0.03) * (1.6 if r.random() < 0.15 else 1)
        bok += np.exp(-(((u - cx) * w / h) ** 2 + (v - cy) ** 2) / rad ** 2) * r.uniform(0.25, 0.9)
    gaps = np.clip((0.5 - leaves) * 4, 0, 1)
    light = np.clip(bok * (0.25 + gaps), 0, 1.2)
    warm = C['sun'] if dark else C['cream']
    img = base * (1 - (0.45 if dark else 0.25) * shade[..., None]) + (warm - base) * np.clip(light * (0.75 if dark else 0.5), 0, 1)[..., None]
    save(img, name, blur=1.2, seed=seed)

# ── 5. Una imagen por planta ─────────────────────────────────────────────────
def planta(name, label, palette, w=1200, h=520, swirl=2.4):
    seed = int(hashlib.sha256(label.encode()).hexdigest()[:8], 16) % 100000
    tinta(name, w, h, seed, palette, scale=1.0, swirl=swirl, blur=6)



# Una textura por grupo de plantas (content/conocimiento): el explorador elige la del grupo y la desplaza según el nombre de la planta.
GROUPS = {
    'mediterraneas': [(0, C['deep']), (0.35, C['olive']), (0.7, C['silver']), (1, C['cream'])],
    'lavanda': [(0, C['deep2']), (0.3, C['lavd']), (0.6, C['lav']), (0.85, C['silver']), (1, C['cream'])],
    'citricos': [(0, C['deep']), (0.35, C['leaf']), (0.65, C['lemon']), (0.9, C['sun']), (1, C['cream'])],
    'arbustos-de-flor': [(0, C['deep']), (0.35, C['leafd']), (0.62, C['rose']), (0.85, C['terra']), (1, C['cream'])],
    'suculentas': [(0, C['deep2']), (0.35, C['olive']), (0.62, C['silver']), (0.85, C['rose']), (1, C['cream'])],
    'interior': [(0, C['night']), (0.3, C['deep']), (0.6, C['leaf']), (0.85, C['sage']), (1, C['mist'])],
    'huerto': [(0, C['deep']), (0.35, C['leaf']), (0.6, C['gold']), (0.85, C['terra']), (1, C['cream'])],
    'otras': [(0, C['deep']), (0.35, C['leafd']), (0.65, C['sage']), (1, C['cream'])],
}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    luz_entre_hojas('luz-entre-hojas', 1800, 1000, 7, dark=True)
    tinta('savia-clara', 1200, 800, 42, [(0, C['cream']), (0.35, C['mist']), (0.65, C['sage']), (0.88, C['leaf']), (1, C['deep'])])
    for i, (g, pal) in enumerate(GROUPS.items()):
        planta(f'grupo-{g}', g, pal, w=1400, h=600)
