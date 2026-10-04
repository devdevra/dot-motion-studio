#!/usr/bin/env python3
"""Deterministic raster preparation, no pose generation or art repair.
Equal grid crops, one common scale, whole-cell rigid placement, PNG encoding only.
"""
from pathlib import Path
from PIL import Image
import argparse, hashlib, json

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--use-prepared',action='store_true',help='Verify the published input without requiring the unpublished AI original or writing any files')
args=parser.parse_args()
if args.use_prepared:
    prepared=ROOT/'golf-swing-input.png'
    expected='17ed49cdeab331a13028e892d56c915aa77839db3993b8d392d0cc9b61325876'
    actual=hashlib.sha256(prepared.read_bytes()).hexdigest()
    if actual!=expected:
        raise SystemExit('Prepared input SHA-256 mismatch; restore the published input before continuing.')
    print('Verified published prepared input; raw-source preparation skipped (original publication pending).')
    raise SystemExit(0)
rawpath=ROOT/'golf-swing-ai-source.png'
if not rawpath.is_file():
    raise SystemExit('AI original publication and source-preparation reproduction are pending. Use --use-prepared to verify the published input, then run node build-engine.mjs.')
raw=Image.open(rawpath).convert('RGBA')
sheet=Image.new('RGBA',(768,384))
placements=[]
for i in range(8):
    col,row=i%4,i//4
    rect=(round(col*raw.width/4),round(row*raw.height/2),round((col+1)*raw.width/4),round((row+1)*raw.height/2))
    cell=raw.crop(rect)
    mask=cell.getchannel('A').point(lambda a:255 if a>=128 else 0)
    # Measure feet in the bottom 15% of the source cell; never alter alpha.
    y0=round(cell.height*.85)
    feet=mask.crop((0,y0,cell.width,cell.height)).getbbox()
    assert feet, (i, 'missing foot anchor')
    anchor=((feet[0]+feet[2])/2,y0+feet[3])
    size=(round(cell.width*.40),round(cell.height*.40))
    scaled=cell.resize(size,Image.Resampling.LANCZOS)
    offset=(round(96-anchor[0]*size[0]/cell.width),round(180-anchor[1]*size[1]/cell.height))
    frame=Image.new('RGBA',(192,192));frame.paste(scaled,offset)
    outmask=frame.getchannel('A').point(lambda a:255 if a>=128 else 0)
    bounds=outmask.getbbox()
    assert bounds and 0<bounds[0]<bounds[2]<192 and 0<bounds[1]<bounds[3]<192,(i,bounds)
    # Ensure no actual opaque source pixels have been clipped after placement.
    before=sum(scaled.getchannel('A').histogram()[128:])
    after=sum(frame.getchannel('A').histogram()[128:])
    assert before==after,(i,before,after)
    sheet.paste(frame,(col*192,row*192))
    placements.append({'phase':i+1,'sourceRect':list(rect),'sourceFootAnchor':list(anchor),'targetFootAnchor':[96,180],'scaledSize':list(size),'pasteOffset':list(offset),'outputOpaqueBounds':list(bounds),'opaquePixelsClipped':0})
path=ROOT/'golf-swing-input.png';sheet.save(path,optimize=True,compress_level=9)
blob=path.read_bytes()
assert len(blob)<=2*1024*1024 and sheet.width*sheet.height<=1000000
report={
    'generationTool':'built-in image_gen.imagegen','original':'golf-swing-ai-source.png',
    'originalPublication':{'status':'pending','includedInThisRelease':False,'note':'Original filename and hash identify the creation-stage source; use the published prepared input for reproducible engine extraction. Source-preparation reproduction awaits original publication.'},
    'originalDimensions':list(raw.size),'originalBytes':rawpath.stat().st_size,'originalSha256':hashlib.sha256(rawpath.read_bytes()).hexdigest(),
    'engineInput':path.name,'inputDimensions':list(sheet.size),'inputBytes':len(blob),'inputSha256':hashlib.sha256(blob).hexdigest(),
    'operations':['Equal 4x2 grid crop with rounded source boundaries','Common 0.40 scale, Pillow LANCZOS; integer dimensions differ by at most one pixel','Rigid whole-cell placement at measured foot-midpoint and baseline (96,180)','4x2 assembly of transparent 192x192 cells; non-interlaced RGBA PNG encoding'],
    'notPerformed':['Pose generation by code','Repainting or club/anatomy repair','Semantic background removal','Per-limb transforms','Frame interpolation','Physics simulation'],
    'alphaUsedForAnchorOnly':128,'alphaThresholdAppliedByPreparation':False,'placements':placements,
    'limitations':['AI-drawn pose proportions, head direction and club apparent length vary modestly between frames.','This conceptual key-pose animation is not golf coaching, motion capture or a biomechanically validated swing.','The repeat boundary is a deliberate reset from finish to address, not a seamless loop.']
}
(ROOT/'input-provenance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['engineInput','inputDimensions','inputBytes','inputSha256']},indent=2))
