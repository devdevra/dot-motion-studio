"""Deterministic preparation only: grid crop, common scale, rigid anchor placement.
No semantic segmentation, alpha cleanup, repainting, interpolation, or new poses.
AI source sheets and final input metadata are preserved beside this script.
"""
from pathlib import Path
from PIL import Image, ImageChops
import argparse, json, hashlib, shutil, struct

HERE=Path(__file__).resolve().parent
RAW=HERE/'originals'
# Checked-in originals are preferred. This staging folder is used only when one is missing.
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--generated-dir',type=Path,default=HERE/'generated',
 help='Optional AI source staging directory; default: inputs/generated beside this script')
parser.add_argument('--use-prepared',action='store_true',help='Verify published prepared inputs without reading originals or writing files')
args=parser.parse_args()
GENERATED=args.generated_dir
if args.use_prepared:
 expected={'robot-walk':'d2597854885338bc451a8e700d262857c33f4e7fc79ad2af910778ef68aa1afa','mascot-expression':'bdb018fcbecbe5ea04b676fce345bf62a5fe514d3d632afae179e8d01637c77d','flag-wave':'b5ae2f9990828a7bc569bf78f24c0a89baf039abb7212462e5c0b9959b085530'}
 for case,digest in expected.items():
  if hashlib.sha256((HERE/f'{case}.png').read_bytes()).hexdigest()!=digest:raise SystemExit(f'Prepared input checksum mismatch: {case}')
 print('All three published prepared inputs verified; original preparation skipped.')
 raise SystemExit(0)
CASES=[
 ('robot-walk','exec-dc501fab-a7a1-477c-9f5a-c6ac3b35eac8.png',.27,'ground','robot_walk',8),
 ('mascot-expression','exec-541e88f9-27b1-4df3-bf4f-9bed01780365.png',.27,'ground','mascot_expressions',8),
 ('flag-wave','exec-7dc29742-512e-47e1-81f5-4353ef9366a6.png',.285,'pole','flag_wave',12)
]
NOTES={
 'robot-walk':['Eight distinct AI-drawn marching poses; limb swing is stylized and not a biomechanically exact walk cycle.','Source has small identity/pose variations and a repeat-boundary step; do not label seamless.','Source row 2 has a slightly higher ground baseline; per-frame rigid placement aligns the opaque foot baseline without changing pose shape.'],
 'mascot-expression':['Sequence: calm, half blink, full blink, reopen, small smile, joyful open smile, joyful closed smile, calm.','Source silhouette is very consistent; small shading/outline variation remains between AI-drawn frames.','Frame 8 and frame 1 express calm but are independently generated; not pixel-identical.'],
 'flag-wave':['Eight genuine cloth-shape phases with distinct crests and troughs.','The AI source has pole-anchor drift between columns and rows; deterministic rigid anchor placement corrects the canvas positions.','Cloth phase increments are approximate and not physics-based; do not claim seamless or simulated cloth.']
}
# Check every required original before writing any output.
for case,source,*_ in CASES:
 if not (RAW/f'{case}-ai-source.png').is_file() and not (GENERATED/source).is_file():
  raise SystemExit('AI originals are not included in this release. Use --use-prepared, then run node docs/cases/build-cases.mjs. Source preparation requires separately available originals.')
