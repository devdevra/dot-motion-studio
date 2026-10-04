#!/usr/bin/env python3
"""Read-only artifact/hash and full decoded-video pose-order verification."""
from pathlib import Path
from PIL import Image
import argparse, hashlib, json, subprocess
import numpy as np

ROOT=Path(__file__).resolve().parent
args=argparse.ArgumentParser(description=__doc__)
args.add_argument('--skip-manifest',action='store_true',help='Check regenerated files without enforcing the original artifact hashes')
args=args.parse_args()
hashes=[]
if not args.skip_manifest:
    for line in (ROOT/'SHA256SUMS.txt').read_text().splitlines():
        expected,name=line.split('  ',1)
        actual=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
        assert actual==expected,f'Hash mismatch: {name}'
        hashes.append(name)
proof=json.loads((ROOT/'engine-verification.json').read_text())
assert proof['verification']['sourceCellOrderAndPixels']
assert proof['verification']['atlasFramePixels']
assert proof['verification']['repeatPipelineByteIdentical']
refs=[]
for e in proof['frames']:
    art=Image.open(ROOT/'frames'/e['name']).convert('RGBA').resize((440,440),Image.Resampling.NEAREST)
    canvas=Image.new('RGB',(440,440),'white');canvas.paste(art,(0,0),art)
    refs.append(np.asarray(canvas.crop((0,62,440,414)),dtype=np.int16))
refs=np.stack(refs)
cmd=['ffmpeg','-hide_banner','-loglevel','error','-i',str(ROOT/'golf-swing-ko.mp4'),'-vf','crop=440:352:72:230','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
p=subprocess.Popen(cmd,stdout=subprocess.PIPE)
size=440*352*3;records=[]
for n in range(240):
    blob=p.stdout.read(size)
    assert len(blob)==size,('Decoded video truncated',n,len(blob))
    frame=np.frombuffer(blob,dtype=np.uint8).reshape(352,440,3).astype(np.int16)
    errors=np.abs(refs-frame).mean(axis=(1,2,3))
    expected=n//12 if n<96 else (n-96)//18
    nearest=int(errors.argmin())
    assert nearest==expected,('Pose order mismatch',n,expected,nearest,errors.tolist())
    assert float(errors[expected])<6,('Lossy video error unusually large',n,float(errors[expected]))
    records.append(float(errors[expected]))
assert p.stdout.read(1)==b'','More than 240 video frames'
assert p.wait()==0
result={'sha256FilesVerified':len(hashes),'videoFramesChecked':240,'allExpectedPoseIndicesMatch':True,'maxRgbMeanAbsoluteError':max(records),'averageRgbMeanAbsoluteError':sum(records)/len(records),'comparisonRegion':{'x':72,'y':230,'width':440,'height':352},'note':'All 240 decoded frames match the expected real-engine source pose by nearest mean absolute RGB error; no intermediate poses expected. This verifies assembly/order, not golf accuracy.'}
build=ROOT/'.build';build.mkdir(exist_ok=True)
(build/'full-video-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
