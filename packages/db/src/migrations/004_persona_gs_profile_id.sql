-- GameSpy profile id echoed at FESL login (toGsNumericId of the user id).
ALTER TABLE personas ADD COLUMN IF NOT EXISTS gs_profile_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_personas_gs_profile_id ON personas (gs_profile_id);
