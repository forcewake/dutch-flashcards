import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
const RT = fs.readFileSync("/tmp/RT", "utf8").trim();
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
async function run(label, opts = {}) {
  const t = new StreamableHTTPClientTransport(new URL("http://localhost:8787/mcp"), { requestInit: { headers: { Authorization: "Bearer " + RT } } });
  const c = new Client({ name: "sdk-test", version: "1.0.0" }, opts);
  await c.connect(t);
  console.log(`[${label}] negotiated`, t.protocolVersion, "server", JSON.stringify(c.getServerVersion()), "session", t.sessionId ?? "(none)");
  ok(!!c.getServerCapabilities()?.tools && !!c.getServerCapabilities()?.resources, "capabilities tools+resources");
  ok(!!c.getInstructions(), "instructions");
  const tl = await c.listTools();
  ok(tl.tools.length === 5 && tl.tools.every(x => x.outputSchema && x.annotations?.readOnlyHint === true && x.title), "listTools: " + tl.tools.map(x => x.name).join(","));
  for (const [n, a] of [["get_summary", {}], ["get_struggling", { limit: 5 }], ["get_due_cards", {}], ["get_current_session", {}], ["get_recent_activity", { days: 3 }]]) {
    const r = await c.callTool({ name: n, arguments: a }); // SDK validates structuredContent against outputSchema
    ok(!r.isError && r.structuredContent && JSON.stringify(r.structuredContent) === r.content[0].text, `callTool ${n} (structured == text fallback) ${r.content[0].text.slice(0, 90)}`);
  }
  const bad = await c.callTool({ name: "get_struggling", arguments: { limit: 0 } });
  ok(bad.isError === true, "invalid args -> isError: " + bad.content[0].text);
  let err; try { await c.callTool({ name: "nope", arguments: {} }); } catch (e) { err = e; } ok(err && /-32602|Unknown tool/.test(String(err.code ?? err.message)), "unknown tool -> " + err?.message);
  const rl = await c.listResources(); ok(rl.resources.length === 4, "listResources: " + rl.resources.map(r => r.uri).join(","));
  const rt = await c.listResourceTemplates(); ok(rt.resourceTemplates[0]?.uriTemplate === "dutch://cards/{card_id}", "listResourceTemplates");
  for (const u of ["dutch://summary", "dutch://cards", "dutch://struggling", "dutch://session/current", "dutch://cards/nl:het-huis"]) {
    const rr = await c.readResource({ uri: u }); const d = JSON.parse(rr.contents[0].text);
    ok(rr.contents[0].mimeType === "application/json", `readResource ${u}: ${JSON.stringify(d).slice(0, 80)}`);
  }
  err = null; try { await c.readResource({ uri: "dutch://nope" }); } catch (e) { err = e; } ok(err && err.code === -32002, "resource not found (legacy) -> " + err?.code);
  await c.ping(); ok(true, "ping");
  await c.close();
}
await run("default");
process.exit();
