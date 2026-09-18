// ============================================================================
// main.js — 遊戲進入點：主迴圈、HUD、工具列、面板註冊、畫布互動
// ============================================================================
import { store } from './core/store.js';
import * as W from './ui/widgets.js';
import { windows } from './ui/windows.js';
import { FloorRenderer, LOGICAL_W, LOGICAL_H } from './render/floor.js';
import * as settleUI from './ui/settle.js';
import { createMenuPanel } from './ui/panels/menu.js';
import { createStaffPanel } from './ui/panels/staff.js';
import { createBuildPanel } from './ui/panels/build.js';
import { createReportPanel } from './ui/panels/report.js';
import { createSettingsPanel } from './ui/panels/settings.js';
import { createSystemPanel } from './ui/panels/system.js';
import { stepSimulation, restaurantSummary, availability } from './sim/simulation.js';
import { seatCount, decorScore, findItem, canPlace, itemAt } from './sim/build.js';
import { unitCost } from './sim/economy.js';
import { setMusic, resumeMusic, sfx, initAudio } from './core/audio.js';
import { hasAnySave, loadGame } from './core/save.js';
import { loadAtlas, setAtlasLoadedHook } from './render/materials.js';
import { clearSpriteCache } from './render/sprites.js';
import { loadActors } from './render/actors.js';
import { getLocation, LOCATIONS } from './data/locations.js';
import { getDish } from './data/dishes.js';
import { furnitureById, FURNITURE } from './data/furniture.js';
import { staffById } from './data/staff.js';
import * as B from './core/balance.js';

const WEEKDAY = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

function hhmm(minute) {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function money(n) { return W.money(n); }

/* ------------------------------------------------------------------ UI 物件 */

const ui = {
  toast: (msg, kind = 'info') => { W.toast(msg, kind); sfx(kind === 'bad' ? 'error' : kind === 'good' ? 'coin' : 'click'); },
  confirm: W.confirmDialog,
  promptNumber: W.promptNumber,
  modal: W.modalDialog,
  sfx: (name) => sfx(name),
  openWindow: (id) => windows.openWindow(id),
  closeWindow: (id) => windows.closeWindow(id),
  hhmm,
  money
};

/* --------------------------------------------------------------- 畫布設定 */

const canvas = document.getElementById('view');
const stage = document.getElementById('stage');
// 邏輯解析度以 render/iso.js 的常數為單一來源（改解析度只要改那裡）
canvas.width = LOGICAL_W;
canvas.height = LOGICAL_H;
canvas.style.imageRendering = 'pixelated';   // 實際值由 fitCanvas() 依倍率決定
let renderer = null;
try {
  renderer = new FloorRenderer(canvas);
} catch (err) {
  console.error('[main] FloorRenderer 建立失敗', err);
}

// 和柄見本帳（assets/wagara-atlas.png）：床材／壁紙に使う。読み込み完了で一度
// スプライトキャッシュを捨てて、柄入りのタイルを描き直させる。
setAtlasLoadedHook(() => { try { clearSpriteCache(); } catch { /* ignore */ } });
loadAtlas();
// スプライトシート式の常連客（Cherish）も起動時に読み込む
loadActors();

/**
 * 縮放策略：以「裝置像素」為單位取整數倍，再換算回 CSS 尺寸。
 * 這樣 1 個邏輯像素永遠等於整數個裝置像素 → 不會有半像素造成的模糊。
 *
 * 但邏輯畫布（1600×1000）可能比視窗還大（例如視窗只有 1280 寬），
 * 此時「最大 1 倍」會讓畫布被 #stage 裁掉，所以自動模式在放不下時
 * 允許小於 1 的倍率（此時 `image-rendering: pixelated` 會暫停，
 * 讓瀏覽器用平滑縮放，至少整張店都看得到）。玩家可以用 + / - 手動指定倍率，0 回到自動。
 */
const VIEW = { deviceScale: 1, cssScale: 1, auto: true, userScale: 0 };
try {
  const saved = Number(localStorage.getItem('dreamrestaurant.zoom') || 0);
  if (saved >= 1 && saved <= 8) { VIEW.auto = false; VIEW.userScale = saved; }
} catch { /* 無 localStorage 就忽略 */ }

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  const availW = Math.max(320, rect.width) * dpr;
  const availH = Math.max(240, rect.height) * dpr;
  // 放得下的最大倍率（可 < 1）
  const fit = Math.min(availW / LOGICAL_W, availH / LOGICAL_H);
  let scale;
  if (!VIEW.auto && VIEW.userScale > 0) {
    scale = VIEW.userScale;
  } else {
    // 優先取整數倍（點對點最銳利）；小於 1 時退而求其次用縮放倍率，避免被裁掉
    scale = fit >= 1 ? Math.floor(fit) : Math.max(0.25, fit);
  }
  VIEW.deviceScale = scale;
  VIEW.cssScale = scale / dpr;
  canvas.style.width = `${Math.round(LOGICAL_W * VIEW.cssScale)}px`;
  canvas.style.height = `${Math.round(LOGICAL_H * VIEW.cssScale)}px`;
  // 縮小到 1 以下時用平滑縮放（pixelated 會讓畫面破損），放大時維持硬邊
  const smoothing = VIEW.deviceScale >= 1 ? 'pixelated' : 'auto';
  canvas.style.imageRendering = smoothing;
  canvas.style.msImageRendering = smoothing;
  if (canvas.width !== LOGICAL_W) canvas.width = LOGICAL_W;
  if (canvas.height !== LOGICAL_H) canvas.height = LOGICAL_H;
}

function setZoom(scale) {
  if (scale === 0) {
    VIEW.auto = true;
    VIEW.userScale = 0;
    try { localStorage.removeItem('dreamrestaurant.zoom'); } catch { /* 忽略 */ }
    fitCanvas();
    ui.toast('縮放：自動（依視窗大小取整數倍）', 'info');
    return;
  }
  const next = Math.max(1, Math.min(8, scale));
  VIEW.auto = false;
  VIEW.userScale = next;
  try { localStorage.setItem('dreamrestaurant.zoom', String(next)); } catch { /* 忽略 */ }
  fitCanvas();
  ui.toast(`縮放：${next}x`, 'info');
}

window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', fitCanvas);
if (window.matchMedia) {
  try {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', fitCanvas);
  } catch { /* 舊瀏覽器忽略 */ }
}

const view = {
  frame: 0,
  fx: null,                 // 由 state.settings.fx 每格更新
  hover: null,
  ghost: null,
  selectionUid: null,
  showGrid: false,
  debugPaths: false,
  hoverCustomerUid: null
};

/* ------------------------------------------------------------------- HUD */

const topbar = document.getElementById('topbar');
const toolbar = document.getElementById('toolbar');
const hintbar = document.getElementById('hintbar');
const hudEls = {};

