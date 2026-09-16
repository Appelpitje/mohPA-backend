-- mohPA Initial Database Schema Migration 001

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    country_code VARCHAR(8) NOT NULL DEFAULT 'US',
    dob DATE NOT NULL DEFAULT '2000-01-01',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

-- Personas Table (Soldiers / In-game identities)
CREATE TABLE IF NOT EXISTS personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_slug VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_game_slug_persona_name UNIQUE (game_slug, name)
);

CREATE INDEX IF NOT EXISTS idx_personas_user_id ON personas (user_id);
CREATE INDEX IF NOT EXISTS idx_personas_game_slug_name ON personas (game_slug, LOWER(name));

-- Entitlements Table (CD Keys & Game Licenses)
CREATE TABLE IF NOT EXISTS entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    game_slug VARCHAR(32) NOT NULL,
    cd_key VARCHAR(64) NOT NULL UNIQUE,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    activated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_entitlements_user_id ON entitlements (user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_key ON entitlements (cd_key);
CREATE INDEX IF NOT EXISTS idx_entitlements_game ON entitlements (game_slug);

-- Game Servers Table
CREATE TABLE IF NOT EXISTS game_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    game_slug VARCHAR(32) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    port INTEGER NOT NULL,
    query_port INTEGER NOT NULL DEFAULT 0,
    secret_key VARCHAR(128) NOT NULL UNIQUE,
    is_ranked BOOLEAN NOT NULL DEFAULT TRUE,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    max_players INTEGER NOT NULL DEFAULT 64,
    current_players INTEGER NOT NULL DEFAULT 0,
    map_name VARCHAR(64) DEFAULT '',
    game_mode VARCHAR(64) DEFAULT '',
    sub_state VARCHAR(64) DEFAULT 'LOBBY',
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_game_servers_game_slug ON game_servers (game_slug);
CREATE INDEX IF NOT EXISTS idx_game_servers_online ON game_servers (is_online);
CREATE INDEX IF NOT EXISTS idx_game_servers_ip_port ON game_servers (ip_address, port);

-- Persona Stats Table
CREATE TABLE IF NOT EXISTS persona_stats (
    persona_id UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    score BIGINT NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    time_played_seconds BIGINT NOT NULL DEFAULT 0,
    custom_stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_persona_stats_score ON persona_stats (score DESC);
CREATE INDEX IF NOT EXISTS idx_persona_stats_kills ON persona_stats (kills DESC);

-- Match History Table
CREATE TABLE IF NOT EXISTS match_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES game_servers(id) ON DELETE SET NULL,
    game_slug VARCHAR(32) NOT NULL,
    map_name VARCHAR(64) NOT NULL,
    game_mode VARCHAR(64) NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    winner_team INTEGER,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_history_game_slug ON match_history (game_slug);
CREATE INDEX IF NOT EXISTS idx_match_history_created_at ON match_history (created_at DESC);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
