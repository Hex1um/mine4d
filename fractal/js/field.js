/* ============================================================
   FRACTAL·MINE — field：无限雷场
   雷的密度由 Julia 集逃逸时间决定 → 雷沿分形丝状边界聚集；
   坐标确定即结果确定，平移缩放都不会变。
   ============================================================ */
window.FM = window.FM || {};

(function (F) {
'use strict';

const S = {
  seed: 20261111,
  started: false, over: false, win: false,
  time: 0,
  safe: new Set(),          // 首击排空的格子
  opened: new Set(),
  flags: new Set(),
  cleared: new Map(),       // "sx,sy" -> true
  sectorSize: 21
};
F.S = S;

const key = (x, y) => x + ',' + y;
F.key = key;

// 32 位哈希：同一坐标永远同一个随机数
function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
F.hash = hash;

// Julia 集：z ← z² + c，返回逃逸步数（0..MAX）。分形的骨架在这里。
// 取 c = i（「树状」Julia）：集合本身没有内部、只是一棵细枝，所以地图上处处都是边界，
// 不会出现一大片「内部湖区」让开局无事可做。
// 坐标映射用「复平面锚点 + 每格步长」：z = Z0 + cell × SCALE。
// SCALE = 0.038 时一屏（约 40 格）正好铺满整棵枝杈，横向约 10 次密度起伏。
const MAXI = 40;
const C_RE = 0.0, C_IM = 1.0;
const SCALE = 0.038;
const ZR0 = -0.5, ZI0 = 0.5;

function escape(x, y) {
  let zr = ZR0 + (x + 0.5) * SCALE, zi = ZI0 + (y + 0.5) * SCALE;
  for (let n = 0; n < MAXI; n++) {
    const r2 = zr * zr, i2 = zi * zi;
    if (r2 + i2 > 4) return n;
    const nr = r2 - i2 + C_RE;
    zi = 2 * zr * zi + C_IM;
    zr = nr;
  }
  return MAXI;
}
F.escape = escape;

// 密度场：贴着枝杈（逃逸步数 ≈ 8）的地方最密，形成约 2 格宽的丝状雷带
function density(x, y) {
  const e = escape(x, y);
  const band = Math.exp(-Math.pow((e - 8) / 1.4, 2));
  return Math.min(0.6, 0.05 + 0.42 * band);
}
F.density = density;

function isMine(x, y) {
  if (S.safe.has(key(x, y))) return false;
  return hash(x, y, S.seed) < density(x, y);
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

// 首击：点击格与 8 邻全部排空（写进 safe 集，之后 isMine 自动为 false）
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
  if (!S.started) {
    S.started = true;
    plantSafe(x, y);
  }
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
  numCache.clear(); sectorInfo.clear();
}
F.reset = reset;

// 找一个还没清掉的邻近扇区，用于「下一区」
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

})(window.FM);
