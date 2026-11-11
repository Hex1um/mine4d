/* ============================================================
   FRACTAL·MINE — field：无限雷场 × 多种经典分形
   每格先算一个「吸引子邻近量」：
     · Julia / Mandelbrot → 复平面逃逸时间
     · Sierpinski / Koch / Dragon → IFS 逆迭代（点是否还留在吸引子上）
   邻近量再映射成布雷概率，于是雷沿分形骨架聚集。
   ============================================================ */
window.FM = window.FM || {};

(function (F) {
'use strict';

const S = {
  seed: 20261111,
  mode: 'julia',
  started: false, over: false, win: false,
  time: 0,
  safe: new Set(),
  opened: new Set(),
  flags: new Set(),
  cleared: new Map(),
  sectorSize: 21
};
F.S = S;

const key = (x, y) => x + ',' + y;
F.key = key;

// ---------------- IFS 相似变换表（逆迭代用） ----------------
// 每个 map 把单位正方形映到一个子区域：scale 缩放、rot 旋转、tx/ty 平移
const SQ3 = Math.sqrt(3);
const S2 = Math.SQRT1_2;
const IFS = {
  sierpinski: [
    { s: 0.5, r: 0, tx: 0, ty: 0 },
    { s: 0.5, r: 0, tx: 0.5, ty: 0 },
    { s: 0.5, r: 0, tx: 0, ty: 0.5 }
  ],
  koch: [
    { s: 1 / 3, r: 0, tx: 0, ty: 0 },
    { s: 1 / 3, r: Math.PI / 3, tx: 1 / 3, ty: 0 },
    { s: 1 / 3, r: -Math.PI / 3, tx: 0.5, ty: SQ3 / 6 },
    { s: 1 / 3, r: 0, tx: 2 / 3, ty: 0 }
  ],
  // Vicsek 十字：五个 1/3 方块围成十字，互不重叠，逆迭代很稳
  vicsek: [
    { s: 1 / 3, r: 0, tx: 1 / 3, ty: 0 },
    { s: 1 / 3, r: 0, tx: 0, ty: 1 / 3 },
    { s: 1 / 3, r: 0, tx: 1 / 3, ty: 1 / 3 },
    { s: 1 / 3, r: 0, tx: 2 / 3, ty: 1 / 3 },
    { s: 1 / 3, r: 0, tx: 1 / 3, ty: 2 / 3 }
  ],
  carpet: [
    { s: 1 / 3, r: 0, tx: 0, ty: 0 },       { s: 1 / 3, r: 0, tx: 1 / 3, ty: 0 },   { s: 1 / 3, r: 0, tx: 2 / 3, ty: 0 },
    { s: 1 / 3, r: 0, tx: 0, ty: 1 / 3 },                                            { s: 1 / 3, r: 0, tx: 2 / 3, ty: 1 / 3 },
    { s: 1 / 3, r: 0, tx: 0, ty: 2 / 3 },   { s: 1 / 3, r: 0, tx: 1 / 3, ty: 2 / 3 }, { s: 1 / 3, r: 0, tx: 2 / 3, ty: 2 / 3 }
  ]
};

// IFS 阈值：逃过 n 次逆迭代 ⇒ 距离骨架约 r^n（域单位）。
// 想让丝宽约 2w 格，就取 r^n ≈ w × scale ⇒ n₀ = ln(w × scale) / ln(r)。
// 这样改缩放不用重新猜阈值——密度剖面自己跟着走。
function ifsN0(m) {
  const r = IFS[m.maps][0].s;
  return Math.log(Math.max(1e-9, (m.w || 1.5) * m.scale)) / Math.log(r);
}
function ifsDen(n, m) {
  const n0 = ifsN0(m);
  return 0.05 + (m.amp || 0.42) * Math.min(1, Math.max(0, (n - n0 + 1.2) / 2.4));
}
F.ifsN0 = ifsN0;

// ---------------- 模式表 ----------------
const MODES = {
  julia: {
    id: 'julia', name: 'Julia 树', en: 'JULIA', formula: 'z ← z² + i',
    kind: 'julia', scale: 0.038, ox: -0.5, oy: 0.5, maxI: 40,
    den: (e) => 0.05 + 0.42 * Math.exp(-Math.pow((e - 8) / 1.4, 2))
  },
  mandel: {
    id: 'mandel', name: 'Mandelbrot', en: 'MANDELBROT', formula: 'z ← z² + c，c 取格坐标',
    kind: 'mandel', scale: 0.0014, ox: -0.79, oy: 0.2, maxI: 60,
    den: (e) => 0.05 + 0.44 * Math.exp(-Math.pow((e - 16) / 1.2, 2))
  },
  sierpinski: {
    id: 'sierpinski', name: 'Sierpinski 三角', en: 'SIERPINSKI', formula: '三个 1/2 相似映射',
    kind: 'ifs', maps: 'sierpinski', scale: 0.006, ox: 0.18, oy: 0.18, maxI: 26, w: 1.6, den: ifsDen
  },
  koch: {
    id: 'koch', name: 'Koch 曲线', en: 'KOCH', formula: '四段 1/3，交替 ±60°',
    kind: 'ifs', maps: 'koch', scale: 0.005, ox: 0.12, oy: 0.0, maxI: 26, w: 2.4, amp: 0.46, den: ifsDen
  },
  vicsek: {
    id: 'vicsek', name: 'Vicsek 十字', en: 'VICSEK', formula: '五个 1/3 方块围成十字',
    kind: 'ifs', maps: 'vicsek', scale: 0.005, ox: 0.06, oy: 0.4, maxI: 26, w: 1.9, den: ifsDen
  },
  carpet: {
    id: 'carpet', name: 'Sierpinski 地毯', en: 'CARPET', formula: '八个 1/3 相似映射',
    kind: 'ifs', maps: 'carpet', scale: 0.0032, ox: 0.2, oy: 0.12, maxI: 26, w: 1.6, amp: 0.24, den: ifsDen
  }
};
F.MODES = MODES;
F.modeList = Object.values(MODES);

function setMode(id) {
  if (!MODES[id]) return false;
  S.mode = id;
  numCache.clear();
  sectorInfo.clear();
  probeCache.clear();
  return true;
}
F.setMode = setMode;

// ---------------- 吸引子邻近量 ----------------
function escapeJulia(x, y, m) {
  let zr = m.ox + (x + 0.5) * m.scale, zi = m.oy + (y + 0.5) * m.scale;
  for (let n = 0; n < m.maxI; n++) {
    const r2 = zr * zr, i2 = zi * zi;
    if (r2 + i2 > 4) return n;
    const nr = r2 - i2;           // c = i
    zi = 2 * zr * zi + 1;
    zr = nr;
  }
  return m.maxI;
}

function escapeMandel(x, y, m) {
  const cr = m.ox + (x + 0.5) * m.scale, ci = m.oy + (y + 0.5) * m.scale;
  let zr = 0, zi = 0;
  for (let n = 0; n < m.maxI; n++) {
    const r2 = zr * zr, i2 = zi * zi;
    if (r2 + i2 > 4) return n;
    const nr = r2 - i2 + cr;
    zi = 2 * zr * zi + ci;
    zr = nr;
  }
  return m.maxI;
}

// 逆迭代：越晚「逃出」越贴近骨架；一路留在吸引子上就返回 maxI
function ifsIter(x, y, m) {
  const maps = IFS[m.maps];
  let px = m.ox + (x + 0.5) * m.scale;
  let py = m.oy + (y + 0.5) * m.scale;
  for (let n = 0; n < m.maxI; n++) {
    let hit = false;
    for (let k = 0; k < maps.length; k++) {
      const mp = maps[k];
      const dx = px - mp.tx, dy = py - mp.ty;
      const c = Math.cos(-mp.r), s = Math.sin(-mp.r);
      const qx = (dx * c - dy * s) / mp.s;
      const qy = (dx * s + dy * c) / mp.s;
      if (qx >= 0 && qx <= 1 && qy >= 0 && qy <= 1) { px = qx; py = qy; hit = true; break; }
    }
    if (!hit) return n;
  }
  return m.maxI;
}

const probeCache = new Map();

function raw(x, y, m) {
  m = m || MODES[S.mode];
  if (m.kind === 'julia') return escapeJulia(x, y, m);
  if (m.kind === 'mandel') return escapeMandel(x, y, m);
  return ifsIter(x, y, m);
}
F.raw = raw;

function density(x, y, modeId) {
  const m = MODES[modeId || S.mode];
  const ck = key(x, y) + '|' + m.id;
  const hit = probeCache.get(ck);
  if (hit !== undefined) return hit;
  const v = raw(x, y, m);
  const p = Math.max(0.02, Math.min(0.6, m.den(v, m)));
  probeCache.set(ck, p);
  return p;
}
F.density = density;
F.escape = (x, y) => raw(x, y, MODES[S.mode]);

// ---------------- 雷场 ----------------
function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
F.hash = hash;

// 每种分形配一个种子盐，换模式就是换一张雷场
const MODE_SALT = { julia: 0x1f, mandel: 0x2b, sierpinski: 0x37, koch: 0x43, vicsek: 0x51, carpet: 0x5d };

function isMine(x, y) {
  if (S.safe.has(key(x, y))) return false;
  const salt = MODE_SALT[S.mode] || 0;
  return hash(x, y, S.seed ^ salt) < density(x, y);
}
F.isMine = isMine;

const numCache = new Map();
function number(x, y) {
  const k = key(x, y);
  const hit = numCache.get(k);
  if (hit !== undefined) return hit;
  let c = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (isMine(x + dx, y + dy)) c++;
    }
  }
  numCache.set(k, c);
  return c;
}
F.number = number;

