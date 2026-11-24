-- House ranking tables. Prefixed so they can live alongside stb-ranking
-- tables in the shared production D1. Test D1 uses the same names.
-- Additive only: CREATE IF NOT EXISTS. Never ALTER/DROP existing objects.
CREATE TABLE IF NOT EXISTS house_players (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS house_players_nick ON house_players(nickname);
CREATE INDEX IF NOT EXISTS house_players_ip ON house_players(ip, created_at);

CREATE TABLE IF NOT EXISTS house_tokens (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  ip TEXT,
  issued_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS house_tokens_player ON house_tokens(player_id, issued_at);
CREATE INDEX IF NOT EXISTS house_tokens_ip ON house_tokens(ip, issued_at);

-- One row per submitted COM match (win or loss). Immutable.
CREATE TABLE IF NOT EXISTS house_wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  won INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS house_wins_player ON house_wins(player_id, issued_at);

-- One row per completed 3-consecutive-win window (rolling). Immutable. Period ranking uses MIN(ms).
CREATE TABLE IF NOT EXISTS house_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  week TEXT NOT NULL,
  month TEXT NOT NULL,
  year TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS house_scores_day ON house_scores(day, ms, created_at);
CREATE INDEX IF NOT EXISTS house_scores_week ON house_scores(week, ms, created_at);
CREATE INDEX IF NOT EXISTS house_scores_month ON house_scores(month, ms, created_at);
CREATE INDEX IF NOT EXISTS house_scores_year ON house_scores(year, ms, created_at);
CREATE INDEX IF NOT EXISTS house_scores_player ON house_scores(player_id, created_at);

-- All-time personal best (lower ms only).
CREATE TABLE IF NOT EXISTS house_bests (
  player_id TEXT PRIMARY KEY,
  ms INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS house_bests_board ON house_bests(ms, at);

CREATE TABLE IF NOT EXISTS house_medals (
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  board TEXT NOT NULL,
  rank INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  ms INTEGER NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (period_type, period_key, board, rank)
);
CREATE INDEX IF NOT EXISTS house_medals_player ON house_medals(player_id);

CREATE TABLE IF NOT EXISTS house_closed (
  period_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  closed_at INTEGER NOT NULL,
  PRIMARY KEY (period_type, period_key)
);
