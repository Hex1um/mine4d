/* 合集验收：集合入口 / 4D 变体 / 分形变体（无头 Chromium + CDP） */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8898/';
const OUT = process.argv[3] || 'tools/out';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9361;
mkdirSync(OUT, { recursive: true });
const profile = join(process.env.TEMP || '/tmp', 'm4-coll-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
let seq = 0; const pend = new Map(); let logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
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
const go = async (url, wait = 2200) => {
  await send('Page.navigate', { url });
  await sleep(wait);
  for (let i = 0; i < 2 && !(await ev('document.readyState === "complete"')); i++) await sleep(800);
  return ev('location.pathname');
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const report = {};

// 1) 集合入口
await go(BASE);
report.hub = await ev(`({ title: document.title, cards: [...document.querySelectorAll('.card')].map(a => ({ name: a.querySelector('h2').textContent.trim(), href: a.getAttribute('href') })) })`);
await shot('20-hub.png');

// 2) 4D 变体仍可用
await go(BASE + '4d/');
report.v4d = await ev(`({ ok: !!window.__m4, dims: window.__m4 ? __m4.board.cfg.dims : null })`);

// 3) 分形变体
await go(BASE + 'fractal/');
report.fmBoot = await ev(`({ ok: !!window.__fm, seed: window.__fm ? __fm.S.seed : null,
  cell: window.__fm ? __fm.view.cell : null, sectorSize: window.__fm ? __fm.S.sectorSize : null })`);

// 首击安全：点击格与 8 邻都不是雷
report.firstClick = await ev(`(() => {
  const m = window.__fm;
  const x = 10, y = 10;
  const before = { started: m.S.started };
  m.reveal(x, y);
  let safe = true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.isMine(x + dx, y + dy)) safe = false;
  return { before, started: m.S.started, opened: m.S.opened.size, safeAroundFirst: safe, over: m.S.over };
})()`);
await sleep(400);
await shot('21-fractal.png');

// 分形结构：逃逸时间与密度的取值范围
report.field = await ev(`(() => {
  const m = window.__fm;
  const line = [];
  for (let x = 0; x < 40; x++) line.push({ e: m.escape(x, 10), p: +m.density(x, 10).toFixed(3) });
  const dens = line.map(o => o.p);
  return { minP: Math.min(...dens), maxP: Math.max(...dens), minE: Math.min(...line.map(o=>o.e)), maxE: Math.max(...line.map(o=>o.e)),
    distinct: new Set(dens).size };
})()`);

// 确定性：同一坐标反复取值一致
report.deterministic = await ev(`(() => {
  const m = window.__fm;
  const a = [m.isMine(3, 7), m.isMine(11, 5), m.isMine(-9, 4)];
  const b = [m.isMine(3, 7), m.isMine(11, 5), m.isMine(-9, 4)];
  return { same: JSON.stringify(a) === JSON.stringify(b), sample: a };
})()`);

// 插旗
report.flag = await ev(`(() => { const m = window.__fm; m.flag(20, 20); const on = m.S.flags.has('20,20'); m.flag(20, 20); return { on, off: !m.S.flags.has('20,20') }; })()`);

// 缩放（滚轮锚点）
report.zoom = await ev(`(() => {
  const m = window.__fm, cvs = document.getElementById('board');
  const r = cvs.getBoundingClientRect();
  const c0 = m.view.cell, cx0 = +m.view.cx.toFixed(2);
  cvs.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true, clientX: r.left + 300, clientY: r.top + 200 }));
  return { c0, c1: +m.view.cell.toFixed(1), cx0, cx1: +m.view.cx.toFixed(2) };
})()`);
await sleep(300);

// 平移
report.pan = await ev(`(() => {
  const m = window.__fm, cvs = document.getElementById('board');
  const r = cvs.getBoundingClientRect();
  const cx0 = m.view.cx, cy0 = m.view.cy;
  const x = r.left + 400, y = r.top + 300;
  cvs.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x - 120, clientY: y - 60, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: x - 120, clientY: y - 60, button: 0, bubbles: true }));
  return { dcx: +(m.view.cx - cx0).toFixed(2), dcy: +(m.view.cy - cy0).toFixed(2) };
})()`);

// 清空扇区 0,0 应触发胜利与计数
report.win = await ev(`(() => {
  const m = window.__fm;
  m.newRun(4242);
  const n = m.S.sectorSize;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!m.isMine(x, y) && !m.S.opened.has(x + ',' + y)) m.reveal(x, y);
    if (m.S.over) break;
  }
  return { over: m.S.over, cleared: m.S.cleared.size, banner: document.getElementById('banner').className,
    target: m.view.target.slice(), saved: m.save.cleared };
})()`);
await sleep(600);
await shot('22-fractal-win.png');

// 移动端
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await go(BASE + 'fractal/', 2400);
report.mobile = await ev(`(() => {
  const m = window.__fm, c = document.getElementById('board').getBoundingClientRect();
  return { ok: !!m, w: Math.round(c.width), h: Math.round(c.height), cell: m.view.cell,
    overflowY: getComputedStyle(document.body).overflowY };
})()`);
await ev(`__fm.reveal(10, 10)`);
await sleep(400);
await shot('23-fractal-mobile.png');

report.logs = logs;
console.log(JSON.stringify(report, null, 2));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
