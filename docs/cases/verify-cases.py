#!/usr/bin/env python3
"""Independent pixel, timeline, container, link and checksum checks for the case deliverables."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageStat
import argparse, hashlib, io, json, re, subprocess, zipfile

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--published-only',action='store_true',help='Verify the partial public package; explicitly skip unpublished media and deferred originals')
args=parser.parse_args()
# Stable release scope, including after a local renderer rewrites media metadata.
PUBLISHED_OMISSIONS=frozenset([
 'dot-motion-cases-quick-look.gif',
 'inputs/originals/robot-walk-ai-source.png','inputs/originals/mascot-expression-ai-source.png','inputs/originals/flag-wave-ai-source.png',
 'inputs/robot-walk-contact.jpg','inputs/mascot-expression-contact.jpg',
])
skipped=list(PUBLISHED_OMISSIONS) if args.published_only else []
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
proof=json.loads((ROOT/'engine-verification.json').read_text())
provenance=json.loads((ROOT/'inputs/input-provenance.json').read_text())
media=json.loads((ROOT/'media-verification.json').read_text())
assert sha(ROOT/'../../lib/motion-engine.mjs')==proof['engine']['sha256'],'engine changed after build'

def clean_invisible(im):
    data=bytearray(im.convert('RGBA').tobytes())
    for n in range(0,len(data),4):
        if data[n+3]==0:data[n:n+4]=bytes(4)
    return bytes(data)

def expected_preview(frame,size):
    square=max(8,size//16)
    out=Image.new('RGBA',(size,size),'#edf2f5'); d=ImageDraw.Draw(out)
    for y in range(0,size,square):
        for x in range(0,size,square):
            if (x//square+y//square)%2:d.rectangle((x,y,x+square-1,y+square-1),fill='#dce5eb')
    out.alpha_composite(frame.resize((size,size),Image.Resampling.NEAREST))
    return out.convert('RGB')

def verify_timeline(path,frames,size,x,y,count,fps,seek=0):
    # Decode the actual displayed sprite rectangle. Compare every output frame against
    # every candidate engine PNG; nearest-image identity must match the intended frame.
    raw=subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(seek),'-i',str(path),'-frames:v',str(count),'-vf',f'crop={size}:{size}:{x}:{y}','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
    stride=size*size*3; assert len(raw)==stride*count
    candidates=[expected_preview(f,size) for f in frames]
    observed=[]; errors=[]
    for n in range(count):
        actual=Image.frombytes('RGB',(size,size),raw[n*stride:(n+1)*stride])
        diffs=[sum(ImageStat.Stat(ImageChops.difference(actual,c)).mean)/3 for c in candidates]
        best=min(range(8),key=lambda i:diffs[i]); expected=int(n*fps/24+1e-6)%8
        assert best==expected,(str(path),n,best,expected,diffs)
        assert diffs[best]<12,(str(path),n,diffs[best])
        observed.append(best+1);errors.append(diffs[best])
    return {'decodedVideoFramesChecked':count,'sourcePoseIndicesMatched':observed,'maxMeanAbsoluteRgbError':round(max(errors),4),'passed':True}

results=[]
for ci,c in enumerate(proof['cases']):
    root=ROOT/'outputs'/c['id']; src=Image.open(ROOT/c['input']['path']).convert('RGBA')
    assert sha(ROOT/c['input']['path'])==c['input']['sha256']
    prov=next(p for p in provenance['cases'] if p['id']==c['id'])
    assert prov['sha256']==c['input']['sha256']
    if args.published_only and 'inputs/'+prov['originalAiSheet'] in PUBLISHED_OMISSIONS:
        skipped.append('inputs/'+prov['originalAiSheet'])
    elif 'originalSha256' in prov:assert sha(ROOT/'inputs'/prov['originalAiSheet'])==prov['originalSha256']
    atlas=Image.open(root/f"{c['id']}-atlas.png").convert('RGBA')
    meta=json.loads((root/f"{c['id']}-atlas.json").read_text())
    opts=json.loads((root/f"{c['id']}-options.json").read_text())
    assert opts==c['options'];assert src.size==atlas.size==(512,256)
    frames=[]
    with zipfile.ZipFile(root/f"{c['id']}-frames.zip") as z:
        assert len(z.namelist())==9
        for i,f in enumerate(meta['frames']):
            path=root/'frames'/f['filename']; frame=Image.open(path).convert('RGBA')
            assert frame.size==(128,128);assert path.read_bytes()==z.read(f['filename'])
            r=(i%4*128,i//4*128,i%4*128+128,i//4*128+128)
            assert frame.tobytes()==clean_invisible(src.crop(r))
            assert frame.tobytes()==atlas.crop(r).tobytes()
            assert sha(path)==c['frames'][i]['sha256']
            frames.append(frame)
    results.append({'case':c['id'],'sourceOrderAndAlpha':True,'zipAndAtlasMatch':True,
        'individualPreviewTimeline':verify_timeline(root/f"{c['id']}-preview.mp4",frames,320,32,65,96,c['fps']),
        'mainVideoTimelineSample':verify_timeline(ROOT/'dot-motion-cases-ko.mp4',frames,224,808,250,24,c['fps'],3+ci*9)})
for path,m in media.items():
    if path in ('notes','tools'):continue
    if args.published_only and path in PUBLISHED_OMISSIONS:
        skipped.append(path)
        continue
    p=ROOT/path;assert sha(p)==m['sha256'];assert p.stat().st_size==int(m['format']['size'])
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(p),'-f','null','-'],check=True)

# Manifest is produced last so it also hashes this verification record.
(ROOT/'SHA256SUMS.txt').touch(exist_ok=True)
links=[]
for p in ROOT.glob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if not re.match(r'^[a-z]+:',target) and not target.startswith('#'):
            assert (p.parent/target.split('#')[0]).exists(),(p,target)
            links.append({'document':p.name,'target':target})
report={'verificationScope':'published-only' if args.published_only else 'full local package','skippedUnpublishedFiles':sorted(set(skipped)),'engineUnchanged':True,'caseChecks':results,'allMediaFullDecode':'passed for included media only' if args.published_only else 'passed','localMarkdownLinks':len(links),
    'manualVisualReview':'Creation-stage record: 12 main-video sample images and the 24-frame contact sheet were reviewed. This verifier compares all 288 individual-preview frames plus 72 main-video sample frames (24 per case); it does not pose-compare all 864 main-video frames. All included videos are fully decoded. Robot gait and uneven cloth increments remain disclosed.'}
(ROOT/'final-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
files=sorted(p for p in ROOT.rglob('*') if p.is_file() and not any(q in ('.build','__pycache__') for q in p.relative_to(ROOT).parts) and p.name!='SHA256SUMS.txt' and (not args.published_only or str(p.relative_to(ROOT)) not in skipped))
(ROOT/'SHA256SUMS.txt').write_text(''.join(f'{sha(p)}  {p.relative_to(ROOT)}\n' for p in files))
print(json.dumps({'filesHashed':len(files),'engineUnchanged':True,'cases':len(results),'timelineVideoFramesChecked':sum(r['individualPreviewTimeline']['decodedVideoFramesChecked']+r['mainVideoTimelineSample']['decodedVideoFramesChecked'] for r in results),'mediaFullDecode':'passed','localLinksChecked':len(links)},indent=2))