RAW.mkdir(exist_ok=True)
reports=[]
for case,source,scale,anchor,promptkey,fps in CASES:
 rawpath=RAW/f'{case}-ai-source.png'
 if not rawpath.exists():shutil.copyfile(GENERATED/source,rawpath)
 raw=Image.open(rawpath).convert('RGBA');w,h=raw.size
 sheet=Image.new('RGBA',(512,256));frames=[];placements=[]
 for i in range(8):
  c,r=i%4,i//4
  box=(round(c*w/4),round(r*h/2),round((c+1)*w/4),round((r+1)*h/2))
  cell=raw.crop(box)
  # 50% alpha is used only to measure an anchor. Original alpha is untouched.
  mask=cell.getchannel('A').point(lambda v:255 if v>=128 else 0)
  bounds=mask.getbbox()
  if anchor=='pole':
   lower_y=round(cell.height*.82)
   pb=mask.crop((0,lower_y,cell.width,cell.height)).getbbox()
   sx=(pb[0]+pb[2])/2;sy=lower_y+pb[3]
   tx,ty=28,118
  else:
   sx=cell.width/2;sy=bounds[3];tx,ty=64,118
  target=(round(cell.width*scale),round(cell.height*scale))
  small=cell.resize(target,Image.Resampling.LANCZOS)
  actualx=target[0]/cell.width;actualy=target[1]/cell.height
  offset=(round(tx-sx*actualx),round(ty-sy*actualy))
  frame=Image.new('RGBA',(128,128));frame.paste(small,offset)
  sheet.paste(frame,(c*128,r*128));frames.append(frame)
  outmask=frame.getchannel('A').point(lambda v:255 if v>=128 else 0)
  outbb=outmask.getbbox()
  assert outbb[0]>0 and outbb[1]>0 and outbb[2]<128 and outbb[3]<128, (case,i,outbb)
  placements.append({'frame':i,'sourceRect':list(box),'sourceAnchor':[sx,sy],'targetAnchor':[tx,ty],'resampledCell':list(target),'pasteOffset':list(offset),'opaqueOutputBounds':list(outbb)})
 path=HERE/f'{case}.png';sheet.save(path,optimize=True,compress_level=9)
 rawdata=path.read_bytes()
 assert len(rawdata)<2_000_000 and sheet.width*sheet.height<=1_000_000
 assert rawdata[28]==0, 'PNG must not be interlaced'
 # A neutral contact sheet for inspection is a QA representation, not engine input.
 qa=Image.new('RGBA',sheet.size,(247,244,234,255));qa.alpha_composite(sheet)
 qa.convert('RGB').save(HERE/f'{case}-contact.jpg',quality=92)
 diffs=[sum(ImageChops.difference(frames[i],frames[(i+1)%8]).convert('RGB').resize((1,1)).getpixel((0,0))) for i in range(8)]
 reports.append({'id':case,'engineInput':path.name,'originalAiSheet':str(rawpath.relative_to(HERE)),'generationTool':'built-in image_gen.imagegen','sourceToolFile':source,'promptKey':promptkey,'originalDimensions':list(raw.size),'originalSha256':hashlib.sha256(rawpath.read_bytes()).hexdigest(),'originalBytes':rawpath.stat().st_size,'width':512,'height':256,'mode':'RGBA','grid':{'cols':4,'rows':2},'frameCount':8,'frameOrder':'row-major, left-to-right then top-to-bottom','frameWidth':128,'frameHeight':128,'recommendedFps':fps,'bytes':len(rawdata),'sha256':hashlib.sha256(rawdata).hexdigest(),'nonInterlaced':True,'animatedPng':False,'alphaExtrema':list(sheet.getchannel('A').getextrema()),'preparation':{'commonScale':scale,'filter':'Pillow LANCZOS','operations':['Equal-cell grid crop using rounded source boundaries','Uniform scale per case','Rigid per-frame anchor placement onto 128x128 transparent canvas','Row-major 4x2 atlas assembly; RGBA non-interlaced PNG encoding'],'alphaThresholdApplied':False,'semanticCleanup':False,'repainted':False,'syntheticFrames':False,'placement':placements},'visualQa':NOTES[case],'adjacentRgbDifferenceIndicative':diffs})
(HERE/'input-provenance.json').write_text(json.dumps({'createdAt':'2026-10-04','purpose':'Original AI-drawn pose and expression inputs for real Dot Motion frame extraction demos. The engine does not generate these poses.','generationPrompts':'generation-prompts.json','preparationScript':'prepare_inputs.py','cases':reports},ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{k:r[k] for k in ['id','engineInput','width','height','bytes','frameCount','alphaExtrema']} for r in reports],indent=2))
