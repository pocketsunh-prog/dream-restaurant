// ============================================================================
// panels/build.js — 裝潢與設備面板
//   panel id : 'build'  標題 : 裝潢與設備  🔨  660 x 500
//   分頁     : 傢俱 / 設備 / 清潔與維修 / 地點
//   dispatches（僅使用 docs/ARCHITECTURE.md §4 表上的 action）：
//     PLACE_FURNITURE  { typeId, x, y, rot }   ← 自動安裝會帶 x:-1, y:-1（代表由系統找位）
//     REMOVE_FURNITURE { uid }
//     REPAIR           { uid }  或  { target:'stove' | 'ac' | 'fridge' }
//     CLEAN            { target:'floor' | 'restroom' }
//     MOVE_LOCATION    { locationId }
//   RESTAURANT-FLOOR CLICK HANDLING BELONGS TO src/main.js（主迴圈擁有 canvas 點擊：
//   它會讀取 panel.getPending() / panel.getPendingMove()，自行決定 x/y/rot 之後才 dispatch
//   PLACE_FURNITURE / MOVE_FURNITURE）。本面板只負責「待擺放狀態」，不自行猜座標。
//   本面板不直接修改 state，也不 import 任何 CSS。
// ============================================================================
import { FURNITURE, LOCATIONS } from '../../data/index.js';
import {
  bar, button, card, clear, emptyState, h, hintbox, money, numberField, select,
  statRow, stars as starRow, table, tabs, tag, toolbar
} from '../widgets.js';

/* ------------------------------------------------------------------ 常數 */

const PLACE_CATEGORIES = ['table', 'counter', 'decor', 'restroom', 'kitchen'];  // 椅子改隨桌子自動配
const CATEGORY_LABEL = {
  table: '桌子', chair: '椅子', counter: '櫃台', decor: '裝潢', equipment: '設備',
  restroom: '廁所', kitchen: '廚房'
};
/** 清潔費用（元）：與 reducer 的 B.CLEAN_*_COST 對齊（無常數匯出時僅作顯示） */
const CLEAN_COST = { floor: 800, restroom: 1200 };
/** 搬遷押金：reducer 用 loc.rentPerDay × 3 */
const MOVE_DEPOSIT_DAYS = 3;

/** 搬遷總費用（與 reducer 同步：搬遷費 + 3 天租金押金） */
export function moveCostOf(loc) {
  if (!loc) return 0;
  return Math.round((Number(loc.moveCost) || 0) + (Number(loc.rentPerDay) || 0) * MOVE_DEPOSIT_DAYS);
}

/** 單件傢俱維修費推估（與 reducer 同步） */
export function repairCostOf(def, durability) {
  const damage = 100 - (Number(durability) || 0);
  return Math.max(200, Math.round((Number(def && def.price) || 1000) * 0.25 * (damage / 100) + 150));
}

/** 固定設施維修費（與 reducer 同步） */
export const SYSTEM_REPAIR_COST = { ac: 12000, stove: 9000, fridge: 7000 };

/* ------------------------------------------------------------------ 工具 */

function furnitureById(id) {
  for (const f of FURNITURE || []) if (f && f.id === id) return f;
  return undefined;
}

export function placementCatalog() {
  return (FURNITURE || []).filter((f) => f && PLACE_CATEGORIES.includes(f.category));
}

function equipmentCatalog() {
  return (FURNITURE || []).filter((f) => f && f.category === 'equipment');
}

/**
 * 目前裝潢總分。刻意與 src/sim/build.js 的 decorScore() 同算法
 * （風格相符 ×1.35、不符 ×0.8、plain ×1，再乘耐久耗損 0.6~1.0），
 * 讓面板顯示的數字與雜誌評分、搬遷退款一致。
 */
export function decorScoreOf(items, decorStyle) {
  let total = 0;
  for (const it of items || []) {
    const def = furnitureById(it && it.typeId);
    if (!def) continue;
    let mul = 1;
    if (decorStyle && def.style) {
      if (def.style === decorStyle) mul = 1.35;
      else if (def.style !== 'plain') mul = 0.8;
    }
    const wear = it.durability === undefined ? 1 : 0.6 + 0.4 * (Math.max(0, Number(it.durability) || 0) / 100);
    total += (Number(def.decorScore) || 0) * mul * wear;
  }
  return Math.round(total);
}

