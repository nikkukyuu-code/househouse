#!/usr/bin/env python3
"""Generate original photographic-looking tile textures + furniture sprites for ハウスと罠."""
from __future__ import annotations

import math
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageChops

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / "game" / "assets" / "textures"
FURN = ROOT / "game" / "assets" / "furniture"
TEX.mkdir(parents=True, exist_ok=True)
FURN.mkdir(parents=True, exist_ok=True)

SIZE = 256  # tileable texture size
FURN_SIZE = 64


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def lerp(a, b, t):
    return a + (b - a) * t


def hash2(x, y, seed=0):
    n = (x * 374761393 + y * 668265263 + seed * 982451653) & 0x7FFFFFFF
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0x7FFFFFFF) / 0x7FFFFFFF


def value_noise(x, y, scale, seed=0):
    xs, ys = x / scale, y / scale
    x0, y0 = int(math.floor(xs)), int(math.floor(ys))
    xf, yf = xs - x0, ys - y0
    xf = xf * xf * (3 - 2 * xf)
    yf = yf * yf * (3 - 2 * yf)
    v00 = hash2(x0, y0, seed)
    v10 = hash2(x0 + 1, y0, seed)
    v01 = hash2(x0, y0 + 1, seed)
    v11 = hash2(x0 + 1, y0 + 1, seed)
    return lerp(lerp(v00, v10, xf), lerp(v01, v11, xf), yf)


def fbm(x, y, octaves=5, scale=32, seed=0, lac=2.0, gain=0.5):
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for i in range(octaves):
        total += amp * value_noise(x * freq, y * freq, scale, seed + i * 97)
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def wood_grain(w, h, base=(180, 130, 70), dark=(90, 55, 25), seed=1, plank_h=42):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        plank = y // plank_h
        py = y % plank_h
        seam = 1.0 if py < 2 or py > plank_h - 3 else 0.0
        for x in range(w):
            # Horizontal grain with slight warp
            warp = (fbm(x, y, 3, 48, seed + plank) - 0.5) * 18
            g = fbm(x + warp * 4, y * 0.15 + plank * 7, 6, 20, seed + 3)
            ring = math.sin((x + warp) * 0.09 + g * 6.0 + plank) * 0.5 + 0.5
            pores = value_noise(x * 3, y * 8, 2.5, seed + 9)
            t = g * 0.55 + ring * 0.35 + pores * 0.1
            t = max(0, min(1, t - seam * 0.35))
            # slight plank color variation
            tint = 0.92 + 0.12 * hash2(plank, 0, seed)
            r = clamp(lerp(dark[0], base[0], t) * tint)
            gch = clamp(lerp(dark[1], base[1], t) * tint)
            b = clamp(lerp(dark[2], base[2], t) * tint)
            # micro highlight
            hi = value_noise(x, y, 6, seed + 11) * 18
            px[x, y] = (clamp(r + hi), clamp(gch + hi * 0.8), clamp(b + hi * 0.5))
    img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
    return img


def plaster(w, h, base=(245, 240, 225), seed=2, grit=0.35):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            n = fbm(x, y, 5, 28, seed)
            mott = fbm(x, y, 3, 8, seed + 4)
            t = n * 0.7 + mott * 0.3
            shade = (t - 0.5) * 40 * grit
            r = clamp(base[0] + shade)
            g = clamp(base[1] + shade * 0.95)
            b = clamp(base[2] + shade * 0.85)
            # subtle cracks
            if abs(math.sin(x * 0.07 + n * 8) * math.cos(y * 0.05)) > 0.97:
                r, g, b = clamp(r - 18), clamp(g - 16), clamp(b - 14)
            px[x, y] = (r, g, b)
    return img.filter(ImageFilter.GaussianBlur(0.4))


