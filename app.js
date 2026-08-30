const $ = (id) => document.getElementById(id);
const DPI = 300;
const photoInput = $('photoInput');
const photoCanvas = $('photoCanvas');
const ctx = photoCanvas.getContext('2d', { willReadFrequently:true });
let sourceImage = null;
let bgImage = null;
let lastSingleCanvas = null;
let lastSheetCanvas = null;
let currentTab = 'single';

const sizePresets = {
  '35x45':[35,45], '51x51':[50.8,50.8], '25x30':[25,30],
  '30x40':[30,40], '33x48':[33,48], '50x50':[50,50]
};
const paperPresets = {
  '4x6':[101.6,152.4], '5x7':[127,177.8], '6x8':[152.4,203.2],
  '8x10':[203.2,254], 'a4':[210,297], 'a5':[148,210]
};
const mmToPx = mm => Math.round(mm / 25.4 * DPI);

function getPhotoSize(){
  if($('photoSize').value === 'custom') return [Number($('customWidth').value)||35, Number($('customHeight').value)||45];
  return sizePresets[$('photoSize').value];
}
function setStatus(text, ok=false){ $('status').textContent=text; $('status').style.color=ok?'#0f8a4b':'#6b7280'; }
function updateInfo(){ const [w,h]=getPhotoSize(); $('previewInfo').textContent=`${w} × ${h} mm • ${DPI} DPI`; }

photoInput.addEventListener('change', async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  const img=new Image(); img.onload=()=>{ sourceImage=img; $('createBtn').disabled=false; $('resetBtn').disabled=false; $('placeholder').classList.add('hidden'); renderSingle(); setStatus('Photo loaded. Adjust settings or create digital photo.', true); };
  img.src=URL.createObjectURL(file);
});

$('bgUpload').addEventListener('change', e=>{
  const file=e.target.files?.[0]; if(!file){bgImage=null;renderSingle();return;}
  const img=new Image(); img.onload=()=>{bgImage=img;renderSingle();}; img.src=URL.createObjectURL(file);
});