function sectorOf(x, y) {
  const n = S.sectorSize;
  return [Math.floor(x / n), Math.floor(y / n)];
}
F.sectorOf = sectorOf;

const sectorInfo = new Map();
function sectorStats(sx, sy) {
  const k = sx + ',' + sy;
  let info = sectorInfo.get(k);
  if (info) return info;
  const n = S.sectorSize;
  let mines = 0, total = n * n;
  for (let y = sy * n; y < sy * n + n; y++) {
    for (let x = sx * n; x < sx * n + n; x++) if (isMine(x, y)) mines++;
  }
  info = { mines, total, opened: 0 };
  sectorInfo.set(k, info);
  return info;
}
F.sectorStats = sectorStats;

function plantSafe(x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) S.safe.add(key(x + dx, y + dy));
  }
  numCache.clear();
  sectorInfo.clear();
}

const floodCap = 110;

function reveal(x, y) {
  if (S.over) return 0;
  if (S.flags.has(key(x, y))) return 0;
  if (S.opened.has(key(x, y))) return 0;
  if (!S.started) { S.started = true; plantSafe(x, y); }
  if (isMine(x, y)) {
    S.over = true; S.win = false;
    S.opened.add(key(x, y));
    bumpSector(x, y, 1);
    return 1;
  }
  let count = 0;
  const stack = [[x, y]];
  while (stack.length && count < floodCap) {
    const [cx, cy] = stack.pop();
    const k = key(cx, cy);
    if (S.opened.has(k) || S.flags.has(k)) continue;
    if (isMine(cx, cy)) continue;
    S.opened.add(k);
    count++;
    bumpSector(cx, cy, 1);
    if (number(cx, cy) !== 0) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nk = key(cx + dx, cy + dy);
        if (!S.opened.has(nk) && !S.flags.has(nk)) stack.push([cx + dx, cy + dy]);
      }
    }
  }
  return count;
}
F.reveal = reveal;

