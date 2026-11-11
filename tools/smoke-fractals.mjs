/* 六种分形的逐一验收：切换后能否开局、密度分布、丝宽、截图 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8898/fractal/');
const OUT = process.argv[3] || 'tools/out';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9381;
mkdirSync(OUT, { recursive: true });
const profile = join(process.env.TEMP || '/tmp', 'fm-modes-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--hide-scrollbars', '--mute-audio', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE }); await sleep(2600);

const modes = await ev(`__fm ? Object.keys(FM.MODES) : []`);
const report = { modes, rows: [] };

for (const id of modes) {
  await ev(`__fm.setFractal('${id}')`);
  await sleep(500);
  const row = await ev(`(() => {
    const m = window.__fm, F = window.FM;
    const st = F.debugSample('${id}', -40, -30, 120, 90, 2);
    m.reveal(10, 10);
    const info = F.MODES['${id}'];
    return { id: '${id}', name: info.name, mean: +st.mean.toFixed(3), share: +st.share.toFixed(2),
      avgRun: +st.avgRun.toFixed(2), fil: st.filaments, max: st.max,
      mines0: F.sectorStats(0, 0).mines, opened: F.S.opened.size, over: F.S.over,
      bar: document.querySelector('.mode.on') ? document.querySelector('.mode.on').textContent.trim() : null,
      hud: document.getElementById('fractal').textContent };
  })()`);
  report.rows.push(row);
  await sleep(300);
  if (['julia', 'mandel', 'sierpinski', 'carpet'].includes(id)) await shot(`30-fm-${id}.png`);
}

// 回到 julia 并确认存档记住选择
report.saved = await ev(`(() => { __fm.setFractal('koch'); return JSON.parse(localStorage.getItem('fm.save.v1')).mode; })()`);
report.errors = errs;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
