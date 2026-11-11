/* 线上验收：加载 GitHub Pages 上的站点，确认能进游戏并截图 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const URL = process.argv[2] || 'https://hex1um.github.io/mine4d/';
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Users/11603/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const PORT = 9351;
const profile = join(process.env.TEMP || '/tmp', 'm4-live-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = l.find((t) => t.type === 'page');
    if (p) wsUrl = p.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pend.set(id, r)); };
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(3200);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
await sleep(2200);
await ev(`__m4.reveal(__m4.board.at(2,2,__m4.view.z,__m4.view.w))`);
await sleep(300);
await ev(`__m4.setViewMode('3d')`);
await sleep(900);
const info = await ev(`({ ok: !!window.__m4, title: document.title, cells: __m4.drawList.length, opened: __m4.board.opened, fonts: document.fonts.size })`);
const r = await send('Page.captureScreenshot', { format: 'png' });
if (r.result?.data) writeFileSync(join(OUT, 'live.png'), Buffer.from(r.result.data, 'base64'));
console.log(JSON.stringify({ info, errs }, null, 1));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
