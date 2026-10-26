# dutch-api

Cloudflare Worker (free tier) + D1 that syncs progress for the Dutch flashcards app
(https://forcewake.github.io/dutch-flashcards/) and exposes it read-only to Grok over MCP.

## Model

* Card ids are slugs derived from the Dutch text: `nl:het-huis`, `nl:hoe-heet-je` (diacritics stripped, `-2` suffix on collision).
  The algorithm lives in `index.html` (`cardSlug`) and `scripts/slug.mjs`. **Renaming a card's Dutch text changes its id.**
* `CARD_META` (slug -> dutch, russian, topic) in `src/index.ts` is generated from `../index.html`:
  `npm run gen-meta` (rerun after editing the card list, then redeploy).
* Auth: `POST /v1/register` returns a random 32-byte token; only its SHA-256 is stored. That token is the
  "device code": enter it on another device to share the same progress. A separate read-only token
  (`POST /v1/read-token`, rotates on every call) is the only credential `/mcp` accepts.

## Routes

| Route | Auth | |
|---|---|---|
| `POST /v1/register` | none | `{userId, token}` |
| `GET /v1/progress` | write | `{progress: {card_id: {level,due_at,last_seen,seen,wrong,updated_at}}}` |
| `POST /v1/sync` | write | body `{changes: {card_id: {...}} \| [{card_id,...}], events: [{type,card_id?,ok?,data?,ts}]}`; last-writer-wins per card by `updated_at`; returns merged progress |
| `POST /v1/import` | write | same as sync, used once by the app for the initial upload (idempotent) |
| `POST /v1/read-token` | write | `{readToken}` (issues / rotates) |
| `GET /v1/events?limit=&since=` | write | recent events (debug) |
| `GET /v1/stats` | write or read | summary + struggling + current session + 100 recent events (used by dashboard) |
| `GET /dashboard` | (page asks for a token) | HTML dashboard, strict CSP, token kept in sessionStorage |
| `POST /mcp` | read token only | MCP Streamable HTTP (see below) |
| `GET /mcp/server-card`, `/.well-known/ai-catalog.json`, `/.well-known/mcp.json` | none | discovery documents |

Event types: `session_start`, `flip`, `answer` (`ok` set), `position` (`data: {pos, dir}`; debounced in the app).
Limits: 1000 changes / 2000 events per request. CORS allows only `https://forcewake.github.io`.

## MCP endpoint (`/mcp`)

Streamable HTTP, **stateless, dual-era**:

| Protocol version | Era | How a client uses it |
|---|---|---|
| `2026-07-28` (latest spec) | modern | no handshake; every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` + `clientCapabilities` and the `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers; `server/discover` available |
| `2025-11-25`, `2025-06-18`, `2025-03-26` | legacy | `initialize` handshake. The server echoes a supported requested version, otherwise answers `2025-11-25`. Requests without `MCP-Protocol-Version` are treated as `2025-03-26` |

* **Methods:** `server/discover` (modern), `initialize` / `ping` (legacy), `tools/list`, `tools/call`, `resources/list`,
  `resources/read`, `resources/templates/list`. All notifications (e.g. `notifications/initialized`) and client responses get `202`.
  List methods support `cursor`/`nextCursor` (page size 50, so in practice one page).
* **Tools** (all `readOnlyHint: true`, `idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`, with
  `title`, `inputSchema` and `outputSchema`; results have `structuredContent` plus the same JSON as a text block):
  `get_summary`, `get_struggling(limit 1-100)`, `get_due_cards`, `get_current_session`, `get_recent_activity(days 1-90)`.
  If the arguments are invalid, the result has `isError: true`. An unknown tool returns `-32602`.
* **Resources:** `dutch://summary`, `dutch://cards`, `dutch://struggling`, `dutch://session/current`, and the template
  `dutch://cards/{card_id}` (e.g. `dutch://cards/nl:het-huis`). Unknown URI: `-32602` (modern) / `-32002` (legacy).
* **Response format:** if `Accept` contains `text/event-stream`, the reply is a short SSE stream (`event: message` + the
  JSON-RPC response, then the stream closes, with `X-Accel-Buffering: no`). Otherwise it is `application/json`. HTTP-level
  errors (400/401/403/404/406/415) are always JSON.
* **Batches:** only for `2025-03-26` (JSON-RPC batching was removed in 2025-06-18, and modern requests are single messages).
  Any other version gets `400 -32600`.
* **Errors:** `-32700` parse (400), `-32600` invalid request (400), `-32601` unknown method (404 modern / 200 legacy),
  `-32602` invalid params, `-32020` HeaderMismatch (400: missing or mismatched `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name`;
  `Mcp-Name` accepts the `=?base64?…?=` sentinel), `-32022` UnsupportedProtocolVersion (400, `data.supported` lists the versions).
  Wrong Content-Type: 415. Accept without json/sse: 406.
* **Sessions:** none. The server never issues `Mcp-Session-Id` and ignores it, plus `Last-Event-ID`, if a client sends them.
  This is permitted in the legacy revisions and is required behaviour in 2026-07-28.
* **GET / DELETE `/mcp`:** `405 Allow: POST, OPTIONS`. Both are explicitly permitted (legacy: "server does not offer an SSE
  stream" / "does not allow clients to terminate sessions"; 2026-07-28 removed both). This is the most interoperable
  choice for a Worker: a long-lived GET stream would only send keep-alives (there are no server notifications) and would hit
  Workers' duration limits anyway.
* **Auth:** `Authorization: Bearer <read token>` only. The write token (device code) is rejected. A missing token gets 401 with
  `WWW-Authenticate: Bearer realm="dutch-mcp"`; an invalid token gets `..., error="invalid_token"`. **Bearer-only, no OAuth:**
  there is intentionally no `/.well-known/oauth-protected-resource` (RFC 9728). Publishing it without a real authorization
  server would make OAuth-capable clients try (and fail) an OAuth flow. Clients that insist on OAuth discovery cannot connect;
  use one that accepts a static header (Grok, the MCP SDK, MCP Inspector all do).
* **Origin / CORS:** requests without `Origin` (server-side clients such as Grok's backend, SDKs, curl) are allowed. Browser
  origins are allowed if they are `https://forcewake.github.io` or listed in the `MCP_ALLOWED_ORIGINS` var (comma-separated,
  default `*`, i.e. any well-formed origin, because auth is a bearer token, not cookies). `Origin: null` or a malformed origin
  gets 403. Preflight echoes the requested headers; `Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate` are exposed.
  The REST API's CORS is unchanged (github.io only). To lock `/mcp` down, set e.g. `MCP_ALLOWED_ORIGINS = "https://grok.com"` in wrangler.toml.
* **Discovery documents** (public, no secrets, `Access-Control-Allow-Origin: *`):
  * `GET /mcp/server-card`: MCP Server Card (`application/mcp-server-card+json`) per SEP-2127 / the
    `experimental-ext-server-card` extension. The SEP is Final, but the card format is still an *experimental* extension.
  * `GET /.well-known/ai-catalog.json`: AI Catalog entry pointing to that card (the discovery mechanism that extension recommends).
  * `GET /.well-known/mcp.json`: the same card. **Unofficial** convenience alias; no spec defines this path.

### Connecting Grok

* URL: `https://dutch-api.<account-subdomain>.workers.dev/mcp` (the `<account-subdomain>` is your workers.dev subdomain,
  shown by `wrangler deploy` and in the dashboard under Workers & Pages → Overview).
* Transport: **Streamable HTTP**.
* Header: `Authorization: Bearer <read token>`. In the xAI API remote-MCP tool, set `authorization: "<read token>"` or
  `headers: {"Authorization": "Bearer <read token>"}`; in a Grok custom connector, add the same header.
* Getting the token: open the app → "Синхронизация" → **"Токен для Grok"**. Each press issues a **new** token and the old
  one stops working. Alternatively: `curl -X POST -H "Authorization: Bearer <device code>" $B/v1/read-token`.
* Optional allowed tools: `get_summary, get_struggling, get_due_cards, get_current_session, get_recent_activity`.

### Tests

`test/rest.sh` (REST + CORS; writes the tokens to `/tmp/T` and `/tmp/RT`), `test/mcp-sdk.mjs` (official
`@modelcontextprotocol/sdk` client), `test/mcp-raw.mjs` (raw HTTP: modern + legacy + error paths, validates every
`structuredContent` against its `outputSchema` with Ajv 2020), `test/app-jsdom.mjs` (app in jsdom). Run them against
`wrangler dev --local` on port 8787. The `.mjs` tests need `@modelcontextprotocol/sdk`, `ajv`, `ajv-formats`, `jsdom`
installed somewhere on the module path.

## Local dev

```sh
npm install                      # wrangler 4 needs Node >= 22
npx wrangler d1 execute dutch --local --file schema.sql
npx wrangler dev --local         # http://localhost:8787
npm run typecheck
```

## Deploy (needs a Cloudflare account; `npx wrangler login` or `CLOUDFLARE_API_TOKEN` with Workers Scripts:Edit + D1:Edit)

```sh
cd api
npm install
npx wrangler d1 create dutch                       # prints database_id
#   paste that id into wrangler.toml -> database_id
npx wrangler d1 execute dutch --remote --file schema.sql
npx wrangler deploy                                # prints https://dutch-api.<subdomain>.workers.dev
```

Then in `index.html` set `const API_BASE = "https://dutch-api.<subdomain>.workers.dev";`,
copy it to `flashcards.html` (`cp index.html flashcards.html`), commit and push to `main`.
Until `API_BASE` is set the app runs purely locally (events are queued in localStorage, capped at 2000, and uploaded once a server is configured).

### Checks after deploy

```sh
B=https://dutch-api.<subdomain>.workers.dev
T=$(curl -s -X POST $B/v1/register | jq -r .token)
curl -s -H "Authorization: Bearer $T" $B/v1/progress
curl -s -H "Authorization: Bearer $T" -X POST $B/v1/sync \
  -d '{"changes":{"nl:het-huis":{"level":1,"due_at":0,"seen":1,"wrong":0,"updated_at":1}},"events":[{"type":"answer","card_id":"nl:het-huis","ok":true,"ts":'$(date +%s000)'}]}'
curl -si -X OPTIONS -H "Origin: https://forcewake.github.io" -H "Access-Control-Request-Method: POST" $B/v1/sync | grep -i access-control
curl -so /dev/null -w '%{http_code}\n' -X OPTIONS -H "Origin: https://evil.example" $B/v1/sync   # 403
R=$(curl -s -H "Authorization: Bearer $T" -X POST $B/v1/read-token | jq -r .readToken)
curl -s -X POST $B/mcp -H "Authorization: Bearer $R" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_summary"}}'
curl -so /dev/null -w '%{http_code}\n' -X POST $B/mcp -H "Authorization: Bearer $T" -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'  # 401
```
(The test user created above can be removed with `npx wrangler d1 execute dutch --remote --command "DELETE FROM users WHERE ..."`.)

Grok MCP config: URL `$B/mcp`, header `Authorization: Bearer <read token from the app's "Токен для Grok" button>`.
Dashboard: `$B/dashboard`.

### Deployed instance / deploying without wrangler auth

Live: `https://dutch-api.forcewake.workers.dev` (D1 `dutch`, id in `wrangler.toml`). It was first deployed without a
`CLOUDFLARE_API_TOKEN` through the Cloudflare API: `POST /accounts/{id}/d1/database`, schema via `.../d1/database/{db}/query`,
bundle from `npx wrangler deploy --dry-run --outdir dist`, uploaded with `PUT .../workers/scripts/dutch-api` (multipart,
`main_module: index.js`, bindings `d1 DB` + `plain_text MCP_ALLOWED_ORIGINS`), then `POST .../workers/scripts/dutch-api/subdomain {"enabled":true}`.
A plain `npx wrangler deploy` with credentials does the same thing.
