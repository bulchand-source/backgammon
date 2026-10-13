"""Genera los iconos de la app (tablero en miniatura) con Pillow.

Uso:  python tools/make_icons.py
Crea icons/icon-192.png, icon-512.png, icon-maskable-512.png y apple-touch-icon.png.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

S = 2048  # lienzo de trabajo (2× sobre 1024) para suavizar bordes al reducir

WOOD_A, WOOD_B = (107, 69, 41), (69, 43, 25)
FELT_IN, FELT_OUT = (45, 100, 76), (24, 64, 47)
DARK_PT, LIGHT_PT = (142, 47, 38), (224, 207, 163)
IVORY = dict(rim=(109, 89, 53), body_out=(201, 181, 142), body_in=(255, 251, 242), ring=(195, 174, 132))
EBONY = dict(rim=(5, 4, 4), body_out=(20, 17, 16), body_in=(99, 90, 84), ring=(97, 86, 78))


def gradient_fill(size, inner, outer, kind):
    """Imagen RGB con degradado lineal (vertical) o radial entre dos colores."""
    if kind == "radial":
        mask = Image.radial_gradient("L").resize(size, Image.BICUBIC)
    else:
        mask = Image.linear_gradient("L").resize(size, Image.BICUBIC)
    a = Image.new("RGB", size, inner)
    b = Image.new("RGB", size, outer)
    return Image.composite(b, a, mask)


def lerp(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def checker(draw, cx, cy, r, style):
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=style["rim"])
    inner = r - r * 0.06
    steps = 48
    for i in range(steps):
        t = i / (steps - 1)
        rr = inner * (1 - t * 0.92)
        # el brillo se desplaza hacia arriba a la izquierda
        ox, oy = -inner * 0.18 * t, -inner * 0.2 * t
        draw.ellipse((cx + ox - rr, cy + oy - rr, cx + ox + rr, cy + oy + rr),
                     fill=lerp(style["body_out"], style["body_in"], t ** 0.8))
    rr = r * 0.62
    w = max(2, round(r * 0.06))
    draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=style["ring"], width=w)


def board(scale=1.0):
    """Dibuja el icono en un lienzo S×S. scale < 1 deja margen (iconos 'maskable')."""
    img = gradient_fill((S, S), WOOD_A, WOOD_B, "linear")
    d = ImageDraw.Draw(img)
    u = S / 1024 * scale            # unidad: 1/1024 del icono
    off = S * (1 - scale) / 2       # desplazamiento para centrar
    X = lambda v: off + v * u       # noqa: E731
    Y = X

    frame, bar = 96, 64
    half_w = (1024 - 2 * frame - bar) / 2  # 384
    pw = half_w / 3                        # 128 por punta
    lefts = [frame, frame + half_w + bar]
    top, bottom = frame, 1024 - frame
    tip = 352

    for left in lefts:
        felt = gradient_fill((round(half_w * u), round((bottom - top) * u)), FELT_IN, FELT_OUT, "radial")
        img.paste(felt, (round(X(left)), round(Y(top))))

    # Puntas: alternan color y los de enfrente son del color contrario.
    for h, left in enumerate(lefts):
        for i in range(3):
            x0 = left + i * pw
            col_top = DARK_PT if (i + h) % 2 == 0 else LIGHT_PT
            col_bot = LIGHT_PT if col_top == DARK_PT else DARK_PT
            inset = 4
            d.polygon([(X(x0 + inset), Y(top)), (X(x0 + pw - inset), Y(top)), (X(x0 + pw / 2), Y(top + tip))], fill=col_top)
            d.polygon([(X(x0 + inset), Y(bottom)), (X(x0 + pw - inset), Y(bottom)), (X(x0 + pw / 2), Y(bottom - tip))], fill=col_bot)

    # Bisagra de la barra
    d.line([(X(512), Y(40)), (X(512), Y(984))], fill=(29, 18, 10), width=max(2, round(6 * u)))

    # Fichas: negras arriba a la izquierda, blancas abajo a la derecha.
    r = 56
    cx_b = lefts[0] + pw / 2
    cx_w = lefts[1] + 2 * pw + pw / 2
    for k in range(3):
        checker(d, X(cx_b), Y(top + r + 6 + k * 2 * r), r * u, EBONY)
        checker(d, X(cx_w), Y(bottom - r - 6 - k * 2 * r), r * u, IVORY)
    return img


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print("icons/" + name)


def main():
    OUT.mkdir(exist_ok=True)
    full = board()
    save(full, 180, "apple-touch-icon.png")
    save(full, 192, "icon-192.png")
    save(full, 512, "icon-512.png")
    # Android recorta los 'maskable' en círculo: el dibujo va al 80 % sobre fondo de madera.
    save(board(scale=0.8), 512, "icon-maskable-512.png")


if __name__ == "__main__":
    main()
