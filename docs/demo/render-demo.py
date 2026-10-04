#!/usr/bin/env python3
"""Render a Korean explanatory video from real engine outputs (not a UI recording).
Requires Pillow, Noto Sans CJK, ffmpeg and ffprobe. No network, paid provider or TTS.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse, hashlib, json, os, subprocess

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
WIDTH, HEIGHT, FPS, DURATION = 1280, 720, 12, 24
FONT_REG = os.getenv('DEMO_FONT_REGULAR', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
FONT_BOLD = os.getenv('DEMO_FONT_BOLD', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
BG, CARD, FG, MUTED, ACCENT = '#0c1420', '#172333', '#f5f7fb', '#b5c2d1', '#ffb46d'
fonts = {}
def font(size, bold=False):
    key = (size, bold)
    if key not in fonts:
        path = FONT_BOLD if bold else FONT_REG
        fonts[key] = ImageFont.truetype(path, size, index=1 if path.endswith('.ttc') else 0)
    return fonts[key]
def text(im, xy, value, size=26, fill=FG, bold=False):
    ImageDraw.Draw(im).text(xy, value, font=font(size, bold), fill=fill, anchor='lt')
def box(im, xy, fill=CARD, radius=18, outline=None):
    ImageDraw.Draw(im).rounded_rectangle(xy, radius=radius, fill=fill, outline=outline)
def checker(size, square=16):
    im = Image.new('RGBA', size, '#e9eef3')
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                d.rectangle((x, y, x + square - 1, y + square - 1), fill='#d3dce5')
    return im

def alpha_on_checker(sprite, size, square=16):
    base = checker(size, square)
    base.alpha_composite(sprite.resize(size, Image.Resampling.NEAREST))
    return base.convert('RGB')

proof = json.loads((ROOT / 'engine-verification.json').read_text())
meta = json.loads((ROOT / 'golf-ball-atlas.json').read_text())
source = Image.open(ROOT / 'golf-ball-input.png').convert('RGBA')
atlas = Image.open(ROOT / 'golf-ball-atlas.png').convert('RGBA')
frames = [Image.open(BUILD / entry['filename']).convert('RGBA') for entry in meta['frames']]
assert all(im.size == (276, 96) for im in frames)
assert atlas.size == (1104, 384)
assert source.size == (96, 96)

CHAPTERS = [
    (0, 5, '01  입력 PNG', 'PNG 한 장에서 시작해요', '미리 준비한 투명 골프공 이미지를 실제 엔진에 넣었습니다.'),
    (5, 12, '02  2D 이동', '같은 이미지를 16프레임으로 이동', '공의 모양은 그대로, 매 프레임 X 방향으로 12픽셀 이동합니다.'),
    (12, 18, '03  아틀라스', '모든 프레임을 아틀라스 한 장에', '16프레임을 가로 4칸에 배치하고, 좌표와 타이밍을 JSON에 기록합니다.'),
    (18, 24, '04  내보내기', '필요한 결과물을 가져가세요', 'PNG·JSON·ZIP이 도구의 출력입니다. 이 영상은 출력물로 따로 편집했습니다.'),
]


def base(t, chapter):
    im = Image.new('RGB', (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(im)
    d.ellipse((56, 39, 70, 53), fill=ACCENT)
    text(im, (84, 30), 'DOT MOTION STUDIO', 24, bold=True)
    box(im, (925, 25, 1224, 68), '#223246', 12)
    text(im, (944, 34), '실제 로컬 엔진 출력 · 한국어', 18, MUTED)
    text(im, (56, 97), chapter[3], 44, bold=True)
    text(im, (57, 167), chapter[2], 23, ACCENT, True)
    box(im, (40, 619, 1240, 671), '#1e2c3e', 10)
    text(im, (58, 633), chapter[4], 25)
    text(im, (56, 688), '설명 영상 · 화면 녹화 아님 · 동영상/GIF는 별도 FFmpeg 제작 · 무음', 16, MUTED)
    text(im, (1149, 687), f'{int(t):02d} / 24', 16, MUTED)
    d.rectangle((0, 714, WIDTH, 720), fill='#273447')
    d.rectangle((0, 714, round(WIDTH * t / DURATION), 720), fill=ACCENT)
    return im

def render(t):
    chapter = next(c for c in CHAPTERS if c[0] <= t < c[1])
    im = base(t, chapter)
    d = ImageDraw.Draw(im)
    if t < 5:
        box(im, (56, 222, 443, 599))
        im.paste(alpha_on_checker(source, (288, 288), 18), (105, 238))
        text(im, (102, 550), 'golf-ball-input.png', 23)
        text(im, (494, 248), '투명 PNG 1장', 34, bold=True)
        text(im, (495, 310), '96 × 96 px  /  RGBA', 28, ACCENT)
        text(im, (495, 367), '체크무늬는 투명 영역 표시예요', 27)
        text(im, (495, 427), '이미지 준비: 생성된 골프공을 96px로 축소', 24, MUTED)
        text(im, (495, 474), '움직임은 실제 runPipeline으로 처리', 24, MUTED)
        text(im, (495, 541), '이미 준비된 이미지를 일정하게 이동해요', 24, ACCENT)
    elif t < 12:
        for x, label in zip((56, 354, 652, 950), ('16 프레임', 'X  +12 px', 'Y  0 px', '12 FPS')):
            box(im, (x, 221, x + 274, 269), '#223246', 12)
            text(im, (x + 20, 231), label, 23, bold=True)
        box(im, (56, 289, 1224, 598), '#162333', 18)
        index = int((t - 5) * 12) % 16
        preview = alpha_on_checker(frames[index], (828, 288), 18)
        im.paste(preview, (78, 300))
        text(im, (942, 335), f'{index + 1:02d} / 16', 32, ACCENT, True)
        text(im, (942, 401), '276 × 96 px', 21)
        text(im, (942, 439), '프레임 크기', 20, MUTED)
        text(im, (942, 506), '같은 포즈 유지', 20, MUTED)
        text(im, (942, 543), '단순 2D 이동', 20, MUTED)
    elif t < 18:
        preview = alpha_on_checker(atlas, (1104, 384), 12)
        pd = ImageDraw.Draw(preview)
        for i, entry in enumerate(meta['frames']):
            f = entry['frame']; x, y, w, h = f['x'], f['y'], f['w'], f['h']
            pd.rectangle((x, y, x + w - 1, y + h - 1), outline='#8799ac', width=1)
            pd.rounded_rectangle((x + 5, y + 5, x + 33, y + 26), radius=5, fill='#172333')
            pd.text((x + 9, y + 6), f'{i + 1:02d}', font=font(13, True), fill='#f5f7fb', anchor='lt')
        im.paste(preview, (88, 220))
        text(im, (391, 175), '1104 × 384 px · 4 × 4칸 · 격자·번호는 설명용 표시', 19, MUTED)
    else:
        for x in (56, 454, 852):
            box(im, (x, 227, x + 372, 466))
        text(im, (78, 248), 'PNG 아틀라스', 27, bold=True)
        im.paste(alpha_on_checker(atlas, (276, 96), 8), (98, 302))
        text(im, (79, 422), '1104 × 384 · 투명도 유지', 21, MUTED)
        text(im, (476, 248), 'JSON 메타데이터', 27, bold=True)
        text(im, (477, 314), f'frameCount  {meta["meta"]["frameCount"]}', 24, ACCENT)
        text(im, (477, 355), f'fps                 {meta["meta"]["fps"]}', 24, ACCENT)
        text(im, (477, 422), '좌표 · 크기 · 재생 정보', 21, MUTED)
        text(im, (874, 248), 'PNG 시퀀스 ZIP', 27, bold=True)
        text(im, (875, 314), 'PNG 16장', 28, ACCENT, True)
        text(im, (875, 357), '+ JSON 1개', 24, MUTED)
        text(im, (875, 422), '프레임별 이미지 모음', 21, MUTED)
        text(im, (62, 502), '출력된 프레임을 순서대로 재생하면', 29, bold=True)
        text(im, (63, 553), '이 예제처럼 움직임을 확인할 수 있어요', 28, MUTED)
        idx = int((t - 18) * 12) % 16
        im.paste(alpha_on_checker(frames[idx], (552, 192), 16).resize((414, 144)), (810, 474))
    return im


def subtitle_files():
    def timestamp(seconds, comma=False):
        return f'00:00:{seconds:02d}' + (',000' if comma else '.000')
    (ROOT / 'dot-motion-demo-ko.vtt').write_text('WEBVTT\n\n' + '\n\n'.join(
        f'{timestamp(a)} --> {timestamp(b)}\n{caption}' for a,b,_,__,caption in CHAPTERS) + '\n', encoding='utf-8')
    (ROOT / 'dot-motion-demo-ko.srt').write_text('\n\n'.join(
        f'{i+1}\n{timestamp(a,True)} --> {timestamp(b,True)}\n{caption}' for i,(a,b,_,__,caption) in enumerate(CHAPTERS)) + '\n', encoding='utf-8')


def run():
    BUILD.mkdir(exist_ok=True)
    subtitle_files()
    mp4 = ROOT / 'dot-motion-demo-ko.mp4'
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
               '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{WIDTH}x{HEIGHT}',
               '-framerate', str(FPS), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
               '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
               '-map_metadata', '-1', '-movflags', '+faststart', str(mp4)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for i in range(FPS * DURATION):
            frame = render(i / FPS)
            if i in (24, 90, 180, 258):
                frame.save(BUILD / f'review-{i:03d}.png')
            if i == 90:
                frame.save(ROOT / 'dot-motion-demo-poster.png', optimize=True)
            process.stdin.write(frame.tobytes())
        process.stdin.close()
    except Exception:
        process.kill(); raise
    if process.wait() != 0:
        raise RuntimeError('ffmpeg could not encode MP4')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mp4),
        '-filter_complex', '[0:v]fps=8,scale=768:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
        '-map_metadata','-1','-loop','0',str(ROOT / 'dot-motion-demo-ko.gif')],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(mp4),'-f','null','-'],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(ROOT / 'dot-motion-demo-ko.gif'),'-f','null','-'],check=True)
    reports = {}
    for name in ('dot-motion-demo-ko.mp4', 'dot-motion-demo-ko.gif'):
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
            'format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,nb_frames,r_frame_rate',
            '-of','json',str(ROOT/name)]))
        duration = float(probe['format']['duration'])
        assert abs(duration - DURATION) < 0.2, probe
        assert not any(s['codec_type'] == 'audio' for s in probe['streams'])
        reports[name] = {'sha256': hashlib.sha256((ROOT/name).read_bytes()).hexdigest(), **probe}
    reports['notes'] = ['Silent explanatory video, not an app screen recording',
        'All displayed ball animation frames came from the real local motion engine',
        'MP4 and GIF are external FFmpeg compositions, not native engine exports',
        'Caption bar is burned in; Korean SRT and WebVTT are supplied separately']
    (ROOT/'media-verification.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(reports, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    run()
