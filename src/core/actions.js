// ============================================================================
// actions.js — 唯一的狀態修改入口（reducer）
// 契約見 docs/ARCHITECTURE.md §4。UI 只能 dispatch 這些 action。
// ============================================================================
import { DISHES, getDish, dishesForStars } from '../data/dishes.js';
import { STAFF_POOL, staffById } from '../data/staff.js';
import { LOCATIONS, getLocation, locationsForStars } from '../data/locations.js';
import { FURNITURE, furnitureById } from '../data/furniture.js';
import { defaultLayout, rebuildTables, canPlace, findAutoPlace, findItem, decorScore, seatCount, layoutValue, recomputeReachability, setTile as setTileRaw, tileAt, autoPlaceChairs } from '../sim/build.js';
import { clearPathCache } from '../sim/pathfind.js';
import { beginDay, startBusiness, requestClose, nextDay, absMinute } from '../sim/simulation.js';
import { buyCost, unitCost, clamp, dailyUtilities } from '../sim/economy.js';
import { clickLure } from '../sim/attract.js';
import { pushLog, emptyToday, makeStaffEntry, menuLimitFor, SAVE_VERSION, nextUid } from './state.js';
import * as B from './balance.js';

const ok = (info) => ({ ok: true, info });
const fail = (error) => ({ ok: false, error });

function withLayoutChange(state, fn) {
  const res = fn();
  // 換成新的 layout 物件：繪圖層以「物件參照 + rev」判斷快取是否失效，
  // 若只是就地改 items，命中判定與繪製快取會停留在舊位置（按了傢俱卻點不到）。
  state.layout = { ...state.layout, rev: (state.layout.rev || 0) + 1 };
  clearPathCache();
  rebuildTables(state);
  return res;
}

function menuEntryOf(state, dishId) {
  return state.menu.find((m) => m.dishId === dishId) || null;
}

export function ingredientUnitCost(state, dishId) {
  const entry = menuEntryOf(state, dishId);
  if (!entry) return 0;
  return unitCost(entry);
}

/**
 * 主 reducer。就地修改 state，回傳 {ok, error?, info?}
 */
