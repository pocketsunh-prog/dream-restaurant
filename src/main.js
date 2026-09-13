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
import { seatCount, decorScore, findItem, canPlace } from './sim/build.js';
import { unitCost } from './sim/economy.js';
import { setMusic, resumeMusic, sfx, initAudio } from './core/audio.js';
import { hasAnySave, loadGame } from './core/save.js';
import { getLocation, LOCATIONS } from './data/locations.js';
import { getDish } from './data/dishes.js';
import { furnitureById } from './data/furniture.js';
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
canvas.style.imageRendering = 'pixelated';
let renderer = null;
try {
  renderer = new FloorRenderer(canvas);
} catch (err) {
  console.error('[main] FloorRenderer 建立失敗', err);
}

let scale = 2;
function fitCanvas() {
  const rect = stage.getBoundingClientRect();
  const raw = Math.min(rect.width / LOGICAL_W, rect.height / LOGICAL_H);
  // 2 倍以上用整數倍（像素完美）；空間不足時允許 0.5 級距，讓畫面盡量填滿
  scale = raw >= 2 ? Math.floor(raw) : Math.max(1, Math.floor(raw * 2) / 2);
  canvas.style.width = `${LOGICAL_W * scale}px`;
  canvas.style.height = `${LOGICAL_H * scale}px`;
}
window.addEventListener('resize', fitCanvas);

const view = {
  frame: 0,
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
  hudEls.stars.textContent = '★'.repeat(state.stars) + '☆'.repeat(5 - state.stars);
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
  return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
}

function pendingPlacement() {
  const panel = windows.panels.get('build');
  if (!panel || typeof panel.getPending !== 'function') return null;
  const p = panel.getPending();
  // build 面板的 getPending() 會回 {mode:'place'|'move'|null, typeId, uid, rot}
  if (!p || (p.mode && p.mode !== 'place') || !p.typeId) return null;
  return p;
}
function pendingMove() {
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

function setupCanvasInput() {
  canvas.addEventListener('mousemove', (ev) => {
    const st = store.getState();
    const p = canvasPoint(ev);
    const tile = renderer ? renderer.screenToTile(p.x, p.y) : null;
    view.hover = tile;
    const pend = pendingPlacement();
    if (pend && tile) {
      const check = canPlace(st.layout, pend.typeId, tile.x, tile.y);
      view.ghost = { typeId: pend.typeId, x: tile.x, y: tile.y, valid: check.ok };
    } else {
      view.ghost = null;
    }
    const cust = renderer && renderer.hitTestCustomer ? renderer.hitTestCustomer(p.x, p.y) : null;
    view.hoverCustomerUid = cust ? cust.uid : null;
    canvas.style.cursor = (pend || pendingMove()) ? 'crosshair' : (cust ? 'pointer' : 'default');
  });

  canvas.addEventListener('mouseleave', () => { view.hover = null; view.ghost = null; });

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
    // 2) 移動傢俱
    const mv = pendingMove();
    if (mv) {
      const res = store.dispatch({ type: 'MOVE_FURNITURE', uid: mv.uid, x: tile.x, y: tile.y });
      if (!res.ok) ui.toast(res.error, 'bad');
      else if (typeof windows.panels.get('build')?.clearPendingMove === 'function') {
        windows.panels.get('build').clearPendingMove();
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
    // 4) 點路人拉客
    const walker = nearestWalker(st, tile);
    if (walker) {
      const res = store.dispatch({ type: 'LURE', walkerUid: walker.uid });
      ui.toast(res.ok ? res.info : res.error, res.ok ? 'good' : 'bad');
      return;
    }
    // 5) 點桌子顯示資訊
    const item = renderer && renderer.hitTestItem ? renderer.hitTestItem(p.x, p.y) : null;
    if (item) {
      const def = furnitureById(item.typeId);
      const table = st.sim.tables.find((t) => t.uid === item.uid);
      const info = table
        ? `${def?.name}｜座位 ${table.seats.length}（可用 ${table.usable ? '是' : '否'}）｜狀態 ${{ clean: '乾淨', dirty: '待收桌', occupied: '使用中' }[table.state]}`
        : `${def?.name}｜裝潢 ${def?.decorScore || 0} 分｜耐久 ${Math.round(item.durability ?? 100)}%`;
      ui.toast(info, 'info');
      return;
    }
    if (tile && view.showGrid) {
      const type = st.layout.tiles[tile.y * st.layout.gridW + tile.x];
      ui.toast(`格 (${tile.x}, ${tile.y})：${type}`, 'info');
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
    // ?show=settle|starup|award|gameover → 直接顯示事件畫面（自動化測試用）
    const show = params.get('show');
    if (show) {
      const s = store.getState();
      if (show === 'settle') settleUI.showWeekSettle({ state: s, ui, store });
      else if (show === 'starup') settleUI.showStarUp({ state: s, from: s.stars, to: Math.min(5, s.stars + 1), ui });
      else if (show === 'award') settleUI.showAnnualAward({ state: s, ui });
      else if (show === 'gameover') settleUI.showGameOver({ state: s, ui, store });
    }
    if (params.get('panel')) windows.openWindow(params.get('panel'));
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
        // 自動補貨，讓快轉測試可以一直跑下去
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
  window.DREAM = { store, windows, view, renderer, ui, stepSimulation, restaurantSummary, seatCount, BALANCE: B };
}

main();
