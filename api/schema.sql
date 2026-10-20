CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  read_token_hash TEXT,
  created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_token ON users(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_read_token ON users(read_token_hash);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, card_id)
);

-- type: 'flip' | 'answer' | 'position' | 'session_start'; ok only for answers; data = JSON text
CREATE TABLE IF NOT EXISTS events (
  user_id TEXT NOT NULL,
  card_id TEXT,
  type TEXT NOT NULL,
  ok INTEGER,
  data TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts);
