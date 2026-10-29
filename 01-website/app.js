import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SESSION_KEY } from './config.js';
import { escapeHTML as e, normalizeText, number, date, isUUID, statusLabel, profileIssue, toCSV, tableHTML, chartHTML } from './utils.js';

const $ = selector => document.querySelector(selector);
const main = $('#main');
let client, session=null, profile=null, documents=[], currentReport=null, adminLogs=[];
let sequence=0, controller=null, checking=false, loggingOut=false, toastTimer, authEventVersion=0, allowSessionEvents=true;
const filters={query:'',status:'all',sort:'newest'};
const profileColumns='id,participant_code,display_name,role,status,expires_at';
const documentColumns='id,slug,title,description,status,version,updated_at';
const route = () => location.hash.slice(1) || '/';
class AccessIssue extends Error {}

function toast(text) { $('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000); }
function loginError(message='') { $('#login-error').textContent=message;$('#login-error').hidden=!message; }
function loginBusy(busy) { $('#login-button').disabled=busy;$('#login-button').firstElementChild.textContent=busy?'Đang đăng nhập…':'Đăng nhập'; }
function safeError(error) {
  if (error instanceof AccessIssue) return error.message;
  if (!navigator.onLine) return 'Thiết bị đang ngoại tuyến. Kết nối Internet rồi thử lại.';
  if (error?.code==='42501') return 'Tài khoản chưa được cấp quyền thực hiện thao tác này.';
  if (error?.status===401 || error?.code==='PGRST301') return 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng xuất và đăng nhập lại.';
  return 'Không thể tải dữ liệu lúc này. Hãy thử lại; nếu lỗi tiếp tục, liên hệ quản trị viên.';
}
function checked(result) { if(result.error) throw result.error;return result.data; }
function cancelLoad() { sequence++;controller?.abort();controller=null; }
function clearPrivateData() { documents=[];currentReport=null;adminLogs=[];profile=null;main.replaceChildren();$('#sidebar-name').textContent='';$('#sidebar-code').textContent='';$('#admin-nav').hidden=true;$('#mobile-admin-nav').hidden=true; }
function showLogin(message='') {
  cancelLoad();clearPrivateData();$('#login-screen').hidden=false;$('#app-screen').hidden=true;
  $('#password').value='';loginBusy(!client);loginError(message);document.title='BÁO CÁO — Đăng nhập';
}
function shell() {
  $('#login-screen').hidden=true;$('#app-screen').hidden=false;
  $('#sidebar-name').textContent=profile?.display_name || 'Thành viên';
  $('#sidebar-code').textContent=profile?.participant_code || '';
  $('#user-avatar').textContent=(profile?.display_name || 'BC').split(/\s+/).filter(Boolean).slice(-2).map(w=>w[0]).join('').toUpperCase();
  const admin=profile?.role==='admin' && !profileIssue(profile);
  $('#admin-nav').hidden=!admin;$('#mobile-admin-nav').hidden=!admin;
  const current=route()==='/admin'?'admin':route()==='/account'?'account':'library';
  document.querySelectorAll('[data-nav]').forEach(el=>{const active=el.dataset.nav===current;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('#breadcrumb').textContent='Không gian làm việc / '+({library:route().startsWith('/report/')?'Báo cáo':'Thư viện',account:'Tài khoản',admin:'Quản trị'}[current]);
}
function empty(title,body,action='') {return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">▤</div><h2>${e(title)}</h2><p>${e(body)}</p>${action}</div>`;}
function renderError(error) {
  documents=[];currentReport=null;adminLogs=[];
  main.innerHTML=empty(error instanceof AccessIssue?'Truy cập chưa được phép':'Chưa thể mở nội dung',safeError(error),'<button class="button yellow" data-action="refresh">Thử lại</button> <a class="button" href="#/account">Tài khoản của tôi</a>');
}
async function queryProfile(signal) {
  const result=await client.from('profiles').select(profileColumns).eq('id',session.user.id).abortSignal(signal).maybeSingle();
  return checked(result);
}
async function loadRoute({preserveScroll=false}={}) {
  if(!session || loggingOut) return;
  cancelLoad();const seq=sequence, target=route(), scroll=preserveScroll?window.scrollY:0;
  const abort=new AbortController();controller=abort;
  currentReport=null;adminLogs=[];main.innerHTML='<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Đang tải không gian của bạn…</div>';
  $('#login-screen').hidden=true;$('#app-screen').hidden=false;
  try {
    const nextProfile=await queryProfile(abort.signal);
    if(seq!==sequence)return;
    profile=nextProfile;shell();
    if(target==='/account'){renderAccount();return;}
    const issue=profileIssue(profile);if(issue) throw new AccessIssue(issue);
    if(target==='/' || target==='') {
      const list=checked(await client.from('documents').select(documentColumns).order('updated_at',{ascending:false}).limit(1000).abortSignal(abort.signal));
      if(seq!==sequence)return;documents=list||[];renderLibrary();
    } else if(target.startsWith('/report/')) {
      const id=target.slice('/report/'.length);
      if(!isUUID(id))throw new AccessIssue('Đường dẫn báo cáo không hợp lệ. Hãy mở báo cáo từ thư viện.');
      const doc=checked(await client.from('documents').select(documentColumns).eq('id',id).abortSignal(abort.signal).maybeSingle());
      if(seq!==sequence)return;
      if(!doc)throw new AccessIssue('Báo cáo không tồn tại hoặc bạn không còn quyền truy cập.');
      const results=await Promise.all([
        client.from('document_sections').select('id,title,section_type,content,sort_order').eq('document_id',id).order('sort_order').limit(200).abortSignal(abort.signal),
        client.from('document_datasets').select('dataset_key,data,schema_version').eq('document_id',id).limit(100).abortSignal(abort.signal)
      ]);
      if(seq!==sequence)return;
      const sections=checked(results[0])||[], datasets=checked(results[1])||[];
      // Recheck the parent after fetching children: a permission may have changed meanwhile.
      const stillAllowed=checked(await client.from('documents').select('id').eq('id',id).abortSignal(abort.signal).maybeSingle());
      if(seq!==sequence)return;if(!stillAllowed)throw new AccessIssue('Quyền xem báo cáo này vừa thay đổi.');
      currentReport=doc;renderReport(doc,sections,datasets);
    } else if(target==='/admin') {
      if(profile.role!=='admin')throw new AccessIssue('Trang này chỉ dành cho quản trị viên.');
      const results=await Promise.all([
        client.from('profiles').select(profileColumns+',created_at').order('created_at',{ascending:false}).limit(500).abortSignal(abort.signal),
        client.from('access_groups').select('id,name').limit(500).abortSignal(abort.signal),
        client.from('admin_actions').select('id,actor_id,action,target_table,occurred_at').order('occurred_at',{ascending:false}).limit(100).abortSignal(abort.signal)
      ]);
      if(seq!==sequence)return;
      const people=checked(results[0])||[],groups=checked(results[1])||[],logs=checked(results[2])||[];
      adminLogs=logs;renderAdmin(people,groups,logs);
    } else {main.innerHTML=empty('Không tìm thấy trang','Đường dẫn này chưa có trong website.','<a class="button yellow" href="#/">Về thư viện</a>');}
    if(seq===sequence)window.scrollTo({top:scroll,behavior:'instant'});
  } catch(error) {
    if(seq!==sequence || abort.signal.aborted)return;
    renderError(error);
  }
}

function pageHeading(label,title,description,actions='') {return `<div class="page-heading"><div><p class="eyebrow">${e(label)}</p><h1>${e(title)}</h1><p>${e(description)}</p></div>${actions?`<div class="heading-actions">${actions}</div>`:''}</div>`;}
function stat(label,value,description='',icon='↗',dateClass='') {return `<div class="stat-card"><div class="stat-label">${e(label)}</div><div class="stat-number ${dateClass}">${e(value)}</div><div class="stat-description">${e(description)}</div><span class="stat-icon" aria-hidden="true">${icon}</span></div>`;}
function renderLibrary() {
  document.title='Thư viện — BÁO CÁO';
  const last=documents.map(d=>d.updated_at).filter(Boolean).sort().at(-1);
  const admin=profile.role==='admin';
  if(!admin && filters.status!=='all')filters.status='all';
  main.innerHTML=pageHeading('KHÁM PHÁ & KẾT NỐI','Thư viện báo cáo','Các báo cáo và dữ liệu dành cho bạn.','<button class="button small" data-action="refresh"><span aria-hidden="true">↻</span> Làm mới</button>')+
    `<div class="hero-band"><div><p class="eyebrow">KHÔNG GIAN RIÊNG CỦA BẠN</p><h2>Mỗi báo cáo,<br>một góc nhìn mới.</h2><p>Khám phá thông tin, theo dõi những con số và tìm thấy điều có ý nghĩa.</p></div><span class="hero-symbol" aria-hidden="true">↗</span></div>`+
    `<div class="stats-grid">${stat('Báo cáo có thể xem',number(documents.length),'Theo quyền truy cập của bạn','▤')}${stat('Đã phát hành',number(documents.filter(d=>d.status==='published').length),'Sẵn sàng để khám phá','◉')}${stat('Cập nhật gần nhất',last?date(last):'Chưa có','Thời gian Việt Nam','↗','date')}</div>`+
    `<div class="library-toolbar"><div class="tabs" role="group" aria-label="Lọc trạng thái"><button class="tab ${filters.status==='all'?'active':''}" data-filter="all" aria-pressed="${filters.status==='all'}">Tất cả <span class="tab-count">${documents.length}</span></button>${admin?['published','draft','archived'].map(s=>`<button class="tab ${filters.status===s?'active':''}" data-filter="${s}" aria-pressed="${filters.status===s}">${e(statusLabel(s))}</button>`).join(''):''}</div><div class="search-tools"><input id="report-search" type="search" placeholder="Tìm kiếm báo cáo…" aria-label="Tìm kiếm báo cáo" value="${e(filters.query)}"><select id="report-sort" aria-label="Sắp xếp báo cáo"><option value="newest" ${filters.sort==='newest'?'selected':''}>Cập nhật mới nhất</option><option value="title" ${filters.sort==='title'?'selected':''}>Tên báo cáo A–Z</option></select></div></div><div id="report-grid" class="report-grid"></div><p id="results-caption" class="results-caption" aria-live="polite"></p>`;
  renderCards();
}
function renderCards() {
  const grid=$('#report-grid');if(!grid)return;
  const q=normalizeText(filters.query);
  const list=documents.filter(d=>(filters.status==='all'||d.status===filters.status)&&normalizeText(d.title+' '+d.description).includes(q));
  list.sort(filters.sort==='title'?(a,b)=>a.title.localeCompare(b.title,'vi'):(a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  grid.innerHTML=list.length?list.map((d,i)=>`<a class="report-card" href="#/report/${e(d.id)}"><div class="card-cover"><span class="cover-index">BC / ${String(i+1).padStart(2,'0')}</span><span class="pill ${['published','draft','archived'].includes(d.status)?d.status:''}">${e(statusLabel(d.status))}</span></div><div class="card-body"><div class="card-label">BÁO CÁO DỮ LIỆU · V${e(d.version)}</div><h3>${e(d.title)}</h3><p>${e(d.description || 'Mở báo cáo để khám phá nội dung và dữ liệu chi tiết.')}</p><div class="card-foot"><span>Cập nhật ${e(date(d.updated_at))}</span><span class="card-arrow" aria-hidden="true">↗</span></div></div></a>`).join(''):empty(documents.length?'Không tìm thấy báo cáo':'Thư viện đang chờ nội dung',documents.length?'Thử từ khóa khác hoặc chọn một trạng thái khác.':profile.role==='admin'?'Báo cáo sẽ xuất hiện khi bạn thêm nội dung. Bạn có thể bắt đầu bằng báo cáo mẫu trong bộ cài đặt.':'Báo cáo sẽ xuất hiện tại đây sau khi quản trị viên cấp quyền cho bạn.');
  $('#results-caption').textContent=list.length?`Hiển thị ${list.length} / ${documents.length} báo cáo có thể truy cập${documents.length===1000?' · Danh sách giới hạn 1.000 báo cáo':''}.`:'';
}
function renderReport(doc,sections,datasets) {
  document.title=doc.title+' — BÁO CÁO';
  const data=new Map(datasets.map(d=>[d.dataset_key,d.data]));
  const content=sections.map(s=>{
    const c=s.content && typeof s.content==='object'?s.content:{};
    const title=s.title?`<h2>${e(s.title)}</h2>`:'';
    const source=c.source?`<p class="section-source">Nguồn: ${e(c.source)}</p>`:'';
    let body;
    if(s.section_type==='heading')body=title;
    else if(s.section_type==='text')body=title+`<div class="body-text">${e(c.body || c.text || '')}</div>`+source;
    else if(s.section_type==='chart')body=`<div class="data-panel">${title}${chartHTML(data.get(c.dataset_key),{...c,title:s.title})}${source}</div>`;
    else if(s.section_type==='table')body=`<div class="data-panel">${title}${tableHTML(data.get(c.dataset_key),c.columns)}${source}</div>`;
    else if(s.section_type==='note' && Array.isArray(c.metrics))body=title+`<div class="kpi-grid">${c.metrics.slice(0,12).map(k=>`<div class="kpi"><div class="stat-label">${e(k.label)}</div><div class="kpi-value">${e(typeof k.value==='number'?number(k.value):k.value)}</div><div class="kpi-unit">${e(k.unit)}</div>${k.detail?`<p>${e(k.detail)}</p>`:''}</div>`).join('')}</div>`;
    else body=`<div class="callout">${s.title?`<h3>${e(s.title)}</h3>`:''}${e(c.body || c.text || '')}</div>`;
    return `<section id="section-${e(s.id)}" class="report-section">${body}</section>`;
  }).join('');
  main.innerHTML=`<a href="#/" class="back-link">← Về thư viện báo cáo</a><div class="report-heading"><p class="eyebrow">BÁO CÁO / GÓC NHÌN DỮ LIỆU</p><h1>${e(doc.title)}</h1><p>${e(doc.description)}</p><div class="report-meta"><span class="pill ${['published','draft','archived'].includes(doc.status)?doc.status:''}">${e(statusLabel(doc.status))}</span><span>Phiên bản ${e(doc.version)}</span><span>Cập nhật ${e(date(doc.updated_at))}</span><span>Người xem: ${e(profile.participant_code)}</span></div></div><div class="reader-layout"><article class="report-content" aria-label="Nội dung báo cáo">${content || empty('Báo cáo đang được chuẩn bị','Báo cáo đã có tên nhưng chưa có phần nội dung.')}<div class="watermark-layer" aria-hidden="true"></div></article><aside class="toc" aria-label="Mục lục"><p class="eyebrow">TRONG BÁO CÁO NÀY</p>${sections.filter(s=>s.title).map(s=>`<a href="#section-${e(s.id)}" data-section="section-${e(s.id)}">${e(s.title)}</a>`).join('') || '<span class="muted">Chưa có mục nội dung</span>'}<div class="reader-stamp">Bản xem dành cho<br><strong>${e(profile.participant_code)}</strong><br>${e(date(new Date().toISOString(),true))}</div></aside></div>`;
  const layer=$('.watermark-layer'), label=profile.participant_code+' · BÁO CÁO';
  const height=$('.report-content').scrollHeight;
  for(let i=0;i<Math.max(12,Math.ceil(height/160)*2);i++){const span=document.createElement('span');span.textContent=label;layer.append(span);}
}
function renderAccount() {
  document.title='Tài khoản — BÁO CÁO';const issue=profileIssue(profile);
  main.innerHTML=pageHeading('THÔNG TIN CÁ NHÂN','Tài khoản của tôi','Thông tin truy cập vào không gian báo cáo.')+`<section class="account-panel"><span class="avatar">${e($('#user-avatar').textContent)}</span><h2>${e(profile?.display_name || 'Thành viên')}</h2><p>${e(session.user.email || '')}</p>${issue?`<div class="notice error">${e(issue)}</div>`:''}<dl class="account-grid"><div class="account-item"><dt>Mã tài khoản</dt><dd>${e(profile?.participant_code || 'Chưa có')}</dd></div><div class="account-item"><dt>Vai trò</dt><dd>${profile?.role==='admin'?'Quản trị viên':'Thành viên'}</dd></div><div class="account-item"><dt>Trạng thái</dt><dd>${e(statusLabel(profile?.status))}</dd></div><div class="account-item"><dt>Thời hạn truy cập</dt><dd>${profile?.expires_at?e(date(profile.expires_at,true)):'Chưa đặt thời hạn'}</dd></div></dl><button class="button" data-action="help">Liên hệ hỗ trợ</button> <button class="button yellow" data-action="logout">Đăng xuất</button></section>`;
}
function renderAdmin(people,groups,logs) {
  document.title='Tổng quan quản trị — BÁO CÁO';
  main.innerHTML=pageHeading('DÀNH CHO QUẢN TRỊ VIÊN','Tổng quan quản trị','Theo dõi tài khoản, nhóm và những thay đổi gần đây.','<button class="button small" data-action="refresh">↻ Làm mới</button>')+
    `<div class="stats-grid">${stat('Tài khoản',number(people.length),'Hồ sơ trong hệ thống','◎')}${stat('Đang hoạt động',number(people.filter(p=>!profileIssue(p)).length),'Còn trong thời hạn truy cập','◉')}${stat('Nhóm quyền',number(groups.length),'Nhóm đã được tạo','▦')}</div><section class="admin-section"><div class="section-title-row"><div><h2>Danh sách tài khoản</h2><p>Thông tin hiện có trong hệ thống.</p></div></div>${tableHTML(people.map(p=>({code:p.participant_code,name:p.display_name||'—',role:p.role==='admin'?'Quản trị viên':'Thành viên',status:profileIssue(p)&&p.status==='active'?'Hết hạn':statusLabel(p.status),expires:p.expires_at?date(p.expires_at):'Không đặt'})),[{key:'code',label:'Mã tài khoản'},{key:'name',label:'Tên hiển thị'},{key:'role',label:'Vai trò'},{key:'status',label:'Trạng thái'},{key:'expires',label:'Hết hạn'}])}</section><section class="admin-section"><div class="section-title-row"><div><h2>Lịch sử thay đổi</h2><p>Tối đa 100 thay đổi gần nhất; chưa bao gồm lượt mở báo cáo.</p></div><button class="button small" data-action="export-logs" ${logs.length?'':'disabled'}>↓ Xuất CSV</button></div>${logs.length?tableHTML(logs.map(l=>({time:date(l.occurred_at,true),action:({insert:'Thêm mới',update:'Cập nhật',delete:'Xóa'}[l.action]||l.action),table:tableLabel(l.target_table),actor:people.find(p=>p.id===l.actor_id)?.participant_code||'Thao tác hệ thống / SQL'})),[{key:'time',label:'Thời gian'},{key:'action',label:'Thao tác'},{key:'table',label:'Đối tượng'},{key:'actor',label:'Nguồn thực hiện'}]):empty('Chưa có thay đổi','Các thay đổi được ghi nhận sẽ xuất hiện tại đây.')}</section>`;
}
function tableLabel(name) {return ({profiles:'Tài khoản',documents:'Báo cáo',access_groups:'Nhóm quyền',group_members:'Thành viên nhóm',group_document_permissions:'Quyền nhóm',user_document_permissions:'Quyền cá nhân',document_sections:'Nội dung báo cáo',document_datasets:'Dữ liệu báo cáo',import_jobs:'Đợt nhập tài khoản'}[name]||name);}

async function verifyAccess() {
  if(!client || !session || checking || loggingOut || controller?.signal.aborted || document.hidden)return;
  const seq=sequence, target=route(), savedReport=currentReport;
  checking=true;const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15000);
  try {
    const p=await queryProfile(abort.signal);if(seq!==sequence)return;
    const issue=profileIssue(p);profile=p;shell();
    if(issue && target!=='/account')throw new AccessIssue(issue);
    if(target==='/admin' && p?.role!=='admin')throw new AccessIssue('Quyền quản trị của tài khoản đã thay đổi.');
    if(savedReport) {
      const d=checked(await client.from('documents').select(documentColumns).eq('id',savedReport.id).abortSignal(abort.signal).maybeSingle());
      if(seq!==sequence)return;
      if(!d)throw new AccessIssue('Bạn không còn quyền xem báo cáo này.');
      if(d.version!==savedReport.version || d.updated_at!==savedReport.updated_at)void loadRoute({preserveScroll:true});
    } else if(target==='/') {
      const list=checked(await client.from('documents').select(documentColumns).order('updated_at',{ascending:false}).limit(1000).abortSignal(abort.signal));
      if(seq!==sequence)return;
      if(JSON.stringify(list)!==JSON.stringify(documents)){documents=list||[];renderLibrary();}
    }
  } catch(error) {if(seq===sequence){cancelLoad();renderError(error);}}
  finally {clearTimeout(timeout);checking=false;}
}
async function logout() {
  if(loggingOut)return;loggingOut=true;allowSessionEvents=false;authEventVersion++;session=null;showLogin();location.hash='/';
  try {const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;}
  catch {await client.auth.stopAutoRefresh();try{sessionStorage.removeItem(SESSION_KEY);}catch{}toast('Đã đóng nội dung trên thiết bị. Hãy đóng thẻ trình duyệt nếu đang dùng máy chung.');}
  finally {loggingOut=false;$('#email').focus();}
}
async function exportLogs() {
  if(profile?.role!=='admin')return;
  const seq=sequence;
  try {
    // Refetch through RLS immediately before export, rather than export stale data.
    const freshProfile=await queryProfile(new AbortController().signal);
    if(seq!==sequence)return;
    if(profileIssue(freshProfile)||freshProfile.role!=='admin')throw new AccessIssue('Bạn không còn quyền xuất nhật ký.');
    const logs=checked(await client.from('admin_actions').select('occurred_at,action,target_table,actor_id').order('occurred_at',{ascending:false}).limit(100));
    if(seq!==sequence)return;
    const csv=toCSV([['Thời gian (Việt Nam)','Thao tác','Đối tượng','ID người thực hiện'],...logs.map(l=>[date(l.occurred_at,true),l.action,l.target_table,l.actor_id||'Hệ thống / SQL'])]);
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='lich-su-thay-doi.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(`Đã xuất ${logs.length} thay đổi gần nhất.`);
  } catch(error){toast(safeError(error));}
}

document.addEventListener('click',event=>{
  const section=event.target.closest('[data-section]');
  if(section){event.preventDefault();document.getElementById(section.dataset.section)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  const filter=event.target.closest('[data-filter]');
  if(filter){filters.status=filter.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===filter);b.setAttribute('aria-pressed',String(b===filter));});renderCards();return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  switch(button.dataset.action){case 'help':$('#help-dialog').showModal();break;case 'close-help':$('#help-dialog').close();break;case 'refresh':void loadRoute({preserveScroll:true});break;case 'logout':void logout();break;case 'export-logs':void exportLogs();break;}
});
document.addEventListener('input',event=>{if(event.target.id==='report-search'){filters.query=event.target.value;renderCards();}});
document.addEventListener('change',event=>{if(event.target.id==='report-sort'){filters.sort=event.target.value;renderCards();}});

document.addEventListener('pointerover',event=>{
  const mark=event.target.closest?.('.chart [data-tooltip]');if(!mark)return;
  const wrap=mark.closest('.chart-wrap'),tip=wrap?.querySelector('.chart-tooltip');if(!tip)return;
  tip.textContent=mark.dataset.tooltip||'';tip.hidden=false;
});
document.addEventListener('pointermove',event=>{
  const mark=event.target.closest?.('.chart [data-tooltip]');if(!mark)return;
  const wrap=mark.closest('.chart-wrap'),tip=wrap?.querySelector('.chart-tooltip');if(!tip||tip.hidden)return;
  const rect=wrap.getBoundingClientRect();let left=event.clientX-rect.left+12,top=event.clientY-rect.top+12;
  if(left+tip.offsetWidth>rect.width)left=Math.max(0,event.clientX-rect.left-tip.offsetWidth-12);
  if(top+tip.offsetHeight>rect.height)top=Math.max(0,event.clientY-rect.top-tip.offsetHeight-8);
  tip.style.left=left+'px';tip.style.top=top+'px';
});
document.addEventListener('pointerout',event=>{
  const mark=event.target.closest?.('.chart [data-tooltip]');if(!mark)return;
  if(event.relatedTarget?.closest?.('.chart [data-tooltip]')===mark)return;
  const tip=mark.closest('.chart-wrap')?.querySelector('.chart-tooltip');if(tip)tip.hidden=true;
});
document.addEventListener('focusin',event=>{const mark=event.target.closest?.('.chart [data-tooltip]');if(!mark)return;const tip=mark.closest('.chart-wrap')?.querySelector('.chart-tooltip');if(tip){tip.textContent=mark.dataset.tooltip||'';tip.hidden=false;tip.style.left='12px';tip.style.top='12px';}});
document.addEventListener('focusout',event=>{if(event.target.closest?.('.chart [data-tooltip]')){const tip=event.target.closest('.chart-wrap')?.querySelector('.chart-tooltip');if(tip)tip.hidden=true;}});
document.addEventListener('change',event=>{
  const select=event.target.closest?.('[data-chart-region]');if(!select)return;
  const wrap=select.closest('.data-panel')?.querySelector('.chart-wrap');if(!wrap)return;
  const region=select.value;wrap.querySelectorAll('.chart [data-tooltip]').forEach(mark=>{const label=mark.dataset.tooltip||'';mark.style.display=region==='all'||label.includes(' · '+region+':')||label.includes(' · '+region+' ·')?'':'none';});
});
$('#password-toggle').addEventListener('click',()=>{const show=$('#password').type==='password';$('#password').type=show?'text':'password';$('#password-toggle').textContent=show?'Ẩn':'Hiện';$('#password-toggle').setAttribute('aria-pressed',String(show));$('#password-toggle').setAttribute('aria-label',show?'Ẩn mật khẩu':'Hiện mật khẩu');});
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!client || loggingOut)return;loginError();loginBusy(true);
  try {
    const {data,error}=await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error)throw error;
    allowSessionEvents=true;
    client.auth.startAutoRefresh();
    $('#password').value='';
    const changed=session?.user.id!==data.session?.user.id;session=data.session;
    if(changed || !profile)void loadRoute();
  } catch(error) {
    const message=error?.code==='invalid_credentials'?'Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.':error?.code==='email_not_confirmed'?'Email chưa được xác nhận. Vui lòng liên hệ quản trị viên.':error?.status===429?'Bạn đã thử nhiều lần. Vui lòng chờ một lát rồi thử lại.':!navigator.onLine?'Thiết bị đang ngoại tuyến. Hãy kiểm tra kết nối Internet.':'Chưa thể đăng nhập. Kiểm tra thông tin hoặc thử lại sau.';
    loginError(message);
  } finally {loginBusy(false);}
});
window.addEventListener('hashchange',()=>{if(session)void loadRoute();});
window.addEventListener('offline',()=>{$('#connection-state').classList.add('offline');$('#connection-state').innerHTML='<i></i> Ngoại tuyến';if(session){cancelLoad();renderError(new Error('offline'));}});
window.addEventListener('online',()=>{$('#connection-state').classList.remove('offline');$('#connection-state').innerHTML='<i></i> Đã kết nối';if(session)void loadRoute({preserveScroll:true});});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void verifyAccess();});
window.addEventListener('pageshow',event=>{if(event.persisted && session)void loadRoute();});
setInterval(()=>void verifyAccess(),30000);