function buildHud() {
  W.clear(topbar);
  const brand = W.h('div', { class: 'brand' }, '夢幻西餐廳 ', W.h('small', {}, '復刻版'));
  topbar.appendChild(brand);

  const group = (label, key, cls = '') => {
    const value = W.h('span', { class: `hud-value ${cls}` }, '—');
    hudEls[key] = value;
    return W.h('div', { class: 'hud-group' }, W.h('span', { class: 'hud-label' }, label), value);
  };

  topbar.appendChild(group('日期', 'date'));
  topbar.appendChild(group('時間', 'clock'));
  topbar.appendChild(group('天氣', 'weather'));
  topbar.appendChild(group('現金', 'cash', 'cash'));
  topbar.appendChild(group('星級', 'stars'));
  topbar.appendChild(group('社區評價', 'repC'));
  topbar.appendChild(group('區外評價', 'repO'));
  topbar.appendChild(group('來客', 'guests'));
  topbar.appendChild(group('階段', 'phase'));

  const speedBox = W.h('div', { class: 'hud-group' });
  speedBox.appendChild(W.h('span', { class: 'hud-label' }, '速度'));
  for (const sp of [0, 1, 2, 4]) {
    const b = W.button(sp === 0 ? '❚❚' : sp + 'x', () => {
      store.dispatch({ type: 'SET_SPEED', value: sp });
      sfx('click');
    }, { small: true });
    b.dataset.speed = String(sp);
    speedBox.appendChild(b);
  }
  hudEls.speedButtons = [...speedBox.querySelectorAll('.btn')];
  topbar.appendChild(speedBox);
}

const TOOLBAR_BUTTONS = [
  { id: 'menu', label: '菜單', icon: '🍜' },
  { id: 'staff', label: '員工', icon: '👥' },
  { id: 'build', label: '裝潢', icon: '🔨' },
  { id: 'report', label: '報表', icon: '📊' },
  { id: 'settings', label: '環境', icon: '❄' },
  { id: 'system', label: '系統', icon: '💾' }
];

function buildToolbar() {
  W.clear(toolbar);
  for (const b of TOOLBAR_BUTTONS) {
    toolbar.appendChild(W.button(`${b.icon} ${b.label}`, () => {
      windows.toggle(b.id);
      sfx('open');
    }));
  }
  toolbar.appendChild(W.sep());

  const actionBtn = W.button('▶ 開始營業', () => {
    const res = store.dispatch({ type: 'START_DAY' });
    if (!res.ok) ui.toast(res.error, 'bad');
    else sfx('bell');
  });
  actionBtn.dataset.action = 'open';
  toolbar.appendChild(actionBtn);

  const closeBtn = W.button('■ 打烊', () => {
    const res = store.dispatch({ type: 'END_DAY' });
    if (!res.ok) ui.toast(res.error, 'bad');
    else sfx('close');
  });
  closeBtn.dataset.action = 'close';
  toolbar.appendChild(closeBtn);

  const nextBtn = W.button('☀ 開始新的一天', () => {
    const res = store.dispatch({ type: 'NEXT_DAY' });
    if (!res.ok) ui.toast(res.error, 'bad');
    else sfx('open');
  });
  nextBtn.dataset.action = 'next';
  toolbar.appendChild(nextBtn);

  toolbar.appendChild(W.sep());
  toolbar.appendChild(W.button('✋ 向路人招手', () => {
    const res = store.dispatch({ type: 'LURE' });
    ui.toast(res.ok ? res.info : res.error, res.ok ? 'good' : 'bad');
  }, { title: '也可以直接點畫面下方走動的路人' }));
  const gridBtn = W.button('▦ 格線', () => {
    view.showGrid = !view.showGrid;
    gridBtn.classList.toggle('is-on', view.showGrid);
  }, { small: true });
  toolbar.appendChild(gridBtn);
  const fxOn = () => !!(store.getState().settings?.fx?.ao);
  const shadowBtn = W.button('🌓 光影', () => {
    const st = store.getState();
    const on = !(st.settings?.fx?.ao);
    // 一鍵切換「陰影類」：AO／接觸陰影／暗角／店外陰影
    for (const key of ['ao', 'shadows', 'vignette', 'outsideShade']) {
      store.dispatch({ type: 'SET_FX', key, on });
    }
    shadowBtn.classList.toggle('is-on', on);
    ui.toast(on ? '已開啟陰影效果' : '已關閉陰影效果（光影可在「環境」面板細項調整）', 'info');
  }, { small: true, title: '一鍵切換陰影類特效（AO／接觸陰影／暗角／店外陰影）' });
  shadowBtn.classList.toggle('is-on', fxOn());
  toolbar.appendChild(shadowBtn);
  toolbar.appendChild(W.button('🔊 音效', () => {
    const on = !document.body.dataset.muted;
    document.body.dataset.muted = on ? '1' : '';
    import('./core/audio.js').then((m) => m.setEnabled(!on));
    if (!on) sfx('click');
  }, { small: true }));
}

/* ----------------------------------------------------------------- 提示列 */

let hintIndex = 0;