export function reduce(state, action) {
  if (!state || !action) return fail('無效的操作');
  switch (action.type) {
    /* ---------------------------------------------------------- 時間控制 */
    case 'SET_SPEED': {
      const v = Number(action.value);
      if (!B.SPEEDS.includes(v)) return fail('無效的速度');
      state.speed = v;
      return ok();
    }
    case 'SET_HOURS': {
      const open = clamp(Math.round(action.openMinute ?? state.settings.openMinute), 0, 1439);
      const close = clamp(Math.round(action.closeMinute ?? state.settings.closeMinute), 0, 1439);
      if (close - open < 120) return fail('營業時間至少要 2 小時');
      state.settings.openMinute = open;
      state.settings.closeMinute = close;
      return ok();
    }
    case 'TOGGLE_DAY': {
      const i = clamp(Math.round(action.index), 0, 6);
      state.settings.openDays[i] = !state.settings.openDays[i];
      if (!state.settings.openDays.some(Boolean)) {
        state.settings.openDays[i] = true;
        return fail('至少要有一天營業');
      }
      return ok();
    }
    case 'SET_AC': {
      state.settings.acTemp = clamp(Math.round(action.temp), 16, 30);
      return ok();
    }
    case 'SET_FX': {
      const KEY = ['pools', 'shadows', 'ao', 'vignette', 'outsideShade', 'shafts'];
      if (!KEY.includes(action.key)) return fail('沒有這項畫面特效');
      if (!state.settings.fx) state.settings.fx = {};
      state.settings.fx[action.key] = !!action.on;
      return ok();
    }
    case 'SET_SETTING': {
      // 通用設定寫入：state.settings[action.key] = action.value
      state.settings[action.key] = action.value;
      return ok();
    }
    case 'SET_MUSIC': {
      if (!B.MUSIC_NAME[action.id]) return fail('沒有這個曲風');
      state.settings.music = action.id;
      return ok();
    }

    /* -------------------------------------------------------------- 菜單 */
    case 'MENU_ADD': {
      const def = getDish(action.dishId);
      if (!def) return fail('沒有這道料理');
      if (def.unlockStars > state.stars) return fail(`${def.name} 要 ${def.unlockStars} 星才會解鎖`);
      // 原作：隱藏料理要拿到年度大獎才會解鎖
      if (def.secret && !state.flags.secretUnlocked) {
        return fail(`${def.name} 是隱藏料理，要拿到年度大獎才會解鎖`);
      }
      if (menuEntryOf(state, action.dishId)) return fail('這道菜已經在菜單上了');
      const limit = menuLimitFor(state.stars);
      if (state.menu.length >= limit) return fail(`目前星級最多只能上架 ${limit} 道菜`);
      state.menu.push({
        dishId: def.id,
        price: def.expectedPrice || Math.round((def.baseCost || 20) * 7),
        grade: def.gradeDefault ?? 50,
        taste: def.tasteDefault ?? 50,
        portion: def.portionDefault ?? 50,
        cookTime: def.cookTimeDefault ?? 25,
        active: true,
        sold: 0
      });
      if (state.stock[def.id] === undefined) state.stock[def.id] = 0;
      return ok(`已上架 ${def.name}`);
    }
    case 'MENU_REMOVE': {
      const entry = menuEntryOf(state, action.dishId);
      if (!entry) return fail('這道菜不在菜單上');
      state.menu = state.menu.filter((m) => m.dishId !== action.dishId);
      return ok('已移除');
    }
    case 'MENU_UPDATE': {
      const entry = menuEntryOf(state, action.dishId);
      if (!entry) return fail('這道菜不在菜單上');
      const patch = action.patch || {};
      if (patch.price !== undefined) entry.price = clamp(Math.round(patch.price), 1, 9999);
      if (patch.grade !== undefined) entry.grade = clamp(Math.round(patch.grade), 0, 100);
      if (patch.taste !== undefined) entry.taste = clamp(Math.round(patch.taste), 0, 100);
      if (patch.portion !== undefined) entry.portion = clamp(Math.round(patch.portion), 0, 100);
      if (patch.cookTime !== undefined) entry.cookTime = clamp(Math.round(patch.cookTime), 1, 60);
      return ok();
    }
    case 'MENU_TOGGLE': {
      const entry = menuEntryOf(state, action.dishId);
      if (!entry) return fail('這道菜不在菜單上');
      entry.active = !entry.active;
      return ok(entry.active ? '恢復供應' : '暫停供應');
    }

    /* -------------------------------------------------------------- 進貨 */
    case 'BUY_STOCK': {
      const entry = menuEntryOf(state, action.dishId);
      if (!entry) return fail('先上架這道菜才能進貨');
      const servings = Math.max(1, Math.round(action.servings || 10));
      const cost = buyCost(entry, servings, state.sim.supplierPriceMul || 1);
      if (state.cash < cost) return fail(`現金不足（需要 NT$ ${cost.toLocaleString('en-US')}）`);
      state.cash -= cost;
      state.stats.today.inventory += cost;
      state.stats.today.spend += cost;
      state.suppliers.push({
        dishId: entry.dishId,
        servings,
        arriveMinute: absMinute(state) + B.DELIVERY_MINUTES,
        cost
      });
      return ok(`${getDish(entry.dishId)?.name} 進貨 ${servings} 份，30 分鐘後到貨`);
    }

    /* -------------------------------------------------------------- 員工 */
    case 'HIRE': {
      const cand = state.candidates.find((c) => c.candidateId === action.candidateId);
      if (!cand) return fail('找不到這位應徵者');
      const person = staffById(cand.staffId);
      if (!person) return fail('找不到這位應徵者');
      const fee = Math.round((cand.askWage || person.wage || 2) * 2);
      if (state.cash < fee) return fail('現金不足，付不出簽約金');
      state.cash -= fee;
      state.stats.today.spend += fee;
      state.staff.push(makeStaffEntry(state, person, cand.askWage || person.wage || 2));
      state.candidates = state.candidates.filter((c) => c.candidateId !== action.candidateId);
      pushLog(state, `雇用 ${person.name}（${person.role === 'chef' ? '廚師' : '服務生'}），時薪 ${cand.askWage}`, 'good');
      return ok(`已雇用 ${person.name}`);
    }
    case 'FIRE': {
      const st = state.staff.find((s) => s.uid === action.uid);
      if (!st) return fail('找不到這位員工');
      if (st.role === 'chef' && state.staff.filter((s) => s.role === 'chef').length <= 1) {
        return fail('至少要留一位廚師');
      }
      const severance = Math.round(st.wage * B.SEVERANCE_HOURS);
      state.cash -= severance;
      state.stats.today.spend += severance;
      state.staff = state.staff.filter((s) => s.uid !== action.uid);
      if (st.task) state.sim.tasks = state.sim.tasks.filter((t) => t.id !== st.task);
      pushLog(state, `解僱 ${st.name}，支付資遣費 NT$ ${severance}`, 'warn');
      return ok(`已解僱 ${st.name}`);
    }
    case 'SET_WAGE': {
      const st = state.staff.find((s) => s.uid === action.uid);
      if (!st) return fail('找不到這位員工');
      st.wage = clamp(Math.round(action.wage), B.MIN_WAGE, B.MAX_WAGE);
      st.mood = clamp(st.mood + (st.wage >= (staffById(st.staffId)?.wage || 2) ? 4 : -6), 0, 100);
      return ok(`時薪調整為 ${st.wage} 元`);
    }
    case 'SET_SHIFT': {
      const st = state.staff.find((s) => s.uid === action.uid);
      if (!st) return fail('找不到這位員工');
      const start = clamp(Math.round(action.start), 0, 1439);
      const end = clamp(Math.round(action.end), 0, 1439);
      if (start === end) return fail('上下班時間不能相同');
      st.shift = { start, end };
      return ok();
    }
    case 'SET_DUTY': {
      const st = state.staff.find((s) => s.uid === action.uid);
      if (!st) return fail('找不到這位員工');
      if (!st.duties) st.duties = {};
      if (!['escort', 'serve', 'order', 'bus', 'cleanRestroom', 'cleanFloor', 'cashier'].includes(action.duty)) {
        return fail('沒有這項職務');
      }
      st.duties[action.duty] = !!action.on;
      return ok();
    }

    /* ------------------------------------------------------------ 裝潢 */
    case 'PLACE_FURNITURE': {
      const def = furnitureById(action.typeId);
      if (!def) return fail('沒有這件傢俱');
      let x = Math.round(action.x ?? -1);
      let y = Math.round(action.y ?? -1);
      if (x < 0 || y < 0) {
        const spot = findAutoPlace(state.layout, def.id);
        if (!spot) return fail('找不到適合的位置');
        x = spot.x; y = spot.y;
      }
      if (state.cash < def.price) return fail(`現金不足（${def.name} 要 NT$ ${def.price.toLocaleString('en-US')}）`);
      const check = canPlace(state.layout, def.id, x, y);
      if (!check.ok) return fail(check.error);
      state.cash -= def.price;
      state.stats.today.spend += def.price;
      const uid = 'f' + ((state.uidSeq = (state.uidSeq || 1) + 1));
      state.layout.items.push({
        uid, typeId: def.id,
        x, y,
        w: def.w || 1,
        h: def.h || 1,
        rot: action.rot || 0,
        durability: 100,
        broken: false
      });
      const tableItem = state.layout.items.find(it => it.uid === uid);
      let chairMsg = '';
      if (def.category === 'table' && tableItem) {
        const chairUids = autoPlaceChairs(state, tableItem, nextUid);
        tableItem.chairUids = chairUids;
        if (chairUids.length) chairMsg = `（自動配 ${chairUids.length} 張椅子）`;
      }
      return withLayoutChange(state, () => ok(`已購入 ${def.name}${chairMsg}`));
    }
    case 'MOVE_FURNITURE': {
      const item = findItem(state.layout, action.uid);
      if (!item) return fail('找不到這件傢俱');
      const x = Math.round(action.x);
      const y = Math.round(action.y);
      const check = canPlace(state.layout, item.typeId, x, y, item.uid);
      if (!check.ok) return fail(check.error);
      const dx = x - item.x, dy = y - item.y;
      item.x = x; item.y = y;
      // 自動配來的椅子跟著搬
      for (const cuid of (item.chairUids || [])) {
        const chair = findItem(state.layout, cuid);
        if (chair) { chair.x += dx; chair.y += dy; }
      }
      return withLayoutChange(state, () => ok());
    }
    case 'ROTATE_FURNITURE': {
      const item = findItem(state.layout, action.uid);
      if (!item) return fail('找不到這件傢俱');
      const def = furnitureById(item.typeId);
      if (!def) return fail('找不到這件傢俱');
      // 只有「有方向性」的傢俱（椅子、部分裝飾）旋轉才有意義
      const DIRECTIONAL = ['chair', 'table', 'counter', 'decor'];
      if (!DIRECTIONAL.includes(def.category)) return fail(`${def.name} 沒有方向性，不需要旋轉`);
      const next = action.rot !== undefined
        ? ((Math.round(action.rot) % 4) + 4) % 4
        : (((item.rot | 0) + 1) % 4);
      // 矩形傢俱旋轉時佔地要跟著換（1×2 ↔ 2×1）
      const swap = action.swapFootprint !== false && def.w !== def.h;
      const w = swap ? (def.h || 1) : (item.w || def.w || 1);
      const h = swap ? (def.w || 1) : (item.h || def.h || 1);
      const check = canPlace(state.layout, item.typeId, item.x, item.y, item.uid);
      if (!check.ok && (w !== (item.w || 1) || h !== (item.h || 1))) {
        return fail('這裡空間不夠旋轉，先把傢俱移開一點');
      }
      item.rot = next;
      item.rotManual = true;
      if (swap) { item.w = w; item.h = h; }
      return withLayoutChange(state, () => ok(`已旋轉（方向 ${['南', '東', '北', '西'][next]}）`));
    }
    case 'REPLACE_FURNITURE': {
      const item = findItem(state.layout, action.uid);
      if (!item) return fail('找不到這件傢俱');
      const oldDef = furnitureById(item.typeId);
      const newDef = furnitureById(action.typeId);
      if (!newDef) return fail('沒有這件傢俱');
      if (newDef.id === item.typeId) return fail('已經是同一件傢俱了');
      const refund = Math.round((oldDef?.price || 0) * 0.5);
      const cost = Math.max(0, (newDef.price || 0) - refund);
      if (state.cash < cost) {
        return fail(`更換需要 NT$ ${cost.toLocaleString('en-US')}（新傢俱 ${newDef.price.toLocaleString('en-US')} − 舊品退款 ${refund.toLocaleString('en-US')}）`);
      }
      const check = canPlace(state.layout, newDef.id, item.x, item.y, item.uid);
      if (!check.ok) return fail(`這個位置放不下 ${newDef.name}：${check.error}`);
      state.cash -= cost;
      state.stats.today.spend += cost;
      state.layout.items = state.layout.items.filter((i) => i.uid !== action.uid);
      state.layout.items.push({
        uid: action.uid,                 // 沿用 uid，桌子的執行期狀態（客人/髒污）不會斷掉
        typeId: newDef.id,
        x: item.x, y: item.y,
        w: newDef.w || 1,
        h: newDef.h || 1,
        rot: item.rot || 0,
        rotManual: item.rotManual || false,
        durability: 100,
        broken: false
      });
      return withLayoutChange(state, () => ok(`已更換為 ${newDef.name}${cost ? `（補差額 NT$ ${cost.toLocaleString('en-US')}）` : '（舊品退款足夠，不用補錢）'}`));
    }
    case 'REMOVE_FURNITURE': {
      const item = findItem(state.layout, action.uid);
      if (!item) return fail('找不到這件傢俱');
      const def = furnitureById(item.typeId);
      const refund = Math.round((def?.price || 0) * 0.5);
      state.cash += refund;
      const removedUids = new Set([action.uid, ...(item.chairUids || [])]);
      state.layout.items = state.layout.items.filter((i) => !removedUids.has(i.uid));
      state.sim.tables = state.sim.tables.filter((t) => !removedUids.has(t.uid));
      return withLayoutChange(state, () => ok(`已拆除，退回 NT$ ${refund.toLocaleString('en-US')}`));
    }
    case 'CLEAR_LAYOUT': {
      const refund = Math.round(layoutValue(state.layout) * 0.5);
      state.cash += refund;
      state.layout.items = [];
      state.sim.tables = [];
      return withLayoutChange(state, () => ok(`已清空裝潢，退回 NT$ ${refund.toLocaleString('en-US')}`));
    }
    case 'SET_TILE': {
      const allowed = ['floor', 'wall', 'kitchen', 'pass', 'restroom'];
      if (!allowed.includes(action.tile)) return fail('不能改成這種地形');
      const cur = tileAt(state.layout, action.x, action.y);
      if (cur === 'door') return fail('大門不能拆');
      if (cur === 'pass' && action.tile !== 'pass') {
        const passCount = state.layout.passTiles.filter((p) => !(p.x === action.x && p.y === action.y)).length;
        if (passCount < 1) return fail('至少要留一個出餐口');
      }
      const cost = action.tile === 'floor' ? 0 : 3000;
      if (state.cash < cost) return fail('現金不足');
      state.cash -= cost;
      setTileRaw(state.layout, action.x, action.y, action.tile);
      if (action.tile === 'pass') state.layout.passTiles.push({ x: action.x, y: action.y });
      else state.layout.passTiles = state.layout.passTiles.filter((p) => !(p.x === action.x && p.y === action.y));
      if (action.tile === 'restroom') state.layout.restroomTiles.push({ x: action.x, y: action.y });
      else state.layout.restroomTiles = state.layout.restroomTiles.filter((p) => !(p.x === action.x && p.y === action.y));
      if (action.tile === 'kitchen') state.layout.kitchenTiles.push({ x: action.x, y: action.y });
      else state.layout.kitchenTiles = state.layout.kitchenTiles.filter((p) => !(p.x === action.x && p.y === action.y));
      return withLayoutChange(state, () => ok('隔間已變更'));
    }

    /* ------------------------------------------------------ 維修與清潔 */
    case 'UPGRADE_KITCHEN': {
      var target = action.target;
      if (!B.KITCHEN_SPECS[target]) return fail('沒有這項設備');
      var cur = (state.kitchen && state.kitchen[target]) || 1;
      if (cur >= B.KITCHEN_MAX_LEVEL) return fail(B.KITCHEN_SPECS[target].name + ' 已達最高等級 ' + B.KITCHEN_MAX_LEVEL);
      var cost = kitchenUpgradeCost(target, cur);
      if (state.cash < cost) return fail('現金不足（需要 NT$ ' + cost.toLocaleString('en-US') + '）');
      state.cash -= cost;
      state.stats.today.spend += cost;
      state.kitchen[target] = cur + 1;
      return ok(B.KITCHEN_SPECS[target].name + ' 升至等級 ' + (cur + 1));
    }
    case 'REPAIR': {
      if (action.target) {
        const t = action.target;
        if (!['ac', 'stove', 'fridge'].includes(t)) return fail('沒有這項設備');
        const cost = t === 'ac' ? 12000 : t === 'stove' ? 9000 : 7000;
        if (state.cash < cost) return fail('現金不足');
        state.cash -= cost;
        state.stats.today.repairs = (state.stats.today.repairs || 0) + cost;
        state.stats.today.spend += cost;
        state.sim.equipBroken[t] = false;
        return ok('設備已修復');
      }
      const item = findItem(state.layout, action.uid);
      if (!item) return fail('找不到這件傢俱');
      const def = furnitureById(item.typeId);
      const damage = 100 - (item.durability ?? 100);
      const cost = Math.max(200, Math.round((def?.price || 1000) * 0.25 * (damage / 100) + 150));
      if (state.cash < cost) return fail('現金不足');
      state.cash -= cost;
      state.stats.today.repairs = (state.stats.today.repairs || 0) + cost;
      state.stats.today.spend += cost;
      item.durability = 100;
      item.broken = false;
      return ok(`已修好 ${def?.name || '傢俱'}（NT$ ${cost.toLocaleString('en-US')}）`);
    }
    case 'CLEAN': {
      const target = action.target === 'restroom' ? 'restroom' : 'floor';
      const cost = target === 'restroom' ? B.CLEAN_RESTROOM_COST : B.CLEAN_FLOOR_COST;
      if (state.cash < cost) return fail('現金不足');
      state.cash -= cost;
      state.stats.today.spend += cost;
      state.sim.dirt[target] = 0;
      return ok(target === 'restroom' ? '廁所清潔完畢' : '店內清潔完畢');
    }

    /* ---------------------------------------------------------- 營業流程 */
    case 'START_DAY': {
      if (state.phase !== 'build') return fail('現在不是準備階段');
      if (!state.settings.openDays[(state.day - 1) % 7]) {
        return fail('今天是設定的公休日（可在「環境」調整營業日），員工今天不上班');
      }
      const activeMenu = state.menu.filter((m) => m.active);
      if (!activeMenu.length) return fail('菜單是空的，先上架幾道菜');
      const hasStock = activeMenu.some((m) => (state.stock[m.dishId] || 0) > 0);
      if (!hasStock) return fail('庫存全是 0，先叫貨再開店');
      if (!state.staff.some((s) => s.role === 'waiter')) return fail('沒有服務生，客人不會自己端菜');
      if (!state.staff.some((s) => s.role === 'chef')) return fail('沒有廚師，無法出餐');
      if (seatCount(state.sim.tables) <= 0) return fail('沒有可用的座位，先擺張桌子');
      const anyUsable = state.sim.tables.some((t) => t.usable);
      if (!anyUsable) return fail('桌子被擋住或離動線太遠，客人走不到位子');
      startBusiness(state);
      return ok('開始營業');
    }
    case 'END_DAY': {
      if (state.phase !== 'open') return fail('目前不是營業中');
      requestClose(state);
      return ok('打烊中，等客人離開');
    }
    case 'NEXT_DAY': {
      if (state.phase !== 'closed') return fail('今天的營業還沒結束');
      nextDay(state);
      return ok(`第 ${state.day} 天開始`);
    }
    case 'CANNOT_OPEN_TODAY': {
      // 依 settings.openDays 決定今天是否營業
      return ok();
    }
    case 'LURE': {
      if (state.phase !== 'open') return fail('還沒開始營業');
      const res = clickLure(state, null, action.walkerUid || null);
      return ok(res.converted ? '拉到一位客人進門！' : '向路人招手，人氣微微上升');
    }
    case 'MOVE_LOCATION': {
      const loc = getLocation(action.locationId);
      if (!loc) return fail('沒有這個地點');
      if (state.phase !== 'build' && state.phase !== 'closed') return fail('只能在打烊後搬遷');
      if (loc.id === state.locationId) return fail('已經在這個地點了');
      if (loc.starsRequired > state.stars) return fail(`${loc.name} 需要 ${loc.starsRequired} 星`);
      const refund = Math.round(layoutValue(state.layout) * 0.3);
      const cost = (loc.moveCost || 0) + (loc.rentPerDay || 0) * 3;
      if (state.cash + refund < cost) return fail(`搬遷需要 NT$ ${cost.toLocaleString('en-US')}（裝潢退回 NT$ ${refund.toLocaleString('en-US')}）`);
      state.cash += refund - cost;
      state.stats.today.spend += cost;
      state.locationId = loc.id;
      const layout = defaultLayout(loc.id);
      state.layout = {
        gridW: layout.gridW,
        gridH: layout.gridH,
        tiles: layout.tiles,
        items: [],
        door: layout.door,
        outside: layout.outside,
        kitchenTiles: layout.kitchenTiles,
        passTiles: layout.passTiles,
        restroomTiles: layout.restroomTiles,
        sidewalk: layout.sidewalk,
        rev: (state.layout.rev || 0) + 1
      };
      state.sim.tables = [];
      state.reputation.outside = clamp(state.reputation.outside - B.MOVE_OUTSIDE_PENALTY, 0, 500);
      state.fame = clamp(state.fame * 0.85, 0, 100);
      state.sim.customers = [];
      state.sim.tasks = [];
      pushLog(state, `搬遷到 ${loc.name}，裝潢需要重新規劃，區外評價也掉了`, 'warn');
      return withLayoutChange(state, () => ok(`搬到 ${loc.name} 了！記得重新擺設桌椅`));
    }

    /* -------------------------------------------------------------- 系統 */
    case 'ACK_SETTLE': {
      state.flags.lastAckSettleDay = state.day;
      return ok();
    }
    case 'SET_TUTORIAL_DONE': {
      state.flags.tutorialDone = true;
      return ok();
    }
    case 'DISMISS_UI': {
      if (Array.isArray(state.uiQueue) && state.uiQueue.length) state.uiQueue.shift();
      return ok();
    }
    case 'REBUILD_RESTAURANT': {
      const cost = 1;
      if (state.cash < cost) return fail('現金不足（重建只要 NT$ 1）');
      // 清空現有裝潢
      state.layout.items = [];
      state.sim.tables = [];
      // 頂級開局範本（最大桌、頂級裝潢、全套設備）
      const items = [
        { typeId: 'kitchen_stove', x: 1, y: 1 },
        { typeId: 'kitchen_worktable', x: 3, y: 1 },
        { typeId: 'kitchen_dishwasher', x: 5, y: 1 },
        { typeId: 'fridge', x: 6, y: 1 },
        { typeId: 'ac_unit', x: 0, y: 4 },
        { typeId: 'ceiling_lamp', x: 10, y: 0 },
        { typeId: 'stereo', x: 15, y: 0 },
        { typeId: 'cctv', x: 19, y: 4 },
        { typeId: 'infrared_sensor', x: 19, y: 5 },
        { typeId: 'fire_extinguisher', x: 0, y: 8 },
        { typeId: 'fire_system', x: 19, y: 8 },
        { typeId: 'security_host', x: 0, y: 9 },
        { typeId: 'table_6b', x: 1, y: 5 },
        { typeId: 'table_6b', x: 4, y: 5 },
        { typeId: 'table_6b', x: 7, y: 5 },
        { typeId: 'table_6b', x: 10, y: 5 },
        { typeId: 'table_6b', x: 1, y: 9 },
        { typeId: 'table_6b', x: 4, y: 9 },
        { typeId: 'table_6b', x: 7, y: 9 },
        { typeId: 'table_6b', x: 10, y: 9 },
        { typeId: 'counter_bar', x: 14, y: 10 },
        { typeId: 'restroom_toilet', x: 16, y: 1 },
        { typeId: 'restroom_sink', x: 17, y: 1 },
        { typeId: 'fountain_small', x: 13, y: 5 },
        { typeId: 'jukebox', x: 14, y: 7 },
        { typeId: 'neon_sign', x: 0, y: 6 },
        { typeId: 'painting_landscape', x: 0, y: 2 },
        { typeId: 'photo_wall', x: 19, y: 2 },
        { typeId: 'lantern_row', x: 13, y: 10 }
      ];
      let placed = 0;
      for (const spot of items) {
        const def = furnitureById(spot.typeId);
        if (!def) continue;
        const check = canPlace(state.layout, def.id, spot.x, spot.y);
        if (!check.ok) continue;
        const uid = 'rb' + placed;
        state.layout.items.push({
          uid, typeId: def.id, x: spot.x, y: spot.y,
          w: def.w || 1, h: def.h || 1, rot: 0,
          durability: 100, broken: false
        });
        if (def.category === 'table') {
          // 自動配椅子
          const tableItem = state.layout.items.find(it => it.uid === uid);
          tableItem.chairUids = autoPlaceChairs(state, tableItem, (st) => 'rb' + (st.uidSeq = (st.uidSeq || 1) + 1));
        }
        placed += 1;
      }
      state.cash -= cost;
      state.kitchen = { stove: 5, fridge: 5, prep: 5 };
      return withLayoutChange(state, () => ok('已重建頂級餐廳（NT$ 1），共 ' + placed + ' 件頂級設備'));
    }
    case 'AUTO_SHIFT': {
      const open = state.settings.openMinute;
      const close = state.settings.closeMinute;
      if (close <= open) return fail('請先設定營業時間');
      const totalHours = (close - open) / 60;
      const waiters = state.staff.filter((s) => s.role === 'waiter');
      const chefs = state.staff.filter((s) => s.role === 'chef');
      if (!waiters.length && !chefs.length) return fail('沒有員工可以排班');
      const blockHours = 8;
      const stepHours = totalHours <= blockHours ? blockHours : Math.max(4, Math.ceil(totalHours / Math.max(1, Math.ceil(totalHours / blockHours))));
      const numBlocks = Math.max(1, Math.ceil((totalHours - blockHours) / stepHours) + 1);
      const assign = (list) => {
        list.forEach((s, i) => {
          const blockIdx = i % numBlocks;
          const blockStart = open + blockIdx * stepHours * 60;
          const blockEnd = Math.min(close, blockStart + blockHours * 60);
          s.shift = { start: Math.round(blockStart), end: Math.round(blockEnd) };
        });
      };
      assign(waiters);
      assign(chefs);
      return ok('已自動排班：' + numBlocks + ' 班、每班 8 小時，服務生 ' + waiters.length + ' 人、廚師 ' + chefs.length + ' 人');
    }
    default:
      return fail(`未知的操作：${action.type}`);
  }
}

