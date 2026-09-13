// ============================================================================
// simulation.js — 主模擬：時間推進、客流、顧客流程、每日結算
// 純邏輯、不碰 DOM、所有亂數來自 state.rng（決定性）。
// ============================================================================
import { getLocation, locationsForStars } from '../data/locations.js';
import { getDish, dishesForStars } from '../data/dishes.js';
import { makeCandidateList } from '../data/staff.js';
import { rebuildTables, seatCount, decorScore, nearestWalkable, isWalkableTile } from './build.js';
import { findPath, clearPathCache } from './pathfind.js';
import * as B from '../core/balance.js';
import { withRng, makeRng } from '../core/rng.js';
import { pushLog, emptyToday, rollWeather } from '../core/state.js';
import { finalizeDay, clamp, ingredientCost } from './economy.js';
import { runWeeklySettlement, weeklyBonus } from './magazine.js';
import { checkStars, checkDropStar, checkAnnualAward, dailyFame } from './rating.js';
import { tickEvents, expireEvents, trafficMultiplierFromEvents } from './events.js';
import { spawnWalkers, updateWalkers, decayLure, lureMultiplier } from './attract.js';
import { updateStaff, createTask, cancelTasksFor, collectPayment, checkResignations } from './staffai.js';
import {
  makeCustomer, updateMood, moveEntity, setPathTo, atTile, customerLeaves,
  releaseSeat, dishScoreFor, valueScoreFor, REASON_TEXT
} from './customer.js';

let customerSeq = 1;

export function absMinute(state) {
  return state.absMinute ?? (state.day * 1440 + state.minute);
}

/* --------------------------------------------------------------- 開始營業 */

export function beginDay(state) {
  const rng = makeRng(state.seed ^ (state.day * 7919));
  const loc = getLocation(state.locationId);
  state.phase = 'build';
  state.minute = Math.max(0, state.settings.openMinute - 60);
  state.minuteFloat = state.minute;
  state.stats.today = emptyToday();
  state.sim.weather = rollWeather(loc, rng);
  state.stats.today.weather = state.sim.weather;
  state.sim.complaintLog = state.sim.complaintLog || [];
  state.sim.todayDishScores = [];
  state.sim.todayValueScores = [];
  state.sim.todayMoods = [];
  state.sim.customers = [];
  state.sim.tasks = [];
  state.sim.kitchen = [];
  state.sim.pass = [];
  state.sim.suppliers = [];
  state.sim.activeEvents = [];
  state.sim.trafficMul = 1;
  state.sim.supplierPriceMul = 1;
  state.sim.supplierPriceMulUntil = 0;
  state.sim.eventTimer = rng.int(90, 200);
  state.sim.spawnAccumulator = 0;
  state.sim.customersSpawned = 0;
  state.sim.customersLost = 0;
  state.sim.dirt.floor = clamp((state.sim.dirt.floor || 0) * 0.7, 0, 100);
  state.sim.dirt.restroom = clamp((state.sim.dirt.restroom || 0) * 0.8, 0, 100);
  state.sim.equipBroken = state.sim.equipBroken || { ac: false, stove: false, fridge: false };

  for (const st of state.staff) {
    st.hoursToday = 0;
    st.task = null;
    st.path = [];
    st.pathIndex = 0;
    st.working = false;
    st.state = 'idle';
  }
  for (const t of state.sim.tables) {
    t.occupants = [];
    t.waiterUid = null;
    if (t.state === 'occupied') t.state = 'clean';
  }

  // 租金
  const rent = loc?.rentPerDay ?? 1800;
  state.cash -= rent;
  state.stats.today.rent = rent;
  state.stats.today.spend += rent;

  // 每週一社區獎金
  if (state.day > 1 && state.day % 7 === 1) weeklyBonus(state);
  // 每週一更換招募名單
  if (state.day % 7 === 1 || !state.candidates.length) {
    state.candidates = safeCandidates(state.day, 5, rng);
  }

  spawnWalkers(state, rng, 6);
  rebuildTables(state);
  state.layout.rev = (state.layout.rev || 0) + 1;
  clearPathCache();
  pushLog(state, `第 ${state.day} 天開店準備（${B.WEATHER_NAME[state.sim.weather] || '晴天'}）`, 'info');
  return state;
}

function safeCandidates(day, count, rng) {
  try {
    const list = makeCandidateList(day, count, rng);
    if (Array.isArray(list) && list.length) return list;
  } catch { /* 忽略 */ }
  return [];
}

