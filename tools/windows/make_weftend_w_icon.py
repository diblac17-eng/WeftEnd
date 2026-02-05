from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

OUT_DIR = Path("assets")
NAME = "weftend_logo"

def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t

def rgb_lerp(c1, c2, t: float):
    return (
        int(lerp(c1[0], c2[0], t)),
        int(lerp(c1[1], c2[1], t)),
        int(lerp(c1[2], c2[2], t)),
        255,
    )

def draw_thick_polyline(
    base: Image.Image,
    points: list[tuple[float, float]],
    width: int,
    c_start=(0, 200, 255),
    c_end=(255, 0, 220),
    blur: float = 0.0,
):
    w, h = base.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    seg_lens = []
    total = 0.0
    for i in range(len(points) - 1):
        (x1, y1), (x2, y2) = points[i], points[i + 1]
        L = math.hypot(x2 - x1, y2 - y1)
        seg_lens.append(L)
        total += L

    if total <= 1e-6:
        return

    accum = 0.0
    for i in range(len(points) - 1):
        (x1, y1), (x2, y2) = points[i], points[i + 1]
        L = seg_lens[i]
        if L <= 1e-6:
            continue

        steps = max(8, int(L / 2))
        for s in range(steps + 1):
            tt = s / steps
            x = lerp(x1, x2, tt)
            y = lerp(y1, y2, tt)

            t_global = (accum + L * tt) / total
            col = rgb_lerp(c_start, c_end, t_global)

            r = width / 2
            d.ellipse((x - r, y - r, x + r, y + r), fill=col)

        accum += L

    if blur > 0:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))

    base.alpha_composite(layer)

def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = int(size * 0.12)

    def P(nx, ny):
        return (pad + nx * (size - 2 * pad), pad + ny * (size - 2 * pad))

    left = [
        P(0.10, 0.15),
        P(0.28, 0.80),
        P(0.48, 0.45),
        P(0.62, 0.80),
        P(0.82, 0.15),
    ]

    right = [
        P(0.18, 0.15),
        P(0.36, 0.78),
        P(0.50, 0.52),
        P(0.68, 0.78),
        P(0.90, 0.15),
    ]

    stroke = int(size * 0.13)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_thick_polyline(
        shadow,
        [(x + size * 0.01, y + size * 0.02) for (x, y) in left],
        width=stroke,
        c_start=(0, 0, 0),
        c_end=(0, 0, 0),
        blur=8,
    )
    draw_thick_polyline(
        shadow,
        [(x + size * 0.01, y + size * 0.02) for (x, y) in right],
        width=stroke,
        c_start=(0, 0, 0),
        c_end=(0, 0, 0),
        blur=8,
    )
    sh = shadow.split()[-1].point(lambda p: int(p * 0.20))
    shadow.putalpha(sh)
    img.alpha_composite(shadow)

    # Neon-violet glass palette
    draw_thick_polyline(
        img,
        left,
        width=stroke,
        c_start=(90, 210, 255),
        c_end=(190, 90, 255),
        blur=0,
    )
    draw_thick_polyline(
        img,
        right,
        width=stroke,
        c_start=(120, 120, 255),
        c_end=(255, 70, 220),
        blur=0,
    )

    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_thick_polyline(
        highlight,
        left,
        width=max(1, int(stroke * 0.45)),
        c_start=(255, 255, 255),
        c_end=(255, 255, 255),
        blur=2,
    )
    draw_thick_polyline(
        highlight,
        right,
        width=max(1, int(stroke * 0.45)),
        c_start=(255, 255, 255),
        c_end=(255, 255, 255),
        blur=2,
    )
    ha = highlight.split()[-1].point(lambda p: int(p * 0.18))
    highlight.putalpha(ha)
    img.alpha_composite(highlight)

    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    return img

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sizes_png = [1024, 512, 256]
    imgs = {}
    for s in sizes_png:
        im = make_icon(s)
        imgs[s] = im
        im.save(OUT_DIR / f"{NAME}_{s}.png")

    imgs[1024].save(OUT_DIR / f"{NAME}.png")

    ico_sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)]
    base = make_icon(256)
    base.save(OUT_DIR / f"{NAME}.ico", format="ICO", sizes=ico_sizes)

    print("W icon generated:")
    for s in sizes_png:
        print(f"  {OUT_DIR / f'{NAME}_{s}.png'}")
    print(f"  {OUT_DIR / f'{NAME}.png'}")
    print(f"  {OUT_DIR / f'{NAME}.ico'}")

if __name__ == "__main__":
    main()
