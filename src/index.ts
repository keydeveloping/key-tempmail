import api from './api/routes';
import { handleEmail } from './email-handler';
import type { EmailHandlerEnv } from './email-handler';
import type { ApiEnv } from './api/routes';
import {
  cleanupRateLimits,
  deleteOldMessages,
  deleteOrphanInboxes,
  deleteOrphanSessions,
} from './db/queries';

/**
 * Tempik - Disposable Temp Mail on Cloudflare Workers
 *
 * Handles:
 * - fetch()  → API routes (static files served via Cloudflare Assets)
 * - email()  → inbound email processing via Cloudflare Email Worker
 */

// Combined env bindings
export interface Env extends ApiEnv, EmailHandlerEnv {}

const RETENTION_DAYS = 7;
const RATE_LIMIT_RETENTION_SECONDS = 60 * 60;

export default {
  /**
   * HTTP fetch handler - serves API routes.
   * Static files (src/web/) are served via Cloudflare [assets].
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/* to Hono router (strip /api prefix)
    if (url.pathname.startsWith('/api/')) {
      const apiUrl = new URL(request.url);
      apiUrl.pathname = url.pathname.slice(4); // strip '/api'
      const apiRequest = new Request(apiUrl, request);
      return api.fetch(apiRequest, env, ctx);
    }

    // Fallback: should not happen when [assets] is configured properly
    return new Response('Not found', { status: 404 });
  },

  /**
   * Email handler - called by Cloudflare for every inbound email
   * at any @<MAIL_DOMAIN> address.
   */
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await deleteOldMessages(env.DB, RETENTION_DAYS);
    await deleteOrphanInboxes(env.DB);
    await deleteOrphanSessions(env.DB, RETENTION_DAYS);
    await cleanupRateLimits(env.DB, RATE_LIMIT_RETENTION_SECONDS);
  },
};
