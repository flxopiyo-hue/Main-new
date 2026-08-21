"""Compose 6.1"/6.3" iPhone App Store screenshots (1206x2622) — the
Apple-approved dimension for the 6.1-inch (iPhone 15/16) and 6.3-inch
(iPhone 16 Pro) portrait slot. Same brand treatment as the 6.9"
composer (compose_appstore.py) — cream background, Oromona kicker,
Cormorant headline + Manrope subtitle, rounded screenshot with shadow.

Output: /app/appstore_screenshots/final_61/*.png
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = "/app/appstore_screenshots/raw"
OUT = "/app/appstore_screenshots/final_61"
os.makedirs(OUT, exist_ok=True)

# 6.1"/6.3" — Apple's smaller "iPhone 15/16" portrait size.
W, H = 1206, 2622
BG = (245, 241, 234)      # warm cream
INK = (20, 17, 14)        # near-black
MUTED = (107, 97, 87)
ACCENT = (200, 107, 74)   # terracotta

FONTS = "/app/frontend/node_modules/@expo-google-fonts"
F_HEAD = f"{FONTS}/cormorant-garamond/700Bold/CormorantGaramond_700Bold.ttf"
F_KICK = f"{FONTS}/manrope/600SemiBold/Manrope_600SemiBold.ttf"
F_SUB = f"{FONTS}/manrope/400Regular/Manrope_400Regular.ttf"

# (raw_file, kicker, headline_lines[], subtitle)
SLIDES = [
    ("01_home.png", "OROMONA", ["The boutique", "that fits you."],
     "Curated fashion, sized to your body."),
    ("02_item.png", "TRUE FIT", ["Know it fits", "before you buy."],
     "Real measurements, real fit scores."),
    ("03_tryon.png", "AI TRY-ON", ["See it on you", "first."],
     "Photorealistic try-on, every angle."),
    ("04_stylist.png", "AI STYLIST", ["Your own", "personal stylist."],
     "Looks styled for your skin tone & shape."),
    ("05_shoplook.png", "SHOP THE LOOK", ["The whole look,", "one tap."],
     "One payment. Delivered to your door."),
    ("06_order.png", "DELIVERY", ["Tracked", "to your door."],
     "Boda riders, live updates, secure escrow."),
]


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0], img.size[1]], radius, fill=255
    )
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def center_text(draw, y, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)
    return bbox[3] - bbox[1]


def build(slide):
    raw_file, kicker, headline, subtitle = slide
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    # Type scaled from the 6.9" (1290x2796) composer proportionally
    # to the shorter canvas so the layout stays visually consistent.
    f_head = ImageFont.truetype(F_HEAD, 124)
    f_kick = ImageFont.truetype(F_KICK, 32)
    f_sub = ImageFont.truetype(F_SUB, 42)

    # --- text block ---
    y = 140
    center_text(draw, y, " ".join(list(kicker)), f_kick, ACCENT)
    y += 74
    for line in headline:
        center_text(draw, y, line, f_head, INK)
        y += 130
    y += 8
    center_text(draw, y, subtitle, f_sub, MUTED)

    # --- screenshot with shadow ---
    shot = Image.open(os.path.join(RAW, raw_file)).convert("RGB")
    target_h = 1900
    target_w = int(target_h * shot.size[0] / shot.size[1])
    # Guard against the shot overflowing on the shorter canvas — cap
    # width at 92% of the canvas width and recompute the height if so.
    max_w = int(W * 0.92)
    if target_w > max_w:
        scale = max_w / target_w
        target_w = max_w
        target_h = int(target_h * scale)
    shot = shot.resize((target_w, target_h), Image.LANCZOS)
    shot = rounded(shot, 52)

    img_x = (W - target_w) // 2
    img_y = 640

    # soft drop shadow
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [img_x, img_y + 22, img_x + target_w, img_y + target_h + 22],
        52,
        fill=(20, 17, 14, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.alpha_composite(shadow)
    canvas_rgba.alpha_composite(shot, (img_x, img_y))

    # thin border around the shot for crispness
    bdraw = ImageDraw.Draw(canvas_rgba)
    bdraw.rounded_rectangle(
        [img_x, img_y, img_x + target_w, img_y + target_h],
        52,
        outline=(0, 0, 0, 28),
        width=2,
    )

    out = canvas_rgba.convert("RGB")
    name = raw_file.replace(".png", "_appstore_61.png")
    out.save(os.path.join(OUT, name), quality=95)
    print("composed", name, out.size)


if __name__ == "__main__":
    for s in SLIDES:
        build(s)
    print("DONE ->", OUT)
