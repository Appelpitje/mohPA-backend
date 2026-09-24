-- Migration 006: Sync accumulated server player sessions into persona_stats
UPDATE persona_stats ps
SET
  time_played_seconds = GREATEST(ps.time_played_seconds, COALESCE(s.total_time, 0)),
  score = GREATEST(ps.score, COALESCE(s.max_score, 0)),
  kills = GREATEST(ps.kills, COALESCE(s.total_kills, 0)),
  deaths = GREATEST(ps.deaths, COALESCE(s.total_deaths, 0))
FROM personas p
JOIN (
  SELECT
    LOWER(player_name) as p_name,
    SUM(duration_seconds) as total_time,
    MAX(score) as max_score,
    SUM(kills) as total_kills,
    SUM(deaths) as total_deaths
  FROM server_player_sessions
  GROUP BY LOWER(player_name)
) s ON s.p_name = LOWER(p.name)
WHERE ps.persona_id = p.id;
