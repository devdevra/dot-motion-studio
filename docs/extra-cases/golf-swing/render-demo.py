#!/usr/bin/env python3
"""Presentation assembly only. Displays actual engine PNG frames; FFmpeg encodes MP4.
No image inbetweening, pose repair, time interpolation, TTS, live MCP call or UI recording.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, json, os, subprocess

ROOT=Path(__file__).resolve().parent
BUILD=ROOT/'.build';BUILD.mkdir(exist_ok=True)
W,H,FPS,DURATION=1280,720,24,10
BG='#f5f4ed';INK='#162d32';MUTED='#5a6d6c';TEAL='#087f83';WHITE='#ffffff';LINE='#cbd8d4'
REG=os.getenv('DEMO_FONT_REGULAR','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
BOLD=os.getenv('DEMO_FONT_BOLD','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
LABELS=['어드레스','테이크어웨이','백스윙','백스윙 톱','다운스윙','임팩트','릴리스','피니시']
FONT={}
def font(size,bold=False):
    key=size,bold
    if key not in FONT:FONT[key]=ImageFont.truetype(BOLD if bold else REG,size,index=1)
    return FONT[key]
def text(im,xy,s,size=22,fill=INK,bold=False):
    ImageDraw.Draw(im).text(xy,s,font=font(size,bold),fill=fill,anchor='lt')
def box(im,rect,fill=WHITE,r=16,outline=None,width=1):
    ImageDraw.Draw(im).rounded_rectangle(rect,radius=r,fill=fill,outline=outline,width=width)
def sprite(im,art,xy,size):
    # Presentation scaling only; source/output files are not modified.
    im.paste(art.resize((size,size),Image.Resampling.NEAREST),xy,art.resize((size,size),Image.Resampling.NEAREST))
def sheet_on_light(art,size):
    bg=Image.new('RGBA',size,WHITE);bg.alpha_composite(art.resize(size,Image.Resampling.NEAREST));return bg.convert('RGB')

proof=json.loads((ROOT/'engine-verification.json').read_text())
frames=[Image.open(ROOT/'frames'/e['name']).convert('RGBA') for e in proof['frames']]
src=Image.open(ROOT/'golf-swing-input.png').convert('RGBA')
atlas=Image.open(ROOT/'golf-swing-atlas.png').convert('RGBA')
assert len(frames)==8 and all(f.size==(192,192) for f in frames)
assert src.size==atlas.size==(768,384)
sheet=sheet_on_light(atlas,(560,280))
large=[f.resize((440,440),Image.Resampling.NEAREST) for f in frames]

def state(frame):
    if frame<96:return frame//12,1
    return min(7,(frame-96)//18),2

def render(frame):
    idx,cycle=state(frame)
    im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
    text(im,(42,28),'DOT MOTION  /  GOLF SWING',20,TEAL,True)
    text(im,(42,66),'8개 포즈로 보는 골프 스윙',41,INK,True)
    text(im,(45,123),'AI 원본 포즈 → 실제 엔진 PNG 추출 → 반복 재생',21,MUTED)
    box(im,(867,30,1238,73),'#dfede7',12)
    text(im,(888,43),'개념 애니메이션 · 자세 교정용 아님',18,TEAL,True)
    box(im,(40,175,542,618),WHITE,18,LINE)
    # Draw the actual exported frame; there are no transforms of individual limbs or club.
    im.paste(large[idx],(72,168),large[idx])
    d.line((95,584,495,584),fill=LINE,width=2)
    text(im,(356,195),'목표 방향 →',19,TEAL,True)
    text(im,(65,594),f'{idx+1:02d} / 08',18,MUTED,True)
    text(im,(406,594),'192×192 PNG',15,MUTED)
    text(im,(591,183),'순서대로 보기 · 포즈당 0.50초' if cycle==1 else '느리게 다시 보기 · 포즈당 0.75초',24,TEAL,True)
    text(im,(591,225),f'{idx+1:02d}  {LABELS[idx]}',37,INK,True)
    text(im,(593,282),'4×2 아틀라스 · 왼쪽부터, 위에서 아래로',18,MUTED)
    im.paste(sheet,(602,321))
    for i in range(8):
        x=602+(i%4)*140;y=321+(i//4)*140
        d.rectangle((x,y,x+139,y+139),outline=TEAL if i==idx else LINE,width=4 if i==idx else 1)
        d.rounded_rectangle((x+6,y+6,x+36,y+28),radius=5,fill=TEAL if i==idx else '#e1e8e5')
        text(im,(x+13,y+10),str(i+1),13,WHITE if i==idx else MUTED,True)
    box(im,(40,636,1238,679),INK,10)
    text(im,(61,648),'포즈는 AI 원본에 포함 · 엔진은 프레임 분리·아틀라스·JSON·ZIP 출력',21,WHITE,True)
    text(im,(42,692),'MP4: 별도 FFmpeg 조립  |  프레임 보간 없음  |  피니시 뒤 어드레스로 다시 시작',15,MUTED)
    text(im,(1150,692),f'{frame/FPS:04.1f} / 10s',15,MUTED)
    d.rectangle((0,H-4,int(W*(frame+1)/(FPS*DURATION)),H),fill=TEAL)
    return im

def contact():
    im=Image.new('RGB',(1600,1110),BG);d=ImageDraw.Draw(im)
    text(im,(44,29),'골프 스윙 · 원본과 실제 추출 결과',38,INK,True)
    text(im,(46,89),'8개 AI 포즈 / 동일한 순서·투명도 유지 / 단순 추출 엔진 검증 / 목표 방향 →',22,MUTED)
    text(im,(47,143),'입력 시트 768×384',23,TEAL,True)
    text(im,(831,143),'엔진 출력 아틀라스 768×384',23,TEAL,True)
    im.paste(sheet_on_light(src,(720,360)),(44,183))
    im.paste(sheet_on_light(atlas,(720,360)),(828,183))
    for x in (44,828):
        for i in range(8):
            xx=x+i%4*180;yy=183+i//4*180
            d.rectangle((xx,yy,xx+179,yy+179),outline=LINE,width=1)
    text(im,(47,573),'PNG 시퀀스 · 01 → 08',26,TEAL,True)
    for i,f in enumerate(frames):
        x=44+i*194
        box(im,(x,630,x+184,868),WHITE,10,LINE)
        sprite(im,f,(x+2,644),180)
        text(im,(x+13,841),f'{i+1:02d}  {LABELS[i]}',18,INK,True)
    text(im,(47,904),'검증: 원본 셀 ↔ PNG ↔ 아틀라스 픽셀 일치 · ZIP 8 PNG + JSON · 동일 입력 재실행 해시 일치',24,INK,True)
    text(im,(47,953),'원본 준비: 같은 비율로 축소 후, 각 셀 전체를 발 기준으로 평행 이동했습니다. 팔다리·클럽은 다시 그리지 않았습니다.',22,MUTED)
    text(im,(47,994),'AI 원본의 작은 비례·클럽 투영 길이 차이가 남습니다. 자세 정확도·부드러운 반복·물리 시뮬레이션을 보장하지 않습니다.',22,MUTED)
    text(im,(47,1051),'로컬 엔진 출력 예제 · 라이브 MCP 연결 확인 아님 · MP4는 별도 FFmpeg 조립',21,TEAL,True)
    im.save(ROOT/'golf-swing-comparison.png',optimize=True)

CAPTIONS=[(0,4,'8개 AI 포즈를 실제 엔진 PNG로 분리했습니다. 포즈당 0.50초로 순서대로 봅니다.'),(4,10,'같은 8개 PNG를 포즈당 0.75초로 느리게 다시 봅니다. 개념 애니메이션이며 자세 교정용이 아닙니다.')]
def stamp(n):return f'00:00:{n:02d},000'
(ROOT/'golf-swing-ko.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{s}' for i,(a,b,s) in enumerate(CAPTIONS))+'\n')
contact()
render(48).save(ROOT/'golf-swing-poster.png',optimize=True)
out=ROOT/'golf-swing-ko.mp4'
cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','22','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',str(out)]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
try:
    for frame in range(DURATION*FPS):p.stdin.write(render(frame).tobytes())
    p.stdin.close()
except Exception:p.kill();raise
assert p.wait()==0
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(out)]))
probe['format']['filename']=out.name  # Published report never includes an executor workspace path.
v=[s for s in probe['streams'] if s['codec_type']=='video'];assert len(v)==1
assert v[0]['codec_name']=='h264' and (v[0]['width'],v[0]['height'])==(W,H)
assert int(v[0]['nb_frames'])==240 and abs(float(probe['format']['duration'])-10)<.01
assert not any(s['codec_type']=='audio' for s in probe['streams'])
verification={'scope':'External Pillow composition of real engine PNGs, encoded by FFmpeg. Silent conceptual animation, not a screen recording or native engine video output.','durationSeconds':10,'width':W,'height':H,'fps':FPS,'encodedFrames':240,'poseFrames':8,'phaseOrder':LABELS,'passes':[{'start':0,'end':4,'holdSecondsPerPose':.5},{'start':4,'end':10,'holdSecondsPerPose':.75}],'interpolation':False,'audio':False,'mp4Bytes':out.stat().st_size,'mp4Sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'ffmpegVersion':subprocess.check_output(['ffmpeg','-version']).decode().splitlines()[0],'probe':probe}
(ROOT/'media-verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:verification[k] for k in ['durationSeconds','encodedFrames','mp4Bytes','mp4Sha256']},indent=2))