def wallpaper(w, h, base=(232, 224, 208), stripe=(90, 60, 80), seed=3, vertical=True):
    img = plaster(w, h, base, seed, grit=0.2)
    px = img.load()
    sw = 14
    for y in range(h):
        for x in range(w):
            along = x if vertical else y
            band = (along // sw) % 2 == 0
            if band:
                n = value_noise(x, y, 10, seed)
                a = 0.10 + 0.06 * n
                r, g, b = px[x, y]
                px[x, y] = (
                    clamp(lerp(r, stripe[0], a)),
                    clamp(lerp(g, stripe[1], a)),
                    clamp(lerp(b, stripe[2], a)),
                )
    # soft damask-ish motif
    draw = ImageDraw.Draw(img)
    for cy in range(24, h, 48):
        for cx in range(24, w, 48):
            col = (stripe[0], stripe[1], stripe[2], 28)
            overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            od = ImageDraw.Draw(overlay)
            od.ellipse([cx - 10, cy - 14, cx + 10, cy + 14], outline=col, width=2)
            od.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=col)
            img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img.filter(ImageFilter.GaussianBlur(0.5))


def stone(w, h, base=(90, 85, 72), seed=4):
    img = Image.new("RGB", (w, h))
    px = img.load()
    brick_w, brick_h = 64, 32
    for y in range(h):
        row = y // brick_h
        oy = (row % 2) * (brick_w // 2)
        for x in range(w):
            col = ((x + oy) % w) // brick_w
            local_x = ((x + oy) % w) % brick_w
            local_y = y % brick_h
            mortar = local_x < 2 or local_y < 2
            n = fbm(x + col * 3, y + row * 5, 4, 16, seed + row)
            shade = (n - 0.5) * 50
            var = (hash2(col, row, seed) - 0.5) * 28
            r = clamp(base[0] + shade + var)
            g = clamp(base[1] + shade + var * 0.9)
            b = clamp(base[2] + shade + var * 0.7)
            if mortar:
                r, g, b = clamp(r * 0.45), clamp(g * 0.45), clamp(b * 0.42)
            px[x, y] = (r, g, b)
    return img.filter(ImageFilter.GaussianBlur(0.5))


def castle_white(w, h, seed=5):
    """Original illustrated white plaster + subtle gold flecks (not a photo of Osaka Castle)."""
    img = plaster(w, h, (250, 246, 232), seed, grit=0.18)
    px = img.load()
    for y in range(h):
        for x in range(w):
            # timber-shadow hint every so often (tileable soft bands)
            band = abs(math.sin(x * math.pi * 2 / w * 2))
            if band > 0.92:
                r, g, b = px[x, y]
                px[x, y] = (clamp(r - 35), clamp(g - 32), clamp(b - 28))
            # gold flecks
            if hash2(x // 3, y // 3, seed + 7) > 0.992:
                px[x, y] = (220, 180, 60)
    # soft gold rail lines (tileable)
    draw = ImageDraw.Draw(img)
    for yy in (int(h * 0.33), int(h * 0.66)):
        for t in range(-1, 2):
            a = 90 - abs(t) * 30
            overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(overlay).line([(0, yy + t), (w, yy + t)], fill=(212, 175, 55, a), width=1)
            img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img.filter(ImageFilter.GaussianBlur(0.4))


def rug_tex(w, h, seed=6):
    img = Image.new("RGB", (w, h), (140, 35, 40))
    px = img.load()
    for y in range(h):
        for x in range(w):
            n = fbm(x, y, 4, 20, seed)
            border = min(x, y, w - 1 - x, h - 1 - y)
            if border < 10:
                t = border / 10
                gold = (212, 175, 55)
                base = (140, 35, 40)
                c = tuple(clamp(lerp(gold[i], base[i], t)) for i in range(3))
            else:
                shade = (n - 0.5) * 40
                c = (clamp(150 + shade), clamp(40 + shade * 0.5), clamp(45 + shade * 0.4))
                # center medallion
                cx, cy = w / 2, h / 2
                d = math.hypot(x - cx, y - cy) / (w * 0.28)
                if 0.7 < d < 0.85 or d < 0.25:
                    c = (clamp(c[0] + 40), clamp(c[1] + 80), clamp(c[2] + 10))
            px[x, y] = c
    return img.filter(ImageFilter.GaussianBlur(0.8))


def door_wood(w, h, seed=7):
    img = wood_grain(w, h, base=(140, 90, 40), dark=(60, 35, 15), seed=seed, plank_h=h // 2)
    draw = ImageDraw.Draw(img)
    m = 18
    # panels
    for (x0, y0, x1, y1) in [
        (m, m, w // 2 - 6, h // 2 - 6),
        (w // 2 + 6, m, w - m, h // 2 - 6),
        (m, h // 2 + 6, w // 2 - 6, h - m),
        (w // 2 + 6, h // 2 + 6, w - m, h - m),
    ]:
        draw.rectangle([x0, y0, x1, y1], outline=(210, 170, 90), width=2)
        draw.rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], outline=(40, 25, 10), width=1)
    # knob
    kx, ky = int(w * 0.78), int(h * 0.52)
    draw.ellipse([kx - 8, ky - 8, kx + 8, ky + 8], fill=(230, 200, 100), outline=(120, 90, 30))
    return img.filter(ImageFilter.GaussianBlur(0.4))


def save_tex(name, img):
    path = TEX / name
    img.save(path, optimize=True)
    print("wrote", path, img.size)


# --- furniture sprites (soft shaded, top-down-ish) ---

def soft_rect(draw, box, fill, outline=None):
    draw.rounded_rectangle(box, radius=4, fill=fill, outline=outline, width=1)


def make_bed(variant="basic"):
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    frames = {"basic": (90, 60, 35), "nice": (120, 85, 45), "luxury": (200, 165, 55)}
    mats = {"basic": (240, 220, 190), "nice": (220, 235, 210), "luxury": (250, 240, 220)}
    frame = frames.get(variant, frames["basic"])
    mat = mats.get(variant, mats["basic"])
    soft_rect(d, [6, 10, s - 6, s - 8], frame)
    soft_rect(d, [9, 13, s - 9, s - 12], mat)
    # pillow
    soft_rect(d, [11, 15, 28, 26], (255, 250, 245), (220, 210, 200))
    # blanket
    blanket = (180, 70, 70) if variant != "luxury" else (180, 140, 50)
    soft_rect(d, [9, 34, s - 9, 48], blanket)
    # soft shadow
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([10, s - 10, s - 10, s - 2], fill=(0, 0, 0, 50))
    img = Image.alpha_composite(shadow, img)
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_sofa():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [5, 14, s - 5, 28], (70, 55, 45))  # back
    soft_rect(d, [5, 24, s - 5, 50], (140, 55, 50))  # seat
    soft_rect(d, [5, 22, 14, 50], (110, 40, 40))  # arm
    soft_rect(d, [s - 14, 22, s - 5, 50], (110, 40, 40))
    soft_rect(d, [16, 28, s - 16, 36], (180, 90, 85))  # cushion highlight
    return img.filter(ImageFilter.GaussianBlur(0.35))


def make_table(grand=False):
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top = (160, 110, 55) if not grand else (90, 60, 30)
    soft_rect(d, [8, 18, s - 8, 40], top)
    soft_rect(d, [10, 20, s - 10, 36], (200, 160, 90) if not grand else (212, 175, 55))
    # legs
    d.rectangle([12, 40, 16, 52], fill=(70, 45, 25))
    d.rectangle([s - 16, 40, s - 12, 52], fill=(70, 45, 25))
    if grand:
        d.rectangle([s // 2 - 8, 22, s // 2 + 8, 34], fill=(160, 40, 40, 180))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_plant(tall=False):
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # pot
    d.polygon([(22, 40), (42, 40), (38, 54), (26, 54)], fill=(130, 80, 50))
    d.rectangle([20, 37, 44, 42], fill=(100, 60, 35))
    if tall:
        d.rectangle([30, 14, 34, 40], fill=(40, 90, 45))
        for cx, cy, rx, ry in [(22, 20, 10, 14), (42, 18, 10, 15), (32, 12, 9, 12)]:
            d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(55, 140, 70))
            d.ellipse([cx - rx + 2, cy - ry + 2, cx + rx - 4, cy + ry - 4], fill=(90, 180, 100))
    else:
        d.ellipse([16, 14, 48, 42], fill=(50, 130, 65))
        d.ellipse([20, 16, 36, 34], fill=(80, 170, 90))
        d.ellipse([30, 18, 46, 36], fill=(70, 160, 85))
    return img.filter(ImageFilter.GaussianBlur(0.35))


def make_bookshelf():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [10, 6, s - 10, s - 8], (70, 45, 28))
    soft_rect(d, [12, 8, s - 12, s - 10], (120, 85, 50))
    colors = [(120, 40, 50), (40, 60, 110), (160, 120, 40), (40, 90, 70), (90, 50, 120)]
    for row in range(4):
        y = 12 + row * 12
        d.rectangle([12, y + 9, s - 12, y + 11], fill=(60, 40, 25))
        for b in range(5):
            x = 14 + b * 8
            c = colors[(row + b) % len(colors)]
            d.rectangle([x, y, x + 6, y + 9], fill=c)
    return img.filter(ImageFilter.GaussianBlur(0.25))


def make_dresser():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [8, 10, s - 8, s - 10], (90, 60, 35))
    soft_rect(d, [10, 12, s - 10, s - 12], (160, 120, 70))
    for i in range(2):
        y = 16 + i * 20
        soft_rect(d, [14, y, s - 14, y + 16], (140, 100, 55), (80, 50, 30))
        d.ellipse([s // 2 - 3, y + 6, s // 2 + 3, y + 11], fill=(212, 175, 55))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_fireplace():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [8, 8, s - 8, s - 10], (55, 50, 48))
    soft_rect(d, [10, 10, s - 10, 22], (200, 195, 185))
    soft_rect(d, [14, 26, s - 14, 48], (20, 12, 10))
    d.ellipse([20, 38, 32, 48], fill=(220, 100, 40))
    d.ellipse([28, 36, 42, 48], fill=(240, 180, 60))
    d.rectangle([8, 8, s - 8, 10], fill=(212, 175, 55))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_rug_sprite(rich=False):
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rich:
        soft_rect(d, [6, 6, s - 6, s - 6], (160, 35, 40))
        d.rounded_rectangle([10, 10, s - 10, s - 10], radius=3, outline=(212, 175, 55), width=2)
        soft_rect(d, [24, 24, 40, 40], (212, 175, 55))
    else:
        soft_rect(d, [6, 6, s - 6, s - 6], (120, 70, 90, 200))
        d.rounded_rectangle([10, 10, s - 10, s - 10], radius=3, outline=(255, 255, 255, 90), width=1)
    return img.filter(ImageFilter.GaussianBlur(0.4))


def make_tatami():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [4, 4, s - 4, s - 4], (200, 185, 100))
    for y in range(8, s - 8, 3):
        d.line([(8, y), (s - 8, y)], fill=(170, 155, 70, 80), width=1)
    d.rectangle([4, 4, 7, s - 4], fill=(120, 100, 40))
    d.rectangle([s - 7, 4, s - 4, s - 4], fill=(120, 100, 40))
    return img.filter(ImageFilter.GaussianBlur(0.25))


def make_chair():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [18, 12, 46, 28], (100, 70, 45))
    soft_rect(d, [16, 26, 48, 44], (150, 110, 70))
    d.rectangle([18, 44, 22, 54], fill=(70, 45, 25))
    d.rectangle([42, 44, 46, 54], fill=(70, 45, 25))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_throne():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [12, 6, 52, 30], (180, 40, 40))
    soft_rect(d, [10, 26, 54, 50], (212, 175, 55))
    soft_rect(d, [16, 30, 48, 46], (160, 30, 35))
    d.polygon([(32, 4), (26, 12), (38, 12)], fill=(255, 220, 80))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_armor():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([20, 8, 44, 28], fill=(140, 140, 150))
    soft_rect(d, [18, 24, 46, 48], (120, 120, 130))
    d.rectangle([22, 28, 42, 36], fill=(80, 80, 90))
    d.rectangle([14, 30, 20, 46], fill=(130, 130, 140))
    d.rectangle([44, 30, 50, 46], fill=(130, 130, 140))
    return img.filter(ImageFilter.GaussianBlur(0.35))


def make_lantern():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [22, 14, 42, 48], (200, 160, 60))
    soft_rect(d, [24, 18, 40, 42], (255, 230, 140))
    d.rectangle([20, 12, 44, 16], fill=(90, 60, 30))
    d.rectangle([20, 46, 44, 50], fill=(90, 60, 30))
    # glow
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([14, 10, 50, 52], fill=(255, 220, 100, 50))
    return Image.alpha_composite(glow, img).filter(ImageFilter.GaussianBlur(0.4))


def make_pillar():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    soft_rect(d, [22, 4, 42, 60], (90, 55, 30))
    soft_rect(d, [24, 6, 34, 58], (150, 105, 60))
    soft_rect(d, [18, 4, 46, 10], (70, 40, 20))
    soft_rect(d, [18, 54, 46, 60], (70, 40, 20))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def make_byobu():
    s = FURN_SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(3):
        x0 = 8 + i * 16
        soft_rect(d, [x0, 10, x0 + 14, 54], (240, 210, 80), (160, 120, 30))
        d.ellipse([x0 + 3, 22, x0 + 11, 38], fill=(180, 40, 40, 120))
    return img.filter(ImageFilter.GaussianBlur(0.3))


def main():
    random.seed(42)

    # Floors
    save_tex("floor_wood.png", wood_grain(SIZE, SIZE, (210, 165, 95), (110, 70, 30), seed=11, plank_h=40))
    save_tex("floor_wood_cool.png", wood_grain(SIZE, SIZE, (170, 185, 200), (70, 85, 105), seed=12, plank_h=40))
    save_tex("floor_wood_warm.png", wood_grain(SIZE, SIZE, (220, 160, 140), (120, 60, 50), seed=13, plank_h=40))
    save_tex("floor_tatami.png", wood_grain(SIZE, SIZE, (200, 185, 110), (130, 115, 50), seed=14, plank_h=64))

    # Walls
    save_tex("wall_basic.png", plaster(SIZE, SIZE, (120, 80, 55), seed=20, grit=0.45))
    save_tex("wall_cottage.png", wood_grain(SIZE, SIZE, (170, 120, 80), (90, 55, 30), seed=21, plank_h=48))
    save_tex("wall_mansion.png", wallpaper(SIZE, SIZE, (235, 228, 215), (100, 70, 90), seed=22))
    save_tex("wall_villa.png", plaster(SIZE, SIZE, (245, 240, 228), seed=23, grit=0.15))
    # gold edge hint on villa
    villa = Image.open(TEX / "wall_villa.png").convert("RGBA")
    ov = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for i in range(4):
        od.rectangle([8 + i, 8 + i, SIZE - 9 - i, SIZE - 9 - i], outline=(212, 175, 55, 40 + i * 10))
    villa = Image.alpha_composite(villa, ov).convert("RGB")
    save_tex("wall_villa.png", villa)

    save_tex("wall_castle.png", stone(SIZE, SIZE, (95, 90, 78), seed=24))
    save_tex("wall_osaka.png", castle_white(SIZE, SIZE, seed=25))

    save_tex("rug.png", rug_tex(SIZE, SIZE, seed=30))
    save_tex("door_wood.png", door_wood(SIZE, SIZE, seed=31))

    # Furniture
    items = {
        "bed.png": make_bed("basic"),
        "bed_nice.png": make_bed("nice"),
        "bed_luxury.png": make_bed("luxury"),
        "sofa.png": make_sofa(),
        "table.png": make_table(False),
        "table_grand.png": make_table(True),
        "plant.png": make_plant(False),
        "plant_tall.png": make_plant(True),
        "bookshelf.png": make_bookshelf(),
        "dresser.png": make_dresser(),
        "fireplace.png": make_fireplace(),
        "rug_cozy.png": make_rug_sprite(False),
        "rug_rich.png": make_rug_sprite(True),
        "tatami.png": make_tatami(),
        "chair.png": make_chair(),
        "throne.png": make_throne(),
        "armor.png": make_armor(),
        "lantern.png": make_lantern(),
        "pillar.png": make_pillar(),
        "byobu.png": make_byobu(),
    }
    for name, im in items.items():
        path = FURN / name
        im.save(path, optimize=True)
        print("wrote", path)

    print("done")


if __name__ == "__main__":
    main()
