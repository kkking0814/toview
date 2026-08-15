const express=require('express'); const session=require('express-session'); const bcrypt=require('bcryptjs'); const fs=require('fs'); const path=require('path');

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ========================================
// 파워볼 결과 누적 저장 테이블
// ========================================

async function initPowerballResultsTable() {

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS powerball_results (

                id SERIAL PRIMARY KEY,

                round_number BIGINT UNIQUE NOT NULL,

                today_round INTEGER,

                draw_date VARCHAR(20),

                draw_time VARCHAR(20),

                n_ball1 INTEGER,
                n_ball2 INTEGER,
                n_ball3 INTEGER,
                n_ball4 INTEGER,
                n_ball5 INTEGER,

                number_sum INTEGER,

                number_odd_even VARCHAR(10),

                powerball INTEGER,

                powerball_odd_even VARCHAR(10),

                powerball_under_over VARCHAR(10),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log(
            'POWERBALL 결과 테이블 준비 완료'
        );

    } catch (error) {

        console.error(
            'POWERBALL 결과 테이블 생성 오류:',
            error
        );

    }

}


// 서버 시작 시 테이블 확인

initPowerballResultsTable();

// ========================================
// MEMBER PICK 게임 구분 컬럼 자동 보정
// 기존 DB를 그대로 사용해도 실행 시 game_id 컬럼/인덱스를 준비한다.
// ========================================
async function initMemberPickGameColumn() {
    try {
        await pool.query(`
            ALTER TABLE member_picks
            ADD COLUMN IF NOT EXISTS game_id VARCHAR(30) DEFAULT 'powerball'
        `);

        // 예전 (username, round_number) UNIQUE 제약은 게임별 PICK을 막을 수 있으므로
        // 알려진 제약 이름이 있으면 제거하고 게임 포함 UNIQUE INDEX를 사용한다.
        await pool.query(`
            DO $$
            DECLARE r RECORD;
            BEGIN
                FOR r IN
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid = 'member_picks'::regclass
                      AND contype = 'u'
                LOOP
                    IF pg_get_constraintdef(
                        (SELECT oid FROM pg_constraint WHERE conname = r.conname AND conrelid='member_picks'::regclass LIMIT 1)
                    ) ILIKE '%username%'
                    AND pg_get_constraintdef(
                        (SELECT oid FROM pg_constraint WHERE conname = r.conname AND conrelid='member_picks'::regclass LIMIT 1)
                    ) ILIKE '%round_number%'
                    AND pg_get_constraintdef(
                        (SELECT oid FROM pg_constraint WHERE conname = r.conname AND conrelid='member_picks'::regclass LIMIT 1)
                    ) NOT ILIKE '%game_id%'
                    THEN
                        EXECUTE format('ALTER TABLE member_picks DROP CONSTRAINT %I', r.conname);
                    END IF;
                END LOOP;
            END $$;
        `).catch(() => {});

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS member_picks_user_game_round_uidx
            ON member_picks (username, game_id, round_number)
        `);

        console.log('MEMBER PICK game_id 준비 완료');
    } catch (error) {
        console.error('MEMBER PICK game_id 준비 오류:', error);
    }
}
setTimeout(initMemberPickGameColumn, 1500);


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
// TOVIEW MEMBER PICK 등록 - 게임별 분리
// ========================================
app.post('/api/picks', async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: '로그인이 필요합니다.' });
        }

        const username = req.session.user;
        const gameId = String(req.body?.gameId || 'dhpowerball').trim().toLowerCase();
        const roundNumber = Number(req.body?.roundNumber);
        const oddEven = String(req.body?.oddEven || '').trim().toLowerCase();
        const underOver = String(req.body?.underOver || '').trim().toLowerCase();

        if (!['dhpowerball','dhpowerladder','eos','bubbleladder','kenoladder'].includes(gameId)) {
            return res.status(400).json({ error: '지원하지 않는 게임입니다.' });
        }
        if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
            return res.status(400).json({ error: '올바른 회차가 아닙니다.' });
        }
        if (!['odd','even'].includes(oddEven)) {
            return res.status(400).json({ error: '홀 또는 짝을 선택해주세요.' });
        }
        if (!['under','over'].includes(underOver)) {
            return res.status(400).json({ error: '두 번째 PICK 항목을 선택해주세요.' });
        }

        const userResult = await pool.query(
            `SELECT username, nickname FROM users WHERE username=$1 LIMIT 1`,
            [username]
        );
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: '회원 정보를 찾을 수 없습니다.' });
        }

        const nickname = userResult.rows[0].nickname;
        const pickResult = await pool.query(
            `INSERT INTO member_picks
                (username,nickname,game_id,round_number,odd_even,under_over)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id,username,nickname,game_id,round_number,odd_even,under_over,created_at`,
            [username,nickname,gameId,roundNumber,oddEven,underOver]
        );

        return res.json({ ok:true, pick:pickResult.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error:'이미 해당 게임의 해당 회차에 PICK을 등록했습니다.' });
        }
        console.error('PICK 등록 DB 오류:', error);
        return res.status(500).json({ error:'PICK 등록에 실패했습니다.' });
    }
});

// ========================================
// TOVIEW MEMBER PICK 회차별 통계 - 게임별 분리
// ========================================
app.get('/api/picks/:round/stats', async (req, res) => {
    try {
        const roundNumber = Number(req.params.round);
        const gameId = String(req.query.game || 'dhpowerball').trim().toLowerCase();

        if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
            return res.status(400).json({ error:'올바른 회차가 아닙니다.' });
        }

        const result = await pool.query(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE odd_even='odd')::int AS odd,
                COUNT(*) FILTER (WHERE odd_even='even')::int AS even,
                COUNT(*) FILTER (WHERE under_over='under')::int AS under,
                COUNT(*) FILTER (WHERE under_over='over')::int AS over
             FROM member_picks
             WHERE round_number=$1
               AND COALESCE(NULLIF(game_id,'powerball'),'dhpowerball')=$2`,
            [roundNumber, gameId]
        );

        const s=result.rows[0]||{};
        const total=Number(s.total)||0, odd=Number(s.odd)||0, even=Number(s.even)||0;
        const under=Number(s.under)||0, over=Number(s.over)||0;
        const oddPercent=total?Math.round(odd/total*100):50;
        const underPercent=total?Math.round(under/total*100):50;

        return res.json({
            ok:true, gameId, roundNumber, participants:total,
            oddEven:{odd,even,oddPercent,evenPercent:total?100-oddPercent:50},
            underOver:{under,over,underPercent,overPercent:total?100-underPercent:50}
        });
    } catch (error) {
        console.error('PICK 통계 조회 오류:', error);
        return res.status(500).json({ error:'PICK 통계를 불러오지 못했습니다.' });
    }
});

