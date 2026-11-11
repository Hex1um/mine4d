/* ============================================================
   MINE·4D — core：四维雷场逻辑 + 确定性推理器
   坐标 (x, y, z, w)：x 横向、y 纵向、z 深度层、w 相位
   邻域 = 四维各方向距离 ≤ 1 的全部格子（3^4 - 1 = 80 邻）
   ============================================================ */
window.M4 = window.M4 || {};

(function (M) {
'use strict';

// 确定性随机（mulberry32）
M.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

M.DIFFS = [
  { id: 'scan',  name: '侦察',  en: 'SCAN',     dims: [4, 4, 4, 4],   face: 0.19, full: 0.09 },
  { id: 'std',   name: '标准',  en: 'STANDARD', dims: [6, 6, 5, 4],   face: 0.20, full: 0.08 },
  { id: 'deep',  name: '深空',  en: 'DEEP',     dims: [8, 8, 6, 4],   face: 0.20, full: 0.08 },
  { id: 'chaos', name: '熵增',  en: 'CHAOS',    dims: [10, 10, 6, 5], face: 0.21, full: 0.085 }
];

// 邻域模式：face = 四维面邻 8（经典扫雷手感）；full = 四维全邻 80（硬核）
M.MODES = {
  face: { id: 'face', name: '面邻 8', en: 'FACE 8', desc: '四个维度上距离为 1 的格子，数字 0–8' },
  full: { id: 'full', name: '全域 80', en: 'FULL 80', desc: '四维切比雪夫邻域，数字最大 80' }
};
M.mode = 'face';
M.setMode = function (m) { if (M.MODES[m]) M.mode = m; };
M.minesFor = function (d, mode) {
  const [a, b, c, e] = d.dims;
  const n = a * b * c * e;
  const p = (mode || M.mode) === 'full' ? d.full : d.face;
  return Math.max(1, Math.round(n * p));
};
M.diffById = (id) => M.DIFFS.find((d) => d.id === id) || M.DIFFS[1];

// 邻域偏移表
const OFF_FULL = [];
(function () {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dw = -1; dw <= 1; dw++) {
          if (!dx && !dy && !dz && !dw) continue;
          OFF_FULL.push([dx, dy, dz, dw]);
        }
})();
const OFF_FACE = [
  [1, 0, 0, 0], [-1, 0, 0, 0], [0, 1, 0, 0], [0, -1, 0, 0],
  [0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 1], [0, 0, 0, -1]
];
const OFF = OFF_FULL;
M.NEIGHBOR_OFFSETS = OFF_FULL;
M.offsets = () => (M.mode === 'full' ? OFF_FULL : OFF_FACE);

const HIDDEN = 0, OPEN = 1, FLAG = 2;
M.HIDDEN = HIDDEN; M.OPEN = OPEN; M.FLAG = FLAG;

function makeBoard(cfg, seed) {
  const [NX, NY, NZ, NW] = cfg.dims;
  const n = NX * NY * NZ * NW;
  const b = {
    cfg: cfg, diff: cfg.id, mode: M.mode,
    mines: M.minesFor(cfg, M.mode),
    NX, NY, NZ, NW, n,
    mine: new Uint8Array(n),
    num: new Int16Array(n),
    state: new Uint8Array(n),
    tPop: new Float32Array(n),      // 翻开动画计时
    tFlag: new Float32Array(n),
    seed: seed >>> 0,
    rand: M.rng(seed >>> 0),
    started: false, over: false, win: false,
    opened: 0, flags: 0,
    time: 0,
    lastReveal: -1,
    boomAt: -1
  };
  b.at = (x, y, z, w) => ((w * NZ + z) * NY + y) * NX + x;
  b.xyzw = (i) => {
    const x = i % NX; const t = (i - x) / NX;
    const y = t % NY; const t2 = (t - y) / NY;
    const z = t2 % NZ; const w = (t2 - z) / NZ;
    return [x, y, z, w];
  };
  b.inBounds = (x, y, z, w) => x >= 0 && x < NX && y >= 0 && y < NY && z >= 0 && z < NZ && w >= 0 && w < NW;
  const offs = M.offsets();
  b.neighbors = (i, out) => {
    const [x, y, z, w] = b.xyzw(i);
    const res = out || [];
    res.length = 0;
    for (let k = 0; k < offs.length; k++) {
      const o = offs[k];
      const nx = x + o[0], ny = y + o[1], nz = z + o[2], nw = w + o[3];
      if (nx < 0 || nx >= NX || ny < 0 || ny >= NY || nz < 0 || nz >= NZ || nw < 0 || nw >= NW) continue;
      res.push(((nw * NZ + nz) * NY + ny) * NX + nx);
    }
    return res;
  };
  return b;
}

// 首次点击才布雷：点击格与其 80 邻都留空，保证一个干净的开局
function plantMines(b, safeIdx) {
  const safe = new Set(b.neighbors(safeIdx));
  safe.add(safeIdx);
  const pool = [];
  for (let i = 0; i < b.n; i++) if (!safe.has(i)) pool.push(i);
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(b.rand() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const m = Math.min(b.mines, pool.length);
  for (let i = 0; i < m; i++) b.mine[pool[i]] = 1;
  // 数字
  const buf = [];
  for (let i = 0; i < b.n; i++) {
    if (b.mine[i]) { b.num[i] = -1; continue; }
    const nb = b.neighbors(i, buf);
    let c = 0;
    for (let k = 0; k < nb.length; k++) if (b.mine[nb[k]]) c++;
    b.num[i] = c;
  }
  b.started = true;
}

const _buf = [];
function reveal(b, i, t) {
  if (b.over || b.state[i] !== HIDDEN) return 0;
  if (!b.started) plantMines(b, i);
  if (b.mine[i]) {
    b.state[i] = OPEN;
    b.tPop[i] = t;
    b.over = true; b.win = false; b.boomAt = i;
    for (let k = 0; k < b.n; k++) if (b.mine[k]) b.state[k] = OPEN;
    return 1;
  }
  // 四维洪水填充（单次最多铺开 120 格，避免一键掀掉半张图）
  const CAP = 120;
  const stack = [i];
  let opened = 0;
  while (stack.length && opened < CAP) {
    const c = stack.pop();
    if (b.state[c] !== HIDDEN || b.mine[c]) continue;
    b.state[c] = OPEN;
    b.tPop[c] = t;
    opened++;
    if (b.num[c] !== 0) continue;
    const nb = b.neighbors(c, _buf);
    for (let k = 0; k < nb.length; k++) {
      const q = nb[k];
      if (b.state[q] === HIDDEN && !b.mine[q]) stack.push(q);
    }
  }
  b.opened += opened;
  b.lastReveal = i;
  if (b.opened >= b.n - b.mines) { b.over = true; b.win = true; }
  return opened;
}

function toggleFlag(b, i) {
  if (b.over || b.state[i] === OPEN) return false;
  if (b.state[i] === FLAG) { b.state[i] = HIDDEN; b.flags--; }
  else { b.state[i] = FLAG; b.flags++; }
  return true;
}

function chord(b, i, t) {
  if (b.state[i] !== OPEN || b.num[i] <= 0) return 0;
  const nb = b.neighbors(i, _buf);
  let flags = 0, hidden = [];
  for (let k = 0; k < nb.length; k++) {
    const q = nb[k];
    if (b.state[q] === FLAG) flags++;
    else if (b.state[q] === HIDDEN) hidden.push(q);
  }
  if (flags !== b.num[i] || !hidden.length) return 0;
  let n = 0;
  for (const q of hidden) n += reveal(b, q, t);
  return n;
}

// ---------------- 确定性推理器 ----------------
// 只做两类铁定成立的推导：邻域已标满 → 剩余未知格安全；未知格数 == 剩余雷数 → 全是雷
function solveStep(b) {
  const out = { safe: [], mines: [], enough: false, checked: 0 };
  const nb = [];
  for (let i = 0; i < b.n; i++) {
    if (b.state[i] !== OPEN || b.num[i] <= 0) continue;
    out.checked++;
    const list = b.neighbors(i, nb);
    let flags = 0; const unknown = [];
    for (let k = 0; k < list.length; k++) {
      const q = list[k];
      if (b.state[q] === FLAG) flags++;
      else if (b.state[q] === HIDDEN) unknown.push(q);
    }
    const left = b.num[i] - flags;
    if (left <= 0) out.safe.push(...unknown);
    else if (left >= unknown.length) out.mines.push(...unknown);
  }
  out.safe = [...new Set(out.safe)];
  out.mines = [...new Set(out.mines)];
  // 冲突（既被判安全又被判雷）视为不可信，剔除
  const mset = new Set(out.mines);
  out.safe = out.safe.filter((i) => !mset.has(i));
  out.enough = out.safe.length > 0 || out.mines.length > 0;
  return out;
}

// 连续推进到没有确定解为止；最多 steps 轮
function autoSolve(b, t, maxSteps) {
  let totalSafe = 0, totalFlags = 0, rounds = 0;
  const limit = maxSteps || 200;
  while (rounds++ < limit && !b.over) {
    const r = solveStep(b);
    if (!r.enough) break;
    for (const i of r.mines) { if (b.state[i] === HIDDEN) { b.state[i] = FLAG; b.flags++; totalFlags++; b.tFlag[i] = t; } }
    for (const i of r.safe) { if (b.state[i] === HIDDEN) totalSafe += reveal(b, i, t); }
    if (!r.safe.length && !r.mines.length) break;
  }
  return { opened: totalSafe, flagged: totalFlags, rounds };
}

// 概率估算：确定性推理失效时，给出局部风险最小的格子（上界估计）
function estimate(b) {
  const acc = new Map();
  const nb = [];
  for (let i = 0; i < b.n; i++) {
    if (b.state[i] !== OPEN || b.num[i] <= 0) continue;
    const list = b.neighbors(i, nb);
    let flags = 0; const unk = [];
    for (let k = 0; k < list.length; k++) {
      const q = list[k];
      if (b.state[q] === FLAG) flags++;
      else if (b.state[q] === HIDDEN) unk.push(q);
    }
    const left = b.num[i] - flags;
    if (!unk.length) continue;
    const p = Math.max(0, Math.min(1, left / unk.length));
    for (const q of unk) {
      const cur = acc.get(q);
      if (cur === undefined || p > cur) acc.set(q, p);
    }
  }
  let best = -1, bestP = 2;
  for (const [i, p] of acc) if (p < bestP) { bestP = p; best = i; }
  return best >= 0 ? { idx: best, p: bestP } : null;
}

// 提示：返回一处可确定的格子
function hint(b) {
  const r = solveStep(b);
  if (r.safe.length) return { kind: 'safe', idx: r.safe[0], count: r.safe.length };
  if (r.mines.length) return { kind: 'mine', idx: r.mines[0], count: r.mines.length };
  return null;
}

M.HIDDEN = HIDDEN; M.OPEN = OPEN; M.FLAG = FLAG;
M.makeBoard = makeBoard;
M.reveal = reveal;
M.toggleFlag = toggleFlag;
M.chord = chord;
M.solveStep = solveStep;
M.estimate = estimate;
M.autoSolve = autoSolve;
M.hint = hint;

})(window.M4);
