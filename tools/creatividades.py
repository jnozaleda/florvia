"""Creatividades de Florvia: las 4 estaciones y los 3 pasos. Cada una es una textura (img/estilo/<nombre>.webp) y un dibujo de
líneas blancas encima (img/estilo/<nombre>.svg). Se usan en la web (fichas, portada, explorador) y se podrán usar en la app.

  python3 tools/creatividades.py   → escribe img/estilo/*.webp y *.svg (se suben al repo; no hace falta volver a generarlas)
Semillas fijas: el resultado es siempre el mismo. Necesita numpy y Pillow (las texturas usan tools/texturas.py).
"""
import math, random, importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'img' / 'estilo'
spec = importlib.util.spec_from_file_location('tex', ROOT / 'tools' / 'texturas.py'); tex = importlib.util.module_from_spec(spec); spec.loader.exec_module(tex)
C = tex.C
C.update({k: tex.hexrgb(v) for k, v in dict(amber='#e0a060', rust='#c27650', frost='#e3eaf1', ice='#b9cbdb', slate='#7d97b0', blossom='#f2cfd6').items()})
tex.OUT = OUT

# Colores suaves: el tono de cada estación sin competir con el texto.
PALS = {
    'primavera': [(0, C['leaf']), (0.35, C['sage']), (0.65, C['mist']), (0.85, C['blossom']), (1, C['cream'])],
    'verano': [(0, C['olive']), (0.3, C['gold']), (0.6, C['sun']), (1, C['cream'])],
    'otono': [(0, C['rust']), (0.35, C['amber']), (0.7, C['sun']), (1, C['cream'])],
    'invierno': [(0, C['slate']), (0.4, C['ice']), (0.75, C['frost']), (1, C['cream'])],
    'paso1': [(0, C['leafd']), (0.4, C['sage']), (0.75, C['mist']), (1, C['cream'])],
    'paso2': [(0, C['olive']), (0.4, C['sage']), (0.7, C['sun']), (1, C['cream'])],
    'paso3': [(0, C['slate']), (0.35, C['sage']), (0.7, C['frost']), (1, C['cream'])],
}

W, H = 400, 230
f = lambda n: f'{n:.1f}'
def leaf(x, y, a, l, w):
    ca, sa = math.cos(a), math.sin(a); tx, ty = x + ca * l, y + sa * l; nx, ny = -sa * w, ca * w; mx, my = x + ca * l * .45, y + sa * l * .45
    return f'<path class="lf" d="M{f(x)} {f(y)} Q{f(mx+nx)} {f(my+ny)} {f(tx)} {f(ty)} Q{f(mx-nx)} {f(my-ny)} {f(x)} {f(y)}Z"/><path class="nv" d="M{f(x)} {f(y)} L{f(tx)} {f(ty)}"/>'
def curve(x0, y0, x1, y1, bend, n=24):
    return [(x0 + (x1 - x0) * i / n + math.sin(i / n * math.pi) * bend, y0 + (y1 - y0) * i / n) for i in range(n + 1)]
def stem(pts): return '<path class="st" d="M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + '"/>'
def sprout(x, y, h, s=1):
    return f'<path class="st" d="M{x} {y} C{x} {y-h*.5} {x+6*s} {y-h*.8} {x} {y-h}"/>' + leaf(x, y - h * .7, -2.4, 34 * s, 11 * s) + leaf(x, y - h * .78, -.7, 38 * s, 12 * s)
def sun(cx, cy, r, rays=12, thin=False):
    o = [f'<circle class="fr" cx="{cx}" cy="{cy}" r="{r}"/>']
    for k in range(rays):
        a = k * 2 * math.pi / rays
        o.append(f'<path class="st{" thin" if thin else ""}" d="M{f(cx+(r+9)*math.cos(a))} {f(cy+(r+9)*math.sin(a))} L{f(cx+(r+22)*math.cos(a))} {f(cy+(r+22)*math.sin(a))}"/>')
    return ''.join(o)

