'use strict';
(async()=>{const tabs=TV.qs('#homeGameTabs'),stage=TV.qs('#homeLiveStage'),recent=TV.qs('#homeRecent'),pattern=TV.qs('#homePattern'),stats=TV.qs('#homeStats');
let catalog=[],currentGame=null,reloadTimer=null;
function scheduleReload(){clearTimeout(reloadTimer);
reloadTimer=setTimeout(()=>currentGame&&load(currentGame),120);
}
async function load(g){currentGame=g;
const id=g.id||g;
try{const [snap,rows,a]=await Promise.all([TV.api(`/api/games/${id}/snapshot`),TV.api(`/api/games/${id}/results?date=${TV.today()}&limit=20`),TV.api(`/api/games/${id}/analysis?days=1`)]);
const last=rows[0],round=snap.currentRound,remaining=round?Math.ceil((new Date(round.scheduled_at).getTime()-Date.now())/1000):null,state=round?(remaining>0?'WAITING':'VERIFYING'):(last?'RESULT':'VERIFYING');
TVAnimation.render(stage,g.family||catalog.find(x=>x.id===id)?.family||'ball',state,state==='RESULT'?last?.result:null);
recent.innerHTML=rows.length?rows.slice(0,5).map(x=>`<div>${x.roundNumber}회 · ${TV.esc(JSON.stringify(x.result))}</div>`).join(''):'<div class="empty">확정 결과 대기 중</div>';
pattern.innerHTML=rows.length?rows.slice(0,10).map(x=>`<span>${x.roundNumber} · ${TV.esc(x.result?.oddEven||x.result?.start||'-')}</span>`).join('<br>'):'<div class="empty">패턴 데이터 대기 중</div>';
stats.innerHTML=`전체 <b>${a.summary.total}</b><br>홀 <b>${a.summary.odd}</b> · 짝 <b>${a.summary.even}</b>`;
}catch{TVAnimation.render(stage,g.family||'ball','VERIFYING');
}}
catalog=await TVGames.mount(tabs,load);
const g=catalog.find(x=>x.id===TV.gameParam())||catalog.find(x=>x.active)||catalog[0];
if(g)await load(g);
const es=new EventSource('/api/events');
es.addEventListener('game-result',e=>{try{const r=JSON.parse(e.data);
if(r.gameId===currentGame?.id){TVAnimation.render(stage,currentGame.family,'RESULT',r.result);
clearTimeout(reloadTimer);
reloadTimer=setTimeout(()=>load(currentGame),2500);
}}catch{}});
window.addEventListener('pagehide',()=>{es.close();
clearTimeout(reloadTimer);
},{once:true});
})();
