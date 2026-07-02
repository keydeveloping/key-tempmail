-- Tempik D1 Schema
-- Run: wrangler d1 execute tempik-db --file=src/db/schema.sql

CREATE TABLE IF NOT EXISTS inboxes (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  inbox_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT DEFAULT '(no subject)',
  body TEXT DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_address);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(inbox_address, received_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_inboxes (
  session_id TEXT NOT NULL,
  inbox_address TEXT NOT NULL,
  PRIMARY KEY (session_id, inbox_address),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_session_inboxes_session ON session_inboxes(session_id);
CREATE INDEX IF NOT EXISTS idx_session_inboxes_inbox ON session_inboxes(inbox_address);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(revoked_at, created_at DESC);
