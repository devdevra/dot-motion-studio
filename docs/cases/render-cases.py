#!/usr/bin/env python3
"""Compose actual engine frames into a silent Korean explanation. This is not a UI recording.
Requires Pillow, Noto Sans CJK, FFmpeg + ffprobe. No networking, TTS, pose synthesis or interpolation.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, json, os, subprocess

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.build'
W, H, VIDEO_FPS, DURATION = 1280, 720, 24, 36
REG = os.getenv('DEMO_FONT_REGULAR', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
BOLD = os.getenv('DEMO_FONT_BOLD', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
BG, PANEL, FG, MUTED, LINE = '#0c1420', '#172333', '#f5f7fb', '#adbdcf', '#33465d'
ACCENTS = ['#78cbdc', '#f5b4cc', '#ffcd76']
FONTS = {}

def font(size, bold=False):
    key = size, bold
    if key not in FONTS:
        path = BOLD if bold else REG
        FONTS[key] = ImageFont.truetype(path, size, index=1 if path.endswith('.ttc') else 0)
    return FONTS[key]
def text(im, xy, label, size=22, fill=FG, bold=False):
    ImageDraw.Draw(im).text(xy, label, font=font(size,bold), fill=fill, anchor='lt')
def box(im, xy, fill=PANEL, r=16, outline=None, width=1):
    ImageDraw.Draw(im).rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)
def checker(size, square=16):
    out = Image.new('RGBA',size,'#edf2f5'); d = ImageDraw.Draw(out)
    for y in range(0,size[1],square):
        for x in range(0,size[0],square):
            if (x//square+y//square)%2: d.rectangle((x,y,x+square-1,y+square-1),fill='#dce5eb')
    return out
def on_checker(sprite,size,square=16):
    base=checker(size,square)
    base.alpha_composite(sprite.resize(size,Image.Resampling.NEAREST))
    return base.convert('RGB')

PROOF=json.loads((ROOT/'engine-verification.json').read_text())
CASES=[]
for idx,c in enumerate(PROOF['cases']):
    root=ROOT/'outputs'/c['id']
    meta=json.loads((root/f"{c['id']}-atlas.json").read_text())
    frames=[Image.open(root/'frames'/e['filename']).convert('RGBA') for e in meta['frames']]
    assert len(frames)==8 and all(f.size==(128,128) for f in frames)
    src=Image.open(ROOT/c['input']['path']).convert('RGBA')
    atlas=Image.open(root/f"{c['id']}-atlas.png").convert('RGBA')
    assert src.size==atlas.size==(512,256)
    c.update(root=root,meta=meta,frames=frames,source=src,atlas=atlas,accent=ACCENTS[idx])
    c['cache']={size:[on_checker(f,(size,size),max(8,size//16)) for f in frames] for size in (88,160,224,256,288,320)}
    c['sheet']=on_checker(src,(448,224),14)
    c['atlas_small']=on_checker(atlas,(320,160),10)
    CASES.append(c)

CAPTIONS=[
 (0,3,'AI가 미리 그린 3종의 8프레임 시트로 실제 움직임을 확인합니다.'),
 (3,6,'로봇: 4×2 원본 시트를 왼쪽부터 읽어 8프레임으로 분리합니다.'),
 (6,9,'128×128 셀을 그대로 보존합니다. 원본의 발·몸 위치를 다시 정렬하지 않습니다.'),
 (9,12,'실제 추출 PNG를 8 FPS로 재생합니다. 걷는 포즈는 원본에 이미 들어 있습니다.'),
 (12,15,'마스코트: 깜박임·기쁨·차분함, 미리 그린 표정을 순서대로 꺼냅니다.'),
 (15,18,'투명도를 유지하고 8 FPS로 재생합니다. 표정을 새로 만들어 내지는 않습니다.'),
 (18,21,'표정 변화와 원본의 작은 크기·위치 차이도 결과에 그대로 남습니다.'),
 (21,24,'깃발: 8장의 서로 다른 천 모양을 시트에서 분리합니다.'),
 (24,27,'12 FPS로 빠르게 재생합니다. 바람이나 천의 물리를 계산하지 않습니다.'),
 (27,30,'반복 재생은 가능하지만, 마지막과 첫 포즈가 매끈하게 이어짐을 보장하지 않습니다.'),
 (30,33,'각 예제의 엔진 출력: PNG 아틀라스 + 좌표·타이밍 JSON + PNG 시퀀스 ZIP'),
 (33,36,'로컬 엔진 출력 검증 완료 · 라이브 MCP 연결은 아직 확인되지 않았습니다.'),
]

def caption(t): return next(s for a,b,s in CAPTIONS if a<=t<b)
def header(t,title,kicker,accent='#78cbdc'):
    im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
    d.ellipse((48,32,61,45),fill=accent)
    text(im,(73,24),'DOT MOTION STUDIO',24,bold=True)
    box(im,(905,22,1232,62),'#223246',10)
    text(im,(924,31),'실제 엔진 출력으로 만든 설명 영상',17,MUTED)
    text(im,(48,83),title,43,bold=True)
    text(im,(50,145),kicker,21,accent,True)
    box(im,(32,630,1248,679),'#1e2c3e',10)
    text(im,(51,644),caption(t),22)
    text(im,(48,691),'AI 원본 프레임 → 추출·정리·재생  |  MP4/GIF: 별도 FFmpeg  |  화면 녹화 아님 · 무음',15,MUTED)
    text(im,(1176,691),f'{int(t):02d}/36',15,MUTED)
    d.rectangle((0,715,W,720),fill='#273447')
    d.rectangle((0,715,round(W*t/DURATION),720),fill=accent)
    return im

def case_index(c,t): return int(t*c['fps']+1e-6)%8

def overview(t,closing=False):
    title='원본 24프레임, 출력 3세트' if closing else '캐릭터도, 표정도, 소품도'
    kicker='PNG 아틀라스  ·  JSON 메타데이터  ·  PNG 시퀀스 ZIP' if closing else '03 CASES  /  미리 준비된 포즈를 실제 애니메이션으로 확인'
    im=header(t,title,kicker)
    for i,c in enumerate(CASES):
        x=48+i*400
        box(im,(x,198,x+384,612),outline=LINE)
        text(im,(x+20,217),f'0{i+1}  {c["title"]}',25,c['accent'],True)
        idx=case_index(c,t)
        size=224 if closing else 256
        px=x+(384-size)//2; py=266
        im.paste(c['cache'][size][idx],(px,py))
        text(im,(x+25,538 if not closing else 507),f'8 frames  /  {c["fps"]} FPS',22,FG,True)
        if closing:
            text(im,(x+25,550),'512×256 atlas  +  8 PNG',21,MUTED)
            text(im,(x+25,584),'원본 셀·알파 유지',17,c['accent'])
        else:
            text(im,(x+25,579),'4×2 입력 시트 → 순서대로 재생',18,MUTED)
    return im

def one_case(t,which,start):
    c=CASES[which]; local=t-start; idx=case_index(c,local)
    phase=min(2,int(local//3))
    im=header(t,c['title'],f'CASE 0{which+1}  /  8 FRAMES  /  {c["fps"]} FPS  /  원본 앵커 유지',c['accent'])
    box(im,(48,190,532,491),outline=LINE)
    text(im,(67,208),'01  원본 시트 · AI가 미리 그린 포즈',22,c['accent'],True)
    im.paste(c['sheet'],(66,250))
    d=ImageDraw.Draw(im)
    for n in range(8):
        x=66+n%4*112; y=250+n//4*112
        d.rectangle((x,y,x+111,y+111),outline='#9aaebc',width=1)
    x=66+idx%4*112; y=250+idx//4*112
    d.rectangle((x,y,x+111,y+111),outline=c['accent'],width=4)
    text(im,(574,225),'4 × 2',31,c['accent'],True)
    text(im,(574,269),'명시적 격자',20,MUTED)
    text(im,(574,326),'trim: false',22,FG,True)
    text(im,(574,367),'padding: 0',22,FG,True)
    d.line((575,437,737,437),fill=c['accent'],width=3)
    d.polygon([(737,437),(727,430),(727,444)],fill=c['accent'])
    box(im,(788,190,1232,491),outline=LINE)
    text(im,(808,208),'03  실제 출력 재생',22,c['accent'],True)
    im.paste(c['cache'][224][idx],(808,250))
    text(im,(1052,269),f'{idx+1:02d} / 08',31,c['accent'],True)
    text(im,(1052,323),'128×128',20)
    text(im,(1052,354),'PNG 프레임',18,MUTED)
    text(im,(1052,413),f'{c["fps"]} FPS',23,FG,True)
    text(im,(50,507),'02  순서대로 추출된 PNG',20,c['accent'],True)
    text(im,(803,507),'모든 포즈는 입력 시트에 이미 존재합니다',18,MUTED)
    for n in range(8):
        x=48+n*150
        im.paste(c['cache'][88][n],(x+1,534))
        d.rectangle((x,533,x+89,622),outline=c['accent'] if n==idx else LINE,width=3 if n==idx else 1)
        text(im,(x+96,548),f'{n+1:02d}',18,c['accent'] if n==idx else MUTED,True)
    # Time-dependent emphasis makes the three steps traceable without altering the source.
    labels=['입력','추출','재생']
    for n,label in enumerate(labels):
        x=993+n*80
        text(im,(x,148),label,17,c['accent'] if n==phase else '#53677e',n==phase)
    return im

def render(t):
    if t<3: return overview(t)
    if t<30:
        which=int((t-3)//9)
        return one_case(t,which,3+which*9)
    return overview(t,True)

def encode(path,frame_iter,size,fps):
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{size[0]}x{size[1]}','-framerate',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','23','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',str(path)],stdin=subprocess.PIPE)
    try:
        for frame in frame_iter: p.stdin.write(frame.convert('RGB').tobytes())
        p.stdin.close()
    except Exception: p.kill(); raise
    if p.wait()!=0: raise RuntimeError(f'ffmpeg encode failed: {path}')

def preview_frames(c):
    for n in range(4*VIDEO_FPS):
        im=Image.new('RGB',(384,448),BG); idx=case_index(c,n/VIDEO_FPS)
        text(im,(18,16),c['title'],25,c['accent'],True)
        im.paste(c['cache'][320][idx],(32,65))
        text(im,(20,401),f'{idx+1:02d}/08   ·   {c["fps"]} FPS   ·   추출 PNG 재생',20,MUTED)
        yield im

def subtitles():
    def stamp(n,srt=False): return f'00:00:{n:02d}'+(',000' if srt else '.000')
    (ROOT/'dot-motion-cases-ko.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a,True)} --> {stamp(b,True)}\n{s}' for i,(a,b,s) in enumerate(CAPTIONS))+'\n')
    (ROOT/'dot-motion-cases-ko.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(a)} --> {stamp(b)}\n{s}' for a,b,s in CAPTIONS)+'\n')

def contacts():
    im=Image.new('RGB',(1280,880),BG)
    text(im,(40,27),'3종 모션 · 실제 엔진 프레임 확인',36,bold=True)
    text(im,(42,86),'행마다 01 → 08 순서  |  셀 앵커 유지  |  AI 원본의 차이도 그대로 보존',21,MUTED)
    for row,c in enumerate(CASES):
        y=154+row*238
        text(im,(42,y),f'{c["title"]}  ·  {c["fps"]} FPS',26,c['accent'],True)
        for n in range(8):
            x=42+n*152
            im.paste(on_checker(c['frames'][n],(136,136),17),(x,y+44))
            text(im,(x+52,y+190),f'{n+1:02d}',18,MUTED,True)
    text(im,(42,849),'검증 범위: 로컬 runPipeline 출력 · 라이브 MCP 미확인 · 보간/신규 포즈 생성 없음',17,MUTED)
    im.save(ROOT/'dot-motion-cases-contact-sheet.png',optimize=True)

def build_review():
    times=[1.5,4.5,7.5,10.5,13.5,16.5,19.5,22.5,25.5,28.5,31.5,34.5]
    for n,t in enumerate(times):
        # Inspect decoded MP4, not only renderer intermediates.
        path=BUILD/f'review-{n:02d}.png'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(ROOT/'dot-motion-cases-ko.mp4'),'-frames:v','1',str(path)],check=True)
    # 3 columns × 4 rows, preserving 16:9 ratio.
    im=Image.new('RGB',(1281,960),BG)
    for n in range(len(times)):
        frame=Image.open(BUILD/f'review-{n:02d}.png')
        im.paste(frame.resize((427,240),Image.Resampling.LANCZOS),(n%3*427,n//3*240))
    im.save(BUILD/'review-montage.jpg',quality=95)

def probe(path,expected_duration):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(path),'-f','null','-'],check=True)
    p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,nb_frames,r_frame_rate','-of','json',str(path)]))
    assert abs(float(p['format']['duration'])-expected_duration)<.1
    assert not any(s['codec_type']=='audio' for s in p['streams'])
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'fullDecode':'passed',**p}

def main():
    BUILD.mkdir(exist_ok=True); subtitles(); contacts()
    encode(ROOT/'dot-motion-cases-ko.mp4',(render(i/VIDEO_FPS) for i in range(DURATION*VIDEO_FPS)),(W,H),VIDEO_FPS)
    render(1.5).save(ROOT/'dot-motion-cases-poster.png',optimize=True)
    for c in CASES: encode(c['root']/f'{c["id"]}-preview.mp4',preview_frames(c),(384,448),VIDEO_FPS)
    # Compact visual quick-look only, not the full subtitled explanation.
    quick=BUILD/'quick-look.mp4'
    def quick_frames():
        for i in range(24):
            im=Image.new('RGB',(768,256),BG)
            for j,c in enumerate(CASES):
                idx=case_index(c,i/12)
                im.paste(c['cache'][224][idx],(j*256+16,0))
                text(im,(j*256+16,234),c['title'],15,c['accent'],True)
            yield im
    encode(quick,quick_frames(),(768,256),12)
    gif=ROOT/'dot-motion-cases-quick-look.gif'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(quick),'-filter_complex','[0:v]fps=12,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-map_metadata','-1','-loop','0',str(gif)],check=True)
    report={ 'dot-motion-cases-ko.mp4':probe(ROOT/'dot-motion-cases-ko.mp4',DURATION), 'dot-motion-cases-quick-look.gif':probe(gif,2) }
    for c in CASES:
        p=c['root']/f'{c["id"]}-preview.mp4'; report[str(p.relative_to(ROOT))]=probe(p,4)
    assert (ROOT/'dot-motion-cases-ko.mp4').stat().st_size<2_000_000,'MP4 size budget exceeded'
    assert gif.stat().st_size<1_000_000,'GIF size budget exceeded'
    report['notes']=['All animation frames are decoded PNG sequence output from unchanged production engine.',
        'AI source sheets supplied pre-drawn poses; no pose generation or interpolation performed by engine.',
        'Canvas anchors preserved exactly; AI source temporal consistency is not guaranteed.',
        'MP4/GIF use separate FFmpeg composition; no alpha in MP4; checkerboard is a viewing aid.',
        'Silent Korean explanatory composition, not a screen recording or live MCP execution.',
        'Representative decoded MP4 frames sampled at 12 timestamps under .build/.']
    report['tools']={'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0], 'pillow':Image.__version__}
    (ROOT/'media-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    build_review()
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
