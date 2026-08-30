const $ = id => document.getElementById(id);
const Fabric = window.fabric;
const sizePresets = {'35x45':[35,45],'51x51':[50.8,50.8],'25x30':[25,30],'30x40':[30,40],'33x48':[33,48],'50x50':[50,50]};
const paperPresets = {'4x6':[101.6,152.4],'5x7':[127,177.8],'6x8':[152.4,203.2],'8x10':[203.2,254],'a4':[210,297],'a5':[148,210]};
const nepalPresets = {general35x45:[35,45],passport35x45:[35,45],citizenship35x45:[35,45],loksewa35x45:[35,45],bank35x45:[35,45],school35x45:[35,45],licence35x45:[35,45]};
const mmToPx = (mm,dpi=outputDpi()) => Math.round(mm/25.4*dpi);
let fabricCanvas=null, sourceFile=null, sourceDataUrl=null, workingBaseDataUrl=null, retouchedDataUrl=null, originalImageEl=null, subjectObj=null, backgroundObj=null, backgroundRect=null, photoBorderObj=null, removedBlob=null, removalBusy=false, cropGuide=null, cropTarget=null, displayingBefore=false;
let history=[], historyIndex=-1, restoringHistory=false, historyTimer=null;

if (!Fabric) window.addEventListener('load',()=>status('Editor library could not load. Please refresh once.','error'));

function outputDpi(){return Number($('outputDpi')?.value||300)}
function photoSize(){return $('photoSize').value==='custom'?[Number($('customWidth').value)||35,Number($('customHeight').value)||45]:sizePresets[$('photoSize').value]}
function editorDims(){const [w,h]=photoSize();const maxH=Math.min(560,Math.max(360,window.innerHeight*0.60)),maxW=470,ratio=w/h;let H=maxH,W=H*ratio;if(W>maxW){W=maxW;H=W/ratio}return [Math.round(W),Math.round(H)]}
function status(msg,type=''){const el=$('status');if(!el)return;el.textContent=msg;el.className='status '+type}
function borderSizeMm(){return $('borderEnabled')?.checked?Math.max(0,Number($('borderSize')?.value||0)):0}
function applyPhotoBorder(render=true){
  const wrap=$('canvasWrap');if(wrap){wrap.style.borderWidth='0';wrap.style.borderColor='transparent'}
  $('borderControls')?.classList.toggle('disabled-control',!$('borderEnabled')?.checked);
  if(!subjectObj||!fabricCanvas)return;
  const mm=borderSizeMm(),[w]=photoSize(),px=mm>0?Math.max(1,(fabricCanvas.width/w)*mm):0;
  subjectObj.set({stroke:mm>0?($('borderColor')?.value||'#ffffff'):null,strokeWidth:px,strokeUniform:true,paintFirst:'stroke'});
  subjectObj.setCoords();if(render)fabricCanvas.requestRenderAll();
}
function updateBorderPreview(){applyPhotoBorder(true)}
function updateInfo(){const [w,h]=photoSize(),dpi=outputDpi(),b=borderSizeMm(),pxW=mmToPx(w,dpi),pxH=mmToPx(h,dpi);$('previewInfo').textContent=`${w} × ${h} mm${b?` • Photo border ${b} mm`:''} • ${dpi} DPI • ${pxW} × ${pxH} px`;$('pixelInfo').textContent=`${pxW} × ${pxH} px`;updateBorderPreview()}
function imageFromUrl(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Image decode failed'));i.src=url})}
function fileToDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
async function normalizeImageFile(file){
  const maxDim=4096;
  let bitmap=null, img=null, width=0, height=0;
  try{
    if('createImageBitmap' in window){bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});width=bitmap.width;height=bitmap.height}
  }catch(_e){bitmap=null}
  if(!bitmap){const raw=await fileToDataURL(file);img=await imageFromUrl(raw);width=img.naturalWidth||img.width;height=img.naturalHeight||img.height}
  if(!width||!height)throw new Error('Invalid image dimensions');
  const scale=Math.min(1,maxDim/Math.max(width,height)),outW=Math.max(1,Math.round(width*scale)),outH=Math.max(1,Math.round(height*scale));
  const cvs=document.createElement('canvas');cvs.width=outW;cvs.height=outH;const ctx=cvs.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap||img,0,0,outW,outH);if(bitmap&&bitmap.close)bitmap.close();
  const data=cvs.toDataURL('image/png',1);
  if(!data||data==='data:,')throw new Error('Canvas conversion failed');
  return {dataUrl:data,width,height,previewWidth:outW,previewHeight:outH};
}
function blobToDataURL(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)})}

function bindCanvasEvents(){
  fabricCanvas.on('selection:created',refreshLayers);fabricCanvas.on('selection:updated',refreshLayers);fabricCanvas.on('selection:cleared',refreshLayers);
  fabricCanvas.on('object:modified',()=>{refreshLayers();saveHistory('Object changed')});
}
function initCanvas(){const [W,H]=editorDims();if(fabricCanvas)fabricCanvas.dispose();fabricCanvas=new Fabric.Canvas('editorCanvas',{width:W,height:H,preserveObjectStacking:true,selection:false,enableRetinaScaling:true});fabricCanvas.getContext().imageSmoothingEnabled=true;fabricCanvas.getContext().imageSmoothingQuality='high';bindCanvasEvents();backgroundRect=new Fabric.Rect({left:0,top:0,width:W,height:H,fill:$('bgColor').value,selectable:false,evented:false,name:'Background Color',layerType:'backgroundColor'});fabricCanvas.add(backgroundRect);fabricCanvas.sendToBack(backgroundRect);updateBorderPreview()}
function makeFabricImage(img,name,type){return new Fabric.Image(img,{name,layerType:type,transparentCorners:false,cornerColor:'#0b5ed7',cornerStrokeColor:'#fff',borderColor:'#0b5ed7',cornerSize:11,padding:2,centeredScaling:false,originX:'center',originY:'center'})}
function placeCover(obj){const W=fabricCanvas.width,H=fabricCanvas.height,sc=Math.max(W/obj.width,H/obj.height);obj.set({scaleX:sc,scaleY:sc,left:W/2,top:H/2,angle:0});obj.setCoords()}
function placeSubject(obj){const W=fabricCanvas.width,H=fabricCanvas.height,sc=Math.min(W/obj.width,H/obj.height)*.92;obj.set({scaleX:sc,scaleY:sc,left:W/2,top:H/2,angle:0});obj.setCoords()}
function relinkObjects(){const objs=fabricCanvas?.getObjects()||[];backgroundRect=objs.find(o=>o.layerType==='backgroundColor')||null;backgroundObj=objs.find(o=>o.layerType==='backgroundImage')||null;subjectObj=objs.find(o=>o.layerType==='subject')||null;applyPhotoBorder(false)}
async function setSubjectFromDataUrl(dataUrl,name='Photo'){const img=await imageFromUrl(dataUrl);if(subjectObj)fabricCanvas.remove(subjectObj);subjectObj=makeFabricImage(img,name,'subject');placeSubject(subjectObj);fabricCanvas.add(subjectObj);fabricCanvas.setActiveObject(subjectObj);applyEnhance(false);applyPhotoBorder(false);fabricCanvas.requestRenderAll();refreshLayers();syncFaceGuide()}

