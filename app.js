const $ = id => document.getElementById(id);
const Fabric = window.fabric;
const sizePresets = {'35x45':[35,45],'51x51':[50.8,50.8],'25x30':[25,30],'30x40':[30,40],'33x48':[33,48],'50x50':[50,50]};
const paperPresets = {'4x6':[101.6,152.4],'5x7':[127,177.8],'6x8':[152.4,203.2],'8x10':[203.2,254],'a4':[210,297],'a5':[148,210]};
const nepalPresets = {general35x45:[35,45],passport35x45:[35,45],citizenship35x45:[35,45],loksewa35x45:[35,45],bank35x45:[35,45],school35x45:[35,45],licence35x45:[35,45]};
const mmToPx = (mm,dpi=outputDpi()) => Math.round(mm/25.4*dpi);
let fabricCanvas=null, sourceFile=null, sourceDataUrl=null, originalImageEl=null, subjectObj=null, backgroundObj=null, backgroundRect=null, removedBlob=null, removalBusy=false, cropGuide=null, cropTarget=null;
let history=[], historyIndex=-1, restoringHistory=false, historyTimer=null;

if (!Fabric) window.addEventListener('load',()=>status('Editor library could not load. Please refresh once.','error'));

function outputDpi(){return Number($('outputDpi')?.value||300)}
function photoSize(){return $('photoSize').value==='custom'?[Number($('customWidth').value)||35,Number($('customHeight').value)||45]:sizePresets[$('photoSize').value]}
function editorDims(){const [w,h]=photoSize();const maxH=Math.min(560,Math.max(360,window.innerHeight*0.60)),maxW=470,ratio=w/h;let H=maxH,W=H*ratio;if(W>maxW){W=maxW;H=W/ratio}return [Math.round(W),Math.round(H)]}
function status(msg,type=''){const el=$('status');if(!el)return;el.textContent=msg;el.className='status '+type}
function borderSizeMm(){return $('borderEnabled')?.checked?Math.max(0,Number($('borderSize')?.value||0)):0}
function updateBorderPreview(){const wrap=$('canvasWrap');if(!wrap)return;const mm=borderSizeMm();const [w]=photoSize();const px=mm>0&&fabricCanvas?Math.max(1,Math.round((fabricCanvas.width/w)*mm)):0;wrap.style.borderWidth=px+'px';wrap.style.borderColor=$('borderColor')?.value||'#ffffff';$('borderControls')?.classList.toggle('disabled-control',!$('borderEnabled')?.checked)}
function updateInfo(){const [w,h]=photoSize(),dpi=outputDpi(),b=borderSizeMm(),pxW=mmToPx(w+2*b,dpi),pxH=mmToPx(h+2*b,dpi);$('previewInfo').textContent=`${w} × ${h} mm${b?` + ${b} mm border`:''} • ${dpi} DPI • ${pxW} × ${pxH} px`;$('pixelInfo').textContent=`${pxW} × ${pxH} px`;updateBorderPreview()}
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
function relinkObjects(){const objs=fabricCanvas?.getObjects()||[];backgroundRect=objs.find(o=>o.layerType==='backgroundColor')||null;backgroundObj=objs.find(o=>o.layerType==='backgroundImage')||null;subjectObj=objs.find(o=>o.layerType==='subject')||null}
async function setSubjectFromDataUrl(dataUrl,name='Photo'){const img=await imageFromUrl(dataUrl);if(subjectObj)fabricCanvas.remove(subjectObj);subjectObj=makeFabricImage(img,name,'subject');placeSubject(subjectObj);fabricCanvas.add(subjectObj);fabricCanvas.setActiveObject(subjectObj);applyEnhance(false);fabricCanvas.requestRenderAll();refreshLayers()}

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