export function startBusiness(state) {
  state.phase = 'open';
  state.minute = state.settings.openMinute;
  state.minuteFloat = state.settings.openMinute;
  pushLog(state, '開始營業！', 'good');
  state.uiQueue.push({ type: 'toast', message: '開始營業！祝生意興隆', kind: 'good' });
}

export function requestClose(state) {
  if (state.phase !== 'open') return;
  state.phase = 'closing';
  state.sim.closingSince = absMinute(state);
  pushLog(state, '打烊時間到，等客人離場…', 'info');
}

/* --------------------------------------------------------------- 客流計算 */

/** 是否有服務生負責櫃台結帳（可省下送帳單的走動） */
export function hasCashierOnShift(state) {
  return state.staff.some((s) => s.role === 'waiter' && s.working && s.duties?.cashier);
}

export function availability(state) {  let freeSeats = 0;
  let usable = 0;
  let dirty = 0;
  for (const t of state.sim.tables) {
    if (!t.usable) continue;
    usable += 1;
    if (t.state === 'dirty') { dirty += 1; continue; }
    freeSeats += Math.max(0, t.seats.length - t.occupants.length);
  }
  const waiting = state.sim.customers.filter((c) => c.state === 'queueing').length;
  return { freeSeats, usable, dirty, waiting };
}

export function menuMatch(state) {
  const active = state.menu.filter((m) => m.active);
  if (!active.length) return 0.7;
  let sum = 0;
  for (const m of active) {
    const def = getDish(m.dishId);
    sum += def?.popularity?.[state.locationId] ?? 1;
  }
  return clamp(sum / active.length / 1.2, 0.6, 1.35);
}

export function priceFairness(state) {
  const active = state.menu.filter((m) => m.active);
  if (!active.length) return 0.8;
  let sum = 0;
  for (const m of active) sum += valueScoreFor(m);
  return clamp(sum / active.length, 0.6, 1.15);
}

export function spawnRate(state) {
  const loc = getLocation(state.locationId);
  const base = loc?.baseTraffic ?? 1;
  const weather = B.WEATHER_TRAFFIC[state.sim.weather] ?? 1;
  const hour = B.hourFactor(state.minute);
  const fameFactor = 0.35 + (state.fame / 100) * 0.85;
  const decor = clamp(0.85 + (state.stats.today.decorations || decorScore(state.layout, loc).total) / 1200, 0.85, 1.25);
  const stars = 0.75 + state.stars * 0.06;
  let rate = (base * weather * hour * fameFactor * decor * menuMatch(state) * priceFairness(state) * stars *
    lureMultiplier(state) * trafficMultiplierFromEvents(state)) / 10;
  const { freeSeats, waiting } = availability(state);
  if (freeSeats <= 0) rate *= 0.3;
  // 門口有人在排隊時，路人比較不會跟著進來（也避免服務生被塞爆）
  if (waiting > 0) rate *= Math.max(0.25, 1 - 0.3 * Math.min(3, waiting));
  // 店裡越滿，外面的人越會卻步（自助調節，避免服務崩潰）
  const seats = Math.max(1, seatCount(state.sim.tables));
  const occupancy = clamp((seats - freeSeats) / seats, 0, 1);
  rate *= 1 - 0.45 * occupancy;
  // 今天如果已經讓客人等太久，外面的人會轉往別家（服務品質自動調節，不會無限崩壞）
  const today = state.stats.today;
  if (today.waitCount > 3) {
    const avgWait = today.waitSum / today.waitCount;
    const stress = clamp(avgWait / 45, 0, 1.6);
    rate *= Math.max(0.25, 1 - stress * 0.45);
  }
  const cap = Math.max(0.02, seats * 0.06);
  return Math.min(rate, cap);
}

/* ------------------------------------------------------------ 主模擬步進 */

export function stepSimulation(state, dtMin) {
  if (!(dtMin > 0)) return;
  if (state.phase === 'build' || state.phase === 'settle' || state.phase === 'gameover') return;

  withRng(state, (rng) => {
    advanceClock(state, dtMin);

    if (state.phase === 'open') {
      // 自動打烊
      if (state.minute >= state.settings.closeMinute) requestClose(state);
      else spawnCustomers(state, dtMin, rng);
    }

    updateCustomers(state, dtMin, rng);
    updateStaff(state, dtMin, rng);
    updateRestaurant(state, dtMin, rng);
    tickEvents(state, dtMin, rng);
    expireEvents(state);
    updateWalkers(state, dtMin, rng);
    decayLure(state, dtMin);
    deliverSuppliers(state);
    autoTasks(state);

    if (state.phase === 'closing' && !state.sim.customers.length) {
      finishDay(state);
    }
    checkBankruptcy(state, dtMin);
  });
}

