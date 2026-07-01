import PostalMime from 'postal-mime';
import type { D1Database } from '@cloudflare/workers-types';
import {
  createInbox,
  deleteOldestMessagesForInbox,
  inboxExists,
  insertMessage,
} from './db/queries';
import { buildAddress, getDomains, isAllowedAddress, parseAddress } from './utils/email-address';

export interface EmailHandlerEnv {
  DB: D1Database;
  MAIL_DOMAIN: string;
}

const MAX_EMAIL_BODY_CHARS = 200_000;
const MAX_MESSAGES_PER_INBOX = 100;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Handles inbound email via Cloudflare Email Worker.
 * Called for every email received at any @<MAIL_DOMAIN> address.
 */
export async function handleEmail(message: ForwardableEmailMessage, env: EmailHandlerEnv): Promise<void> {
  console.log('[email] received');

  try {
    const rawTo = message.to.toLowerCase();
    const parsedTo = parseAddress(rawTo);
    const domains = getDomains(env.MAIL_DOMAIN);

    if (!parsedTo || !isAllowedAddress(rawTo, domains)) {
      console.log('[email] rejected invalid recipient');
      return;
    }

    const to = buildAddress(parsedTo.localPart, parsedTo.domain);
    const from = message.from.toLowerCase();
    const parser = new PostalMime();
    const parsed = await parser.parse(message.raw);

    const subject = truncate(parsed.subject || '(no subject)', 500);
    const rawBody = parsed.text?.trim() || (parsed.html ? stripHtml(parsed.html) : '');
    const body = truncate(rawBody, MAX_EMAIL_BODY_CHARS);

    const db = env.DB;

    if (!(await inboxExists(db, to))) {
      await createInbox(db, to);
      console.log('[email] created inbox');
    }

    const msgId = `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await insertMessage(db, {
      id: msgId,
      inbox_address: to,
      from_address: from,
      subject,
      body,
    });
    await deleteOldestMessagesForInbox(db, to, MAX_MESSAGES_PER_INBOX);

    console.log('[email] stored message');
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed to process message: ${messageText}`);
  }
}
