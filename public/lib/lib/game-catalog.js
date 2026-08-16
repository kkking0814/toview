'use strict';
const GAME_CATALOG = Object.freeze([
{id:'dh_randomball',name:'동행파워볼(랜덤볼)',family:'ball',cycleSeconds:300,roundsPerDay:288,displayGroup:'primary',renderer:'ball',active:true},
{id:'dh_speedkeno',name:'동행스피드키노',family:'keno',cycleSeconds:300,roundsPerDay:288,displayGroup:'primary',renderer:'keno',active:true},
{id:'speedkeno_ladder',name:'스피드키노사다리',family:'ladder',cycleSeconds:300,roundsPerDay:288,displayGroup:'primary',renderer:'ladder',active:true},
{id:'bubble_powerball',name:'보글파워볼',family:'ball',cycleSeconds:120,roundsPerDay:720,displayGroup:'primary',renderer:'ball',active:true},
{id:'bubble_ladder',name:'보글사다리',family:'ladder',cycleSeconds:180,roundsPerDay:480,displayGroup:'primary',renderer:'ladder',active:true},
{id:'entry_powerball',name:'엔트리파워볼',family:'ball',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'ball',active:false},
{id:'entry_powerladder',name:'엔트리파워사다리',family:'ladder',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'ladder',active:false},
{id:'entry_kenoladder',name:'엔트리키노사다리',family:'ladder',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'ladder',active:false},
{id:'entry_speedkeno',name:'엔트리스피드키노',family:'keno',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'keno',active:false},
{id:'named_powerball',name:'네임드파워볼',family:'ball',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'ball',active:false},
{id:'named_powerladder',name:'네임드파워사다리',family:'ladder',cycleSeconds:300,roundsPerDay:288,displayGroup:'more',renderer:'ladder',active:false}
]);
function validateCatalog(){
    const ids=new Set();
    const validFamilies=new Set(['ball','keno','ladder']);
    for(const g of GAME_CATALOG){
        if(!/^[a-z0-9_]+$/.test(g.id)) throw new Error(`INVALID_GAME_ID:${g.id}`);
        if(ids.has(g.id)) throw new Error(`DUPLICATE_GAME_ID:${g.id}`);
        ids.add(g.id);
        if(!g.name || !validFamilies.has(g.family) || !Number.isInteger(g.cycleSeconds) || g.cycleSeconds<30) throw new Error(`INVALID_GAME_META:${g.id}`);
        if(g.renderer!==g.family && !(g.family==='ball'&&g.renderer==='ball')) throw new Error(`INVALID_RENDERER:${g.id}`);
    }
    return true;
}
function publicCatalog(){return GAME_CATALOG.map(({id,name,family,cycleSeconds,roundsPerDay,displayGroup,renderer,active})=>({id,name,family,cycleSeconds,roundsPerDay,displayGroup,renderer,active}));
}
function gameById(id){return GAME_CATALOG.find(g=>g.id===id)||null;
}
module.exports={GAME_CATALOG,validateCatalog,publicCatalog,gameById};
