-- Migration 005: Dedicated Server History Snapshots & Player Activity Tracking

CREATE TABLE IF NOT EXISTS server_history_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
    player_count INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 64,
    is_online BOOLEAN NOT NULL DEFAULT TRUE,
    map_name VARCHAR(64) DEFAULT '',
    game_mode VARCHAR(64) DEFAULT '',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_history_snapshots_lookup 
    ON server_history_snapshots (server_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_history_snapshots_recorded_at 
    ON server_history_snapshots (recorded_at DESC);

-- Historical player presence and sessions per server
CREATE TABLE IF NOT EXISTS server_player_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
    player_name VARCHAR(64) NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_player_sessions_server_player 
    ON server_player_sessions (server_id, LOWER(player_name), last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_server_player_sessions_last_seen 
    ON server_player_sessions (last_seen DESC);
