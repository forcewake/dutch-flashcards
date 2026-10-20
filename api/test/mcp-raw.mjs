import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js"; import addFormats from "ajv-formats";
const B = "http://localhost:8787/mcp", RT = fs.readFileSync("/tmp/RT", "utf8").trim(), WT = fs.readFileSync("/tmp/T", "utf8").trim();
const V = "2026-07-28";
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const meta = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientInfo": { name: "raw", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
let n = 0;
async function post(body, { headers = {}, accept = "application/json, text/event-stream", auth = RT, raw = false } = {}) {
  const h = { "Content-Type": "application/json", Accept: accept, ...(auth ? { Authorization: "Bearer " + auth } : {}), ...headers };
  const r = await fetch(B, { method: "POST", headers: h, body: raw ? body : JSON.stringify(body) });
  const text = await r.text(); let j = null;
  if ((r.headers.get("content-type") || "").includes("event-stream")) j = text.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
  else if (text) j = JSON.parse(text);
  return { s: r.status, ct: r.headers.get("content-type"), h: r.headers, j, text };
}
const modern = (method, params = {}, extraH = {}, id = ++n) => post({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } },
  { headers: { "MCP-Protocol-Version": V, "Mcp-Method": method, ...(params.name && method === "tools/call" ? { "Mcp-Name": params.name } : {}), ...(params.uri ? { "Mcp-Name": params.uri } : {}), ...extraH } });

// --- modern era ---
let r = await modern("server/discover", {}, {}, 1);
ok(r.s === 200 && r.ct.includes("event-stream") && r.j[0].result.resultType === "complete" && r.j[0].result.supportedVersions.join() === "2026-07-28,2025-11-25,2025-06-18,2025-03-26" && r.j[0].result._meta["io.modelcontextprotocol/serverInfo"] && r.j[0].result.ttlMs > 0, "modern server/discover over SSE " + JSON.stringify(r.j[0].result.supportedVersions));
ok(r.h.get("x-accel-buffering") === "no" && !r.h.get("mcp-session-id"), "SSE has X-Accel-Buffering: no, no Mcp-Session-Id");
r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta } }, { accept: "application/json", headers: { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" } });
ok(r.s === 200 && r.ct.startsWith("application/json") && r.j.result.tools.length === 5 && r.j.result.cacheScope === "public", "modern tools/list as JSON (Accept: application/json)");
const tools = r.j.result.tools;
const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
for (const t of tools) { ajv.compile(t.inputSchema); }
const args = { get_struggling: { limit: 3 }, get_recent_activity: { days: 7 } };
for (const t of tools) {
  r = await modern("tools/call", { name: t.name, arguments: args[t.name] || {} });
  const res = r.j[0].result, valid = ajv.validate(t.outputSchema, res.structuredContent);
  ok(r.s === 200 && res.resultType === "complete" && valid && JSON.stringify(JSON.parse(res.content[0].text)) === JSON.stringify(res.structuredContent),
    `modern tools/call ${t.name}: outputSchema valid (ajv 2020) + text fallback ${valid ? "" : JSON.stringify(ajv.errors)}`);
}
r = await modern("tools/list", { cursor: Buffer.from(JSON.stringify({ k: "tools", o: 3 })).toString("base64") });
ok(r.j[0].result.tools.length === 2 && !r.j[0].result.nextCursor, "tools/list with cursor offset 3 -> 2 tools, no nextCursor");
r = await modern("tools/list", { cursor: "garbage" }); ok(r.s === 400 && r.j.error.code === -32602, "invalid cursor -> 400 -32602");
r = await modern("resources/list"); ok(r.j[0].result.resources.length === 4, "modern resources/list");
r = await modern("resources/templates/list"); ok(r.j[0].result.resourceTemplates.length === 1, "modern resources/templates/list");
r = await modern("resources/read", { uri: "dutch://cards/nl:de-kaas" }); ok(r.s === 200 && JSON.parse(r.j[0].result.contents[0].text).card.dutch === "de kaas" && r.j[0].result.cacheScope === "private", "modern resources/read template");
r = await modern("resources/read", { uri: "dutch://zzz" }); ok(r.s === 400 && r.j.error.code === -32602, "modern resource not found -> 400 -32602");
r = await modern("tools/call", { name: "nope", arguments: {} }); ok(r.s === 400 && r.j.error.code === -32602, "modern unknown tool -> 400 -32602");
r = await modern("ping"); ok(r.s === 404 && r.j.error.code === -32601, "modern ping (removed in 2026-07-28) -> 404 -32601");
r = await modern("foo/bar"); ok(r.s === 404 && r.j.error.code === -32601, "modern unknown method -> 404 -32601");
// unicode Mcp-Name via base64 sentinel
r = await modern("resources/read", { uri: "dutch://summary" }, { "Mcp-Name": "=?base64?" + Buffer.from("dutch://summary").toString("base64") + "?=" }); ok(r.s === 200, "Mcp-Name base64 sentinel decoded");
// header validation
r = await modern("tools/list", {}, { "MCP-Protocol-Version": "2025-11-25" }); ok(r.s === 400 && r.j.error.code === -32020, "header/body version mismatch -> 400 -32020");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: meta } }, { headers: { "Mcp-Method": "tools/list" } }); ok(r.s === 400 && r.j.error.code === -32020, "missing MCP-Protocol-Version -> 400 -32020");
r = await modern("tools/list", {}, { "Mcp-Method": "resources/list" }); ok(r.s === 400 && r.j.error.code === -32020, "Mcp-Method mismatch -> 400 -32020");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_summary", _meta: meta } }, { headers: { "MCP-Protocol-Version": V, "Mcp-Method": "tools/call" } }); ok(r.s === 400 && r.j.error.code === -32020, "missing Mcp-Name -> 400 -32020");
r = await modern("tools/call", { name: "get_summary" }, { "Mcp-Name": "get_due_cards" }); ok(r.s === 400 && r.j.error.code === -32020, "Mcp-Name mismatch -> 400 -32020");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": V } } }, { headers: { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" } }); ok(r.s === 400 && r.j.error.code === -32602, "missing clientCapabilities -> 400 -32602");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } }, { headers: { "Mcp-Method": "tools/list" } });
ok(r.s === 400 && r.j.error.code === -32022 && r.j.error.data.supported.length === 4, "unsupported body version -> 400 -32022 with supported list");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/list" }, { headers: { "MCP-Protocol-Version": "1900-01-01" } }); ok(r.s === 400 && r.j.error.code === -32022 && r.j.error.data.requested === "1900-01-01", "unsupported MCP-Protocol-Version header -> 400 -32022");
r = await post({ jsonrpc: "2.0", id: 9, method: "tools/list" }, { headers: { "MCP-Protocol-Version": V } }); ok(r.s === 400 && r.j.error.code === -32602, "modern header but no _meta -> 400 -32602");
r = await post({ jsonrpc: "2.0", method: "notifications/whatever", params: { _meta: meta } }, { headers: { "MCP-Protocol-Version": V, "Mcp-Method": "notifications/whatever" } }); ok(r.s === 202 && !r.text, "modern notification -> 202 empty");

