-- Installed on house_* tables (prod: inside stb-ranking D1; test: house-ranking-test).
-- Trigger names are also house-prefixed so they never collide with stb-ranking triggers.
-- Additive only: CREATE TRIGGER IF NOT EXISTS. Never ALTER/DROP existing objects.
CREATE TRIGGER IF NOT EXISTS protect_house_players_delete BEFORE DELETE ON house_players BEGIN SELECT RAISE(ABORT, 'house_players are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_players_update BEFORE UPDATE ON house_players WHEN NEW.id IS NOT OLD.id OR NEW.secret_hash IS NOT OLD.secret_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT, 'house_players: only nickname may change'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_wins_delete BEFORE DELETE ON house_wins BEGIN SELECT RAISE(ABORT, 'house_wins are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_wins_update BEFORE UPDATE ON house_wins BEGIN SELECT RAISE(ABORT, 'house_wins are immutable: UPDATE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_scores_delete BEFORE DELETE ON house_scores BEGIN SELECT RAISE(ABORT, 'house_scores are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_scores_update BEFORE UPDATE ON house_scores BEGIN SELECT RAISE(ABORT, 'house_scores are immutable: UPDATE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_bests_delete BEFORE DELETE ON house_bests BEGIN SELECT RAISE(ABORT, 'house_bests are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_bests_update BEFORE UPDATE ON house_bests WHEN NEW.player_id IS NOT OLD.player_id OR NEW.ms > OLD.ms BEGIN SELECT RAISE(ABORT, 'house_bests may only improve (lower ms)'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_medals_delete BEFORE DELETE ON house_medals BEGIN SELECT RAISE(ABORT, 'house_medals are permanent: DELETE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_medals_update BEFORE UPDATE ON house_medals BEGIN SELECT RAISE(ABORT, 'house_medals are immutable: UPDATE blocked'); END;
CREATE TRIGGER IF NOT EXISTS protect_house_closed_delete BEFORE DELETE ON house_closed BEGIN SELECT RAISE(ABORT, 'house_closed periods are permanent: DELETE blocked'); END;
