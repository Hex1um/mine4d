/* ============================================================
   FRACTAL·MINE — inf：无限深度的分形引擎
   浮点逃逸时间放大到 ~30 层就退化成噪声；这里换成「数字自动机」：
   把格坐标写成 base-n 的数字串，从低位往高位读，
   每一层「这一格是不是洞」只用整数判断 —— 任意深度都精确、不重复。

   密度 = 3×3 邻域里「洞」的比例（边界度）。
   洞在每一层都存在，所以任何深度都有同尺度的丝状结构，
   密度也与深度无关 —— 这是「能一直钻下去还玩得动」的关键。
   ============================================================ */
window.FM = window.FM || {};

(function (F) {
'use strict';

// 无限模式表：base 决定一次下潜把一格切成几格
const INF = {
  rnd: {
    id: 'rnd', name: '随机分形 ∞', en: 'RANDOM', base: 3,
    formula: '每层按马尔可夫链挖洞（父洞→子更难成洞），只看最近 6 层',
    q1: 0.42, q2: 0.16, band: 6, base0: 0.05, amp: 0.30
  },
  sierp: {
    id: 'sierp', name: 'Sierpinski 三角 ∞', en: 'SIERP ∞', base: 2,
    formula: 'base-2 数字对不得同为 1',
    mask: (dx, dy) => !(dx === 1 && dy === 1),
    base0: 0.05, amp: 0.42, lo: 0.16, hi: 0.55
  },
  carpet: {
    id: 'carpet', name: 'Sierpinski 地毯 ∞', en: 'CARPET ∞', base: 3,
    formula: 'base-3 数字对不得同为 1',
    mask: (dx, dy) => !(dx === 1 && dy === 1),
    base0: 0.05, amp: 0.42, lo: 0.16, hi: 0.55
  },
  vicsek: {
    id: 'vicsek', name: 'Vicsek 十字 ∞', en: 'VICSEK ∞', base: 3,
    formula: 'base-3 数字对必须落在十字五格内',
    // 允许的数字对：中心 + 上下左右
    mask: (dx, dy) => (dx === 1 && dy === 1) || (dx === 1 && (dy === 0 || dy === 2)) ||
      (dy === 1 && (dx === 0 || dx === 2)),
    base0: 0.05, amp: 0.42, lo: 0.16, hi: 0.55
  }
};
F.INF = INF;
F.infList = Object.values(INF);

// 32 位哈希，用于随机挖洞（同一祖先格永远同一个结果）
function h32(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const holeCache = new Map();
const HOLE_LIMIT = 18;
const dX = new Int32Array(HOLE_LIMIT);
const dY = new Int32Array(HOLE_LIMIT);

// 某一格在给定深度是不是「洞」
//  · mask 模式：从最高层往下，每一层的数字对都要落在允许集（真·IFS）
//  · 随机模式：只走最近 band 层，父洞→子更难成洞（马尔可夫链），
//    这样任意深度都有同尺度的结构，也不会出现整片同色的粗块
function holeAt(X, Y, L, m, seed) {
  const ck = X + ',' + Y + ',' + L + ',' + m.id;
  const hit = holeCache.get(ck);
  if (hit !== undefined) return hit;
  const base = m.base;
  const band = m.mask ? Math.min(L, HOLE_LIMIT) : Math.min(L, m.band || 6);
  let x = Math.abs(X), y = Math.abs(Y);
  for (let i = 0; i < band; i++) {
    dX[i] = x % base; dY[i] = y % base;
    x = (x - dX[i]) / base; y = (y - dY[i]) / base;
  }
  let hole = false;
  let tileX = 0, tileY = 0;
  for (let i = band - 1; i >= 0; i--) {
    const k = i + 1;
    tileX = tileX * base + dX[i];
    tileY = tileY * base + dY[i];
    if (m.mask) {
      if (!m.mask(dX[i], dY[i])) { hole = true; break; }
    } else {
      const q = hole ? (m.q2 || 0) : (m.q1 || 0);
      if (h32(tileX, tileY, seed ^ (k * 7919 + 17)) < q) hole = true;
    }
  }
  if (holeCache.size > 260000) holeCache.clear();
  holeCache.set(ck, hole);
  return hole;
}

// 边界度：3×3 里洞的比例。0=实体内部，1=全是洞
function edgeScore(X, Y, L, m, seed) {
  let holes = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (holeAt(X + dx, Y + dy, L, m, seed)) holes++;
    }
  }
  return holes / 9;
}

// 布雷概率：3×3 的洞比例越接近 0.5，说明越贴着簇的边界 → 越密。
// 全洞（深处）与全实体（簇内部）都回到基值，所以密度天然是「1~2 格宽的界面」。
function densityInf(X, Y, L, m, seed) {
  const e = edgeScore(X, Y, L, m, seed);
  const t = Math.max(0, 1 - Math.abs(e - 0.5) * 2);
  const s = t * t * (3 - 2 * t);
  return Math.max(0.02, Math.min(0.6, m.base0 + m.amp * s));
}

F.holeAt = holeAt;
F.edgeScore = edgeScore;
F.densityInf = densityInf;
F.clearInfCache = () => holeCache.clear();
F.infCacheSize = () => holeCache.size;

})(window.FM);
