#!/usr/bin/env python3
"""Build an alpha aperture for each supplied 128x128 avatar frame (Pillow).

Transparent space connected to the centre is the opening. Morphological
closing seals tiny antialiasing gaps in the border; a two-pixel overlap and
soft edge let the artwork cover the photo without a dark seam. Fail rather than
silently produce an unbounded or empty aperture when an asset is replaced.
"""
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[1] / 'app/public'
frames = root / 'mlbb-frames'
out = root / 'mlbb-frame-masks'
out.mkdir(parents=True, exist_ok=True)

for path in sorted(frames.glob('*.png')):
    frame = Image.open(path).convert('RGBA')
    if frame.size != (128, 128):
        raise ValueError(f'{path.name}: expected 128×128')
    # Treat translucent texture as part of the opening, solid artwork as edge.
    solid = frame.getchannel('A').point(lambda value: 255 if value >= 96 else 0)
    solid = solid.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    if solid.getpixel((64, 64)):
        raise ValueError(f'{path.name}: centre blocked; review this frame')
    pixels = solid.load()
    seen = bytearray(128 * 128)
    seen[64 * 128 + 64] = 1
    queue = deque([(64, 64)])
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if 0 <= nx < 128 and 0 <= ny < 128 and not seen[ny*128+nx] and not pixels[nx, ny]:
                seen[ny*128+nx] = 1
                queue.append((nx, ny))
    size = sum(seen)
    mask = Image.frombytes('L', (128, 128), bytes(value * 255 for value in seen))
    bbox = mask.getbbox()
    if not 2500 <= size <= 10000 or not bbox or min(bbox[0], bbox[1], 128-bbox[2], 128-bbox[3]) < 5:
        raise ValueError(f'{path.name}: unbounded or tiny aperture ({size}, {bbox})')
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(.45))
    # CSS mask-image uses ALPHA, not the grayscale luminance of an opaque PNG.
    result = Image.new('RGBA', (128, 128), 'white')
    result.putalpha(mask)
    result.save(out / path.name, optimize=True)
print(f'Built {len(list(frames.glob("*.png")))} aperture masks in {out}')