$('photoSize').addEventListener('change',()=>{$('customSizeBox').classList.toggle('hidden',$('photoSize').value!=='custom');updateInfo();renderSingle();});
['customWidth','customHeight','paperSize','removeBg','autoEnhance','brightness','contrast','sharpness'].forEach(id=>$(id).addEventListener('input',()=>{updateInfo();renderSingle();}));
$('bgColor').addEventListener('input',()=>{$('bgHex').value=$('bgColor').value;renderSingle();});
$('bgHex').addEventListener('change',()=>{if(/^#[0-9a-fA-F]{6}$/.test($('bgHex').value)){$('bgColor').value=$('bgHex').value;renderSingle();}});

function coverRect(img, w, h){
  const scale=Math.max(w/img.width,h/img.height), dw=img.width*scale, dh=img.height*scale;
  return [(w-dw)/2,(h-dh)/2,dw,dh];
}

function applySimpleBackgroundRemoval(canvas){
  // Browser-only fast remover intended for plain/solid studio backgrounds.
  const c=canvas.getContext('2d',{willReadFrequently:true}); const im=c.getImageData(0,0,canvas.width,canvas.height); const d=im.data;
  const samples=[]; const pts=[[2,2],[canvas.width-3,2],[2,canvas.height-3],[canvas.width-3,canvas.height-3]];
  for(const [x,y] of pts){const i=(y*canvas.width+x)*4;samples.push([d[i],d[i+1],d[i+2]]);} 
  const bg=samples.reduce((a,p)=>[a[0]+p[0],a[1]+p[1],a[2]+p[2]],[0,0,0]).map(v=>v/samples.length);
  const threshold=70;
  for(let i=0;i<d.length;i+=4){const dist=Math.hypot(d[i]-bg[0],d[i+1]-bg[1],d[i+2]-bg[2]); if(dist<threshold){d[i+3]=Math.max(0,Math.min(255,(dist/threshold)*255));}}
  c.putImageData(im,0,0);
}

function sharpenCanvas(canvas, amount){
  if(amount<=0) return; const c=canvas.getContext('2d',{willReadFrequently:true}); const im=c.getImageData(0,0,canvas.width,canvas.height); const src=new Uint8ClampedArray(im.data); const d=im.data; const w=canvas.width,h=canvas.height; const a=(amount/100)*0.45;
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    const i=(y*w+x)*4;
    for(let k=0;k<3;k++){const center=src[i+k]*5-src[i-4+k]-src[i+4+k]-src[i-w*4+k]-src[i+w*4+k];d[i+k]=Math.max(0,Math.min(255,src[i+k]*(1-a)+center*a));}
  }
  c.putImageData(im,0,0);
}

function renderSingle(){
  if(!sourceImage) return;
  const [mmW,mmH]=getPhotoSize(), w=mmToPx(mmW), h=mmToPx(mmH);
  const out=document.createElement('canvas'); out.width=w; out.height=h; const oc=out.getContext('2d');
  if(bgImage){ const r=coverRect(bgImage,w,h); oc.drawImage(bgImage,...r); } else { oc.fillStyle=$('bgColor').value; oc.fillRect(0,0,w,h); }
  const person=document.createElement('canvas'); person.width=w; person.height=h; const pc=person.getContext('2d');
  const r=coverRect(sourceImage,w,h);
  const br=$('autoEnhance').checked?Number($('brightness').value):100;
  const ct=$('autoEnhance').checked?Number($('contrast').value):100;
  pc.filter=`brightness(${br}%) contrast(${ct}%) saturate(102%)`;
  pc.drawImage(sourceImage,...r); pc.filter='none';
  if($('removeBg').checked) applySimpleBackgroundRemoval(person);
  if($('autoEnhance').checked) sharpenCanvas(person,Number($('sharpness').value));
  oc.drawImage(person,0,0);
  lastSingleCanvas=out;
  if(currentTab==='single') showCanvas(out); else renderSheet();
}

function showCanvas(canvas){
  photoCanvas.width=canvas.width; photoCanvas.height=canvas.height; ctx.clearRect(0,0,photoCanvas.width,photoCanvas.height); ctx.drawImage(canvas,0,0); photoCanvas.classList.remove('hidden');
}

function renderSheet(){
  if(!lastSingleCanvas) return;
  const [pw,ph]=paperPresets[$('paperSize').value]; const W=mmToPx(pw),H=mmToPx(ph), gap=mmToPx(3), margin=mmToPx(5);
  const sheet=document.createElement('canvas'); sheet.width=W;sheet.height=H; const s=sheet.getContext('2d'); s.fillStyle='#fff';s.fillRect(0,0,W,H);
  const iw=lastSingleCanvas.width,ih=lastSingleCanvas.height; const cols=Math.max(1,Math.floor((W-margin*2+gap)/(iw+gap))); const rows=Math.max(1,Math.floor((H-margin*2+gap)/(ih+gap)));
  const usedW=cols*iw+(cols-1)*gap,usedH=rows*ih+(rows-1)*gap; const sx=(W-usedW)/2,sy=(H-usedH)/2;
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){const dx=sx+x*(iw+gap),dy=sy+y*(ih+gap);s.drawImage(lastSingleCanvas,dx,dy);s.strokeStyle='#d1d5db';s.lineWidth=1;s.strokeRect(dx,dy,iw,ih);}
  lastSheetCanvas=sheet; showCanvas(sheet); setStatus(`${cols*rows} photos arranged automatically on selected paper.`,true);
}

$('createBtn').addEventListener('click',()=>{renderSingle();renderSheet();currentTab='single';showCanvas(lastSingleCanvas);document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab==='single'));$('resultTabs').classList.remove('hidden');$('actions').classList.remove('hidden');setStatus('Digital photo created successfully.',true);});

document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{currentTab=btn.dataset.tab;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===btn));if(currentTab==='single')showCanvas(lastSingleCanvas);else renderSheet();}));

function downloadCanvas(canvas,type,name){if(!canvas)return;const a=document.createElement('a');a.download=name;a.href=canvas.toDataURL(type,type==='image/jpeg'?0.96:1);a.click();}
$('downloadJpg').onclick=()=>downloadCanvas(lastSingleCanvas,'image/jpeg','digital-photo-300dpi.jpg');
$('downloadPng').onclick=()=>downloadCanvas(lastSingleCanvas,'image/png','digital-photo-300dpi.png');
$('downloadSheet').onclick=()=>downloadCanvas(lastSheetCanvas,'image/jpeg','digital-photo-print-sheet.jpg');

$('resetBtn').addEventListener('click',()=>{sourceImage=null;bgImage=null;photoInput.value='';$('bgUpload').value='';$('createBtn').disabled=true;$('resetBtn').disabled=true;$('placeholder').classList.remove('hidden');photoCanvas.classList.add('hidden');$('resultTabs').classList.add('hidden');$('actions').classList.add('hidden');setStatus('Select a photo to begin.');});
updateInfo();