$('photoInput').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  if(!f.type.startsWith('image/')){status('Please select an image file.','error');return}
  sourceFile=f;$('selectedFileName').textContent=f.name;status('Loading and checking photo…');
  try{
    const normalized=await normalizeImageFile(f);sourceDataUrl=normalized.dataUrl;originalImageEl=await imageFromUrl(sourceDataUrl);
    initCanvas();await setSubjectFromDataUrl(sourceDataUrl,'Photo');
    $('placeholder').classList.add('hidden');$('canvasWrap').classList.remove('hidden');$('createBtn').disabled=false;$('resetBtn').disabled=false;
    history=[];historyIndex=-1;saveHistory();setTimeout(()=>{historyIndex=history.length-1;updateHistoryButtons()},140);
    status(`Photo loaded: ${normalized.width} × ${normalized.height}px. Editor preview is optimized; HD export remains at the selected final DPI.`,'ok');
    if($('removeBg').checked)await removeBackgroundNow();
  }catch(err){console.error(err);sourceDataUrl=null;status('This photo could not be decoded correctly. Please convert it to JPG/PNG/WebP or try another copy of the photo.','error')}
});

$('removeBg').addEventListener('change',async()=>{if(!sourceFile)return;if($('removeBg').checked)await removeBackgroundNow();else{removedBlob=null;await setSubjectFromDataUrl(sourceDataUrl,'Photo');saveHistory();status('Original background restored.','ok')}});
async function removeBackgroundNow(){if(removalBusy||!sourceFile)return;removalBusy=true;$('removeBg').disabled=true;$('createBtn').disabled=true;status('AI background removal starting… first run may take longer.');try{const mod=await import('https://esm.sh/@imgly/background-removal@1.7.0?bundle');const removeBackground=mod.default||mod.removeBackground;removedBlob=await removeBackground(sourceFile,{model:'isnet',progress:(key,current,total)=>{if(total)status(`Background remover: ${key} ${Math.round(current/total*100)}%`)}});const dataUrl=await blobToDataURL(removedBlob);await setSubjectFromDataUrl(dataUrl,'Subject (BG Removed)');saveHistory();status('Background removed. Subject is now a separate editable layer.','ok')}catch(err){console.error(err);$('removeBg').checked=false;status('Background removal failed. Check internet once and refresh.','error')}finally{removalBusy=false;$('removeBg').disabled=false;$('createBtn').disabled=false;refreshLayers()}}

$('bgUpload').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f||!fabricCanvas)return;try{const dataUrl=await fileToDataURL(f),img=await imageFromUrl(dataUrl);if(backgroundObj)fabricCanvas.remove(backgroundObj);backgroundObj=makeFabricImage(img,'Background Image','backgroundImage');placeCover(backgroundObj);fabricCanvas.add(backgroundObj);fabricCanvas.sendToBack(backgroundObj);if(backgroundRect)fabricCanvas.sendToBack(backgroundRect);fabricCanvas.setActiveObject(backgroundObj);fabricCanvas.requestRenderAll();refreshLayers();saveHistory();status('Background image added. Drag, resize or rotate it to adjust.','ok')}catch(err){console.error(err);status('Background image could not be loaded.','error')}});