function uiState(){return {nepalPreset:$('nepalPreset').value,photoSize:$('photoSize').value,customWidth:$('customWidth').value,customHeight:$('customHeight').value,bgColor:$('bgColor').value,bgHex:$('bgHex').value,autoEnhance:$('autoEnhance').checked,brightness:$('brightness').value,contrast:$('contrast').value,saturation:$('saturation').value,outputDpi:$('outputDpi').value,borderEnabled:$('borderEnabled').checked,borderSize:$('borderSize').value,borderColor:$('borderColor').value,borderHex:$('borderHex').value}}
function applyUiState(s={}){restoringHistory=true;Object.entries(s).forEach(([k,v])=>{const el=$(k);if(!el)return;if(el.type==='checkbox')el.checked=!!v;else el.value=v});$('customSizeBox').classList.toggle('hidden',$('photoSize').value!=='custom');updateInfo();updateBorderPreview();restoringHistory=false}
function snapshot(){if(!fabricCanvas)return null;return {canvas:fabricCanvas.toJSON(['name','layerType','selectable','evented']),width:fabricCanvas.width,height:fabricCanvas.height,ui:uiState()}}
function saveHistory(){if(restoringHistory||!fabricCanvas)return;clearTimeout(historyTimer);historyTimer=setTimeout(()=>{const s=snapshot();if(!s)return;const serialized=JSON.stringify(s);if(historyIndex>=0&&JSON.stringify(history[historyIndex])===serialized)return;history=history.slice(0,historyIndex+1);history.push(s);if(history.length>40)history.shift();historyIndex=history.length-1;updateHistoryButtons()},80)}
function updateHistoryButtons(){$('undoBtn').disabled=historyIndex<=0;$('redoBtn').disabled=historyIndex<0||historyIndex>=history.length-1}
async function restoreSnapshot(s){if(!s||!fabricCanvas)return;restoringHistory=true;applyUiState(s.ui);fabricCanvas.setDimensions({width:s.width,height:s.height});await new Promise(resolve=>fabricCanvas.loadFromJSON(s.canvas,()=>{relinkObjects();fabricCanvas.getObjects().forEach(o=>o.setCoords());fabricCanvas.requestRenderAll();refreshLayers();resolve()}));restoringHistory=false;updateHistoryButtons()}
async function undo(){if(historyIndex<=0)return;historyIndex--;await restoreSnapshot(history[historyIndex]);status('Undo complete.','ok')}
async function redo(){if(historyIndex>=history.length-1)return;historyIndex++;await restoreSnapshot(history[historyIndex]);status('Redo complete.','ok')}

$('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);
document.addEventListener('keydown',e=>{const tag=(e.target?.tagName||'').toLowerCase(),editing=['input','textarea','select'].includes(tag)||e.target?.isContentEditable;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if(!editing&&!e.ctrlKey&&!e.metaKey&&(e.key==='Delete'||e.key==='Backspace')){if(fabricCanvas?.getActiveObject()){e.preventDefault();deleteActiveLayer()}}});


/* ===== v2.1 Natural Studio Retouch engine ===== */
function retouchLevel(){return $('retouchStrength')?.value||'normal'}
function retouchParams(){const v=retouchLevel();return v==='light'?{smooth:.14,shadow:7,wb:.035}:v==='strong'?{smooth:.34,shadow:17,wb:.065}:{smooth:.24,shadow:11,wb:.05}}
function isLikelySkin(r,g,b,a){if(a<40)return false;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);return r>60&&g>35&&b>20&&(mx-mn)>12&&r>g&&r>b&&Math.abs(r-g)>5}
async function naturalRetouchDataUrl(dataUrl){
  if(!$('autoRetouch')?.checked)return dataUrl;
  const img=await imageFromUrl(dataUrl),maxDim=1900,scale=Math.min(1,maxDim/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height)),w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)),h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{alpha:true,willReadFrequently:true});x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(img,0,0,w,h);
  const im=x.getImageData(0,0,w,h),src=new Uint8ClampedArray(im.data),d=im.data,p=retouchParams();
  let sr=0,sg=0,sb=0,n=0;for(let yy=0;yy<h;yy+=8){for(let xx=0;xx<w;xx+=8){const i=(yy*w+xx)*4;if(src[i+3]<40)continue;sr+=src[i];sg+=src[i+1];sb+=src[i+2];n++}}
  const ar=sr/Math.max(1,n),ag=sg/Math.max(1,n),ab=sb/Math.max(1,n),gray=(ar+ag+ab)/3;
  const gr=Math.max(1-p.wb,Math.min(1+p.wb,gray/Math.max(1,ar))),gg=Math.max(1-p.wb,Math.min(1+p.wb,gray/Math.max(1,ag))),gb=Math.max(1-p.wb,Math.min(1+p.wb,gray/Math.max(1,ab)));
  const offsets=[-4,4,-w*4,w*4];
  for(let y=1;y<h-1;y++)for(let x0=1;x0<w-1;x0++){
    const i=(y*w+x0)*4,a=src[i+3];if(!a)continue;let r=src[i]*gr,g=src[i+1]*gg,b=src[i+2]*gb;
    const lum=.2126*r+.7152*g+.0722*b;if(lum<145){const lift=p.shadow*(1-lum/145);r+=lift;g+=lift;b+=lift}
    if(isLikelySkin(src[i],src[i+1],src[i+2],a)){
      let rr=src[i],ggg=src[i+1],bb=src[i+2],cnt=1;for(const off of offsets){const j=i+off;if(src[j+3]>40){rr+=src[j];ggg+=src[j+1];bb+=src[j+2];cnt++}}
      const br=rr/cnt,bg=ggg/cnt,bl=bb/cnt;r=r*(1-p.smooth)+br*p.smooth;g=g*(1-p.smooth)+bg*p.smooth;b=b*(1-p.smooth)+bl*p.smooth;
    }
    d[i]=Math.max(0,Math.min(255,r));d[i+1]=Math.max(0,Math.min(255,g));d[i+2]=Math.max(0,Math.min(255,b));
  }
  x.putImageData(im,0,0);return c.toDataURL('image/png',1)
}
function updateQualityNotice(w,h){const el=$('qualityNotice');if(!el)return;const [mmW,mmH]=photoSize(),dpi=outputDpi(),needW=mmToPx(mmW,dpi),needH=mmToPx(mmH,dpi),ratio=Math.min(w/needW,h/needH);el.classList.remove('hidden','ok');if(ratio<.82){el.textContent=`Low-resolution source: ${w}×${h}px. Final ${needW}×${needH}px output is possible, but fine detail cannot be fully recreated.`}else{el.textContent=`Source quality looks suitable: ${w}×${h}px for the selected output.`;el.classList.add('ok')}}
async function rebuildRetouchPreview(record=true){if(!workingBaseDataUrl||!fabricCanvas)return;status('Applying natural studio retouch…');retouchedDataUrl=await naturalRetouchDataUrl(workingBaseDataUrl);displayingBefore=false;await setSubjectFromDataUrl(retouchedDataUrl,$('autoRetouch').checked?'Photo (Retouched)':'Photo');syncCompareButtons();if(record)saveHistory();status($('autoRetouch').checked?'Natural studio retouch applied. Use Before / After to compare.':'Retouch disabled; original working photo restored.','ok')}
function syncCompareButtons(){$('beforeBtn')?.classList.toggle('active',displayingBefore);$('afterBtn')?.classList.toggle('active',!displayingBefore)}
$('beforeBtn')?.addEventListener('click',async()=>{if(!workingBaseDataUrl||!fabricCanvas)return;displayingBefore=true;await setSubjectFromDataUrl(workingBaseDataUrl,'Photo (Before)');syncCompareButtons();status('Before view: retouch temporarily hidden.','ok')});
$('afterBtn')?.addEventListener('click',async()=>{if(!workingBaseDataUrl||!fabricCanvas)return;displayingBefore=false;if(!retouchedDataUrl)retouchedDataUrl=await naturalRetouchDataUrl(workingBaseDataUrl);await setSubjectFromDataUrl(retouchedDataUrl,$('autoRetouch').checked?'Photo (Retouched)':'Photo');syncCompareButtons();status('After view restored.','ok')});
$('autoRetouch')?.addEventListener('change',()=>rebuildRetouchPreview(true));
$('retouchStrength')?.addEventListener('change',()=>rebuildRetouchPreview(true));

