"""White-on-black JPEG glyphs -> white PNGs with alpha, near-black made fully clear, margins trimmed.

usage: python icons_to_png.py <from folder> <to folder>   (every icon-*.jpg and emblem.jpg)
"""
import sys
from pathlib import Path
from PIL import Image

LO, HI = 70, 190  # luminance below LO: clear; above HI: solid; a ramp between (keeps edges smooth)
EDGE = 0.05  # cut off first: frames or bright corners some of the generated images have at their edges

src_dir, dst_dir = Path(sys.argv[1]), Path(sys.argv[2])
for src in sorted([*src_dir.glob('icon-*.jpg'), src_dir / 'emblem.jpg']):
    lum = Image.open(src).convert('L')
    e = round(min(lum.size) * EDGE)
    lum = lum.crop((e, e, lum.width - e, lum.height - e))
    alpha = lum.point(lambda v: 0 if v <= LO else 255 if v >= HI else round((v - LO) * 255 / (HI - LO)))
    box = alpha.getbbox()
    if box:
        pad = round(max(box[2] - box[0], box[3] - box[1]) * 0.04)
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(alpha.width, box[2] + pad), min(alpha.height, box[3] + pad))
        alpha = alpha.crop(box)
    out = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    dst = dst_dir / src.with_suffix('.png').name
    out.save(dst, optimize=True)
    print(src.name, '->', dst.name, alpha.size)
