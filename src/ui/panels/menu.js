// ============================================================================
// panels/menu.js — 菜單編輯面板
//   panel id : 'menu'  標題 : 菜單編輯  🍜  620 x 470
//   分頁     : 菜單 / 進貨 / 食譜資料
//   dispatches（僅使用 docs/ARCHITECTURE.md §4 表上的 action）：
//     MENU_ADD     { dishId }
//     MENU_REMOVE  { dishId }
//     MENU_UPDATE  { dishId, patch:{ price | grade | taste | portion | cookTime } }
//     MENU_TOGGLE  { dishId }
//     BUY_STOCK    { dishId, servings }
//   本面板不直接修改 state，也不 import 任何 CSS。
// ============================================================================
import { DELIVERY_MINUTES, MENU_LIMIT } from '../../core/balance.js';
import { DISHES, dishesForStars } from '../../data/index.js';
import {
  button, card, clear, emptyState, h, hintbox, money, numberField,
  section, statRow, table, tabs, tag, toolbar
} from '../widgets.js';

/* ------------------------------------------------------------------ 常數 */

/**
 * 同時上架料理上限（原作：一星 8 道 → 五星全開）。
 * 直接沿用 src/core/balance.js 的 MENU_LIMIT，不自行改數字（reducer 也用同一份）。
 */
const MENU_CAP = MENU_LIMIT;
/** 可叫貨的份數級距 */
const ORDER_LOTS = [10, 50, 100];
/** 進貨運送時間（遊戲分鐘），與 reducer 的 B.DELIVERY_MINUTES 同步 */
const DELIVERY_MIN = DELIVERY_MINUTES;
const MINUTES_PER_DAY = 1440;

const CATEGORY_LABEL = {
  staple: '主食', side: '小菜', soup: '湯品', drink: '飲料',
  alcohol: '酒類', dessert: '甜點', secret: '隱藏'
};
const TAG_LABEL = {
  spicy: '辣', mild: '清淡', sweet: '甜', cold: '冰', hot: '熱食', fried: '炸物',
  seafood: '海鮮', noodle: '麵食', rice: '飯類', meat: '肉', veg: '蔬菜',
  local: '在地', tourist: '觀光客愛', cheap: '便宜', premium: '高級', quick: '快速',
  alcohol: '酒', caffeine: '咖啡因', dessert: '甜點', soup: '湯'
};

/* ------------------------------------------------------------------ 工具 */

export function menuCapForStars(stars) {
  return MENU_CAP[Math.max(1, Math.min(5, Math.round(Number(stars) || 1)))] || 8;
}

export function totalStockUnits(stock, store, suppliers) {
  let n = 0;
  const add = (obj) => { if (obj) for (const v of Object.values(obj)) n += Number(v) || 0; };
  add(stock); add(store);
  if (Array.isArray(suppliers)) for (const s of suppliers) n += Number(s && s.servings) || 0;
  return n;
}

export function inTransitServings(suppliers, dishId) {
  let n = 0;
  if (Array.isArray(suppliers)) {
    for (const s of suppliers) if (s && s.dishId === dishId) n += Number(s.servings) || 0;
  }
  return n;
}

/**
 * 顯示用的「單位成本」推估值：以 baseCost 為底，隨材料等級與份量線性放大。
 * 公式：baseCost × (0.75 + 材料等級/200) × (0.8 + 份量/250)
 *   材料等級 50 / 份量 55 → 約 1.01 倍，100/100 → 約 1.68 倍。
 * 實際扣款仍由 reducer（sim/economy）決定，這裡僅供玩家比較。
 */
export function unitCostOf(dish, entry) {
  const base = Number(dish && dish.baseCost) || 0;
  const grade = clamp(entry && entry.grade !== undefined ? entry.grade : (dish ? dish.gradeDefault : 50), 0, 100);
  const portion = clamp(entry && entry.portion !== undefined ? entry.portion : (dish ? dish.portionDefault : 55), 0, 100);
  return Math.max(1, Math.round(base * (0.75 + grade / 200) * (0.8 + portion / 250)));
}

/** 叫貨總價推估 = 單位成本 × 份數 × 事件／季節價格倍率 */
export function orderCostOf(dish, entry, servings, supplierPriceMul) {
  const mul = Number(supplierPriceMul) > 0 ? Number(supplierPriceMul) : 1;
  return Math.max(0, Math.round(unitCostOf(dish, entry) * Math.max(0, servings) * mul));
}

