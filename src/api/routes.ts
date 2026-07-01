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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INBOXES_PER_SESSION = 10;
const CREATE_INBOX_LIMIT_PER_MINUTE = 5;
const MESSAGE_PAGE_LIMIT_DEFAULT = 50;
const MESSAGE_PAGE_LIMIT_MAX = 100;

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

const api = new Hono<{ Bindings: ApiEnv }>();

// ---- GET /api/config ----
api.get('/config', (c) => {
  const domains = getDomains(c.env.MAIL_DOMAIN);
  return c.json({
    appName: c.env.APP_NAME || 'Tempik',
    mailDomain: domains[0] || 'example.com',
    mailDomains: domains,
    webHost: c.env.WEB_HOST || 'tempik.example.com',
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
