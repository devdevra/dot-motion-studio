#!/usr/bin/env python3
"""External typography preparation, not a Dot Motion engine capability."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, json, os

ROOT = Path(__file__).resolve().parent
W, H, N, SS = 240, 128, 16, 3
FONT = os.getenv('TYPE_FONT_BOLD', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
REG = os.getenv('TYPE_FONT_REGULAR', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
FONT_INDEX = int(os.getenv('TYPE_FONT_INDEX', '1'))
CREAM, LIME = (244, 244, 219), (197, 241, 97)

def font(size, bold=False):
    path = FONT if bold else REG
    return ImageFont.truetype(path, size * SS, index=FONT_INDEX if path.endswith('.ttc') else 0)

def make_frame(i):
    canvas = Image.new('RGBA', (W*SS, H*SS))
    d = ImageDraw.Draw(canvas)
    main = font(42, True)
    phrase = '골프의 순간'
    total = d.textlength(phrase, font=main)
    x = (W*SS-total)/2
    glyph = 0
    for c in phrase:
        width = d.textlength(c, font=main)
        if c != ' ':
            p = max(0, min(1, (i + .7 - glyph*.7)/5.0))
            ease = 1 - (1-p)**3
            dy = (1-ease)*22 * (1 if glyph%2==0 else -1)
            opacity = round(255*min(1,p*1.8))
            layer = Image.new('RGBA', canvas.size)
            ImageDraw.Draw(layer).text((x, (44+dy)*SS), c, font=main, fill=(*CREAM, opacity), anchor='lt')
            canvas.alpha_composite(layer)
            glyph += 1
        x += width
    d = ImageDraw.Draw(canvas)
    d.text((19*SS, 13*SS), 'THE MOMENT OF GOLF', font=font(7, True), fill=(*LIME, 255), anchor='lt')
    line_p = min(1, (i+1)/9)
    d.rounded_rectangle((19*SS, 98*SS, (19+202*line_p)*SS, 100*SS), radius=SS, fill=(*LIME, 255))
    # This small cursor also belongs to the prepared source. It is not engine motion.
    cursor_x = 19+202*(i/15)
    d.ellipse(((cursor_x-2.5)*SS, 109.5*SS, (cursor_x+2.5)*SS, 114.5*SS), fill=(*LIME, 255))
    out = canvas.resize((W,H), Image.Resampling.LANCZOS)
    # Canonical invisible RGB makes production cleanAlpha(0) exactly lossless.
    pixels = [(0,0,0,0) if p[3] == 0 else p for p in (out.get_flattened_data() if hasattr(out,'get_flattened_data') else out.getdata())]
    out.putdata(pixels)
    return out

sheet = Image.new('RGBA', (W*4, H*4))
for i in range(N):
    sheet.paste(make_frame(i), ((i%4)*W, (i//4)*H))
sheet.save(ROOT/'typography-source.png', optimize=True)
sha = lambda b: hashlib.sha256(b).hexdigest()
provenance = {
    'title': '골프의 순간',
    'method': 'Externally prepared deterministic font-rendered kinetic typography; not AI image generation and not an engine text-animation feature.',
    'preparation': 'Pillow 3x supersampling; five Hangul glyphs enter from alternating vertical directions; opacity, reveal line and cursor are prepared in each input cell.',
    'font': {'family': 'Noto Sans CJK KR', 'collectionIndex': FONT_INDEX,
             'boldSha256': sha(Path(FONT).read_bytes()), 'regularSha256': sha(Path(REG).read_bytes()),
             'license': 'SIL Open Font License 1.1', 'fontFilesRedistributed': False},
    'source': {'path': 'typography-source.png', 'width': W*4, 'height': H*4,
               'frameWidth': W, 'frameHeight': H, 'frameCount': N, 'columns': 4, 'rows': 4,
               'bytes': (ROOT/'typography-source.png').stat().st_size,
               'sha256': sha((ROOT/'typography-source.png').read_bytes())},
    'anchor': 'Every cell retains the same 240x128 canvas and text layout; main type rests at y=44 and underline at y=98.',
    'loop': 'Reveal then hold; replay deliberately resets to the beginning. No seamless-loop claim.'
}
(ROOT/'input-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(provenance['source'], ensure_ascii=False))
