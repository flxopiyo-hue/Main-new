"""Image helpers: base64 prefix stripping + Pillow watermark composition."""

from __future__ import annotations

import base64
import io
import textwrap

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def strip_data_prefix(b64: str) -> str:
    if b64.startswith("data:"):
        comma = b64.find(",")
        if comma != -1:
            return b64[comma + 1 :]
    return b64


def watermark_image(b64_in: str, seller_name: str, fmt: str = "square") -> str:
    """Return base64 JPEG with the AuraFit + designer brand stamp applied.

    fmt='square'  → adds a dark band beneath the image (good for IG posts)
    fmt='story'   → 1080x1920 9:16 canvas with blurred backdrop + brand block
    """
    raw = base64.b64decode(b64_in)
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    if fmt == "story":
        # 9:16 canvas (1080x1920). Center the image, blurred backdrop, brand block.
        W, H = 1080, 1920
        bg = img.copy().resize((W, H)).filter(ImageFilter.GaussianBlur(radius=40))
        bg = bg.point(lambda p: int(p * 0.55))  # darken
        canvas = bg

        # Foreground image fits inside a 920×1380 area at the top.
        fg_max_w, fg_max_h = 920, 1380
        w, h = img.size
        scale = min(fg_max_w / w, fg_max_h / h)
        new_w, new_h = int(w * scale), int(h * scale)
        fg = img.resize((new_w, new_h), Image.LANCZOS)
        fg_x = (W - new_w) // 2
        fg_y = 200
        canvas.paste(fg, (fg_x, fg_y))

        # Brand bar at bottom.
        draw = ImageDraw.Draw(canvas)
        try:
            font_big = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 110
            )
            font_sm = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 50
            )
            font_xs = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 38
            )
        except Exception:
            font_big = font_sm = font_xs = ImageFont.load_default()
        draw.text((80, 1640), "OROMONA", fill=(250, 250, 250), font=font_big)
        draw.text(
            (80, 1760),
            f"by {textwrap.shorten(seller_name, width=30, placeholder='…')}",
            fill=(220, 220, 220),
            font=font_sm,
        )
        draw.text(
            (80, 1830),
            "It fits me · oromona.com",
            fill=(180, 180, 180),
            font=font_xs,
        )
        out = canvas
    else:
        # Original "square-ish" band beneath the image.
        w, h = img.size
        band_height = max(64, int(h * 0.08))
        out = Image.new("RGB", (w, h + band_height), (10, 10, 10))
        out.paste(img, (0, 0))
        draw = ImageDraw.Draw(out)
        try:
            font_big = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                int(band_height * 0.42),
            )
            font_sm = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                int(band_height * 0.28),
            )
        except Exception:
            font_big = ImageFont.load_default()
            font_sm = ImageFont.load_default()
        pad = int(band_height * 0.25)
        draw.text(
            (pad, h + int(band_height * 0.18)),
            "OROMONA",
            fill=(250, 250, 250),
            font=font_big,
        )
        credit = textwrap.shorten(f"by {seller_name}", width=40, placeholder="…")
        bbox = draw.textbbox((0, 0), credit, font=font_sm)
        tw = bbox[2] - bbox[0]
        draw.text(
            (w - tw - pad, h + int(band_height * 0.38)),
            credit,
            fill=(200, 200, 200),
            font=font_sm,
        )

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("utf-8")
