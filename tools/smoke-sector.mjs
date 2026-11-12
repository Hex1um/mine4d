import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
const CHROME = 'C:/Users/11603/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8898/fractal/';
const PORT = 9411, profile = (process.env.TEMP || '/tmp') + '/fm-sec-' + Date.now();
mkdirSync('tools/out', { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) url = p.webSocketDebuggerUrl; } catch {} if (!url) await sleep(200); }
const ws = new WebSocket(url); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
const send = (me, p = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method: me, params: p })); return new Promise(r => pend.set(id, r)); };
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, timeout: 30000 }); return r.result?.exceptionDetails ? { err: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) writeFileSync('tools/out/' + n, Buffer.from(r.result.data, 'base64')); };
await send('Runtime.enable'); await send('Page.enable');

for (const [w, h, tag, mobile] of [[390, 844, 'mobile', true], [1440, 900, 'desktop', false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: BASE }); await sleep(2500);
  const r = await ev(`(() => {
    const F = window.FM, m = window.__fm;
    const cvs = document.getElementById('board').getBoundingClientRect();
    const sec = F.S.sectorSize;
    const gridPx = m.view.cell * sec;
    const st = F.sectorStats(m.view.target[0], m.view.target[1]);
    return { tag: '${tag}', sector: sec, cell: +m.view.cell.toFixed(1), cellFit: +m.cellFit.toFixed(1),
      gridPx: Math.round(gridPx), board: Math.round(cvs.width) + 'x' + Math.round(cvs.height),
      fits: gridPx <= Math.min(cvs.width, cvs.height) + 1,
      target: m.view.target, mines: st.mines, total: st.total,
      center: [+m.view.cx.toFixed(2), +m.view.cy.toFixed(2)] };
  })()`);
  console.log(JSON.stringify(r));
  await shot(`60-sector-${tag}.png`);
  // 清空一个扇区看是否还能赢
  const win = await ev(`(() => {
    const F = window.FM, m = window.__fm;
    const [tx, ty] = m.view.target, n = F.S.sectorSize;
    const before = document.getElementById('cleared').textContent;
    for (let y = ty * n; y < ty * n + n; y++) for (let x = tx * n; x < tx * n + n; x++) {
      if (!F.isMine(x, y)) m.reveal(x, y);
    }
    return { over: F.S.over, cleared: F.S.cleared.size, before, after: document.getElementById('cleared').textContent,
      banner: document.getElementById('banner').className };
  })()`);
  console.log('  win:', JSON.stringify(win));
}
console.log('errs', errs.slice(0, 3));
ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
