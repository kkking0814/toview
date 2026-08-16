CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, username VARCHAR(40) UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 nickname VARCHAR(30) UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK(role IN('user','moderator','admin')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game_rounds (
 round_id BIGSERIAL PRIMARY KEY, game_id VARCHAR(64) NOT NULL, draw_date DATE NOT NULL, round_number INTEGER NOT NULL,
 scheduled_at TIMESTAMPTZ NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','CLOSED','RESULT')),
 UNIQUE(game_id,draw_date,round_number)
);
CREATE TABLE IF NOT EXISTS game_results (
 result_id BIGSERIAL PRIMARY KEY, round_id BIGINT UNIQUE REFERENCES game_rounds(round_id) ON DELETE RESTRICT, game_id VARCHAR(64) NOT NULL, draw_date DATE NOT NULL, round_number INTEGER NOT NULL,
 scheduled_at TIMESTAMPTZ, status VARCHAR(16) NOT NULL DEFAULT 'RESULT', result_json JSONB NOT NULL,
 source_received_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(game_id,draw_date,round_number)
);
CREATE INDEX IF NOT EXISTS game_results_lookup ON game_results(game_id,draw_date,round_number DESC);
CREATE TABLE IF NOT EXISTS mini_game_picks (
 pick_id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 round_id BIGINT NOT NULL REFERENCES game_rounds(round_id) ON DELETE RESTRICT,
 market_type VARCHAR(32) NOT NULL, selection VARCHAR(32) NOT NULL,
 visibility VARCHAR(16) NOT NULL DEFAULT 'FOLLOWERS' CHECK(visibility IN('PUBLIC','FOLLOWERS','MUTUALS','PRIVATE')),
 verdict VARCHAR(16) CHECK(verdict IN('WIN','LOSE','VOID')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,round_id,market_type)
);
CREATE TABLE IF NOT EXISTS follows (follower_id BIGINT REFERENCES users(id) ON DELETE CASCADE, following_id BIGINT REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(follower_id,following_id), CHECK(follower_id<>following_id));
CREATE TABLE IF NOT EXISTS blocks (blocker_id BIGINT REFERENCES users(id) ON DELETE CASCADE, blocked_id BIGINT REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id));
CREATE TABLE IF NOT EXISTS posts (id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,board_id VARCHAR(16) NOT NULL CHECK(board_id IN('notice','free','analysis')),title VARCHAR(160) NOT NULL,body TEXT NOT NULL,is_pinned BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS comments (id BIGSERIAL PRIMARY KEY,post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS verified_partners (id BIGSERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',guarantee_period TEXT,last_reviewed_at DATE,rating NUMERIC(2,1),url TEXT,logo_url TEXT,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS ad_campaigns (id BIGSERIAL PRIMARY KEY,advertiser VARCHAR(80) NOT NULL,slot_id VARCHAR(64) NOT NULL,image_url TEXT NOT NULL,mobile_image_url TEXT,target_url TEXT NOT NULL,weight INTEGER NOT NULL DEFAULT 100,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS admin_audit_logs (id BIGSERIAL PRIMARY KEY,admin_user_id BIGINT REFERENCES users(id),action VARCHAR(80) NOT NULL,target_type VARCHAR(40),target_id TEXT,meta JSONB,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS sports_events (event_id BIGSERIAL PRIMARY KEY,provider_key TEXT UNIQUE,name TEXT NOT NULL,sport VARCHAR(30) NOT NULL,league TEXT,home_name TEXT,away_name TEXT,start_at TIMESTAMPTZ NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',home_score INTEGER,away_score INTEGER,stream_provider VARCHAR(24),stream_ref TEXT,updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS sports_picks (pick_id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,event_id BIGINT REFERENCES sports_events(event_id) ON DELETE RESTRICT,market_type VARCHAR(32) NOT NULL,selection VARCHAR(32) NOT NULL,visibility VARCHAR(16) NOT NULL DEFAULT 'FOLLOWERS' CHECK(visibility IN('PUBLIC','FOLLOWERS','MUTUALS','PRIVATE')),verdict VARCHAR(16) CHECK(verdict IN('WIN','LOSE','VOID')),created_at TIMESTAMPTZ DEFAULT now(),UNIQUE(user_id,event_id,market_type));
CREATE TABLE IF NOT EXISTS web_sessions (sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expire_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS web_sessions_expire ON web_sessions(expire_at);
CREATE TABLE IF NOT EXISTS email_verifications (
 email TEXT PRIMARY KEY,
 code_hash TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 verified_at TIMESTAMPTZ
);
