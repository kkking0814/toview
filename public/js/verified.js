'use strict';
(async()=>{const el=TV.qs('#verifiedList');
try{const rows=await TV.api('/api/verified');
el.innerHTML=rows.map(x=>`<div class="card simple-item"><h3>${TV.esc(x.name)}</h3><span class="status-pill">${TV.esc(x.status)}</span><p>보증/제휴기간 ${TV.esc(x.guarantee_period||'-')}</p><p>최근 확인 ${TV.esc(x.last_reviewed_at||'-')} · 평가 ${x.rating??'-'}</p>${x.url?`<a class="btn primary" target="_blank" rel="noopener noreferrer" href="${TV.esc(x.url)}">바로가기</a>`:''}</div>`).join('')||'<div class="empty">등록된 보증업체가 없습니다.</div>';}catch{el.innerHTML='<div class="empty">보증업체 정보를 불러오지 못했습니다.</div>';}})();
