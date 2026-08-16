'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
let pass=0,fail=0;
function check(name,ok){if(ok){pass++;console.log('PASS',name)}else{fail++;console.error('FAIL',name)}}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(root).filter(f=>!f.includes('node_modules'));
for(const f of files.filter(f=>/\.js$/.test(f))){try{cp.execFileSync(process.execPath,['--check',f],{stdio:'ignore'});check('syntax '+path.relative(root,f),true)}catch{check('syntax '+path.relative(root,f),false)}}
const htmls=files.filter(f=>/\.html$/.test(f));
for(const f of htmls){const t=fs.readFileSync(f,'utf8');const ids=[...t.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);check('unique ids '+path.basename(f),ids.length===new Set(ids).size);for(const m of t.matchAll(/(?:src|href)="((?:js|css)\/[^"?#]+)"/g)){check('asset '+path.basename(f)+' '+m[1],fs.existsSync(path.join(path.dirname(f),m[1])))}}
const catalog=require(path.join(root,'lib/game-catalog.js')).GAME_CATALOG;check('11 games',catalog.length===11);check('5 primary',catalog.filter(g=>g.displayGroup==='primary').length===5);check('6 more',catalog.filter(g=>g.displayGroup==='more').length===6);check('game ids unique',new Set(catalog.map(g=>g.id)).size===11);
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');check('resend configured',server.includes('RESEND_API_KEY')&&server.includes('api.resend.com/emails'));check('idle 10 minutes',server.includes('IDLE_MS=600000'));check('protected pages',server.includes('PROTECTED_PAGES'));check('dashboard api',server.includes("'/api/dashboard'"));check('ranking api',server.includes("'/api/rankings'"));check('comment api',server.includes("'/api/community/posts/:id/comments'"));check('no legacy /api/results',!server.includes("app.get('/api/results'"));check('no bepick parser',!server.includes('bepick.net/game/'));
const gamesUI=fs.readFileSync(path.join(root,'public/js/games-ui.js'),'utf8');check('more inline panel',gamesUI.includes('game-more-panel'));check('more closes after selection',gamesUI.includes('closeMore();'));check('more not modal',!gamesUI.includes('moreGames'));
const home=fs.readFileSync(path.join(root,'public/index.html'),'utf8');check('home 2:1:1 data',home.includes('home-data'));check('left partner rail',home.includes('home-left-rail'));check('right partner rail',home.includes('home-right-rail'));check('mid split ads',home.includes('HOME_MID_A')&&home.includes('HOME_MID_B'));
console.log(`RESULT PASS=${pass} FAIL=${fail}`);process.exit(fail?1:0);