export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function pad2(n) { return String(n).padStart(2, '0'); }

/** 遊戲分鐘（0..1439）→ 'HH:MM'，支援跨日 */
export function clockOf(minute) {
  const total = Math.round(Number(minute) || 0);
  const day = Math.floor(total / MINUTES_PER_DAY);
  const m = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const label = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  return day > 0 ? `${label} +${day}日` : label;
}

function dishById(id) {
  for (const d of DISHES || []) if (d && d.id === id) return d;
  return undefined;
}

function sortDishes(list) {
  const catRank = (d) => Object.keys(CATEGORY_LABEL).indexOf(d && d.category);
  return [...(list || [])].sort((a, b) => {
    const ca = catRank(a), cb = catRank(b);
    if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'zh-Hant');
  });
}

function warnBox(...children) {
  return h('div', {
    class: 'hintbox',
    style: { color: 'var(--bad)', background: '#f4e0dc' }
  }, ...children);
}

function redText(text) {
  return h('span', { style: { color: 'var(--bad)', fontWeight: 'bold' } }, text);
}

/** 就地更新 numberField，避免每次 refresh 打斷玩家輸入（回傳值可安全忽略） */
function syncField(field, v) {
  try { if (String(field.get()) !== String(v)) field.set(v); } catch { /* 忽略 */ }
}

/** 沿用舊列（保留輸入焦點）的鍵值清單 */
function keyedList(host, data, keyOf, make) {
  if (!host._nodes) host._nodes = new Map();
  const cache = host._nodes;
  const seen = new Set();
  data.forEach((item, i) => {
    const k = String(keyOf(item, i));
    seen.add(k);
    let node = cache.get(k);
    if (!node) { node = make(item); cache.set(k, node); }
    const at = host.children[i];
    if (at !== node) host.insertBefore(node, at || null);
  });
  for (const [k, node] of [...cache]) {
    if (seen.has(k)) continue;
    cache.delete(k);
    if (node.parentNode === host) host.removeChild(node);
  }
  return cache;
}

function timeField(value, onChange) {
  const input = h('input', { type: 'text', value: clockOf(value), style: { width: '54px', textAlign: 'center' } });
  const read = () => {
    const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(input.value).trim());
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
    return hh * 60 + mm;
  };
  const commit = () => {
    const v = read();
    if (v === null) { input.value = clockOf(value); return; }
    onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { commit(); input.blur(); } });
  return {
    el: input,
    input,
    set(v) { if (document.activeElement !== input) input.value = clockOf(v); }
  };
}

function refreshAll(handlers) {
  return function refresh(state) {
    for (const fn of handlers) {
      try { fn(state); } catch (err) { console.error('[menu] refresh 子項失敗', err); }
    }
  };
}

/* ------------------------------------------------------------------ 面板 */