function advanceClock(state, dtMin) {
  state.minuteFloat = (state.minuteFloat ?? state.minute) + dtMin;
  state.absMinute = (state.absMinute ?? state.minute) + dtMin;
  if (state.minuteFloat >= 1440) {
    state.minuteFloat -= 1440;
  }
  state.minute = state.minuteFloat;
}

function spawnCustomers(state, dtMin, rng) {
  const { freeSeats, waiting } = availability(state);
  if (waiting >= 5) return;
  state.sim.spawnAccumulator = (state.sim.spawnAccumulator || 0) + spawnRate(state) * dtMin * (freeSeats > 0 ? 1 : 0.35);
  while (state.sim.spawnAccumulator >= 1) {
    state.sim.spawnAccumulator -= 1;
    const c = makeCustomer(state, rng);
    if (!c) break;
    const door = state.layout.door;
    c.x = state.layout.outside?.x ?? door.x;
    c.y = state.layout.outside?.y ?? (state.layout.gridH - 0.5);
    const path = findPath(state.layout, { x: door.x, y: door.y }, { x: door.x, y: door.y - 1 });
    c.path = path || [];
    c.pathIndex = 0;
    c.state = 'arriving';
  }
}

function updateCustomers(state, dtMin, rng) {
  const keep = [];
  for (const c of state.sim.customers) {
    c.waitMin = absMinute(state) - c.enterMinute;
    if (c.bubbleUntil && absMinute(state) > c.bubbleUntil) c.bubble = null;

    // 已經在離場的顧客不受任何後續事件影響（例如晚到的餐點）
    if (c.departing) {
      moveEntity(state.layout, c, dtMin);
      if (!c.path.length) c.done = true;
      if (c.done) { continue; }
      keep.push(c);
      continue;
    }

    switch (c.state) {
      case 'arriving': {
        const doorInside = { x: state.layout.door.x, y: state.layout.door.y - 1 };
        if (c.path.length) {
          moveEntity(state.layout, c, dtMin);
          if (atTile(c, doorInside, 0.4)) enterQueue(state, c, doorInside);
          break;
        }
        // 門外的位置不在網格上（y = gridH - 0.5），先用直線走進門口
        const dx = doorInside.x - c.x;
        const dy = doorInside.y - c.y;
        const dist = Math.hypot(dx, dy);
        const step = B.WALK_TILES_PER_MIN * dtMin;
        if (dist <= step || dist < 1e-4) {
          c.x = doorInside.x;
          c.y = doorInside.y;
          enterQueue(state, c, doorInside);
        } else {
          c.x += (dx / dist) * step;
          c.y += (dy / dist) * step;
          c.dir = dx > 0 ? 'E' : dx < 0 ? 'W' : (dy > 0 ? 'S' : 'N');
          c.frame = (c.frame + dtMin * 2.4) % 2;
        }
        break;
      }
      case 'queueing': {
        moveEntity(state.layout, c, dtMin);
        updateMood(state, c, dtMin);
        const { freeSeats } = availability(state);
        if (freeSeats > 0) tryCreateSeatTask(state, c);
        // 服務生忙不過來時，客人會自己找位子坐（原作客人也不會一直站著等）
        if (freeSeats > 0 && c.waitMin > 4 && !seatTaskClaimed(state, c)) {
          selfSeat(state, c);
          break;
        }
        if (c.waitMin > c.patience || c.mood <= B.MOOD.angryLeave) {
          customerLeaves(state, c, freeSeats > 0 ? 'wait_too_long' : 'no_table');
        } else if (c.waitMin > c.patience * 0.6 && !c.bubble) {
          setBubbleVia(state, c, 'clock');
        }
        break;
      }
      case 'toSeat': {
        if (!c.path.length && c.seat && !atTile(c, c.seat, 0.25)) {
          // 走不到位子（動線被擋住）就重新找路，找不到就生氣離開，避免卡死
          if (!setPathTo(state.layout, c, c.seat)) {
            customerLeaves(state, c, 'no_table');
            break;
          }
        }
        moveEntity(state.layout, c, dtMin);
        if (c.seat && atTile(c, c.seat, 0.22)) {
          const table = state.sim.tables.find((t) => t.uid === c.tableUid);
          if (table && !table.occupants.includes(c.uid)) table.occupants.push(c.uid);
          if (table) table.state = 'occupied';
          c.state = 'ordering';
          c.seatMinute = state.absMinute ?? state.minute;
          c.dir = c.seatedDir || 'S';
          c.frame = 0;
        } else if (c.waitMin > c.patience * 1.3) {
          customerLeaves(state, c, 'no_table');
        }
        break;
      }
      case 'ordering': {
        updateMood(state, c, dtMin);
        if (!state.sim.tasks.some((t) => t.kind === 'order' && t.customerUid === c.uid)) {
          createTask(state, 'order', { customerUid: c.uid, tableUid: c.tableUid });
        }
        if (c.waitMin > c.patience * 1.4) customerLeaves(state, c, 'wait_too_long');
        break;
      }
      case 'waitingFood': {
        updateMood(state, c, dtMin);
        if (c.waitMin > c.patience) customerLeaves(state, c, 'wait_too_long');
        break;
      }
      case 'eating': {
        updateMood(state, c, dtMin);
        if (c.eatDoneMinute === null || c.eatDoneMinute === undefined) {
          c.eatDoneMinute = absMinute(state) + B.EATING_MIN + (c.order.length * B.EATING_PER_PORTION);
        }
        state.absEatDone = c.eatDoneMinute;
        if (absMinute(state) >= c.eatDoneMinute) {
          c.state = 'paying';
          // 有人負責櫃台結帳時，客人自己到櫃台付錢（省下服務生一趟）
          if (hasCashierOnShift(state)) c.selfPayAt = absMinute(state) + 5;
          else createTask(state, 'cash', { customerUid: c.uid, tableUid: c.tableUid });
        }
        break;
      }
      case 'paying': {
        updateMood(state, c, dtMin);
        if (c.selfPayAt && absMinute(state) >= c.selfPayAt) { collectPayment(state, c); break; }
        const waited = absMinute(state) - (state.absEatDone ?? state.absMinute);
        if (waited > 12) {
          // 沒人來結帳：客人自己去櫃台付錢（避免死鎖）
          collectPayment(state, c);
        }
        break;
      }
      case 'leaving':
      case 'angry': {
        moveEntity(state.layout, c, dtMin);
        if (c.path.length === 0) { c.done = true; }
        break;
      }
      default: break;
    }

    if (c.done) {
      releaseSeat(state, c);
      state.sim.customersLost += c.leftAngry ? 1 : 0;
      continue;
    }
    // 全域保險：等太久（含任何異常狀況）一律請客人離開，避免時間卡住
    const absNow = absMinute(state);
    if (c.state !== 'eating' && c.waitMin > c.patience * 2.2) {
      customerLeaves(state, c, 'wait_too_long');
    }
    // 打烊後超過 90 分鐘強制清場
    if (state.phase === 'closing' && state.sim.closingSince) {
      if (absNow - state.sim.closingSince > 90) {
        if (c.state !== 'leaving' && c.state !== 'angry') customerLeaves(state, c, 'closed');
      }
    }
    keep.push(c);
  }
  state.sim.customers = keep;
}