function computeHints(state) {
  const hints = [];
  const loc = getLocation(state.locationId);
  const waiters = state.staff.filter((s) => s.role === 'waiter');
  const chefs = state.staff.filter((s) => s.role === 'chef');
  if (!waiters.length) hints.push(['bad', '沒有服務生！客人不會自己端菜，先去「員工」雇用。']);
  if (!chefs.length) hints.push(['bad', '沒有廚師！沒有人能出餐，先去「員工」雇用。']);
  if (waiters.length && !waiters.some((s) => s.duties?.serve)) hints.push(['bad', '沒有服務生被指派「送餐」職務，菜會卡在出餐口。']);
  if (waiters.length && !waiters.some((s) => s.duties?.cleanRestroom)) hints.push(['warn', '沒人負責清掃廁所，廁所只會越來越髒。']);
  if (state.sim.dirt.restroom > B.DIRT_COMPLAIN) hints.push(['bad', `廁所髒污 ${Math.round(state.sim.dirt.restroom)}%，客人在皺眉頭了。`]);
  if (state.sim.dirt.floor > B.DIRT_BAD) hints.push(['bad', `店內地板很髒（${Math.round(state.sim.dirt.floor)}%），快派人清掃。`]);
  const dev = Math.abs(state.settings.acTemp - 24);
  if (dev > 3) hints.push(['warn', `空調設在 ${state.settings.acTemp}°C，${state.settings.acTemp > 24 ? '太熱' : '太冷'}了，客人會煩躁。`]);
  if (state.sim.equipBroken.ac) hints.push(['bad', '空調故障中！客人脾氣會變差，快去「裝潢→清潔與維修」修理。']);
  if (state.sim.equipBroken.stove) hints.push(['bad', '爐具故障！出餐速度只剩一半。']);
  if (state.sim.equipBroken.fridge) hints.push(['warn', '冰箱故障！食材會加速敗壞。']);
  const outOfStock = state.menu.filter((m) => m.active && (state.stock[m.dishId] || 0) <= 0);
  if (outOfStock.length) hints.push(['bad', `賣完了：${outOfStock.slice(0, 3).map((m) => getDish(m.dishId)?.name).join('、')}${outOfStock.length > 3 ? ' 等' : ''}（客人點不到餐會扣評價）`]);
  const lowStock = state.menu.filter((m) => m.active && (state.stock[m.dishId] || 0) > 0 && (state.stock[m.dishId] || 0) < 12);
  if (lowStock.length) hints.push(['warn', `庫存偏低：${lowStock.slice(0, 3).map((m) => getDish(m.dishId)?.name).join('、')}`]);
  if (state.suppliers.length) hints.push(['info', `進貨中：${state.suppliers.length} 筆，約 ${B.DELIVERY_MINUTES} 分鐘到貨。`]);
  const t = state.sim.tables.filter((x) => x.usable);
  if (!t.length) hints.push(['bad', '沒有可用的桌子，先到「裝潢」買桌椅並留出走道。']);
  const av = availability(state);
  if (av.waiting >= 3) hints.push(['warn', `${av.waiting} 組客人在門口等位子，服務生快去帶位！`]);
  if (av.freeSeats === 0 && av.usable > 0) hints.push(['warn', '客滿了！動線好一點、桌子多一點就能多賺。']);
  const badCook = state.menu.filter((m) => m.active && (m.cookTime ?? 25) < 8);
  if (badCook.length) hints.push(['warn', `${badCook.map((m) => getDish(m.dishId)?.name).join('、')} 的調理時間太短，客人會覺得是微波食品（原作設定：扣評價）。`]);
  const overpriced = state.menu.filter((m) => m.active && (m.price > (getDish(m.dishId)?.expectedPrice || 100) * 3));
  if (overpriced.length) hints.push(['warn', `定價太高：${overpriced.map((m) => getDish(m.dishId)?.name).join('、')}，客人覺得被坑。`]);
  const lose = state.menu.filter((m) => m.active && m.price < unitCost(m) * 1.2);
  if (lose.length) hints.push(['warn', `接近賠本：${lose.map((m) => getDish(m.dishId)?.name).join('、')}（售價太低）`]);
  if (state.cash < 0) hints.push(['bad', `現金是負的！連續 ${Math.floor(state.flags.negativeCashDays || 0)} 天會破產。`]);
  const noShift = state.staff.filter((s) => s.shift && (s.shift.start > state.settings.openMinute || s.shift.end < state.settings.closeMinute));
  if (noShift.length) hints.push(['warn', `${noShift.length} 位員工的班表沒有涵蓋營業時間。`]);
  if ((state.sim.skippedBigParties || 0) > 0) {
    hints.push(['warn', `剛剛有 ${state.sim.skippedBigParties} 組（最大 ${state.sim.skippedBiggest} 人）因為店裡沒有夠大的桌子而路過，買張大桌就吃得到。`]);
  }
  const tired = state.staff.filter((s) => (s.fatigue ?? 0) > 80);
  if (tired.length) hints.push(['warn', `${tired.map((s) => s.name).join('、')} 疲勞過高（效率剩 72%），縮短班表或加薪可以留住人。`]);
  const unhappy = state.staff.filter((s) => (s.mood ?? 70) < 30);
  if (unhappy.length) hints.push(['bad', `${unhappy.map((s) => s.name).join('、')} 心情很差，再不調薪就要離職了。`]);
  if (state.sim.equipBroken && !state.layout.items.some((i) => i.typeId === 'cctv')) hints.push(['info', '還沒買監視器，宵小與老鼠事件的損失會很慘。']);
  const dec = decorScore(state.layout, loc);
  if (dec.total < 40) hints.push(['info', `裝潢分數只有 ${dec.total}，加點裝飾能提升客流與心情（${loc?.name} 偏好 ${loc?.decorStyle} 風格）。`]);
  if (state.phase === 'build') hints.push(['info', '準備中：擺好桌椅→編菜單→叫貨→按「開始營業」。']);
  if (state.phase === 'open' && !state.sim.customers.length && state.minute < 11 * 60) hints.push(['info', '還沒有人上門，早餐時段本來人就少，或試著向路人招手。']);
  if (!hints.length) hints.push(['good', '一切正常，專心衝高翻桌率與評價吧！']);
  return hints;
}

function refreshHintBar(state) {
  const hints = computeHints(state);
  hintIndex = (hintIndex + 1) % hints.length;
  const [kind, text] = hints[hintIndex];
  W.clear(hintbar);
  hintbar.appendChild(W.h('span', { class: 'hint-tag' }, '餐廳小提示'));
  hintbar.appendChild(W.h('span', { class: `hint-msg ${kind}` }, text));
  const more = hints.length > 1 ? W.h('span', { class: 'muted' }, `${hintIndex + 1}/${hints.length}`) : null;
  if (more) hintbar.appendChild(more);
}

/* ---------------------------------------------------------------- 更新 HUD */

function phaseName(state) {
  return {
    build: '準備中', open: '營業中', closing: '打烊中', closed: '今日結束',
    settle: '結算', gameover: '結束營業'
  }[state.phase] || state.phase;
}

function updateHud(state) {
  if (!hudEls.date) return;
  hudEls.date.textContent = `第 ${state.day} 天 ${WEEKDAY[(state.day - 1) % 7]}`;
  hudEls.clock.textContent = hhmm(state.minute);
  hudEls.weather.textContent = B.WEATHER_NAME[state.sim.weather] || '晴天';
  hudEls.cash.textContent = money(state.cash);
  hudEls.cash.classList.toggle('debt', state.cash < 0);
  hudEls.stars.textContent = '★'.repeat(Math.max(0, state.stars))
    + '☆'.repeat(Math.max(0, (B.MAX_STARS || 5) - state.stars));
  hudEls.repC.textContent = Math.round(state.reputation.community);
  hudEls.repO.textContent = Math.round(state.reputation.outside);
  hudEls.guests.textContent = `${state.stats.today.guests} 人`;
  hudEls.phase.textContent = phaseName(state);
  if (hudEls.speedButtons) {
    for (const b of hudEls.speedButtons) b.classList.toggle('is-on', Number(b.dataset.speed) === state.speed);
  }
  for (const btn of toolbar.querySelectorAll('[data-action]')) {
    const a = btn.dataset.action;
    btn.disabled = (a === 'open' && state.phase !== 'build') ||
      (a === 'close' && state.phase !== 'open') ||
      (a === 'next' && state.phase !== 'closed');
  }
  document.getElementById('app').classList.toggle('paused', state.speed === 0);
  document.getElementById('app').className = `phase-${state.phase}${state.speed === 0 ? ' paused' : ''}`;
}

/* --------------------------------------------------------- 畫布互動處理 */

function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: (ev.clientX - rect.left) / VIEW.cssScale, y: (ev.clientY - rect.top) / VIEW.cssScale };
}

function pendingPlacement() {
  const panel = windows.panels.get('build');
  if (!panel || typeof panel.getPending !== 'function') return null;
  const p = panel.getPending();
  // build 面板的 getPending() 會回 {mode:'place'|'move'|null, typeId, uid, rot}
  if (!p || (p.mode && p.mode !== 'place') || !p.typeId) return null;
  return p;
}
function pendingMoveUid() {
  const panel = windows.panels.get('build');
  if (!panel) return null;
  if (typeof panel.getPendingMove === 'function') {
    const uid = panel.getPendingMove();
    if (typeof uid === 'string' && uid) return uid;
    if (uid && typeof uid === 'object' && uid.uid) return uid.uid;
  }
  const p = typeof panel.getPending === 'function' ? panel.getPending() : null;
  if (p && p.mode === 'move' && p.uid) return p.uid;
  return null;
}

/* ------------------------------------------------------- 畫布上的傢俱操作 */

/** 目前選取的傢俱（在平面圖上直接點選） */
const selection = { uid: null };
/** 拖曳狀態 */
let dragState = null;
/** 浮動工具列啟動的「點擊放置」模式 */
let clickMoveUid = null;
let suppressClick = false;
let barEl = null;
/** 更換傢俱對話框是否開著（避免重複開啟） */
let replaceBusy = false;

