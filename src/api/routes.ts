import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getInbox,
  createInbox,
  inboxExists,
  getSessionInboxes,
  getMessages,
  ensureSession,
  sessionExists,
  linkInboxToSession,
  unlinkInboxFromSession,
  isInboxInSession,
  countSessionInboxes,
  checkRateLimit,
  hasInboxLinks,
  deleteMessagesForInbox,
  deleteInbox,
  listApiKeys,
  createApiKey,
  findActiveApiKeyByHash,
  touchApiKeyUsed,
  revokeApiKey,
} from '../db/queries';
import { generateUniqueAddress } from '../utils/random-address';
import {
  buildAddress,
  defaultDomain,
  getDomains,
  normalizeDomain,
  parseAddress,
  validateLocalPart,
} from '../utils/email-address';

export interface ApiEnv {
  DB: D1Database;
  APP_NAME: string;
  MAIL_DOMAIN: string;
  WEB_HOST: string;
  TEMPIK_PASSWORD: string;
  TEMPIK_API_KEY?: string;
  TEMPIK_AUTH_SECRET: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INBOXES_PER_SESSION = 10;
const CREATE_INBOX_LIMIT_PER_MINUTE = 5;
const MESSAGE_PAGE_LIMIT_DEFAULT = 50;
const MESSAGE_PAGE_LIMIT_MAX = 100;
const PRIVATE_COOKIE = 'tempik_private';
const PRIVATE_COOKIE_MAX_AGE = 24 * 60 * 60;

function sessionId(c: any): string | null {
  return (c.req.header('x-session-id') || '').trim() || null;
}

function isValidSessionId(sid: string): boolean {
  return UUID_RE.test(sid);
}

async function requireSession(c: any): Promise<string | Response> {
  const sid = sessionId(c);
  if (!sid) return c.json({ error: 'Missing x-session-id' }, 400);
  if (!isValidSessionId(sid)) return c.json({ error: 'Invalid x-session-id' }, 400);
  if (!(await sessionExists(c.env.DB, sid))) return c.json({ error: 'Unknown session' }, 401);
  return sid;
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function clientIp(c: any): string {
  return (c.req.header('cf-connecting-ip') || 'unknown').trim() || 'unknown';
}

async function withinCreateLimit(c: any, sid: string): Promise<boolean> {
  const ip = clientIp(c);
  const sessionOk = await checkRateLimit(
    c.env.DB,
    `create-inbox:session:${sid}`,
    CREATE_INBOX_LIMIT_PER_MINUTE,
    60
  );
  const ipOk = await checkRateLimit(
    c.env.DB,
    `create-inbox:ip:${ip}`,
    CREATE_INBOX_LIMIT_PER_MINUTE * 4,
    60
  );
  return sessionOk && ipOk;
}

function hasPrivateAuthConfig(env: ApiEnv): boolean {
  return !!env.TEMPIK_PASSWORD && !!env.TEMPIK_AUTH_SECRET;
}

function authToken(c: any): string | null {
  const apiKey = (c.req.header('x-api-key') || '').trim();
  if (apiKey) return apiKey;

  const header = (c.req.header('authorization') || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function cookieValue(c: any, name: string): string | null {
  const cookie = c.req.header('cookie') || '';
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=') || null;
  }
  return null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `pmail_sk_${base64Url(bytes)}`;
}

function apiKeyPrefix(key: string): string {
  return key.slice(0, 18);
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(signature));
}

async function hashApiKey(env: ApiEnv, key: string): Promise<string> {
  const data = new TextEncoder().encode(`${env.TEMPIK_AUTH_SECRET}:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64Url(new Uint8Array(digest));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < Math.max(aBytes.length, bBytes.length); i++) {
    diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return diff === 0;
}

async function createPrivateToken(env: ApiEnv): Promise<string> {
  const payload = base64UrlJson({ exp: Math.floor(Date.now() / 1000) + PRIVATE_COOKIE_MAX_AGE });
  return `${payload}.${await hmac(env.TEMPIK_AUTH_SECRET, payload)}`;
}

async function verifyPrivateToken(env: ApiEnv, token: string | null): Promise<boolean> {
  if (!token || !env.TEMPIK_AUTH_SECRET) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = await hmac(env.TEMPIK_AUTH_SECRET, payload);
  if (!(await safeEqual(signature, expected))) return false;

  const parsed = decodeBase64UrlJson<{ exp?: number }>(payload);
  return typeof parsed?.exp === 'number' && parsed.exp >= Math.floor(Date.now() / 1000);
}

async function isBrowserAuthed(c: any): Promise<boolean> {
  if (!hasPrivateAuthConfig(c.env)) return false;
  return verifyPrivateToken(c.env, cookieValue(c, PRIVATE_COOKIE));
}

async function isBearerAuthed(c: any): Promise<boolean> {
  if (!hasPrivateAuthConfig(c.env)) return false;

  const token = authToken(c);
  if (!token) return false;

  const apiKey = await findActiveApiKeyByHash(c.env.DB, await hashApiKey(c.env, token));
  if (apiKey) {
    await touchApiKeyUsed(c.env.DB, apiKey.id);
    return true;
  }

  return !!c.env.TEMPIK_API_KEY && await safeEqual(token, c.env.TEMPIK_API_KEY);
}

async function isPrivateAuthed(c: any): Promise<boolean> {
  return (await isBrowserAuthed(c)) || (await isBearerAuthed(c));
}

async function requireBrowserAuth(c: any): Promise<Response | null> {
  if (!hasPrivateAuthConfig(c.env)) return c.json({ error: 'Auth not configured' }, 500);
  if (!(await isBrowserAuthed(c))) return c.json({ error: 'Unauthorized' }, 401);
  return null;
}

function privateCookie(token: string, secure: boolean): string {
  const securePart = secure ? '; Secure' : '';
  return `${PRIVATE_COOKIE}=${token}; Max-Age=${PRIVATE_COOKIE_MAX_AGE}; Path=/; HttpOnly${securePart}; SameSite=Lax`;
}

function clearPrivateCookie(secure: boolean): string {
  const securePart = secure ? '; Secure' : '';
  return `${PRIVATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly${securePart}; SameSite=Lax`;
}

const api = new Hono<{ Bindings: ApiEnv }>();

// ---- POST /api/auth ----
api.post('/auth', async (c) => {
  if (!hasPrivateAuthConfig(c.env)) return c.json({ error: 'Auth not configured' }, 500);

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!(await safeEqual(password, c.env.TEMPIK_PASSWORD))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = await createPrivateToken(c.env);
  c.header('Set-Cookie', privateCookie(token, new URL(c.req.url).protocol === 'https:'));
  return c.json({ ok: true });
});

// ---- POST /api/logout ----
api.post('/logout', (c) => {
  c.header('Set-Cookie', clearPrivateCookie(new URL(c.req.url).protocol === 'https:'));
  return c.json({ ok: true });
});

// ---- GET /api/api-keys ----
api.get('/api-keys', async (c) => {
  const authError = await requireBrowserAuth(c);
  if (authError) return authError;
  return c.json(await listApiKeys(c.env.DB));
});

// ---- POST /api/api-keys ----
api.post('/api-keys', async (c) => {
  const authError = await requireBrowserAuth(c);
  if (authError) return authError;

  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 64) return c.json({ error: 'Name must be 1-64 characters' }, 400);

  const key = generateApiKey();
  const apiKey = await createApiKey(
    c.env.DB,
    crypto.randomUUID(),
    name,
    await hashApiKey(c.env, key),
    apiKeyPrefix(key)
  );

  return c.json({ ...apiKey, key }, 201);
});

// ---- DELETE /api/api-keys/:id ----
api.delete('/api-keys/:id', async (c) => {
  const authError = await requireBrowserAuth(c);
  if (authError) return authError;

  const id = c.req.param('id');
  if (!isValidSessionId(id)) return c.json({ error: 'Invalid API key id' }, 400);
  await revokeApiKey(c.env.DB, id);
  return c.json({ ok: true });
});

api.use('*', async (c, next) => {
  if (!hasPrivateAuthConfig(c.env)) return c.json({ error: 'Auth not configured' }, 500);
  if (!(await isPrivateAuthed(c))) return c.json({ error: 'Unauthorized' }, 401);
  return next();
});

// ---- GET /api/config ----
api.get('/config', (c) => {
  const domains = getDomains(c.env.MAIL_DOMAIN);
  return c.json({
    appName: c.env.APP_NAME || 'Pakuan Mail',
    mailDomain: domains[0] || 'example.com',
    mailDomains: domains,
    webHost: c.env.WEB_HOST || 'tempmail.example.com',
  });
});

// ---- GET /api/session ----
api.get('/session', async (c) => {
  const sid = sessionId(c);
  if (!sid) {
    const newSid = crypto.randomUUID();
    await ensureSession(c.env.DB, newSid);
    return c.json({ sessionId: newSid });
  }

  if (!isValidSessionId(sid)) return c.json({ error: 'Invalid x-session-id' }, 400);
  if (!(await sessionExists(c.env.DB, sid))) return c.json({ error: 'Unknown session' }, 401);
  return c.json({ sessionId: sid });
});

// ---- GET /api/inboxes ----
api.get('/inboxes', async (c) => {
  const sid = await requireSession(c);
  if (sid instanceof Response) return sid;

  const inboxes = await getSessionInboxes(c.env.DB, sid);
  return c.json(inboxes);
});

// ---- POST /api/inboxes ----
api.post('/inboxes', async (c) => {
  const sid = await requireSession(c);
  if (sid instanceof Response) return sid;

  if (!(await withinCreateLimit(c, sid))) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const domains = getDomains(c.env.MAIL_DOMAIN);
  const requestedDomain = normalizeDomain(body.domain || '');
  const domain = requestedDomain && domains.includes(requestedDomain)
    ? requestedDomain
    : defaultDomain(c.env.MAIL_DOMAIN);

  if (requestedDomain && !domains.includes(requestedDomain)) {
    return c.json({ error: `Invalid domain: ${requestedDomain}. Allowed: ${domains.join(', ')}` }, 400);
  }

  const requested = typeof body.localPart === 'string' ? validateLocalPart(body.localPart) : null;
  if (body.localPart && !requested) {
    return c.json({ error: 'Invalid localPart. Use 1-64 lowercase letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.' }, 400);
  }

  let address: string;
  if (requested) {
    address = buildAddress(requested, domain);
    if (await inboxExists(c.env.DB, address)) {
      if (await isInboxInSession(c.env.DB, sid, address)) {
        const inbox = await getInbox(c.env.DB, address);
        return c.json(inbox, 200);
      }
      return c.json({ error: 'Inbox unavailable' }, 409);
    }
  } else {
    address = await generateUniqueAddress(
      (addr) => inboxExists(c.env.DB, addr),
      domain
    );
  }

  if (await countSessionInboxes(c.env.DB, sid) >= MAX_INBOXES_PER_SESSION) {
    return c.json({ error: `Inbox quota exceeded. Max ${MAX_INBOXES_PER_SESSION} inboxes per session.` }, 403);
  }

  await createInbox(c.env.DB, address);
  await linkInboxToSession(c.env.DB, sid, address);

  const inbox = await getInbox(c.env.DB, address);
  return c.json(inbox!, 201);
});

// ---- DELETE /api/inboxes/:address ----
api.delete('/inboxes/:address', async (c) => {
  const sid = await requireSession(c);
  if (sid instanceof Response) return sid;

  const decodedAddress = decodeURIComponent(c.req.param('address'));
  const parsedAddress = parseAddress(decodedAddress);
  if (!parsedAddress) return c.json({ error: 'Invalid address' }, 400);
  const address = buildAddress(parsedAddress.localPart, parsedAddress.domain);

  if (!(await isInboxInSession(c.env.DB, sid, address))) {
    return c.json({ error: 'Inbox not in this session' }, 403);
  }

  await unlinkInboxFromSession(c.env.DB, sid, address);

  const linked = await hasInboxLinks(c.env.DB, address);
  if (!linked) {
    await deleteMessagesForInbox(c.env.DB, address);
    await deleteInbox(c.env.DB, address);
  }

  return c.json({ ok: true, deleted: !linked });
});

// ---- GET /api/inboxes/:address/messages ----
api.get('/inboxes/:address/messages', async (c) => {
  const sid = await requireSession(c);
  if (sid instanceof Response) return sid;

  const decodedAddress = decodeURIComponent(c.req.param('address'));
  const parsedAddress = parseAddress(decodedAddress);
  if (!parsedAddress) return c.json({ error: 'Invalid address' }, 400);
  const address = buildAddress(parsedAddress.localPart, parsedAddress.domain);

  if (!(await isInboxInSession(c.env.DB, sid, address))) {
    return c.json({ error: 'Inbox not in this session' }, 403);
  }

  const limit = clampInt(c.req.query('limit') || null, MESSAGE_PAGE_LIMIT_DEFAULT, 1, MESSAGE_PAGE_LIMIT_MAX);
  const offset = clampInt(c.req.query('offset') || null, 0, 0, Number.MAX_SAFE_INTEGER);
  const messages = await getMessages(c.env.DB, address, limit, offset);
  return c.json({
    messages,
    limit,
    offset,
    nextOffset: messages.length === limit ? offset + limit : null,
  });
});

export default api;