function setBubbleVia(state, c, kind) {
  c.bubble = kind;
  c.bubbleUntil = absMinute(state) + 3;
}

function enterQueue(state, c, doorInside) {
  c.state = 'queueing';
  c.enterMinute = state.absMinute ?? state.minute;
  c.x = doorInside.x;
  c.y = doorInside.y;
  const stop = queueSpot(state, c);
  if (!atTile(c, stop, 0.1)) setPathTo(state.layout, c, stop);
}

function queueSpot(state, c) {
  const door = state.layout.door;
  const idx = state.sim.customers.filter((x) => x.state === 'queueing').indexOf(c);
  const candidates = [
    { x: door.x, y: door.y - 1 }, { x: door.x - 1, y: door.y - 1 }, { x: door.x + 1, y: door.y - 1 },
    { x: door.x - 2, y: door.y - 1 }, { x: door.x + 2, y: door.y - 1 }
  ];
  const spot = candidates[clamp(idx, 0, candidates.length - 1)];
  if (isWalkableTile(state.layout, spot.x, spot.y)) return spot;
  const alt = nearestWalkable(state.layout, spot.x, spot.y);
  return alt || { x: door.x, y: door.y - 1 };
}

function seatTaskClaimed(state, c) {
  const task = state.sim.tasks.find((t) => t.kind === 'seat' && t.customerUid === c.uid);
  return !!(task && task.claimedBy);
}