function selectedItem() {
  if (!selection.uid) return null;
  return findItem(store.getState().layout, selection.uid);
}

function clearSelection() {
  selection.uid = null;
  view.selectionUid = null;
  clickMoveUid = null;
  if (barEl) { barEl.remove(); barEl = null; }
}

function selectItem(uid) {
  if (!uid || !findItem(store.getState().layout, uid)) return;   // 避免拿到過期的 uid
  selection.uid = uid;
  view.selectionUid = uid;
  ensureBar();
  rebuildBar();
  positionBar();
}

function itemScreenPos(item) {
  const def = furnitureById(item.typeId);
  const w = item.w || def?.w || 1;
  const h = item.h || def?.h || 1;
  const p = renderer ? renderer.tileToScreen(item.x + (w - 1) / 2, item.y + (h - 1) / 2) : { px: 320, py: 200 };
  return { x: (p.px ?? 320) * VIEW.cssScale, y: (p.py ?? 200) * VIEW.cssScale };
}

function ensureBar() {
  if (barEl) return barEl;
  barEl = W.h('div', { class: 'item-bar' });
  document.getElementById('stage').appendChild(barEl);
  return barEl;
}

function positionBar() {
  const item = selectedItem();
  if (!item) { if (barEl) { barEl.remove(); barEl = null; } return; }
  ensureBar();
  const pos = itemScreenPos(item);
  const stageEl = document.getElementById('stage');
  const barW = barEl.offsetWidth || 280;
  barEl.style.left = `${Math.max(6, Math.min(stageEl.clientWidth - barW - 6, pos.x - barW / 2))}px`;
  barEl.style.top = `${Math.max(6, pos.y - 30)}px`;
}

function rebuildBar() {
  const item = selectedItem();
  if (!item) { clearSelection(); return; }
  const st = store.getState();
  const def = furnitureById(item.typeId) || { name: item.typeId, seats: 0, decorScore: 0, category: 'decor', price: 0 };
  const table = st.sim.tables.find((t) => t.uid === item.uid);
  const info = table
    ? `座位 ${table.seats.length}・${table.usable ? '可用' : '動線不良'}・${{ clean: '乾淨', dirty: '待收桌', occupied: '使用中' }[table.state] || ''}`
    : `裝潢 ${def.decorScore || 0} 分`;

  W.clear(barEl);
  barEl.appendChild(W.h('span', { class: 'item-bar-title' },
    `${def.name} (${item.x},${item.y})`, W.h('span', { class: 'item-bar-info' }, ` ${info}`)));

  const moveOn = clickMoveUid === item.uid;
  barEl.appendChild(W.button(moveOn ? '點圖放置…' : '移動', () => {
    clickMoveUid = moveOn ? null : item.uid;
    rebuildBar();
    ui.toast(moveOn ? '已取消移動' : '請在平面圖上點擊新的位置（也可以直接拖曳傢俱）', 'info');
  }, { small: true, kind: moveOn ? 'primary' : undefined }));

  barEl.appendChild(W.button('旋轉', () => {
    const res = store.dispatch({ type: 'ROTATE_FURNITURE', uid: item.uid });
    ui.toast(res.ok ? (res.info || '已旋轉') : res.error, res.ok ? 'good' : 'bad');
    rebuildBar();
  }, { small: true, title: '改變朝向（快捷鍵 R）' }));

  barEl.appendChild(W.button('更換', () => openReplacePicker(item), { small: true, title: '同類傢俱就地更換（舊品退 50%）' }));

  barEl.appendChild(W.button('拆除', async () => {
    const refund = Math.round((def.price || 0) / 2);
    const ok = await ui.confirm({
      title: '拆除傢俱',
      message: `確定要拆除「${def.name}」嗎？\n當初花了 ${money(def.price)}，拆掉退回 50%（${money(refund)}）。`,
      okLabel: '拆除並退款', cancelLabel: '保留'
    });
    if (!ok) return;
    const res = store.dispatch({ type: 'REMOVE_FURNITURE', uid: item.uid });
    ui.toast(res.ok ? (res.info || '已拆除') : res.error, res.ok ? 'good' : 'bad');
    clearSelection();
  }, { small: true, kind: 'danger' }));

  barEl.appendChild(W.button('✕', () => clearSelection(), { small: true, title: '取消選取（Esc）' }));
}

/** 就地更換：列出同分類傢俱直接換掉（位置與朝向保留） */
function openReplacePicker(item) {
  if (replaceBusy) return;
  const st = store.getState();
  const def = furnitureById(item.typeId) || { category: 'decor', price: 0, name: item.typeId };
  const sameCat = FURNITURE.filter((f) => f.category === def.category && f.id !== def.id);
  const refund = Math.round((def.price || 0) / 2);

  const list = W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '52vh', overflow: 'auto' } });
  if (!sameCat.length) list.appendChild(W.emptyState('沒有其他同類傢俱可以更換。'));

  const modal = W.h('div', { class: 'modal-mask' });
  const close = (choice) => {
    modal.remove();
    replaceBusy = false;
    document.removeEventListener('keydown', onKey);
    if (!choice) return;
    const res = store.dispatch({ type: 'REPLACE_FURNITURE', uid: item.uid, typeId: choice });
    ui.toast(res.ok ? (res.info || '已更換') : res.error, res.ok ? 'good' : 'bad');
    if (res.ok) { rebuildBar(); sfx('cash'); } else sfx('error');
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
  document.addEventListener('keydown', onKey);

  for (const f of sameCat) {
    const cost = Math.max(0, (f.price || 0) - refund);
    const fits = canPlace(st.layout, f.id, item.x, item.y, item.uid);
    const row = W.h('div', { class: `card${fits.ok ? ' clickable' : ' disabled'}` },
      W.h('div', { class: 'card-title' }, f.name,
        W.h('span', { class: 'tagline' }, ` ${f.w}×${f.h}・座位 ${f.seats || 0}・裝潢 ${f.decorScore || 0}`)),
      W.h('div', { class: 'muted' },
        `價格 ${money(f.price)}　舊品退款 ${money(refund)}　`,
        cost > 0 ? `需補 ${money(cost)}` : '不用補錢',
        fits.ok ? '' : `　（這裡放不下：${fits.error}）`));
    if (fits.ok) row.addEventListener('click', () => close(f.id));
    list.appendChild(row);
  }

  const win = W.h('div', { class: 'win', style: { width: '470px' } },
    W.h('div', { class: 'win-title' },
      W.h('span', { class: 'win-icon' }, '🔁'),
      W.h('span', { class: 'win-name' }, `更換傢俱：${def.name}`),
      W.h('span', { class: 'win-btns' }, W.button('✕', () => close(null), { small: true }))),
    W.h('div', { class: 'win-body' },
      W.h('div', { class: 'hintbox' }, `就地換成同類傢俱：舊品退 50%（${money(refund)}），只收差額，位置與朝向都保留。`),
      list));
  modal.appendChild(win);
  modal.addEventListener('mousedown', (ev) => { if (ev.target === modal) close(null); });
  document.body.appendChild(modal);
  replaceBusy = true;
}

