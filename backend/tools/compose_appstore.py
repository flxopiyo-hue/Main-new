"""Compose marketed App Store screenshots (1290x2796) from the raw captures:
brand cream background, Oromona kicker, a Cormorant headline + Manrope
subtitle, and the app screenshot with rounded corners + soft shadow.

Output: /app/appstore_screenshots/final/*.png
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = "/app/appstore_screenshots/raw"
OUT = "/app/appstore_screenshots/final"
os.makedirs(OUT, exist_ok=True)

W, H = 1290, 2796
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
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0], img.size[1]], radius, fill=255)
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

    f_head = ImageFont.truetype(F_HEAD, 132)
    f_kick = ImageFont.truetype(F_KICK, 34)
    f_sub = ImageFont.truetype(F_SUB, 44)

    # --- text block ---
    y = 150
    center_text(draw, y, " ".join(list(kicker)), f_kick, ACCENT)  # letter-spaced kicker
    y += 78
    for line in headline:
        center_text(draw, y, line, f_head, INK)
        y += 138
    y += 12
    center_text(draw, y, subtitle, f_sub, MUTED)

    # --- screenshot with shadow ---
    shot = Image.open(os.path.join(RAW, raw_file)).convert("RGB")
    target_h = 2020
    target_w = int(target_h * shot.size[0] / shot.size[1])
    shot = shot.resize((target_w, target_h), Image.LANCZOS)
    shot = rounded(shot, 56)

    img_x = (W - target_w) // 2
    img_y = 690

    # soft drop shadow
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [img_x, img_y + 24, img_x + target_w, img_y + target_h + 24], 56, fill=(20, 17, 14, 90)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(38))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.alpha_composite(shadow)
    canvas_rgba.alpha_composite(shot, (img_x, img_y))

    # thin border around the shot for crispness
    bdraw = ImageDraw.Draw(canvas_rgba)
    bdraw.rounded_rectangle(
        [img_x, img_y, img_x + target_w, img_y + target_h], 56, outline=(0, 0, 0, 28), width=2
    )

    out = canvas_rgba.convert("RGB")
    name = raw_file.replace(".png", "_appstore.png")
    out.save(os.path.join(OUT, name), quality=95)
    print("composed", name, out.size)


for s in SLIDES:
    build(s)
print("DONE ->", OUT)