/** 店內傢俱原價總值（搬遷退款 = 此值 × 30%，與 reducer 的 layoutValue 同算法） */
export function layoutValueOf(items) {
  let v = 0;
  for (const it of items || []) {
    const def = furnitureById(it && it.typeId);
    v += Number(def && def.price) || 0;
  }
  return v;
}

/** 可用座位數（椅子本身 seats 為 0，桌子帶 seats；以桌子為準並去除損壞品） */
export function seatCountOf(items) {
  let n = 0;
  for (const it of items || []) {
    if (it && it.broken) continue;
    const def = furnitureById(it && it.typeId);
    if (def && Number(def.seats) > 0) n += Number(def.seats) || 0;
  }
  return n;
}

export function dirtColor(v) {
  const n = Number(v) || 0;
  if (n > 60) return 'var(--bad)';
  if (n > 30) return 'var(--warn)';
  return 'var(--ok)';
}

function durColor(v) {
  const n = Number(v) || 0;
  if (n < 30) return 'var(--bad)';
  if (n < 60) return 'var(--warn)';
  return 'var(--ok)';
}

function warnBox(...children) {
  return h('div', { class: 'hintbox', style: { color: 'var(--bad)', background: '#f4e0dc' } }, ...children);
}

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

function refreshAll(handlers, name) {
  return function refresh(state) {
    for (const fn of handlers) {
      try { fn(state); } catch (err) { console.error(`[${name}] refresh 子項失敗`, err); }
    }
  };
}

/* ------------------------------------------------------------------ 面板 */

