/* MINE·4D 冒烟测试：无头 Chromium + CDP，覆盖布雷、推理、插旗、胜负与移动端 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8898/';
const OUT = process.argv[3] || 'tools/out';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9341;
mkdirSync(OUT, { recursive: true });
const profile = join(process.env.TEMP || '/tmp', 'm4-cdp-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP 未就绪');
}
const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('[exception] ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    logs.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
});
const send = (method, params = {}) => {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pend.set(id, r));
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description || 'err' };
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(2600);
for (let i = 0; i < 3 && !(await ev('!!window.__m4')).value; i++) {
  await ev('location.reload()'); await sleep(2600);
}

const report = {};
report.boot = await ev(`({ ok: !!window.__m4, dims: __m4.board.cfg.dims, mines: __m4.board.cfg.mines,
  n: __m4.board.n, bootOverlay: !document.getElementById('boot').classList.contains('hidden') })`);
await shot('01-boot.png');

// 跳过开机自检
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
await sleep(1200);
report.afterBoot = await ev(`({ booted: __m4.booted, banner: document.getElementById('banner').className })`);
await shot('02-idle.png');

// 首击安全 + 洪水填充
report.firstClick = await ev(`(() => {
  const m = __m4, b = m.board;
  m.reveal(b.at(2, 2, m.view.z, m.view.w));
  return { started: b.started, opened: b.opened, over: b.over,
    safeAroundFirst: b.num[b.at(2,2,m.view.z,m.view.w)], flags: b.flags };
})()`);
await sleep(500);
await shot('03-opened.png');

// 插旗
report.flag = await ev(`(() => {
  const m = __m4, b = m.board;
  let target = -1;
  for (let i = 0; i < b.n; i++) if (b.state[i] === 0) { target = i; break; }
  m.flag(target);
  const flagged = b.state[target] === 2;
  m.flag(target);
  return { flagged, unflagged: b.state[target] === 0, flags: b.flags, target };
})()`);

// 自动推理
report.auto = await ev(`(() => {
  const m = __m4, b = m.board;
  const before = b.opened;
  m.doAuto(); m.doAuto();
  return { before, after: b.opened, over: b.over, flags: b.flags };
})()`);
await sleep(400);
await shot('04-auto.png');

// 切相位 / 切层 + 扫描仪
await ev(`__m4.setPhase(1)`);
await sleep(300);
await ev(`__m4.setZ(2)`);
await sleep(300);
report.view = await ev(`({ w: __m4.view.w, z: __m4.view.z,
  wLabel: document.getElementById('w-val').textContent,
  zOn: document.querySelector('.ztab.on') ? document.querySelector('.ztab.on').textContent : null })`);
await shot('05-phase.png');

// 立体视图
await ev(`__m4.newGame('std', 4242)`);
await sleep(400);
await ev(`__m4.setViewMode('3d')`);
await sleep(700);
report.view3d = await ev(`(() => {
  const m = __m4, b = m.board;
  return { mode: m.view.mode, cells: m.drawList.length, expect: b.NX * b.NY * b.NZ,
    tab: document.querySelector('.view.on') ? document.querySelector('.view.on').textContent.trim() : null,
    camBtn: !document.getElementById('btn-cam').classList.contains('hidden') };
})()`);
await shot('10-view-3d.png');

// 在立体视图里点一个真实格子（走 mousedown/mouseup）
report.click3d = await ev(`(() => {
  const m = __m4, b = m.board;
  const cvs = document.getElementById('board');
  const r = cvs.getBoundingClientRect();
  const c = m.drawList.find((c) => b.state[c.i] === 0);
  if (!c) return 'no cell';
  const cx = r.left + c.sx, cy = r.top + c.sy;
  cvs.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  return { idx: c.i, opened: b.opened, started: b.started, revealed: b.state[c.i] === 1 };
})()`);
await sleep(400);
await shot('10b-3d-click.png');

// 拖动旋转 + 滚轮缩放
report.rotate = await ev(`(() => {
  const m = __m4, cvs = document.getElementById('board');
  const r = cvs.getBoundingClientRect();
  const y0 = m.cam.yaw, p0 = m.cam.pitch, z0 = m.cam.zoom;
  cvs.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + 220, clientY: r.top + 200, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 300, clientY: r.top + 250, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: r.left + 300, clientY: r.top + 250, button: 0, bubbles: true }));
  cvs.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
  return { yaw0: +y0.toFixed(2), yaw1: +m.cam.yaw.toFixed(2), p0: +p0.toFixed(2), p1: +m.cam.pitch.toFixed(2),
    zoom0: +z0.toFixed(2), zoom1: +m.cam.zoom.toFixed(2) };
})()`);
await sleep(400);
await shot('10c-3d-rotated.png');

// 四维视图：所有相位并排
await ev(`__m4.setViewMode('4d')`);
await sleep(700);
report.view4d = await ev(`(() => {
  const m = __m4, b = m.board;
  return { mode: m.view.mode, cells: m.drawList.length, expect: b.n, phases: b.NW,
    labels: document.getElementById('board') ? 1 : 0 };
})()`);
await shot('11-view-4d.png');

// 键盘 1 回到平面
report.back2d = await ev(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
  return { mode: __m4.view.mode, camBtnHidden: document.getElementById('btn-cam').classList.contains('hidden') };
})()`);
await sleep(300);

// 提示
report.hint = await ev(`(() => { __m4.doHint(); return { sel: __m4.view.sel, coords: document.getElementById('coords').textContent }; })()`);
await sleep(300);

// 判负：点亮一颗雷
report.lose = await ev(`(() => {
  const m = __m4, b = m.board;
  let mine = -1;
  for (let i = 0; i < b.n; i++) if (b.mine[i] && b.state[i] === 0) { mine = i; break; }
  if (mine < 0) return 'no hidden mine';
  m.reveal(mine);
  return { over: b.over, win: b.win, banner: document.getElementById('banner').className };
})()`);
await sleep(600);
await shot('06-lose.png');

// 判胜：新开一局，直接揭开所有非雷格
report.win = await ev(`(() => {
  const m = __m4, b = m.board;
  m.newGame('scan', 12345);
  const bb = m.board;
  m.reveal(bb.at(1, 1, m.view.z, m.view.w));
  for (let i = 0; i < bb.n; i++) if (!bb.mine[i] && bb.state[i] !== 1) m.reveal(i);
  return { over: bb.over, win: bb.win, opened: bb.opened, total: bb.n - bb.mines,
    banner: document.getElementById('banner').className, best: __m4.save.best.scan };
})()`);
await sleep(600);
await shot('07-win.png');

// 不同难度重建
report.diffs = await ev(`(() => {
  const m = __m4;
  const out = [];
  for (const d of ['scan','std','deep','chaos']) { m.pickDiff(d); out.push({ id: d, n: m.board.n, mines: m.board.cfg.mines }); }
  return out;
})()`);
report.saveRaw = await ev(`localStorage.getItem('mine4d.save.v1')`);

// 移动端
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL }); await sleep(2600);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
await sleep(2600);
report.mobile = await ev(`(() => {
  const c = document.getElementById('board').getBoundingClientRect();
  const wrap = document.querySelector('.board-wrap').getBoundingClientRect();
  return { w: innerWidth, h: innerHeight, boardW: Math.round(c.width), boardH: Math.round(c.height),
    wrapW: Math.round(wrap.width), cell: __m4.geom ? +__m4.geom.cell.toFixed(1) : null,
    gridW: __m4.geom ? Math.round(__m4.geom.gw) : null,
    overflowY: getComputedStyle(document.body).overflowY,
    footerTop: Math.round(document.querySelector('.bottom').getBoundingClientRect().top),
    sideTop: Math.round(document.querySelector('.side').getBoundingClientRect().top),
    docH: document.documentElement.scrollHeight };
})()`);
await shot('08-mobile.png');
await ev(`__m4.reveal(__m4.board.at(2,2,__m4.view.z,__m4.view.w))`);
await sleep(500);
await shot('09-mobile-open.png');
await ev(`__m4.newGame('std', 4242)`);
await sleep(400);
await ev(`__m4.setViewMode('3d')`);
await sleep(700);
report.mobile3d = await ev(`({ mode: __m4.view.mode, cells: __m4.drawList.length,
  boardW: Math.round(document.getElementById('board').getBoundingClientRect().width) })`);
await shot('12-mobile-3d.png');
await ev(`__m4.setViewMode('2d')`);

report.logs = logs;
console.log(JSON.stringify(report, null, 2));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
