const express=require('express'); const session=require('express-session'); const bcrypt=require('bcryptjs'); const fs=require('fs'); const path=require('path');

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const app=express(); const PORT=process.env.PORT||3000; const dbPath=path.join(__dirname,'data.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function db(){try{return JSON.parse(fs.readFileSync(dbPath,'utf8'))}catch{return {users:[],posts:[]}}} 
function save(x){fs.writeFileSync(dbPath,JSON.stringify(x,null,2))}

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

const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
    },     
    body: JSON.stringify({
        from: 'TOVIEW <onboarding@resend.dev>',
        to: [email],
        subject: '[TOVIEW] 이메일 인증번호',
        text: `TOVIEW 이메일 인증번호는 ${code} 입니다.\n\n인증번호는 5분 동안 유효합니다.`
    })
});

const resendData = await resendResponse.json();

if (!resendResponse.ok) {
    console.error('RESEND ERROR:', resendData);

    emailCodes.delete(email);

    return res.status(500).json({
        error: '인증번호 이메일 발송에 실패했습니다.'
    });
}

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
    try {
        const { username, password, nickname } = req.body || {};
        const email = String(req.body?.email || '').trim().toLowerCase();

        // 아이디 검사
        if (!validUsername(username)) {
            return res.status(400).json({
                error: '아이디는 영문으로만 5자 이상 입력하고, 같은 영문자를 3번 이상 연속 사용할 수 없습니다.'
            });
        }

        // 비밀번호 검사
        if (!validPassword(password)) {
            return res.status(400).json({
                error: '비밀번호는 영문과 숫자를 포함해 8자 이상 입력하고, 같은 문자를 3번 이상 연속 사용할 수 없습니다.'
            });
        }

        // 닉네임 검사
        if (!validNickname(nickname)) {
            return res.status(400).json({
                error: '닉네임은 완성된 한글로 2글자 이상 입력하고, 같은 글자를 3번 이상 연속 사용할 수 없습니다.'
            });
        }

        // 이메일 검사
        if (
            !email ||
            !email.includes('@') ||
            email.startsWith('@') ||
            email.endsWith('@') ||
            !email.substring(email.indexOf('@') + 1).includes('.')
        ) {
            return res.status(400).json({
                error: '올바른 이메일 주소가 필요합니다.'
            });
        }

        // 이메일 인증 여부 확인
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

        // Neon에서 중복 회원 확인
        const duplicate = await pool.query(
            `
            SELECT username, nickname, email
            FROM users
            WHERE username = $1
               OR nickname = $2
               OR LOWER(email) = LOWER($3)
            `,
            [username, nickname, email]
        );

        if (duplicate.rows.length > 0) {
            const users = duplicate.rows;

            if (users.some(u => u.username === username)) {
                return res.status(409).json({
                    error: '이미 존재하는 아이디입니다.'
                });
            }

            if (users.some(u => u.nickname === nickname)) {
                return res.status(409).json({
                    error: '이미 존재하는 닉네임입니다.'
                });
            }

            if (users.some(u =>
                String(u.email).toLowerCase() === email
            )) {
                return res.status(409).json({
                    error: '이미 가입된 이메일입니다.'
                });
            }
        }

        // 비밀번호 암호화
        const hashedPassword = await bcrypt.hash(password, 10);

        // ★ Neon DB에 실제 회원 저장
        await pool.query(
            `
            INSERT INTO users
                (username, password, nickname, email)
            VALUES
                ($1, $2, $3, $4)
            `,
            [
                username,
                hashedPassword,
                nickname,
                email
            ]
        );

        // 사용한 이메일 인증정보 삭제
        emailCodes.delete(email);

        // 가입과 동시에 로그인 세션 생성
        req.session.user = username;

        console.log('Neon 회원가입 성공:', username);

        return res.json({
            ok: true,
            username,
            nickname
        });

    } catch (error) {
        console.error('회원가입 Neon DB 오류:', error);

        // DB UNIQUE 중복 오류
        if (error.code === '23505') {
            return res.status(409).json({
                error: '이미 사용 중인 회원정보입니다.'
            });
        }

        return res.status(500).json({
            error: '회원가입 처리 중 오류가 발생했습니다.'
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');

        if (!username || !password) {
            return res.status(400).json({
                error: '아이디와 비밀번호를 입력해주세요.'
            });
        }

        // Neon DB에서 회원 찾기
        const result = await pool.query(
            `
            SELECT
                username,
                password,
                nickname,
                email
            FROM users
            WHERE username = $1
            LIMIT 1
            `,
            [username]
        );

        const user = result.rows[0];

        // 아이디 없음
        if (!user) {
            console.log('로그인 실패: 존재하지 않는 아이디');

            return res.status(401).json({
                error: '아이디 또는 비밀번호가 올바르지 않습니다.'
            });
        }

        // 비밀번호 확인
        const passwordOK = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordOK) {
            console.log('로그인 실패: 비밀번호 불일치');

            return res.status(401).json({
                error: '아이디 또는 비밀번호가 올바르지 않습니다.'
            });
        }

        // 로그인 세션 저장
        req.session.user = user.username;

        console.log('로그인 성공:', user.username);

        return res.json({
            ok: true,
            username: user.username,
            nickname: user.nickname
        });

    } catch (error) {
        console.error('로그인 DB 오류:', error);

        return res.status(500).json({
            error: '로그인 처리 중 오류가 발생했습니다.'
        });
    }
});

