# Pakuan Mail API

Pakuan Mail exposes a private REST API for session management, inbox operations, and message retrieval. All endpoints live under `/api/`.

**Base URL:** `https://YOUR_DOMAIN/api/`

---

## Authentication

Pakuan Mail has two auth layers:

1. **Private app auth** — every API request requires either:
   - a browser auth cookie from `POST /api/auth`, or
   - `Authorization: Bearer <PAKUAN_API_KEY>` for agents/scripts. Generate keys in the Web UI after browser login.
2. **Anonymous inbox session** — after private auth, call `GET /api/session` to obtain a `sessionId`, then pass `x-session-id` on inbox/message requests.

Inboxes are scoped to the session: Browser A cannot see Browser B's inboxes. Agents should keep and reuse their own `sessionId`.

Agent requests must include:

```http
Authorization: Bearer <PAKUAN_API_KEY>
```

Browser requests use the HttpOnly cookie from `POST /api/auth` instead. API keys can be revoked individually from the Web UI; revoked keys immediately return `401`.

---

## Endpoints

### POST `/api/auth`

Authenticates browser access with the private password and sets an HttpOnly auth cookie.

**Request Body**

```json
{ "password": "your-password" }
```

**Response** `200 OK`

```json
{ "ok": true }
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `401` | `Unauthorized` | Wrong password |
| `500` | `Auth not configured` | Worker secrets are missing |

---

### POST `/api/logout`

Clears the browser auth cookie.

**Response** `200 OK`

```json
{ "ok": true }
```

---

### GET `/api/api-keys`

Lists active API keys. Requires browser cookie auth; bearer API keys cannot manage keys.

**Response** `200 OK`

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Claude agent",
    "key_prefix": "pmail_sk_abc123...",
    "created_at": "2026-07-02 09:00:00",
    "last_used_at": null
  }
]
```

---

### POST `/api/api-keys`

Creates an API key. The raw key is returned once; copy it immediately.

**Request Body**

```json
{ "name": "Claude agent" }
```

**Response** `201 Created`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Claude agent",
  "key": "pmail_sk_...",
  "key_prefix": "pmail_sk_abc123...",
  "created_at": "2026-07-02 09:00:00",
  "last_used_at": null
}
```

---

### DELETE `/api/api-keys/:id`

Revokes an API key. Requires browser cookie auth; bearer API keys cannot revoke keys.

**Response** `200 OK`

```json
{ "ok": true }
```

---

### GET `/api/config`

Returns the public app configuration.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |

**Response** `200 OK`

```json
{
  "appName": "Pakuan Mail",
  "mailDomain": "example.com",
  "mailDomains": ["example.com", "another-domain.my.id"],
  "webHost": "tempik.example.com"
}
```

| Field | Type | Description |
|---|---|---|
| `appName` | string | App display name |
| `mailDomain` | string | Default mail domain (first in the list, for backward compat) |
| `mailDomains` | string[] | All available mail domains |
| `webHost` | string | Web frontend hostname |

---

### GET `/api/session`

Creates or retrieves an anonymous browser session. If you don't pass `x-session-id`, it generates a new session. If you pass `x-session-id`, it must be a valid UUID for an existing session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |
| `x-session-id` | No | Existing session ID (UUID v4). Omit to create a new session. |

**Response** `200 OK`

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Usage**

```bash
# Create a new session
curl -s https://YOUR_DOMAIN/api/session \
  -H "Authorization: Bearer $PAKUAN_API_KEY"

# Reuse an existing session
curl -s https://YOUR_DOMAIN/api/session \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### GET `/api/inboxes`

Lists all inboxes linked to your session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |
| `x-session-id` | **Yes** | Session ID from `/api/session` |

**Response** `200 OK`

```json
[
  {
    "address": "kopihujan23@example.com",
    "created_at": "2026-06-26 07:48:19"
  }
]
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` / `Invalid x-session-id` | No session header or malformed UUID provided |
| `401` | `Unauthorized` / `Unknown session` | Missing private auth, or session ID was not created by `/api/session` |