$('photoInput').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  if(!f.type.startsWith('image/')){status('Please select an image file.','error');return}
  sourceFile=f;$('selectedFileName').textContent=f.name;status('Loading and checking photo…');
  try{
    const normalized=await normalizeImageFile(f);sourceDataUrl=normalized.dataUrl;workingBaseDataUrl=sourceDataUrl;retouchedDataUrl=await naturalRetouchDataUrl(workingBaseDataUrl);displayingBefore=false;originalImageEl=await imageFromUrl(sourceDataUrl);updateQualityNotice(normalized.width,normalized.height);
    initCanvas();await setSubjectFromDataUrl(retouchedDataUrl,$('autoRetouch')?.checked?'Photo (Retouched)':'Photo');syncCompareButtons();
    $('placeholder').classList.add('hidden');$('canvasWrap').classList.remove('hidden');$('createBtn').disabled=false;$('resetBtn').disabled=false;syncFaceGuide();
    history=[];historyIndex=-1;saveHistory();setTimeout(()=>{historyIndex=history.length-1;updateHistoryButtons()},140);
    status(`Photo loaded: ${normalized.width} × ${normalized.height}px. Editor preview is optimized; HD export remains at the selected final DPI.`,'ok');
    if($('removeBg').checked)await removeBackgroundNow();
  }catch(err){console.error(err);sourceDataUrl=null;status('This photo could not be decoded correctly. Please convert it to JPG/PNG/WebP or try another copy of the photo.','error')}
});

$('removeBg').addEventListener('change',async()=>{if(!sourceFile)return;if($('removeBg').checked)await removeBackgroundNow();else{removedBlob=null;workingBaseDataUrl=sourceDataUrl;retouchedDataUrl=await naturalRetouchDataUrl(workingBaseDataUrl);displayingBefore=false;await setSubjectFromDataUrl(retouchedDataUrl,$('autoRetouch')?.checked?'Photo (Retouched)':'Photo');syncCompareButtons();saveHistory();status('Original background restored.','ok')}});
async function removeBackgroundNow(){if(removalBusy||!sourceFile)return;removalBusy=true;$('removeBg').disabled=true;$('createBtn').disabled=true;status('AI background removal starting… first run may take longer.');try{const mod=await import('https://esm.sh/@imgly/background-removal@1.7.0?bundle');const removeBackground=mod.default||mod.removeBackground;removedBlob=await removeBackground(sourceFile,{model:'isnet',progress:(key,current,total)=>{if(total)status(`Background remover: ${key} ${Math.round(current/total*100)}%`)}});const dataUrl=await blobToDataURL(removedBlob);workingBaseDataUrl=dataUrl;retouchedDataUrl=await naturalRetouchDataUrl(workingBaseDataUrl);displayingBefore=false;await setSubjectFromDataUrl(retouchedDataUrl,$('autoRetouch')?.checked?'Subject (BG Removed + Retouched)':'Subject (BG Removed)');syncCompareButtons();saveHistory();status('Background removed. Subject is a separate editable layer and studio cleanup has been applied.','ok')}catch(err){console.error(err);$('removeBg').checked=false;status('Background removal failed. Check internet once and refresh.','error')}finally{removalBusy=false;$('removeBg').disabled=false;$('createBtn').disabled=false;refreshLayers()}}