// ========================================
// TOVIEW GAME DATA API
// results.html 게임 버튼 → 해당 API → 실제 회차/결과/중계 URL
// ========================================
const POWERBALL_API_URL = 'https://www.powerballgame.co.kr/json/powerball.json';
const POWERBALL_RECENT_API_URL = 'https://www.powerballgame.co.kr/json/powerball_recent.json';
const SPEEDKENO_API_URL = 'https://www.powerballgame.co.kr/json/speedkeno.json';

// 아래 2개는 공개 API 안내 페이지가 제공하는 엔트리 호환 결과 주소.
// 외부 서비스가 중단되면 502로 명확하게 반환하며 임의 결과를 만들지 않는다.
const POWER_LADDER_API_URL = process.env.POWER_LADDER_API_URL ||
    'https://bepick.nupro765.com/bepick/dh/rand.powerladder.asp';
const EOS_POWERBALL_API_URL = process.env.EOS_POWERBALL_API_URL ||
    'http://services.nupro365.com/live/ntry/res.powerball.5m.asp';

const TOVIEW_GAMES = {
    dhpowerball:{
        id:'dhpowerball', name:'동행파워볼', enabled:true, cycleSeconds:300,
        renderer:'toview-powerball'
    },
    dhpowerladder:{
        id:'dhpowerladder', name:'동행파워사다리', enabled:true, cycleSeconds:300,
        renderer:'toview-ladder'
    },
    eos:{
        id:'eos', name:'EOS 파워볼', enabled:true, cycleSeconds:300,
        renderer:'toview-powerball'
    },
    bubbleladder:{
        id:'bubbleladder', name:'보글사다리', enabled:true, cycleSeconds:180,
        renderer:'toview-ladder'
    },
    kenoladder:{
        id:'kenoladder', name:'키노사다리', enabled:true, cycleSeconds:300,
        renderer:'toview-ladder'
    }
};