export function createMenuPanel({ store, ui }) {
  const dispatch = (action) => {
    let res;
    try { res = store.dispatch(action); } catch (err) { res = { ok: false, error: String(err && err.message ? err.message : err) }; }
    if (!res || res.ok !== true) ui.toast((res && res.error) || '操作失敗', 'bad');
    return res;
  };

  /* ---- 狀態列（現金 / 上架數 / 庫存總量） ------------------------------ */
  const cashValue = h('span', { class: 'v' }, money(0));
  const activeValue = h('span', { class: 'v' }, '0 / 8');
  const stockValue = h('span', { class: 'v' }, '0 份');
  const infoRegion = h('div', { class: 'row wrap', style: { gap: '10px' } },
    statRow('現金', cashValue),
    statRow('架上料理', activeValue),
    statRow('總庫存（含在途）', stockValue));

  /* ---------------------------------------------------------- 菜單分頁 */
  const capLabel = h('span', { class: 'v' }, '已上架 0 / 上限 8');
  const pickerToggle = button('新增料理', () => { pickerOpen = !pickerOpen; pickerRegion.style.display = pickerOpen ? '' : 'none'; if (store.getState) refreshPicker(store.getState()); }, { kind: 'primary', small: true });
  const menuToolbar = toolbar(
    h('span', { class: 'hintbox', style: { padding: '2px 6px' } }, h('span', { class: 'stars' }, '★'), ' 上架上限：', capLabel),
    pickerToggle);

  let pickerOpen = false;
  const pickerHead = h('div', { class: 'muted', style: { padding: '3px 4px' } }, '');
  const pickerBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '210px', overflow: 'auto' } });
  const pickerRegion = h('div', { class: 'section', style: { display: 'none' } }, pickerHead, pickerBody);
  const warnRegion = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });

  const menuColumns = [
    { key: 'name', label: '料理名稱', width: '126px' },
    { key: 'price', label: '售價', width: '64px', align: 'num' },
    { key: 'grade', label: '材料等級', width: '56px', align: 'num' },
    { key: 'taste', label: '味道濃淡', width: '56px', align: 'num' },
    { key: 'portion', label: '份量', width: '54px', align: 'num' },
    { key: 'cookTime', label: '調理時間', width: '60px', align: 'num' },
    { key: 'cost', label: '單位成本', width: '60px', align: 'num' },
    { key: 'stock', label: '庫存', width: '92px' },
    { key: 'soldCell', label: '今日售出', width: '78px', align: 'num' },
    { key: 'status', label: '狀態', width: '116px' }
  ];
  const formulaHint = h('div', { class: 'muted' },
    '單位成本為顯示推估值：基準成本 × (0.75 + 材料等級/200) × (0.8 + 份量/250)；實際扣款以結算為準。');
  const menuTable = table({
    columns: menuColumns,
    rows: [],
    empty: '目前沒有上架任何料理。點「新增料理」挑一道招牌菜吧！',
    rowClass: (row) => [row.active ? '' : 'inactive', row.totalStock <= 0 ? 'out-of-stock' : ''].filter(Boolean).join(' ')
  });
  menuTable.table.classList.add('menu-table');
  const menuTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    menuToolbar, pickerRegion, warnRegion, menuTable.el, formulaHint);

  /* ---------------------------------------------------------- 進貨分頁 */
  const restockTarget = numberField({ label: '全部補到', value: 30, min: 1, max: 999, suffix: '份', width: 58 });
  const restockBtn = button('全部補到 N 份', () => {
    const n = clamp(restockTarget.get(), 1, 999);
    const st = store.getState ? store.getState() : null;
    if (!st) return;
    let cash = Number(st.cash) || 0;
    const mul = Number(st.sim && st.sim.supplierPriceMul) || 1;
    let ordered = 0;
    let orderedCash = 0;
    for (const entry of (st.menu || [])) {
      if (!entry || !entry.active) continue;
      const have = (Number(st.stock && st.stock[entry.dishId]) || 0)
        + (Number(st.store && st.store[entry.dishId]) || 0)
        + inTransitServings(st.suppliers, entry.dishId);
      const need = n - have;
      if (need <= 0) continue;
      const dish = dishById(entry.dishId);
      const cost = orderCostOf(dish, entry, need, mul);
      if (cost > cash) break;             // 現金不足就停手（reducer 仍會把關）
      const res = dispatch({ type: 'BUY_STOCK', dishId: entry.dishId, servings: need });
      if (!res || res.ok !== true) break;
      cash -= cost;
      ordered += need;
      orderedCash += cost;
    }
    if (ordered > 0) ui.toast(`已叫貨 ${ordered} 份，共 ${money(orderedCash)}，${DELIVERY_MIN} 分鐘後到貨。`, 'good');
    else ui.toast('沒有需要補貨的料理，或現金不足。', 'warn');
  }, { small: true });

  const transitCount = h('span', { class: 'v' }, '0 筆');
  const transitList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
  const stockHint = hintbox(`叫貨後 ${DELIVERY_MIN} 遊戲分鐘（外送）送達，會自動進入倉庫／庫存。生鮮類隔日折損 10%，飲料與酒類不折損。`);
  const stockRowsHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  const stockTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    toolbar(restockBtn, restockTarget.el,
      h('span', { class: 'muted' }, '（現金不足會自動停手；每筆仍由系統驗證）')),
    stockHint,
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, '各料理庫存與叫貨'), stockRowsHost),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, '在途進貨'),
      statRow('在途筆數', transitCount), transitList));

  /* ------------------------------------------------------ 食譜資料分頁 */
  const recipeTitle = h('span', { class: 'right' }, '');
  const recipeTable = table({
    columns: [
      { key: 'name', label: '名稱', width: '128px' },
      { key: 'cat', label: '分類', width: '52px' },
      { key: 'baseCost', label: '基準成本', width: '62px', align: 'num' },
      { key: 'expectedPrice', label: '合理價', width: '62px', align: 'num' },
      { key: 'tags', label: '標籤' },
      { key: 'cookTimeDefault', label: '預設調理', width: '62px', align: 'num' }
    ],
    rows: [],
    empty: '這個星級還沒有可用的食譜。'
  });
  const recipeTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    h('div', { class: 'section-head' }, '食譜資料（唯讀參考）', recipeTitle),
    hintbox('規劃用參考表：目前星級可用的所有料理。基準成本是最低材料費，售價拉到成本 10 倍是原作的常見玩法，但價格超過顧客期待價的 4 倍會被嫌貴。'),
    recipeTable.el);

  /* --------------------------------------------------------------- 分頁 */
  const tabsNode = tabs([
    { id: 'menu', label: '菜單', render: () => menuTab },
    { id: 'stock', label: '進貨', render: () => stockTab },
    { id: 'recipe', label: '食譜資料', render: () => recipeTab }
  ]);

  const root = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', minHeight: '0', flex: '1' } },
    infoRegion, tabsNode.el);

  /* ------------------------------------------------------- 各分頁更新 */
  function refreshInfo(state) {
    cashValue.textContent = money(state.cash);
    const entries = state.menu || [];
    const active = entries.filter((e) => e && e.active).length;
    const cap = menuCapForStars(state.stars);
    capLabel.textContent = `已上架 ${active} / 上限 ${cap}`;
    activeValue.textContent = `${entries.length} / ${cap}`;
    activeValue.parentNode.className = `stat-row${entries.length >= cap ? ' warn' : ''}`;
    stockValue.textContent = `${totalStockUnits(state.stock, state.store, state.suppliers)} 份`;
    pickerToggle.disabled = entries.length >= cap;
    pickerToggle.title = pickerToggle.disabled ? '已達上架上限，先移除幾道菜' : '從食譜中挑一道菜上架';
  }

  function buildMenuRow(entry) {
    const dish = dishById(entry.dishId) || { id: entry.dishId, name: entry.dishId, category: 'staple', baseCost: 0 };
    const price = numberField({ value: entry.price, min: 0, max: 9999, step: 5, suffix: '元', width: 56, onChange: (v) => dispatch({ type: 'MENU_UPDATE', dishId: entry.dishId, patch: { price: v } }) });
    const grade = numberField({ value: entry.grade, min: 0, max: 100, step: 5, width: 48, onChange: (v) => dispatch({ type: 'MENU_UPDATE', dishId: entry.dishId, patch: { grade: v } }) });
    const taste = numberField({ value: entry.taste, min: 0, max: 100, step: 5, width: 48, onChange: (v) => dispatch({ type: 'MENU_UPDATE', dishId: entry.dishId, patch: { taste: v } }) });
    const portion = numberField({ value: entry.portion, min: 0, max: 100, step: 5, width: 48, onChange: (v) => dispatch({ type: 'MENU_UPDATE', dishId: entry.dishId, patch: { portion: v } }) });
    const cook = numberField({ value: entry.cookTime, min: 1, max: 60, step: 1, suffix: '分', width: 44, onChange: (v) => dispatch({ type: 'MENU_UPDATE', dishId: entry.dishId, patch: { cookTime: v } }) });
    const nameCell = h('span', null,
      h('div', { class: 'dish-name' }, dish.name || entry.dishId),
      h('div', { class: 'dish-cat' }, CATEGORY_LABEL[dish.category] || dish.category || '—'));
    const costCell = h('span', { class: 'num' }, money(0));
    const stockLine1 = h('div', null, '架上 0 份');
    const stockLine2 = h('div', { class: 'muted' }, '倉庫 0・在途 0');
    const stockCell = h('span', null, stockLine1, stockLine2);
    const soldLine1 = h('div', null, '0 份');
    const soldLine2 = h('div', { class: 'muted' }, money(0));
    const soldCell = h('span', { class: 'num' }, soldLine1, soldLine2);
    const tagSlot = h('span', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap' } });
    const toggleBtn = button(entry.active ? '停售' : '開賣', () => dispatch({ type: 'MENU_TOGGLE', dishId: entry.dishId }), { small: true, kind: entry.active ? 'ghost' : 'primary' });
    const removeBtn = button('移除', async () => {
      const ok = await ui.confirm({
        title: '移除料理',
        message: `確定要把「${dish.name || entry.dishId}」從菜單移除嗎？\n已經進貨的份數仍留在倉庫，不會退款。`,
        okLabel: '移除', cancelLabel: '取消'
      });
      if (ok) dispatch({ type: 'MENU_REMOVE', dishId: entry.dishId });
    }, { small: true, kind: 'danger' });
    const statusCell = h('span', { style: { display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' } },
      toggleBtn, removeBtn, tagSlot);
    return {
      dishId: entry.dishId, active: entry.active, totalStock: 1,
      name: nameCell, price: price.el, grade: grade.el, taste: taste.el,
      portion: portion.el, cookTime: cook.el,
      cost: costCell, stock: stockCell, soldCell, status: statusCell,
      _fields: { price, grade, taste, portion, cookTime: cook },
      _entry: entry, _dish: dish, _tagSlot: tagSlot,
      _stockLine1: stockLine1, _stockLine2: stockLine2,
      _soldLine1: soldLine1, _soldLine2: soldLine2
    };
  }

  const menuRowCache = new Map();
  function buildMenuRowCached(entry) {
    const sig = `${entry.active ? 1 : 0}`;
    let row = menuRowCache.get(entry.dishId);
    if (!row || row._sig !== sig) {
      row = buildMenuRow(entry);
      row._sig = sig;
      menuRowCache.set(entry.dishId, row);
    }
    return row;
  }

  function refreshMenu(state) {
    const entries = state.menu || [];
    const live = new Set(entries.map((e) => e.dishId));
    for (const key of [...menuRowCache.keys()]) if (!live.has(key)) menuRowCache.delete(key);

    const rows = entries.map((entry) => {
      const row = buildMenuRowCached(entry);
      const dish = row._dish;
      const stock = Number(state.stock && state.stock[entry.dishId]) || 0;
      const storeN = Number(state.store && state.store[entry.dishId]) || 0;
      const transit = inTransitServings(state.suppliers, entry.dishId);
      const total = stock + storeN + transit;
      row.totalStock = total;
      row._entry = entry;

      const f = row._fields;
      syncField(f.price, entry.price); f.price.input.style.width = '56px';
      syncField(f.grade, entry.grade); f.grade.input.style.width = '48px';
      syncField(f.taste, entry.taste); f.taste.input.style.width = '48px';
      syncField(f.portion, entry.portion); f.portion.input.style.width = '48px';
      syncField(f.cookTime, entry.cookTime); f.cookTime.input.style.width = '44px';

      const cost = unitCostOf(dish, entry);
      const price = Number(entry.price) || 0;
      row.cost.textContent = money(cost);
      row.cost.title = `單位成本推估 ${money(cost)}；每份毛利 ${money(price - cost)}`;

      row._stockLine1.textContent = `架上 ${stock} 份`;
      row._stockLine2.textContent = `倉庫 ${storeN}・在途 ${transit}`;

      clear(row._tagSlot);
      if (!entry.active) row._tagSlot.appendChild(tag('已停售', 'plain'));
      if (total <= 0) row._tagSlot.appendChild(tag('賣完', 'bad'));
      else if (total < 10) row._tagSlot.appendChild(tag('庫存偏低', 'warn'));
      if (Number(entry.cookTime) < 8) row._tagSlot.appendChild(tag('上菜過快', 'warn'));

      const sold = Number(entry.sold) || 0;
      row._soldLine1.textContent = `${sold} 份`;
      row._soldLine2.textContent = money(sold * price);
      return row;
    });

    menuTable.setRows(rows);
    refreshWarnings(state, entries);
  }

  function refreshWarnings(state, entries) {
    clear(warnRegion);
    const active = entries.filter((e) => e && e.active);
    if (!active.length) return;
    const tooFast = active.filter((e) => Number(e.cookTime) < 8);
    const losing = active.filter((e) => (Number(e.price) || 0) < 2 * unitCostOf(dishById(e.dishId), e));
    const overpriced = active.filter((e) => {
      const exp = Number((dishById(e.dishId) || {}).expectedPrice) || 0;
      return exp > 0 && (Number(e.price) || 0) > 4 * exp;
    });
    if (tooFast.length) {
      warnRegion.appendChild(warnBox(
        redText('⚠ 顧客期待警告：'),
        `有 ${tooFast.length} 道菜的調理時間低於 8 分鐘（${tooFast.map((e) => (dishById(e.dishId) || {}).name || e.dishId).join('、')}）。`,
        '原作設定：便宜又三分鐘上菜，客人會認為是微波食品，評價暴跌。建議 20–40 分鐘。'));
    }
    if (losing.length) {
      warnRegion.appendChild(warnBox(
        redText('⚠ 賠錢菜單：'),
        `有 ${losing.length} 道菜的售價不到單位成本的 2 倍（${losing.map((e) => (dishById(e.dishId) || {}).name || e.dishId).join('、')}），現在賣一份賠一份。`));
    }
    if (overpriced.length) {
      warnRegion.appendChild(warnBox(
        redText('⚠ 定價過高：'),
        `有 ${overpriced.length} 道菜的售價超過顧客合理價的 4 倍（${overpriced.map((e) => (dishById(e.dishId) || {}).name || e.dishId).join('、')}），客人會嫌貴、評價下滑。`));
    }
    const outOfStock = active.filter((e) => {
      const total = (Number(state.stock && state.stock[e.dishId]) || 0)
        + (Number(state.store && state.store[e.dishId]) || 0)
        + inTransitServings(state.suppliers, e.dishId);
      return total <= 0;
    });
    if (outOfStock.length) {
      warnRegion.appendChild(warnBox(
        redText('⚠ 缺貨：'),
        `${outOfStock.map((e) => (dishById(e.dishId) || {}).name || e.dishId).join('、')} 已賣完，客人點不到餐會重扣評價。請切到「進貨」分頁叫貨。`));
    }
  }

  let pickerKey = '';
  function refreshPicker(state) {
    if (!pickerOpen) return;
    const entries = state.menu || [];
    const onMenu = new Set(entries.map((e) => e.dishId));
    const cap = menuCapForStars(state.stars);
    const list = sortDishes(dishesForStars(Number(state.stars) || 1)).filter((d) => d && !onMenu.has(d.id));
    const key = `${state.stars}|${list.length}|${onMenu.size}|${entries.map((e) => e.dishId).join(',')}`;
    if (key === pickerKey) return;
    pickerKey = key;

    clear(pickerBody);
    pickerHead.textContent = `可上架料理（${Number(state.stars) || 1}★ 開放 ${sortDishes(dishesForStars(Number(state.stars) || 1)).length} 道，已上架 ${entries.length} / 上限 ${cap}）`;
    if (!list.length) {
      pickerBody.appendChild(emptyState(entries.length >= cap
        ? '已達上架上限。想換菜單請先移除幾道料理。'
        : '這個星級能開的菜都已經上架了，升級星級可解鎖更多料理。'));
      return;
    }
    let lastCat = null;
    let group = null;
    for (const dish of list) {
      if (dish.category !== lastCat) {
        lastCat = dish.category;
        group = section({ title: `${CATEGORY_LABEL[dish.category] || dish.category}（${list.filter((d) => d.category === dish.category).length} 道）`, collapsible: true, children: [] });
        pickerBody.appendChild(group.el);
      }
      const canAdd = entries.length < cap;
      const item = card(
        h('div', { class: 'card-title' }, dish.name,
          h('span', { class: 'tagline' }, `${money(dish.baseCost)}・合理價 ${money(dish.expectedPrice)}`)),
        h('div', { class: 'muted', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('span', null, `預設調理 ${dish.cookTimeDefault} 分`),
          h('span', null, `解鎖 ${dish.unlockStars}★`),
          h('span', null, (dish.tags || []).slice(0, 4).map((t) => TAG_LABEL[t] || t).join('/') || '—')),
        h('div', { class: 'muted' }, dish.desc || ''),
        h('div', { class: 'row' },
          button('上架', () => {
            const res = dispatch({ type: 'MENU_ADD', dishId: dish.id });
            if (res && res.ok) ui.toast(`已上架「${dish.name}」，記得去「進貨」叫貨。`, 'good');
          }, { small: true, kind: 'primary', disabled: !canAdd, title: canAdd ? '' : '已達上架上限' }))
      );
      group.body.appendChild(item);
    }
    if (entries.length >= cap) pickerBody.appendChild(warnBox(redText('已達上架上限：'), '需要先移除其他料理才能再上架。'));
  }

  function refreshStock(state) {
    const entries = (state.menu || []).filter((e) => e && e.active);
    const mul = Number(state.sim && state.sim.supplierPriceMul) || 1;
    const cash = Number(state.cash) || 0;
    clear(stockRowsHost);
    if (!entries.length) {
      stockRowsHost.appendChild(emptyState('沒有上架的料理，先到「菜單」分頁上架幾道菜再來叫貨。'));
    } else {
      for (const entry of entries) {
        const dish = dishById(entry.dishId) || { name: entry.dishId };
        const onHand = Number(state.stock && state.stock[entry.dishId]) || 0;
        const storeN = Number(state.store && state.store[entry.dishId]) || 0;
        const transit = inTransitServings(state.suppliers, entry.dishId);
        const lots = ORDER_LOTS.map((n) => {
          const cost = orderCostOf(dish, entry, n, mul);
          const btn = button(`+${n} 份`, () => {
            const res = dispatch({ type: 'BUY_STOCK', dishId: entry.dishId, servings: n });
            if (res && res.ok) ui.toast(`叫貨 ${dish.name} ${n} 份（約 ${money(cost)}），${DELIVERY_MIN} 分鐘後到貨。`, 'good');
          }, { small: true, disabled: cash < cost, title: cash < cost ? '現金不足' : `約 ${money(cost)}` });
          return h('span', { class: 'row', style: { gap: '3px' } }, btn, h('span', { class: 'muted' }, money(cost)));
        });
        stockRowsHost.appendChild(h('div', {
          style: {
            display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
            padding: '3px 5px', background: onHand + storeN + transit <= 0 ? '#f6e0dd' : 'var(--face-light)'
          }
        },
          h('span', { style: { minWidth: '104px', fontWeight: 'bold' } }, dish.name || entry.dishId),
          h('span', { class: 'muted' }, `架上 ${onHand}・倉庫 ${storeN}・在途 ${transit} 份`),
          h('span', { class: 'spacer' }),
          ...lots));
      }
    }

    clear(transitList);
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    transitCount.textContent = `${suppliers.length} 筆`;
    if (!suppliers.length) {
      transitList.appendChild(h('div', { class: 'muted' }, '目前沒有在途進貨。'));
    } else {
      const now = Number(state.minute) || 0;
      for (const s of suppliers) {
        const dish = dishById(s && s.dishId) || {};
        const eta = Number(s && s.arriveMinute) || 0;
        const remain = Math.max(0, eta - now);
        transitList.appendChild(h('div', { class: 'row', style: { gap: '8px' } },
          h('span', { style: { minWidth: '104px' } }, dish.name || (s && s.dishId) || '—'),
          h('span', null, `${Number(s && s.servings) || 0} 份`),
          h('span', { class: 'muted' }, `預計 ${clockOf(eta)} 到貨（剩 ${remain} 分）`)));
      }
    }
  }

  let recipeKey = '';
  function refreshRecipe(state) {
    const s = Number(state.stars) || 1;
    const list = sortDishes(dishesForStars(s));
    const key = `${s}|${list.length}`;
    if (key === recipeKey) return;
    recipeKey = key;
    recipeTitle.textContent = `${s}★ 可用 ${list.length} 道`;
    recipeTable.setRows(list.map((d) => ({
      name: d.name,
      cat: CATEGORY_LABEL[d.category] || d.category,
      baseCost: money(d.baseCost),
      expectedPrice: money(d.expectedPrice),
      tags: (d.tags || []).map((t) => TAG_LABEL[t] || t).join('、') || '—',
      cookTimeDefault: `${d.cookTimeDefault} 分`
    })));
  }

  /* --------------------------------------------------------------- 對外 */
  return {
    id: 'menu',
    title: '菜單編輯',
    icon: '🍜',
    width: 620,
    height: 470,
    el: root,
    open() {
      try { refreshPicker(store.getState ? store.getState() : null); } catch (err) { console.error('[menu] open 失敗', err); }
    },
    close() {},
    refresh: refreshAll([
      (s) => { if (s) refreshInfo(s); },
      (s) => { if (s) refreshMenu(s); },
      (s) => { if (s) refreshPicker(s); },
      (s) => { if (s) refreshStock(s); },
      (s) => { if (s) refreshRecipe(s); }
    ])
  };
}