/**
 * 指標命中的傢俱。
 *
 * 解析順序（三層，愈前面愈權威）：
 *   1. 指標所在那一格上的權威資料：`itemAt(layout, tile)`，而且指標必須真的落在那件
 *      物件「自己的腳印」裡（|du|,|ds| ≤ (w+h)/2，以腳印中心為原點；u = x−y、s = x+y）。
 *      這一步讓「椅子格選到椅子、桌子中心格選到桌子」。
 *   2. 否則用 renderer.hitTestItemExact()（任何物件的腳印菱形）。
 *   3. 否則用 renderer.hitTestItemAt()（視覺命中＋命中盒位移），再退四鄰格。
 *
 * 為何不能只靠第 2 步：2×2 桌子的腳印菱形半徑是 (2+2)/2 = 2 格，菱形會伸到緊鄰的
 * 椅子格中心（距離只有 1.5 格），於是「點椅子卻選到桌子」。第 1 步先問「這一格上是誰」，
 * 再用同一條菱形公式確認指標真的在那件物件上，就同時滿足兩種點擊。
 * 第 1 步用「指標反解的浮點格座標」而不是呼叫端傳進來的 tile，兩者才會一致。
 */
function itemAtPointer(p, tile) {
  const st = store.getState();
  const layout = st.layout;
  const f = renderer && renderer.screenToTileF ? renderer.screenToTileF(p.x, p.y) : null;
  const tileX = f ? Math.round(f.x) : (tile ? tile.x : null);
  const tileY = f ? Math.round(f.y) : (tile ? tile.y : null);
  if (tileX !== null && tileY !== null) {
    const onTile = itemAt(layout, tileX, tileY);
    if (onTile && inTileDiamond(f, onTile)) return onTile;
  }
  const exact = renderer && renderer.hitTestItemExact ? renderer.hitTestItemExact(p.x, p.y) : null;
  if (exact && findItem(layout, exact.uid)) return exact;
  const visual = renderer && renderer.hitTestItemAt ? renderer.hitTestItemAt(p.x, p.y) : null;
  if (visual && visual.item && findItem(layout, visual.item.uid)) return visual.item;
  if (tile) {
    const direct = itemAt(layout, tile.x, tile.y);
    if (direct) return direct;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const near = itemAt(layout, tile.x + dx, tile.y + dy);
      if (near) return near;
    }
  }
  return null;
}

/** 浮點格座標 f 是否落在那件傢俱自己的腳印菱形內。 */
function inTileDiamond(f, item) {
  if (!f || !item) return false;
  const x = num0(item.x);
  const y = num0(item.y);
  const w = Math.max(1, Math.round(num0(item.w) || 1));
  const h = Math.max(1, Math.round(num0(item.h) || 1));
  const du = (f.x - f.y) - (x + (w - 1) / 2 - (y + (h - 1) / 2));
  const ds = (f.x + f.y) - (x + (w - 1) / 2 + y + (h - 1) / 2);
  const rad = (w + h) / 2;
  return Math.abs(du) <= rad && Math.abs(ds) <= rad;
}

function num0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function setupCanvasInput() {
  canvas.addEventListener('mousemove', (ev) => {
    const st = store.getState();
    const p = canvasPoint(ev);
    const tile = renderer ? renderer.screenToTile(p.x, p.y) : null;
    view.hover = tile;
    const pend = pendingPlacement();
    const mvUid = clickMoveUid || pendingMoveUid();

    // 拖曳中：幽靈傢俱跟著游標
    if (dragState) {
      const item = findItem(st.layout, dragState.uid);
      if (item && tile) {
        const check = canPlace(st.layout, item.typeId, tile.x, tile.y, item.uid);
        view.ghost = { typeId: item.typeId, x: tile.x, y: tile.y, valid: check.ok, rot: item.rot };
        dragState.tile = tile;
        dragState.moved = dragState.moved || tile.x !== dragState.startTile.x || tile.y !== dragState.startTile.y;
      }
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (pend && tile) {
      const check = canPlace(st.layout, pend.typeId, tile.x, tile.y);
      view.ghost = { typeId: pend.typeId, x: tile.x, y: tile.y, valid: check.ok, rot: pend.rot };
    } else if (mvUid && tile) {
      const item = findItem(st.layout, mvUid);
      if (item) {
        const check = canPlace(st.layout, item.typeId, tile.x, tile.y, item.uid);
        view.ghost = { typeId: item.typeId, x: tile.x, y: tile.y, valid: check.ok, rot: item.rot };
      } else view.ghost = null;
    } else {
      view.ghost = null;
    }

    const cust = renderer && renderer.hitTestCustomer ? renderer.hitTestCustomer(p.x, p.y) : null;
    view.hoverCustomerUid = cust ? cust.uid : null;
    const overItem = renderer && renderer.hitTestItem ? renderer.hitTestItem(p.x, p.y) : null;
    canvas.style.cursor = (pend || mvUid) ? 'crosshair' : overItem ? 'grab' : (cust ? 'pointer' : 'default');
  });

  canvas.addEventListener('mouseleave', () => { view.hover = null; view.ghost = null; });

  // 直接拖曳傢俱 = 搬家（最直覺的操作）
  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    if (pendingPlacement() || clickMoveUid || pendingMoveUid()) return;   // 放置模式交給 click
    const p = canvasPoint(ev);
    const tile = renderer ? renderer.screenToTile(p.x, p.y) : null;
    const item = itemAtPointer(p, tile);
    if (!item) return;
    selectItem(item.uid);
    dragState = { uid: item.uid, startTile: tile, tile, moved: false };
    ev.preventDefault();
  });

  // 滑鼠在視窗外放開（或視窗失焦）時，清掉拖曳狀態避免卡住
  const cancelDrag = () => { dragState = null; view.ghost = null; };
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('mouseleave', cancelDrag);

  window.addEventListener('mouseup', () => {
    if (!dragState) return;
    const d = dragState;
    dragState = null;
    view.ghost = null;
    if (!d.moved) return;                       // 只是點一下 → 當成選取
    const res = store.dispatch({ type: 'MOVE_FURNITURE', uid: d.uid, x: d.tile.x, y: d.tile.y });
    if (!res.ok) { ui.toast(res.error, 'bad'); sfx('error'); }
    else { sfx('click'); ui.toast(`已搬到 (${d.tile.x},${d.tile.y})`, 'info'); rebuildBar(); positionBar(); }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 80);
  });

  canvas.addEventListener('click', (ev) => {
    const st = store.getState();
    const p = canvasPoint(ev);
    const tile = renderer ? renderer.screenToTile(p.x, p.y) : null;
    initAudio();

    // 1) 擺放傢俱
    const pend = pendingPlacement();
    if (pend) {
      const res = store.dispatch({ type: 'PLACE_FURNITURE', typeId: pend.typeId, x: tile.x, y: tile.y, rot: pend.rot || 0 });
      if (!res.ok) ui.toast(res.error, 'bad');
      else {
        sfx('cash');
        if (!ev.shiftKey && typeof windows.panels.get('build')?.clearPending === 'function') {
          windows.panels.get('build').clearPending();
        }
      }
      return;
    }
    // 2) 移動傢俱（裝潢面板或浮動工具列啟動的「點擊放置」）
    const mvUid = clickMoveUid || pendingMoveUid();
    if (mvUid) {
      const res = store.dispatch({ type: 'MOVE_FURNITURE', uid: mvUid, x: tile.x, y: tile.y });
      if (!res.ok) ui.toast(res.error, 'bad');
      else {
        ui.toast(`已搬到 (${tile.x},${tile.y})`, 'info');
        clickMoveUid = null;
        const panel = windows.panels.get('build');
        if (typeof panel?.clearPendingMove === 'function') panel.clearPendingMove();
        if (selection.uid === mvUid) { rebuildBar(); positionBar(); }
        sfx('click');
      }
      return;
    }
    // 3) 點顧客看心情
    const cust = renderer && renderer.hitTestCustomer ? renderer.hitTestCustomer(p.x, p.y) : null;
    if (cust) {
      const label = { arriving: '剛進門', queueing: '候位中', toSeat: '前往座位', ordering: '看菜單', waitingFood: '等餐中', eating: '用餐中', paying: '等結帳', leaving: '吃飽了', angry: '不爽走人' }[cust.state] || cust.state;
      const order = cust.order?.length ? cust.order.map((o) => getDish(o.dishId)?.name || o.dishId).join('、') : '還沒點餐';
      ui.toast(`${custTypeName(cust.type)}｜${label}｜心情 ${Math.round(cust.mood)}｜等 ${Math.round(cust.waitMin)} 分｜${order}`, cust.mood < 0 ? 'bad' : 'info');
      return;
    }
    // 4) 點傢俱 → 選取，顯示 移動／旋轉／更換／拆除 工具列
    const item = itemAtPointer(p, tile);
    if (item) {
      const isNew = selection.uid !== item.uid;
      selectItem(item.uid);
      if (isNew) ui.toast('已選取：可直接拖曳搬家、按 R 旋轉，或用工具列更換／拆除', 'info');
      return;
    }
    // 5) 點路人拉客（店外走道）
    const walker = nearestWalker(st, tile);
    if (walker && !(tile && st.layout.items.some((it) => it.x === tile.x && it.y === tile.y))) {
      const res = store.dispatch({ type: 'LURE', walkerUid: walker.uid });
      ui.toast(res.ok ? res.info : res.error, res.ok ? 'good' : 'bad');
      return;
    }
    // 6) 點空白處 → 取消選取
    if (selection.uid) { clearSelection(); return; }
    if (tile && view.showGrid) {
      const type = st.layout.tiles[tile.y * st.layout.gridW + tile.x];
      ui.toast('格 (' + tile.x + ', ' + tile.y + ')：' + type, 'info');
    }
  });

  // 鍵盤：Esc 取消、R 旋轉、M 移動、Delete 拆除、+/- 縮放、` 密技
  window.addEventListener('keydown', (ev) => {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName || '')) return;
    if (ev.key === '+' || ev.key === '=') { setZoom((VIEW.auto ? VIEW.deviceScale : VIEW.userScale) + 1); return; }
    if (ev.key === '-' || ev.key === '_') { setZoom((VIEW.auto ? VIEW.deviceScale : VIEW.userScale) - 1); return; }
    if (ev.key === '0') { setZoom(0); return; }
    if (ev.key === 'Escape') {
      if (cheat.open) { cheat.toggle(); return; }
      clearSelection();
      const panel = windows.panels.get('build');
      if (typeof panel?.clearPending === 'function') panel.clearPending();
      return;
    }
    const item = selectedItem();
    if (!item) return;
    if (ev.key === 'r' || ev.key === 'R') {
      const res = store.dispatch({ type: 'ROTATE_FURNITURE', uid: item.uid });
      ui.toast(res.ok ? (res.info || '已旋轉') : res.error, res.ok ? 'good' : 'bad');
      rebuildBar();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      store.dispatch({ type: 'REMOVE_FURNITURE', uid: item.uid });
      clearSelection();
    } else if (ev.key === 'm' || ev.key === 'M') {
      clickMoveUid = item.uid;
      rebuildBar();
      ui.toast('請在平面圖上點擊新的位置', 'info');
    } else if (ev.key === '`') {
      cheat.toggle();
    }
  });
}

