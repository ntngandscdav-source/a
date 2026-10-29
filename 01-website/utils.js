export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalizeText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
export const number = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(Number(value)) : '—';
export function date(value, time = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',...(time ? {hour:'2-digit',minute:'2-digit'} : {}),timeZone:'Asia/Ho_Chi_Minh'}).format(d);
}
export const isUUID = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export const statusLabel = status => ({published:'Đã phát hành',draft:'Bản nháp',archived:'Đã lưu trữ',active:'Hoạt động',pending:'Chờ kích hoạt',locked:'Đã khóa',revoked:'Đã thu hồi'}[status] || 'Không xác định');
export function profileIssue(profile) {
  if (!profile) return 'Chưa tìm thấy hồ sơ tài khoản. Vui lòng liên hệ quản trị viên.';
  if (profile.status !== 'active') return ({pending:'Tài khoản đang chờ quản trị viên kích hoạt.',locked:'Tài khoản của bạn đã bị khóa.',revoked:'Quyền truy cập của tài khoản đã được thu hồi.'}[profile.status] || 'Tài khoản chưa được phép truy cập.');
  if (profile.expires_at && new Date(profile.expires_at).getTime() <= Date.now()) return 'Thời hạn truy cập của tài khoản đã kết thúc.';
  return null;
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"','""') + '"';
}
export const toCSV = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
export function tableHTML(rows, columns) {
  if (!Array.isArray(rows) || !rows.length) return '<p class="muted">Chưa có dữ liệu trong bảng này.</p>';
  if (!Array.isArray(columns) || !columns.length) return '<p class="muted">Bảng chưa được cấu hình cột.</p>';
  const cols = columns.slice(0,20).filter(c => c && typeof c.key === 'string');
  return `<div class="table-scroll"><table><thead><tr>${cols.map(c=>`<th scope="col" class="${c.format==='number'?'numeric':''}">${escapeHTML(c.label || c.key)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,1000).map(row=>`<tr>${cols.map(c=>`<td class="${c.format==='number'?'numeric':''}">${escapeHTML(c.format==='number'?number(row?.[c.key]):typeof row?.[c.key]==='object'?JSON.stringify(row[c.key]):row?.[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>1000?'<p class="section-source">Đang hiển thị 1.000 dòng đầu tiên.</p>':''}`;
}
export function chartHTML(rows, config) {
  const source = Array.isArray(rows) ? rows : [];
  const regionKey = config.region_key || ['subregion','region','tiểu vùng','sub_region'].find(k=>source.some(r=>r && Object.prototype.hasOwnProperty.call(r,k)));
  const requestedRegion = config.region_filter || 'all';
  const regions = regionKey ? [...new Set(source.map(r=>String(r?.[regionKey] ?? '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi')) : [];
  const filtered = requestedRegion==='all' || !regionKey ? source : source.filter(r=>String(r?.[regionKey] ?? '')===requestedRegion);
  const points = filtered.slice(0,100).filter(r=>r && r[config.y_key] !== null && r[config.y_key] !== '' && Number.isFinite(Number(r[config.y_key]))).map(r=>({label:String(r[config.x_key] ?? ''),value:Number(r[config.y_key]),region:regionKey?String(r[regionKey]??''):'',raw:r}));
  if (!points.length) return '<p class="muted">Chưa có dữ liệu hợp lệ cho biểu đồ này.</p>';
  const W=760,H=330,left=66,right=20,top=25,bottom=58,plotW=W-left-right,plotH=H-top-bottom;
  const palette=['#e9c94b','#69c6a5','#76a7f7','#e58ab3','#b59af5','#ef956b','#64cbd2','#d5df8a','#f1b94f','#8c9eff'];
  const type=['bar','line','area','pie','donut','scatter'].includes(config.type)?config.type:'bar';
  const rawMax=Math.max(0,...points.map(p=>p.value)),rawMin=Math.min(0,...points.map(p=>p.value));
  const span=rawMax-rawMin || 1, roughStep=span/5, magnitude=10**Math.floor(Math.log10(roughStep));
  const step=([1,2,2.5,5,10].find(v=>v*magnitude>=roughStep)||10)*magnitude;
  const max=Math.ceil(rawMax/step)*step || step, min=rawMin<0?Math.floor(rawMin/step)*step:0;
  const y = v => top+(max-v)/(max-min||1)*plotH;
  const x = i => left+(i+.5)*plotW/points.length;
  const baseline = y(0);
  const ticks = Array.from({length:Math.min(9,Math.round((max-min)/step)+1)},(_,i)=>min+step*i);
  const tip = p => `${p.label}${p.region?' · '+p.region:''}: ${number(p.value)}${config.unit?' '+config.unit:''}`;
  let svg = `<svg class="chart chart-${type}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(config.title || 'Biểu đồ số liệu')}"><title>${escapeHTML(config.title || 'Biểu đồ số liệu')}</title>`;
  if(type==='pie'||type==='donut') {
    const total=points.reduce((a,p)=>a+Math.max(0,p.value),0)||1, cx=285,cy=160,r=112,inner=type==='donut'?65:0; let angle=-Math.PI/2;
    points.forEach((p,i)=>{const value=Math.max(0,p.value),next=angle+value/total*Math.PI*2;const point=(rad,a)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];const [x1,y1]=point(r,angle),[x2,y2]=point(r,next);const large=next-angle>Math.PI?1:0;let d;if(inner){const [ix2,iy2]=point(inner,next),[ix1,iy1]=point(inner,angle);d=`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`;}else d=`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;svg+=`<path class="chart-slice" fill="${palette[i%palette.length]}" d="${d}" data-tooltip="${escapeHTML(tip(p)+' · '+(value/total*100).toFixed(1)+'%')}" tabindex="0"><title>${escapeHTML(tip(p))}</title></path>`;angle=next;});
    svg+=points.map((p,i)=>`<g><circle cx="485" cy="${55+i* Math.min(27,220/Math.max(1,points.length))}" r="5" fill="${palette[i%palette.length]}"/><text x="498" y="${59+i*Math.min(27,220/Math.max(1,points.length))}">${escapeHTML(p.label.length>25?p.label.slice(0,24)+'…':p.label)}</text></g>`).join('');
  } else {
    svg += ticks.map(t=>`<line class="chart-grid" x1="${left}" x2="${W-right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left-12}" y="${y(t)+4}" text-anchor="end">${escapeHTML(number(Math.round(t*100)/100))}</text>`).join('');
    if(type==='line'||type==='area') {
      const path=points.map((p,i)=>`${i?'L':'M'}${x(i)},${y(p.value)}`).join(' ');
      if(type==='area')svg+=`<path class="chart-area" d="${path} L${x(points.length-1)},${baseline} L${x(0)},${baseline} Z" fill="${palette[1]}" opacity=".2"/>`;
      svg+=`<path class="chart-series-line" d="${path}" stroke="${palette[1]}" stroke-width="3" fill="none"/>`;
      svg+=points.map((p,i)=>`<circle class="chart-mark" fill="${palette[(i+1)%palette.length]}" cx="${x(i)}" cy="${y(p.value)}" r="4.5" data-tooltip="${escapeHTML(tip(p))}" tabindex="0"><title>${escapeHTML(tip(p))}</title></circle>`).join('');
    } else if(type==='scatter') {
      svg+=points.map((p,i)=>`<circle class="chart-mark" fill="${palette[i%palette.length]}" cx="${x(i)}" cy="${y(p.value)}" r="6" data-tooltip="${escapeHTML(tip(p))}" tabindex="0"><title>${escapeHTML(tip(p))}</title></circle>`).join('');
    } else {
      const width=Math.min(52,plotW/points.length*.58);
      svg+=points.map((p,i)=>`<rect class="chart-bar" fill="${palette[i%palette.length]}" x="${x(i)-width/2}" y="${Math.min(y(p.value),baseline)}" width="${width}" height="${Math.max(Math.abs(baseline-y(p.value)),1)}" rx="4" data-tooltip="${escapeHTML(tip(p))}" tabindex="0"><title>${escapeHTML(tip(p))}</title></rect>`).join('');
    }
    const stride=Math.max(1,Math.ceil(points.length/12));
    svg+=points.map((p,i)=>({p,i})).filter(o=>o.i%stride===0).map(({p,i})=>`<text x="${x(i)}" y="${H-20}" text-anchor="middle">${escapeHTML(p.label.length>14?p.label.slice(0,13)+'…':p.label)}</text>`).join('');
  }
  svg+='</svg>';
  const regionControl=regions.length>1?`<label class="chart-region-filter">Tiểu vùng <select data-chart-region="${escapeHTML(regionKey)}"><option value="all"${requestedRegion==='all'?' selected':''}>Tất cả tiểu vùng</option>${regions.map(r=>`<option value="${escapeHTML(r)}"${requestedRegion===r?' selected':''}>${escapeHTML(r)}</option>`).join('')}</select></label>`:'';
  const accessible=points.map(p=>`${p.label}${p.region?' ('+p.region+')':''}: ${number(p.value)}`).join('; ');
  return `<div class="chart-toolbar"><div class="chart-unit">${escapeHTML(config.unit ? 'Đơn vị: '+config.unit : '')}</div>${regionControl}</div><div class="chart-wrap" data-chart-type="${type}">${svg}<div class="chart-tooltip" role="status" aria-live="polite" hidden></div></div><details class="chart-details"><summary>Xem số liệu biểu đồ</summary><p class="body-text">${escapeHTML(accessible)}</p></details>`;
}