app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me', async (req, res) => {
    try {

        // 로그인하지 않은 상태
        if (!req.session.user) {
            return res.json({
                username: null,
                nickname: null
            });
        }

        // Neon에서 현재 로그인 회원 찾기
        const result = await pool.query(
            `SELECT username, nickname
             FROM users
             WHERE username = $1
             LIMIT 1`,
            [req.session.user]
        );

        const user = result.rows[0];

        // DB에 회원이 없는 경우
        if (!user) {
            req.session.user = null;

            return res.json({
                username: null,
                nickname: null
            });
        }

        // 회원정보 반환
        return res.json({
            username: user.username,
            nickname: user.nickname
        });

    } catch (error) {

        console.error('회원정보 조회 DB 오류:', error);

        return res.status(500).json({
            error: '회원정보를 불러오지 못했습니다.'
        });
    }
});

app.use(express.static(path.join(__dirname,'public')));

// ========================================
// 게시글 목록 - Neon DB
// ========================================

app.get('/api/posts', async (req, res) => {
    try {

        const board = String(req.query.board || '').trim();

        let result;

        if (board) {

            result = await pool.query(
                `
                SELECT
                    p.id,
                    p.board,
                    p.title,
                    p.content,
                    p.username,
                    u.nickname,
                    p.views,
                    p.likes,
                    p.created_at
                FROM posts p
                JOIN users u
                    ON u.username = p.username
                WHERE p.board = $1
                ORDER BY p.created_at DESC
                `,
                [board]
            );

        } else {

            result = await pool.query(
                `
                SELECT
                    p.id,
                    p.board,
                    p.title,
                    p.content,
                    p.username,
                    u.nickname,
                    p.views,
                    p.likes,
                    p.created_at
                FROM posts p
                JOIN users u
                    ON u.username = p.username
                ORDER BY p.created_at DESC
                `
            );

        }

        const posts = result.rows.map(post => ({
            id: post.id,
            board: post.board,
            title: post.title,
            content: post.content,

            username: post.username,
            nickname: post.nickname,

            views: post.views,
            likes: post.likes,

            createdAt: post.created_at
        }));

        return res.json({
            ok: true,
            posts
        });

    } catch (error) {

        console.error('게시글 목록 DB 오류:', error);

        return res.status(500).json({
            error: '게시글을 불러오지 못했습니다.'
        });
    }
});


// ========================================
// 게시글 작성 - Neon DB
// ========================================