function custTypeName(type) {
  return { student: '學生', office: '上班族', family: '家庭客', tourist: '觀光客', critic: '美食評論家', vip: '貴賓' }[type] || '顧客';
}

function nearestWalker(state, tile) {
  if (!tile || !state.sim.walkers.length) return null;
  let best = null;
  let bestDist = 1.6;
  for (const w of state.sim.walkers) {
    const d = Math.abs(w.x - tile.x) + Math.abs(w.y - tile.y);
    if (d < bestDist) { bestDist = d; best = w; }
  }
  return best;
}

/* -------------------------------------------------------- 密技控制台 */
const cheat = {
  open: false,
  el: null,
  input: null,
  log: null,
  history: [],
  hi: 0,
  ensure() {
    if (this.el) return this.el;
    const host = document.getElementById('app');
    this.el = h('div', { class: 'cheat-console', style: { display: 'none' } },
      h('div', { class: 'cheat-head' }, '密技控制台　（輸入 help 看說明，Esc 關閉）'),
      h('div', { class: 'cheat-log', ref: (n) => { this.log = n; } }),
      h('div', { class: 'cheat-row' },
        h('span', { class: 'cheat-prompt' }, '>'),
        h('input', { class: 'cheat-input', type: 'text', ref: (n) => { this.input = n; } })));
    host.appendChild(this.el);
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const cmd = this.input.value.trim();
        if (cmd) { this.run(cmd); this.history.push(cmd); this.hi = this.history.length; }
        this.input.value = '';
      } else if (ev.key === 'ArrowUp') {
        this.hi = Math.max(0, this.hi - 1);
        this.input.value = this.history[this.hi] || '';
      } else if (ev.key === 'ArrowDown') {
        this.hi = Math.min(this.history.length, this.hi + 1);
        this.input.value = this.history[this.hi] || '';
      }
    });
    return this.el;
  },
  toggle() {
    this.ensure();
    this.open = !this.open;
    this.el.style.display = this.open ? 'flex' : 'none';
    if (this.open) { this.input.focus(); this.print('輸入 help 看可用指令'); }
  },
  print(line, kind) {
    if (!this.log) return;
    this.log.appendChild(h('div', { class: 'cheat-line' + (kind ? ' ' + kind : '') }, line));
    this.log.scrollTop = this.log.scrollHeight;
  },
  run(raw) {
    this.print('> ' + raw, 'cmd');
    const parts = raw.trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ');
    const st = store.getState();
    const L = (zh, en) => this.print(zh, 'out');
    try {
      switch (cmd) {
        case 'help':
          L('可用指令：');
          L('  money <數字>     加錢（例: money 1000000）');
          L('  star <1-5>       設定星級');
          L('  unlock           解鎖所有地點');
          L('  weather <類型>   設定天氣（sunny/cloudy/rain/storm/cold/heat）');
          L('  event <編號>     觸發事件（例: event tv_interview）');
          L('  open             直接開店（開始營業）');
          L('  close            打烊');
          L('  clear            清除紀錄');
          break;
        case 'money': {
          const n = Number(arg);
          if (!Number.isFinite(n) || n <= 0) { this.print('用法: money <正整數>', 'err'); break; }
          st.cash += Math.round(n);
          this.print('已加 NT$ ' + Math.round(n).toLocaleString('en-US') + '，目前現金 ' + (function (v) { const s = v < 0 ? '-' : ''; return s + 'NT$ ' + Math.abs(Math.round(v)).toLocaleString('en-US'); })(st.cash), 'good');
          break;
        }
        case 'star': {
          const cap = B.MAX_STARS || 5;
          const n = Math.max(1, Math.min(cap, Math.round(Number(arg) || 0)));
          if (n < 1) { this.print(`用法: star <1-${cap}>`, 'err'); break; }
          st.stars = n;
          this.print('星級已設為 ' + n + ' 星', 'good');
          break;
        }
        case 'unlock':
          st.stars = Math.max(st.stars, 5);
          this.print('已解鎖所有地點（星級已達 5）', 'good');
          break;
        case 'weather': {
          const ok = ['sunny', 'cloudy', 'rain', 'storm', 'cold', 'heat'];
          if (!ok.includes(arg)) { this.print('天氣類型: ' + ok.join(' / '), 'err'); break; }
          st.sim.weather = arg;
          this.print('天氣已設為 ' + arg, 'good');
          break;
        }
        case 'event': {
          if (!arg) { this.print('用法: event <事件編號>（例: event tv_interview）', 'err'); break; }
          const evMod = window.__events || null;
          this.print('事件觸發需要在遊戲內透過「系統」面板或自然發生', 'info');
          break;
        }
        case 'open':
          if (st.phase === 'build') store.dispatch({ type: 'START_DAY' });
          else this.print('目前不是準備階段（phase=' + st.phase + '）', 'err');
          break;
        case 'close':
          if (st.phase === 'open') store.dispatch({ type: 'END_DAY' });
          else this.print('目前不是營業中（phase=' + st.phase + '）', 'err');
          break;
        case 'clear':
          if (this.log) this.log.innerHTML = '';
          break;
        default:
          this.print('未知指令：' + cmd + '（輸入 help 看說明）', 'err');
      }
    } catch (err) {
      this.print('執行失敗：' + err.message, 'err');
    }
  }
};

