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
// TOVIEW GAME STATE API V7
// 단일 데이터 계약: index / results / pattern / analysis / dashboard
// 외부 공급처 실패 시 임의 당첨번호를 생성하지 않는다.
// 정상 수신한 확정 결과는 PostgreSQL에 누적 저장하고 이후 캐시로 사용한다.
// ========================================

const TOVIEW_GAMES = {
  dh_randomball:{id:'dh_randomball',name:'동행파워볼(랜덤볼)',type:'powerball',cycleSeconds:300,roundsPerDay:288,url:process.env.DH_RANDOMBALL_API_URL||''},
  dh_speedkeno:{id:'dh_speedkeno',name:'동행스피드키노',type:'keno',cycleSeconds:300,roundsPerDay:288,url:process.env.DH_SPEEDKENO_API_URL||''},
  speedkeno_ladder:{id:'speedkeno_ladder',name:'스피드키노사다리',type:'ladder',cycleSeconds:300,roundsPerDay:288,url:process.env.SPEEDKENO_LADDER_API_URL||''},
  bubble_powerball:{id:'bubble_powerball',name:'보글파워볼',type:'powerball',cycleSeconds:120,roundsPerDay:720,url:process.env.BUBBLE_POWERBALL_API_URL||''},
  bubble_ladder:{id:'bubble_ladder',name:'보글사다리',type:'ladder',cycleSeconds:180,roundsPerDay:480,url:process.env.BUBBLE_LADDER_API_URL||''}
};

const gameMemory = new Map();

