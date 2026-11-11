/* ============================================================
   MINE·4D — main：状态 / 输入 / 计时 / 主循环 / 存档
   ============================================================ */
(function (M) {
'use strict';
const UI = M.UI, R = M.R;
const SAVE_KEY = 'mine4d.save.v1';

let save = { diff: 'std', best: {}, lastW: 0, mode: 'face' };
let board = null;
const view = { w: 0, z: 0, hover: -1, sel: -1, sweepT: 0 };
const mouse = { x: 0, y: 0, inside: false };
let geom = null, booted = false, lastT = 0;

// ---------- 音效（WebAudio，零资源） ----------
const sfx = (function () {
  let ctx = null;
  const ac = () => {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (f, dur, type, gain, slide) => {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = f;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), c.currentTime + dur);
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(gain || 0.05, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  };
  return {
    open: () => tone(520, 0.06, 'square', 0.022),
    flag: () => tone(880, 0.07, 'triangle', 0.04),
    unflag: () => tone(430, 0.06, 'triangle', 0.03),
    boom: () => { tone(90, 0.5, 'sawtooth', 0.09, 40); tone(180, 0.32, 'square', 0.05, 60); },
    win: () => { tone(660, 0.12, 'triangle', 0.05); setTimeout(() => tone(880, 0.14, 'triangle', 0.05), 110); setTimeout(() => tone(1180, 0.22, 'triangle', 0.05), 230); },
    slice: () => tone(300, 0.05, 'sine', 0.018),
    deny: () => tone(160, 0.12, 'square', 0.03)
  };
})();

// ---------- 存档 ----------
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = Object.assign(save, JSON.parse(raw));
  } catch (e) { /* 忽略损坏的存档 */ }
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

// ---------- 开局 ----------
function newGame(diffId, seed) {
  const cfg = M.diffById(diffId || save.diff);
  save.diff = cfg.id;
  M.UI.clearLog();
  M.setMode(save.mode || 'face');
  board = M.makeBoard(cfg, seed || ((Math.random() * 1e9) | 0));
  view.w = Math.min(save.lastW || 0, board.NW - 1);
  view.z = Math.floor(board.NZ / 2);
  view.hover = -1; view.sel = -1; view.sweepT = 0.55;
  UI.buildDiffBar(cfg.id, pickDiff);
  UI.buildModeBar(board.mode, pickMode);
  UI.buildZTabs(board, view.z, setZ);
  const w = UI.el['w-slider'];
  w.max = String(board.NW - 1);
  w.value = String(view.w);
  UI.banner(null);
  UI.log(`雷场重建 · ${cfg.name} ${cfg.dims.join('×')} · ${board.mines} 枚雷 · ${M.MODES[board.mode].name}`, 'info');
  UI.log('首击必定安全（点击格与 80 邻均已排空）', 'info');
  UI.setHintLine('左键 排雷 · 右键 插旗 · 已开数字上左键可快开 · <b>W/S</b> 切相位 · <b>A/D</b> 切层 · <b>T</b> 自动推理 · <b>G</b> 提示');
  writeSave();
}

function pickMode(m) {
  if (m === save.mode) return;
  save.mode = m;
  M.setMode(m);
  writeSave();
  newGame(save.diff);
  UI.log('邻域切换 · ' + M.MODES[m].name + '（' + M.MODES[m].desc + '）', 'warn');
}

function pickDiff(id) {
  if (board && board.started && !board.over) {
    UI.log('放弃当前雷场，重建 ' + M.diffById(id).name, 'warn');
  }
  newGame(id);
}

// ---------- 操作 ----------
function afterMove() {
  if (!board.over) return;
  if (board.win) {
    const t = Math.floor(board.time);
    const prev = save.best[board.diff];
    let extra = '';
    if (!prev || t < prev) { save.best[board.diff] = t; extra = ' · 新纪录'; writeSave(); }
    UI.banner('win', '雷场清空', `用时 ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} · ${board.mines} 枚雷 · ${M.MODES[board.mode].name}${extra}`, true);
    UI.log(`扫描完成 · ${board.diff} 用时 ${t}s${extra}`, 'good');
    sfx.win();
  } else {
    UI.banner('lose', '触发雷管', '操作员已回收 · 按 R 重新布雷', true);
    UI.log('触发雷管 · 雷场失控', 'bad');
    sfx.boom();
  }
}

function reveal(i) {
  if (!board || board.over || i < 0) return;
  const before = board.started;
  const opened = M.reveal(board, i, performance.now() / 1000);
  if (!before && board.started) UI.log(`首击安全区已排空 · 布雷 ${board.mines} 枚`, 'info');
  if (opened > 0) sfx.open();
  view.sel = i;
  if (!board.started) view.sweepT = 0.55;
  afterMove();
}

function flag(i) {
  if (!board || board.over || i < 0) return;
  if (board.state[i] === M.OPEN) return;
  const wasFlag = board.state[i] === M.FLAG;
  if (M.toggleFlag(board, i)) {
    (wasFlag ? sfx.unflag : sfx.flag)();
    board.tFlag[i] = performance.now() / 1000;
    view.sel = i;
  }
}

function chord(i) {
  if (!board || board.over || i < 0) return;
  if (board.state[i] !== M.OPEN || board.num[i] <= 0) { reveal(i); return; }
  const n = M.chord(board, i, performance.now() / 1000);
  if (n > 0) { sfx.open(); afterMove(); }
  else sfx.deny();
}

// ---------- 相位 / 层 ----------
function setPhase(w, quiet) {
  if (!board) return;
  const nw = Math.max(0, Math.min(board.NW - 1, w));
  if (nw === view.w) return;
  view.w = nw;
  view.hover = -1;
  view.sweepT = 0.55;
  save.lastW = nw;
  if (!quiet) sfx.slice();
  UI.buildZTabs(board, view.z, setZ);
}
function setZ(z) {
  if (!board) return;
  const nz = Math.max(0, Math.min(board.NZ - 1, z));
  if (nz === view.z) return;
  view.z = nz;
  view.hover = -1;
  view.sweepT = 0.55;
  sfx.slice();
  UI.buildZTabs(board, view.z, setZ);
}

// ---------- 推理 ----------
function doAuto() {
  if (!board || board.over) return;
  if (!board.started) { UI.log('先点开一格，推理器才有输入', 'warn'); sfx.deny(); return; }
  const r = M.autoSolve(board, performance.now() / 1000, 400);
  if (!r.opened && !r.flagged) {
    UI.log('推理器没有找到确定解 · 需要手动冒险或换视角', 'warn');
    sfx.deny();
  } else {
    UI.log(`推理器推进 ${r.rounds} 轮 · 开 ${r.opened} 格 · 标 ${r.flagged} 雷`, 'good');
    sfx.open();
  }
  afterMove();
}

function doHint() {
  if (!board || board.over) return;
  if (!board.started) { UI.log('先点开一格再要提示', 'warn'); return; }
  const h = M.hint(board);
  if (!h) {
    const g = M.estimate(board);
    if (!g) { UI.log('没有可推断的格子了', 'warn'); sfx.deny(); return; }
    const [gx, gy, gz, gw] = board.xyzw(g.idx);
    setPhase(gw, true); setZ(gz);
    view.sel = g.idx; view.hover = g.idx;
    UI.log(`无确定解 · 风险最低的猜测是 [${gx},${gy},${gz},${gw}]，估计踩雷率 ≤ ${Math.round(g.p * 100)}%`, 'warn');
    sfx.slice();
    return;
  }
  const [x, y, z, w] = board.xyzw(h.idx);
  setPhase(w, true);
  setZ(z);
  view.sel = h.idx;
  view.hover = h.idx;
  UI.log(`提示：[${x},${y},${z},${w}] 可确定为${h.kind === 'safe' ? '安全格' : '雷'}（同类共 ${h.count} 处）`, 'good');
  sfx.slice();
}

// ---------- 输入 ----------
function bind() {
  const cvs = UI.el.board;
  const pos = (e) => {
    const r = cvs.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  cvs.addEventListener('mousemove', (e) => {
    const p = pos(e);
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
    view.hover = R.boardHit(geom, board, view, mouse);
  });
  cvs.addEventListener('mouseleave', () => { mouse.inside = false; view.hover = -1; });
  cvs.addEventListener('mousedown', (e) => {
    if (!booted) return;
    const p = pos(e);
    mouse.x = p.x; mouse.y = p.y;
    const i = R.boardHit(geom, board, view, mouse);
    if (i < 0) return;
    e.preventDefault();
    if (e.button === 2) flag(i);
    else if (e.button === 0) {
      if (board.state[i] === M.OPEN) chord(i);
      else reveal(i);
    }
  });
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());

  // 触屏：轻点排雷，长按插旗
  let touchTimer = null, touchIdx = -1, touchStart = null;
  cvs.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !booted) return;
    const p = pos(e);
    mouse.x = p.x; mouse.y = p.y;
    touchIdx = R.boardHit(geom, board, view, mouse);
    if (touchIdx < 0) return;
    view.hover = touchIdx;
    touchStart = { x: p.x, y: p.y };
    touchTimer = setTimeout(() => {
      touchTimer = null;
      flag(touchIdx);
      if (navigator.vibrate) navigator.vibrate(18);
    }, 420);
  }, { passive: true });
  cvs.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    if (!touchStart) return;
    const p = pos(e);
    const moved = Math.hypot(p.x - touchStart.x, p.y - touchStart.y);
    if (touchTimer) {
      clearTimeout(touchTimer); touchTimer = null;
      if (moved < 12 && touchIdx >= 0) {
        if (board.state[touchIdx] === M.OPEN) chord(touchIdx);
        else reveal(touchIdx);
      }
    }
    touchStart = null;
    view.hover = -1;
  });
  cvs.addEventListener('pointercancel', () => { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } touchStart = null; });

  UI.el['w-slider'].addEventListener('input', (e) => setPhase(+e.target.value));
  UI.el['btn-new'].addEventListener('click', () => newGame());
  UI.el['btn-auto'].addEventListener('click', doAuto);
  UI.el['btn-hint'].addEventListener('click', doHint);
  UI.el['btn-help'].addEventListener('click', () => UI.help(UI.el.help.classList.contains('hidden')));

  window.addEventListener('keydown', (e) => {
    if (!booted) return;
    const k = e.key.toLowerCase();
    if (k === 'r') { newGame(); return; }
    if (k === 't') { doAuto(); return; }
    if (k === 'g') { doHint(); return; }
    if (k === 'h' || k === '?') { UI.help(UI.el.help.classList.contains('hidden')); return; }
    if (k === 'escape') { UI.help(false); return; }
    if (k === 'w') { e.preventDefault(); setPhase(view.w + 1); return; }
    if (k === 's') { e.preventDefault(); setPhase(view.w - 1); return; }
    if (k === 'a') { e.preventDefault(); setZ(view.z - 1); return; }
    if (k === 'd') { e.preventDefault(); setZ(view.z + 1); return; }
    if (k === 'f') { if (view.sel >= 0) flag(view.sel); return; }
    if (k === 'c') { if (view.sel >= 0) chord(view.sel); return; }
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (view.sel >= 0) { if (board.state[view.sel] === M.OPEN) chord(view.sel); else reveal(view.sel); }
      return;
    }
    const move = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (move) {
      e.preventDefault();
      if (view.sel < 0) { view.sel = board.at(0, 0, view.z, view.w); return; }
      const [x, y] = board.xyzw(view.sel);
      const nx = Math.max(0, Math.min(board.NX - 1, x + move[0]));
      const ny = Math.max(0, Math.min(board.NY - 1, y + move[1]));
      view.sel = board.at(nx, ny, view.z, view.w);
    }
  });

  window.addEventListener('resize', () => { R.resize(); });
}
// 让鼠标点击后键盘仍然可用（避免焦点落在按钮上被空格触发）
window.addEventListener('mouseup', () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

// ---------- 主循环 ----------
function tick(ts) {
  requestAnimationFrame(tick);
  const now = ts / 1000;
  const dt = Math.min(0.06, lastT ? now - lastT : 0.016);
  lastT = now;
  if (!board) return;

  if (!board.over && board.started) board.time += dt;
  if (view.sweepT > 0) view.sweepT = Math.max(0, view.sweepT - dt);

  geom = R.drawBoard(board, view, now);
  R.geom = geom;
  const w = view.w;
  R.drawThumb(UI.el.thumb0, board, view.z, w - 1, now, false);
  R.drawThumb(UI.el.thumb1, board, view.z, w, now, true);
  R.drawThumb(UI.el.thumb2, board, view.z, w + 1, now, false);
  R.drawScanner(board, view.sel >= 0 ? view.sel : view.hover, now);
  UI.setStats(board, view);
  UI.tickBanner(dt);

  const hoverIdx = view.hover >= 0 ? view.hover : view.sel;
  if (hoverIdx >= 0 && board.state[hoverIdx] === M.HIDDEN) {
    const [x, y, z, pw] = board.xyzw(hoverIdx);
    const nb = board.neighbors(hoverIdx, []);
    let f = 0, u = 0;
    for (const q of nb) { if (board.state[q] === M.FLAG) f++; else if (board.state[q] === M.HIDDEN) u++; }
    UI.el.hintline.innerHTML = `格 [${x},${y},${z},${pw}] · 80 邻中 未知 ${u} / 已标 ${f}`;
  }
}

// ---------- 启动 ----------
function boot() {
  loadSave();
  UI.init();
  R.init(UI.el.board, [UI.el.thumb0, UI.el.thumb1, UI.el.thumb2], UI.el.scanner);
  M.UI.el.help.querySelector('[data-close]').addEventListener('click', () => UI.help(false));
  newGame(save.diff);
  bind();
  UI.boot(() => {
    booted = true;
    UI.log('终端就绪 · 等待指令', 'good');
    view.sweepT = 0.55;
  });
  requestAnimationFrame(tick);
  // 供自动化测试使用
  window.__m4 = {
    get board() { return board; }, view, newGame, reveal, flag, chord, doAuto, doHint,
    setPhase, setZ, pickDiff, get booted() { return booted; }, get geom() { return geom; },
    save
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window.M4);
