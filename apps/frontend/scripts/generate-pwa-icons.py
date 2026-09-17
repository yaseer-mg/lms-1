#!/usr/bin/env python3
"""Generate PWA icon set from public/logo.jpg.

Outputs (into apps/frontend/public):
  pwa-192x192.png, pwa-512x512.png
  pwa-maskable-192x192.png, pwa-maskable-512x512.png
  apple-touch-icon.png (180x180)
  favicon-32x32.png

Run from the repo root:
  python3 apps/frontend/scripts/generate-pwa-icons.py
"""
import os
from PIL import Image

PUBLIC = os.path.join(os.path.dirname(__file__), "..", "public")
SRC = os.path.join(PUBLIC, "logo.jpg")
MASKABLE_BG = (26, 111, 191)  # brand blue #1A6FBF

def load_logo(size):
    logo = Image.open(SRC).convert("RGBA")
    logo.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas

def maskable(size, scale=0.62):
    """Solid background with logo in the 80% safe zone."""
    logo = Image.open(SRC).convert("RGBA")
    target = int(size * scale)
    logo.thumbnail((target, target), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), MASKABLE_BG + (255,))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas

def save(img, name):
    out = os.path.join(PUBLIC, name)
    img.convert("RGB").save(out, "PNG")
    print(f"  wrote {os.path.relpath(out)}")

def main():
    os.makedirs(PUBLIC, exist_ok=True)
    print("Generating PWA icons from logo.jpg ...")
    for size in (192, 512):
        save(load_logo(size), f"pwa-{size}x{size}.png")
        save(maskable(size), f"pwa-maskable-{size}x{size}.png")
    save(load_logo(180), "apple-touch-icon.png")
    save(load_logo(32), "favicon-32x32.png")
    print("Done.")

if __name__ == "__main__":
    main()