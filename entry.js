// Login settings are verified by the API. GitHub-hosted library files are public.
const API='https://beauty-blossom-prompt-auth.beautyblossom.workers.dev';
const sessionKey='beauty-blossom-prompt-session-v2';
const $=id=>document.getElementById(id);
let token='',role='',busy=false,adminMode=false,started=false,adminBusy=false,adminVersion=null,checking=false,adminLoad=0;
let suspendNotebook=()=>{};
try{sessionStorage.removeItem('beauty-blossom-prompt-entry-v1');token=sessionStorage.getItem(sessionKey)||'';}catch{}
function remember(value) {
  token=value;
  try{if(value)sessionStorage.setItem(sessionKey,value);else sessionStorage.removeItem(sessionKey);}catch{}
}
async function api(path,body,auth=token) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const headers={};if(auth)headers.Authorization='Bearer '+auth;if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(API+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',signal:controller.signal});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'요청을 처리하지 못했습니다.');error.status=response.status;throw error;}
    return data;
  }catch(error){if(error.status)throw error;throw new Error('로그인 서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');}
  finally{clearTimeout(timer);}
}
function setBusy(value) {
  busy=value;$('login-submit').disabled=value;$('login-mode').disabled=value;
  $('login-submit').textContent=value?'확인 중…':'로그인';$('login-form').setAttribute('aria-busy',String(value));
}
function lock(message='') {
  remember('');role='';adminVersion=null;adminLoad++;
  suspendNotebook();
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  $('admin-form').reset();$('login-form').reset();$('notebook-app').hidden=true;$('login-screen').hidden=false;
  $('admin-open').hidden=true;$('login-error').textContent=message;
  document.title='로그인 · 뷰티블라썸 프롬프트 노트';$('login-id').focus();
}
async function enterNotebook(account) {
  const notebook=await import('./app.js?v=notebook-5');suspendNotebook=notebook.suspendNotebook;
  role=account.role;$('login-form').reset();$('login-screen').hidden=true;$('notebook-app').hidden=false;
  $('admin-open').hidden=role!=='admin';document.title='프롬프트 노트 · 뷰티블라썸';
  if(!started){started=true;notebook.startNotebook();}$('search').focus();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;setBusy(true);$('login-error').textContent='';
  $('login-id').removeAttribute('aria-invalid');$('login-password').removeAttribute('aria-invalid');
  try {
    const account=await api('/login',{username:$('login-id').value,password:$('login-password').value},'');
    remember(account.token);await enterNotebook(account);
  }catch(error){
    $('login-error').textContent=error.message;
    if(error.status===401||error.status===400){$('login-id').setAttribute('aria-invalid','true');$('login-password').setAttribute('aria-invalid','true');$('login-password').focus();$('login-password').select();}
  }finally{setBusy(false);}
});
$('login-mode').onclick=()=>{
  adminMode=!adminMode;$('login-title').textContent=adminMode?'관리자 로그인':'프롬프트 노트';
  $('login-mode').textContent=adminMode?'팀원 로그인으로':'관리자 로그인';
  $('login-id').value=adminMode?'관리자':'뷰티블라썸';$('login-password').value='';$('login-error').textContent='';
  $('login-id').removeAttribute('aria-invalid');$('login-password').removeAttribute('aria-invalid');$('login-password').focus();
};
$('logout').onclick=async()=>{
  const previous=token;lock();
  try{await api('/logout',{},previous);}catch{if(!token)$('login-error').textContent='이 브라우저에서 로그아웃했습니다. 서버 연결은 확인하지 못했습니다.';}
};
async function checkSession() {
  if(!token||checking||busy||document.hidden)return;
  checking=true;const current=token;
  try{await api('/session');}
  catch(error){if(token===current&&error.status===401)lock(error.message);}
  finally{checking=false;}
}
setInterval(()=>{void checkSession();},60000);
document.addEventListener('visibilitychange',()=>{void checkSession();});
window.addEventListener('pagehide',()=>{$('notebook-app').hidden=true;$('login-screen').hidden=false;});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
function adminMessage(text,success=false){$('admin-message').textContent=text;$('admin-message').classList.toggle('success',success);}
$('admin-open').onclick=async()=>{
  if(role!=='admin'||adminBusy)return;
  const request=++adminLoad;
  $('admin-form').reset();adminVersion=null;$('admin-save').disabled=true;adminMessage('설정을 불러오는 중…');$('admin-dialog').showModal();
  try {
    const data=await api('/admin/password');
    if(request!==adminLoad||!$('admin-dialog').open)return;
    adminVersion=data.team.version;$('team-username').value=data.team.username;$('admin-save').disabled=false;adminMessage('');$('admin-password').focus();
  }catch(error){if(request===adminLoad){if(error.status===401)lock(error.message);else adminMessage(error.message);}}
};
function closeAdmin(){if(adminBusy)return;adminLoad++;$('admin-dialog').close();$('admin-form').reset();adminVersion=null;}
$('admin-close').onclick=closeAdmin;
$('admin-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAdmin();});
$('admin-form').addEventListener('submit',async event=>{
  event.preventDefault();if(adminBusy||adminVersion===null)return;
  const password=$('new-password').value;
  if(password!==$('confirm-password').value){adminMessage('새 비밀번호가 서로 다릅니다.');$('confirm-password').focus();return;}
  if(!password.trim()){adminMessage('공백만으로 된 비밀번호는 사용할 수 없습니다.');return;}
  adminBusy=true;$('admin-save').disabled=true;$('admin-close').disabled=true;$('admin-save').textContent='변경 중…';
  $('admin-form').setAttribute('aria-busy','true');adminMessage('');
  try {
    const data=await api('/admin/password',{adminPassword:$('admin-password').value,newPassword:password,version:adminVersion});
    adminVersion=data.team.version;$('admin-form').reset();$('team-username').value=data.team.username;
    adminMessage('팀원 비밀번호를 변경했습니다. 모든 팀원에게 새 비밀번호가 적용됩니다.',true);
  }catch(error){if(error.status===401)lock(error.message);else adminMessage(error.message);if(error.status===409)adminVersion=null;}
  finally{adminBusy=false;$('admin-save').disabled=adminVersion===null;$('admin-close').disabled=false;$('admin-save').textContent='팀원 비밀번호 변경';$('admin-form').setAttribute('aria-busy','false');}
});
setBusy(true);
if(token) {
  api('/session').then(enterNotebook).catch(error=>lock(error.message)).finally(()=>setBusy(false));
}else setBusy(false);
