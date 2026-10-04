#!/usr/bin/env python3
"""Separate FFmpeg edit of actual engine output. No engine video feature is implied."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, json, os, subprocess, zipfile

ROOT = Path(__file__).resolve().parent
BUILD = ROOT/'.build'
W = H = 720
FPS, SECONDS = 24, 10
BG, PANEL, FG, MUTED, ACCENT = '#102721', '#183a30', '#f4f4db', '#b2c5ae', '#c5f161'
FONT = os.getenv('TYPE_FONT_BOLD','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
REG = os.getenv('TYPE_FONT_REGULAR','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
FONT_INDEX = int(os.getenv('TYPE_FONT_INDEX','1'))
FONTS = {}
def font(size,bold=False):
    key=(size,bold)
    if key not in FONTS:
        p=FONT if bold else REG
        FONTS[key]=ImageFont.truetype(p,size,index=FONT_INDEX if p.endswith('.ttc') else 0)
    return FONTS[key]
def text(im,xy,s,size=24,color=FG,bold=False):
    ImageDraw.Draw(im).text(xy,s,font=font(size,bold),fill=color,anchor='lt')
def box(im,rect,fill=PANEL,r=16,outline=None,width=1):
    ImageDraw.Draw(im).rounded_rectangle(rect,radius=r,fill=fill,outline=outline,width=width)
def sprite(im,source,xy,size):
    scaled=source.resize(size,Image.Resampling.LANCZOS)
    im.paste(scaled,xy,scaled)

atlas=Image.open(ROOT/'typography-atlas.png').convert('RGBA')
source=Image.open(ROOT/'typography-source.png').convert('RGBA')
meta=json.loads((ROOT/'typography-atlas.json').read_text())
with zipfile.ZipFile(ROOT/'typography-frames.zip') as z:
    z.extractall(BUILD/'frames')
frames=[Image.open(BUILD/'frames'/e['filename']).convert('RGBA') for e in meta['frames']]
assert all(f.size==(240,128) for f in frames)

CHAPTERS=[
    (0,2,'준비된 한글 모션','폰트로 16장의 모션 프레임을 먼저 준비했어요'),
    (2,8,'타이밍을 재생하다','실제 엔진으로 나눈 프레임을 8 FPS로 재생해요'),
    (8,10,'좌표와 투명도, 그대로','PNG 아틀라스 · JSON · 프레임 ZIP으로 저장해요'),
]
def base(t,chapter):
    im=Image.new('RGB',(W,H),BG)
    d=ImageDraw.Draw(im)
    d.ellipse((34,33,45,44),fill=ACCENT)
    text(im,(56,30),'DOT MOTION STUDIO',18,FG,True)
    text(im,(490,32),'TYPE STUDY / 01',16,MUTED)
    d.line((32,66,688,66),fill='#3b5748',width=1)
    text(im,(34,95),chapter[2],40,FG,True)
    box(im,(34,590,686,663),'#223e31',12)
    text(im,(51,612),chapter[3],24,FG,True)
    text(im,(34,684),'글자 모션은 사전 제작 · 영상은 별도 FFmpeg 편집',17,MUTED)
    d.rectangle((0,715,720,719),fill='#314e3e')
    d.rectangle((0,715,round(720*t/SECONDS),719),fill=ACCENT)
    return im

def draw_atlas(im,xy,size,caption=False,asset=atlas):
    x,y=xy; aw,ah=size
    box(im,(x,y,x+aw,y+ah),PANEL,8)
    sprite(im,asset,xy,size)
    d=ImageDraw.Draw(im)
    for row in range(4):
        for col in range(4):
            cx=x+col*aw/4; cy=y+row*ah/4
            d.rectangle((cx,cy,cx+aw/4-1,cy+ah/4-1),outline='#426047',width=1)
    if caption: text(im,(x,y+ah+12),'960 × 512 px  /  4 × 4',19,MUTED)

def render(t):
    ch=next(c for c in CHAPTERS if c[0]<=t<c[1])
    im=base(t,ch);d=ImageDraw.Draw(im)
    if t<2:
        text(im,(36,158),'01  폰트 렌더링 · 엔진 밖에서 준비',22,ACCENT,True)
        draw_atlas(im,(35,216),(480,256),asset=source)
        text(im,(550,230),'16',64,ACCENT,True)
        text(im,(550,308),'FRAMES',16,MUTED,True)
        text(im,(550,361),'240',34,FG,True)
        text(im,(550,405),'× 128 px',19,MUTED)
        text(im,(36,510),'한 글자씩 등장하고, 같은 기준선에 멈춥니다',24,FG)
    elif t<8:
        text(im,(36,158),'02  실제 엔진 출력 · 8 FPS',22,ACCENT,True)
        idx=int((t-2)*8)%16
        box(im,(35,213,685,560),PANEL,20)
        sprite(im,frames[idx],(60,222),(600,320))
        text(im,(51,228),f'{idx+1:02d} / 16',16,MUTED,True)
        for n in range(16):
            x=52+n*39
            d.rounded_rectangle((x,542,x+30,546),radius=2,fill=ACCENT if n<=idx else '#345244')
    else:
        text(im,(36,158),'03  손실 없는 프레임 추출',22,ACCENT,True)
        box(im,(35,207,685,420),PANEL,18)
        sprite(im,frames[15],(171,208),(378,202))
        text(im,(48,439),'고정 캔버스 보존',22,FG,True)
        text(im,(421,439),'투명 알파 보존',22,FG,True)
        for x,title,detail in [(35,'PNG','아틀라스'),(258,'JSON','좌표 · 타이밍'),(481,'ZIP','개별 PNG 16장')]:
            box(im,(x,490,x+203,568),'#c5f161',12)
            text(im,(x+16,500),title,25,BG,True)
            text(im,(x+16,537),detail,17,BG)
    return im

def contact():
    im=Image.new('RGB',(1200,840),BG)
    text(im,(38,30),'골프의 순간',42,FG,True)
    text(im,(40,92),'KOREAN KINETIC TYPE  /  실제 엔진 입력과 출력 비교',23,ACCENT,True)
    text(im,(40,145),'입력 · 외부 폰트 렌더링 16프레임',24,FG,True)
    text(im,(640,145),'출력 · 실제 엔진 아틀라스',24,FG,True)
    for x,asset in [(40,source),(640,atlas)]:
        sprite(im,asset,(x,190),(520,277))
        d=ImageDraw.Draw(im)
        for r in range(4):
            for c in range(4):
                d.rectangle((x+c*130,190+r*69.25,x+(c+1)*130,190+(r+1)*69.25),outline='#426047')
    text(im,(40,487),'960 × 512  /  RGBA',21,MUTED)
    text(im,(640,487),'16개 셀의 RGBA 픽셀 100% 일치',21,MUTED)
    text(im,(40,542),'프레임 순서 · 시작 → 등장 → 정렬 → 유지',25,FG,True)
    for j,idx in enumerate((0,3,7,15)):
        x=40+j*290
        box(im,(x,594,x+268,745),PANEL,12)
        sprite(im,frames[idx],(x+8,596),(252,134))
        text(im,(x+14,727),f'FRAME {idx+1:02d}',15,MUTED,True)
    text(im,(40,784),'엔진: 분리 · 정렬 보존 · 출력  |  글자 모션: 사전 제작  |  MP4: 별도 편집',22,MUTED)
    im.save(ROOT/'typography-comparison.png',optimize=True)

def subtitles():
    out=[]
    for i,(a,b,_,caption) in enumerate(CHAPTERS):
        out.append(f'{i+1}\n00:00:{a:02d},000 --> 00:00:{b:02d},000\n{caption}')
    (ROOT/'typography-ko.srt').write_text('\n\n'.join(out)+'\n')

BUILD.mkdir(exist_ok=True)
contact();subtitles()
render(3.75).save(ROOT/'typography-poster.png',optimize=True)
args=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24',
      '-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libx264',
      '-preset','slow','-crf','19','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',
      str(ROOT/'typography-ko.mp4')]
proc=subprocess.Popen(args,stdin=subprocess.PIPE)
try:
    for i in range(FPS*SECONDS): proc.stdin.write(render(i/FPS).tobytes())
    proc.stdin.close()
except BaseException:
    proc.kill();raise
assert proc.wait()==0
print('Rendered typography-ko.mp4: 720x720, 24 FPS, 10 seconds, silent')
