#!/usr/bin/env python3
"""Full decode, real decoded frame comparison, input limits and delivery hashes."""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib, json, subprocess

ROOT=Path(__file__).resolve().parent
BUILD=ROOT/'.build'
mp4=ROOT/'typography-ko.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries',
    'format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,nb_read_frames,r_frame_rate','-of','json',str(mp4)]))
s=probe['streams'][0]
assert s['width']==720 and s['height']==720 and s['nb_read_frames']=='240' and s['r_frame_rate']=='24/1'
assert abs(float(probe['format']['duration'])-10)<.01
assert len(probe['streams'])==1 and s['codec_type']=='video' and s['codec_name']=='h264' and s['pix_fmt']=='yuv420p'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(mp4),'-f','null','-'],check=True)
indexes=[24,48,57,66,75,84,90,114,144,168,216]
for i in indexes:
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mp4),
      '-vf',f'select=eq(n\\,{i})','-frames:v','1',str(BUILD/f'decoded-{i:03d}.png')],check=True)

review=Image.new('RGB',(1440,1440),'#102721')
for j,i in enumerate([24,48,57,66,75,84,90,144,216]):
    im=Image.open(BUILD/f'decoded-{i:03d}.png').convert('RGB').resize((480,480),Image.Resampling.LANCZOS)
    review.paste(im,((j%3)*480,(j//3)*480))
review.save(BUILD/'decoded-review.png')
mobile=Image.new('RGB',(1080,360),'#102721')
for j,i in enumerate([24,90,216]):
    im=Image.open(BUILD/f'decoded-{i:03d}.png').convert('RGB').resize((360,360),Image.Resampling.LANCZOS)
    mobile.paste(im,(j*360,0))
mobile.save(BUILD/'mobile-review.png')

# Compare each output sprite ROI with its real decoded video appearance.
# Uniform-color panel compositing and H.264 may cause small errors; no frame interpolation.
sequence_errors=[]
for i in [48,57,66,75,84,90,114,144,168]:
    idx=int(((i/24)-2)*8)%16
    frame=Image.open(BUILD/'frames'/f'typography-{idx+1:03d}.png').convert('RGBA').resize((600,320),Image.Resampling.LANCZOS)
    expected=Image.new('RGB',(600,320),'#183a30');expected.paste(frame,(0,0),frame)
    actual=Image.open(BUILD/f'decoded-{i:03d}.png').convert('RGB').crop((60,222,660,542))
    # Header and bottom progress indicator are outside the text crop.
    a=actual.crop((0,60,600,296));e=expected.crop((0,60,600,296))
    from PIL import ImageChops, ImageStat
    error=sum(ImageStat.Stat(ImageChops.difference(a,e)).mean)/3
    assert error<4.0,(i,idx,error)
    sequence_errors.append({'videoFrame':i,'sourceFrame':idx+1,'meanAbsoluteRgbError':round(error,4)})

proof={'scope':'Decoded delivery MP4, not only pre-encode PNGs','probe':probe,'fullDecodePassed':True,
  'frameOrderChecks':sequence_errors,'reviewImages':['.build/decoded-review.png','.build/mobile-review.png'],
  'notes':['240 video frames fully decoded','Source animation: 8 FPS. Video: 24 FPS, each animation frame repeats 3 times.',
           'Actual engine PNGs are externally composited; MP4 does not preserve alpha.',
           'No audio; Korean captions are burned in and also supplied as SRT.']}
proof['images']={}
for name in ['typography-source.png','typography-atlas.png','typography-comparison.png','typography-poster.png']:
    p=ROOT/name
    with Image.open(p) as im:
        proof['images'][name]={'width':im.width,'height':im.height,'mode':im.mode,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(ROOT/'media-verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=sorted(p for p in ROOT.iterdir() if p.is_file() and p.name!='SHA256SUMS.txt')
(ROOT/'SHA256SUMS.txt').write_text('\n'.join(f'{sha(p)}  {p.name}' for p in files)+'\n')
print(json.dumps({'videoBytes':mp4.stat().st_size,'duration':10,'decodedFrames':240,'frameOrderChecks':len(sequence_errors),'sha256':sha(mp4)},indent=2))