def motif(kind):
    r = random.Random(kind); o = []
    if kind == 'primavera':
        o.append('<path class="st" d="M20 205 Q200 185 380 205"/>')
        for x, h, s in ((90, 70, .9), (170, 110, 1.15), (250, 85, 1), (320, 60, .8)): o.append(sprout(x, 200, h, s))
        for _ in range(9): o.append(f'<circle class="fr" cx="{r.uniform(30,370):.0f}" cy="{r.uniform(25,110):.0f}" r="{r.uniform(3,6):.1f}"/>')
    elif kind == 'verano':
        o.append(sun(300, 72, 30))
        pts = curve(60, 240, 150, 60, -40); o.append(stem(pts))
        for i in range(3, len(pts) - 1, 4):
            x, y = pts[i]; o.append(leaf(x, y, -2.5, 46, 14)); o.append(leaf(x, y, -.6, 46, 14))
    elif kind == 'otono':
        pts = curve(-10, 40, 260, 20, 40); o.append(stem(pts))
        for i in range(2, len(pts) - 2, 5): x, y = pts[i]; o.append(leaf(x, y, 1.3, 40, 13))
        for _ in range(8): o.append(leaf(r.uniform(40, 380), r.uniform(80, 210), r.uniform(0, 6.28), r.uniform(24, 36), r.uniform(8, 12)))
    elif kind == 'invierno':
        o.append(stem([(330, 240), (300, 150), (270, 90), (250, 40)])); o.append(stem([(300, 150), (350, 110)])); o.append(stem([(270, 90), (220, 70)]))
        for _ in range(9):
            x, y, s = r.uniform(30, 230), r.uniform(25, 200), r.uniform(9, 17)
            for k in range(3):
                a = k * math.pi / 3; o.append(f'<path class="st thin" d="M{f(x-s*math.cos(a))} {f(y-s*math.sin(a))} L{f(x+s*math.cos(a))} {f(y+s*math.sin(a))}"/>')
    elif kind == 'paso1':  # maceta con brote y etiqueta
        o.append('<path class="lf" d="M150 150 L250 150 L238 220 L162 220 Z"/><path class="st" d="M144 150 L256 150"/>')
        o.append(sprout(200, 150, 90, 1.2))
        o.append('<path class="st" d="M285 220 L285 120"/><rect class="lf" x="262" y="90" width="58" height="34" rx="6"/><path class="st thin" d="M272 103 L308 103 M272 112 L298 112"/>')
    elif kind == 'paso2':  # hoja grande y su ficha
        o.append(leaf(110, 200, -.95, 160, 46))
        o.append('<rect class="lf" x="230" y="50" width="120" height="150" rx="12"/>')
        for i, wdt in enumerate((80, 64, 88, 56, 72)): o.append(f'<path class="st thin" d="M248 {80+i*24} L{248+wdt} {80+i*24}"/>')
        o.append('<circle class="fr" cx="248" cy="80" r="4"/>')
    elif kind == 'paso3':  # regadera de jardín: cuerpo redondeado, asa en arco, pitorro largo con alcachofa y gotas; un sol pequeño
        o.append('<path class="lf" d="M118 214 L112 140 Q112 126 126 126 L206 126 Q220 126 220 140 L214 214 Z"/>')   # cuerpo
        o.append('<path class="st" d="M128 126 Q166 70 204 126"/>')                                                     # asa por arriba
        o.append('<path class="st" d="M218 196 L300 120"/><path class="st" d="M214 176 L292 112"/>')                  # pitorro (dos líneas)
        o.append('<path class="lf" d="M290 106 L312 96 L320 116 L300 126 Z"/>')                                         # alcachofa
        for x, y in ((326, 132), (318, 148), (336, 150), (328, 168), (344, 170)): o.append(f'<path class="lf" d="M{x} {y} q5 9 0 12 q-5 -3 0 -12z"/>')
        o.append('<path class="st thin" d="M128 150 L204 150"/>')
        o.append(sun(80, 60, 18, 8, True))
    return o

STYLE = ('<style>.st{fill:none;stroke:#fff;stroke-opacity:.9;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.thin{stroke-width:1.6}'
         '.lf{fill:#fff;fill-opacity:.22;stroke:#fff;stroke-opacity:.92;stroke-width:1.6;stroke-linejoin:round}.nv{stroke:#fff;stroke-opacity:.55;stroke-width:.9}'
         '.fr{fill:#fff;fill-opacity:.4;stroke:#fff;stroke-width:1.4}</style>')

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (k, pal) in enumerate(PALS.items()):
        tex.tinta(k, 900, 520, 101 + i * 7, pal, scale=1.1, swirl=2.2, blur=7)
        (OUT / f'{k}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">{STYLE}{"".join(motif(k))}</svg>\n')
    print('img/estilo:', ', '.join(PALS))
