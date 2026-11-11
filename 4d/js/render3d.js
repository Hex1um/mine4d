/* ============================================================
   MINE·4D — render3d：立体视图（x·y·z）与四维视图（W 轴并排展开）
   自绘正交投影：旋转 yaw/pitch，按深度排序的方块精灵，零依赖。
   ============================================================ */
(function (M) {
'use strict';

const C = M.COLORS;
const NUM_COLORS = [
  '#5b7b8a', '#64e6ff', '#7dffb2', '#ffd166', '#ff9f68', '#ff6b8a',
  '#d791ff', '#9aa7ff', '#e8f4ff', '#ff4bd8', '#ff8ad0', '#ffc2f0',
  '#c9ffe8', '#ffe9b0', '#ffd0c0', '#ffc9d2', '#e0c9ff', '#c3caff',
  '#ffffff', '#ff7ae0', '#ffb0e8'
];

const cam = { yaw: -0.72, pitch: 0.62, zoom: 1 };

// 立方体：角点按 (x,y,z) 的符号位编号，六个面按几何顺序给出
const CI = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
];
const FACES = [
  { n: [1, 0, 0],  ci: [1, 5, 7, 3], shade: 0.72 },
  { n: [-1, 0, 0], ci: [0, 2, 6, 4], shade: 0.64 },
  { n: [0, 1, 0],  ci: [2, 3, 7, 6], shade: 1.0 },
  { n: [0, -1, 0], ci: [0, 4, 5, 1], shade: 0.5 },
  { n: [0, 0, 1],  ci: [4, 6, 7, 5], shade: 0.84 },
  { n: [0, 0, -1], ci: [0, 1, 3, 2], shade: 0.58 }
];
M.cam3 = cam;

let dpr = 1;
const proj = { x: 0, y: 0, z: 0 };

function fit(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// 世界坐标 → 屏幕（正交投影）
function project(px, py, pz, out) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const x1 = px * cy - pz * sy;
  const z1 = px * sy + pz * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const y2 = py * cp - z1 * sp;
  const z2 = py * sp + z1 * cp;
  out.x = x1; out.y = y2; out.z = z2;
  return out;
}

// 布局：三维 = 一个立方阵列；四维 = 每个相位一段，沿 X 并排
function layout(b, mode) {
  const blocks = mode === '4d' ? b.NW : 1;
  const gapW = mode === '4d' ? 2.2 : 0;
  const zSpace = 1.3;                       // 层与层之间留缝，内层才看得见、点得到
  const spanX = blocks * b.NX + (blocks - 1) * gapW;
  return {
    blocks, gapW, zSpace,
    // 世界单位下的整体尺寸，用于自动缩放
    sx: spanX, sy: b.NY, sz: b.NZ * zSpace,
    // 把格坐标换成以中心为原点、单位 = 1 格的世界坐标
    wx: (x, w) => x - b.NX / 2 + (mode === '4d' ? w * (b.NX + gapW) : 0) - (mode === '4d' ? spanX / 2 - b.NX / 2 : 0),
    wy: (y) => y - b.NY / 2,
    wz: (z) => (z - b.NZ / 2) * zSpace
  };
}

let drawList = [];

function draw(b, view, now) {
  const { ctx, w, h } = fit(M.UI.el.board);
  const mode = view.mode;
  const L = layout(b, mode);
  const blocks = L.blocks;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  drawList.length = 0;

  // 自动缩放：让展开后的体积落在画布里
  const diag = Math.hypot(L.sx, L.sy, L.sz) + 2;
  const scale = Math.min(w, h) / diag * 0.92 * cam.zoom;
  const cx = w / 2, cy = h / 2;
  const spr = Math.max(4, Math.min(30, scale * 0.92));

  // 背景：地面网格（帮助判断方位）
  ctx.strokeStyle = 'rgba(34,211,238,0.06)';
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    const a = project(i * 3, 0, -18, { x: 0, y: 0, z: 0 });
    const bq = project(i * 3, 0, 18, { x: 0, y: 0, z: 0 });
    ctx.beginPath();
    ctx.moveTo(cx + a.x * scale, cy - a.y * scale);
    ctx.lineTo(cx + bq.x * scale, cy - bq.y * scale);
    ctx.stroke();
  }

  // 收集所有格子（含投影与深度），按深度从远到近排
  for (let wI = 0; wI < blocks; wI++) {
    for (let z = 0; z < b.NZ; z++) {
      for (let y = 0; y < b.NY; y++) {
        for (let x = 0; x < b.NX; x++) {
          const i = b.at(x, y, z, mode === '4d' ? wI : view.w);
          const p = project(L.wx(x, wI), L.wy(y), L.wz(z), proj);
          drawList.push({
            i, x, y, z, w: wI,
            sx: cx + p.x * scale, sy: cy - p.y * scale, d: p.z
          });
        }
      }
    }
  }
  drawList.sort((a, b2) => a.d - b2.d);

  const activeW = view.w, activeZ = view.z;
  const sel = view.sel >= 0 ? view.sel : view.hover;
  const showDigits = spr >= 12;
  const cubes = drawList.length <= 1500;
  const hw = 0.4 * (spr / Math.max(scale, 0.001)) ;   // 半边长（世界单位）

  // 每帧只算一次：立方体的 8 个角在屏幕上的偏移，以及当前机位下可见的三个面
  const off = [];
  for (let i = 0; i < 8; i++) {
    const p = project(CI[i][0] * 0.35, CI[i][1] * 0.35, CI[i][2] * 0.35, { x: 0, y: 0, z: 0 });
    off.push({ x: p.x * scale, y: -p.y * scale });
  }
  const visFaces = [];
  for (const f of FACES) {
    const p = project(f.n[0], f.n[1], f.n[2], { x: 0, y: 0, z: 0 });
    if (p.z > 0) visFaces.push(f);
  }

  for (let k = 0; k < drawList.length; k++) {
    const c = drawList[k];
    const st = b.state[c.i];
    const inSlice = c.z === activeZ && (mode !== '4d' || c.w === activeW);
    const fade = inSlice ? 1 : 0.5 + 0.14 * ((c.d + 30) / 60);
    ctx.globalAlpha = fade;

    let base;
    if (st === M.OPEN) {
      if (b.mine[c.i]) base = [190, 38, 68];
      else if (b.num[c.i] > 0) base = [10, 24, 32];
      else base = [10, 46, 40];
    } else if (st === M.FLAG) base = [86, 58, 10];
    else base = inSlice ? [26, 62, 78] : [17, 42, 54];

    if (cubes) {
      const hs = spr * 0.42;
      for (let fi = 0; fi < visFaces.length; fi++) {
        const f = visFaces[fi];
        const sh = f.shade;
        ctx.fillStyle = `rgb(${Math.round(base[0] * sh)},${Math.round(base[1] * sh)},${Math.round(base[2] * sh)})`;
        const a = off[f.ci[0]], bq = off[f.ci[1]], cq = off[f.ci[2]], dq = off[f.ci[3]];
        ctx.beginPath();
        ctx.moveTo(c.sx + a.x, c.sy + a.y);
        ctx.lineTo(c.sx + bq.x, c.sy + bq.y);
        ctx.lineTo(c.sx + cq.x, c.sy + cq.y);
        ctx.lineTo(c.sx + dq.x, c.sy + dq.y);
        ctx.closePath();
        ctx.fill();
      }
      // 顶面描边，勾出晶格
      if (drawList.length <= 800) {
        const top = FACES[2];
        ctx.strokeStyle = inSlice ? 'rgba(34,211,238,0.30)' : 'rgba(34,211,238,0.10)';
        ctx.lineWidth = 1;
        const a = off[top.ci[0]], bq = off[top.ci[1]], cq = off[top.ci[2]], dq = off[top.ci[3]];
        ctx.beginPath();
        ctx.moveTo(c.sx + a.x, c.sy + a.y);
        ctx.lineTo(c.sx + bq.x, c.sy + bq.y);
        ctx.lineTo(c.sx + cq.x, c.sy + cq.y);
        ctx.lineTo(c.sx + dq.x, c.sy + dq.y);
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      // 大棋盘退化成方块精灵，保证帧率
      const size = spr * 0.86;
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(c.sx - size / 2, c.sy - size / 2, size, size);
      ctx.strokeStyle = inSlice ? 'rgba(34,211,238,0.42)' : 'rgba(34,211,238,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(c.sx - size / 2 + 0.5, c.sy - size / 2 + 0.5, size - 1, size - 1);
    }

    // 内容层
    if (st === M.FLAG) {
      ctx.fillStyle = C.amber;
      ctx.fillRect(c.sx - spr * 0.03, c.sy - spr * 0.22, Math.max(1.2, spr * 0.06), spr * 0.44);
      ctx.beginPath();
      ctx.moveTo(c.sx + spr * 0.02, c.sy - spr * 0.22);
      ctx.lineTo(c.sx + spr * 0.22, c.sy - spr * 0.08);
      ctx.lineTo(c.sx + spr * 0.02, c.sy + spr * 0.04);
      ctx.closePath();
      ctx.fill();
    } else if (st === M.OPEN) {
      if (b.mine[c.i]) {
        ctx.fillStyle = '#2b0611';
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, spr * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.num[c.i] > 0 && showDigits) {
        const v = b.num[c.i];
        ctx.fillStyle = NUM_COLORS[Math.min(v, NUM_COLORS.length - 1)];
        ctx.font = `700 ${spr * (v >= 10 ? 0.36 : 0.46)}px "Space Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), c.sx, c.sy + spr * 0.03);
      } else if (b.num[c.i] === 0) {
        ctx.fillStyle = 'rgba(125,255,178,0.5)';
        ctx.fillRect(c.sx - spr * 0.05, c.sy - spr * 0.05, spr * 0.1, spr * 0.1);
      }
    }

    if (sel === c.i) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.accent2;
      ctx.lineWidth = 2;
      const hs = spr * 0.52;
      ctx.strokeRect(c.sx - hs, c.sy - hs, hs * 2, hs * 2);
    }
  }
  ctx.globalAlpha = 1;

  // 四维：每段下方标相位
  if (mode === '4d') {
    ctx.font = '700 11px "Space Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let wI = 0; wI < blocks; wI++) {
      const p = project(L.wx(0, wI), L.wy(0) - 1.3, L.wz(0), proj);
      ctx.fillStyle = wI === activeW ? C.accent2 : 'rgba(74,107,120,0.9)';
      ctx.fillText('W' + wI, cx + p.x * scale, cy - p.y * scale);
    }
  }

  // 方位罗盘
  drawGizmo(ctx, w, h, scale);
  return { scale, cx, cy, spr };
}

function drawGizmo(ctx, w, h, scale) {
  const ox = w - 62, oy = h - 62, len = 34;
  const axes = [
    { v: [1, 0, 0], c: '#22d3ee', t: 'X' },
    { v: [0, 1, 0], c: '#7dffb2', t: 'Y' },
    { v: [0, 0, 1], c: '#ffb020', t: 'Z' }
  ];
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.font = '600 9px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of axes) {
    const p = project(a.v[0], a.v[1], a.v[2], proj);
    const ex = ox + p.x * len, ey = oy - p.y * len;
    ctx.strokeStyle = a.c;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = a.c;
    ctx.fillText(a.t, ox + p.x * (len + 9), oy - p.y * (len + 9));
  }
  ctx.restore();
}

// 命中：取屏幕上离指针最近、且深度最靠前的格子
function hit(b, view, mouse) {
  if (!drawList.length) return -1;
  let best = -1, bestScore = Infinity;
  for (let k = drawList.length - 1; k >= 0; k--) {   // 从近到远
    const c = drawList[k];
    const d = Math.hypot(mouse.x - c.sx, mouse.y - c.sy);
    if (d > 14 && d > 0) continue;
    const score = d - c.d * 0.02;
    if (score < bestScore) { bestScore = score; best = c.i; }
  }
  if (best >= 0) return best;
  // 退化：最近的格子
  let bd = 1e9;
  for (let k = 0; k < drawList.length; k++) {
    const c = drawList[k];
    const d = Math.hypot(mouse.x - c.sx, mouse.y - c.sy);
    if (d < bd) { bd = d; best = c.i; }
  }
  return bd < 26 ? best : -1;
}

function resetCam(mode) {
  if (mode === '4d') {
    cam.yaw = -0.22; cam.pitch = 0.40; cam.zoom = 1.28;
  } else {
    cam.yaw = -0.62; cam.pitch = 0.52; cam.zoom = 1;
  }
}

M.R3 = { draw, hit, resetCam, cam, fit, get drawList() { return drawList; } };

})(window.M4);
