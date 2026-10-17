import {extractArgs,compilePrompt,safeImage,validateEntry,openNotebook,allEntries,updateEntry,mergeBackup} from './notebook-core.js?v=notebook-1';

const $=id=>document.getElementById(id), fmt=value=>Number(value).toLocaleString('ko-KR');
const PAGE_SIZE=60, viewLabels={all:'모든 프롬프트',favorites:'즐겨찾기',mine:'내 카드'};
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
  $('storage-warning').textContent='이 브라우저에서는 즐겨찾기를 저장하지 못했습니다. 저장 공간과 개인정보 보호 설정을 확인한 뒤 다시 불러오세요. '+(error?.message||'');
}
async function reloadEntries() {
  const rows=await allEntries(db),valid=new Map(),categoryIds=new Set(catalog.categories.map(c=>c.id));let invalid=0;
  for(const row of rows){try{const entry=validateEntry(row,categoryIds);valid.set(entry.id,entry);}catch{invalid++;}}
  entries=valid;
  if(invalid){$('storage-warning').hidden=false;$('storage-warning').textContent=invalid+'개 저장 항목의 형식이 올바르지 않아 표시하지 못했습니다. 백업 다운로드로 원본을 보관할 수 있습니다.';}
}
function categoryLabel(id) { return catalog?.categories.find(c=>c.id===id)?.label||'기타 아이디어'; }
function effective(card) {
  const saved=card.id.startsWith('custom:')?entries.get(card.id):null;
  return saved ? {...card,title:saved.title??card.title,category:saved.category??card.category,tags:[...(card.tags||[]),...(saved.tags||[])],hasPrompt:saved.prompt!==undefined?!!saved.prompt.trim():card.hasPrompt,thumbnail:saved.imageData||card.thumbnail,savedAt:saved.updatedAt} : card;
}
function rebuildCards() {
  if(!catalog)return;
  const custom=[...entries.values()].filter(e=>e.id.startsWith('custom:')).map(e=>({id:e.id,title:e.title,description:e.description||'',category:e.category||'others',tags:[],thumbnail:e.imageData||'',imageCount:e.imageData?1:0,hasPrompt:!!e.prompt,variables:extractArgs(e.template||'').length,personal:true,origin:'custom'}));
  cards=[...custom,...catalog.cards].map(effective).map(card=>({...card,title:String(card.title||'제목 없는 카드').slice(0,300)}));
  cards.sort((a,b)=>Number(!a.thumbnail)-Number(!b.thumbnail));
  for(const card of cards)card.searchText=[card.title,card.description,...card.tags,categoryLabel(card.category)].join(' ').toLocaleLowerCase();
  $('all-count').textContent=fmt(cards.length);
  $('favorite-count').textContent=fmt(cards.filter(c=>entries.get(c.id)?.favorite).length);
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
  filtered=cards.filter(c=>(!category||c.category===category)&&(!words.length||words.every(w=>c.searchText.includes(w)))&&(!$('prompt-only').checked||c.hasPrompt)&&(!$('variables-only').checked||c.variables>0)&&(view==='all'||(view==='favorites'&&entries.get(c.id)?.favorite)||(view==='mine'&&c.personal)));
  const sort=$('sort').value;
  if(sort==='title')filtered.sort((a,b)=>a.title.localeCompare(b.title,'ko'));
  if(sort==='variables')filtered.sort((a,b)=>b.variables-a.variables);
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
    const meta=el('div',undefined,'card-meta'); meta.append(el('span',categoryLabel(card.category)),el('span',card.hasPrompt?'프롬프트 수록':'이미지'));
    button.append(meta); button.onclick=()=>openDetail(card); article.append(button);
    const favorite=!!entries.get(card.id)?.favorite, star=el('button',favorite?'★':'☆','card-star'); star.setAttribute('aria-label',card.title+(favorite?' 즐겨찾기 해제':' 즐겨찾기 추가')); star.setAttribute('aria-pressed',String(favorite));
    star.onclick=async()=>{
      star.disabled=true;
      try {if(!db)throw Error('브라우저 저장소를 사용할 수 없습니다.');const saved=await updateEntry(db,{id:card.id,favorite:!favorite,updatedAt:new Date().toISOString()});entries.set(card.id,saved);if(detail?.card.id===card.id&&!$('detail-favorite').disabled)$('detail-favorite').checked=saved.favorite;channel?.postMessage('updated');rebuildCards();filter();}
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
function dirty() {if(detail){detail.dirty=true;detail.revision++;$('save-status').textContent='수정한 프롬프트는 복사할 때만 사용됩니다';}}
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
function populate(card,source) {
  const stored=entries.get(card.id)||{},saved=card.id.startsWith('custom:')?stored:{};
  detail={card,source,template:saved.template??source.content??'',images:source.images||[],imageIndex:0,dirty:false,revision:0,language:saved.language||'original',compiled:''};
  $('detail-title').value=saved.title??card.title;$('detail-category').value=saved.category??card.category??'others';$('detail-favorite').checked=!!stored.favorite;
  $('detail-description').textContent=card.description||'';
  $('detail-title').readOnly=true;$('detail-category').disabled=true;$('detail-favorite').disabled=false;
  $('language-label').hidden=!source.translationId;$('language').value=detail.language;$('translation-note').textContent='';
  $('save-status').textContent='원문은 유지됩니다. 수정한 내용은 복사해서 사용하세요';
  renderVariables(saved.values||{});detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=saved.prompt??detail.compiled;renderImage();
  if(!$('detail').open)$('detail').showModal();$('detail').scrollTop=0;
}
async function openDetail(card) {
  const token=++openToken;
  try{const source=await fetchDetail(card);if(token!==openToken)return;populate(card,source);}
  catch(error){if(token===openToken)toast('카드를 열지 못했습니다. '+error.message,true);}
}
function closeDetail() {
  ++openToken;detail=null;document.body.append($('toast'));$('detail').close();
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
$('prompt-editor').addEventListener('input',dirty);
$('detail-favorite').onchange=async()=>{
  if(!detail)return;
  const current=detail,checkbox=$('detail-favorite'),favorite=checkbox.checked;checkbox.disabled=true;
  try {
    if(!db)throw Error('브라우저 저장소를 사용할 수 없습니다.');
    const saved=await updateEntry(db,{id:current.card.id,favorite,updatedAt:new Date().toISOString()});
    entries.set(saved.id,saved);channel?.postMessage('updated');rebuildCards();filter();
    if(detail?.card.id===current.card.id&&(detail===current||!checkbox.disabled))checkbox.checked=saved.favorite;
  }catch(error){if(detail===current)checkbox.checked=!favorite;toast(error.message,true);}
  finally{if(detail===current)checkbox.disabled=false;}
};
$('apply-variables').onclick=()=>{if(!detail)return;if($('prompt-editor').value!==detail.compiled&&!confirm('직접 편집한 프롬프트를 변수 값으로 다시 만들까요?'))return;detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;$('translation-note').textContent='';dirty();};
$('use-template').onclick=()=>{if(!detail)return;detail.template=$('prompt-editor').value;detail.source={...detail.source,args:[]};renderVariables();detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;dirty();toast(detail.args.length?detail.args.length+'개 변수를 찾았습니다.':'{주제}, {색상}처럼 중괄호로 변수를 표시해 주세요.');};
$('reset-prompt').onclick=()=>{if(!detail)return;if(detail.dirty&&!confirm('프롬프트를 원문으로 되돌릴까요?'))return;detail.template=detail.source.content||'';detail.language='original';$('language').value='original';renderVariables();detail.compiled=compilePrompt(detail.template,values());$('prompt-editor').value=detail.compiled;$('translation-note').textContent='';dirty();};
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
$('copy').onclick=copyPrompt;for(const link of document.querySelectorAll('.ai-target'))link.addEventListener('click',()=>{void copyPrompt();});
for(const id of ['backup-open','backup-shortcut'])$(id).onclick=()=>{$('backup-status').textContent='';$('backup-dialog').showModal();};
$('backup-close').onclick=()=>{document.body.append($('toast'));$('backup-dialog').close();};
$('export-backup').onclick=async()=>{
  try{const latest=db?await allEntries(db):[...entries.values()];downloadJson({format:'prompt-notebook-backup',version:1,exportedAt:new Date().toISOString(),entries:latest},'prompt-notes-'+new Date().toISOString().slice(0,10)+'.json');$('backup-status').textContent=fmt(latest.length)+'개 항목을 백업했습니다.';}catch(error){$('backup-status').textContent='백업하지 못했습니다. '+error.message;}
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
    await reloadEntries();channel?.postMessage('updated');rebuildCards();filter();$('backup-status').textContent=fmt(accepted)+'개 항목을 가져왔습니다. 더 최근에 저장한 기존 항목은 유지했습니다.';
  }catch(error){$('backup-status').textContent='가져오지 못했습니다. '+error.message;}
  finally{$('import-backup').value='';}
};
$('retry').onclick=init;
document.addEventListener('keydown',event=>{if(event.key==='/'&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('search').focus();}});
if(channel)channel.onmessage=async()=>{if(!db||!catalog)return;try{await reloadEntries();rebuildCards();filter();if(detail&&!$('detail-favorite').disabled)$('detail-favorite').checked=!!entries.get(detail.card.id)?.favorite;}catch(error){storageWarning(error);}};
init();
