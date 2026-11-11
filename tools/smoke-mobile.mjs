/* 手机端验收：游戏屏独占、返回键、HUD 数值、触屏点击与缩放 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8898/fractal/';
const OUT = process.argv[3] || 'tools/out';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9405;
mkdirSync(OUT, { recursive: true });
const profile = join(process.env.TEMP || '/tmp', 'fm-mob-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--hide-scrollbars', '--mute-audio', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
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
});
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pend.set(id, r)); };
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 30000 });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  screenOrientation: { type: 'portraitPrimary', angle: 0 }
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: BASE }); await sleep(2600);

const report = {};
report.boot = await ev(`(() => {
  const b = document.getElementById('board').getBoundingClientRect();
  return { playing: document.body.classList.contains('playing'),
    boardW: Math.round(b.width), boardH: Math.round(b.height),
    hudVisible: getComputedStyle(document.getElementById('hud')).display,
    headerHidden: getComputedStyle(document.querySelector('.top')).display };
})()`);
await shot('50-mobile-gamescreen.png');

// 返回键 → 概览布局
report.back = await ev(`(() => {
  document.getElementById('btn-back').click();
  const b = document.getElementById('board').getBoundingClientRect();
  return { playing: document.body.classList.contains('playing'),
    header: getComputedStyle(document.querySelector('.top')).display,
    boardH: Math.round(b.height), backVisible: getComputedStyle(document.getElementById('hud')).display };
})()`);
await sleep(300);
await shot('51-mobile-overview.png');

// 进入游戏屏 → 下潜一层 → 触屏轻点
report.enter = await ev(`(() => {
  document.getElementById('btn-focus').click();
  const t = document.getElementById('hud-depth');
  return { playing: document.body.classList.contains('playing'), depthChip: t.textContent };
})()`);
await sleep(400);
report.descend = await ev(`(() => {
  window.__fm.setFractal('rnd');
  document.getElementById('hud-down').click();
  return { depth: FM.S.depth, chip: document.getElementById('hud-depth').textContent,
    mines: document.getElementById('hud-mines').textContent,
    cell: +__fm.view.cell.toFixed(1) };
})()`);
await sleep(500);

// 屏幕中央轻点排雷（触屏事件）
report.tap = await ev(`(() => {
  const cvs = document.getElementById('board');
  const r = cvs.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const opts = { pointerId: 7, clientX: cx, clientY: cy, bubbles: true, pointerType: 'touch', isPrimary: true };
  cvs.dispatchEvent(new PointerEvent('pointerdown', opts));
  cvs.dispatchEvent(new PointerEvent('pointerup', opts));
  return { opened: FM.S.opened.size, started: FM.S.started };
})()`);
await sleep(400);
await shot('52-mobile-play.png');

// 横屏
await send('Emulation.setDeviceMetricsOverride', {
  width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
  screenOrientation: { type: 'landscapePrimary', angle: 90 }
});
await send('Page.navigate', { url: BASE }); await sleep(2400);
report.landscape = await ev(`(() => {
  const b = document.getElementById('board').getBoundingClientRect();
  const h = document.querySelector('.hud-top').getBoundingClientRect();
  return { playing: document.body.classList.contains('playing'), boardH: Math.round(b.height),
    hudTopBottom: Math.round(h.bottom), chips: document.getElementById('hud-fractal').textContent };
})()`);
await shot('53-mobile-landscape.png');

report.errors = errs;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
