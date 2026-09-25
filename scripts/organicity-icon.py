#!/usr/bin/env python3
"""Draw the Organicity app icon (organicity/icon.svg, pixel for pixel) as a 512x512 PNG for the
desktop packages: python3 scripts/organicity-icon.py  ->  desktop/resources/icon.png"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 8                       # the SVG is 64x64; every unit becomes an 8x8 block
img = Image.new('RGBA', (64 * S, 64 * S), '#161b24')
d = ImageDraw.Draw(img)
rect = lambda x, y, w, h, c: d.rectangle([x * S, y * S, (x + w) * S - 1, (y + h) * S - 1], fill=c)

rect(0, 44, 64, 20, '#5d8a3a')
# the road: M0 50 Q20 40 34 48 T64 44 V52 Q44 50 32 56 T0 58 Z, sampled along both curves
def quad(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]
top = quad((0, 50), (20, 40), (34, 48)) + quad((34, 48), (48, 56), (64, 44))
bottom = quad((64, 52), (44, 50), (32, 56)) + quad((32, 56), (20, 62), (0, 58))
d.polygon([(x * S, y * S) for x, y in top + bottom], fill='#3a3f48')
for x, y, w, h, c in [(8, 26, 10, 20, '#d8dde2'), (20, 14, 12, 32, '#6f9ac0'), (34, 22, 9, 24, '#c8784a'), (45, 30, 11, 16, '#e8c040'),
                      (23, 18, 2, 2, '#ffd35a'), (27, 24, 2, 2, '#ffd35a'), (11, 30, 2, 2, '#ffd35a')]:
    rect(x, y, w, h, c)

out = Path(__file__).resolve().parent.parent / 'desktop' / 'resources' / 'icon.png'
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out)
print(out)
