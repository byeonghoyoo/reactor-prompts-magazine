// Convenience entry screen for a public static site, not server-side access control.
const expectedDigest='bced83a6ff1344c1b5a2c19cdd62288190ff6775a8e6c324b36bccae9d134da5';
const sessionKey='beauty-blossom-prompt-entry-v1';
const $=id=>document.getElementById(id);
let busy=false;

function remembered() {
  try{return sessionStorage.getItem(sessionKey)===expectedDigest;}catch{return false;}
}
function remember(allowed) {
  try{if(allowed)sessionStorage.setItem(sessionKey,expectedDigest);else sessionStorage.removeItem(sessionKey);}catch{}
}
function setBusy(value) {
  busy=value;$('login-submit').disabled=value;
  $('login-submit').textContent=value?'확인 중…':'로그인';
  $('login-form').setAttribute('aria-busy',String(value));
}
async function enterNotebook() {
  const {startNotebook}=await import('./app.js?v=notebook-3');
  $('login-form').reset();$('login-screen').hidden=true;$('notebook-app').hidden=false;
  document.title='프롬프트 노트 · 뷰티블라썸';
  startNotebook();$('search').focus();
}
function entryFailed() {
  remember(false);$('notebook-app').hidden=true;$('login-screen').hidden=false;
  $('login-error').textContent='화면을 불러오지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.';
}

$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  setBusy(true);$('login-error').textContent='';
  $('login-id').removeAttribute('aria-invalid');$('login-password').removeAttribute('aria-invalid');
  try {
    const username=$('login-id').value.normalize('NFC').trim(),password=$('login-password').value;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(username+'\n'+password));
    const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(actual!==expectedDigest) {
      $('login-error').textContent='아이디 또는 비밀번호를 확인해 주세요.';
      $('login-id').setAttribute('aria-invalid','true');$('login-password').setAttribute('aria-invalid','true');
      $('login-password').focus();$('login-password').select();return;
    }
    remember(true);await enterNotebook();
  }catch{entryFailed();}
  finally{setBusy(false);}
});
$('logout').onclick=()=>{remember(false);location.replace(location.pathname);};
window.addEventListener('pagehide',()=>{$('notebook-app').hidden=true;$('login-screen').hidden=false;});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

if(!globalThis.crypto?.subtle) {
  $('login-error').textContent='HTTPS 주소의 최신 브라우저에서 열어 주세요.';
}else if(remembered()) {
  setBusy(true);enterNotebook().catch(entryFailed).finally(()=>setBusy(false));
}else {
  setBusy(false);
}
