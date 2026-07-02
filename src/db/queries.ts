import type { D1Database } from '@cloudflare/workers-types';

export interface Inbox {
  address: string;
  created_at: string;
}

export interface Message {
  id: string;
  inbox_address: string;
  from_address: string;
  subject: string;
  body: string;
  received_at: string;
}

export interface Session {
  id: string;
  created_at: string;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

// ---- API keys ----

export async function listApiKeys(db: D1Database): Promise<ApiKeyPublic[]> {
  return db
    .prepare(
      `SELECT id, name, key_prefix, created_at, last_used_at
       FROM api_keys
       WHERE revoked_at IS NULL
       ORDER BY created_at DESC`
    )
    .all<ApiKeyPublic>()
    .then((r) => r.results);
}

export async function createApiKey(
  db: D1Database,
  id: string,
  name: string,
  keyHash: string,
  keyPrefix: string
): Promise<ApiKeyPublic | null> {
  await db
    .prepare('INSERT INTO api_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .bind(id, name, keyHash, keyPrefix)
    .run();

  return db
    .prepare('SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE id = ?')
    .bind(id)
    .first<ApiKeyPublic>();
}

export async function findActiveApiKeyByHash(db: D1Database, keyHash: string): Promise<{ id: string } | null> {
  return db
    .prepare('SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1')
    .bind(keyHash)
    .first<{ id: string }>();
}

export async function touchApiKeyUsed(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function revokeApiKey(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").bind(id).run();
}

// ---- Inboxes ----

export async function getInbox(db: D1Database, address: string): Promise<Inbox | null> {
  return db.prepare('SELECT * FROM inboxes WHERE address = ?').bind(address).first<Inbox>();
}

export async function createInbox(db: D1Database, address: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO inboxes (address) VALUES (?)').bind(address).run();
}

export async function deleteInbox(db: D1Database, address: string): Promise<void> {
  await db.prepare('DELETE FROM inboxes WHERE address = ?').bind(address).run();
}

export async function inboxExists(db: D1Database, address: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM inboxes WHERE address = ? LIMIT 1').bind(address).first();
  return !!row;
}

export async function getSessionInboxes(db: D1Database, sessionId: string): Promise<Inbox[]> {
  return db
    .prepare(
      `SELECT i.* FROM inboxes i
       INNER JOIN session_inboxes si ON si.inbox_address = i.address
       WHERE si.session_id = ?
       ORDER BY i.created_at DESC`
    )
    .bind(sessionId)
    .all<Inbox>()
    .then((r) => r.results);
}

export async function countSessionInboxes(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM session_inboxes WHERE session_id = ?')
    .bind(sessionId)
    .first<{ count: number }>();
  return row?.count || 0;
}

export async function deleteOrphanInboxes(db: D1Database): Promise<void> {
  await db
    .prepare(
      `DELETE FROM inboxes
       WHERE address NOT IN (SELECT inbox_address FROM session_inboxes)
         AND address NOT IN (SELECT inbox_address FROM messages)`
    )
    .run();
}

// ---- Messages ----

export async function getMessages(
  db: D1Database,
  inboxAddress: string,
  limit = 50,
  offset = 0
): Promise<Message[]> {
  return db
    .prepare(
      'SELECT * FROM messages WHERE inbox_address = ? ORDER BY received_at DESC LIMIT ? OFFSET ?'
    )
    .bind(inboxAddress, limit, offset)
    .all<Message>()
    .then((r) => r.results);
}

export async function countInboxMessages(db: D1Database, inboxAddress: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE inbox_address = ?')
    .bind(inboxAddress)
    .first<{ count: number }>();
  return row?.count || 0;
}

export async function insertMessage(
  db: D1Database,
  msg: Omit<Message, 'received_at'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages (id, inbox_address, from_address, subject, body)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(msg.id, msg.inbox_address, msg.from_address, msg.subject, msg.body)
    .run();
}

export async function deleteMessagesForInbox(db: D1Database, inboxAddress: string): Promise<void> {
  await db.prepare('DELETE FROM messages WHERE inbox_address = ?').bind(inboxAddress).run();
}

export async function deleteOldestMessagesForInbox(
  db: D1Database,
  inboxAddress: string,
  keepNewest: number
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM messages
       WHERE inbox_address = ?
         AND id NOT IN (
           SELECT id FROM messages
           WHERE inbox_address = ?
           ORDER BY received_at DESC
           LIMIT ?
         )`
    )
    .bind(inboxAddress, inboxAddress, keepNewest)
    .run();
}

export async function deleteOldMessages(db: D1Database, days: number): Promise<void> {
  await db
    .prepare("DELETE FROM messages WHERE received_at < datetime('now', ?)")
    .bind(`-${days} days`)
    .run();
}

// ---- Sessions ----

export async function ensureSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').bind(sessionId).run();
}

export async function sessionExists(db: D1Database, sessionId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
  return !!row;
}

export async function deleteOrphanSessions(db: D1Database, olderThanDays: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM sessions
       WHERE id NOT IN (SELECT session_id FROM session_inboxes)
         AND created_at < datetime('now', ?)`
    )
    .bind(`-${olderThanDays} days`)
    .run();
}

// ---- Session-Inbox links ----

export async function linkInboxToSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)'
    )
    .bind(sessionId, address)
    .run();
}

export async function unlinkInboxFromSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare('DELETE FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')
    .bind(sessionId, address)
    .run();
}

export async function isInboxInSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE session_id = ? AND inbox_address = ? LIMIT 1')
    .bind(sessionId, address)
    .first();
  return !!row;
}

export async function hasInboxLinks(db: D1Database, address: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE inbox_address = ? LIMIT 1')
    .bind(address)
    .first();
  return !!row;
}

// ---- Rate limits ----

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare('SELECT window_start, count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ window_start: number; count: number }>();

  if (!row || now - row.window_start >= windowSeconds) {
    await db
      .prepare('INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)')
      .bind(key, now)
      .run();
    return true;
  }

  if (row.count >= limit) return false;

  await db
    .prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
    .bind(key)
    .run();
  return true;
}

export async function cleanupRateLimits(db: D1Database, olderThanSeconds: number): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();
}