function bumpSector(x, y, d) {
  const [sx, sy] = sectorOf(x, y);
  sectorStats(sx, sy).opened += d;
}

function sectorCleared(sx, sy) {
  const st = sectorStats(sx, sy);
  return st.opened >= st.total - st.mines;
}
F.sectorCleared = sectorCleared;

function toggleFlag(x, y) {
  if (S.over) return false;
  const k = key(x, y);
  if (S.opened.has(k)) return false;
  if (S.flags.has(k)) S.flags.delete(k);
  else S.flags.add(k);
  return true;
}
F.toggleFlag = toggleFlag;

function chord(x, y) {
  if (S.over) return 0;
  const k = key(x, y);
  if (!S.opened.has(k)) return 0;
  const n = number(x, y);
  if (n <= 0) return 0;
  let flags = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (S.flags.has(key(x + dx, y + dy))) flags++;
    }
  }
  if (flags !== n) return 0;
  let opened = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nk = key(x + dx, y + dy);
      if (!S.opened.has(nk) && !S.flags.has(nk)) opened += reveal(x + dx, y + dy);
    }
  }
  return opened;
}
F.chord = chord;

function reset(seed) {
  S.seed = (seed === undefined ? S.seed : seed) >>> 0;
  S.started = false; S.over = false; S.win = false; S.time = 0;
  S.safe.clear(); S.opened.clear(); S.flags.clear(); S.cleared.clear();
  numCache.clear(); sectorInfo.clear(); probeCache.clear();
}
F.reset = reset;

function nextSector(sx, sy, around) {
  const r = around || 6;
  let best = null, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = sx + dx, ny = sy + dy;
      if (S.cleared.has(nx + ',' + ny)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = [nx, ny]; }
    }
  }
  return best || [sx, sy];
}
F.nextSector = nextSector;

// 调参用：在给定模式/窗口里统计密度分布与丝宽
F.debugSample = function (modeId, x0, y0, w, h, step) {
  const st = { n: 0, sum: 0, hi: 0, runs: [], max: 0, min: 1 };
  step = step || 1;
  for (let y = y0; y < y0 + h; y += step) {
    let cur = 0;
    for (let x = x0; x < x0 + w; x += step) {
      const p = density(x, y, modeId);
      st.n++; st.sum += p; st.max = Math.max(st.max, p); st.min = Math.min(st.min, p);
      if (p > 0.3) { st.hi++; cur++; } else { if (cur) st.runs.push(cur); cur = 0; }
    }
    if (cur) st.runs.push(cur);
  }
  st.mean = st.sum / st.n;
  st.share = st.hi / st.n;
  st.avgRun = st.runs.length ? st.runs.reduce((a, b) => a + b, 0) / st.runs.length : 0;
  st.filaments = st.runs.length;
  return st;
};

})(window.FM);
