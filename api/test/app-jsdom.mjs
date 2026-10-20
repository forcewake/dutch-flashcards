import { JSDOM } from "jsdom";
import fs from "node:fs";
const base = fs.readFileSync("/workspace/dutch/index.html", "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk(html, storage, fetchLog){
  const dom = new JSDOM(html, { url: "https://forcewake.github.io/dutch-flashcards/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, logs = [];
  for (const [k,v] of Object.entries(storage||{})) w.localStorage.setItem(k, v);
  w.console = { log:(...a)=>logs.push(a), warn:(...a)=>logs.push(a), error:(...a)=>logs.push(a), info:(...a)=>logs.push(a) };
  w.fetch = (u, o) => { fetchLog.push([u, o && o.method]); return fetch(u, { ...o, keepalive: undefined }); };
  w.confirm = () => true;
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  const s = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  try { w.eval(s + "\nwindow.__IDS = IDS;"); } catch (e) { errs.push(String(e)); }
  return { w, logs, errs, $: id => w.document.getElementById(id) };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
// --- 1: placeholder mode + migration
const v1 = JSON.stringify({ "0": {lvl:2,due:123,seen:4}, "52": {lvl:5,due:9e12,seen:7}, "999": {lvl:1,due:0,seen:1}, "3": {lvl:0,due:0,seen:0} });
let fl = [];
let A = mk(base, { "nl-flashcards-v1": v1 }, fl);
const v2 = JSON.parse(A.w.localStorage.getItem("nl-flashcards-v2"));
console.log("migrated v2:", JSON.stringify(v2));
ok(v2["nl:de-naam"]?.level === 2 && v2["nl:de-naam"].seen === 4 && v2["nl:de-naam"].due_at === 123, "card 0 -> nl:de-naam");
ok(v2["nl:het-huis"]?.level === 5, "card 52 -> nl:het-huis");
ok(Object.keys(v2).length === 2, "out-of-range + unseen entries dropped");
ok(A.w.localStorage.getItem("nl-flashcards-v1") === v1, "v1 kept as backup");
ok(A.$("syncStatus").textContent === "Сервер синхронизации ещё не подключён", "placeholder status text");
ok(A.$("copyCode").disabled && A.$("grokBtn").disabled, "sync buttons disabled");
ok(/выучено: 1\/72/.test(A.$("stats").textContent), "stats render: " + A.$("stats").textContent);
A.$("flip").click(); ok(A.$("ru").textContent.length > 0, "flip shows translation");
A.$("good").click(); A.$("next").click(); A.$("prev").click(); A.$("flip").click(); A.$("bad").click();
await sleep(2600);
ok(fl.length === 0, "no network calls in placeholder mode");
ok(A.logs.length === 0 && A.errs.length === 0, "no console output / errors");
const q = JSON.parse(A.w.localStorage.getItem("nl-sync-queue"));
console.log("queued event types:", q.events.map(e => e.type).join(","));
ok(q.events[0].type === "session_start" && q.events.some(e=>e.type==="answer"&&e.ok===false), "events queued locally");
const ids = A.w.__IDS; const meta = fs.readFileSync("/workspace/dutch/api/src/index.ts","utf8"); ok(ids.every(i => meta.includes(JSON.stringify(i) + ":")), "app ids == worker CARD_META keys"); ok(new Set(ids).size === 72, "72 unique ids");
// --- 2: live against wrangler dev
const live = base.replace('"https://dutch-api.REPLACE.workers.dev"', '"http://localhost:8787"');
fl = [];
const B = mk(live, { "nl-flashcards-v1": v1 }, fl);
await sleep(1500);
const tok = B.w.localStorage.getItem("nl-sync-token");
ok(!!tok && B.w.localStorage.getItem("nl-sync-imported") === "1", "registered + imported");
B.$("flip").click(); B.$("good").click(); B.$("flip").click(); B.$("bad").click();
for (let i = 0; i < 5; i++) B.$("next").click(); // rapid -> 1 position event
await sleep(3500);
console.log("fetches:", fl.map(f => (f[1]||"GET") + " " + f[0].replace("http://localhost:8787","")).join(" | "));
console.log("status:", B.$("syncStatus").textContent);
ok(/Синхронизировано/.test(B.$("syncStatus").textContent), "synced status");
const H = { Authorization: "Bearer " + tok };
const prog = (await (await fetch("http://localhost:8787/v1/progress", { headers: H })).json()).progress;
ok(prog["nl:het-huis"]?.level === 5 && Object.keys(prog).length >= 3, "server has imported + answered cards: " + Object.keys(prog).join(","));
const evs = (await (await fetch("http://localhost:8787/v1/events?limit=50", { headers: H })).json()).events;
const types = evs.map(e => e.type).reverse();
console.log("server events:", types.join(","));
ok(types.filter(t => t === "position").length === 1, "rapid position changes debounced to 1 event, got " + types.filter(t=>t==="position").length);
ok(types.filter(t=>t==="answer").length === 2 && types.filter(t=>t==="flip").length === 2 && types[0]==="session_start", "answers/flips/session_start");
// --- 3: second device enters code
fl = [];
const C = mk(live, {}, fl);
await sleep(1200);
C.$("otherCode").value = tok; C.$("useCode").click();
await sleep(1500);
const c2 = JSON.parse(C.w.localStorage.getItem("nl-flashcards-v2"));
ok(C.w.localStorage.getItem("nl-sync-token") === tok && c2["nl:het-huis"]?.level === 5, "device 2 pulled progress via code");
C.$("grokBtn").click(); await sleep(800);
ok(!C.$("grokTok").hidden && C.$("grokTok").textContent.length > 30, "Токен для Grok shown");
ok(B.errs.length + C.errs.length === 0, "no errors live: " + B.errs.concat(C.errs));
// --- 4: offline tolerance
fl = [];
const D = mk(live.replace("localhost:8787", "localhost:9"), { "nl-flashcards-v2": JSON.stringify(v2) }, fl);
D.$("flip").click(); D.$("good").click(); await sleep(2800);
ok(/Нет связи/.test(D.$("syncStatus").textContent) && D.errs.length === 0 && D.logs.length === 0, "offline: " + D.$("syncStatus").textContent);
ok(JSON.parse(D.w.localStorage.getItem("nl-sync-queue")).events.length >= 3, "offline queue retained");
// --- 5: dashboard
const dh = await (await fetch("http://localhost:8787/dashboard")).text();
const E = new JSDOM(dh, { url: "http://localhost:8787/dashboard", runScripts: "outside-only" });
E.window.fetch = (u, o) => fetch(new URL(u, "http://localhost:8787"), o);
E.window.sessionStorage.setItem("dash-token", tok);
E.window.eval(dh.slice(dh.indexOf('">', dh.indexOf("<script")) + 2, dh.indexOf("</script>")));
await sleep(1000);
const ed = E.window.document;
console.log("dashboard msg:", ed.getElementById("msg").textContent, "| events rows:", ed.querySelectorAll("#evs tr").length, "| struggling rows:", ed.querySelectorAll("#strug tr").length);
ok(!ed.getElementById("out-wrap").hidden && ed.querySelectorAll("#evs tr").length > 3, "dashboard renders");
process.exit();
