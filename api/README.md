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
| `POST /mcp` | read token only | MCP Streamable HTTP (stateless, JSON responses) |

Event types: `session_start`, `flip`, `answer` (`ok` set), `position` (`data: {pos, dir}`; debounced in the app).
Limits: 1000 changes / 2000 events per request. CORS allows only `https://forcewake.github.io`.

MCP tools: `get_summary`, `get_struggling(limit)`, `get_due_cards`, `get_recent_activity(days)`, `get_current_session`
(events since the last ≥30-minute gap).

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
