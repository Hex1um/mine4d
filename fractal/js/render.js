/* ============================================================
   FRACTAL·MINE — render：无限平面（平移 / 缩放），密度场底噪，扇区框
   ============================================================ */
(function (F) {
'use strict';

const C = {
  bg: '#04080c',
  grid: 'rgba(34,211,238,0.07)',
  gridHot: 'rgba(34,211,238,0.14)',
  open: '#061016',
  openEdge: '#0e2530',
  hidden: '#0b1a22',
  hiddenTop: '#12303d',
  accent: '#22d3ee',
  accent2: '#67e8f9',
  amber: '#ffb020',
  mine: '#ff3b6b',
  safe: '#7dffb2',
  dim: '#3c5a68'
};
const NUM = [
  '#5b7b8a', '#64e6ff', '#7dffb2', '#ffd166', '#ff9f68', '#ff6b8a',
  '#d791ff', '#9aa7ff', '#e8f4ff'
];

let dpr = 1;
let last = null;

function fit(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function draw(canvas, view, now) {
  const { ctx, w, h } = fit(canvas);
  const S = F.S;
  const cell = view.cell;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  const halfW = w / 2, halfH = h / 2;
  const x0 = Math.floor(view.cx - halfW / cell) - 1;
  const x1 = Math.ceil(view.cx + halfW / cell) + 1;
  const y0 = Math.floor(view.cy - halfH / cell) - 1;
  const y1 = Math.ceil(view.cy + halfH / cell) + 1;
  const sx = (x) => (x - view.cx) * cell + halfW;
  const sy = (y) => (y - view.cy) * cell + halfH;

  const showHeat = view.heat && cell >= 5;
  const showText = cell >= 13;
  const pad = Math.max(1, cell * 0.06);

  // 目标扇区范围（用来把区外格子压暗）
  const nSec = S.sectorSize;
  const tx0 = view.target[0] * nSec, ty0 = view.target[1] * nSec;
  // 格子
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = F.key(x, y);
      const px = sx(x), py = sy(y);
      const cw = cell - pad, ch = cell - pad;
      const inSec = x >= tx0 && x < tx0 + nSec && y >= ty0 && y < ty0 + nSec;
      ctx.globalAlpha = inSec ? 1 : 0.55;
      if (S.opened.has(k)) {
        const isMine = F.isMine(x, y);
        if (isMine) {
          ctx.fillStyle = C.mine;
          ctx.fillRect(px + pad / 2, py + pad / 2, cw, ch);
        } else {
          ctx.fillStyle = C.open;
          ctx.fillRect(px + pad / 2, py + pad / 2, cw, ch);
          if (cell >= 8) {
            ctx.strokeStyle = C.openEdge;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + pad / 2 + 0.5, py + pad / 2 + 0.5, cw - 1, ch - 1);
          }
          const n = F.number(x, y);
          if (n > 0 && showText) {
            ctx.fillStyle = NUM[Math.min(n, NUM.length - 1)];
            ctx.font = `700 ${cell * 0.56}px "Space Mono", ui-monospace, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(n), px + cell / 2, py + cell / 2 + cell * 0.03);
          } else if (n === 0 && cell >= 10) {
            ctx.fillStyle = 'rgba(125,255,178,0.28)';
            ctx.fillRect(px + cell * 0.44, py + cell * 0.44, cell * 0.12, cell * 0.12);
          }
        }
      } else {
        const g = ctx.createLinearGradient(px, py, px, py + ch);
        g.addColorStop(0, C.hiddenTop);
        g.addColorStop(1, C.hidden);
        ctx.fillStyle = g;
        ctx.fillRect(px + pad / 2, py + pad / 2, cw, ch);
        // 密度场：贴着分形枝杈的地方泛青（概率场，不是雷的位置）
        if (showHeat) {
          const d = F.density(x, y);
          if (d > 0.07) {
            // 格子越大（9×9 扇区），同一片密度越刺眼，按尺寸压一档
            const dim = cell >= 34 ? 0.58 : cell >= 26 ? 0.78 : 1;
            const a = Math.min(0.46, Math.pow((d - 0.07) * 1.45, 0.85)) * dim;
            ctx.fillStyle = `rgba(34,211,238,${a.toFixed(3)})`;
            ctx.fillRect(px + pad / 2, py + pad / 2, cw, ch);
          }
        }
        if (cell >= 8) {
          ctx.strokeStyle = 'rgba(34,211,238,0.12)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + pad / 2 + 0.5, py + pad / 2 + 0.5, cw - 1, ch - 1);
        }
        if (S.flags.has(k)) {
          ctx.fillStyle = C.amber;
          ctx.fillRect(px + cell * 0.46, py + cell * 0.2, Math.max(1.2, cell * 0.07), cell * 0.5);
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.52, py + cell * 0.2);
          ctx.lineTo(px + cell * 0.78, py + cell * 0.34);
          ctx.lineTo(px + cell * 0.52, py + cell * 0.46);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  // 扇区框：目标扇区亮框，已清扇区绿框
  const n = S.sectorSize;
  const s0x = Math.floor(x0 / n), s1x = Math.floor(x1 / n);
  const s0y = Math.floor(y0 / n), s1y = Math.floor(y1 / n);
  ctx.globalAlpha = 1;
  for (let syy = s0y; syy <= s1y; syy++) {
    for (let sxx = s0x; sxx <= s1x; sxx++) {
      const isTarget = sxx === view.target[0] && syy === view.target[1];
      const cleared = F.S.cleared.has(F.sectorKey(sxx, syy));
      if (!isTarget && !cleared && cell < 18) continue;
      const bx = sx(sxx * n), by = sy(syy * n);
      ctx.strokeStyle = isTarget ? 'rgba(34,211,238,0.75)' : cleared ? 'rgba(125,255,178,0.45)' : 'rgba(34,211,238,0.18)';
      ctx.lineWidth = isTarget ? 2 : 1;
      if (isTarget) {
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -(now * 14) % 14;
      }
      ctx.strokeRect(bx, by, n * cell, n * cell);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (isTarget && cell >= 7) {
        ctx.fillStyle = 'rgba(34,211,238,0.85)';
        ctx.font = '700 11px "Space Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`扇区 ${sxx} · ${syy}`, bx + 2, by - 5);
      }
    }
  }

  // 光标坐标
  if (view.hover) {
    const { x, y } = view.hover;
    ctx.fillStyle = 'rgba(103,232,249,0.9)';
    ctx.font = '600 11px "Space Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const d = F.density(x, y);
    ctx.fillText(`[ ${x} , ${y} ]  密度 ${(d * 100).toFixed(0)}%  ε=${F.escape(x, y)}`, 12, h - 24);
  }
  last = { x0, x1, y0, y1, cell, sx, sy, w, h };
}

function hit(view, mouse) {
  if (!last) return null;
  const x = Math.floor(view.cx + (mouse.x - last.w / 2) / last.cell);
  const y = Math.floor(view.cy + (mouse.y - last.h / 2) / last.cell);
  return { x, y };
}

F.R = {
  draw, hit, fit,
  init(canvas) { dpr = Math.min(window.devicePixelRatio || 1, 2); },
  resize() { dpr = Math.min(window.devicePixelRatio || 1, 2); }
};

})(window.FM);