app.post('/api/posts', async (req, res) => {
    try {

        // 로그인 확인
        if (!req.session.user) {
            return res.status(401).json({
                error: '로그인이 필요합니다.'
            });
        }

        const board =
            String(req.body?.board || '자유게시판').trim();

        const title =
            String(req.body?.title || '').trim();

        const content =
            String(req.body?.content || '').trim();


        // 제목 확인
        if (!title) {
            return res.status(400).json({
                error: '제목을 입력해주세요.'
            });
        }


        // 내용 확인
        if (!content) {
            return res.status(400).json({
                error: '내용을 입력해주세요.'
            });
        }


        // 제목 최대 100자
        if (title.length > 100) {
            return res.status(400).json({
                error: '제목은 100자 이하로 입력해주세요.'
            });
        }


        // 허용 게시판
        const allowedBoards = [
            '자유게시판',
            '분석게시판'
        ];

        if (!allowedBoards.includes(board)) {
            return res.status(400).json({
                error: '올바르지 않은 게시판입니다.'
            });
        }


        // 현재 로그인 회원이 실제 Neon에 있는지 확인
        const userResult = await pool.query(
            `
            SELECT username, nickname
            FROM users
            WHERE username = $1
            LIMIT 1
            `,
            [req.session.user]
        );

        const user = userResult.rows[0];


        if (!user) {
            return res.status(401).json({
                error: '사용자 정보를 찾을 수 없습니다.'
            });
        }


        // Neon posts 테이블에 글 저장
        const result = await pool.query(
            `
            INSERT INTO posts
                (board, title, content, username)
            VALUES
                ($1, $2, $3, $4)

            RETURNING
                id,
                board,
                title,
                content,
                username,
                views,
                likes,
                created_at
            `,
            [
                board,
                title,
                content,
                user.username
            ]
        );


        const saved = result.rows[0];


        return res.json({
            ok: true,

            post: {
                id: saved.id,
                board: saved.board,
                title: saved.title,
                content: saved.content,

                username: saved.username,
                nickname: user.nickname,

                views: saved.views,
                likes: saved.likes,

                createdAt: saved.created_at
            }
        });


    } catch (error) {

        console.error('게시글 작성 DB 오류:', error);

        return res.status(500).json({
            error: '게시글 등록 중 오류가 발생했습니다.'
        });
    }
});

app.get('/api/db-test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS now');

        res.json({
            ok: true,
            message: 'Neon DB 연결 성공',
            time: result.rows[0].now
        });

    } catch (error) {
        console.error('NEON DB ERROR:', error);

        res.status(500).json({
            ok: false,
            message: 'Neon DB 연결 실패'
        });
    }
});

// ========================================
// TOVIEW 공용 실시간 채팅
// ========================================