async function boot() {
  try {
    if(!SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL))throw new Error('Invalid public configuration');
    sessionStorage.setItem('bao-cao-storage-check','1');sessionStorage.removeItem('bao-cao-storage-check');
    const {createClient}=await import('./assets/supabase.js');
    const timedFetch=async (url,options={})=>{
      const abort=new AbortController();
      const onAbort=()=>abort.abort();
      if(options.signal?.aborted)abort.abort();
      options.signal?.addEventListener('abort',onAbort,{once:true});
      const timer=setTimeout(()=>abort.abort(),20000);
      try{return await fetch(url,{...options,signal:abort.signal,cache:'no-store'});}
      finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);}
    };
    client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{storage:sessionStorage,storageKey:SESSION_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:timedFetch}});
    client.auth.onAuthStateChange((event,nextSession)=>{
      // Keep this callback synchronous. Do not await another Auth call in it.
      const version=++authEventVersion;
      if(event==='SIGNED_OUT'){session=null;showLogin();return;}
      if(event==='SIGNED_IN' || event==='TOKEN_REFRESHED'){
        setTimeout(()=>{if(loggingOut || !allowSessionEvents || version!==authEventVersion)return;const changed=session?.user.id!==nextSession?.user.id;session=nextSession;if(changed && session)void loadRoute();},0);
      }
    });
    const {data,error}=await client.auth.getSession();if(error)throw error;
    session=data.session;loginBusy(false);
    if(session)void loadRoute();else showLogin();
  } catch(error) {client=null;showLogin('Không thể khởi tạo trang. Hãy mở website qua địa chỉ GitHub Pages và cho phép lưu trữ phiên trong trình duyệt.');$('#login-button').firstElementChild.textContent='Chưa thể kết nối';}
}
void boot();