$('bgUpload').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f||!fabricCanvas)return;try{const dataUrl=await fileToDataURL(f),img=await imageFromUrl(dataUrl);if(backgroundObj)fabricCanvas.remove(backgroundObj);backgroundObj=makeFabricImage(img,'Background Image','backgroundImage');placeCover(backgroundObj);fabricCanvas.add(backgroundObj);fabricCanvas.sendToBack(backgroundObj);if(backgroundRect)fabricCanvas.sendToBack(backgroundRect);fabricCanvas.setActiveObject(backgroundObj);fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Background image added. Drag, resize or rotate it to adjust.','ok')}catch(err){console.error(err);status('Background image could not be loaded.','error')}});

$('bgColor').addEventListener('input',()=>{$('bgHex').value=$('bgColor').value;if(backgroundRect){backgroundRect.set('fill',$('bgColor').value);fabricCanvas.requestRenderAll()}if(!restoringHistory)saveHistory()});
$('bgHex').addEventListener('change',()=>{if(/^#[0-9a-f]{6}$/i.test($('bgHex').value)){$('bgColor').value=$('bgHex').value;$('bgColor').dispatchEvent(new Event('input'))}});
$('borderEnabled').addEventListener('change',()=>{applyPhotoBorder();updateInfo();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()});
function clampBorder(v){return Math.min(20,Math.max(0,Math.round((Number(v)||0)*2)/2))}
function setBorderSize(v){$('borderSize').value=clampBorder(v);applyPhotoBorder();updateInfo();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()}
$('borderMinus').addEventListener('click',()=>setBorderSize(Number($('borderSize').value)-.5));
$('borderPlus').addEventListener('click',()=>setBorderSize(Number($('borderSize').value)+.5));
$('borderSize').addEventListener('change',()=>setBorderSize($('borderSize').value));
$('borderColor').addEventListener('input',()=>{$('borderHex').value=$('borderColor').value;applyPhotoBorder();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()});
$('borderHex').addEventListener('change',()=>{if(/^#[0-9a-f]{6}$/i.test($('borderHex').value)){$('borderColor').value=$('borderHex').value;$('borderColor').dispatchEvent(new Event('input'))}});
function applyEnhance(record=true){if(!subjectObj)return;const filters=[];if($('autoEnhance').checked){filters.push(new Fabric.Image.filters.Brightness({brightness:(Number($('brightness').value)-100)/100}),new Fabric.Image.filters.Contrast({contrast:(Number($('contrast').value)-100)/100}),new Fabric.Image.filters.Saturation({saturation:(Number($('saturation').value)-100)/100}))}subjectObj.filters=filters;subjectObj.applyFilters();fabricCanvas?.requestRenderAll();if(record)saveHistory()}
['autoEnhance','brightness','contrast','saturation'].forEach(id=>$(id).addEventListener('input',()=>applyEnhance(true)));

function rebuildCanvasKeepObjects(record=true){if(!fabricCanvas)return updateInfo();const oldW=fabricCanvas.width,oldH=fabricCanvas.height,[newW,newH]=editorDims();fabricCanvas.getObjects().forEach(o=>{if(o!==backgroundRect){o.left=o.left/oldW*newW;o.top=o.top/oldH*newH;o.scaleX*=newW/oldW;o.scaleY*=newH/oldH}});fabricCanvas.setDimensions({width:newW,height:newH});if(backgroundRect)backgroundRect.set({width:newW,height:newH});applyPhotoBorder(false);fabricCanvas.requestRenderAll();updateInfo();if(record)saveHistory()}
$('nepalPreset').addEventListener('change',()=>{
  const v=$('nepalPreset').value;
  if(v==='manual')return;
  if(v==='custom'){$('photoSize').value='custom';$('customSizeBox').classList.remove('hidden')}
  else if(nepalPresets[v]){$('photoSize').value='35x45';$('customSizeBox').classList.add('hidden')}
  $('outputDpi').value='600';$('bgColor').value='#ffffff';$('bgHex').value='#ffffff';$('autoEnhance').checked=true;
  if(backgroundRect)backgroundRect.set('fill','#ffffff');rebuildCanvasKeepObjects(false);applyEnhance(false);updateInfo();saveHistory();
  status('Nepal form preset applied in HD 600 DPI. Copies will follow the Copies selection exactly.','ok');
});
$('photoSize').addEventListener('change',()=>{$('nepalPreset').value='manual';$('customSizeBox').classList.toggle('hidden',$('photoSize').value!=='custom');rebuildCanvasKeepObjects()});['customWidth','customHeight'].forEach(id=>$(id).addEventListener('change',()=>rebuildCanvasKeepObjects()));$('outputDpi').addEventListener('change',()=>{updateInfo();saveHistory()});window.addEventListener('resize',()=>{if(window.innerWidth<900)return;});

function activeEditable(){const o=fabricCanvas?.getActiveObject();return o&&o!==backgroundRect?o:null}
function cancelCrop(showStatus=false){if(cropGuide&&fabricCanvas){fabricCanvas.remove(cropGuide);cropGuide=null}cropTarget=null;document.querySelectorAll('.crop-only').forEach(b=>b.classList.add('hidden'));fabricCanvas?.requestRenderAll();if(showStatus)status('Crop cancelled.','ok')}
function startCrop(){
  const o=activeEditable();if(!o||o.type!=='image'){status('Select a photo/subject/background image layer first.','error');return}
  cancelCrop(false);cropTarget=o;const br=o.getBoundingRect(true,true),pad=Math.max(8,Math.min(br.width,br.height)*.08);
  const left=Math.max(0,br.left+pad),top=Math.max(0,br.top+pad),right=Math.min(fabricCanvas.width,br.left+br.width-pad),bottom=Math.min(fabricCanvas.height,br.top+br.height-pad);
  cropGuide=new Fabric.Rect({left,top,width:Math.max(30,right-left),height:Math.max(30,bottom-top),fill:'rgba(255,255,255,.10)',stroke:'#ff9f0a',strokeWidth:2,strokeDashArray:[8,5],transparentCorners:false,cornerColor:'#ff9f0a',cornerStrokeColor:'#fff',cornerSize:12,lockRotation:true,name:'Crop Selection',layerType:'cropGuide',excludeFromExport:true});
  fabricCanvas.add(cropGuide);fabricCanvas.setActiveObject(cropGuide);fabricCanvas.requestRenderAll();document.querySelectorAll('.crop-only').forEach(b=>b.classList.remove('hidden'));status('Crop Selection active. Move/resize the orange box, then click Apply Crop.','ok')
}
function applyCrop(){
  if(!cropGuide||!cropTarget||!fabricCanvas)return;
  const center=cropGuide.getCenterPoint(),inv=Fabric.util.invertTransform(cropTarget.calcTransformMatrix()),localCenter=Fabric.util.transformPoint(center,inv);
  const sx=Math.max(Math.abs(cropTarget.scaleX||1),.0001),sy=Math.max(Math.abs(cropTarget.scaleY||1),.0001);
  const localW=Math.max(2,(cropGuide.getScaledWidth())/sx),localH=Math.max(2,(cropGuide.getScaledHeight())/sy);
  cropTarget.set('clipPath',new Fabric.Rect({originX:'center',originY:'center',left:localCenter.x,top:localCenter.y,width:localW,height:localH,fill:'#000'}));
  const target=cropTarget;fabricCanvas.remove(cropGuide);cropGuide=null;cropTarget=null;document.querySelectorAll('.crop-only').forEach(b=>b.classList.add('hidden'));fabricCanvas.setActiveObject(target);target.setCoords();fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Crop applied. You can Undo (Ctrl+Z) anytime.','ok')
}
function deleteActiveLayer(){
  if(!fabricCanvas)return;const o=fabricCanvas.getActiveObject();
  if(!o){status('Select a layer to delete.','error');return}
  if(o===cropGuide){cancelCrop(true);return}
  if(o===backgroundRect){status('Base background color layer is protected. Change its color instead.','error');return}
  fabricCanvas.remove(o);if(o===subjectObj)subjectObj=null;if(o===backgroundObj)backgroundObj=null;fabricCanvas.discardActiveObject();fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Selected layer deleted. Use Ctrl+Z to restore it.','ok')
}
document.querySelector('.editor-toolbar').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||!fabricCanvas)return;const action=b.dataset.action;
  if(action==='crop')return startCrop();if(action==='applyCrop')return applyCrop();if(action==='cancelCrop')return cancelCrop(true);if(action==='delete')return deleteActiveLayer();
  const o=activeEditable();if(!o)return;const W=fabricCanvas.width,H=fabricCanvas.height;
  switch(action){case'centerH':o.set('left',W/2);break;case'centerV':o.set('top',H/2);break;case'fit':{const s=Math.min(W/o.width,H/o.height);o.scale(s);o.set({left:W/2,top:H/2});break}case'fill':{const s=Math.max(W/o.width,H/o.height);o.scale(s);o.set({left:W/2,top:H/2});break}case'rotateLeft':o.rotate((o.angle-90)%360);break;case'rotateRight':o.rotate((o.angle+90)%360);break;case'flipX':o.set('flipX',!o.flipX);break;case'forward':fabricCanvas.bringForward(o);break;case'backward':fabricCanvas.sendBackwards(o);if(backgroundRect)fabricCanvas.sendToBack(backgroundRect);break}
  o.setCoords();fabricCanvas.requestRenderAll();refreshLayers();saveHistory()
});

function refreshLayers(){if(!fabricCanvas)return;const list=$('layersList'),objs=fabricCanvas.getObjects().filter(o=>o.layerType!=='cropGuide').slice().reverse();list.innerHTML='';objs.forEach(obj=>{const row=document.createElement('div');row.className='layer-item'+(fabricCanvas.getActiveObject()===obj?' active':'');const ico=obj.layerType==='subject'?'👤':obj.layerType==='backgroundImage'?'🌄':'🎨';row.innerHTML=`<div class="layer-thumb">${ico}</div><div class="layer-name">${obj.name||'Layer'}</div><button class="layer-icon-btn eye" title="Show/Hide">${obj.visible===false?'🙈':'👁'}</button><button class="layer-icon-btn lock" title="Lock/Unlock">${obj.selectable===false&&obj!==backgroundRect?'🔒':'🔓'}</button>`;row.addEventListener('click',ev=>{if(ev.target.closest('button'))return;if(obj!==backgroundRect&&obj.selectable!==false){fabricCanvas.setActiveObject(obj);fabricCanvas.requestRenderAll();refreshLayers()}});row.querySelector('.eye').onclick=ev=>{ev.stopPropagation();obj.visible=!obj.visible;if(!obj.visible&&fabricCanvas.getActiveObject()===obj)fabricCanvas.discardActiveObject();fabricCanvas.requestRenderAll();refreshLayers();saveHistory()};row.querySelector('.lock').onclick=ev=>{ev.stopPropagation();if(obj===backgroundRect)return;const lock=obj.selectable!==false;obj.set({selectable:!lock,evented:!lock});if(lock)fabricCanvas.discardActiveObject();fabricCanvas.requestRenderAll();refreshLayers();saveHistory()};list.appendChild(row)});if(!objs.length)list.innerHTML='<div class="empty-layers">No layers yet</div>'}

function exportSingle(type='image/png'){
  if(!fabricCanvas)return null;
  const [mmW,mmH]=photoSize(),dpi=outputDpi(),contentW=mmToPx(mmW,dpi),contentH=mmToPx(mmH,dpi);
  applyPhotoBorder(false);
  const active=fabricCanvas.getActiveObject();fabricCanvas.discardActiveObject();fabricCanvas.requestRenderAll();
  const inner=fabricCanvas.toCanvasElement(contentW/fabricCanvas.width,{enableRetinaScaling:false});
  const out=document.createElement('canvas');out.width=contentW;out.height=contentH;const c=out.getContext('2d',{alpha:type!=='image/jpeg'});c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';if(type==='image/jpeg'){c.fillStyle='#ffffff';c.fillRect(0,0,out.width,out.height)}c.drawImage(inner,0,0,contentW,contentH);
  if(active){fabricCanvas.setActiveObject(active);fabricCanvas.requestRenderAll()}
  return out.toDataURL(type,type==='image/jpeg'?1:undefined)
}
function dataUrlToImage(data){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=data})}
async function renderSheet(){
  if(!fabricCanvas)return;cancelCrop(false);const single=await dataUrlToImage(exportSingle('image/png'));let [pw,ph]=paperPresets[$('paperSize').value];if($('orientation').value==='landscape')[pw,ph]=[ph,pw];
  const dpi=outputDpi(),W=mmToPx(pw,dpi),H=mmToPx(ph,dpi),gap=mmToPx(2.5,dpi),margin=mmToPx(5,dpi),iw=single.width,ih=single.height;
  const cols=Math.max(1,Math.floor((W-margin*2+gap)/(iw+gap))),rows=Math.max(1,Math.floor((H-margin*2+gap)/(ih+gap))),capacity=Math.max(1,cols*rows);
  const requested=$('copies').value==='auto'?capacity:Math.max(1,Number($('copies').value)||1),pages=Math.ceil(requested/capacity),pageGap=Math.max(8,Math.round(dpi/10));
  const cvs=$('sheetCanvas'),c=cvs.getContext('2d');cvs.width=W;cvs.height=H*pages+pageGap*(pages-1);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.fillStyle='#e9edf3';c.fillRect(0,0,cvs.width,cvs.height);
  let drawn=0;
  for(let p=0;p<pages;p++){
    const pageY=p*(H+pageGap);c.fillStyle='#fff';c.fillRect(0,pageY,W,H);const count=Math.min(capacity,requested-drawn),usedCols=Math.min(cols,count),usedRows=Math.ceil(count/usedCols),usedW=usedCols*iw+(usedCols-1)*gap,usedH=usedRows*ih+(usedRows-1)*gap,sx=(W-usedW)/2,sy=pageY+(H-usedH)/2;
    for(let n=0;n<count;n++){const x=n%usedCols,y=Math.floor(n/usedCols),dx=sx+x*(iw+gap),dy=sy+y*(ih+gap);c.drawImage(single,dx,dy);c.strokeStyle='#d5d8df';c.lineWidth=Math.max(1,dpi/300);c.strokeRect(dx,dy,iw,ih);drawn++}
  }
  status(`${requested} photo(s) created exactly as selected at ${dpi} DPI${pages>1?` across ${pages} print pages`:''}.`,'ok')
}

function showEditor(){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab==='editor'));$('previewStage').classList.remove('hidden');$('sheetPreviewWrap').classList.add('hidden');$('backEditorBtn').classList.add('hidden');document.querySelector('.editor-panel').scrollIntoView({behavior:'smooth',block:'start'})}
$('backEditorBtn').addEventListener('click',showEditor);
$('createBtn').addEventListener('click',async()=>{if(!fabricCanvas)return;if($('removeBg').checked&&!removedBlob)await removeBackgroundNow();await renderSheet();$('resultTabs').classList.remove('hidden');$('actions').classList.remove('hidden');$('backEditorBtn').classList.remove('hidden');document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab==='sheet'));$('previewStage').classList.add('hidden');$('sheetPreviewWrap').classList.remove('hidden');status('Digital photo and print sheet are ready. Use Back to Editor for more changes.','ok')});
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===btn));const sheet=btn.dataset.tab==='sheet';$('previewStage').classList.toggle('hidden',sheet);$('sheetPreviewWrap').classList.toggle('hidden',!sheet);$('backEditorBtn').classList.toggle('hidden',!sheet);if(sheet)await renderSheet()}));
function dl(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove()}
$('downloadJpg').onclick=()=>dl(exportSingle('image/jpeg'),`digital-photo-${outputDpi()}dpi.jpg`);$('downloadPng').onclick=()=>dl(exportSingle('image/png'),`digital-photo-${outputDpi()}dpi.png`);$('downloadSheet').onclick=async()=>{await renderSheet();dl($('sheetCanvas').toDataURL('image/jpeg',1),`digital-photo-print-sheet-${outputDpi()}dpi.jpg`)};['paperSize','copies','orientation'].forEach(id=>$(id).addEventListener('change',()=>{if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()}));

