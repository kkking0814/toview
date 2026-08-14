const express=require('express'); const session=require('express-session'); const bcrypt=require('bcryptjs'); const fs=require('fs'); const path=require('path');
const app=express(); const PORT=process.env.PORT||3000; const dbPath=path.join(__dirname,'data.json');
function db(){try{return JSON.parse(fs.readFileSync(dbPath,'utf8'))}catch{return {users:[],posts:[]}}} function save(x){fs.writeFileSync(dbPath,JSON.stringify(x,null,2))}
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: true,
    sameSite: 'lax'
  }
}));
app.get('/api/check-username', (req, res) => {
    const username = String(req.query.username || '').trim();

    if (!username) {
        return res.status(400).json({
            available: false,
            error: '아이디를 입력해주세요.'
        });
    }

    const d = db();
    const exists = d.users.some(u => u.username === username);

    res.json({
        available: !exists
    });
});

app.get('/api/check-nickname', (req, res) => {
    const nickname = String(req.query.nickname || '').trim();

    if (!nickname) {
        return res.status(400).json({
            available: false,
            error: '닉네임을 입력해주세요.'
        });
    }

    const d = db();
    const exists = d.users.some(u => u.nickname === nickname);

    res.json({
        available: !exists
    });
});
app.post('/api/register', async (req, res) => {
    const { username, password, nickname } = req.body || {};

    if (!username || !password || !nickname || password.length < 6) {
        return res.status(400).json({
            error: '아이디, 닉네임, 6자 이상 비밀번호가 필요합니다.'
        });
    }

    const d = db();

    // 아이디 중복 최종 검사
    if (d.users.some(u => u.username === username)) {
        return res.status(409).json({
            error: '이미 존재하는 아이디입니다.'
        });
    }

    // 닉네임 중복 최종 검사
    if (d.users.some(u => u.nickname === nickname)) {
        return res.status(409).json({
            error: '이미 존재하는 닉네임입니다.'
        });
    }

    // 회원 저장
    d.users.push({
        username,
        password: await bcrypt.hash(password, 10),
        nickname,
        createdAt: new Date().toISOString()
    });

    save(d);

    req.session.user = username;

    res.json({
        ok: true,
        username,
        nickname
    });
});
app.post('/api/login',async(req,res)=>{let {username,password}=req.body||{};let u=db().users.find(x=>x.username===username);if(!u||!(await bcrypt.compare(password||'',u.password)))return res.status(401).json({error:'아이디 또는 비밀번호가 올바르지 않습니다.'});req.session.user=username;res.json({ok:true,username})});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me', (req, res) => {
    if (!req.session.user) {
        return res.json({
            username: null,
            nickname: null
        });
    }

    const d = db();
    const user = d.users.find(u => u.username === req.session.user);

    res.json({
        username: req.session.user,
        nickname: user?.nickname || req.session.user
    });
});
app.get('/api/posts',(req,res)=>res.json(db().posts.slice().reverse()));
app.post('/api/posts',(req,res)=>{if(!req.session.user)return res.status(401).json({error:'로그인이 필요합니다.'});let {title,content,board='자유게시판'}=req.body||{};if(!title||!content)return res.status(400).json({error:'제목과 내용을 입력하세요.'});let d=db();let p={id:Date.now(),title,content,board,author:req.session.user,createdAt:new Date().toISOString()};d.posts.push(p);save(d);res.json(p)});
app.get('/api/results',async(req,res)=>{try{let r=await fetch('https://api.bepick.io/eth/get/'); if(!r.ok)throw Error('upstream');res.type('json').send(await r.text())}catch(e){res.status(502).json({error:'외부 결과 API 연결 실패'})}});
app.use(express.static(path.join(__dirname,'public'))); app.listen(PORT,()=>console.log(`TOVIEW http://localhost:${PORT}`));