/* -------------------------------------------------------- uiQueue 事件處理 */

let curtainBusy = false;

function processUiQueue(state) {
  if (!state.uiQueue || !state.uiQueue.length) return;
  if (curtainBusy) return;
  const item = state.uiQueue.shift();
  switch (item.type) {
    case 'toast':
      ui.toast(item.message, item.kind || 'info');
      break;
    case 'event': {
      curtainBusy = true;
      W.modalDialog({
        title: `${item.kind === 'positive' ? '★ 好消息' : item.kind === 'negative' ? '！突發狀況' : '通知'}：${item.title}`,
        width: 430,
        body: W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
          W.h('div', {}, item.message),
          item.notes && item.notes.length ? W.h('div', { class: 'hintbox' }, item.notes.join('　')) : null),
        buttons: [{ label: '知道了', value: true, kind: 'primary' }]
      }).then(() => { curtainBusy = false; });
      sfx(item.kind === 'negative' ? 'alarm' : 'coin');
      break;
    }
    case 'dayEnd': {
      curtainBusy = true;
      const r = item.record;
      const body = W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
        W.statRow('營業額', money(r.revenue)),
        W.statRow('小費', money(r.tips)),
        W.statRow('支出', money(r.spend)),
        W.statRow('淨利', money(r.profit), { kind: r.profit >= 0 ? 'good' : 'bad' }),
        W.statRow('來客數', `${r.guests} 人`),
        W.statRow('服務完成', `${r.served} 人`),
        W.statRow('生氣離開', `${r.angry} 人`, { kind: r.angry ? 'bad' : 'good' }),
        W.statRow('平均等待', `${Math.floor(r.avgWaitSec / 60)} 分 ${r.avgWaitSec % 60} 秒`),
        W.statRow('平均心情', String(r.avgMood), { kind: r.avgMood >= 0 ? 'good' : 'bad' }),
        W.statRow('社區／區外評價', `${Math.round(r.repCommunity)} / ${Math.round(r.repOutside)}`));
      store.autoSave();
      W.modalDialog({
        title: `第 ${r.day} 天營業報告（已自動存檔）`,
        width: 400,
        body,
        buttons: [{ label: '繼續', value: true, kind: 'primary' }]
      }).then(() => { curtainBusy = false; });
      sfx('settle');
      break;
    }
    case 'settle':
      curtainBusy = true;
      settleUI.showWeekSettle({ state, ui, store });
      setTimeout(() => { curtainBusy = !settleUI.isCurtainOpen(); }, 60);
      sfx('settle');
      break;
    case 'starUp':
      curtainBusy = true;
      settleUI.showStarUp({ state, from: item.from, to: item.to, ui });
      sfx('star');
      break;
    case 'annualAward':
      curtainBusy = true;
      settleUI.showAnnualAward({ state, ui });
      sfx('star');
      break;
    case 'gameover':
      curtainBusy = true;
      settleUI.showGameOver({ state, ui, store });
      sfx('alarm');
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ 主迴圈 */

let lastFrame = performance.now();
let lastUiRefresh = 0;
let lastHint = 0;
let lastBgRefresh = 0;

