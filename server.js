const express=require('express'); const session=require('express-session'); const bcrypt=require('bcryptjs'); const fs=require('fs'); const path=require('path');
const nodemailer = require('nodemailer');
const app=express(); const PORT=process.env.PORT||3000; const dbPath=path.join(__dirname,'data.json');
function db(){try{return JSON.parse(fs.readFileSync(dbPath,'utf8'))}catch{return {users:[],posts:[]}}} function save(x){fs.writeFileSync(dbPath,JSON.stringify(x,null,2))}
const emailCodes = new Map();
const emailRateLimits = new Map();

function createEmailCode(){
    return String(Math.floor(100000 + Math.random() * 900000));
}

const EMAIL_CODE_EXPIRE_MS = 5 * 60 * 1000;
function checkEmailRateLimit(ip){
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const maxRequests = 5;

    let record = emailRateLimits.get(ip);

    if(!record || now - record.startedAt >= windowMs){
        record = {
            startedAt: now,
            count: 0
        };
    }

    if(record.count >= maxRequests){
        const remainingMs = windowMs - (now - record.startedAt);
        const remainingMinutes = Math.ceil(remainingMs / 60000);

        return {
            allowed: false,
            remainingMinutes
        };
    }

    record.count += 1;
    emailRateLimits.set(ip, record);

    return {
        allowed: true
    };
}
const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

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
app.post('/api/email/send-code', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const ip = req.ip;

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                error: '올바른 이메일 주소를 입력해주세요.'
            });
        }
const rateLimit = checkEmailRateLimit(ip);

if(!rateLimit.allowed){
    return res.status(429).json({
        error: `인증번호 요청이 너무 많습니다. 약 ${rateLimit.remainingMinutes}분 후 다시 시도해주세요.`
    });
}
const previous = emailCodes.get(email);

if (previous && Date.now() - previous.sentAt < 60 * 1000) {
    const remaining = Math.ceil(
        (60 * 1000 - (Date.now() - previous.sentAt)) / 1000
    );

    return res.status(429).json({
        error: `인증번호는 ${remaining}초 후 다시 요청할 수 있습니다.`
    });
}
        const d = db();

        // 이미 가입된 이메일인지 확인
        if (d.users.some(u =>
            String(u.email || '').toLowerCase() === email
        )) {
            return res.status(409).json({
                error: '이미 가입된 이메일입니다.'
            });
        }

        const code = createEmailCode();

emailCodes.set(email, {
    code,
    expiresAt: Date.now() + EMAIL_CODE_EXPIRE_MS,
    sentAt: Date.now(),
    attempts: 0,
    verified: false
});

        await mailTransporter.sendMail({
            from: process.env.GMAIL_USER,
            to: email,
            subject: '[TOVIEW] 이메일 인증번호',
            text: `TOVIEW 이메일 인증번호는 ${code} 입니다.\n\n인증번호는 5분 동안 유효합니다.`
        });

        return res.json({
            ok: true
        });

    } catch (error) {
        console.error('이메일 발송 오류:', error);

        return res.status(500).json({
            error: '인증번호 이메일 발송에 실패했습니다.'
        });
    }
});
app.post('/api/email/verify-code', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();

    if (!email || !code) {
        return res.status(400).json({
            error: '이메일과 인증번호를 입력해주세요.'
        });
    }

    const saved = emailCodes.get(email);

    if (!saved) {
        return res.status(400).json({
            error: '인증번호를 먼저 발급받아주세요.'
        });
    }

    if (Date.now() > saved.expiresAt) {
        emailCodes.delete(email);

        return res.status(400).json({
            error: '인증번호가 만료되었습니다. 다시 발급받아주세요.'
        });
    }

if (saved.attempts >= 5) {
    emailCodes.delete(email);

    return res.status(429).json({
        error: '인증번호 입력 횟수를 초과했습니다. 새 인증번호를 발급받아주세요.'
    });
}

if (saved.code !== code) {
    saved.attempts += 1;
    emailCodes.set(email, saved);

    const remaining = 5 - saved.attempts;

    if (remaining <= 0) {
        emailCodes.delete(email);

        return res.status(429).json({
            error: '인증번호 입력 횟수를 초과했습니다. 새 인증번호를 발급받아주세요.'
        });
    }

    return res.status(400).json({
        error: `인증번호가 일치하지 않습니다. ${remaining}회 남았습니다.`
    });
}

    saved.verified = true;

    emailCodes.set(email, saved);

    return res.json({
        ok: true
    });
});
app.get('/api/check-username', (req, res) => {
    const username = String(req.query.username || '').trim();

    if (!validUsername(username)) {
        return res.status(400).json({
            available: false,
            error: '아이디는 영문으로만 5자 이상 입력하고, 같은 영문자를 3번 이상 연속 사용할 수 없습니다.'
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

    if (!validNickname(nickname)) {
        return res.status(400).json({
            available: false,
            error: '닉네임은 완성된 한글로 2글자 이상 입력하고, 같은 글자를 3번 이상 연속 사용할 수 없습니다.'
        });
    }

    const d = db();
    const exists = d.users.some(u => u.nickname === nickname);

    res.json({
        available: !exists
    });
});
function validUsername(username){
    return typeof username === 'string' &&
           /^[A-Za-z]{5,}$/.test(username) &&
           !/([A-Za-z])\1\1/i.test(username);
}

function validPassword(password){
    return typeof password === 'string' &&
           password.length >= 8 &&
           /^[A-Za-z0-9]+$/.test(password) &&
           /[A-Za-z]/.test(password) &&
           /[0-9]/.test(password) &&
           !/(.)\1\1/.test(password);
}

function validNickname(nickname){
    return typeof nickname === 'string' &&
           /^[가-힣]{2,}$/.test(nickname) &&
           !/(.)\1\1/.test(nickname);
}
app.post('/api/register', async (req, res) => {
const { username, password, nickname } = req.body || {};
const email = String(req.body?.email || '').trim().toLowerCase();

if (!validUsername(username)) {
    return res.status(400).json({
        error: '아이디는 영문으로만 5자 이상 입력하고, 같은 영문자를 3번 이상 연속 사용할 수 없습니다.'
    });
}

if (!validPassword(password)) {
    return res.status(400).json({
        error: '비밀번호는 영문과 숫자를 포함해 8자 이상 입력하고, 같은 문자를 3번 이상 연속 사용할 수 없습니다.'
    });
}

if (!validNickname(nickname)) {
    return res.status(400).json({
        error: '닉네임은 완성된 한글로 2글자 이상 입력하고, 같은 글자를 3번 이상 연속 사용할 수 없습니다.'
    });
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
        error: '올바른 이메일 주소가 필요합니다.'
    });
}

const emailAuth = emailCodes.get(email);

if (
    !emailAuth ||
    !emailAuth.verified ||
    Date.now() > emailAuth.expiresAt
) {
    return res.status(403).json({
        error: '이메일 인증을 완료해주세요.'
    });
}
    const d = db();
if (d.users.some(u =>
    String(u.email || '').trim().toLowerCase() === email
)) {
    return res.status(409).json({
        error: '이미 가입된 이메일입니다.'
    });
}

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
    email,
    createdAt: new Date().toISOString()
});

    save(d);
    emailCodes.delete(email);

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