export const ACTION_TYPES = [
  'SET_SPEED', 'SET_HOURS', 'TOGGLE_DAY', 'SET_AC', 'SET_MUSIC', 'SET_FX', 'UPGRADE_KITCHEN', 'AUTO_SHIFT', 'REBUILD_RESTAURANT',
  'MENU_ADD', 'MENU_REMOVE', 'MENU_UPDATE', 'MENU_TOGGLE', 'BUY_STOCK',
  'HIRE', 'FIRE', 'SET_WAGE', 'SET_SHIFT', 'SET_DUTY',
  'PLACE_FURNITURE', 'MOVE_FURNITURE', 'ROTATE_FURNITURE', 'REPLACE_FURNITURE', 'REMOVE_FURNITURE', 'CLEAR_LAYOUT', 'SET_TILE',
  'REPAIR', 'CLEAN',
  'START_DAY', 'END_DAY', 'NEXT_DAY', 'LURE', 'MOVE_LOCATION',
  'SAVE_GAME', 'LOAD_GAME', 'NEW_GAME',
  'ACK_SETTLE', 'SET_TUTORIAL_DONE', 'DISMISS_UI'
];

export { decorScore, dailyUtilities, emptyToday, SAVE_VERSION, dishesForStars, DISHES, FURNITURE, LOCATIONS, STAFF_POOL, locationsForStars };
