/* ============================================================
   FRACTAL·MINE — main：无限平面的平移缩放、输入、计时、存档
   ============================================================ */
(function (F) {
'use strict';
const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'fm.save.v1';

const save = { seed: 20261111, cleared: 0, cell: 26, heat: true };
const view = { cx: 10.5, cy: 10.5, cell: 26, heat: true, target: [0, 0], hover: null, zoomFlash: 0 };
const mouse = { x: 0, y: 0 };
let booted = false, lastT = 0, bannerT = 0;

const sfx = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (f, dur, type, gain, to) => {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(40, to), c.currentTime + dur);
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(gain || 0.05, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  };
  return {
    open: () => tone(520, 0.06, 'square', 0.02),
    flag: () => tone(880, 0.07, 'triangle', 0.035),
    boom: () => { tone(90, 0.45, 'sawtooth', 0.085, 40); tone(170, 0.3, 'square', 0.045, 60); },
    win: () => { tone(660, 0.12, 'triangle', 0.05); setTimeout(() => tone(880, 0.14, 'triangle', 0.05), 110); setTimeout(() => tone(1180, 0.2, 'triangle', 0.05), 230); },
    zoom: () => tone(300, 0.05, 'sine', 0.015)
  };
})();

function log(msg, kind) {
  const ul = $('log');
  const li = document.createElement('li');
  li.className = 'l-' + (kind || 'info');
  li.innerHTML = `<span class="mk">${kind === 'bad' ? '✕' : kind === 'good' ? '✓' : kind === 'warn' ? '!' : '▸'}</span>${msg}`;
  ul.prepend(li);
  while (ul.children.length > 8) ul.lastChild.remove();
}

function banner(kind, title, sub) {
  const b = $('banner');
  if (!kind) { b.className = 'banner'; b.innerHTML = ''; return; }
  b.className = 'banner show ' + kind;
  b.innerHTML = `<div class="b-title">${title}</div><div class="b-sub">${sub}</div>`;
  bannerT = 4.5;
}

// ---------- 存档 ----------
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) Object.assign(save, JSON.parse(raw));
  } catch (e) {}
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

// ---------- 开新局 ----------
function newRun(seed) {
  F.reset(seed === undefined ? save.seed : seed);
  save.seed = F.S.seed;
  view.target = [0, 0];
  view.cx = 10.5; view.cy = 10.5;
  $('log').innerHTML = '';
  banner(null);
  const st = F.sectorStats(0, 0);
  log(`新雷场 · 种子 ${F.S.seed} · 目标扇区 0,0（${st.mines} 雷 / ${st.total} 格）`, 'info');
  log('雷沿 Julia 集边界聚集 · 首击必定安全', 'info');
  writeSave();
}

// ---------- 操作 ----------
function afterReveal(x, y, opened) {
  if (F.S.over) {
    banner('lose', '触雷', '雷场失控 · 按 R 重新播种');
    log('踩到雷了', 'bad');
    sfx.boom();
    return;
  }
  if (opened > 0) sfx.open();
  const [tx, ty] = view.target;
  if (F.sectorCleared(tx, ty) && !F.S.cleared.has(tx + ',' + ty)) {
    F.S.cleared.set(tx + ',' + ty, true);
    save.cleared = F.S.cleared.size;
    writeSave();
    sfx.win();
    banner('win', '扇区清空', `目标扇区 ${tx},${ty} 已排净 · 累计 ${save.cleared} 区`);
    log(`扇区 ${tx},${ty} 清空 · 累计 ${save.cleared} 区`, 'good');
    view.target = F.nextSector(tx, ty, 8);
  }
}

function click(x, y, flagMode) {
  if (!booted) return;
  if (F.S.over) return;
  if (flagMode) {
    if (F.toggleFlag(x, y)) sfx.flag();
    return;
  }
  const k = F.key(x, y);
  if (F.S.opened.has(k)) { const n = F.chord(x, y); if (n > 0) afterReveal(x, y, n); return; }
  const n = F.reveal(x, y);
  afterReveal(x, y, n);
}