/** 客人自己找位子坐（服務生太忙時） */
function selfSeat(state, c) {
  const table = pickTableFor(state, c);
  if (!table) return false;
  const seatIndex = freeSeatIndices(state, table)[0];
  if (seatIndex === undefined) return false;
  const seat = table.seats[seatIndex];
  state.sim.tasks = state.sim.tasks.filter((t) => !(t.kind === 'seat' && t.customerUid === c.uid));
  c.tableUid = table.uid;
  c.seat = { x: seat.x, y: seat.y };
  c.seatedDir = seat.facing;
  c.state = 'toSeat';
  c.selfSeated = true;
  if (!setPathTo(state.layout, c, { x: seat.x, y: seat.y })) {
    if (atTile(c, seat, 0.3)) {
      c.state = 'ordering';
      c.seatMinute = state.absMinute ?? state.minute;
      if (!table.occupants.includes(c.uid)) table.occupants.push(c.uid);
      table.state = 'occupied';
    } else {
      c.tableUid = null;
      c.seat = null;
      c.state = 'queueing';
      return false;
    }
  }
  createTask(state, 'order', { customerUid: c.uid, tableUid: table.uid });
  return true;
}

/** 這張桌子目前可用的座位索引 */
export function freeSeatIndices(state, table) {
  const taken = new Set();
  for (const uid of table.occupants) {
    const other = state.sim.customers.find((x) => x.uid === uid);
    if (other && other.seat) taken.add(`${other.seat.x},${other.seat.y}`);
  }
  for (const task of state.sim.tasks) {
    if (task.kind !== 'seat' || task.tableUid !== table.uid) continue;
    const s = table.seats[task.seatIndex];
    if (s) taken.add(`${s.x},${s.y}`);
  }
  const out = [];
  table.seats.forEach((s, i) => {
    if (!s.reachDoor || !s.reachPass) return;
    if (taken.has(`${s.x},${s.y}`)) return;
    out.push(i);
  });
  return out;
}

function tryCreateSeatTask(state, c) {
  if (state.sim.tasks.some((t) => t.kind === 'seat' && t.customerUid === c.uid)) return;
  const table = pickTableFor(state, c);
  if (!table) return;
  const seatIndex = freeSeatIndices(state, table)[0];
  if (seatIndex === undefined) return;
  createTask(state, 'seat', { customerUid: c.uid, tableUid: table.uid, seatIndex });
}