// --- legacy era ---
for (const [req, exp] of [["2025-11-25", "2025-11-25"], ["2025-06-18", "2025-06-18"], ["2025-03-26", "2025-03-26"], ["2024-11-05", "2025-11-25"], ["2026-07-28", "2025-11-25"]]) {
  r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: req, capabilities: {}, clientInfo: { name: "raw", version: "1" } } }, { accept: "application/json" });
  ok(r.s === 200 && r.j.result.protocolVersion === exp && !r.h.get("mcp-session-id"), `legacy initialize ${req} -> ${r.j.result.protocolVersion}`);
}
r = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { headers: { "MCP-Protocol-Version": "2025-06-18" } }); ok(r.s === 202 && !r.text, "notifications/initialized -> 202");
r = await post({ jsonrpc: "2.0", id: 5, result: {} }, { headers: { "MCP-Protocol-Version": "2025-06-18" } }); ok(r.s === 202, "client JSON-RPC response -> 202");
r = await post({ jsonrpc: "2.0", id: 3, method: "ping" }, { headers: { "MCP-Protocol-Version": "2025-06-18" }, accept: "application/json" }); ok(r.s === 200 && r.j.result && r.h.get("mcp-protocol-version") === "2025-06-18", "legacy ping JSON");
r = await post({ jsonrpc: "2.0", id: 3, method: "ping" }); ok(r.s === 200 && r.ct.includes("event-stream") && r.text.startsWith("event: message\ndata: "), "legacy ping without version header (treated as 2025-03-26), SSE framing");
r = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }], { headers: { "MCP-Protocol-Version": "2025-03-26" }, accept: "application/json" });
ok(r.s === 200 && Array.isArray(r.j) && r.j.length === 2 && r.j[1].result.tools.length === 5, "2025-03-26 batch -> JSON array of 2 responses");
r = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "nope" }], { headers: { "MCP-Protocol-Version": "2025-03-26" } });
ok(r.s === 200 && r.j.length === 2 && r.j[1].error.code === -32601, "2025-03-26 batch over SSE -> 2 events, per-item error");
r = await post([{ jsonrpc: "2.0", method: "notifications/initialized" }]); ok(r.s === 202, "batch of only notifications -> 202");
r = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }], { headers: { "MCP-Protocol-Version": "2025-06-18" } }); ok(r.s === 400 && r.j.error.code === -32600, "batch under 2025-06-18 -> 400 -32600");
r = await post([], {}); ok(r.s === 400, "empty batch -> 400");
r = await post({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "dutch://x" } }, { headers: { "MCP-Protocol-Version": "2025-11-25" }, accept: "application/json" }); ok(r.j.error.code === -32002, "legacy resource not found -> -32002");

