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

// 4D 变体
if (await ev('!!window.__m4')) {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
  await sleep(2200);
  await ev(`__m4.reveal(__m4.board.at(2,2,__m4.view.z,__m4.view.w))`);
  await sleep(300);
  await ev(`__m4.setViewMode('3d')`);
  await sleep(900);
}

let info = await ev(`({
  title: document.title,
  variant: window.__m4 ? '4d' : window.__fm ? 'fractal' : 'hub',
  fonts: document.fonts.size,
  cells4d: window.__m4 ? __m4.drawList.length : null,
  opened4d: window.__m4 ? __m4.board.opened : null
})`);

// 分形变体
if (await ev('!!window.__fm')) {
  const r = await ev(`(() => {
    const m = window.__fm;
    m.reveal(10, 10);
    let safe = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.isMine(10 + dx, 10 + dy)) safe = false;
    return { opened: m.S.opened.size, safeAroundFirst: safe, cell: m.view.cell,
      p: +m.density(10, 10).toFixed(3), e: m.escape(10, 10) };
  })()`);
  info = Object.assign(info, r);
  await sleep(400);
}
const r = await send('Page.captureScreenshot', { format: 'png' });
if (r.result?.data) writeFileSync(join(OUT, 'live.png'), Buffer.from(r.result.data, 'base64'));
console.log(JSON.stringify({ info, errs }, null, 1));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