$('bgColor').addEventListener('input',()=>{$('bgHex').value=$('bgColor').value;if(backgroundRect){backgroundRect.set('fill',$('bgColor').value);fabricCanvas.requestRenderAll()}if(!restoringHistory)saveHistory()});
$('bgHex').addEventListener('change',()=>{if(/^#[0-9a-f]{6}$/i.test($('bgHex').value)){$('bgColor').value=$('bgHex').value;$('bgColor').dispatchEvent(new Event('input'))}});
$('borderEnabled').addEventListener('change',()=>{updateInfo();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()});
function clampBorder(v){return Math.min(20,Math.max(0,Math.round((Number(v)||0)*2)/2))}
function setBorderSize(v){$('borderSize').value=clampBorder(v);updateInfo();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()}
$('borderMinus').addEventListener('click',()=>setBorderSize(Number($('borderSize').value)-.5));
$('borderPlus').addEventListener('click',()=>setBorderSize(Number($('borderSize').value)+.5));
$('borderSize').addEventListener('change',()=>setBorderSize($('borderSize').value));
$('borderColor').addEventListener('input',()=>{$('borderHex').value=$('borderColor').value;updateBorderPreview();saveHistory();if(!$('sheetPreviewWrap').classList.contains('hidden'))renderSheet()});
$('borderHex').addEventListener('change',()=>{if(/^#[0-9a-f]{6}$/i.test($('borderHex').value)){$('borderColor').value=$('borderHex').value;$('borderColor').dispatchEvent(new Event('input'))}});
function applyEnhance(record=true){if(!subjectObj)return;const filters=[];if($('autoEnhance').checked){filters.push(new Fabric.Image.filters.Brightness({brightness:(Number($('brightness').value)-100)/100}),new Fabric.Image.filters.Contrast({contrast:(Number($('contrast').value)-100)/100}),new Fabric.Image.filters.Saturation({saturation:(Number($('saturation').value)-100)/100}))}subjectObj.filters=filters;subjectObj.applyFilters();fabricCanvas?.requestRenderAll();if(record)saveHistory()}
['autoEnhance','brightness','contrast','saturation'].forEach(id=>$(id).addEventListener('input',()=>applyEnhance(true)));

function rebuildCanvasKeepObjects(record=true){if(!fabricCanvas)return updateInfo();const oldW=fabricCanvas.width,oldH=fabricCanvas.height,[newW,newH]=editorDims();fabricCanvas.getObjects().forEach(o=>{if(o!==backgroundRect){o.left=o.left/oldW*newW;o.top=o.top/oldH*newH;o.scaleX*=newW/oldW;o.scaleY*=newH/oldH}});fabricCanvas.setDimensions({width:newW,height:newH});if(backgroundRect)backgroundRect.set({width:newW,height:newH});fabricCanvas.requestRenderAll();updateInfo();if(record)saveHistory()}
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
  const [mmW,mmH]=photoSize(),dpi=outputDpi(),b=borderSizeMm(),contentW=mmToPx(mmW,dpi),contentH=mmToPx(mmH,dpi),borderPx=mmToPx(b,dpi);
  const active=fabricCanvas.getActiveObject();fabricCanvas.discardActiveObject();fabricCanvas.requestRenderAll();
  const inner=fabricCanvas.toCanvasElement(contentW/fabricCanvas.width,{enableRetinaScaling:false});
  const out=document.createElement('canvas');out.width=contentW+borderPx*2;out.height=contentH+borderPx*2;const c=out.getContext('2d',{alpha:type!=='image/jpeg'});c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.fillStyle=b>0?$('borderColor').value:'#ffffff';if(type==='image/jpeg'||b>0)c.fillRect(0,0,out.width,out.height);c.drawImage(inner,borderPx,borderPx,contentW,contentH);
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

$('resetBtn').addEventListener('click',()=>{sourceFile=null;sourceDataUrl=null;originalImageEl=null;removedBlob=null;subjectObj=null;backgroundObj=null;backgroundRect=null;cropGuide=null;cropTarget=null;history=[];historyIndex=-1;if(fabricCanvas){fabricCanvas.dispose();fabricCanvas=null}$('photoInput').value='';$('selectedFileName').textContent='No photo selected';$('bgUpload').value='';$('removeBg').checked=false;$('nepalPreset').value='manual';$('borderEnabled').checked=false;$('borderSize').value='1';$('borderColor').value='#ffffff';$('borderHex').value='#ffffff';updateBorderPreview();document.querySelectorAll('.crop-only').forEach(b=>b.classList.add('hidden'));$('placeholder').classList.remove('hidden');$('canvasWrap').classList.add('hidden');$('sheetPreviewWrap').classList.add('hidden');$('previewStage').classList.remove('hidden');$('resultTabs').classList.add('hidden');$('actions').classList.add('hidden');$('backEditorBtn').classList.add('hidden');$('createBtn').disabled=true;$('resetBtn').disabled=true;$('layersList').innerHTML='<div class="empty-layers">No layers yet</div>';updateHistoryButtons();status('Select a photo to begin.')});

updateInfo();updateHistoryButtons();