**Usage**

```bash
curl -s https://YOUR_DOMAIN/api/inboxes \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### POST `/api/inboxes`

Creates a new inbox and links it to your session. Existing inboxes cannot be claimed from another session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |
| `x-session-id` | **Yes** | Session ID |
| `Content-Type` | Yes | `application/json` |

**Request Body**

| Field | Required | Description |
|---|---|---|
| `localPart` | No | Custom username (e.g. `"myname"`). Omit for a random address. Must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens; must start/end with a letter or number; `..` is rejected. |
| `domain` | No | Domain override. Must be one of the allowed domains from `GET /api/config`'s `mailDomains`. Defaults to the first configured domain. Invalid domains are rejected with `400`. |

**Examples**

```json
// Custom address on default domain
{ "localPart": "myinbox" }
// → myinbox@example.com

// Random address
{}
// → langitbiru23@example.com

// Custom address on specific domain
{ "localPart": "test", "domain": "another-domain.my.id" }
// → test@another-domain.my.id

// Random on specific domain
{ "domain": "another-domain.my.id" }
// → melatijaya87@another-domain.my.id

// Invalid domain → 400
{ "domain": "evil.com" }
// → { "error": "Invalid domain: evil.com. Allowed: example.com, another-domain.my.id" }
```

**Response** `201 Created`

```json
{
  "address": "langitbiru23@example.com",
  "created_at": "2026-06-26 07:48:19"
}
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` / `Invalid x-session-id` | No session header or malformed UUID provided |
| `401` | `Unauthorized` / `Unknown session` | Missing private auth, or session ID was not created by `/api/session` |
| `400` | `Invalid domain: ...` / `Invalid localPart...` | Requested domain or username is invalid. |
| `409` | `Inbox unavailable` | The requested custom inbox already exists outside this session. |
| `429` | `Rate limit exceeded` | Too many inbox creation attempts. |

**Notes**
- Existing inboxes are not claimable from another session; custom duplicates return `409`
- Each session can have up to 10 inboxes
- Random addresses are human-readable Indonesian-style (e.g. `kopihujan42`, `bulanbiru17`)
- The generator checks the actual database for uniqueness — it never creates duplicates, even across different sessions

**Usage**

```bash
# Create with custom name
curl -s -X POST https://YOUR_DOMAIN/api/inboxes \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"localPart":"myinbox"}'

# Create random
curl -s -X POST https://YOUR_DOMAIN/api/inboxes \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### DELETE `/api/inboxes/:address`

Removes an inbox from your session. If no other session links to that inbox, its messages and inbox row are deleted from the database.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |
| `x-session-id` | **Yes** | Session ID |

**Path Parameters**

| Param | Description |
|---|---|
| `address` | Full email address, URI-encoded. Example: `test123%40example.com` |

**Response** `200 OK`

```json
{ "ok": true, "deleted": true }
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` / `Invalid x-session-id` / `Invalid address` | Missing or invalid request data |
| `401` | `Unauthorized` / `Unknown session` | Missing private auth, or session ID was not created by `/api/session` |
| `403` | `Inbox not in this session` | The inbox is not linked to your session |

**Usage**