// --- transport-level errors ---
r = await post("{bad", { raw: true }); ok(r.s === 400 && r.j.error.code === -32700, "parse error -> 400 -32700");
r = await post({ foo: 1 }); ok(r.s === 400 && r.j.error.code === -32600, "invalid request -> 400 -32600");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "Content-Type": "text/plain" } }); ok(r.s === 415, "wrong Content-Type -> 415");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { accept: "text/html" }); ok(r.s === 406, "Accept text/html -> 406");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { auth: null }); ok(r.s === 401 && r.h.get("www-authenticate") === 'Bearer realm="dutch-mcp"', "no token -> 401 + WWW-Authenticate: " + r.h.get("www-authenticate"));
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { auth: WT }); ok(r.s === 401 && /invalid_token/.test(r.h.get("www-authenticate")), "write token -> 401 invalid_token");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { auth: "garbage" }); ok(r.s === 401, "garbage token -> 401");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "Mcp-Session-Id": "abc", "Last-Event-ID": "5" } }); ok(r.s === 200 && !r.h.get("mcp-session-id"), "Mcp-Session-Id / Last-Event-ID ignored");
for (const m of ["GET", "DELETE", "PUT"]) { const x = await fetch(B, { method: m, headers: { Authorization: "Bearer " + RT, Accept: "text/event-stream" } }); ok(x.status === 405 && x.headers.get("allow") === "POST, OPTIONS", `${m} /mcp -> 405 Allow: POST, OPTIONS`); }
// --- CORS / Origin ---
for (const o of ["https://forcewake.github.io", "https://grok.com", "https://example.org"]) {
  const x = await fetch(B, { method: "OPTIONS", headers: { Origin: o, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,mcp-protocol-version,mcp-method,mcp-name" } });
  ok(x.status === 204 && x.headers.get("access-control-allow-origin") === o && /mcp-method/i.test(x.headers.get("access-control-allow-headers")) && /Mcp-Session-Id/.test(x.headers.get("access-control-expose-headers")), `/mcp preflight from ${o} (MCP_ALLOWED_ORIGINS=*)`);
}
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { Origin: "https://example.org" } }); ok(r.s === 200 && r.h.get("access-control-allow-origin") === "https://example.org", "/mcp POST with Origin gets ACAO");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { Origin: "null" } }); ok(r.s === 403 && r.j.error && r.j.id === null, "Origin: null -> 403 with id-less JSON-RPC error");
r = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { Origin: "not a url" } }); ok(r.s === 403, "malformed Origin -> 403");
let x = await fetch("http://localhost:8787/v1/sync", { method: "OPTIONS", headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST" } }); ok(x.status === 403, "REST CORS unchanged: other origin preflight -> 403");
// --- discovery docs ---
for (const p of ["/mcp/server-card", "/.well-known/mcp.json", "/.well-known/ai-catalog.json"]) {
  x = await fetch("http://localhost:8787" + p); const j = await x.json();
  ok(x.status === 200 && x.headers.get("access-control-allow-origin") === "*", `${p} ${x.headers.get("content-type")} ${JSON.stringify(j).slice(0, 110)}`);
}
x = await fetch("http://localhost:8787/.well-known/oauth-protected-resource"); ok(x.status === 404, "no oauth-protected-resource (bearer-only) -> 404");
process.exit();
