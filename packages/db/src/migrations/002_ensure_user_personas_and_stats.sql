-- Migration 002: Ensure all registered users have default MOHPA personas and persona_stats
-- mohPA: Automatically enlist default soldier persona for every registered user

-- 1. Create a default persona for any registered user who does not yet have a persona for 'mohpa'
INSERT INTO personas (user_id, game_slug, name, is_active)
SELECT u.id, 'mohpa', u.username, TRUE
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM personas p WHERE p.user_id = u.id AND p.game_slug = 'mohpa'
)
ON CONFLICT (game_slug, name) DO NOTHING;

-- 2. Ensure every persona has a corresponding entry in persona_stats
INSERT INTO persona_stats (persona_id, score, kills, deaths, wins, losses, time_played_seconds, custom_stats)
SELECT p.id, 0, 0, 0, 0, 0, 0, '{}'::jsonb
FROM personas p
WHERE NOT EXISTS (
    SELECT 1 FROM persona_stats ps WHERE ps.persona_id = p.id
)
ON CONFLICT (persona_id) DO NOTHING;
