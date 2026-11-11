/* ============================================================
   MINE·4D — ui：HUD / 日志 / 开机自检 / 手册
   ============================================================ */
(function (M) {
'use strict';
const $ = (id) => document.getElementById(id);
const el = {};
const MAX_LOG = 26;

function init() {
  ['diff-bar', 'mines-left', 'clock', 'opened', 'coords', 'btn-new', 'btn-auto', 'btn-hint',
   'btn-help', 'board', 'banner', 'thumb0', 'thumb1', 'thumb2', 'cap-w0', 'cap-w1', 'cap-w2',
   'scanner', 'log', 'w-slider', 'w-val', 'z-tabs', 'hintline', 'boot', 'boot-text', 'help',
   'view-bar', 'btn-cam'].forEach((id) => el[id] = $(id));
}

function buildDiffBar(current, onPick) {
  el['diff-bar'].innerHTML = M.DIFFS.map((d) => {
    const [a, b, c, e] = d.dims;
    return `<button class="diff ${d.id === current ? 'on' : ''}" data-diff="${d.id}">
      <b>${d.name}</b><i>${d.en}</i><span>${a}×${b}×${c}×${e} · ${M.minesFor(d)}雷</span></button>`;
  }).join('');
  el['diff-bar'].querySelectorAll('[data-diff]').forEach((btn) => {
    btn.addEventListener('click', () => onPick(btn.dataset.diff));
  });
}

function buildModeBar(current, onPick) {
  const bar = $('mode-bar');
  if (!bar) return;
  bar.innerHTML = Object.values(M.MODES).map((m) =>
    `<button class="mode ${m.id === current ? 'on' : ''}" data-mode="${m.id}" title="${m.desc}">${m.name}</button>`
  ).join('');
  bar.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.mode)));
}

const VIEW_LIST = [
  { id: '2d', name: '平面', en: 'PLANE', hint: '(x,y) 切片' },
  { id: '3d', name: '立体', en: 'VOLUME', hint: 'x·y·z 立方' },
  { id: '4d', name: '四维', en: 'HYPER', hint: 'W 相位展开' }
];

function buildViewBar(current, onPick) {
  if (!el['view-bar']) return;
  el['view-bar'].innerHTML = VIEW_LIST.map((v) =>
    `<button class="view ${v.id === current ? 'on' : ''}" data-view="${v.id}" title="${v.name} · ${v.hint}">
      <b>${v.name}</b><i>${v.en}</i></button>`
  ).join('');
  el['view-bar'].querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.view)));
}

function buildZTabs(board, current, onPick) {
  let html = '';
  for (let z = 0; z < board.NZ; z++) {
    html += `<button class="ztab ${z === current ? 'on' : ''}" data-z="${z}">Z${z}</button>`;
  }
  el['z-tabs'].innerHTML = html;
  el['z-tabs'].querySelectorAll('[data-ztab], [data-z]').forEach((btn) => {
    btn.addEventListener('click', () => onPick(+btn.dataset.z));
  });
}

function setStats(b, view) {
  const nbNote = document.getElementById('nb-note');
  if (nbNote) {
    nbNote.textContent = b.mode === 'full'
      ? '当前 全域 80：9 个小块全部属于邻域（3 相位 × 3 层，每块 3×3）。'
      : '当前 面邻 8：只有高亮的格子属于邻域，暗格不算。';
  }
  el['mines-left'].textContent = String(Math.max(0, b.mines - b.flags)).padStart(3, '0');
  const t = Math.floor(b.time);
  el['clock'].textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const total = b.n - b.mines;
  el['opened'].textContent = Math.round(b.opened / total * 100) + '%';
  if (view.sel >= 0) {
    const [x, y, z, w] = b.xyzw(view.sel);
    el['coords'].textContent = `[${x},${y},${z},${w}]`;
  } else el['coords'].textContent = `[-,${view.z},-,${view.w}]`;
  el['w-slider'].value = String(view.w);
  el['w-val'].textContent = 'W' + view.w;
  el['cap-w0'].textContent = 'W' + (view.w - 1);
  el['cap-w1'].textContent = 'W' + view.w;
  el['cap-w2'].textContent = 'W' + (view.w + 1);
}

function log(msg, kind) {
  const li = document.createElement('li');
  li.className = 'l-' + (kind || 'info');
  const d = new Date();
  const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  li.innerHTML = `<span class="ts">${ts}</span><span class="mk">${kind === 'bad' ? '✕' : kind === 'good' ? '✓' : kind === 'warn' ? '!' : '▸'}</span>${msg}`;
  el['log'].prepend(li);
  while (el['log'].children.length > MAX_LOG) el['log'].lastChild.remove();
}

function clearLog() { el['log'].innerHTML = ''; }

function setHintLine(t) { el['hintline'].innerHTML = t; }

let bannerTimer = 0;
function banner(kind, title, sub, persist) {
  if (kind) {
    el['banner'].className = 'banner show ' + kind;
    el['banner'].innerHTML = `<div class="b-title">${title}</div><div class="b-sub">${sub}</div>`;
    bannerTimer = persist ? -1 : 3.2;
  } else {
    el['banner'].className = 'banner';
    el['banner'].innerHTML = '';
    bannerTimer = 0;
  }
}
function tickBanner(dt) {
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) banner(null);
  }
}

function help(on) {
  el['help'].classList.toggle('hidden', !on);
}

const BOOT_LINES = [
  'MINE·4D TERMINAL  v1.0.0  (c) EXO DYNAMICS',
  '',
  '> 初始化四维晶格 ............... OK',
  '> 挂载相位置信度矩阵 ........... OK',
  '> 校准 80 邻域探针 ............. OK',
  '> 排雷协议 P-XYZW 已加载',
  '> 警告：雷区跨越四个正交维度',
  '',
  '就绪。祝你好运，操作员。'
];

function boot(done) {
  const pre = el['boot-text'];
  let li = 0, ci = 0, text = '';
  let skip = false;
  const finish = () => {
    if (skip) return;
    skip = true;
    el['boot'].classList.add('gone');
    setTimeout(() => el['boot'].classList.add('hidden'), 700);
    document.removeEventListener('keydown', keySkip);
    el['boot'].removeEventListener('click', finish);
    done && done();
  };
  const keySkip = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finish(); };
  document.addEventListener('keydown', keySkip);
  el['boot'].addEventListener('click', finish);
  (function step() {
    if (skip) return;
    if (li >= BOOT_LINES.length) { setTimeout(finish, 320); return; }
    const line = BOOT_LINES[li];
    if (ci <= line.length) {
      pre.innerHTML = (text + line.slice(0, ci)).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '<span class="caret">▌</span>';
      ci += Math.max(1, Math.round(line.length / 16));
      setTimeout(step, 9);
    } else {
      text += line + '\n';
      pre.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '<span class="caret">▌</span>';
      li++; ci = 0;
      setTimeout(step, line ? 62 : 24);
    }
  })();
}

M.UI = { init, el, buildDiffBar, buildModeBar, buildViewBar, buildZTabs, setStats, log, clearLog, setHintLine, banner, tickBanner, help, boot };

})(window.M4);