// 최근 채팅 불러오기
app.get('/api/chat', async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                c.id,
                c.username,
                c.nickname,
                c.message,
                c.created_at
            FROM chat_messages c
            ORDER BY c.created_at DESC
            LIMIT 100
        `);

        // DB에서는 최신순으로 가져오고
        // 화면에는 오래된 글 → 최신 글 순서로 전달
        const messages = result.rows.reverse();

        return res.json({
            ok: true,
            messages
        });

    } catch (error) {

        console.error('채팅 불러오기 DB 오류:', error);

        return res.status(500).json({
            error: '채팅을 불러오지 못했습니다.'
        });

    }

});


// ========================================
// 채팅 전송
// ========================================

app.post('/api/chat', async (req, res) => {

    try {

        // 로그인 확인
        if (!req.session || !req.session.user) {

            return res.status(401).json({
                error: '로그인이 필요합니다.'
            });

        }


        const username = req.session.user;

        const message =
            String(req.body?.message || '').trim();


        // 빈 메시지 방지
        if (!message) {

            return res.status(400).json({
                error: '메시지를 입력해주세요.'
            });

        }


        // 너무 긴 메시지 방지
        if (message.length > 200) {

            return res.status(400).json({
                error: '메시지는 200자 이하로 입력해주세요.'
            });

        }


        // 현재 로그인 회원의 닉네임을 DB에서 직접 가져옴
        const userResult = await pool.query(
            `
            SELECT username, nickname
            FROM users
            WHERE username = $1
            LIMIT 1
            `,
            [username]
        );


        if (userResult.rows.length === 0) {

            return res.status(401).json({
                error: '회원 정보를 찾을 수 없습니다.'
            });

        }


        const nickname =
            userResult.rows[0].nickname;


        // 채팅 저장
        const result = await pool.query(
            `
            INSERT INTO chat_messages
                (username, nickname, message)
            VALUES
                ($1, $2, $3)
            RETURNING
                id,
                username,
                nickname,
                message,
                created_at
            `,
            [
                username,
                nickname,
                message
            ]
        );


        return res.json({
            ok: true,
            message: result.rows[0]
        });


    } catch (error) {

        console.error('채팅 전송 DB 오류:', error);

        return res.status(500).json({
            error: '채팅 전송에 실패했습니다.'
        });

    }

});

// ========================================
// TOVIEW MEMBER PICK 등록
// ========================================

app.post('/api/picks', async (req, res) => {

    try {

        // 로그인 확인
        if (!req.session || !req.session.user) {

            return res.status(401).json({
                error: '로그인이 필요합니다.'
            });

        }


        const username = req.session.user;

        const roundNumber =
            Number(req.body?.roundNumber);

        const oddEven =
            String(req.body?.oddEven || '').trim();

        const underOver =
            String(req.body?.underOver || '').trim();


        // 회차 확인
        if (
            !Number.isInteger(roundNumber) ||
            roundNumber <= 0
        ) {

            return res.status(400).json({
                error: '올바른 회차가 아닙니다.'
            });

        }


        // 홀짝 값 확인
        if (
            oddEven !== 'odd' &&
            oddEven !== 'even'
        ) {

            return res.status(400).json({
                error: '홀 또는 짝을 선택해주세요.'
            });

        }


        // 언더/오버 값 확인
        if (
            underOver !== 'under' &&
            underOver !== 'over'
        ) {

            return res.status(400).json({
                error: '언더 또는 오버를 선택해주세요.'
            });

        }


        // 로그인 회원 정보 확인
        const userResult = await pool.query(
            `
            SELECT username, nickname
            FROM users
            WHERE username = $1
            LIMIT 1
            `,
            [username]
        );


        if (userResult.rows.length === 0) {

            return res.status(401).json({
                error: '회원 정보를 찾을 수 없습니다.'
            });

        }


        const nickname =
            userResult.rows[0].nickname;


        // PICK 저장
        const pickResult = await pool.query(
            `
            INSERT INTO member_picks
                (
                    username,
                    nickname,
                    round_number,
                    odd_even,
                    under_over
                )

            VALUES
                ($1, $2, $3, $4, $5)

            RETURNING
                id,
                username,
                nickname,
                round_number,
                odd_even,
                under_over,
                created_at
            `,
            [
                username,
                nickname,
                roundNumber,
                oddEven,
                underOver
            ]
        );


        return res.json({
            ok: true,
            pick: pickResult.rows[0]
        });


    } catch (error) {

        // 같은 회원이 같은 회차에 또 등록한 경우
        if (error.code === '23505') {

            return res.status(409).json({
                error: '이미 해당 회차에 PICK을 등록했습니다.'
            });

        }


        console.error(
            'PICK 등록 DB 오류:',
            error
        );


        return res.status(500).json({
            error: 'PICK 등록에 실패했습니다.'
        });

    }

});

// ========================================
// TOVIEW MEMBER PICK 회차별 통계
// ========================================

app.get('/api/picks/:round/stats', async (req, res) => {

    try {

        const roundNumber =
            Number(req.params.round);


        // 회차 검증
        if (
            !Number.isInteger(roundNumber) ||
            roundNumber <= 0
        ) {

            return res.status(400).json({
                error: '올바른 회차가 아닙니다.'
            });

        }


        // 해당 회차 PICK 집계
        const result = await pool.query(
            `
            SELECT

                COUNT(*)::int AS total,

                COUNT(*) FILTER (
                    WHERE odd_even = 'odd'
                )::int AS odd,

                COUNT(*) FILTER (
                    WHERE odd_even = 'even'
                )::int AS even,

                COUNT(*) FILTER (
                    WHERE under_over = 'under'
                )::int AS under,

                COUNT(*) FILTER (
                    WHERE under_over = 'over'
                )::int AS over

            FROM member_picks

            WHERE round_number = $1
            `,
            [roundNumber]
        );


        const stats = result.rows[0];


        const total =
            Number(stats.total) || 0;

        const odd =
            Number(stats.odd) || 0;

        const even =
            Number(stats.even) || 0;

        const under =
            Number(stats.under) || 0;

        const over =
            Number(stats.over) || 0;


        // 퍼센트 계산
        const oddPercent =
            total > 0
                ? Math.round((odd / total) * 100)
                : 50;

        const evenPercent =
            total > 0
                ? 100 - oddPercent
                : 50;


        const underPercent =
            total > 0
                ? Math.round((under / total) * 100)
                : 50;

        const overPercent =
            total > 0
                ? 100 - underPercent
                : 50;


        return res.json({

            ok: true,

            roundNumber: roundNumber,

            participants: total,

            oddEven: {
                odd: odd,
                even: even,
                oddPercent: oddPercent,
                evenPercent: evenPercent
            },

            underOver: {
                under: under,
                over: over,
                underPercent: underPercent,
                overPercent: overPercent
            }

        });


    } catch (error) {

        console.error(
            'PICK 통계 조회 오류:',
            error
        );


        return res.status(500).json({
            error: 'PICK 통계를 불러오지 못했습니다.'
        });

    }

});

// ========================================
// TOVIEW GAME DATA API
// ========================================

// 현재 지원할 게임 목록
const TOVIEW_GAMES = {
    powerball: {
        id: 'powerball',
        name: '파워볼',
        enabled: true
    },

    ladder: {
        id: 'ladder',
        name: '사다리',
        enabled: false
    },

    eos: {
        id: 'eos',
        name: 'EOS 파워볼',
        enabled: false
    }
};


// ========================================
// 게임 목록
// ========================================

app.get('/api/games', (req, res) => {

    return res.json({
        ok: true,
        games: Object.values(TOVIEW_GAMES)
    });

});


// ========================================
// 특정 게임 LIVE 데이터
// ========================================

app.get('/api/games/:game/live', async (req, res) => {

    try {

        const gameId =
            String(req.params.game || '')
                .trim()
                .toLowerCase();


        const game =
            TOVIEW_GAMES[gameId];


        // 존재하지 않는 게임
        if (!game) {

            return res.status(404).json({
                error: '지원하지 않는 게임입니다.'
            });

        }


        // 아직 실제 데이터 API가 연결되지 않은 게임
        if (!game.enabled) {

            return res.status(503).json({
                ok: false,

                game: game.id,

                name: game.name,

                connected: false,

                error: '게임 데이터 API 연결 준비 중입니다.'
            });

        }

// ========================================
// 파워볼 실제 데이터
// ========================================

if (gameId === 'powerball') {

    const apiResponse = await fetch(
        'https://www.powerballgame.co.kr/json/powerball.json',
        {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        }
    );


    if (!apiResponse.ok) {

        return res.status(502).json({
            ok: false,
            connected: false,
            error: '파워볼 데이터 서버 연결 실패'
        });

    }


    const data =
        await apiResponse.json();


    const roundNumber =
        Number(data.round);


    if (
        !Number.isInteger(roundNumber) ||
        roundNumber <= 0
    ) {

        return res.status(502).json({
            ok: false,
            connected: false,
            error: '회차 정보를 확인할 수 없습니다.'
        });

    }


    return res.json({

        ok: true,

        connected: true,

        game: 'powerball',

        name: '파워볼',

        roundNumber: roundNumber,

        todayRound:
            Number(data.todayRound),

        drawDate:
            data.date,

        drawTime:
            data.time,

        result: {

            powerball:
                data.powerball,

            powerballOddEven:
                data.oddEven_powerball,

            powerballUnderOver:
                data.underOver_powerball,

            number:
                data.number,

            numberSum:
                data.numberSum

        }

    });

}

        return res.status(503).json({
            ok: false,
            connected: false,
            error: '게임 데이터 API 연결 준비 중입니다.'
        });


    } catch (error) {

        console.error(
            '게임 LIVE API 오류:',
            error
        );


        return res.status(500).json({
            error: '게임 데이터를 불러오지 못했습니다.'
        });

    }

});

app.listen(PORT,()=>console.log(`TOVIEW http://localhost:${PORT}`));
