'use strict';
window.TV={
    async api(url,opt={}){const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});
    let d={};
    try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error?.message||`HTTP ${r.status}`);
    e.code=d.error?.code;
    e.status=r.status;
    throw e}return d.data;
},
qs:s=>document.querySelector(s),qsa:s=>[...document.querySelectorAll(s)],
esc:v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])),
today:()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
return `${y}-${m}-${day}`;
},
gameParam:()=>new URLSearchParams(location.search).get('game')||localStorage.getItem('toviewLastGame')||'dh_randomball',
setGame(id){localStorage.setItem('toviewLastGame',id);
const u=new URL(location.href);
u.searchParams.set('game',id);
history.replaceState({},'',u);
}
};
document.addEventListener('click',e=>{const modal=e.target.closest?.('#moreGames');
if(modal&&e.target===modal)modal.classList.remove('on');
if(e.target.closest?.('[data-close-more]'))document.getElementById('moreGames')?.classList.remove('on');
});