export function createBuildPanel({ store, ui }) {
  const dispatch = (action) => {
    let res;
    try { res = store.dispatch(action); } catch (err) { res = { ok: false, error: String(err && err.message ? err.message : err) }; }
    if (!res || res.ok !== true) ui.toast((res && res.error) || '操作失敗', 'bad');
    return res;
  };
  const state = () => (store.getState ? store.getState() : null);

  // 待擺放／待移動狀態：由 main.js 的 canvas 點擊處理讀取
  const pending = { mode: null, typeId: null, rot: 0, uid: null };

  /* ------------------------------------------------------------ 摘要列 */
  const cashValue = h('span', { class: 'v' }, money(0));
  const decorValue = h('span', { class: 'v' }, '0 分');
  const seatValue = h('span', { class: 'v' }, '0 席');
  const locationValue = h('span', { class: 'v' }, '—');
  const summary = h('div', { class: 'row wrap', style: { gap: '10px' } },
    statRow('現金', cashValue),
    statRow('裝潢總分', decorValue),
    statRow('可用座位', seatValue),
    statRow('地點', locationValue));
  const pendingBanner = h('div', { style: { display: 'none' } },
    h('div', { class: 'hintbox', style: { color: 'var(--bad)', background: '#f4e0dc' } },
      h('b', null, '擺放模式：'), h('span', null, '')));

  /* ---------------------------------------------------------- 傢俱分頁 */
  const catFilter = select({
    label: '分類',
    value: 'all',
    options: [{ value: 'all', label: '全部' }].concat(PLACE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })))
  });
  const paletteHost = h('div', { class: 'build-palette' });
  const cancelPlaceBtn = button('取消擺放', () => {
    pending.mode = null; pending.typeId = null; pending.rot = 0; pending.uid = null;
    ui.toast('已取消擺放。', 'info');
    const st = state(); if (st) refreshPending(st);
  }, { small: true, kind: 'ghost' });
  const placeHint = hintbox('點一項傢俱 → 再到餐廳平面圖上點擊擺放位置。合法位置由系統驗證（桌椅相鄰、動線可通、不擋出餐口），擺不下時會出現紅框並拒絕。');
  const styleNote = h('div', { class: 'muted' }, '');
  const furnitureToolbar = toolbar(catFilter.el, cancelPlaceBtn);
  const placedHead = h('span', { class: 'right' }, '');
  const placedHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  const furnitureTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    furnitureToolbar, placeHint, styleNote, paletteHost,
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '店內現有傢俱與設備', placedHead),
      placedHost));

  /* ---------------------------------------------------------- 設備分頁 */
  const equipHost = h('div', { class: 'grid2' });
  const ownedEquipHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  const equipBrokenHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  const stoveTag = tag('爐具正常', 'ok');
  const acTag = tag('冷氣正常', 'ok');
  const fridgeTag = tag('冰箱正常', 'ok');
  const equipBrokenBtns = {
    stove: button('修爐具', () => repairSystem('stove'), { small: true, kind: 'primary' }),
    ac: button('修冷氣', () => repairSystem('ac'), { small: true, kind: 'primary' }),
    fridge: button('修冰箱', () => repairSystem('fridge'), { small: true, kind: 'primary' })
  };
  const equipTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    hintbox('設備買了會立刻由系統找位置安裝（「自動安裝」＝以座標 x:-1, y:-1 交給系統安排）。監視器、紅外線、滅火器、保全主機可大幅降低竊盜與意外的損失。'),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '可購買設備'),
      equipHost),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '已安裝設備', h('span', { class: 'right' }, '維修可恢復耐久度')),
      ownedEquipHost),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '固定設施狀態（爐具／冷氣／冰箱）',
        h('span', { class: 'right' }, `維修費 爐具 ${money(SYSTEM_REPAIR_COST.stove)}／冷氣 ${money(SYSTEM_REPAIR_COST.ac)}／冰箱 ${money(SYSTEM_REPAIR_COST.fridge)}`)),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        h('span', { class: 'row', style: { gap: '3px' } }, stoveTag, equipBrokenBtns.stove),
        h('span', { class: 'row', style: { gap: '3px' } }, acTag, equipBrokenBtns.ac),
        h('span', { class: 'row', style: { gap: '3px' } }, fridgeTag, equipBrokenBtns.fridge)),
      equipBrokenHost));

  /* ---------------------------------------------------- 清潔與維修分頁 */
  const floorBar = bar({ value: 0, max: 100, color: dirtColor, label: '地板髒污', format: (v) => `${Math.round(v)} / 100` });
  const restroomBar = bar({ value: 0, max: 100, color: dirtColor, label: '廁所髒污', format: (v) => `${Math.round(v)} / 100` });
  const floorCleanBtn = button(`清潔店內（${money(CLEAN_COST.floor)}）`, () => {
    const res = dispatch({ type: 'CLEAN', target: 'floor' });
    if (res && res.ok) ui.toast('店內清潔完成，地板亮晶晶。', 'good');
  }, { small: true, kind: 'primary' });
  const restroomCleanBtn = button(`清潔廁所（${money(CLEAN_COST.restroom)}）`, () => {
    const res = dispatch({ type: 'CLEAN', target: 'restroom' });
    if (res && res.ok) ui.toast('廁所清潔完成，客人不會再嫌臭了。', 'good');
  }, { small: true, kind: 'primary' });
  const dirtAdvice = h('div', { class: 'muted' }, '');
  const repairHead = h('span', { class: 'right' }, '');
  const repairHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  const repairAllBtn = button('一鍵維修全部（耐久度 < 60）', () => {
    const st = state();
    if (!st) return;
    const list = ((st.layout && st.layout.items) || []).filter((it) => (Number(it.durability) || 0) < 60);
    if (!list.length) { ui.toast('所有傢俱狀況良好，不需要維修。', 'info'); return; }
    let ok = 0;
    for (const it of list) {
      const res = dispatch({ type: 'REPAIR', uid: it.uid });
      if (!res || res.ok !== true) break;    // 現金不足就停手
      ok += 1;
    }
    if (ok) ui.toast(`已修好 ${ok} 件傢俱／設備。`, 'good');
  }, { small: true, kind: 'primary' });
  const cleanTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    hintbox('清潔度直接扣顧客心情：廁所髒污 > 60、地板 > 70 就會持續扣分（原作數據）。平日可指派服務生定時打掃，臨時救火才用這裡的花錢清潔。'),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '環境清潔度'),
      floorBar.el, restroomBar.el,
      h('div', { class: 'row wrap', style: { gap: '6px' } }, floorCleanBtn, restroomCleanBtn),
      dirtAdvice),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' }, '待維修傢俱與設備（耐久度 < 60）', repairHead),
      h('div', { class: 'row' }, repairAllBtn),
      repairHost));

  /* ---------------------------------------------------------- 地點分頁 */
  const locationTable = table({
    columns: [
      { key: 'name', label: '名稱', width: '128px' },
      { key: 'city', label: '城市', width: '48px' },
      { key: 'need', label: '星級', width: '58px', align: 'mid' },
      { key: 'rent', label: '日租金', width: '72px', align: 'num' },
      { key: 'traffic', label: '基礎客流', width: '60px', align: 'num' },
      { key: 'mix', label: '顧客組成', width: '150px' },
      { key: 'prefs', label: '口味偏好' },
      { key: 'size', label: '格局', width: '54px', align: 'mid' },
      { key: 'go', label: '搬遷', width: '70px', align: 'mid' }
    ],
    rows: [],
    empty: '沒有可搬遷的地點資料。'
  });
  const locationNote = h('div', { class: 'muted' }, '');
  const locationTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    hintbox('原作沒有分店，只能舉家搬遷。搬遷後格局與坪數不同、店內裝潢全部清空必須重排，而且區外評價會下滑，請先存檔。'),
    locationTable.el,
    locationNote);

  const tabsNode = tabs([
    { id: 'furniture', label: '傢俱', render: () => furnitureTab },
    { id: 'equipment', label: '設備', render: () => equipTab },
    { id: 'clean', label: '清潔與維修', render: () => cleanTab },
    { id: 'place', label: '地點', render: () => locationTab }
  ]);

  const root = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', minHeight: '0', flex: '1' } },
    summary, pendingBanner, tabsNode.el);

  /* ------------------------------------------------------------ 小工具 */
  function currentItems() {
    const st = state();
    return ((st && st.layout && st.layout.items) || []);
  }

  function currentStyle() {
    const st = state();
    const loc = (LOCATIONS || []).find((l) => l && l.id === (st && st.locationId));
    return loc ? loc.decorStyle : undefined;
  }

  /** 依 sim/build.js 同算法計算的裝潢總分 */
  function currentDecor() {
    return decorScoreOf(currentItems(), currentStyle());
  }

  function repairSystem(target) {
    const res = dispatch({ type: 'REPAIR', target });
    if (res && res.ok) ui.toast(`${target === 'stove' ? '爐具' : target === 'ac' ? '冷氣' : '冰箱'}已修復。`, 'good');
  }

  function setPending(mode, typeId, uid) {
    pending.mode = mode;
    pending.typeId = typeId || null;
    pending.uid = uid || null;
    pending.rot = 0;
    const st = state();
    if (st) refreshPending(st);
  }

  /* --------------------------------------------------------- 摘要／提示 */
  function refreshSummary(st) {
    const items = currentItems();
    cashValue.textContent = money(st.cash);
    decorValue.textContent = `${currentDecor()} 分`;
    seatValue.textContent = `${seatCountOf(items)} 席`;
    const loc = (LOCATIONS || []).find((l) => l && l.id === st.locationId) || {};
    locationValue.textContent = loc.name || st.locationId || '—';
  }

  function refreshPending(st) {
    void st;
    const box = pendingBanner.firstChild;
    const label = box.lastChild;
    if (!pending.mode) {
      pendingBanner.style.display = 'none';
      cancelPlaceBtn.disabled = true;
      return;
    }
    pendingBanner.style.display = '';
    cancelPlaceBtn.disabled = false;
    if (pending.mode === 'place') {
      const def = furnitureById(pending.typeId) || {};
      label.textContent = `「${def.name || pending.typeId}」待擺放（${def.w}×${def.h} 格，${money(def.price)}）。請在平面圖上點擊位置，Esc 或「取消擺放」可取消。`;
    } else {
      const it = currentItems().find((x) => x && x.uid === pending.uid);
      const def = furnitureById(it && it.typeId) || {};
      label.textContent = `「${def.name || (it && it.typeId) || '傢俱'}」待移動。請在平面圖上點擊新位置，「取消擺放」可取消。`;
    }
  }

  /* ------------------------------------------------------------ 傢俱頁 */
  let paletteCat = 'all';
  catFilter.input.addEventListener('change', () => {
    paletteCat = catFilter.input.value;
    const st = state();
    if (st) refreshPalette(st);
  });

  function renderPalette(st) {
    clear(paletteHost);
    const stars = Number(st.stars) || 1;
    const list = placementCatalog().filter((f) => paletteCat === 'all' || f.category === paletteCat);
    if (!list.length) {
      paletteHost.appendChild(emptyState('這個分類目前沒有可購買的傢俱。'));
      return;
    }
    const byCat = new Map();
    for (const f of list) {
      if (!byCat.has(f.category)) byCat.set(f.category, []);
      byCat.get(f.category).push(f);
    }
    for (const [cat, arr] of byCat) {
      paletteHost.appendChild(h('div', {
        class: 'muted',
        style: { gridColumn: '1 / -1', marginTop: '3px', fontWeight: 'bold' }
      }, `${CATEGORY_LABEL[cat] || cat}（${arr.length} 項）`));
      for (const f of arr) {
        const afford = (Number(st.cash) || 0) >= (Number(f.price) || 0);
        const item = card(
          h('div', { class: 'card-title' }, f.name),
          h('div', { class: 'price' }, money(f.price)),
          h('div', { class: 'stat' }, `佔地 ${f.w}×${f.h} 格`),
          h('div', { class: 'stat' }, `座位 ${Number(f.seats) || 0} 席・裝潢 ${Number(f.decorScore) || 0} 分`),
          h('div', { class: 'muted' }, f.desc || ''),
          h('div', { class: 'stat' }, `風格 ${f.style || '—'}${f.blocks ? '・會擋路' : ''}`));
        item.title = `${f.name}｜${money(f.price)}｜${f.desc || ''}`;
        item.classList.toggle('disabled', !afford);
        item.addEventListener('click', () => {
          setPending('place', f.id, null);
          ui.toast(afford
            ? '請在餐廳平面圖上點擊擺放位置'
            : `現金不足（需要 ${money(f.price)}），仍可先規劃位置`, afford ? 'info' : 'warn');
        });
        paletteHost.appendChild(item);
      }
    }
  }

  let paletteKey = '';
  function refreshPalette(st) {
    const loc = (LOCATIONS || []).find((l) => l && l.id === st.locationId);
    const style = (loc && loc.decorStyle) || '—';
    styleNote.textContent = `本店風格：${style}（${loc ? loc.name : st.locationId}）。風格相符的傢俱裝潢分數 ×1.35、不合 ×0.8，` +
      `耐久度下降也會讓分數打折；目前店內裝潢總分 ${currentDecor()} 分（${currentItems().length} 件）。`;
    const key = `${paletteCat}|${Number(st.cash) || 0}|${Number(st.stars) || 1}|${placementCatalog().length}|${style}`;
    if (key === paletteKey) return;
    paletteKey = key;
    renderPalette(st);
  }

  function refreshPlaced(st) {
    const items = currentItems();
    const byType = new Map();
    for (const it of items) byType.set(it.typeId, (byType.get(it.typeId) || 0) + 1);
    placedHead.textContent = `${items.length} 件・裝潢 ${currentDecor()} 分・座位 ${seatCountOf(items)} 席`;
    clear(placedHost);
    if (!items.length) {
      placedHost.appendChild(emptyState('店裡還沒有任何傢俱。點上方傢俱卡片，再到平面圖擺放桌子與椅子，客人才能入座。'));
      return;
    }
    const sorted = [...items].sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
    for (const it of sorted) {
      const def = furnitureById(it.typeId) || { name: it.typeId, seats: 0, decorScore: 0 };
      const dur = Number(it.durability) || 0;
      const dbar = bar({ value: dur, max: 100, color: durColor, label: '耐久', showValue: true, format: (v) => `${Math.round(v)}%` });
      const moveBtn = button('移動', () => {
        setPending('move', it.typeId, it.uid);
        ui.toast('請在餐廳平面圖上點擊新的位置', 'info');
      }, { small: true, kind: 'ghost' });
      const removeBtn = button('移除', async () => {
        const ok = await ui.confirm({
          title: '移除傢俱',
          message: `確定要移除「${def.name}」嗎？\n擺放時付了 ${money(def.price)}，拆掉只退 50%（${money(Math.round((Number(def.price) || 0) / 2))}）。`,
          okLabel: '移除並退款', cancelLabel: '保留'
        });
        if (ok) dispatch({ type: 'REMOVE_FURNITURE', uid: it.uid });
      }, { small: true, kind: 'danger' });
      placedHost.appendChild(h('div', {
        class: 'row wrap',
        style: {
          gap: '6px', padding: '2px 5px', alignItems: 'center',
          background: it.broken ? '#f6e0dd' : 'var(--face-light)'
        }
      },
        h('span', { style: { minWidth: '110px', fontWeight: 'bold' } }, def.name || it.typeId),
        h('span', { class: 'muted' }, `(${it.x},${it.y}) ${it.w}×${it.h}${it.rot ? ` 旋轉 ${it.rot}°` : ''}`),
        h('span', { class: 'muted' }, `座位 ${Number(def.seats) || 0}・裝潢 ${Number(def.decorScore) || 0}`),
        it.broken ? tag('故障', 'bad') : null,
        dur < 60 ? tag('待維修', 'warn') : tag('狀況良好', 'ok'),
        h('span', { style: { width: '150px' } }, dbar.el),
        h('span', { class: 'muted' }, `同型共 ${byType.get(it.typeId) || 1} 件`),
        moveBtn, removeBtn));
    }
  }

  /* ------------------------------------------------------------ 設備頁 */
  function refreshEquipment(st) {
    const stars = Number(st.stars) || 1;
    clear(equipHost);
    const list = equipmentCatalog();
    if (!list.length) {
      equipHost.appendChild(emptyState('目前沒有可購買的設備資料。'));
    } else {
      for (const f of list) {
        const afford = (Number(st.cash) || 0) >= (Number(f.price) || 0);
        const buyBtn = button('自動安裝', () => {
          const res = dispatch({ type: 'PLACE_FURNITURE', typeId: f.id, x: -1, y: -1, rot: 0 });
          if (res && res.ok) ui.toast(`${f.name} 安裝完成。`, 'good');
        }, { small: true, kind: 'primary', disabled: !afford, title: afford ? '由系統自動找位置安裝' : `現金不足（需要 ${money(f.price)}）` });
        equipHost.appendChild(card(
          h('div', { class: 'card-title' }, f.name, afford ? null : tag('現金不足', 'bad')),
          h('div', { class: 'price' }, money(f.price)),
          h('div', { class: 'stat' }, `佔地 ${f.w}×${f.h} 格・裝潢 ${Number(f.decorScore) || 0} 分・耐久 ${Number(f.durability) || 0}`),
          h('div', { class: 'muted' }, f.desc || ''),
          h('div', { class: 'row' }, buyBtn)));
      }
    }

    const items = currentItems().filter((it) => {
      const def = furnitureById(it.typeId);
      return def && def.category === 'equipment';
    });
    clear(ownedEquipHost);
    if (!items.length) {
      ownedEquipHost.appendChild(emptyState('尚未安裝任何設備。監視器與紅外線可防宵小，滅火器與保全主機可降低意外損失。'));
    } else {
      for (const it of items) {
        const def = furnitureById(it.typeId) || { name: it.typeId };
        const dur = Number(it.durability) || 0;
        const repairBtn = button('維修', () => {
          const res = dispatch({ type: 'REPAIR', uid: it.uid });
          if (res && res.ok) ui.toast(`${def.name} 已維修。`, 'good');
        }, { small: true, kind: 'primary', disabled: dur >= 100, title: dur >= 100 ? '狀況良好' : '恢復耐久度' });
        ownedEquipHost.appendChild(h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
          h('span', { style: { minWidth: '110px', fontWeight: 'bold' } }, def.name),
          it.broken ? tag('故障中', 'bad') : tag('運作中', 'ok'),
          tag(`耐久 ${dur}%`, dur < 60 ? 'warn' : 'plain'),
          h('span', { class: 'muted' }, `座標 (${it.x},${it.y})`),
          repairBtn));
      }
    }

    const broken = (st.sim && st.sim.equipBroken) || {};
    const setSys = (node, key, label) => {
      const isBroken = !!broken[key];
      node.textContent = isBroken ? `${label}故障` : `${label}正常`;
      node.className = `tag ${isBroken ? 'bad' : 'ok'}`;
      equipBrokenBtns[key].disabled = !isBroken;
    };
    setSys(stoveTag, 'stove', '爐具');
    setSys(acTag, 'ac', '冷氣');
    setSys(fridgeTag, 'fridge', '冰箱');
    clear(equipBrokenHost);
    const brokenList = ['stove', 'ac', 'fridge'].filter((k) => broken[k]);
    if (!brokenList.length) {
      equipBrokenHost.appendChild(h('div', { class: 'muted' }, '所有固定設施運作正常。'));
    } else {
      equipBrokenHost.appendChild(warnBox(
        h('b', null, '⚠ 設施故障：'),
        `${brokenList.map((k) => (k === 'stove' ? '爐具' : k === 'ac' ? '冷氣' : '冰箱')).join('、')} 故障中。爐具故障會拖慢出餐、冷氣故障客人會嫌熱、冰箱故障會讓食材損壞，請盡快修復。`));
    }
  }

  /* ------------------------------------------------------ 清潔與維修頁 */
  function refreshClean(st) {
    const dirt = (st.sim && st.sim.dirt) || { floor: 0, restroom: 0 };
    floorBar.set(Number(dirt.floor) || 0, 100);
    restroomBar.set(Number(dirt.restroom) || 0, 100);
    const cash = Number(st.cash) || 0;
    floorCleanBtn.disabled = cash < CLEAN_COST.floor;
    restroomCleanBtn.disabled = cash < CLEAN_COST.restroom;
    const f = Number(dirt.floor) || 0;
    const r = Number(dirt.restroom) || 0;
    const notes = [];
    if (r > 60) notes.push('廁所已超過 60，顧客心情每秒扣 0.3，請立刻處理或指派服務生負責「清掃廁所」。');
    if (f > 70) notes.push('地板已超過 70，顧客心情每秒扣 0.2，趕快掃地。');
    if (!notes.length) notes.push('環境整潔，顧客不會抱怨。記得指派服務生定期打掃以維持。');
    dirtAdvice.textContent = notes.join(' ');

    const list = currentItems().filter((it) => (Number(it.durability) || 0) < 60);
    repairHead.textContent = `${list.length} 件待修`;
    clear(repairHost);
    if (!list.length) {
      repairHost.appendChild(h('div', { class: 'muted' }, '沒有耐久度低於 60 的傢俱或設備。'));
      repairAllBtn.disabled = true;
    } else {
      repairAllBtn.disabled = false;
      for (const it of list) {
        const def = furnitureById(it.typeId) || { name: it.typeId, price: 0 };
        const dur = Number(it.durability) || 0;
        const cost = repairCostOf(def, dur);
        repairHost.appendChild(h('div', {
          class: 'row wrap',
          style: { gap: '6px', alignItems: 'center', background: it.broken ? '#f6e0dd' : 'transparent' }
        },
          h('span', { style: { minWidth: '110px', fontWeight: 'bold' } }, def.name),
          it.broken ? tag('故障中', 'bad') : tag('堪用', 'warn'),
          h('span', { class: 'muted' }, `耐久 ${dur}%・預估維修約 ${money(cost)}`),
          button('維修', () => {
            const res = dispatch({ type: 'REPAIR', uid: it.uid });
            if (res && res.ok) ui.toast(`${def.name} 已維修。`, 'good');
          }, { small: true, kind: 'primary' })));
      }
    }
  }

  /* ------------------------------------------------------------ 地點頁 */
  let locationKey = '';
  function refreshLocations(st) {
    const stars = Number(st.stars) || 1;
    const cash = Number(st.cash) || 0;
    const key = `${st.locationId}|${stars}|${cash}|${st.day}`;
    const rows = (LOCATIONS || []).map((loc) => {
      const isCurrent = loc.id === st.locationId;
      const locked = stars < (Number(loc.starsRequired) || 1);
      const moveCost = moveCostOf(loc);
      const mix = loc.customerMix || {};
      const mixText = Object.entries(mix)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${({ student: '學生', office: '上班族', family: '家庭', tourist: '觀光客', critic: '美食評論家', vip: 'VIP' })[k] || k} ${Math.round((Number(v) || 0) * 100)}%`)
        .join('、');
      const moveBtn = isCurrent
        ? tag('目前地點', 'gold')
        : button(locked ? `需 ${loc.starsRequired}★` : '搬遷', async () => {
          if (locked) { ui.toast(`星級不足，需要 ${loc.starsRequired}★ 才能搬到${loc.name}。`, 'bad'); return; }
          const ok = await ui.confirm({
            title: `搬遷到${loc.name}`,
            message: `確定要搬遷到「${loc.name}」（${loc.city}）嗎？\n\n`
              + `・搬遷費 ${money(Number(loc.moveCost) || 0)} + 押金 ${money((Number(loc.rentPerDay) || 0) * MOVE_DEPOSIT_DAYS)}（${MOVE_DEPOSIT_DAYS} 天租金）＝ 共 ${money(moveCost)}\n`
              + `・舊裝潢清空後退回 30%（約 ${money(Math.round(layoutValueOf(currentItems()) * 0.3))}）\n`
              + `・格局與坪數不同（${loc.gridW}×${loc.gridH} 格），桌椅動線全部要重排\n`
              + `・區外評價會大幅下滑、名氣打 85 折，要靠重新經營爬回來\n`
              + `・目前現金 ${money(cash)}${cash < moveCost ? '（不足！）' : ''}\n\n`
              + '原作沒有分店系統，搬家是唯一的路。建議先存檔。',
            okLabel: `付 ${money(moveCost)} 搬遷`, cancelLabel: '再想想'
          });
          if (ok) {
            const res = dispatch({ type: 'MOVE_LOCATION', locationId: loc.id });
            if (res && res.ok) {
              pending.mode = null; pending.typeId = null; pending.uid = null;
              ui.toast(`已搬遷到${loc.name}，記得重新佈置店內。`, 'good');
            }
          }
        }, { small: true, kind: isCurrent ? 'ghost' : 'primary', title: locked ? `需要 ${loc.starsRequired}★` : `日租金 ${money(loc.rentPerDay)}` });
      return {
        name: h('span', null, h('b', null, loc.name), isCurrent ? h('span', { class: 'muted' }, '　(現在)') : null),
        city: loc.city || '—',
        need: h('span', null, starRow(Number(loc.starsRequired) || 1), locked ? h('div', {}, tag('未解鎖', 'bad')) : null),
        rent: money(loc.rentPerDay),
        traffic: `${(Number(loc.baseTraffic) || 0).toFixed(2)} 人/分`,
        mix: mixText || '—',
        prefs: (loc.tastePrefs || []).map((t) => ({ cheap: '便宜', fried: '炸物', local: '在地', meat: '肉', quick: '快速', seafood: '海鮮', soup: '湯品', sweet: '甜', drink: '飲料', noodle: '麵食' })[t] || t).join('、') || '—',
        size: `${loc.gridW}×${loc.gridH}`,
        go: moveBtn
      };
    });
    if (key !== locationKey) { locationKey = key; locationTable.setRows(rows); }
    const cur = (LOCATIONS || []).find((l) => l && l.id === st.locationId) || {};
    const next = (LOCATIONS || [])
      .filter((l) => l && (Number(l.starsRequired) || 1) > stars)
      .sort((a, b) => (Number(a.starsRequired) || 1) - (Number(b.starsRequired) || 1))[0];
    locationNote.textContent = `目前：${cur.name || st.locationId || '—'}（${cur.city || '—'}）・日租金 ${money(cur.rentPerDay)}・基礎客流 ${(Number(cur.baseTraffic) || 0).toFixed(2)} 人/分。`
      + (next ? `　下一個目標：${next.name}（需 ${next.starsRequired}★，目前 ${stars}★）。` : '　你已經可以搬到全台灣所有地點了。')
      + `　搬遷後裝潢全部清空（退 30–50%），請預留重新佈置的預算。`;
  }

  /* ------------------------------------------------------------ 對外介面 */
  return {
    id: 'build',
    title: '裝潢與設備',
    icon: '🔨',
    width: 660,
    height: 500,
    el: root,

    /**
     * 目前待擺放狀態，供 src/main.js 的 canvas 點擊處理讀取。
     * @returns {{mode:'place'|'move'|null, typeId:string|null, uid:string|null, rot:number}}
     */
    getPending() {
      return { mode: pending.mode, typeId: pending.typeId, uid: pending.uid, rot: pending.rot };
    },
    /** 待移動的傢俱 uid（沒有則 null）；main.js 直接拿這個值 dispatch MOVE_FURNITURE */
    getPendingMove() { return pending.mode === 'move' ? pending.uid : null; },
    /** 主迴圈擺放成功後呼叫，清除待擺放狀態 */
    clearPending() {
      pending.mode = null; pending.typeId = null; pending.uid = null; pending.rot = 0;
      const st = state();
      if (st) refreshPending(st);
    },
    /** 主迴圈移動成功後呼叫，清除待移動狀態（main.js 會偵測這個方法） */
    clearPendingMove() {
      if (pending.mode === 'move') { pending.mode = null; pending.typeId = null; pending.uid = null; pending.rot = 0; }
      const st = state();
      if (st) refreshPending(st);
    },

    open() {
      const st = state();
      if (st) { try { this.refresh(st); } catch (err) { console.error('[build] open 失敗', err); } }
    },
    close() {},

    refresh: refreshAll([
      (st) => { if (st) refreshSummary(st); },
      (st) => { if (st) refreshPending(st); },
      (st) => { if (st) refreshPalette(st); },
      (st) => { if (st) refreshPlaced(st); },
      (st) => { if (st) refreshEquipment(st); },
      (st) => { if (st) refreshClean(st); },
      (st) => { if (st) refreshLocations(st); }
    ], 'build')
  };
}
