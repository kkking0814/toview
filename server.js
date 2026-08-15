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
        const gameId = String(req.body?.gameId || 'dh_randomball').trim().toLowerCase();
        const roundNumber = Number(req.body?.roundNumber);
        const oddEven = String(req.body?.oddEven || '').trim().toLowerCase();
        const underOver = String(req.body?.underOver || '').trim().toLowerCase();

        if (!['dh_randomball','dh_speedkeno','speedkeno_ladder','bubble_powerball','bubble_ladder'].includes(gameId)) {
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
        const gameId = String(req.query.game || 'dh_randomball').trim().toLowerCase();

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
               AND COALESCE(NULLIF(game_id,'powerball'),'dh_randomball')=$2`,
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
// TOVIEW GAME DATA API V5
// 게임 결과 데이터만 서버에서 정규화하고, 중계 화면은 TOVIEW 자체 애니메이션으로 렌더링한다.
// ========================================
const TOVIEW_GAMES = {
  dh_randomball: {
    id:'dh_randomball', name:'동행파워볼(랜덤볼)', type:'powerball', cycleSeconds:300,
    url:process.env.DH_RANDOMBALL_API_URL || 'https://bepick.nupro765.com/bepick/dh/rand.powerball.asp'
  },
  dh_speedkeno: {
    id:'dh_speedkeno', name:'동행스피드키노', type:'keno', cycleSeconds:300,
    url:process.env.DH_SPEEDKENO_API_URL || 'https://www.powerballgame.co.kr/json/speedkeno.json'
  },
  speedkeno_ladder: {
    id:'speedkeno_ladder', name:'스피드키노사다리', type:'ladder', cycleSeconds:300,
    url:process.env.SPEEDKENO_LADDER_API_URL || 'https://bepick.nupro765.com/bepick/speedkeno/rand.ladder.asp'
  },
  bubble_powerball: {
    id:'bubble_powerball', name:'보글파워볼', type:'powerball', cycleSeconds:120,
    url:process.env.BUBBLE_POWERBALL_API_URL || 'https://bepick.net/game/default/bubble_power'
  },
  bubble_ladder: {
    id:'bubble_ladder', name:'보글사다리', type:'ladder', cycleSeconds:180,
    url:process.env.BUBBLE_LADDER_API_URL || 'https://bepick.net/game/default/bubble_ladder3'
  }
};

function apiOddEven(v,n){
  const t=String(v??'').toLowerCase();
  if(v===1||v==='1'||/odd|홀/.test(t))return 1;
  if(v===2||v==='2'||/even|짝/.test(t))return 2;
  return Number(n)%2?1:2;
}
function apiUnderOver(v,n){
  const t=String(v??'').toLowerCase();
  if(v===1||v==='1'||/under|언/.test(t))return 1;
  if(v===2||v==='2'||/over|오/.test(t))return 2;
  return Number(n)<=4?1:2;
}
async function gameFetchText(url){
  if(!url)throw Object.assign(new Error('이 게임의 결과 공급 API 주소를 서버 환경변수에 설정해야 합니다.'),{status:503});
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,text/html,*/*'}});
  const text=await r.text();
  if(!r.ok)throw Object.assign(new Error(`외부 결과 API HTTP ${r.status}`),{status:502});
  if(/unauthorized|forbidden|access denied/i.test(text))throw Object.assign(new Error('결과 API 공급처가 현재 서버 접속을 허용하지 않습니다.'),{status:502});
  return text.replace(/^\uFEFF/,'').trim();
}
function bracketParts(text){
  let raw=String(text||'').replace(/&#91;|&lbrack;/gi,'[').replace(/&#93;|&rbrack;/gi,']').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
  const m=raw.match(/#?\s*\[([\s\S]*?)\]/);
  if(!m){console.error('게임 API 원문:',raw.slice(0,300));throw Object.assign(new Error('결과 API 응답 형식을 인식하지 못했습니다.'),{status:502})}
  return m[1].split(',').map(v=>String(v).trim().replace(/^["']|["']$/g,''));
}
function dateFromKey(key){
  const d=String(key||'').match(/(\d{8})/)?.[1]||'';
  return d?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:'';
}
function normalizePowerball(parts){
  // 공급처별로 전체/일회차가 하나 더 있는 경우를 모두 허용한다.
  const nums=parts.map(x=>Number(x));
  let offset=2;
  if(parts.length>=10)offset=3;
  const balls=parts.slice(offset,offset+5).map(Number);
  const power=Number(parts[offset+5]);
  const sum=Number(parts[offset+6]) || balls.reduce((a,b)=>a+(Number(b)||0),0);
  return {Round:Number(parts[1]),AllRound:Number(parts.length>=10?parts[2]:parts[1]),Date:dateFromKey(parts[0]),
    nBall1:balls[0],nBall2:balls[1],nBall3:balls[2],nBall4:balls[3],nBall5:balls[4],nBallSum:sum,PowerBall:power,
    oddEven:apiOddEven(null,sum),pOddEven:apiOddEven(null,power),pUnderOver:apiUnderOver(null,power)};
}
function normalizeLadder(parts){
  const six=parts.length>=6;
  const oe=parts[six?3:2], start=parts[six?4:3], lines=Number(parts[six?5:4])===4?4:3;
  const odd=/odd|홀/i.test(String(oe)), left=/left|좌/i.test(String(start));
  return {Round:Number(parts[1]),AllRound:six?Number(parts[2]):Number(parts[1]),Date:dateFromKey(parts[0]),
    oddEven:odd?1:2,pOddEven:odd?1:2,pUnderOver:left?1:2,
    ladder:{start:left?'left':'right',lines,result:odd?'odd':'even'}};
}
function normalizeSpeedKeno(obj){
  const nums=String(obj.number||'').split(',').map(Number).filter(Number.isFinite);
  const sum=Number(obj.numberSum)||nums.reduce((a,b)=>a+b,0);
  return {Round:Number(obj.round),AllRound:Number(obj.todayRound||obj.round),Date:obj.date||'',Time:obj.time||'',
    numbers:nums,nBallSum:sum,oddEven:apiOddEven(obj.numberSumOddEven,sum),pOddEven:apiOddEven(obj.numberSumOddEven,sum),
    pUnderOver:/over/i.test(String(obj.underOver||''))?2:1};
}

function stripHtml(s){
  return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
function findJsonNumber(raw, keys){
  for(const k of keys){
    const m=raw.match(new RegExp('["\\\']?'+k+'["\\\']?\\s*[:=]\\s*["\\\']?(-?\\d+)','i'));
    if(m)return Number(m[1]);
  }
  return null;
}
function findJsonString(raw, keys){
  for(const k of keys){
    const m=raw.match(new RegExp('["\\\']?'+k+'["\\\']?\\s*[:=]\\s*["\\\']([^"\\\']+)["\\\']','i'));
    if(m)return m[1];
  }
  return null;
}
function parseBepickRound(text, maxRound){
  const plain=stripHtml(text);
  const re=/(\d{4}[.\-]\d{2}[.\-]\d{2})\s*[- ]\s*(\d{1,3})/g;
  let m,best=null;
  while((m=re.exec(plain))){
    const r=Number(m[2]);
    if(r>0 && r<=maxRound && (!best || r>best.round)) best={date:m[1].replace(/\./g,'-'),round:r,index:m.index};
  }
  if(best)return best;
  const cur=plain.match(/(\d{1,3})\s*회차\s*데이터/);
  if(cur)return {date:'',round:Math.max(1,Number(cur[1])-1),index:0};
  return null;
}
function parseBepickBubblePower(raw){
  const latest=parseBepickRound(raw,720);
  if(!latest)throw Object.assign(new Error('베픽 보글파워볼 회차를 찾지 못했습니다.'),{status:502});

  // 1순위: 페이지/스크립트에 구조화된 결과 키가 있으면 사용
  let power=findJsonNumber(raw,['powerball','power_ball','pball','powerBall']);
  let b1=findJsonNumber(raw,['ball1','nBall1','number1']);
  let b2=findJsonNumber(raw,['ball2','nBall2','number2']);
  let b3=findJsonNumber(raw,['ball3','nBall3','number3']);
  let b4=findJsonNumber(raw,['ball4','nBall4','number4']);
  let b5=findJsonNumber(raw,['ball5','nBall5','number5']);

  // 2순위: 최신 회차 주변 HTML에서 "파워볼 + 일반볼 5개 + 합" 숫자열 탐색
  if([power,b1,b2,b3,b4,b5].some(v=>v===null)){
    const marker1=new RegExp(latest.date.replace(/-/g,'[.\\-]')+'\\s*[- ]\\s*'+latest.round);
    const mm=raw.match(marker1);
    const chunk=mm ? raw.slice(mm.index,mm.index+6000) : raw.slice(0,12000);
    const plain=stripHtml(chunk);
    const nums=(plain.match(/\b\d{1,3}\b/g)||[]).map(Number);
    // 보글 일반볼은 1~28 범위, 파워볼은 0~9. 회차/시간 숫자를 제외하기 위해
    // 연속 6개 후보 중 뒤 5개가 일반볼 범위인 첫 조합을 선택한다.
    for(let i=0;i+5<nums.length;i++){
      const a=nums.slice(i,i+6);
      if(a[0]>=0&&a[0]<=9 && a.slice(1).every(n=>n>=1&&n<=28)){
        power=a[0]; [b1,b2,b3,b4,b5]=a.slice(1); break;
      }
    }
  }
  if([power,b1,b2,b3,b4,b5].some(v=>!Number.isFinite(v))){
    throw Object.assign(new Error('베픽 보글파워볼 페이지에서 최신 결과 숫자를 추출하지 못했습니다.'),{status:502});
  }
  const balls=[b1,b2,b3,b4,b5],sum=balls.reduce((a,b)=>a+b,0);
  return {Round:latest.round,AllRound:latest.round,Date:latest.date,
    nBall1:b1,nBall2:b2,nBall3:b3,nBall4:b4,nBall5:b5,nBallSum:sum,PowerBall:power,
    oddEven:sum%2?1:2,pOddEven:power%2?1:2,pUnderOver:power<=4?1:2,source:'bepick'};
}
function parseBepickBubbleLadder(raw){
  const latest=parseBepickRound(raw,480);
  if(!latest)throw Object.assign(new Error('베픽 보글사다리 회차를 찾지 못했습니다.'),{status:502});

  let start=findJsonString(raw,['start','startPosition','start_position','leftRight','left_right']);
  let lines=findJsonNumber(raw,['line','lines','lineCount','line_count','ladderCount']);
  let result=findJsonString(raw,['result','oddEven','odd_even','endResult']);

  // 최신 회차 근처에서 좌/우, 3/4줄, 홀/짝 텍스트를 찾는 fallback.
  const marker=new RegExp(latest.date.replace(/-/g,'[.\\-]')+'\\s*[- ]\\s*'+latest.round);
  const mm=raw.match(marker);
  const chunk=mm ? stripHtml(raw.slice(mm.index,mm.index+3500)) : stripHtml(raw.slice(0,8000));
  if(!start){
    const m=chunk.match(/(좌(?:출발)?|우(?:출발)?|left|right)/i); if(m)start=m[1];
  }
  if(!lines){
    const m=chunk.match(/\b([34])\s*줄/); if(m)lines=Number(m[1]);
  }
  if(!result){
    const m=chunk.match(/(홀|짝|odd|even)/i); if(m)result=m[1];
  }

  const left=/좌|left/i.test(String(start||'')), right=/우|right/i.test(String(start||''));
  const odd=/홀|odd/i.test(String(result||'')), even=/짝|even/i.test(String(result||''));
  if((!left&&!right)||![3,4].includes(Number(lines))||(!odd&&!even)){
    throw Object.assign(new Error('베픽 보글사다리 페이지에서 최신 좌우/줄수/홀짝 결과를 추출하지 못했습니다.'),{status:502});
  }
  return {Round:latest.round,AllRound:latest.round,Date:latest.date,
    oddEven:odd?1:2,pOddEven:odd?1:2,pUnderOver:left?1:2,
    ladder:{start:left?'left':'right',lines:Number(lines),result:odd?'odd':'even'},source:'bepick'};
}

async function gamePayload(id){
  const g=TOVIEW_GAMES[id]; if(!g)throw Object.assign(new Error('지원하지 않는 게임입니다.'),{status:404});
  const raw=await gameFetchText(g.url);
  let data;
  if(id==='dh_speedkeno'){
    let obj;try{obj=JSON.parse(raw)}catch{throw Object.assign(new Error('동행스피드키노 JSON 형식을 인식하지 못했습니다.'),{status:502})}
    data=normalizeSpeedKeno(Array.isArray(obj)?obj[0]:obj);
  }else if(id==='bubble_powerball'){
    // 환경변수에 전용 API를 넣었으면 bracket/JSON을 우선 시도하고,
    // 기본값(Bepick 공개 페이지)이면 공개 결과 페이지를 파싱한다.
    if(g.url.includes('bepick.net/game/')) data=parseBepickBubblePower(raw);
    else {
      try{
        const obj=JSON.parse(raw);
        const x=Array.isArray(obj)?obj[0]:obj;
        const balls=x.balls||x.numbers||[x.nBall1,x.nBall2,x.nBall3,x.nBall4,x.nBall5];
        const power=Number(x.PowerBall??x.powerball??x.powerBall);
        const sum=Number(x.nBallSum??x.sum)||balls.map(Number).reduce((a,b)=>a+b,0);
        data={Round:Number(x.Round??x.round),AllRound:Number(x.AllRound??x.todayRound??x.round),Date:x.Date??x.date??'',
          nBall1:Number(balls[0]),nBall2:Number(balls[1]),nBall3:Number(balls[2]),nBall4:Number(balls[3]),nBall5:Number(balls[4]),
          nBallSum:sum,PowerBall:power,oddEven:sum%2?1:2,pOddEven:power%2?1:2,pUnderOver:power<=4?1:2};
      }catch{data=normalizePowerball(bracketParts(raw))}
    }
  }else if(id==='bubble_ladder'){
    if(g.url.includes('bepick.net/game/')) data=parseBepickBubbleLadder(raw);
    else {
      try{
        const obj=JSON.parse(raw),x=Array.isArray(obj)?obj[0]:obj;
        const left=/left|좌/i.test(String(x.start??x.leftRight??'')),odd=/odd|홀/i.test(String(x.result??x.oddEven??''));
        data={Round:Number(x.Round??x.round),AllRound:Number(x.AllRound??x.todayRound??x.round),Date:x.Date??x.date??'',
          oddEven:odd?1:2,pOddEven:odd?1:2,pUnderOver:left?1:2,
          ladder:{start:left?'left':'right',lines:Number(x.lines??x.lineCount),result:odd?'odd':'even'}};
      }catch{data=normalizeLadder(bracketParts(raw))}
    }
  }else{
    const parts=bracketParts(raw);
    data=g.type==='ladder'?normalizeLadder(parts):normalizePowerball(parts);
  }
  return {ok:true,game:id,name:g.name,type:g.type,cycleSeconds:g.cycleSeconds,renderer:g.type==='ladder'?'toview-ladder':'toview-balls',
    roundNumber:Number(data.Round),todayRound:Number(data.AllRound),drawDate:data.Date||'',drawTime:data.Time||'',source:data.source||'result-api',data};
}

app.get('/api/games',(req,res)=>res.json({ok:true,games:Object.values(TOVIEW_GAMES).map(({url,...g})=>g)}));
app.get('/api/games/:game/live',async(req,res)=>{
  try{return res.json(await gamePayload(String(req.params.game||'').toLowerCase()))}
  catch(e){console.error('게임 LIVE API 오류:',e);return res.status(e.status||502).json({ok:false,error:e.message})}
});
app.get('/api/games/:game/results',async(req,res)=>{
  try{
    const id=String(req.params.game||'').toLowerCase();
    const live=await gamePayload(id);
    // 공급처가 최신값 하나만 제공할 때 임의 과거 결과를 생성하지 않는다.
    return res.json({ok:true,game:id,records:[live.data]});
  }catch(e){return res.status(e.status||502).json({ok:false,error:e.message,records:[]})}
});

// 기존 index.html 호환: /api/results는 동행파워볼(랜덤볼) 최신 결과 배열을 반환한다.
app.get('/api/results',async(req,res)=>{
  try{const live=await gamePayload('dh_randomball');return res.json([live.data])}
  catch(e){console.error('/api/results 오류:',e);return res.status(e.status||502).json({error:e.message})}
});

app.listen(PORT,()=>console.log(`TOVIEW http://localhost:${PORT}`));