// ---------- 输入 ----------
function bind() {
  const cvs = $('board');
  const pos = (e) => { const r = cvs.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // 缩放：以光标位置为锚
  function zoomAt(factor, mx, my) {
    const rect = cvs.getBoundingClientRect();
    const px = mx === undefined ? rect.width / 2 : mx;
    const py = my === undefined ? rect.height / 2 : my;
    const wx = view.cx + (px - rect.width / 2) / view.cell;
    const wy = view.cy + (py - rect.height / 2) / view.cell;
    view.cell = Math.max(9, Math.min(64, view.cell * factor));
    view.cx = wx - (px - rect.width / 2) / view.cell;
    view.cy = wy - (py - rect.height / 2) / view.cell;
    save.cell = view.cell;
    view.zoomFlash = 0.5;
    writeSave();
  }

  let drag = null;
  cvs.addEventListener('mousemove', (e) => {
    const p = pos(e);
    mouse.x = p.x; mouse.y = p.y;
    if (!drag) view.hover = F.R.hit(view, p);
  });
  cvs.addEventListener('mouseleave', () => { if (!drag) view.hover = null; });
  // 平移挂在 window 上：手指/鼠标拖出画布也不断
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const p = pos(e);
    view.cx -= (p.x - drag.x) / view.cell;
    view.cy -= (p.y - drag.y) / view.cell;
    drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.px, p.y - drag.py));
    drag.x = p.x; drag.y = p.y;
    cvs.style.cursor = 'grabbing';
  });
  cvs.addEventListener('mousedown', (e) => {
    if (!booted) return;
    const p = pos(e);
    mouse.x = p.x; mouse.y = p.y;
    if (e.button === 2) { const h = F.R.hit(view, p); if (h) click(h.x, h.y, true); e.preventDefault(); return; }
    drag = { x: p.x, y: p.y, px: p.x, py: p.y, moved: 0 };
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const r = cvs.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const wasDrag = drag.moved > 5;
    drag = null;
    cvs.style.cursor = 'crosshair';
    if (wasDrag) return;
    const h = F.R.hit(view, p);
    if (h) click(h.x, h.y, e.button === 2);
  });
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
  cvs.addEventListener('wheel', (e) => {
    if (!booted) return;
    e.preventDefault();
    const p = pos(e);
    zoomAt(Math.exp(-e.deltaY * 0.0014), p.x, p.y);
    sfx.zoom();
  }, { passive: false });

  // 触屏：拖动平移，轻点排雷，长按插旗，双指缩放
  let touch = null, tTimer = null, pinch = null;
  cvs.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !booted) return;
    const p = pos(e);
    if (e.isPrimary === false) return;
    touch = { x: p.x, y: p.y, px: p.x, py: p.y, moved: 0 };
    const h = F.R.hit(view, p);
    if (h) tTimer = setTimeout(() => { tTimer = null; click(h.x, h.y, true); if (navigator.vibrate) navigator.vibrate(18); }, 420);
  }, { passive: true });
  cvs.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || !touch) return;
    const p = pos(e);
    touch.moved = Math.max(touch.moved, Math.hypot(p.x - touch.px, p.y - touch.py));
    if (touch.moved > 10 && tTimer) { clearTimeout(tTimer); tTimer = null; }
    view.cx -= (p.x - touch.x) / view.cell;
    view.cy -= (p.y - touch.y) / view.cell;
    touch.x = p.x; touch.y = p.y;
  }, { passive: true });
  cvs.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || !touch) return;
    const p = pos(e);
    if (tTimer) {
      clearTimeout(tTimer); tTimer = null;
      if (touch.moved < 12) { const h = F.R.hit(view, p); if (h) click(h.x, h.y, false); }
    }
    touch = null;
  });
  cvs.addEventListener('pointercancel', () => { if (tTimer) { clearTimeout(tTimer); tTimer = null; } touch = null; });

  $('btn-new').addEventListener('click', () => { newRun((Math.random() * 1e9) | 0); });
  $('btn-next').addEventListener('click', () => {
    const [tx, ty] = view.target;
    view.target = F.nextSector(tx, ty, 10);
    view.cx = view.target[0] * F.S.sectorSize + F.S.sectorSize / 2;
    view.cy = view.target[1] * F.S.sectorSize + F.S.sectorSize / 2;
    log(`切换到扇区 ${view.target[0]},${view.target[1]}`, 'info');
  });
  $('btn-zoom-in').addEventListener('click', () => { zoomAt(1.35); });
  $('btn-zoom-out').addEventListener('click', () => { zoomAt(1 / 1.35); });
  $('btn-reset').addEventListener('click', () => {
    const [tx, ty] = view.target;
    view.cx = tx * F.S.sectorSize + F.S.sectorSize / 2;
    view.cy = ty * F.S.sectorSize + F.S.sectorSize / 2;
    view.cell = 26; save.cell = 26; writeSave();
  });
  $('btn-heat').addEventListener('click', () => {
    view.heat = !view.heat;
    save.heat = view.heat;
    $('btn-heat').classList.toggle('on', view.heat);
    writeSave();
  });
  $('btn-help').addEventListener('click', () => $('help').classList.toggle('hidden'));
  $('help').querySelector('[data-close]').addEventListener('click', () => $('help').classList.add('hidden'));

  window.addEventListener('keydown', (e) => {
    if (!booted) return;
    const k = e.key.toLowerCase();
    if (k === 'r') { newRun((Math.random() * 1e9) | 0); return; }
    if (k === 'n') { $('btn-next').click(); return; }
    if (k === 'h' || k === '?') { $('help').classList.toggle('hidden'); return; }
    if (k === 'escape') { $('help').classList.add('hidden'); return; }
    if (k === '+' || k === '=') { zoomAt(1.25); return; }
    if (k === '-' || k === '_') { zoomAt(1 / 1.25); return; }
    const pan = { arrowleft: [-3, 0], arrowright: [3, 0], arrowup: [0, -3], arrowdown: [0, 3] }[k];
    if (pan) { e.preventDefault(); view.cx += pan[0]; view.cy += pan[1]; }
  });

  window.addEventListener('resize', () => F.R.resize());
}

