# Tempik — Disposable Temp Mail on Cloudflare Workers

Tempik is a **self-hosted disposable email** service that runs entirely on **Cloudflare Workers** — no VPS required. It uses Cloudflare Email Workers to receive inbound email, D1 for storage, and serves a clean web UI from the edge.

> **Repo**: [github.com/keydeveloping/key-tempmail](https://github.com/keydeveloping/key-tempmail)

---

## How it works

```
Sender → Cloudflare MX → Email Worker (email handler)
                                  │
                                  ▼
                          D1 Database (SQLite)
                                  │
                                  ▼
                   Worker HTTP handler → Web UI + API
```

- **No VPS** — everything runs on Cloudflare's edge
- **No Postfix** — Cloudflare Email Workers handle SMTP ingestion natively
- **No Docker** — just `wrangler deploy`
- **Zero cost** — fits within Cloudflare's free tier

---

## Prerequisites

Before you start, you need:

| Requirement | Details |
|---|---|
| **Cloudflare account** | [Sign up here](https://dash.cloudflare.com/sign-up) (free) |
| **A domain** | Must be added to Cloudflare (nameservers pointed to Cloudflare) |
| **Node.js** | v18 or later ([download](https://nodejs.org/)) |
| **npm** | Comes with Node.js |

---

## Step 1 — Clone & install dependencies

```bash
git clone https://github.com/keydeveloping/key-tempmail.git
cd key-tempmail
npm install
```

---

## Step 2 — Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Log in with your Cloudflare account and approve the OAuth scopes.

> **What scopes are needed?**
> Wrangler will request permissions for Workers, D1, Email Routing, Pages, and more. You must approve all of them so the CLI can create the database and deploy the worker.

Verify you're logged in:

```bash
npx wrangler whoami
```

---

## Step 3 — Configure wrangler.toml

Open `wrangler.toml` and replace the placeholder values with your own:

```toml
name = "tempik"
main = "src/index.ts"
compatibility_date = "2025-06-01"

# Set to false when using your own domain (skip workers.dev)
workers_dev = false

# D1 Database — leave database_id empty for now, we'll fill it in Step 4
[[d1_databases]]
binding = "DB"
database_name = "tempik-db"
database_id = ""

# Email Worker
[email]
action = "process"

# Custom domain — CHANGE THIS to your own domain
[[routes]]
pattern = "tempik.YOURDOMAIN.com"
custom_domain = true

# Environment — CHANGE THESE
[vars]
APP_NAME = "Tempik"
MAIL_DOMAIN = "YOURDOMAIN.com"
WEB_HOST = "tempik.YOURDOMAIN.com"

# Static assets (don't change)
[assets]
directory = "./src/web"

[triggers]
crons = ["17 */6 * * *"]

[observability]
enabled = true
```

**All three `vars` + the routes `pattern` must be updated:**
- `YOURDOMAIN.com` → your actual domain (e.g. `example.com`)
- `tempik.YOURDOMAIN.com` → the subdomain for the web UI

---

## Step 4 — Create the D1 database

```bash
npx wrangler d1 create tempik-db
```

You'll see output like:

```
✅ Successfully created DB 'tempik-db'

[[d1_databases]]
binding = "DB"
database_name = "tempik-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` into your `wrangler.toml`.

---

## Step 5 — Apply the database schema

Push the schema to your **remote** D1 database on Cloudflare:

```bash
npx wrangler d1 execute tempik-db --remote --file=src/db/schema.sql
```

This creates six tables:
- `inboxes` — email addresses
- `messages` — received emails
- `sessions` — browser session tokens
- `session_inboxes` — which inboxes belong to which session
- `rate_limits` — short-lived API rate-limit counters
- `api_keys` — hashed agent API keys and revocation metadata

> **Note:** The `--remote` flag is important — without it, the schema only applies locally. You want it on Cloudflare's servers.

---

## Step 6 — Deploy the Worker

```bash
npx wrangler deploy
```

This does three things:
1. Uploads the TypeScript Worker code
2. Uploads the static frontend files (HTML/CSS/JS) to Cloudflare Assets (edge CDN)
3. Registers the custom domain route

After a successful deploy, you'll see the custom domain and the cleanup schedule:

```txt
Deployed tempik triggers
  tempik.YOURDOMAIN.com (custom domain)
  schedule: 17 */6 * * *
```

If schedule deployment fails with `You need a workers.dev subdomain`, open **Cloudflare Dashboard → Workers & Pages** once and set an account `workers.dev` subdomain, then rerun `npx wrangler deploy`. You can keep the `workers.dev` route disabled; the subdomain is still required by Cloudflare for cron schedules.

---

## Step 7 — Setup DNS on Cloudflare

### 7a. Web UI (automatic)

Cloudflare automatically creates the DNS record for your Worker's custom domain. If it doesn't:

- Go to **Cloudflare Dashboard → Workers & Pages → tempik → Settings → Domains**
- The custom domain `tempik.YOURDOMAIN.com` should already be listed

### 7b. Enable Email Routing

Enable Email Routing for your mail domain:

```bash
npx wrangler email routing enable YOURDOMAIN.com
```

Verify the status:

```bash
npx wrangler email routing settings YOURDOMAIN.com
```

Expected output:

```txt
Enabled:  true
Status:   ready
```

### 7c. Verify MX/SPF/DKIM records

Show the DNS records Cloudflare expects:

```bash
npx wrangler email routing dns get YOURDOMAIN.com
```

Verify DNS propagation:

```bash
dig MX YOURDOMAIN.com +short
dig TXT YOURDOMAIN.com +short
dig TXT cf2024-1._domainkey.YOURDOMAIN.com +short
```

You should see three `route*.mx.cloudflare.net` MX records, an SPF TXT record, and a DKIM TXT record. Add any missing records in Cloudflare DNS.

### 7d. Route catch-all email to the Worker

Open **Cloudflare Dashboard → your domain → Email → Email Routing → Routing rules**.

Enable the existing **Catch-all** rule and set:

| Field | Value |
|---|---|
| Action | Send to a Worker |
| Destination | `tempik` |
| Status | Active |

Verify from CLI:

```bash
npx wrangler email routing rules get YOURDOMAIN.com catch-all
```

Expected output:

```txt
Catch-all rule:
  Enabled: true
  Actions:
    - worker: tempik
```

> Note: In Wrangler 4.106, `email routing rules update ... catch-all --action-type worker` may fail even though the Dashboard supports catch-all → Worker. Use the Dashboard toggle for this step.

---

## Step 8 — Test it

1. Open `https://tempik.YOURDOMAIN.com` in your browser
2. Click **New** → **Random** to create a disposable address
3. Send an email from Gmail/any provider to that address
4. Click **Refresh** — the email appears in your inbox

---

## Commands cheat sheet

| Command | What it does |
|---|---|
| `npm run deploy` | Deploy Worker + static assets |
| `npm run db:migrate` | Apply schema to production D1 |
| `npm run db:local` | Apply schema to local D1 (for dev) |
| `npm run typecheck` | Run TypeScript type checks |
| `npx wrangler dev` | Run Worker locally |
| `npx wrangler tail` | Stream live logs from production |
| `npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages LIMIT 10"` | Query the database |

### Set private access secrets

```bash
npx wrangler secret put TEMPIK_PASSWORD
npx wrangler secret put TEMPIK_AUTH_SECRET
```

Use `TEMPIK_PASSWORD` for the browser login. After login, create per-agent API keys in the Web UI. Deleted keys are revoked immediately.

### Agent API example

```bash
# Create PAKUAN_API_KEY in the Web UI first.
SID=$(curl -sS \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  https://tempik.YOURDOMAIN.com/api/session | jq -r .sessionId)

curl -sS \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: $SID" \
  -H "Content-Type: application/json" \
  -d '{"domain":"YOURDOMAIN.com"}' \
  https://tempik.YOURDOMAIN.com/api/inboxes
```

### Check if emails are being received

```bash
npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
```

### Watch live logs

```bash
npx wrangler tail --format pretty
```

Then send a test email — you'll see the Worker processing it in real time. Logs avoid full email addresses, subjects, and message bodies.

---

## Project structure

```
key-tempmail/
├── wrangler.toml              # Worker config, D1 binding, routes, env vars
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts               # Entry point: fetch() + email() handlers
    ├── email-handler.ts       # Parses inbound email via PostalMime → D1
    ├── api/
    │   └── routes.ts          # Hono router: /api/config, /api/session, /api/inboxes, /api/messages
    ├── db/
    │   ├── schema.sql         # D1 tables (inboxes, messages, sessions, session_inboxes, rate_limits, api_keys)
    │   └── queries.ts         # Typed query functions
    ├── utils/
    │   ├── random-address.ts  # Human-like random email generator
    │   └── email-address.ts   # Address/domain validation helpers
    └── web/
        ├── index.html         # Frontend UI
        ├── app.js             # Frontend logic (vanilla JS)
        └── styles.css         # Dark theme styles
```

---

## Tech stack

| Layer | Tech |
|---|---|
| **Runtime** | Cloudflare Workers |
| **Router** | Hono |
| **Email parsing** | PostalMime |
| **Database** | Cloudflare D1 (SQLite) |
| **Static hosting** | Cloudflare Workers Assets (edge CDN) |
| **Language** | TypeScript |
| **CLI** | Wrangler v4 |

---

## Security and privacy defaults

- Browser access is protected by a password gate. Set it with `npx wrangler secret put TEMPIK_PASSWORD`.
- API access for agents is protected by revocable API keys generated in the Web UI.
- Browser auth cookies are signed with `TEMPIK_AUTH_SECRET`. Set it with `npx wrangler secret put TEMPIK_AUTH_SECRET`.
- Never commit real secret values to the repo or `wrangler.toml`.
- Custom inboxes cannot claim addresses that already exist outside the current session.
- Session headers must be valid sessions created by `/api/session`.
- Custom usernames are validated before an email address is created.
- Email content is rendered as text in the UI, not HTML.
- Inbox creation is rate-limited and capped at 10 inboxes per session.
- Message reads are paginated.
- Each inbox keeps the newest 100 messages; scheduled cleanup removes messages older than 7 days.
- Inbound email is accepted only for configured `MAIL_DOMAIN` values.
- Worker logs avoid full email addresses, subjects, and message bodies.

---

## Troubleshooting

### "This site can't be reached / DNS_PROBE_FINISHED_NXDOMAIN"

Your domain's nameservers are not pointed to Cloudflare, or the DNS record hasn't propagated yet. Check:

```bash
dig +short YOURDOMAIN.com NS
```

Should show `*.ns.cloudflare.com`. Propagation can take up to 24 hours after changing nameservers.

### Emails not appearing in the web UI

1. Confirm catch-all routing is active:
   ```bash
   npx wrangler email routing rules get YOURDOMAIN.com catch-all
   ```
   It should show `Enabled: true` and `worker: tempik`.
2. Make sure the inbox was created in the same browser session before reading it. Existing inboxes cannot be claimed from another session.
3. Check the database:
   ```bash
   npx wrangler d1 execute tempik-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
   ```
4. Check live logs:
   ```bash
   npx wrangler tail --format pretty
   ```

### "Unexpected fields found in top-level field: email"

This is a known wrangler warning — it's cosmetic. The `[email]` config works fine. Cloudflare is still stabilizing the Email Worker integration.

### Wrangler version mismatch

This project uses **Wrangler v4**. If you're on v3:

```bash
npm install --save-dev wrangler@4
```

---

## License

MIT

---

Forked from [masantoid/tempik](https://github.com/hirotomasato/tempik). Maintained at [keydeveloping/key-tempmail](https://github.com/keydeveloping/key-tempmail).