$('resetBtn').addEventListener('click',()=>{sourceFile=null;sourceDataUrl=null;workingBaseDataUrl=null;retouchedDataUrl=null;displayingBefore=false;originalImageEl=null;removedBlob=null;subjectObj=null;backgroundObj=null;backgroundRect=null;cropGuide=null;cropTarget=null;history=[];historyIndex=-1;if(fabricCanvas){fabricCanvas.dispose();fabricCanvas=null}$('photoInput').value='';$('selectedFileName').textContent='No photo selected';$('bgUpload').value='';$('removeBg').checked=false;$('nepalPreset').value='manual';$('borderEnabled').checked=false;$('borderSize').value='1';$('borderColor').value='#ffffff';$('borderHex').value='#ffffff';updateBorderPreview();document.querySelectorAll('.crop-only').forEach(b=>b.classList.add('hidden'));$('placeholder').classList.remove('hidden');$('canvasWrap').classList.add('hidden');$('faceGuide')?.classList.add('hidden');$('sheetPreviewWrap').classList.add('hidden');$('previewStage').classList.remove('hidden');$('resultTabs').classList.add('hidden');$('actions').classList.add('hidden');$('backEditorBtn').classList.add('hidden');$('createBtn').disabled=true;$('resetBtn').disabled=true;$('layersList').innerHTML='<div class="empty-layers">No layers yet</div>';updateHistoryButtons();status('Select a photo to begin.')});

