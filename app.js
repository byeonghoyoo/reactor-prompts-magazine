import {extractArgs,compilePrompt,safeImage,validateEntry,openNotebook,allEntries,writeEntries,updateEntry,mergeBackup} from './notebook-core.js?v=notebook-1';

const $=id=>document.getElementById(id), fmt=value=>Number(value).toLocaleString('ko-KR');
const PAGE_SIZE=60, viewLabels={all:'모든 프롬프트',favorites:'즐겨찾기',notes:'저장한 노트',mine:'내 카드'};
let catalog=null, db=null, entries=new Map(), cards=[], filtered=[], pageNumber=1, category='', view='all', detail=null, openToken=0, toastTimer;
let translationsPromise=null, loading=false;
const chunks=new Map();
const channel=typeof BroadcastChannel==='function' ? new BroadcastChannel('prompt-notebook-changes') : null;

function el(tag,text,className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=String(text??''); if(className)node.className=className; return node; }
function toast(message,error=false) {
  const box=$('toast'); clearTimeout(toastTimer); box.textContent=message; box.className='toast'+(error?' error':''); box.hidden=false;
  // A modal's top layer obscures body-level notifications.
  (document.querySelector('dialog[open]')||document.body).append(box);
  toastTimer=setTimeout(()=>{box.hidden=true;document.body.append(box);},4500);
}
function storageWarning(error) {
  $('storage-warning').hidden=false;
  $('storage-warning').textContent='이 브라우저에서는 노트를 저장하지 못했습니다. 저장 공간과 개인정보 보호 설정을 확인한 뒤 다시 불러오세요. '+(error?.message||'');
}
async function persist(items,remove=[]) {
  if(!db) throw Error('브라우저 저장소를 사용할 수 없습니다. 페이지를 새로고침해 주세요.');
  await writeEntries(db,items,remove);
  for(const id of remove)entries.delete(id);
  for(const item of items)entries.set(item.id,item);
  channel?.postMessage('updated');
}
async function reloadEntries() {
  const rows=await allEntries(db),valid=new Map(),categoryIds=new Set(catalog.categories.map(c=>c.id));let invalid=0;
  for(const row of rows){try{const entry=validateEntry(row,categoryIds);valid.set(entry.id,entry);}catch{invalid++;}}
  entries=valid;
  if(invalid){$('storage-warning').hidden=false;$('storage-warning').textContent=invalid+'개 저장 항목의 형식이 올바르지 않아 표시하지 못했습니다. 백업 다운로드로 원본을 보관할 수 있습니다.';}
}
function categoryLabel(id) { return catalog?.categories.find(c=>c.id===id)?.label||'기타 아이디어'; }
function effective(card) {
  const saved=entries.get(card.id);
  return saved ? {...card,title:saved.title??card.title,category:saved.category??card.category,tags:[...(card.tags||[]),...(saved.tags||[])],hasPrompt:saved.prompt!==undefined?!!saved.prompt.trim():card.hasPrompt,thumbnail:saved.imageData||card.thumbnail,savedAt:saved.updatedAt} : card;
}
function rebuildCards() {
  if(!catalog)return;
  const custom=[...entries.values()].filter(e=>e.id.startsWith('custom:')).map(e=>({id:e.id,title:e.title,description:e.description||'',category:e.category||'others',tags:[],thumbnail:e.imageData||'',imageCount:e.imageData?1:0,hasPrompt:!!e.prompt,variables:extractArgs(e.template||'').length,personal:true,origin:'custom'}));
  cards=[...custom,...catalog.cards].map(effective).map(card=>({...card,title:String(card.title||'제목 없는 카드').slice(0,300)}));
  cards.sort((a,b)=>Number(!a.thumbnail)-Number(!b.thumbnail));
  for(const card of cards)card.searchText=[card.title,card.description,...card.tags,categoryLabel(card.category),entries.get(card.id)?.notes||''].join(' ').toLocaleLowerCase();
  $('all-count').textContent=fmt(cards.length);
  $('favorite-count').textContent=fmt(cards.filter(c=>entries.get(c.id)?.favorite).length);
  $('note-count').textContent=fmt(cards.filter(c=>entries.get(c.id)?.prompt!==undefined).length);
  $('mine-count').textContent=fmt(cards.filter(c=>c.personal).length);
  const counts=new Map(); for(const card of cards)counts.set(card.category,(counts.get(card.category)||0)+1);
  for(const button of document.querySelectorAll('[data-category]'))button.querySelector('span').textContent=fmt(counts.get(button.dataset.category)||0);
}
function imageNode(src,alt) {
  const url=safeImage(src); if(!url)return el('span','저장된 이미지가 없습니다','placeholder');
  const img=el('img'); img.src=url; img.alt=alt; img.loading='lazy'; img.decoding='async';
  img.addEventListener('error',()=>img.replaceWith(el('span','이미지를 불러오지 못했습니다','placeholder')),{once:true}); return img;
}
function filter(reset=false) {
  if(reset)pageNumber=1;
  const words=$('search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  filtered=cards.filter(c=>(!category||c.category===category)&&(!words.length||words.every(w=>c.searchText.includes(w)))&&(!$('prompt-only').checked||c.hasPrompt)&&(!$('variables-only').checked||c.variables>0)&&(view==='all'||(view==='favorites'&&entries.get(c.id)?.favorite)||(view==='notes'&&entries.get(c.id)?.prompt!==undefined)||(view==='mine'&&c.personal)));
  const sort=$('sort').value;
  if(sort==='title')filtered.sort((a,b)=>a.title.localeCompare(b.title,'ko'));
  if(sort==='variables')filtered.sort((a,b)=>b.variables-a.variables);
  if(sort==='saved')filtered.sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
  pageNumber=Math.min(pageNumber,Math.max(1,Math.ceil(filtered.length/PAGE_SIZE))); render();
}
function render() {
  const fragment=document.createDocumentFragment();
  for(const card of filtered.slice((pageNumber-1)*PAGE_SIZE,pageNumber*PAGE_SIZE)) {
    const article=el('article',undefined,'card'); article.dataset.id=card.id;
    const button=el('button',undefined,'card-open'); button.setAttribute('aria-label',card.title+' 프롬프트 열기');
    const image=el('div',undefined,'card-image'); image.append(imageNode(card.thumbnail,card.title));
    if(card.variables)image.append(el('span',`변수 ${card.variables}개`,'image-badge'));
    else if(card.imageCount>1)image.append(el('span',`${card.imageCount}장`,'image-badge'));
    button.append(image,el('h2',card.title,'card-title'));
    const meta=el('div',undefined,'card-meta'); meta.append(el('span',categoryLabel(card.category)),el('span',entries.get(card.id)?.prompt!==undefined?'노트 저장됨':card.hasPrompt?'프롬프트 수록':'이미지'));
    button.append(meta); button.onclick=()=>openDetail(card); article.append(button);
    const favorite=!!entries.get(card.id)?.favorite, star=el('button',favorite?'★':'☆','card-star'); star.setAttribute('aria-label',card.title+(favorite?' 즐겨찾기 해제':' 즐겨찾기 추가')); star.setAttribute('aria-pressed',String(favorite));
    star.onclick=async()=>{
      star.disabled=true;
      try {if(!db)throw Error('브라우저 저장소를 사용할 수 없습니다.');const saved=await updateEntry(db,{id:card.id,favorite:!favorite,updatedAt:new Date().toISOString()});entries.set(card.id,saved);channel?.postMessage('updated');rebuildCards();filter();}
      catch(error){toast(error.message,true);star.disabled=false;}
    };
    article.append(star);fragment.append(article);
  }
  $('gallery').replaceChildren(fragment);$('gallery').setAttribute('aria-busy','false');$('empty').hidden=filtered.length>0;
  $('result-count').textContent=fmt(filtered.length)+'개';$('page-number').textContent=pageNumber+' / '+Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  $('previous').disabled=pageNumber===1;$('next').disabled=pageNumber>=Math.ceil(filtered.length/PAGE_SIZE);
  $('view-title').textContent=category?categoryLabel(category):viewLabels[view];
  $('breadcrumb').textContent=category?viewLabels[view]+' / 주제별로 찾기':'나의 아이디어 라이브러리';
  $('summary').textContent=`${fmt(filtered.length)}개의 아이디어를 둘러보고 나만의 프롬프트를 만들어 보세요.`;
  for(const button of document.querySelectorAll('[data-view]')) { if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); }
  for(const button of document.querySelectorAll('[data-category]'))button.setAttribute('aria-pressed',String(category===button.dataset.category));
  $('category-select').value=category;
}
function makeCategories() {
  $('categories').replaceChildren();$('category-select').replaceChildren(new Option('전체 주제',''));$('detail-category').replaceChildren();
  for(const group of catalog.groups) {
    const section=el('details');section.open=['people','marketing','business'].includes(group.id);section.append(el('summary',group.label));
    const options=el('optgroup');options.label=group.label;
    for(const cat of catalog.categories.filter(c=>c.group===group.id)) {
      const button=el('button',cat.label);button.dataset.category=cat.id;button.append(el('span',fmt(cat.count)));button.onclick=()=>{category=category===cat.id?'':cat.id;filter(true);};section.append(button);
      options.append(new Option(cat.label,cat.id));$('detail-category').append(new Option(cat.label,cat.id));
    }
    $('categories').append(section);$('category-select').append(options);
  }
}
async function fetchDetail(card) {
  if(card.id.startsWith('custom:')) {const saved=entries.get(card.id);return {id:card.id,content:saved?.template||saved?.prompt||'',args:[],images:saved?.imageData?[{preview:saved.imageData,kind:'personal'}]:[]};}
  if(!/^library\/details\/[\w-]+\.json$/.test(card.chunk))throw Error('상세 자료 경로가 올바르지 않습니다.');
  if(!chunks.has(card.chunk)) {
    const promise=fetch(card.chunk).then(async r=>{if(!r.ok)throw Error('상세 자료 HTTP '+r.status);return r.json();}).catch(e=>{chunks.delete(card.chunk);throw e;});
    chunks.set(card.chunk,promise);if(chunks.size>32)chunks.delete(chunks.keys().next().value);
  }
  const part=await chunks.get(card.chunk);if(!part?.[card.id])throw Error('상세 자료를 찾을 수 없습니다.');return part[card.id];
}
function values() { const map=Object.create(null);for(const input of $('variable-fields').querySelectorAll('input'))map[input.dataset.name]=input.value;return map; }
function dirty() {if(detail){detail.dirty=true;detail.revision++;$('save-status').textContent='저장하지 않은 변경사항';}}
function renderVariables(savedValues={}) {
  const args=extractArgs(detail.template,detail.source.args||[]);detail.args=args;
  $('variables-section').hidden=args.length===0;$('variable-count').textContent=args.length+'개';$('variable-fields').replaceChildren();
  for(const [index,arg] of args.entries()) {
    const label=el('label',arg.name,'field');const input=el('input');input.type='text';input.id='variable-'+index;input.dataset.name=arg.name;input.maxLength=10000;input.value=Object.hasOwn(savedValues,arg.name)?savedValues[arg.name]:arg.default;label.append(input);$('variable-fields').append(label);
    input.oninput=()=>{
      if($('prompt-editor').value===detail.compiled){detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;}
      else $('translation-note').textContent='직접 편집한 문장이 있습니다. 변수 적용을 누르면 새 값으로 다시 만듭니다.';
      dirty();
    };
  }
}
function renderImage() {
  const image=detail.images[detail.imageIndex];$('image-stage').replaceChildren(imageNode(image?.preview,$('detail-title').value));
  $('image-number').textContent=detail.images.length?`${detail.imageIndex+1} / ${detail.images.length}`:'이미지 없음';
  $('image-previous').disabled=detail.imageIndex<=0;$('image-next').disabled=detail.imageIndex>=detail.images.length-1;
  const preview=safeImage(image?.preview);$('preview-download').hidden=!preview;
  if(preview){$('preview-download').href=preview;$('preview-download').download='prompt-note-'+detail.card.id.replace(/[^\w-]/g,'-')+'.webp';}
  const archive=typeof image?.archive==='string'&&/^https:\/\/github\.com\/byeonghoyoo\/reactor-prompts-magazine\/releases\/download\/[\w.-]+\/[\w.-]+\.zip$/.test(image.archive)?image.archive:'';
  $('original-download').hidden=!archive;if(archive)$('original-download').href=archive;
  $('image-note').textContent=!preview?'이 카드의 이미지 파일을 보관 위치에서 찾지 못했습니다.':image.kind==='cached-preview'?'PC에 저장되어 있던 미리보기입니다. ZIP에는 PC 파일을 그대로 보관했습니다.':image.kind==='personal'?'내 카드에 저장된 참고 이미지입니다.':'열람용 미리보기입니다. 보관 파일은 ZIP에서 받을 수 있습니다.';
  if(image?.file&&archive)$('original-download').title='ZIP 안의 파일: '+image.file;
}
function populate(card,source,isNew=false) {
  const saved=entries.get(card.id)||{};
  detail={card,source,template:saved.template??source.content??'',images:source.images||[],imageIndex:0,dirty:false,revision:0,savedAt:saved.updatedAt??null,isNew,imageData:saved.imageData||'',language:saved.language||'original',compiled:''};
  $('detail-title').value=saved.title??card.title;$('detail-category').value=saved.category??card.category??'others';$('detail-favorite').checked=!!saved.favorite;
  $('detail-description').textContent=card.description||'';$('note-editor').value=saved.notes||'';$('note-tags').value=(saved.tags||[]).join(', ');
  $('language-label').hidden=!source.translationId;$('language').value=detail.language;$('translation-note').textContent='';
  $('upload-label').hidden=!card.id.startsWith('custom:');$('image-upload').value='';$('delete-note').hidden=!entries.has(card.id);
  $('save-status').textContent=entries.has(card.id)?'저장한 노트':'편집 후 내 노트로 저장하세요';
  renderVariables(saved.values||{});detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=saved.prompt??detail.compiled;renderImage();
  if(!$('detail').open)$('detail').showModal();$('detail').scrollTop=0;
}
async function openDetail(card) {
  const token=++openToken;
  try{const source=await fetchDetail(card);if(token!==openToken)return;populate(card,source);}
  catch(error){if(token===openToken)toast('카드를 열지 못했습니다. '+error.message,true);}
}
function closeDetail() {
  if(detail?.dirty&&!confirm('저장하지 않은 변경사항을 버릴까요?'))return;
  ++openToken;detail=null;document.body.append($('toast'));$('detail').close();
}
async function saveNote() {
  if(!detail)return;const current=detail,revision=current.revision,button=$('save-note');button.disabled=true;
  try {
    const title=$('detail-title').value.trim();if(!title)throw Error('제목을 입력해 주세요.');
    if(current.card.id.startsWith('custom:')&&!current.template)current.template=$('prompt-editor').value;
    const entry=validateEntry({id:current.card.id,title,category:$('detail-category').value,prompt:$('prompt-editor').value,template:current.template,values:values(),notes:$('note-editor').value,tags:[...new Set($('note-tags').value.split(',').map(t=>t.trim()).filter(Boolean))],favorite:$('detail-favorite').checked,updatedAt:new Date().toISOString(),language:current.language,...(current.card.id.startsWith('custom:')?{imageData:current.imageData,description:current.card.description||''}:{})},new Set(catalog.categories.map(c=>c.id)));
    if(!db)throw Error('브라우저 저장소를 사용할 수 없습니다.');
    const saved=await updateEntry(db,entry,current.savedAt);entries.set(saved.id,saved);current.savedAt=saved.updatedAt;channel?.postMessage('updated');rebuildCards();filter();
    if(detail===current){detail.dirty=detail.revision!==revision;detail.isNew=false;$('save-status').textContent=detail.dirty?'저장 후 추가한 변경사항이 있습니다':'이 브라우저에 저장했습니다';$('delete-note').hidden=false;}
    toast(detail===current&&detail.dirty?'이전 내용을 저장했습니다. 추가 편집은 다시 저장해 주세요.':'내 노트에 저장했습니다.');
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
}
async function copyPrompt() {
  const value=$('prompt-editor').value;if(!value.trim()){toast('복사할 프롬프트가 없습니다.',true);return false;}
  try{await navigator.clipboard.writeText(value);toast('프롬프트를 복사했습니다.');return true;}catch{ $('prompt-editor').focus();$('prompt-editor').select();toast('자동 복사가 허용되지 않습니다. 선택된 내용을 직접 복사해 주세요.',true);return false; }
}
function downloadJson(data,name) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function init() {
  if(loading)return;loading=true;$('load-error').hidden=true;
  try {
    const response=await fetch('library/catalog.json?v=notebook-1');if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();if(!Array.isArray(data.cards)||!Array.isArray(data.categories)||!Array.isArray(data.groups))throw Error('라이브러리 데이터 형식 오류');catalog=data;
    try{db??=await openNotebook();await reloadEntries();}catch(error){storageWarning(error);}
    makeCategories();rebuildCards();filter();
    const s=catalog.summary;$('coverage').textContent=`전체 ${fmt(s.totalCards)}개 카드. PromptStudio ${fmt(s.studioSourceCards)}개 중 중복 ${fmt(s.duplicatesMerged)}개를 합쳤습니다. PC 이미지 파일 ${fmt(s.cachedFiles)}개를 보관했습니다. PC에서 찾지 못한 이미지 ${fmt(s.missingLocalImages)}개와 기존 갤러리 서버의 누락 이미지는 기록에 남겼습니다.`;
  }catch(error){$('load-error').hidden=false;$('load-error-text').textContent='라이브러리를 불러오지 못했습니다. '+error.message;$('summary').textContent='연결을 확인하고 다시 불러와 주세요.';$('gallery').setAttribute('aria-busy','false');}
  finally{loading=false;}
}

$('search').oninput=()=>filter(true);$('prompt-only').onchange=()=>filter(true);$('variables-only').onchange=()=>filter(true);$('sort').onchange=()=>filter(true);
$('category-select').onchange=()=>{category=$('category-select').value;filter(true);};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;category='';filter(true);};
$('previous').onclick=()=>{if(pageNumber>1){pageNumber--;render();window.scrollTo({top:0});}};
$('next').onclick=()=>{if(pageNumber<Math.ceil(filtered.length/PAGE_SIZE)){pageNumber++;render();window.scrollTo({top:0});}};
$('clear-filters').onclick=()=>{category='';view='all';$('search').value='';$('prompt-only').checked=false;$('variables-only').checked=false;filter(true);};
$('close').onclick=closeDetail;$('detail').addEventListener('cancel',e=>{e.preventDefault();closeDetail();});
$('image-previous').onclick=()=>{if(detail?.imageIndex>0){detail.imageIndex--;renderImage();}};
$('image-next').onclick=()=>{if(detail&&detail.imageIndex<detail.images.length-1){detail.imageIndex++;renderImage();}};
for(const id of ['detail-title','detail-category','detail-favorite','prompt-editor','note-editor','note-tags'])$(id).addEventListener('input',dirty);
$('apply-variables').onclick=()=>{if(!detail)return;if($('prompt-editor').value!==detail.compiled&&!confirm('직접 편집한 프롬프트를 변수 값으로 다시 만들까요?'))return;detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;$('translation-note').textContent='';dirty();};
$('use-template').onclick=()=>{if(!detail)return;detail.template=$('prompt-editor').value;detail.source={...detail.source,args:[]};renderVariables();detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;dirty();toast(detail.args.length?detail.args.length+'개 변수를 찾았습니다.':'{주제}, {색상}처럼 중괄호로 변수를 표시해 주세요.');};
$('reset-prompt').onclick=()=>{if(!detail)return;if(detail.dirty&&!confirm('프롬프트를 원문으로 되돌릴까요? 메모는 유지됩니다.'))return;detail.template=detail.source.content||'';detail.language='original';$('language').value='original';renderVariables();detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;$('translation-note').textContent='';dirty();};
$('language').onchange=async()=>{
  if(!detail)return;const current=detail,language=$('language').value;
  if($('prompt-editor').value!==detail.compiled&&!confirm('편집한 프롬프트를 선택한 언어로 바꿀까요?')){$('language').value=current.language;return;}
  const token=++openToken,revision=current.revision;$('language').disabled=true;
  try {
    let text=current.source.content||'',note='';
    if(language!=='original') {
      translationsPromise??=fetch('source/translations.json').then(async r=>{if(!r.ok)throw Error('번역 HTTP '+r.status);return r.json();}).catch(e=>{translationsPromise=null;throw e;});
      const data=await translationsPromise;const translated=data[language]?.['prompt_'+current.source.translationId];
      if(typeof translated==='string'&&translated.trim())text=translated;else note='이 언어의 번역이 없어 원문을 표시합니다.';
    }
    if(detail!==current||token!==openToken)return;
    if(current.revision!==revision){$('language').value=current.language;toast('번역을 기다리는 동안 편집한 내용이 있어 현재 프롬프트를 유지했습니다.');return;}
    current.template=text;current.language=language;renderVariables();current.compiled=compilePrompt(text,values());$('prompt-editor').value=current.compiled;$('translation-note').textContent=note;dirty();
  }catch(error){if(detail===current){$('language').value=current.language;toast('번역을 불러오지 못했습니다. 원문은 계속 사용할 수 있습니다.',true);}}
  finally{$('language').disabled=false;}
};
$('save-note').onclick=saveNote;$('copy').onclick=copyPrompt;for(const link of document.querySelectorAll('.ai-target'))link.addEventListener('click',()=>{void copyPrompt();});
$('new-card').onclick=()=>{if(!catalog){toast('라이브러리를 불러온 후 다시 시도해 주세요.',true);return;}++openToken;populate({id:'custom:'+crypto.randomUUID(),title:'',category:category||'others',description:''},{content:'',args:[],images:[]},true);$('detail-title').focus();};
$('image-upload').onchange=async()=>{
  const current=detail,file=$('image-upload').files[0];if(!file||!current)return;const token=current.uploadToken=(current.uploadToken||0)+1;
  try {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('10MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.');
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const data=canvas.toDataURL('image/webp',.85);if(data.length>4000000)throw Error('이미지가 너무 복잡합니다. 더 작은 이미지를 선택해 주세요.');
    if(detail!==current||token!==current.uploadToken)return;current.imageData=data;current.images=[{preview:data,kind:'personal'}];current.imageIndex=0;renderImage();dirty();
  }catch(error){toast(error.message,true);}
};
$('delete-note').onclick=async()=>{
  if(!detail||!confirm(detail.card.id.startsWith('custom:')?'이 브라우저에 저장한 카드를 삭제할까요?':'이 카드의 개인 편집·메모·즐겨찾기를 지우고 원본으로 돌아갈까요?'))return;
  const current=detail;try{await persist([],[current.card.id]);if(detail===current){current.dirty=false;closeDetail();}rebuildCards();filter();toast('저장 내용을 삭제했습니다.');}catch(error){toast(error.message,true);}
};
for(const id of ['backup-open','backup-shortcut'])$(id).onclick=()=>{$('backup-status').textContent='';$('backup-dialog').showModal();};
$('backup-close').onclick=()=>{document.body.append($('toast'));$('backup-dialog').close();};
$('export-backup').onclick=async()=>{
  try{const latest=db?await allEntries(db):[...entries.values()];downloadJson({format:'prompt-notebook-backup',version:1,exportedAt:new Date().toISOString(),entries:latest},'prompt-notes-'+new Date().toISOString().slice(0,10)+'.json');$('backup-status').textContent=fmt(latest.length)+'개 노트를 백업했습니다.';}catch(error){$('backup-status').textContent='백업하지 못했습니다. '+error.message;}
};
$('import-backup').onchange=async()=>{
  const file=$('import-backup').files[0];if(!file)return;
  try {
    if(!catalog)throw Error('먼저 라이브러리를 불러와 주세요.');if(file.size>100*1024*1024)throw Error('100MB 이하의 백업 파일을 선택해 주세요.');
    const data=JSON.parse(await file.text());if(data.format!=='prompt-notebook-backup'||data.version!==1||!Array.isArray(data.entries)||data.entries.length>40000)throw Error('프롬프트 노트 백업 파일이 아닙니다.');
    const ids=new Set(catalog.categories.map(c=>c.id)),known=new Set(catalog.cards.map(c=>c.id));
    const incoming=data.entries.map(e=>validateEntry(e,ids));if(new Set(incoming.map(e=>e.id)).size!==incoming.length)throw Error('중복된 노트 ID가 있는 백업입니다.');
    if(!db)throw Error('브라우저 저장소를 사용할 수 없습니다.');
    const accepted=await mergeBackup(db,incoming.filter(e=>e.id.startsWith('custom:')||known.has(e.id)));
    await reloadEntries();channel?.postMessage('updated');rebuildCards();filter();$('backup-status').textContent=fmt(accepted)+'개 노트를 가져왔습니다. 더 최근에 저장한 기존 노트는 유지했습니다.';
  }catch(error){$('backup-status').textContent='가져오지 못했습니다. '+error.message;}
  finally{$('import-backup').value='';}
};
$('retry').onclick=init;
document.addEventListener('keydown',event=>{if(event.key==='/'&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('search').focus();}});
window.addEventListener('beforeunload',event=>{if(detail?.dirty){event.preventDefault();event.returnValue='';}});
if(channel)channel.onmessage=async()=>{if(!db||!catalog)return;try{await reloadEntries();rebuildCards();filter();if(detail)$('save-status').textContent='다른 탭의 저장 내용이 바뀌었습니다. 다시 열어 확인하세요.';}catch(error){storageWarning(error);}};
init();
