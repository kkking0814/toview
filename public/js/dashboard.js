'use strict';
(async()=>{
    const root=TV.qs('#dashboardCards');
    try{
        const d=await TV.api('/api/dashboard');
        const cards=[['닉네임',d.user.nickname],['미니게임 PICK',`${d.mini.total}회 · 적중 ${d.mini.wins}`],['스포츠 PICK',`${d.sports.total}회 · 적중 ${d.sports.wins}`],['게시글',`${d.posts}개`],['팔로워',`${d.followers}명`],['팔로잉',`${d.following}명`]];
        root.innerHTML=cards.map(([k,v])=>`<section class="card card-body"><span class="muted">${TV.esc(k)}</span><h2>${TV.esc(v)}</h2></section>`).join('');
    }catch(e){root.innerHTML=`<section class="card card-body">${TV.esc(e.message)}</section>`;}
})();
