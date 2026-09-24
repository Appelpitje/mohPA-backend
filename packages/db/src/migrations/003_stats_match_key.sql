-- One row per dedicated-server stats snapshot. NULL keys stay insertable.
ALTER TABLE match_history ADD COLUMN IF NOT EXISTS stats_match_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_history_stats_match_key
  ON match_history (stats_match_key);