function normalizeOddEven(value, fallbackNumber){
    if(value===1||value==='1')return 'odd';
    if(value===2||value==='2')return 'even';
    const t=String(value??'').trim().toLowerCase();
    if(t==='odd'||t==='홀')return 'odd';
    if(t==='even'||t==='짝')return 'even';
    const n=Number(fallbackNumber);
    return Number.isFinite(n)?(Math.abs(n%2)===1?'odd':'even'):null;
}
function normalizeUnderOver(value, fallbackNumber){
    if(value===1||value==='1')return 'under';
    if(value===2||value==='2')return 'over';
    const t=String(value??'').trim().toLowerCase();
    if(t==='under'||t==='언더')return 'under';
    if(t==='over'||t==='오버')return 'over';
    const n=Number(fallbackNumber);
    return Number.isFinite(n)?(n<=4?'under':'over'):null;
}
async function fetchJson(url){
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*'}});
    if(!r.ok)throw new Error(`외부 API HTTP ${r.status}`);
    return r.json();
}
async function fetchText(url){
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/plain,text/html,*/*'}});
    if(!r.ok)throw new Error(`외부 API HTTP ${r.status}`);
    return r.text();
}
function parsePowerballSource(source){
    if(!source||typeof source!=='object')throw new Error('파워볼 원본 데이터 없음');
    const nums=[source.nBall1,source.nBall2,source.nBall3,source.nBall4,source.nBall5].map(Number);
    let balls=nums;
    if(balls.some(v=>!Number.isFinite(v))){
        const s=String(source.number??'').replace(/\D/g,'');
        if(s.length>=10)balls=[0,2,4,6,8].map(i=>Number(s.slice(i,i+2)));
    }
    const powerball=Number(source.PowerBall??source.powerball??source.pBall);
    const sum=Number(source.nBallSum??source.numberSum) || balls.reduce((a,b)=>a+(Number(b)||0),0);
    return {
        roundNumber:Number(source.Round??source.round),
        todayRound:Number(source.AllRound??source.todayRound??source.allRound),
        drawDate:String(source.Date??source.date??''),
        drawTime:String(source.Time??source.time??''),
        nBall1:balls[0],nBall2:balls[1],nBall3:balls[2],nBall4:balls[3],nBall5:balls[4],
        numberSum:sum, numberOddEven:normalizeOddEven(source.oddEven??source.numberSumOddEven,sum),
        powerball, powerballOddEven:normalizeOddEven(source.pOddEven??source.powerballOddEven,powerball),
        powerballUnderOver:normalizeUnderOver(source.pUnderOver??source.powerballUnderOver,powerball)
    };
}
async function fetchPowerballRecord(){
    const p=await fetchJson(POWERBALL_API_URL);
    const source=Array.isArray(p)?p[0]:(Array.isArray(p?.data)?p.data[0]:p);
    const r=parsePowerballSource(source);
    if(!Number.isInteger(r.roundNumber)||r.roundNumber<=0)throw new Error('파워볼 회차 오류');
    return r;
}
async function savePowerballRecord(record){
    await pool.query(
        `INSERT INTO powerball_results
        (round_number,today_round,draw_date,draw_time,n_ball1,n_ball2,n_ball3,n_ball4,n_ball5,number_sum,number_odd_even,powerball,powerball_odd_even,powerball_under_over)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(round_number) DO UPDATE SET
        today_round=EXCLUDED.today_round,draw_date=EXCLUDED.draw_date,draw_time=EXCLUDED.draw_time,
        n_ball1=EXCLUDED.n_ball1,n_ball2=EXCLUDED.n_ball2,n_ball3=EXCLUDED.n_ball3,n_ball4=EXCLUDED.n_ball4,n_ball5=EXCLUDED.n_ball5,
        number_sum=EXCLUDED.number_sum,number_odd_even=EXCLUDED.number_odd_even,powerball=EXCLUDED.powerball,
        powerball_odd_even=EXCLUDED.powerball_odd_even,powerball_under_over=EXCLUDED.powerball_under_over`,
        [record.roundNumber,record.todayRound,record.drawDate,record.drawTime,record.nBall1,record.nBall2,record.nBall3,record.nBall4,record.nBall5,record.numberSum,record.numberOddEven,record.powerball,record.powerballOddEven,record.powerballUnderOver]
    );
}
function powerballPublic(r){
    return {AllRound:r.todayRound,Round:r.roundNumber,Date:r.drawDate,Time:r.drawTime,
        nBall1:r.nBall1,nBall2:r.nBall2,nBall3:r.nBall3,nBall4:r.nBall4,nBall5:r.nBall5,
        nBallSum:r.numberSum,PowerBall:r.powerball,
        oddEven:r.numberOddEven==='odd'?1:2,pOddEven:r.powerballOddEven==='odd'?1:2,pUnderOver:r.powerballUnderOver==='under'?1:2};
}
function parseBracketApi(text){
    const raw=String(text??'').replace(/^\uFEFF/,'').trim();

    // 공급처가 Unauthorized/HTML 오류를 반환한 경우 파싱 오류로 숨기지 않는다.
    if(/unauthorized|forbidden|access\s*denied/i.test(raw)){
        throw Object.assign(new Error('결과 API 공급처가 Render 서버 접속을 차단했습니다.'),{status:502});
    }

    // 문서상 정상 형식: #[a,b,c...] / [a,b,c...]
    let m=raw.match(/#?\s*\[([\s\S]*?)\]/);

    // 일부 ASP 공급처가 HTML 안에 엔티티/스크립트 형태로 넣는 경우 대비
    if(!m){
        const decoded=raw
          .replace(/&#91;|&lbrack;/gi,'[')
          .replace(/&#93;|&rbrack;/gi,']')
          .replace(/&quot;/gi,'"')
          .replace(/&#39;/gi,"'");
        m=decoded.match(/#?\s*\[([\s\S]*?)\]/);
    }
    if(!m){
        console.error('외부 API 원문(앞 300자):', raw.slice(0,300));
        throw Object.assign(new Error('외부 게임 API 응답이 문서 형식과 다릅니다.'),{status:502});
    }
    return m[1].split(',').map(v=>String(v).trim().replace(/^["']|["']$/g,''));
}
function ladderResultFromParts(parts){
    // 5필드: [고유값,회차,홀짝,좌우,줄수]
    // 6필드: [고유값,전체회차,일회차,홀짝,좌우,줄수] (동행파워사다리)
    const six = parts.length >= 6;
    const round = Number(parts[six ? 1 : 1]);
    const todayRound = six ? Number(parts[2]) : round;
    const oeRaw = parts[six ? 3 : 2];
    const startRaw = parts[six ? 4 : 3];
    const linesRaw = parts[six ? 5 : 4];

    const oe=/odd|홀/i.test(oeRaw)?'odd':'even';
    const start=/left|좌/i.test(startRaw)?'left':'right';
    const lines=Number(linesRaw)===4?4:3;

    const key=String(parts[0]||'');
    const dateKey=key.match(/(\d{8})/)?.[1]||'';
    const date=dateKey?`${dateKey.slice(0,4)}-${dateKey.slice(4,6)}-${dateKey.slice(6,8)}`:'';

    return {
        Round:round, AllRound:todayRound, Date:date,
        oddEven:oe==='odd'?1:2, pOddEven:oe==='odd'?1:2,
        pUnderOver:start==='left'?1:2,
        ladder:{start,lines,result:oe}
    };
}
function speedKenoPublic(p){
    const numbers=String(p.number||'').split(',').map(v=>Number(v)).filter(Number.isFinite);
    const sum=Number(p.numberSum)||numbers.reduce((a,b)=>a+b,0);
    const oe=normalizeOddEven(p.numberSumOddEven,sum);
    const uo=String(p.underOver||'').toLowerCase()==='over'?'over':'under';
    return {Round:Number(p.round),AllRound:Number(p.todayRound),Date:p.date||'',Time:p.time||'',
        numbers,nBallSum:sum,oddEven:oe==='odd'?1:2,pOddEven:oe==='odd'?1:2,pUnderOver:uo==='under'?1:2};
}
function kenoLadderFromSpeed(p){
    const first=Number(String(p.number||'').split(',')[0]);
    if(!Number.isFinite(first))throw new Error('키노사다리 기준 숫자 없음');
    const start=first%2?'left':'right';
    const lines=first<=35?3:4;
    // 사다리 구조상 좌3/우4는 짝, 좌4/우3은 홀
    const result=((start==='left'&&lines===4)||(start==='right'&&lines===3))?'odd':'even';
    return {Round:Number(p.round),AllRound:Number(p.todayRound),Date:p.date||'',
        oddEven:result==='odd'?1:2,pOddEven:result==='odd'?1:2,pUnderOver:start==='left'?1:2,
        ladder:{start,lines,result},sourceFirstNumber:first};
}
function parseEosParts(parts){
    // 안내 형식: [회차고유값,회차,일반볼1..5,파워볼,일반볼합]
    const round=Number(parts[1]), balls=parts.slice(2,7).map(Number), power=Number(parts[7]), sum=Number(parts[8]);
    const dateKey=String(parts[0]||'').slice(0,8);
    const date=/^\d{8}$/.test(dateKey)?`${dateKey.slice(0,4)}-${dateKey.slice(4,6)}-${dateKey.slice(6,8)}`:'';
    return {Round:round,AllRound:round,Date:date,nBall1:balls[0],nBall2:balls[1],nBall3:balls[2],nBall4:balls[3],nBall5:balls[4],
        nBallSum:sum,PowerBall:power,oddEven:sum%2?1:2,pOddEven:power%2?1:2,pUnderOver:power<=4?1:2};
}
async function getGameLive(gameId){
    const g=TOVIEW_GAMES[gameId];
    if(!g)throw Object.assign(new Error('지원하지 않는 게임입니다.'),{status:404});
    let data;
    if(gameId==='dhpowerball'){
        const r=await fetchPowerballRecord(); try{await savePowerballRecord(r)}catch(e){console.error('POWERBALL 저장 오류',e)}
        data=powerballPublic(r);
    }else if(gameId==='bubbleladder'){
        // 보글사다리는 외부 영상이 아니라 TOVIEW 자체 렌더러를 사용한다.
        // 실제 결과 공급 API는 환경변수 BUBBLE_LADDER_API_URL을 지정하면 그 값을 파싱한다.
        // 미설정 상태에서는 임의 결과를 만들지 않고 명확히 연결대기 상태를 반환한다.
        if(!process.env.BUBBLE_LADDER_API_URL){
            throw Object.assign(new Error('BUBBLE_LADDER_API_URL이 아직 설정되지 않았습니다.'),{status:503});
        }
        data=ladderResultFromParts(parseBracketApi(await fetchText(process.env.BUBBLE_LADDER_API_URL)));
    }else if(gameId==='kenoladder'){
        data=kenoLadderFromSpeed(await fetchJson(SPEEDKENO_API_URL));
    }else if(gameId==='dhpowerladder'){
        data=ladderResultFromParts(parseBracketApi(await fetchText(POWER_LADDER_API_URL)));
    }else if(gameId==='eos'){
        data=parseEosParts(parseBracketApi(await fetchText(EOS_POWERBALL_API_URL)));
    }
    return {ok:true,connected:true,game:gameId,name:g.name,cycleSeconds:g.cycleSeconds,renderer:g.renderer,
        roundNumber:Number(data.Round),todayRound:Number(data.AllRound),drawDate:data.Date||'',drawTime:data.Time||'',data,result:data};
}

app.get('/api/games',(req,res)=>res.json({ok:true,games:Object.values(TOVIEW_GAMES)}));
app.get('/api/games/:game/live',async(req,res)=>{
    try{return res.json(await getGameLive(String(req.params.game||'').toLowerCase()))}
    catch(error){console.error('게임 LIVE API 오류:',error);return res.status(error.status||502).json({ok:false,connected:false,error:error.message||'게임 데이터를 불러오지 못했습니다.'})}
});
app.get('/api/games/:game/results',async(req,res)=>{
    try{
        const gameId=String(req.params.game||'').toLowerCase();
        if(gameId==='dhpowerball')return res.redirect(307,'/api/results');
        if(gameId==='bubbleladder'){
            const live=await getGameLive(gameId);
            return res.json({ok:true,game:gameId,records:[live.data]});
        }
        if(gameId==='kenoladder'){
            const one=kenoLadderFromSpeed(await fetchJson(SPEEDKENO_API_URL));
            return res.json({ok:true,game:gameId,records:[one]});
        }
        const live=await getGameLive(gameId);
        return res.json({ok:true,game:gameId,records:[live.data]});
    }catch(error){return res.status(502).json({ok:false,error:error.message||'게임 결과를 불러오지 못했습니다.',records:[]})}
});

// ========================================
// index.html 공용 / results.html 동행파워볼 오늘 누적 결과
// ========================================
app.get('/api/results',async(req,res)=>{
    try{
        const live=await fetchPowerballRecord();
        try{await savePowerballRecord(live)}catch(e){console.error('최신 파워볼 저장 오류',e)}
        const today=live.drawDate;
        const q=await pool.query(
            `SELECT round_number,today_round,draw_date,draw_time,n_ball1,n_ball2,n_ball3,n_ball4,n_ball5,number_sum,number_odd_even,powerball,powerball_odd_even,powerball_under_over
             FROM powerball_results WHERE draw_date=$1 ORDER BY today_round DESC`,[today]);
        return res.json(q.rows.map(row=>({
            AllRound:Number(row.today_round),Round:Number(row.round_number),Date:row.draw_date,Time:row.draw_time,
            nBall1:Number(row.n_ball1),nBall2:Number(row.n_ball2),nBall3:Number(row.n_ball3),nBall4:Number(row.n_ball4),nBall5:Number(row.n_ball5),
            nBallSum:Number(row.number_sum),PowerBall:Number(row.powerball),
            oddEven:normalizeOddEven(row.number_odd_even,row.number_sum)==='odd'?1:2,
            pOddEven:normalizeOddEven(row.powerball_odd_even,row.powerball)==='odd'?1:2,
            pUnderOver:normalizeUnderOver(row.powerball_under_over,row.powerball)==='under'?1:2
        })));
    }catch(error){console.error('오늘 파워볼 결과 조회 오류:',error);return res.status(500).json({error:'오늘 결과를 불러오지 못했습니다.'})}
});

let powerballCollectorRunning=false;
async function collectLatestPowerballResult(){
    if(powerballCollectorRunning)return; powerballCollectorRunning=true;
    try{await savePowerballRecord(await fetchPowerballRecord())}
    catch(error){console.error('동행파워볼 데이터 자동 수집 오류:',error.message||error)}
    finally{powerballCollectorRunning=false}
}
setTimeout(()=>{collectLatestPowerballResult();setInterval(collectLatestPowerballResult,60*1000)},3000);

app.listen(PORT,()=>console.log(`TOVIEW http://localhost:${PORT}`));
