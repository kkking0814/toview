'use strict';
(async()=>{const el=TV.qs('#adminStatus');
try{const s=await TV.api('/api/admin/status');
el.innerHTML=`<div class="card simple-item"><h3>SSE 접속</h3><b>${s.sseClients}</b></div>`+s.games.map(g=>`<div class="card simple-item"><h3>${TV.esc(g.game_id)}</h3><p>마지막 결과 ${g.last_result_at?new Date(g.last_result_at).toLocaleString('ko-KR'):'없음'}</p></div>`).join('');
}catch(e){el.innerHTML='<div class="empty">관리자 권한 또는 상태를 확인해 주세요.</div>';
}})();