function loop(now) {
  const dtReal = Math.min(0.5, (now - lastFrame) / 1000);
  lastFrame = now;
  const state = store.getState();

  if (state.speed > 0 && (state.phase === 'open' || state.phase === 'closing')) {
    stepSimulation(state, dtReal * state.speed * B.MINUTES_PER_SECOND);
  }
  // 準備階段時間不流動（進貨會在開始營業後到貨），避免玩家還在佈置就過了下班時間

  processUiQueue(state);

  if (now - lastUiRefresh > 180) {
    lastUiRefresh = now;
    updateHud(state);
    windows.refreshAll(state);
    const notices = store.drainNotices();
    for (const n of notices.slice(-3)) ui.toast(n.message, n.kind);
  }
  if (now - lastHint > 5200) {
    lastHint = now;
    refreshHintBar(state);
  }
  if (now - lastBgRefresh > 1000) {
    lastBgRefresh = now;
    if (state.settings.music && state.settings.music !== 'off') setMusic(state.settings.music);
  }

  view.fx = state.settings?.fx || null;
  view.frame = (view.frame + 1) % 100000;
  if (renderer) {
    try {
      renderer.render(state, view);
    } catch (err) {
      if (!renderer._warned) {
        renderer._warned = true;
        console.error('[main] 繪圖錯誤', err);
      }
    }
  }
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ 啟動 */

function registerPanels() {
  windows.init({ store, ui, host: document.getElementById('window-host') });
  windows.register('menu', createMenuPanel);
  windows.register('staff', createStaffPanel);
  windows.register('build', createBuildPanel);
  windows.register('report', createReportPanel);
  windows.register('settings', createSettingsPanel);
  windows.register('system', createSystemPanel);
}

function showBoot() {
  const boot = document.getElementById('boot');
  const box = document.getElementById('boot-buttons');
  W.clear(box);
  box.appendChild(W.button('新的餐廳（中壢新明夜市）', () => {
    store.dispatch({ type: 'NEW_GAME', seed: (Date.now() & 0xffffffff) >>> 0 });
    closeBoot();
    startTutorial();
  }, { kind: 'primary' }));
  const cont = W.button('讀取每日自動存檔', () => {
    const res = store.dispatch({ type: 'LOAD_GAME', slot: 'auto' });
    if (!res.ok) ui.toast(res.error, 'bad');
    else closeBoot();
  });
  cont.disabled = !hasAnySave();
  box.appendChild(cont);
  box.appendChild(W.button('直接開始（沿用目前狀態）', () => { closeBoot(); }, { kind: 'ghost' }));
}

function closeBoot() {
  document.getElementById('boot').classList.add('hide');
  fitCanvas();
  const st = store.getState();
  updateHud(st);
  refreshHintBar(st);
  if (!st.flags.tutorialDone && !new URLSearchParams(location.search).has('autostart')) startTutorial();
}

function startTutorial() {
  const st = store.getState();
  const steps = [
    '歡迎來到夢幻西餐廳！你剛接下中壢新明夜市這家小店。',
    '第一步：到「裝潢」買桌椅，留出走道。桌椅離廚房出餐口越遠，服務生能負責的桌數就越少。',
    '第二步：到「菜單」調整售價、材料等級、味道濃淡、份量與調理時間。調理時間太短會被當成微波食品，評價會掉！',
    '第三步：到「菜單→進貨」叫貨。賣完客人就點不到餐，會生氣走人。',
    '第四步：到「員工」雇用廚師與服務生，指派職務（帶位／送餐／點餐／收桌／清掃廁所）。',
    '最後按「開始營業」。記得注意天氣、空調溫度，也可以點畫面下方走動的路人拉客。',
    '每週日 22:00 會結算雜誌排名，每週一發社區獎金。五星之後還有年度大獎等著你。'
  ];
  let i = 0;
  const show = () => {
    if (i >= steps.length) {
      store.dispatch({ type: 'SET_TUTORIAL_DONE' });
      return;
    }
    W.modalDialog({
      title: `新手教學 (${i + 1}/${steps.length})`,
      width: 460,
      body: W.h('div', { class: 'help-text' }, steps[i]),
      buttons: [{ label: i === steps.length - 1 ? '開始經營！' : '下一步', value: true, kind: 'primary' }]
    }).then(() => { i += 1; show(); });
  };
  show();
}

function main() {
  buildHud();
  buildToolbar();
  registerPanels();
  setupCanvasInput();
  fitCanvas();

  window.addEventListener('pointerdown', () => { initAudio(); resumeMusic(); }, { once: true });
  const st = store.getState();
  if (st.settings.music !== 'off') setMusic(st.settings.music);

  // ?autostart=1 → 跳過開場畫面（給自動化測試／截圖用）
  const params = new URLSearchParams(location.search);
  if (params.has('autostart')) {
    closeBoot();
    if (params.has('tutorial')) startTutorial();
    if (params.get('speed')) store.dispatch({ type: 'SET_SPEED', value: Number(params.get('speed')) || 1 });
    if (params.get('open')) store.dispatch({ type: 'START_DAY' });
    // ?loc=keelung_miaokou → 直接搬到指定地點（自動化測試用，會跳過星級限制）
    const locId = params.get('loc');
    if (locId) {
      const target = store.getState();
      const savedPhase = target.phase;
      target.phase = 'build';
      target.stars = 5;
      target.cash = Math.max(target.cash, 500000);
      const res = store.dispatch({ type: 'MOVE_LOCATION', locationId: locId });
      if (!res.ok) console.warn('[main] 測試搬遷失敗：', res.error);
      target.phase = savedPhase;
    }
    // ?weather=sunny|rain|... → 指定天氣（自動化測試用）
    const wf = params.get('weather');
    if (wf) store.getState().sim.weather = wf;
    // ?show=settle|starup|award|gameover → 直接顯示事件畫面（自動化測試用）
    const show = params.get('show');
    if (show) {
      const s = store.getState();
      if (show === 'settle') settleUI.showWeekSettle({ state: s, ui, store });
      else if (show === 'starup') settleUI.showStarUp({ state: s, from: s.stars, to: Math.min(B.MAX_STARS || 5, s.stars + 1), ui });
      else if (show === 'award') settleUI.showAnnualAward({ state: s, ui });
      else if (show === 'gameover') settleUI.showGameOver({ state: s, ui, store });
    }
    if (params.get('panel')) windows.openWindow(params.get('panel'));
    // ?cherish=1 → 直後のスポーンを Cherish にする（自動化テスト／截圖用）
    const cher = Number(params.get('cherish') || 0);
    if (cher > 0) {
      const s = store.getState();
      s.sim.forceType = 'cherish';
      s.sim.forceTypeLeft = cher;
    }
    // ?floorMat=waga-0-1&wallMat=waga-3-2 → 直接貼和柄（自動化測試／分享用）
    if (params.get('floorMat')) store.dispatch({ type: 'SET_SETTING', key: 'floorMat', value: params.get('floorMat') });
    if (params.get('wallMat')) store.dispatch({ type: 'SET_SETTING', key: 'wallMat', value: params.get('wallMat') });
    // ?ff=180 → 載入後先快轉 N 遊戲分鐘（自動化測試用）
    const ff = Number(params.get('ff') || 0);
    if (ff > 0) {
      const target = store.getState();
      for (let i = 0; i < Math.ceil(ff / 2); i++) stepSimulation(target, 2);
      target.uiQueue = target.uiQueue.filter((q) => q.type === 'toast');
    }
    // ?days=8 → 直接跑完 N 個完整營業日（含週結算，自動化測試用）
    const days = Number(params.get('days') || 0);
    if (days > 0) {
      const target = store.getState();
      for (let d = 0; d < days; d++) {
        if (target.phase === 'closed') store.dispatch({ type: 'NEXT_DAY' });
        // 測試用：自動補貨讓快轉測試可以一直跑下去
        for (const entry of target.menu.filter((m) => m.active)) {
          if ((target.stock[entry.dishId] || 0) < 40) {
            store.dispatch({ type: 'BUY_STOCK', dishId: entry.dishId, servings: 80 });
          }
        }
        if (target.phase === 'build') store.dispatch({ type: 'START_DAY' });
        let guard = 0;
        while ((target.phase === 'open' || target.phase === 'closing') && guard < 1200) {
          stepSimulation(target, 5);
          guard += 1;
        }
        target.uiQueue = target.uiQueue.filter((q) => q.type === 'toast' || q.type === 'settle' || q.type === 'starUp' || q.type === 'annualAward');
      }
    }
  } else {
    showBoot();
  }
  requestAnimationFrame(loop);

  // 除錯用（開發者工具）
  window.DREAM = {
    store, windows, view, renderer, ui, stepSimulation, restaurantSummary, seatCount, BALANCE: B,
    // 給自動化測試讀取的互動狀態（唯讀）
    logical: { get w() { return LOGICAL_W; }, get h() { return LOGICAL_H; }, get deviceScale() { return VIEW.deviceScale; }, get cssScale() { return VIEW.cssScale; }, get auto() { return VIEW.auto; } },
    setZoom,
    get interaction() {
      return {
        selectionUid: selection.uid,
        clickMoveUid,
        dragging: !!dragState,
        hasBar: !!barEl,
        replaceOpen: replaceBusy,
        pendingPlacement: !!pendingPlacement(),
        pendingMove: pendingMoveUid()
      };
    }
  };
}

main();