// ---------- HUD ----------
function hud() {
  const [tx, ty] = view.target;
  const st = F.sectorStats(tx, ty);
  const flagsIn = (() => {
    let c = 0;
    const n = F.S.sectorSize;
    for (const k of F.S.flags) {
      const [x, y] = k.split(',').map(Number);
      if (Math.floor(x / n) === tx && Math.floor(y / n) === ty) c++;
    }
    return c;
  })();
  $('sec').textContent = `${tx} , ${ty}`;
  $('mines').textContent = String(Math.max(0, st.mines - flagsIn)).padStart(3, '0');
  const safeTotal = st.total - st.mines;
  $('prog').textContent = Math.round((st.opened / Math.max(1, safeTotal)) * 100) + '%';
  const t = Math.floor(F.S.time);
  $('clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  $('zoom').textContent = `${view.cell.toFixed(0)}px · ×${(view.cell / 26).toFixed(2)}`;
  $('cleared').textContent = String(save.cleared || 0);
}

// ---------- 主循环 ----------
function tick(ts) {
  requestAnimationFrame(tick);
  const now = ts / 1000;
  const dt = Math.min(0.06, lastT ? now - lastT : 0.016);
  lastT = now;
  if (!booted) return;
  if (F.S.started && !F.S.over) F.S.time += dt;
  if (view.zoomFlash > 0) view.zoomFlash = Math.max(0, view.zoomFlash - dt);
  F.R.draw($('board'), view, now);
  hud();
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner(null); }
}

// ---------- 启动 ----------
function boot() {
  loadSave();
  F.R.init($('board'));
  newRun(save.seed);
  view.cell = save.cell || 26;
  view.heat = save.heat !== false;
  $('btn-heat').classList.toggle('on', view.heat);
  bind();
  $('btn-heat').classList.toggle('on', view.heat);
  booted = true;
  requestAnimationFrame(tick);
  window.__fm = {
    S: F.S, view, newRun, click, zoomAt: (f) => { view.cell *= f; }, save,
    sectorStats: F.sectorStats, isMine: F.isMine, density: F.density, escape: F.escape,
    reveal: (x, y) => { const n = F.reveal(x, y); afterReveal(x, y, n); return n; },
    flag: F.toggleFlag
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window.FM);
