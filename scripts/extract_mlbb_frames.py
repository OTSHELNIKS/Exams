#!/usr/bin/env python3
"""Extract supplied transparent reference sheets. Requires Pillow.

Usage: python scripts/extract_mlbb_frames.py /path/to/reference-sheets
The supplied sheets are previews (1192x670), not original 8K files. Crop bounds
are intentional: every frame occupies one cell, including the small frames.
"""
from pathlib import Path
import sys
from PIL import Image, ImageOps

source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'app/public/mlbb-frames'
out.mkdir(parents=True, exist_ok=True)
files = {
    1: 'all_mlbb_avatar_border_part_1_8k_png_by_newjer53_df9nwa5-pre.png',
    2: 'image-12.png',
    3: 'all_mlbb_avatar_border_part_3_8k_png_by_newjer53_df9nwg1-pre.png',
}
def grid(xs, ys):
    return [(xs[c], ys[r], xs[c+1], ys[r+1]) for r in range(5) for c in range(5)]
# The extra small frames on sheet 1 form a separate, unevenly spaced column.
boxes = {
  1: (grid([26,132,237,342,447,546], [55,161,267,373,479,584]) +
      [(538,28,606,95),(538,96,614,162),(546,202,614,269),
       (548,307,621,375),(551,411,623,478),(554,516,625,583)] +
      grid([645,750,855,960,1065,1171], [88,194,299,404,509,614]) +
      [(645,18,715,87),(855,19,925,88),(1064,24,1138,88)]),
  2: (grid([25,132,237,342,447,555], [43,150,256,363,469,576]) +
      grid([620,725,830,935,1040,1148], [43,150,256,363,469,576])),
  3: (grid([49,154,259,364,469,576], [21,127,233,339,445,553]) +
      grid([641,746,851,956,1061,1169], [29,135,241,347,453,559])),
}
# Sheet 1's last full-size column is slightly offset from the main grid.
boxes[1][4] = (441, 72, 539, 166)
boxes[1][9] = (445, 166, 543, 269)
boxes[1][14] = (445, 269, 548, 375)
boxes[1][19] = (447, 375, 551, 479)
boxes[1][24] = (449, 479, 552, 584)
boxes[1][35] = (1065, 98, 1171, 194)
for part, rects in boxes.items():
    sheet = Image.open(source / files[part]).convert('RGBA')
    for n, rect in enumerate(rects, 1):
        crop = sheet.crop(rect)
        bbox = crop.getchannel('A').getbbox()
        if not bbox:
            raise ValueError(f'empty: {part} {n}')
        crop = crop.crop(bbox)
        # Leave aspect ratio untouched; no opaque background is added.
        crop = ImageOps.contain(crop, (128, 128), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (128,128))
        canvas.alpha_composite(crop, ((128-crop.width)//2, (128-crop.height)//2))
        canvas.save(out / f'{part}-{n:02d}.png', optimize=True)
    print(f'part {part}: {len(rects)} frames')
