'use strict';
const {Pool}=require('pg');
const {GAME_CATALOG,validateCatalog}=require('./lib/game-catalog');
const {PROVIDERS}=require('./lib/providers');
validateCatalog();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
function validateNormalized(g,x){if(!x||!Number.isInteger(Number(x.roundNumber))||Number(x.roundNumber)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(String(x.drawDate))||!x.scheduledAt||Number.isNaN(new Date(x.scheduledAt).getTime()))throw new Error(`INVALID_RESULT_CONTRACT:${g.id}`);
if(g.roundsPerDay&&Number(x.roundNumber)>g.roundsPerDay)throw new Error(`INVALID_ROUND:${g.id}`);
const r=x.result||{};
if(g.family==='ladder'){if(!['left','right'].includes(String(r.start).toLowerCase())||![3,4].includes(Number(r.lines))||!['odd','even'].includes(String(r.oddEven).toLowerCase()))throw new Error(`INVALID_LADDER_RESULT:${g.id}`);
}else{if(!Array.isArray(r.numbers)||r.numbers.length===0||r.numbers.some(n=>!Number.isFinite(Number(n))))throw new Error(`INVALID_NUMBER_RESULT:${g.id}`);
}return true;
}
async function fetchJson(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),2500);
try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'TOVIEW-Collector/2.0'}});
if(!r.ok)throw new Error(`HTTP_${r.status}`);
return await r.json();
}finally{clearTimeout(t);
}}
function normalize(g,raw){const x=Array.isArray(raw)?raw[0]:raw;
if(!x)return null;
const roundNumber=Number(x.roundNumber??x.Round??x.round),drawDate=String(x.drawDate??x.Date??'');
let result={};
if(g.family==='ladder')result={start:String(x.start??x.ladder?.start??'').toLowerCase(),lines:Number(x.lines??x.ladder?.lines??0),oddEven:String(x.oddEven??x.ladder?.result??'').toLowerCase()};
else{const nums=x.numbers??x.balls??[x.nBall1,x.nBall2,x.nBall3,x.nBall4,x.nBall5].filter(v=>v!=null).map(Number);
const special=Number(x.specialNumber??x.PowerBall??x.powerBall);
const sum=nums.reduce((a,b)=>a+Number(b||0),0);
result={numbers:nums,specialNumber:Number.isFinite(special)?special:null,sum,oddEven:(sum%2?'odd':'even'),underOver:String(x.underOver??'')};
}return {roundNumber,drawDate,scheduledAt:x.scheduledAt??null,result};
}
async function collect(g){const p=PROVIDERS[g.id];
if(!g.active||!p?.url)return;
const raw=await fetchJson(p.url),n=normalize(g,raw);
validateNormalized(g,n);
const scheduled=new Date(n.scheduledAt);
const c=await pool.connect();
try{await c.query('BEGIN');
const round=await c.query(`INSERT INTO game_rounds(game_id,draw_date,round_number,scheduled_at,status) VALUES($1,$2,$3,$4,'RESULT') ON CONFLICT(game_id,draw_date,round_number) DO UPDATE SET status='RESULT' RETURNING round_id`,[g.id,n.drawDate,n.roundNumber,scheduled]);
const inserted=await c.query(`INSERT INTO game_results(round_id,game_id,draw_date,round_number,scheduled_at,status,result_json,source_received_at,verified_at) VALUES($1,$2,$3,$4,$5,'RESULT',$6,now(),now()) ON CONFLICT(game_id,draw_date,round_number) DO NOTHING RETURNING result_id`,[round.rows[0].round_id,g.id,n.drawDate,n.roundNumber,scheduled,JSON.stringify(n.result)]);
let nextRound=n.roundNumber+1,nextDate=n.drawDate;
if(g.roundsPerDay&&nextRound>g.roundsPerDay){nextRound=1;
const d=new Date(n.drawDate+'T00:00:00Z');
d.setUTCDate(d.getUTCDate()+1);
nextDate=d.toISOString().slice(0,10);
}const nextAt=new Date(scheduled.getTime()+g.cycleSeconds*1000);
await c.query(`INSERT INTO game_rounds(game_id,draw_date,round_number,scheduled_at,status) VALUES($1,$2,$3,$4,'OPEN') ON CONFLICT(game_id,draw_date,round_number) DO NOTHING`,[g.id,nextDate,nextRound,nextAt]);
if(inserted.rowCount)await c.query(`SELECT pg_notify('toview_game_result',$1)`,[JSON.stringify({gameId:g.id,drawDate:n.drawDate,roundNumber:n.roundNumber})]);
await c.query('COMMIT');
}catch(e){await c.query('ROLLBACK');
throw e;
}finally{c.release();
}}
async function tick(){await Promise.allSettled(GAME_CATALOG.map(async g=>{try{await collect(g);
}catch(e){console.error('[collector]',g.id,e.message);
}}));
}
const POLL_MS=Math.max(1000,Number(process.env.COLLECTOR_POLL_MS)||2000);
async function loop(){console.log('TOVIEW collector started');
for(;
;
){const started=Date.now();
await tick();
const wait=Math.max(250,POLL_MS-(Date.now()-started));
await new Promise(r=>setTimeout(r,wait));
}}
loop().catch(e=>{console.error('[collector-fatal]',e);
process.exitCode=1;
});