/** 選桌：優先乾淨、離出餐口近、座位數剛好的桌子（動線越好翻桌越快） */
export function pickTableFor(state, c) {
  const pass = (state.layout.passTiles || [])[0] || { x: 3, y: 4 };
  const options = [];
  for (const t of state.sim.tables) {
    // 只有「待收桌」的桌子不能用；使用中的桌子只要還有空位就能再帶客
    if (!t.usable || t.state === 'dirty') continue;
    const free = freeSeatIndices(state, t);
    if (!free.length) continue;
    const dist = Math.abs(t.x - pass.x) + Math.abs(t.y - pass.y);
    options.push({ table: t, score: 20 - dist + free.length * 0.5 });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  return options[0].table;
}

/* ------------------------------------------------------ 環境、任務、到貨 */

function updateRestaurant(state, dtMin, rng) {
  const seated = state.sim.customers.filter((c) => c.state === 'eating' || c.state === 'waitingFood').length;
  state.sim.dirt.floor = clamp(state.sim.dirt.floor + seated * 0.008 * dtMin, 0, 100);
  state.sim.dirt.restroom = clamp(state.sim.dirt.restroom + seated * 0.02 * dtMin, 0, 100);

  // 設備自然損耗
  if (rng.chance(0.0012 * dtMin)) {
    const items = state.layout.items.filter((i) => !i.broken);
    const target = items.length ? rng.pick(items) : null;
    if (target) {
      target.durability = clamp((target.durability ?? 100) - rng.int(4, 12), 0, 100);
      if (target.durability <= 8) {
        target.broken = true;
        pushLog(state, '有傢俱壞掉了，記得維修', 'warn');
      }
    }
  }
}

function autoTasks(state) {
  // 髒桌
  for (const t of state.sim.tables) {
    if (t.state === 'dirty' && !t.occupants.length) {
      createTask(state, 'bus', { tableUid: t.uid });
    }
  }
  // 清潔
  if (state.sim.dirt.restroom > 45 && state.staff.some((s) => s.role === 'waiter' && s.duties?.cleanRestroom)) {
    createTask(state, 'cleanRestroom', { cleanTarget: 'restroom' });
  }
  if (state.sim.dirt.floor > 55 && state.staff.some((s) => s.role === 'waiter' && s.duties?.cleanFloor)) {
    createTask(state, 'cleanFloor', { cleanTarget: 'floor' });
  }
  // 等太久的結帳任務
  for (const c of state.sim.customers) {
    if (c.state === 'paying' && !state.sim.tasks.some((t) => t.kind === 'cash' && t.customerUid === c.uid)) {
      createTask(state, 'cash', { customerUid: c.uid, tableUid: c.tableUid });
    }
  }
}

function deliverSuppliers(state) {
  if (!state.suppliers.length) return;
  const now = absMinute(state);
  const arrived = state.suppliers.filter((s) => s.arriveMinute <= now);
  if (!arrived.length) return;
  state.suppliers = state.suppliers.filter((s) => s.arriveMinute > now);
  for (const s of arrived) {
    state.stock[s.dishId] = (state.stock[s.dishId] || 0) + s.servings;
    pushLog(state, `${getDish(s.dishId)?.name || s.dishId} 進貨 ${s.servings} 份到貨`, 'info');
  }
  state.uiQueue.push({ type: 'toast', message: `進貨到貨：${arrived.map((a) => `${getDish(a.dishId)?.name || a.dishId}×${a.servings}`).join('、')}`, kind: 'good' });
}

function checkBankruptcy(state, dtMin) {
  if (state.cash >= 0) return;
  state.flags.negativeCashDays = (state.flags.negativeCashDays || 0) + dtMin / 1440;
  if (state.flags.negativeCashDays >= B.BANKRUPT_DAYS) {
    state.phase = 'gameover';
    pushLog(state, '資金週轉不靈，餐廳結束營業…', 'bad');
    state.uiQueue.push({ type: 'gameover' });
  }
}

/* --------------------------------------------------------------- 每日結算 */

export function finishDay(state) {
  const record = finalizeDay(state);
  state.phase = 'closed';
  state.minute = Math.min(1439, state.settings.closeMinute);
  state.minuteFloat = state.minute;
  dailyFame(state, record);

  let weekly = null;
  if (state.day % 7 === 0) {
    weekly = withRng(state, (rng) => runWeeklySettlement(state, rng));
    checkStars(state);
    checkDropStar(state);
    checkAnnualAward(state);
    state.uiQueue.push({ type: 'settle', week: weekly.week, day: state.day });
  }

  if (state.cash >= 0) state.flags.negativeCashDays = 0;

  // 隔日候選名單與員工疲勞
  for (const st of state.staff) {
    st.fatigue = clamp((st.fatigue ?? 0) - B.FATIGUE_REST_PER_DAY, 0, 100);
  }
  // 心情太差可能離職
  withRng(state, (rng) => checkResignations(state, rng));

  pushLog(state, `第 ${state.day} 天結算：營業額 NT$ ${record.revenue.toLocaleString('en-US')}，淨利 NT$ ${record.profit.toLocaleString('en-US')}，來客 ${record.guests} 人`, record.profit >= 0 ? 'good' : 'bad');
  state.uiQueue.push({ type: 'dayEnd', day: state.day, record });
  return record;
}

/** 進入隔天 */
export function nextDay(state) {
  if (state.phase !== 'closed') return false;
  state.day += 1;
  state.flags.negativeCashDays = state.flags.negativeCashDays || 0;
  beginDay(state);
  state.phase = 'build';
  return true;
}

/* ------------------------------------------------------------------ 工具 */

export function restaurantSummary(state) {
  const loc = getLocation(state.locationId);
  const tables = state.sim.tables || [];
  return {
    locationName: loc?.name || '',
    seats: seatCount(tables),
    tables: tables.filter((t) => t.usable).length,
    decor: decorScore(state.layout, loc).total,
    staffOnShift: state.staff.filter((s) => s.working).length,
    waiters: state.staff.filter((s) => s.role === 'waiter').length,
    chefs: state.staff.filter((s) => s.role === 'chef').length,
    freeSeats: availability(state).freeSeats,
    menuCount: state.menu.filter((m) => m.active).length,
    unlocksAt: locationsForStars(state.stars).map((l) => l.name),
    dishes: dishesForStars(state.stars).length
  };
}

export { ingredientCost, dishScoreFor, valueScoreFor, REASON_TEXT, releaseSeat, cancelTasksFor };
