/* 无限分形验收：下潜到不同深度，检查密度不漂移、扇区雷数、坐标缩放，并留截图 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8898/fractal/';
const OUT = process.argv[3] || 'tools/out';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9401;
mkdirSync(OUT, { recursive: true });
const profile = join(process.env.TEMP || '/tmp', 'fm-inf2-' + Date.now());
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
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 30000 });
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

const report = { rows: [] };
for (const mode of ['rnd', 'carpet']) {
  await ev(`__fm.setFractal('${mode}')`);
  await sleep(320);
  for (const L of [6, 12]) {
    await ev(`__fm.setDepth(${L})`);
    await sleep(320);
    const row = await ev(`(() => {
      const F = window.FM, m = window.__fm;
      const st = F.debugSample('${mode}', -18, -13, 36, 26, 2);
      return { mode: '${mode}', L: F.S.depth, cell: +m.view.cell.toFixed(1), cx: Math.round(m.view.cx),
        mean: +st.mean.toFixed(3), run: +st.avgRun.toFixed(2), fil: st.filaments,
        base: F.baseOf(), sector: m.view.target.slice(),
        mines: F.sectorStats(m.view.target[0], m.view.target[1]).mines,
        label: document.getElementById('depth').textContent };
    })()`);
    report.rows.push(row);
    await ev(`__fm.click(${row && row.cx ? row.cx : 0}, ${row && row.cx ? row.cx : 0}, false)`);
    await sleep(220);
    await shot(`42-inf-${mode}-L${L}.png`);
  }
  await ev(`__fm.setDepth(6)`);
}
report.roundtrip = await ev(`(() => {
  const m = window.__fm, F = window.FM;
  const b = { cx: m.view.cx, cy: m.view.cy, cell: m.view.cell, L: F.S.depth };
  m.setDepth(9); m.setDepth(6);
  return { coordOk: Math.abs(m.view.cx - b.cx) < 1e-6 && Math.abs(m.view.cy - b.cy) < 1e-6,
    cellOk: Math.abs(m.view.cell - b.cell) < 1e-6, L: F.S.depth };
})()`);
report.opticGuard = await ev(`(() => { const m = window.__fm; m.setFractal('julia'); return { kind: FM.S.kind, depth: FM.S.depth, down: m.setDepth(3) }; })()`);
report.errors = errs;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