updateInfo();updateHistoryButtons();

/* ===== v2.0 Professional Studio additions ===== */
const professionalPresets = [
  {id:'np35x45',name:'Nepal General',doc:'Passport / Form',w:35,h:45},
  {id:'common35x45',name:'Common 35×45',doc:'ID / Visa',w:35,h:45},
  {id:'common30x40',name:'Common 30×40',doc:'Form Photo',w:30,h:40},
  {id:'common3x4',name:'3×4 cm',doc:'Common Size',w:30,h:40},
  {id:'us2x2',name:'USA 2×2 in',doc:'Passport / Visa',w:50.8,h:50.8},
  {id:'india35x45',name:'India 35×45',doc:'Passport Type',w:35,h:45},
  {id:'japan35x45',name:'Japan 35×45',doc:'Visa Type',w:35,h:45},
  {id:'au35x45',name:'Australia 35×45',doc:'Passport Type',w:35,h:45},
  {id:'ca50x70',name:'Canada 50×70',doc:'Passport Type',w:50,h:70},
  {id:'cn33x48',name:'China 33×48',doc:'Visa / ID',w:33,h:48},
  {id:'eu35x45',name:'Europe 35×45',doc:'Schengen Type',w:35,h:45},
  {id:'square50',name:'50×50 mm',doc:'Square ID',w:50,h:50}
];
let activeProfessionalPreset = 'np35x45';
let suitObj = null;

function renderProfessionalPresets(query=''){
  const list=$('sizePresetList'); if(!list) return;
  const q=String(query||'').trim().toLowerCase();
  const items=professionalPresets.filter(p=>!q || `${p.name} ${p.doc} ${p.w}x${p.h}`.toLowerCase().includes(q));
  list.innerHTML='';
  items.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='preset-chip'+(p.id===activeProfessionalPreset?' active':'');b.innerHTML=`<b>${p.name}</b><span>${p.w} × ${p.h} mm • ${p.doc}</span>`;b.onclick=()=>applyProfessionalPreset(p);list.appendChild(b)});
  if(!items.length)list.innerHTML='<div class="empty-layers">No matching size. Use Custom Size.</div>';
}
function applyProfessionalPreset(p){
  activeProfessionalPreset=p.id;$('activePresetBadge').textContent=p.name;
  const exact=Object.entries(sizePresets).find(([,v])=>Math.abs(v[0]-p.w)<.05&&Math.abs(v[1]-p.h)<.05);
  if(exact){$('photoSize').value=exact[0];$('customSizeBox').classList.add('hidden')}else{$('photoSize').value='custom';$('customWidth').value=p.w;$('customHeight').value=p.h;$('customSizeBox').classList.remove('hidden')}
  updateInfo(); if(fabricCanvas)resizeCanvasKeepObjects(); renderProfessionalPresets($('sizeSearch')?.value||''); if(fabricCanvas)saveHistory();
}
$('sizeSearch')?.addEventListener('input',e=>renderProfessionalPresets(e.target.value));
renderProfessionalPresets();

