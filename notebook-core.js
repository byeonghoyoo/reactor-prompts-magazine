const argumentPattern = /\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}|\{([^{}\r\n]{1,200})\}/g;
const validName = name => name.length<=200 && /^[\p{L}_]/u.test(name) && !/[{}"\r\n:=]/.test(name);

export function extractArgs(content, declared = []) {
  const args = new Map();
  const defaults=new Map((Array.isArray(declared)?declared:[]).filter(arg=>arg&&typeof arg.name==='string').map(arg=>[arg.name.trim(),String(arg.default??'')]));
  for (const match of String(content || '').matchAll(argumentPattern)) {
    const name = (match[1]??match[3]).trim();
    if (validName(name) && !args.has(name)) args.set(name, {name, default:defaults.get(name)??match[2]??''});
  }
  return [...args.values()];
}

export function compilePrompt(template, values = {}) {
  const get = (name, fallback) => validName(name.trim())&&Object.hasOwn(values, name.trim())&&values[name.trim()]!=='' ? String(values[name.trim()]) : fallback;
  // One replacement pass: inserted user values are never parsed again as template code.
  return String(template || '').replace(argumentPattern,
    (match, name, fallback, simple) => name !== undefined ? get(name, fallback) : get(simple, match));
}

export function safeImage(value) {
  if (typeof value !== 'string') return '';
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)) return value;
  return /^(?:library\/)?previews\/[a-f0-9]+\.webp$/.test(value) ? value : '';
}

export function validateEntry(raw, categoryIds) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^(?:reactor:|studio:|custom:)[\w:.-]{1,160}$/.test(raw.id)) throw Error('노트 ID 형식이 올바르지 않습니다.');
  const entry = {id:raw.id, favorite:raw.favorite === true, updatedAt:typeof raw.updatedAt==='string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : new Date().toISOString()};
  for (const [key,limit] of Object.entries({title:300,prompt:300000,template:300000,notes:30000,description:1000,language:12})) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string' || raw[key].length>limit) throw Error('백업의 '+key+' 값이 너무 길거나 형식이 다릅니다.');
      entry[key]=raw[key];
    }
  }
  if (raw.category !== undefined) entry.category = categoryIds.has(raw.category) ? raw.category : 'others';
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length>50 || raw.tags.some(t=>typeof t!=='string'||t.length>100)) throw Error('태그 형식이 올바르지 않습니다.');
    entry.tags=raw.tags;
  }
  if (raw.values !== undefined) {
    if (!raw.values || typeof raw.values!=='object' || Array.isArray(raw.values) || Object.keys(raw.values).length>300) throw Error('변수 형식이 올바르지 않습니다.');
    entry.values=Object.create(null);
    for (const [name,value] of Object.entries(raw.values)) {
      if (name.length>200 || typeof value!=='string' || value.length>10000) throw Error('변수 값이 너무 길거나 형식이 다릅니다.');
      entry.values[name]=value;
    }
  }
  if (raw.imageData !== undefined) {
    if (typeof raw.imageData!=='string' || raw.imageData.length>4000000 || (raw.imageData && !safeImage(raw.imageData))) throw Error('백업 이미지 형식이 올바르지 않습니다.');
    entry.imageData=raw.imageData;
  }
  if (entry.id.startsWith('custom:') && !entry.title?.trim()) throw Error('내 카드에는 제목이 필요합니다.');
  return entry;
}

export function openNotebook() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('prompt-notebook',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('entries',{keyPath:'id'});
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('다른 탭에서 노트 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도하세요.'));
    request.onsuccess=()=>{ const db=request.result; db.onversionchange=()=>db.close(); resolve(db); };
  });
}
export function allEntries(db) {
  return new Promise((resolve,reject)=>{
    const request=db.transaction('entries').objectStore('entries').getAll();
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
}
export function writeEntries(db, entries, remove=[]) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('entries','readwrite'); const store=tx.objectStore('entries');
    for(const id of remove) store.delete(id);
    for(const entry of entries) store.put(entry);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||Error('저장이 취소되었습니다.'));
  });
}

export function updateEntry(db, patch, expectedUpdatedAt) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries');let result,failure;
    const request=store.get(patch.id);
    request.onsuccess=()=>{
      const current=request.result;
      if(expectedUpdatedAt!==undefined&&(current?.updatedAt??null)!==expectedUpdatedAt){failure=Error('다른 탭에서 이 노트를 수정했습니다. 편집 내용을 복사한 뒤 카드를 다시 열어 주세요.');tx.abort();return;}
      result={...current,...patch};
      if(result.id.startsWith('custom:')&&!result.title?.trim()){failure=Error('이 카드는 다른 탭에서 삭제되었습니다. 목록을 다시 불러와 주세요.');tx.abort();return;}
      store.put(result);
    };
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||Error('저장이 취소되었습니다.'));
  });
}
export function mergeBackup(db, incoming) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries');let accepted=0;
    for(const entry of incoming){const request=store.get(entry.id);request.onsuccess=()=>{const current=request.result;if(!current||Date.parse(entry.updatedAt)>=Date.parse(current.updatedAt)){store.put(entry);accepted++;}};}
    tx.oncomplete=()=>resolve(accepted);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('백업 가져오기가 취소되었습니다.'));
  });
}