```bash
curl -s -X DELETE "https://YOUR_DOMAIN/api/inboxes/test123%40example.com" \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

### GET `/api/inboxes/:address/messages`

Fetches paginated messages for a given inbox. The inbox must be linked to your session.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | For agents | `Bearer <PAKUAN_API_KEY>`; browsers use the auth cookie from `/api/auth`. |
| `x-session-id` | **Yes** | Session ID |

**Path Parameters**

| Param | Description |
|---|---|
| `address` | Full email address, URI-encoded. |

**Query Parameters**

| Param | Description |
|---|---|
| `limit` | Messages per page, 1-100. Defaults to 50. |
| `offset` | Zero-based offset. Defaults to 0. |

**Response** `200 OK`

```json
{
  "messages": [
    {
      "id": "msg_1782461413912_0956a83c",
      "inbox_address": "test123@example.com",
      "from_address": "someone@gmail.com",
      "subject": "Hello",
      "body": "This is the email body",
      "received_at": "2026-06-26 08:10:14"
    }
  ],
  "limit": 50,
  "offset": 0,
  "nextOffset": null
}
```

**Errors**

| Status | Message | Meaning |
|---|---|---|
| `400` | `Missing x-session-id` / `Invalid x-session-id` / `Invalid address` | Missing or invalid request data |
| `401` | `Unauthorized` / `Unknown session` | Missing private auth, or session ID was not created by `/api/session` |
| `403` | `Inbox not in this session` | The inbox is not linked to your session |
| `403` | `Inbox not in this session` | The inbox is not linked to your session. Existing inboxes cannot be claimed from another session. |

**Usage**

```bash
curl -s "https://YOUR_DOMAIN/api/inboxes/test123%40example.com/messages" \
  -H "Authorization: Bearer $PAKUAN_API_KEY" \
  -H "x-session-id: 550e8400-e29b-41d4-a716-446655440000"
```

---

## Full flow example

```bash
DOMAIN="tempik.YOURDOMAIN.com"
# Keep this in your shell, never commit it.
API_KEY="$PAKUAN_API_KEY"

# 1. Get session
SESSION=$(curl -s https://$DOMAIN/api/session \
  -H "Authorization: Bearer $API_KEY" | jq -r '.sessionId')

# 2. Create an inbox
INBOX=$(curl -s -X POST https://$DOMAIN/api/inboxes \
  -H "Authorization: Bearer $API_KEY" \
  -H "x-session-id: $SESSION" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.address')
echo "Created: $INBOX"

# 3. ...wait for an email to arrive...

# 4. List inboxes
curl -s https://$DOMAIN/api/inboxes \
  -H "Authorization: Bearer $API_KEY" \
  -H "x-session-id: $SESSION" | jq '.'

# 5. Read messages
ENCODED=$(echo -n "$INBOX" | jq -sRr '@uri')
curl -s "https://$DOMAIN/api/inboxes/$ENCODED/messages" \
  -H "Authorization: Bearer $API_KEY" \
  -H "x-session-id: $SESSION" | jq '.'

# 6. Delete inbox from session
curl -s -X DELETE "https://$DOMAIN/api/inboxes/$ENCODED" \
  -H "Authorization: Bearer $API_KEY" \
  -H "x-session-id: $SESSION"
```

---

## Errors

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

| Status | When |
|---|---|
| `400` | Missing/invalid `x-session-id`, invalid address, invalid domain, or invalid `localPart` |
| `401` | Unauthorized private access, or unknown session |
| `403` | Inbox quota exceeded, or inbox not linked to your session |
| `404` | Route not found |
| `409` | Custom inbox is unavailable |
| `429` | Rate limit exceeded |

---

## Session isolation

Pakuan Mail uses private access plus per-browser anonymous sessions:

| Scenario | Behavior |
|---|---|
| New browser | Empty inbox list |
| After creating inbox A | Only inbox A appears in that browser |
| Open in incognito | Empty — different session |
| Refresh same browser | Inboxes persist (via `localStorage`) |
| Send email to inbox A | Inbox A gets it instantly if the recipient matches an allowed `MAIL_DOMAIN` |

## Limits and retention

- Custom inboxes cannot claim addresses that already exist outside your session.
- Each session can keep up to 10 inboxes.
- Inbox creation is rate-limited per session and per IP.
- Message reads are paginated with `limit`/`offset`.
- Stored email body text is capped at 200,000 characters.
- Each inbox keeps the newest 100 messages.
- A scheduled cleanup runs every 6 hours and removes messages older than 7 days plus orphan rows.
- Logs avoid full email addresses, subjects, and message bodies.