function suitSvg(kind='black'){
  const colors={black:['#151922','#f7f7f7','#222b3b'],navy:['#172b4d','#f8f8f8','#233c68'],gray:['#555b65','#fafafa','#69717d']};
  const [jacket,shirt,lapel]=colors[kind]||colors.black;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 900"><path fill="${jacket}" d="M70 900V470c0-120 110-190 250-220l80 180 80-180c140 30 250 100 250 220v430z"/><path fill="${shirt}" d="M310 250h180l-35 290H345z"/><path fill="${lapel}" d="M320 250l80 180-120 130-85-235zm160 0l-80 180 120 130 85-235z"/><path fill="#b71922" d="M382 350h36l24 235-42 85-42-85z"/><path fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="5" d="M400 430v470"/></svg>`;
}
async function addSuitFromDataUrl(dataUrl,name='Suit / Design'){
  if(!fabricCanvas){status('Select a photo first.','error');return}
  const img=await imageFromUrl(dataUrl); const o=makeFabricImage(img,name,'suit');
  const W=fabricCanvas.width,H=fabricCanvas.height,sc=Math.min(W/o.width,H/o.height)*1.06;o.set({scaleX:sc,scaleY:sc,left:W/2,top:H*.70,angle:0});o.setCoords();fabricCanvas.add(o);fabricCanvas.setActiveObject(o);suitObj=o;fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Suit / design layer added. Drag, resize or rotate it in the preview.','ok');
}
async function addBuiltInSuit(){const kind=$('suitPreset')?.value;if(!kind||kind==='none'){status('Choose a built-in suit or upload a PNG design.','error');return}const data='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(suitSvg(kind));await addSuitFromDataUrl(data,`${kind[0].toUpperCase()+kind.slice(1)} Suit`)}
$('addSuitBtn')?.addEventListener('click',addBuiltInSuit);
$('suitUpload')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const d=await fileToDataURL(f);await addSuitFromDataUrl(d,f.name)}catch(err){console.error(err);status('Suit/design image could not be loaded.','error')}});
function duplicateActiveLayer(){if(!fabricCanvas)return;const o=fabricCanvas.getActiveObject();if(!o||o===backgroundRect||o===cropGuide){status('Select an editable layer to duplicate.','error');return}o.clone(cl=>{cl.set({left:(o.left||0)+18,top:(o.top||0)+18,name:(o.name||'Layer')+' Copy',layerType:o.layerType,selectable:true,evented:true});fabricCanvas.add(cl);fabricCanvas.setActiveObject(cl);cl.setCoords();fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Layer duplicated.','ok')},['name','layerType','selectable','evented'])}
$('duplicateLayerBtn')?.addEventListener('click',duplicateActiveLayer);

function syncFaceGuide(){const show=!!($('guideToggle')?.checked&&fabricCanvas&&subjectObj&&!$('canvasWrap')?.classList.contains('hidden'));$('faceGuide')?.classList.toggle('hidden',!show)}
$('guideToggle')?.addEventListener('change',syncFaceGuide);
document.querySelector('.nudge-grid')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!fabricCanvas)return;const o=activeEditable();if(!o)return;const step=Math.max(2,Math.round(fabricCanvas.width*.018));switch(b.dataset.nudge){case'up':o.top-=step;break;case'down':o.top+=step;break;case'left':o.left-=step;break;case'right':o.left+=step;break;case'center':o.set({left:fabricCanvas.width/2,top:fabricCanvas.height/2});break;case'scaleUp':o.scaleX*=1.05;o.scaleY*=1.05;break;case'scaleDown':o.scaleX*=.95;o.scaleY*=.95;break}o.setCoords();fabricCanvas.requestRenderAll();refreshLayers();saveHistory()});

// Extend toolbar with duplicate action without replacing existing editor logic.
document.querySelector('.editor-toolbar')?.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.action==='duplicate'){e.stopImmediatePropagation();duplicateActiveLayer()}},true);

function printSettings(){return {margin:Math.max(0,Number($('printMargin')?.value||5)),gap:Math.max(0,Number($('printGap')?.value||2.5)),cut:$('cutMarks')?.value!=='off'}}
function drawCutMarks(ctx,x,y,w,h,dpi){const len=Math.max(8,mmToPx(2.5,dpi)),off=Math.max(2,mmToPx(.7,dpi));ctx.save();ctx.strokeStyle='#9aa4b2';ctx.lineWidth=Math.max(1,dpi/300);const segs=[[x-off,y,x-len,y],[x,y-off,x,y-len],[x+w+off,y,x+w+len,y],[x+w,y-off,x+w,y-len],[x-off,y+h,x-len,y+h],[x,y+h+off,x,y+h+len],[x+w+off,y+h,x+w+len,y+h],[x+w,y+h+off,x+w,y+h+len]];segs.forEach(a=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.stroke()});ctx.restore()}

// Professional replacement for print layout: exact copies + configurable margin/gap/cut marks.
renderSheet = async function(){
  if(!fabricCanvas)return;cancelCrop(false);const single=await dataUrlToImage(exportSingle('image/png'));let [pw,ph]=paperPresets[$('paperSize').value];if($('orientation').value==='landscape')[pw,ph]=[ph,pw];
  const dpi=outputDpi(),W=mmToPx(pw,dpi),H=mmToPx(ph,dpi),ps=printSettings(),gap=mmToPx(ps.gap,dpi),margin=mmToPx(ps.margin,dpi),iw=single.width,ih=single.height;
  const cols=Math.max(1,Math.floor((W-margin*2+gap)/(iw+gap))),rows=Math.max(1,Math.floor((H-margin*2+gap)/(ih+gap))),capacity=Math.max(1,cols*rows);$('capacityBadge').textContent=`Capacity ${capacity}`;
  const requested=$('copies').value==='auto'?capacity:Math.max(1,Number($('copies').value)||1),pages=Math.ceil(requested/capacity),pageGap=Math.max(8,Math.round(dpi/10));
  const cvs=$('sheetCanvas'),c=cvs.getContext('2d');cvs.width=W;cvs.height=H*pages+pageGap*(pages-1);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.fillStyle='#e9edf3';c.fillRect(0,0,cvs.width,cvs.height);let drawn=0;
  for(let p=0;p<pages;p++){const pageY=p*(H+pageGap);c.fillStyle='#fff';c.fillRect(0,pageY,W,H);const count=Math.min(capacity,requested-drawn),usedCols=Math.min(cols,count),usedRows=Math.ceil(count/usedCols),usedW=usedCols*iw+(usedCols-1)*gap,usedH=usedRows*ih+(usedRows-1)*gap,sx=(W-usedW)/2,sy=pageY+(H-usedH)/2;
    for(let n=0;n<count;n++){const x=n%usedCols,y=Math.floor(n/usedCols),dx=sx+x*(iw+gap),dy=sy+y*(ih+gap);c.drawImage(single,dx,dy);c.strokeStyle='#d5d8df';c.lineWidth=Math.max(1,dpi/300);c.strokeRect(dx,dy,iw,ih);if(ps.cut)drawCutMarks(c,dx,dy,iw,ih,dpi);drawn++}}
  status(`${requested} photo(s) arranged exactly as selected • ${dpi} DPI • margin ${ps.margin}mm • gap ${ps.gap}mm${pages>1?` • ${pages} pages`:''}.`,'ok')
};
['printMargin','printGap','cutMarks'].forEach(id=>$(id)?.addEventListener('change',()=>{if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()}));

