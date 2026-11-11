/* ============================================================
   MINE·4D — render：主雷场 / 相位剖面缩略图 / 4D 邻域扫描仪（全部 canvas）
   ============================================================ */
(function (M) {
'use strict';

const C = {
  bg: '#05090d',
  panel: '#08131a',
  line: '#12303c',
  lineHot: '#1d4d5e',
  hidden: '#0b1a22',
  hiddenTop: '#12303d',
  hiddenHover: '#133341',
  open: '#061016',
  openEdge: '#0e2530',
  accent: '#22d3ee',
  accent2: '#67e8f9',
  amber: '#ffb020',
  mine: '#ff3b6b',
  safe: '#7dffb2',
  dim: '#3c5a68'
};
M.COLORS = C;

const NUM_COLORS = [
  '#5b7b8a', '#64e6ff', '#7dffb2', '#ffd166', '#ff9f68', '#ff6b8a',
  '#d791ff', '#9aa7ff', '#e8f4ff', '#ff4bd8', '#ff8ad0', '#ffc2f0',
  '#c9ffe8', '#ffe9b0', '#ffd0c0', '#ffc9d2', '#e0c9ff', '#c3caff',
  '#ffffff', '#ff7ae0', '#ffb0e8'
];

const els = {};
let dpr = 1;

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

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function digitSize(v) {
  return v >= 100 ? 0.36 : v >= 10 ? 0.46 : 0.54;
}

// ---------------- 主雷场 ----------------
function drawBoard(b, view, now) {
  const { ctx, w, h } = fit(els.board);
  const { NX, NY } = b;
  const pad = 18;
  const avail = { w: w - pad * 2, h: h - pad * 2 };
  const cell = Math.max(8, Math.min(92, avail.w / NX, avail.h / NY));
  const gw = cell * NX, gh = cell * NY;
  const ox = (w - gw) / 2, oy = (h - gh) / 2;
  const gap = Math.max(1, cell * 0.06);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  // 背景网格（扫描台面）
  ctx.strokeStyle = 'rgba(34,211,238,0.055)';
  ctx.lineWidth = 1;
  const step = cell;
  for (let x = ox % step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = oy % step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  // 扫描线：切换相位/层时扫过一遍
  if (view.sweepT > 0) {
    const p = 1 - view.sweepT / 0.55;
    const sx = ox + p * gw;
    const grad = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
    grad.addColorStop(0, 'rgba(34,211,238,0)');
    grad.addColorStop(0.5, 'rgba(34,211,238,0.30)');
    grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - 60, oy, 120, gh);
  }

  const hover = view.hover;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = b.at(x, y, view.z, view.w);
      const st = b.state[i];
      const px = ox + x * cell, py = oy + y * cell;
      const cw = cell - gap, ch = cell - gap;
      const cx = px + gap / 2, cy = py + gap / 2;
      const isHover = hover === i;
      const isSel = view.sel === i;

      if (st === M.OPEN) {
        ctx.fillStyle = C.open;
        roundRect(ctx, cx, cy, cw, ch, Math.max(1.5, cell * 0.1));
        ctx.fill();
        ctx.strokeStyle = C.openEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const g = ctx.createLinearGradient(cx, cy, cx, cy + ch);
        g.addColorStop(0, isHover ? C.hiddenHover : C.hiddenTop);
        g.addColorStop(1, C.hidden);
        ctx.fillStyle = g;
        roundRect(ctx, cx, cy, cw, ch, Math.max(1.5, cell * 0.1));
        ctx.fill();
        ctx.strokeStyle = isHover ? C.lineHot : C.line;
        ctx.lineWidth = 1;
        ctx.stroke();
        // 未开格内的细斜纹，暗示"未扫描"
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, cx, cy, cw, ch, Math.max(1.5, cell * 0.1));
        ctx.clip();
        ctx.strokeStyle = 'rgba(34,211,238,0.055)';
        for (let s = 0; s < cw + ch; s += 5) {
          ctx.beginPath();
          ctx.moveTo(cx + s, cy);
          ctx.lineTo(cx + s - ch, cy + ch);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 翻开动画
      const pop = b.tPop[i] > 0 ? Math.max(0, 1 - (now - b.tPop[i]) / 0.22) : 0;
      if (pop > 0) {
        ctx.fillStyle = `rgba(34,211,238,${0.35 * pop})`;
        roundRect(ctx, cx, cy, cw, ch, Math.max(1.5, cell * 0.1));
        ctx.fill();
      }

      if (st === M.FLAG) {
        const fp = 0.85 + 0.15 * Math.sin(now * 4 + i);
        ctx.fillStyle = C.amber;
        ctx.save();
        ctx.translate(cx + cw / 2, cy + ch / 2);
        ctx.scale(fp, fp);
        ctx.beginPath();
        ctx.moveTo(-cell * 0.06, -cell * 0.24);
        ctx.lineTo(cell * 0.22, -cell * 0.09);
        ctx.lineTo(-cell * 0.06, cell * 0.06);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(-cell * 0.1, -cell * 0.26, Math.max(1.4, cell * 0.05), cell * 0.46);
        ctx.restore();
      } else if (st === M.OPEN) {
        if (b.mine[i]) {
          const isBoom = b.boomAt === i;
          const r = cell * (isBoom ? 0.26 + 0.08 * Math.sin(now * 9) : 0.2);
          ctx.fillStyle = C.mine;
          ctx.beginPath();
          ctx.arc(cx + cw / 2, cy + ch / 2, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,59,107,0.55)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx + cw / 2 - r * 1.5, cy + ch / 2 - r * 1.5);
          ctx.lineTo(cx + cw / 2 + r * 1.5, cy + ch / 2 + r * 1.5);
          ctx.moveTo(cx + cw / 2 + r * 1.5, cy + ch / 2 - r * 1.5);
          ctx.lineTo(cx + cw / 2 - r * 1.5, cy + ch / 2 + r * 1.5);
          ctx.stroke();
        } else if (b.num[i] > 0) {
          const v = b.num[i];
          ctx.fillStyle = NUM_COLORS[Math.min(v, NUM_COLORS.length - 1)];
          ctx.font = `700 ${cell * digitSize(v)}px "Space Mono", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(v), cx + cw / 2, cy + ch / 2 + cell * 0.02);
        } else {
          ctx.fillStyle = 'rgba(125,255,178,0.30)';
          ctx.beginPath();
          ctx.arc(cx + cw / 2, cy + ch / 2, Math.max(1.2, cell * 0.07), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (isHover || isSel) {
        const col = isSel ? C.accent2 : C.accent;
        ctx.strokeStyle = col;
        ctx.lineWidth = isSel ? 2 : 1.4;
        ctx.globalAlpha = isSel ? 0.95 : 0.7;
        const L = Math.min(cw, ch) * 0.32;
        const ccx = cx, ccy = cy;
        const corners = [[ccx, ccy, 1, 1], [ccx + cw, ccy, -1, 1], [ccx, ccy + ch, 1, -1], [ccx + cw, ccy + ch, -1, -1]];
        for (const [bx, by, sx, sy] of corners) {
          ctx.beginPath();
          ctx.moveTo(bx, by + sy * L);
          ctx.lineTo(bx, by);
          ctx.lineTo(bx + sx * L, by);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // 光标坐标读数
  if (hover >= 0 && hover < b.n) {
    const [hx, hy] = b.xyzw(hover);
    ctx.fillStyle = 'rgba(103,232,249,0.85)';
    ctx.font = '600 11px "Space Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`[ ${hx} , ${hy} , ${view.z} , ${view.w} ]`, ox + 2, oy - 16);
  }
  const [nx, ny] = b.cfg.dims;
  ctx.fillStyle = 'rgba(60,90,104,0.9)';
  ctx.font = '500 10px "Space Mono", ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`SLICE ${view.z}/${b.NZ - 1} · PHASE ${view.w}/${b.NW - 1} · GRID ${nx}×${ny}`, ox + gw - 2, oy + gh + 14);
  return { ox, oy, cell, gap, gw, gh };
}

function boardHit(geom, b, view, mouse) {
  if (!geom || !mouse) return -1;
  const x = Math.floor((mouse.x - geom.ox) / geom.cell);
  const y = Math.floor((mouse.y - geom.oy) / geom.cell);
  if (x < 0 || y < 0 || x >= b.NX || y >= b.NY) return -1;
  return b.at(x, y, view.z, view.w);
}

// ---------------- 相位剖面缩略图 ----------------
function drawThumb(canvas, b, z, w, now, active) {
  const { ctx, w: W, h: H } = fit(canvas);
  ctx.fillStyle = active ? 'rgba(34,211,238,0.07)' : 'rgba(255,255,255,0.015)';
  ctx.fillRect(0, 0, W, H);
  if (w < 0 || w >= b.NW) {
    ctx.fillStyle = 'rgba(60,90,104,0.5)';
    ctx.font = '500 9px "Space Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('— 空相位 —', W / 2, H / 2);
    return;
  }
  const pad = 4;
  const cell = Math.min((W - pad * 2) / b.NX, (H - pad * 2) / b.NY);
  const ox = (W - cell * b.NX) / 2, oy = (H - cell * b.NY) / 2;
  for (let y = 0; y < b.NY; y++) {
    for (let x = 0; x < b.NX; x++) {
      const i = b.at(x, y, z, w);
      const st = b.state[i];
      let col = 'rgba(18,48,60,0.9)';
      if (st === M.OPEN) col = b.mine[i] ? C.mine : (b.num[i] > 0 ? NUM_COLORS[Math.min(b.num[i], 20)] : 'rgba(125,255,178,0.5)');
      else if (st === M.FLAG) col = C.amber;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * cell + 0.5, oy + y * cell + 0.5, Math.max(1, cell - 1), Math.max(1, cell - 1));
    }
  }
  ctx.strokeStyle = active ? 'rgba(34,211,238,0.55)' : 'rgba(18,48,60,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// ---------------- 4D 邻域扫描仪 ----------------
// 3×3 个 3×3 小块：(dw, dz) 各 -1/0/+1，每块是 (dx, dy) 的 3×3
function drawScanner(b, sel, now) {
  const { ctx, w: W, h: H } = fit(els.scanner);
  ctx.fillStyle = 'rgba(4,10,14,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(60,90,104,0.9)';
  ctx.font = '500 9px "Space Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  if (sel < 0 || sel >= b.n) {
    ctx.fillStyle = 'rgba(60,90,104,0.65)';
    ctx.fillText('▸ 选中一个格子以展开 4D 邻域', 8, 8);
    return;
  }
  const [sx, sy, sz, sw] = b.xyzw(sel);
  const pad = 10, gap = 8;
  const bw = (W - pad * 2 - gap * 2) / 3;
  const bh = (H - pad * 2 - gap * 2 - 12) / 3;
  const mini = bw / 3;

  const nbSet = new Set(b.neighbors(sel, []));
  const buf = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dw = -1; dw <= 1; dw++) {
      const bx = pad + (dw + 1) * (bw + gap);
      const by = pad + 12 + (dz + 1) * (bh + gap);
      const isCenterPlane = dz === 0 && dw === 0;
      // 块标题
      ctx.fillStyle = isCenterPlane ? C.accent2 : 'rgba(60,90,104,0.95)';
      ctx.font = '500 8.5px "Space Mono", ui-monospace, monospace';
      ctx.fillText(`Δw${dw >= 0 ? '+' + dw : dw} Δz${dz >= 0 ? '+' + dz : dz}`, bx, by - 9);
      ctx.strokeStyle = isCenterPlane ? 'rgba(34,211,238,0.5)' : 'rgba(18,48,60,0.9)';
      ctx.strokeRect(bx - 0.5, by - 0.5, mini * 3 + 1, mini * 3 + 1);
      let unknown = 0, flags = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = bx + (dx + 1) * mini;
          const cy = by + (dy + 1) * mini;
          const px = sx + dx, py = sy + dy, pz = sz + dz, pw = sw + dw;
          const inside = px >= 0 && px < b.NX && py >= 0 && py < b.NY && pz >= 0 && pz < b.NZ && pw >= 0 && pw < b.NW
            && !(dx === 0 && dy === 0 && dz === 0 && dw === 0);
          let fill = 'rgba(10,26,34,0.85)', glyph = '', gcol = C.dim;
          if (!inside) {
            fill = 'rgba(10,20,26,0.5)';
          } else {
            const i = b.at(px, py, pz, pw);
            const inNb = nbSet.has(i);
            const st = b.state[i];
            if (!inNb) {
              ctx.fillStyle = 'rgba(10,18,24,0.55)';
              ctx.fillRect(cx + 0.5, cy + 0.5, mini - 1, mini - 1);
              continue;
            }
            if (st === M.FLAG) { fill = 'rgba(255,176,32,0.22)'; glyph = 'F'; gcol = C.amber; flags++; }
            else if (st === M.OPEN) {
              if (b.mine[i]) { fill = 'rgba(255,59,107,0.25)'; glyph = '✳'; gcol = C.mine; }
              else if (b.num[i] > 0) {
                fill = 'rgba(34,211,238,0.10)';
                glyph = String(b.num[i]);
                gcol = NUM_COLORS[Math.min(b.num[i], 20)];
              } else { fill = 'rgba(125,255,178,0.12)'; glyph = '·'; gcol = C.safe; }
            } else { unknown++; }
          }
          ctx.fillStyle = fill;
          ctx.fillRect(cx + 0.5, cy + 0.5, mini - 1, mini - 1);
          if (glyph) {
            ctx.fillStyle = gcol;
            ctx.font = `700 ${mini * 0.62}px "Space Mono", ui-monospace, monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(glyph, cx + mini / 2, cy + mini / 2 + 0.5);
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          }
        }
      }
      ctx.fillStyle = 'rgba(60,90,104,0.95)';
      ctx.font = '500 8px "Space Mono", ui-monospace, monospace';
      ctx.fillText(`?${unknown} F${flags}`, bx, by + mini * 3 + 2);
    }
  }
}

M.R = {
  init(board, thumbs, scanner) {
    els.board = board; els.thumbs = thumbs; els.scanner = scanner;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
  },
  resize() { dpr = Math.min(window.devicePixelRatio || 1, 2); },
  drawBoard, boardHit, drawThumb, drawScanner, roundRect,
  get geom() { return M.R._geom; },
  set geom(v) { M.R._geom = v; }
};

})(window.M4);