async function initGameResultsTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_results (
        id BIGSERIAL PRIMARY KEY,
        game_id VARCHAR(40) NOT NULL,
        round_number BIGINT NOT NULL,
        today_round INTEGER,
        draw_date VARCHAR(20),
        draw_time VARCHAR(20),
        payload JSONB NOT NULL,
        source VARCHAR(80),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(game_id, round_number)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS game_results_game_created_idx ON game_results(game_id, created_at DESC)`);
    console.log('GAME RESULTS 테이블 준비 완료');
  }catch(e){console.error('GAME RESULTS 테이블 준비 오류:',e)}
}
initGameResultsTable();

function seoulClock(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const x=Object.fromEntries(p.map(v=>[v.type,v.value]));
  return {date:`${x.year}-${x.month}-${x.day}`,hour:+x.hour,minute:+x.minute,second:+x.second};
}
function clockState(gameId){
  const g=TOVIEW_GAMES[gameId],k=seoulClock(),elapsed=k.hour*3600+k.minute*60+k.second;
  const completed=Math.floor(elapsed/g.cycleSeconds);
  return {date:k.date,currentRound:(completed%g.roundsPerDay)+1,remainingSeconds:g.cycleSeconds-(elapsed%g.cycleSeconds)};
}
function oe(v,n){
  const s=String(v??'').toLowerCase();
  if(v===1||v==='1'||/odd|홀/.test(s))return 1;
  if(v===2||v==='2'||/even|짝/.test(s))return 2;
  return Number(n)%2?1:2;
}
function uo(v,n){
  const s=String(v??'').toLowerCase();
  if(v===1||v==='1'||/under|언더/.test(s))return 1;
  if(v===2||v==='2'||/over|오버/.test(s))return 2;
  return Number(n)<=4?1:2;
}
function decodeEntities(s){
  return String(s||'').replace(/&#91;|&lbrack;/gi,'[').replace(/&#93;|&rbrack;/gi,']').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&amp;/gi,'&');
}
function bracketParts(text){
  const m=decodeEntities(text).match(/#?\s*\[([\s\S]*?)\]/);
  if(!m)throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  return m[1].split(',').map(v=>String(v).trim().replace(/^["']|["']$/g,''));
}
function dateFromKey(v){
  const d=String(v||'').match(/(\d{8})/)?.[1]||'';
  return d?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:'';
}
function normalizePowerball(parts){
  const offset=parts.length>=10?3:2, balls=parts.slice(offset,offset+5).map(Number), power=Number(parts[offset+5]);
  const sum=Number(parts[offset+6])||balls.reduce((a,b)=>a+(Number(b)||0),0);
  if(balls.length!==5||balls.some(n=>!Number.isFinite(n))||!Number.isFinite(power))throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  return {Round:Number(parts[1]),AllRound:Number(parts.length>=10?parts[2]:parts[1]),Date:dateFromKey(parts[0]),Time:'',
    nBall1:balls[0],nBall2:balls[1],nBall3:balls[2],nBall4:balls[3],nBall5:balls[4],nBallSum:sum,PowerBall:power,
    oddEven:oe(null,sum),pOddEven:oe(null,power),pUnderOver:uo(null,power)};
}
function normalizeLadder(parts){
  const six=parts.length>=6, rawResult=parts[six?3:2], rawStart=parts[six?4:3], lines=Number(parts[six?5:4]);
  const odd=/odd|홀/i.test(String(rawResult)), even=/even|짝/i.test(String(rawResult));
  const left=/left|좌/i.test(String(rawStart)), right=/right|우/i.test(String(rawStart));
  if((!odd&&!even)||(!left&&!right)||![3,4].includes(lines))throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  return {Round:Number(parts[1]),AllRound:Number(six?parts[2]:parts[1]),Date:dateFromKey(parts[0]),Time:'',
    oddEven:odd?1:2,pOddEven:odd?1:2,pUnderOver:left?1:2,ladder:{start:left?'left':'right',lines,result:odd?'odd':'even'}};
}
function normalizeJson(gameId,obj){
  const g=TOVIEW_GAMES[gameId],x=Array.isArray(obj)?obj[0]:obj;
  if(!x||typeof x!=='object')throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  if(g.type==='ladder'){
    const left=/left|좌/i.test(String(x.start??x.leftRight??x.startPosition??'')), right=/right|우/i.test(String(x.start??x.leftRight??x.startPosition??''));
    const odd=/odd|홀/i.test(String(x.result??x.oddEven??'')), even=/even|짝/i.test(String(x.result??x.oddEven??''));
    const lines=Number(x.lines??x.lineCount??x.ladderCount);
    if((!left&&!right)||(!odd&&!even)||![3,4].includes(lines))throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
    return {Round:Number(x.Round??x.round),AllRound:Number(x.AllRound??x.todayRound??x.round),Date:x.Date??x.date??'',Time:x.Time??x.time??'',
      oddEven:odd?1:2,pOddEven:odd?1:2,pUnderOver:left?1:2,ladder:{start:left?'left':'right',lines,result:odd?'odd':'even'}};
  }
  const nums=(x.numbers||x.balls||[x.nBall1,x.nBall2,x.nBall3,x.nBall4,x.nBall5]).map(Number).filter(Number.isFinite);
  if(gameId==='dh_speedkeno'){
    if(!nums.length)throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
    const sum=Number(x.nBallSum??x.numberSum??x.sum)||nums.reduce((a,b)=>a+b,0);
    return {Round:Number(x.Round??x.round),AllRound:Number(x.AllRound??x.todayRound??x.round),Date:x.Date??x.date??'',Time:x.Time??x.time??'',
      numbers:nums,nBallSum:sum,oddEven:oe(x.oddEven??x.numberSumOddEven,sum),pOddEven:oe(x.pOddEven??x.numberSumOddEven,sum),
      pUnderOver:uo(x.pUnderOver??x.underOver,sum)};
  }
  if(nums.length<5)throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  const power=Number(x.PowerBall??x.powerball??x.powerBall),balls=nums.slice(0,5),sum=Number(x.nBallSum??x.sum)||balls.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(power))throw Object.assign(new Error('RESULT_FORMAT'),{status:502});
  return {Round:Number(x.Round??x.round),AllRound:Number(x.AllRound??x.todayRound??x.round),Date:x.Date??x.date??'',Time:x.Time??x.time??'',
    nBall1:balls[0],nBall2:balls[1],nBall3:balls[2],nBall4:balls[3],nBall5:balls[4],nBallSum:sum,PowerBall:power,
    oddEven:oe(x.oddEven,sum),pOddEven:oe(x.pOddEven,power),pUnderOver:uo(x.pUnderOver,power)};
}
async function fetchProvider(gameId){
  const g=TOVIEW_GAMES[gameId];
  if(!g.url)throw Object.assign(new Error('PROVIDER_NOT_CONFIGURED'),{status:503});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const r=await fetch(g.url,{signal:controller.signal,headers:{Accept:'application/json,text/plain,*/*'}});
    const raw=(await r.text()).replace(/^\uFEFF/,'').trim();
    if(!r.ok)throw Object.assign(new Error('PROVIDER_HTTP_'+r.status),{status:502});
    // 차단 페이지를 우회하지 않는다.
    if(/access denied|forbidden|unauthorized|접속.*차단|접속.*불가/i.test(raw))throw Object.assign(new Error('PROVIDER_UNAVAILABLE'),{status:502});
    try{return normalizeJson(gameId,JSON.parse(raw))}catch(e){
      if(e.message!=='RESULT_FORMAT' && !(e instanceof SyntaxError))throw e;
      const parts=bracketParts(raw);
      return g.type==='ladder'?normalizeLadder(parts):normalizePowerball(parts);
    }
  }finally{clearTimeout(timer)}
}
async function saveGameResult(gameId,data,source){
  const round=Number(data.AllRound??data.Round);
  if(!Number.isFinite(round)||round<=0)return;
  gameMemory.set(gameId,{data,source,at:Date.now()});
  try{
    await pool.query(`INSERT INTO game_results(game_id,round_number,today_round,draw_date,draw_time,payload,source)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT(game_id,round_number) DO UPDATE SET payload=EXCLUDED.payload,source=EXCLUDED.source,draw_date=EXCLUDED.draw_date,draw_time=EXCLUDED.draw_time`,
      [gameId,round,Number(data.Round)||null,data.Date||'',data.Time||'',JSON.stringify(data),source||'provider']);
  }catch(e){console.error('게임 결과 저장 오류:',gameId,e.message)}
}
async function storedResults(gameId,limit=50){
  try{
    const q=await pool.query(`SELECT payload,source FROM game_results WHERE game_id=$1 ORDER BY round_number DESC LIMIT $2`,[gameId,limit]);
    return q.rows.map(r=>({...r.payload,source:r.payload?.source||r.source||'stored'}));
  }catch(e){
    console.error('게임 결과 DB 조회 오류:',gameId,e.message);
    const m=gameMemory.get(gameId); return m?[m.data]:[];
  }
}
function summarize(gameId,records){
  const g=TOVIEW_GAMES[gameId],s={total:records.length};
  if(g.type==='ladder'){
    s.left=records.filter(r=>r.ladder?.start==='left').length;s.right=records.filter(r=>r.ladder?.start==='right').length;
    s.line3=records.filter(r=>Number(r.ladder?.lines)===3).length;s.line4=records.filter(r=>Number(r.ladder?.lines)===4).length;
    s.odd=records.filter(r=>r.ladder?.result==='odd'||r.pOddEven===1).length;s.even=records.filter(r=>r.ladder?.result==='even'||r.pOddEven===2).length;
  }else{
    s.powerOdd=records.filter(r=>r.pOddEven===1).length;s.powerEven=records.filter(r=>r.pOddEven===2).length;
    s.powerUnder=records.filter(r=>r.pUnderOver===1).length;s.powerOver=records.filter(r=>r.pUnderOver===2).length;
    s.normalOdd=records.filter(r=>r.oddEven===1).length;s.normalEven=records.filter(r=>r.oddEven===2).length;
  }
  return s;
}
async function getUnifiedState(gameId){
  const g=TOVIEW_GAMES[gameId]; if(!g)throw Object.assign(new Error('지원하지 않는 게임입니다.'),{status:404});
  const clock=clockState(gameId);
  let providerError=null,source='stored';
  try{
    const fresh=await fetchProvider(gameId);
    await saveGameResult(gameId,fresh,'provider');
    source='provider';
  }catch(e){providerError=e.message}
  const records=await storedResults(gameId,50);
  const last=records[0]||null,lastRound=Number(last?.AllRound??last?.Round??0);
  const currentRound=lastRound>0?((lastRound%g.roundsPerDay)+1):clock.currentRound;
  return {ok:records.length>0,game:gameId,name:g.name,type:g.type,cycleSeconds:g.cycleSeconds,roundsPerDay:g.roundsPerDay,
    currentRound,remainingSeconds:clock.remainingSeconds,lastCompletedRound:lastRound||null,lastResult:last,
    recentResults:records,stats:summarize(gameId,records),source:records.length?(source==='provider'?'provider':'stored'):'waiting',
    providerConfigured:!!g.url,providerError};
}
app.get('/api/games',(req,res)=>res.json({ok:true,games:Object.values(TOVIEW_GAMES).map(({url,...g})=>({...g,providerConfigured:!!url}))}));
app.get('/api/game-state/:game',async(req,res)=>{
  try{return res.json(await getUnifiedState(String(req.params.game||'').toLowerCase()))}
  catch(e){return res.status(e.status||500).json({ok:false,error:e.message})}
});
// 이전 프론트 호환. 이제 동일한 game-state를 사용한다.
app.get('/api/games/:game/live',async(req,res)=>{
  try{
    const s=await getUnifiedState(String(req.params.game||'').toLowerCase());
    return res.json({ok:s.ok,game:s.game,name:s.name,type:s.type,cycleSeconds:s.cycleSeconds,renderer:s.type==='ladder'?'toview-ladder':'toview-balls',
      roundNumber:s.lastCompletedRound,todayRound:s.lastCompletedRound,source:s.source,data:s.lastResult,waiting:!s.lastResult});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message})}
});
app.get('/api/games/:game/results',async(req,res)=>{
  try{const s=await getUnifiedState(String(req.params.game||'').toLowerCase());return res.json({ok:true,game:s.game,records:s.recentResults})}
  catch(e){return res.status(e.status||500).json({ok:false,error:e.message,records:[]})}
});
app.get('/api/results',async(req,res)=>{
  try{const s=await getUnifiedState('dh_randomball');return res.json(s.recentResults)}
  catch(e){return res.status(e.status||500).json({error:e.message})}
});

app.listen(PORT,()=>console.log(`TOVIEW http://localhost:${PORT}`));
