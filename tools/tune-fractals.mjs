/* 分形参数扫描：为每种模式找一组「密度 12~20%、丝宽 1.5~3.5 格、丝条数多」的映射参数。
   用法：node tools/tune-fractals.mjs [baseUrl] */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8898/fractal/';
const CHROME = process.env.CHROME_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe`;
const PORT = 9371;
const profile = `${process.env.TEMP || '/tmp'}/fm-tune-${Date.now()}`;
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
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
let seq = 0; const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pend.set(id, r));
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: BASE });
await sleep(2600);

const plan = {
  mandel: {
    scales: [0.00018, 0.0003, 0.0005, 0.0008, 0.0014],
    ox: [-0.7445, -0.7443, -0.7447, -0.7435],
    oy: [0.1315, 0.1312, 0.1318, 0.1325],
    ctr: [4, 6, 9, 14, 22], wid: [1.6, 2.6, 4.0]
  },
  sierpinski: {
    scales: [0.0045, 0.006, 0.0075, 0.0095, 0.012],
    ox: [0.10, 0.14, 0.18, 0.06, 0.22],
    oy: [0.10, 0.14, 0.18, 0.06, 0.22]
  },
  koch: {
    scales: [0.005, 0.007, 0.009, 0.012, 0.016],
    ox: [0.03, 0.06, 0.10, 0.15, 0.2],
    oy: [0.01, 0.03, 0.05, 0.08, 0.12]
  },
  vicsek: {
    scales: [0.005, 0.0075, 0.01, 0.014, 0.02],
    ox: [0.12, 0.2, 0.28, 0.05, 0.35],
    oy: [0.12, 0.2, 0.28, 0.05, 0.35]
  },
  carpet: {
    scales: [0.0016, 0.0024, 0.0032, 0.0045, 0.006],
    ox: [0.12, 0.2, 0.28, 0.06, 0.36],
    oy: [0.12, 0.2, 0.28, 0.06, 0.36]
  }
};

const out = {};
for (const [id, p] of Object.entries(plan)) {
  const r = await ev(`(() => {
    const F = window.FM, m = F.MODES['${id}'];
    const scales = ${JSON.stringify(p.scales)};
    const oxs = ${JSON.stringify(p.ox)}, oys = ${JSON.stringify(p.oy)};
    const ctrs = ${JSON.stringify(p.ctr || [])}, wids = ${JSON.stringify(p.wid || [])};
    const baseDen = m.den;
    let best = null;
    for (const s of scales) for (const ox of oxs) for (const oy of oys) {
      const bands = ctrs.length ? ctrs.flatMap(c => wids.map(w => [c, w])) : [[null, null]];
      for (const [ctr, wid] of bands) {
      if (ctr !== null) m.den = (e) => 0.05 + 0.44 * Math.exp(-Math.pow((e - ctr) / wid, 2));
      m.scale = s; m.ox = ox; m.oy = oy;
      F.reset(20261111);
      const st = F.debugSample('${id}', -40, -30, 120, 90, 2);
      // 无限棋盘只看「局部扇区是否好玩」：丝条数够多、丝宽 1~3.5 格即可，
      // 大范围均值只作为参考（不同分形本来就该有不同的平均密度）
      const score = -st.filaments * 0.5 + Math.abs(Math.min(st.avgRun, 4) - 2) * 6
        - Math.min(st.mean, 0.3) * 40;
      if (st.filaments >= 15 && st.avgRun > 0.8 && st.avgRun < 4 && st.max >= 0.4
          && (!best || score < best.score)) {
        best = { score: +score.toFixed(1), s, ox, oy, ctr, wid, mean: +st.mean.toFixed(3),
          share: +st.share.toFixed(3), avgRun: +st.avgRun.toFixed(2),
          fil: st.filaments, max: +st.max.toFixed(2), min: +st.min.toFixed(2) };
      }
      }
    }
    m.den = baseDen;
    return best;
  })()`);
  out[id] = r;
  console.log(id, JSON.stringify(r));
}

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