async function canvasToTargetJpegDataUrl(canvas,targetKb){
  if(!targetKb)return canvas.toDataURL('image/jpeg',.96);let lo=.25,hi=.98,best=canvas.toDataURL('image/jpeg',lo);
  for(let i=0;i<9;i++){const q=(lo+hi)/2,data=canvas.toDataURL('image/jpeg',q),kb=Math.round((data.length-data.indexOf(',')-1)*.75/1024);if(kb<=targetKb){best=data;lo=q}else hi=q}
  return best;
}
$('downloadWebJpg')?.addEventListener('click',async()=>{if(!fabricCanvas)return;const url=exportSingle('image/png');const img=await dataUrlToImage(url),c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);const target=Number($('targetKb')?.value||0),data=await canvasToTargetJpegDataUrl(c,target);dl(data,`digital-photo-web${target?`-${target}kb`:''}.jpg`);status(target?`Web JPG created with target ≤ ${target} KB where image content allows.`:'High-quality Web JPG created.','ok')});

// Upgrade layer icons after original refresh routine runs.
const _refreshLayersV2=refreshLayers;
refreshLayers=function(){_refreshLayersV2();document.querySelectorAll('.layer-item').forEach(row=>{const name=row.querySelector('.layer-name')?.textContent||'';if(/suit|design/i.test(name)){row.dataset.layer='suit';const t=row.querySelector('.layer-thumb');if(t)t.textContent='👔'}})};

// Preserve suit reference after undo/redo JSON restore.
const _relinkObjectsV2=relinkObjects;
relinkObjects=function(){_relinkObjectsV2();suitObj=(fabricCanvas?.getObjects()||[]).find(o=>o.layerType==='suit')||null};

// Better UI state for professional controls.
const _uiStateV2=uiState;
uiState=function(){return {..._uiStateV2(),printMargin:$('printMargin')?.value,printGap:$('printGap')?.value,cutMarks:$('cutMarks')?.value,targetKb:$('targetKb')?.value,guideToggle:$('guideToggle')?.checked,suitPreset:$('suitPreset')?.value,autoRetouch:$('autoRetouch')?.checked,retouchStrength:$('retouchStrength')?.value}};

window.addEventListener('resize',syncFaceGuide);

/* ===== v2.1 Precision Photo-Edge Border ===== */
function removeLegacySubjectStroke(){if(subjectObj)subjectObj.set({stroke:null,strokeWidth:0})}
function syncPhotoBorder(){
  if(!fabricCanvas)return;
  removeLegacySubjectStroke();
  const enabled=!!($('borderEnabled')?.checked&&subjectObj&&borderSizeMm()>0);
  if(!enabled){if(photoBorderObj){fabricCanvas.remove(photoBorderObj);photoBorderObj=null}fabricCanvas.requestRenderAll();return}
  const [mmW]=photoSize(),px=Math.max(1,(fabricCanvas.width/mmW)*borderSizeMm()),color=$('borderColor')?.value||'#ffffff';
  if(!photoBorderObj){photoBorderObj=new Fabric.Rect({name:'Photo Edge Border',layerType:'photoBorder',fill:'transparent',selectable:false,evented:false,originX:'center',originY:'center',excludeFromExport:false,strokeUniform:true});fabricCanvas.add(photoBorderObj)}
  photoBorderObj.set({left:subjectObj.left,top:subjectObj.top,width:subjectObj.width,height:subjectObj.height,scaleX:subjectObj.scaleX,scaleY:subjectObj.scaleY,angle:subjectObj.angle,flipX:subjectObj.flipX,flipY:subjectObj.flipY,stroke:color,strokeWidth:px,visible:subjectObj.visible!==false});photoBorderObj.setCoords();
  const si=fabricCanvas.getObjects().indexOf(subjectObj);if(si>=0)fabricCanvas.moveTo(photoBorderObj,Math.min(si+1,fabricCanvas.size()-1));fabricCanvas.requestRenderAll();
}
applyPhotoBorder=function(render=true){const wrap=$('canvasWrap');if(wrap){wrap.style.borderWidth='0';wrap.style.borderColor='transparent'}$('borderControls')?.classList.toggle('disabled-control',!$('borderEnabled')?.checked);syncPhotoBorder();if(render)fabricCanvas?.requestRenderAll()};
const _relinkObjectsV21=relinkObjects;relinkObjects=function(){_relinkObjectsV21();photoBorderObj=(fabricCanvas?.getObjects()||[]).find(o=>o.layerType==='photoBorder')||null;syncPhotoBorder()};
const _refreshLayersV21=refreshLayers;refreshLayers=function(){_refreshLayersV21();document.querySelectorAll('.layer-item').forEach(row=>{if(/Photo Edge Border/i.test(row.querySelector('.layer-name')?.textContent||''))row.remove()})};
const _bindCanvasEventsV21=bindCanvasEvents;bindCanvasEvents=function(){_bindCanvasEventsV21();['object:moving','object:scaling','object:rotating','object:skewing'].forEach(ev=>fabricCanvas.on(ev,e=>{if(e.target===subjectObj)syncPhotoBorder()}));fabricCanvas.on('object:modified',e=>{if(e.target===subjectObj)syncPhotoBorder()});};
const _deleteActiveLayerV21=deleteActiveLayer;deleteActiveLayer=function(){const o=fabricCanvas?.getActiveObject();_deleteActiveLayerV21();if(o===subjectObj||!subjectObj){if(photoBorderObj&&fabricCanvas){fabricCanvas.remove(photoBorderObj);photoBorderObj=null;fabricCanvas.requestRenderAll()}}};
