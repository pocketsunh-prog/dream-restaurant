// ============================================================================
// staffai.js — 員工 AI：排班、職務、任務分派、動線、廚房出餐
// 考據：服務生負責的桌數與「廚房出餐口距離」相關；離廚房越遠負責桌數越少。
// ============================================================================
import { getDish } from '../data/dishes.js';
import { findPath, tileDistance } from './pathfind.js';
import { isWalkableTile } from './build.js';
import * as B from '../core/balance.js';
import { clamp } from './economy.js';
import { moveEntity, setPathTo, atTile, customerLeaves, releaseSeat, setBubble, chooseOrder, seatParty, eatingMinutes } from './customer.js';
import { pushLog } from '../core/state.js';

const TASK_PRIORITY = {
  deliver: 100,
  order: 95,
  seat: 88,
  cash: 85,
  bus: 50,
  cleanRestroom: 40,
  cleanFloor: 35
};

let taskSeq = 1;

export function createTask(state, kind, data = {}) {
  // 同種任務對同一目標不重複建立
  const dup = state.sim.tasks.find((t) =>
    t.kind === kind &&
    (data.tableUid === undefined || t.tableUid === data.tableUid) &&
    (data.customerUid === undefined || t.customerUid === data.customerUid) &&
    (data.target === undefined || t.cleanTarget === data.target));
  if (dup) return dup;
  const task = {
    id: `t${taskSeq++}`,
    kind,
    createdMinute: state.absMinute ?? state.minute,
    claimedBy: null,
    ...data
  };
  state.sim.tasks.push(task);
  return task;
}

export function cancelTasksFor(state, pred) {
  state.sim.tasks = state.sim.tasks.filter((t) => !pred(t));
}

export function onShift(state, st) {
  if (!state.settings.openDays[(state.day - 1) % 7]) return false;
  const m = state.minute;
  const { start, end } = st.shift || { start: 0, end: 1440 };
  if (start === end) return false;
  if (start < end) return m >= start && m < end;
  return m >= start || m < end;   // 跨夜班
}

export function dutiesOf(st) {
  return st.duties || {};
}

/** 該員工是否願意／能夠處理這個任務 */
export function canHandle(st, task) {
  const d = dutiesOf(st);
  if (st.role === 'chef') return false;
  switch (task.kind) {
    case 'seat': return !!d.escort;
    case 'order': return !!d.order;
    case 'deliver': return !!d.serve;
    case 'bus': return !!d.bus;
    case 'cash': return !!d.cashier || !!d.serve;
    case 'cleanRestroom': return !!d.cleanRestroom;
    case 'cleanFloor': return !!d.cleanFloor;
    default: return false;
  }
}

/** 任務的目標座標 */
export function taskTile(state, task) {
  const layout = state.layout;
  if (task.kind === 'deliver') {
    if (task.stage === 'pickup' || !task.stage) {
      const pass = layout.passTiles || [];
      return pass.length ? pass[0] : { x: 1, y: 1 };
    }
  }
  const table = state.sim.tables.find((t) => t.uid === task.tableUid);
  if (table && table.serviceTile) return { x: table.serviceTile.x, y: table.serviceTile.y };
  if (task.kind === 'seat') {
    const door = layout.door;
    const spot = { x: door.x, y: door.y - 1 };
    return isWalkableTile(layout, spot.x, spot.y) ? spot : door;
  }
  if (task.kind === 'cleanRestroom') {
    const r = (layout.restroomTiles || [])[0];
    if (r) return nearestWalkable(layout, r.x, r.y);
  }
  if (task.kind === 'cleanFloor') {
    const door = layout.door;
    return { x: door.x, y: Math.max(1, door.y - 2) };
  }
  return { x: Math.round(state.sim.tables[0]?.x ?? 4), y: Math.round(state.sim.tables[0]?.y ?? 6) };
}

function nearestWalkable(layout, x, y) {
  if (isWalkableTile(layout, x, y)) return { x, y };
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (isWalkableTile(layout, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

/** 距離越遠的服務生，能負責的桌數越少（原作核心設計） */
export function tableCapacityFor(state, st, table) {
  const pass = (state.layout.passTiles || [])[0] || { x: 3, y: 4 };
  const dist = Math.abs(table.x - pass.x) + Math.abs(table.y - pass.y);
  const norm = clamp(dist / 18, 0, 1);
  const base = Math.round(6 * (1 - norm * 0.8));
  return clamp(base, 1, 6);
}

/** 更新員工（排班、薪資、疲勞、移動、任務） */
export function updateStaff(state, dtMin, rng) {
  const mins = dtMin * 60;
  const hourFrac = mins / 60;

  for (const st of state.staff) {
    const shouldWork = onShift(state, st) && state.phase !== 'build' && state.phase !== 'settle' && state.phase !== 'gameover';
    if (shouldWork !== st.working) {
      st.working = shouldWork;
      if (!shouldWork) {
        st.task = null;
        st.path = [];
        st.pathIndex = 0;
        st.state = 'off';
        st.x = -1; st.y = -1;
        if (st.role === 'chef') releaseChef(state, st);
      } else {
        st.state = 'idle';
        const home = st.role === 'chef' ? chefSlot(state, st) : waiterPost(state, st);
        st.x = home.x; st.y = home.y;
      }
    }
    if (!st.working) {
      st.fatigue = clamp((st.fatigue ?? 0) - B.FATIGUE_RECOVER_PER_HOUR * hourFrac, 0, 100);
      st.mood = clamp((st.mood ?? 70) + 1.6 * hourFrac, 0, 100);
      continue;
    }

    // 薪資（時薪 × 工時）
    const wageCost = (st.wage / 60) * dtMin;
    state.cash -= wageCost;
    state.stats.today.wages += wageCost;
    state.stats.today.spend += wageCost;
    st.hoursToday = (st.hoursToday || 0) + hourFrac;
    st.fatigue = clamp((st.fatigue ?? 0) + B.FATIGUE_PER_HOUR * hourFrac, 0, 100);
    st.mood = clamp((st.mood ?? 70) - (st.fatigue > B.FATIGUE_TIRED ? 0.09 : 0.03) * dtMin, 0, 100);
    st.speedMod = st.fatigue > B.FATIGUE_TIRED ? 0.72 : 1;

    if (st.role === 'chef') {
      updateChef(state, st, dtMin);
      continue;
    }
    updateWaiter(state, st, dtMin, rng);
  }
}

function waiterPost(state, st) {
  const pass = (state.layout.passTiles || [])[0] || { x: 3, y: 5 };
  const idx = state.staff.filter((s) => s.role === 'waiter').indexOf(st);
  const spots = [
    { x: pass.x, y: pass.y + 1 },
    { x: pass.x + 1, y: pass.y + 1 },
    { x: pass.x - 1, y: pass.y + 1 },
    { x: pass.x + 2, y: pass.y + 2 }
  ];
  const spot = spots[Math.max(0, idx) % spots.length];
  return isWalkableTile(state.layout, spot.x, spot.y) ? spot : pass;
}

function chefSlot(state, st) {
  const chefs = state.staff.filter((s) => s.role === 'chef');
  const idx = chefs.indexOf(st);
  const kt = state.layout.kitchenTiles || [];
  const pick = kt[Math.min(kt.length - 1, Math.max(0, idx) * 2 + 1)] || { x: 2, y: 2 };
  return pick;
}

/* ------------------------------------------------------------------ 服務生 */

function updateWaiter(state, st, dtMin, rng) {
  if (st.task) {
    const task = state.sim.tasks.find((t) => t.id === st.task);
    if (!task) { st.task = null; st.state = 'idle'; return; }
    const target = taskTile(state, task);
    if (atTile(st, target, 0.2) || !st.path.length) {
      if (!st.path.length && !atTile(st, target, 0.25)) {
        if (!setPathTo(state.layout, st, target)) { abandonTask(state, st, task, '走不到'); return; }
      }
      if (atTile(st, target, 0.25)) {
        performTask(state, st, task, rng);
        return;
      }
    }
    moveEntity(state.layout, st, dtMin, B.WALK_TILES_PER_MIN * (st.speedMod || 1) * (0.75 + (st.speed ?? 50) / 200));
    // 音響／疲勞讓心情下降（略）
    return;
  }

  st.state = 'idle';
  const task = pickTask(state, st);
  if (!task) {
    // 沒事做就回到定點附近
    if (st.path && st.path.length) {
      moveEntity(state.layout, st, dtMin, B.WALK_TILES_PER_MIN * (st.speedMod || 1));
      return;
    }
    const post = waiterPost(state, st);
    if (tileDistance({ x: st.x, y: st.y }, post) > 1.6) setPathTo(state.layout, st, post);
    if (st.path && st.path.length) moveEntity(state.layout, st, dtMin, B.WALK_TILES_PER_MIN * (st.speedMod || 1));
    return;
  }
  task.claimedBy = st.uid;
  st.task = task.id;
  st.state = 'toTask';
  setPathTo(state.layout, st, taskTile(state, task));
}

function pickTask(state, st) {
  let best = null;
  let bestScore = -Infinity;
  const pass = (state.layout.passTiles || [])[0] || { x: 3, y: 4 };
  for (const task of state.sim.tasks) {
    if (task.claimedBy && task.claimedBy !== st.uid) continue;
    if (!canHandle(st, task)) continue;
    const target = taskTile(state, task);
    const dist = tileDistance({ x: st.x, y: st.y }, target);
    const table = state.sim.tables.find((t) => t.uid === task.tableUid);
    const cap = table ? tableCapacityFor(state, st, table) : 6;
    // 靠近出餐口的服務生優先處理靠近出餐口的桌子
    const distPenalty = dist * 2 + (table ? tileDistance(table, pass) * 0.4 : 0);
    const nowAbs = state.absMinute ?? state.minute;
    const aging = Math.min(60, nowAbs - (task.createdMinute ?? nowAbs)) * 1.1;
    const score = (TASK_PRIORITY[task.kind] ?? 10) + aging - distPenalty + (cap - 3) * 1.2;
    if (score > bestScore) { bestScore = score; best = task; }
  }
  return best;
}

function abandonTask(state, st, task, why) {
  task.claimedBy = null;
  st.task = null;
  st.state = 'idle';
  task.failed = (task.failed || 0) + 1;
  if (task.failed > 4) {
    state.sim.tasks = state.sim.tasks.filter((t) => t.id !== task.id);
  }
}

function performTask(state, st, task, rng) {
  switch (task.kind) {
    case 'seat': return doSeat(state, st, task);
    case 'order': return doOrder(state, st, task, rng);
    case 'deliver': return doDeliver(state, st, task);
    case 'bus': return doBus(state, st, task);
    case 'cash': return doCash(state, st, task);
    case 'cleanRestroom':
    case 'cleanFloor': return doClean(state, st, task);
    default: return abandonTask(state, st, task, '未知任務');
  }
}

function finishTask(state, st, task) {
  state.sim.tasks = state.sim.tasks.filter((t) => t.id !== task.id);
  st.task = null;
  st.state = 'idle';
}

function doSeat(state, st, task) {
  const c = state.sim.customers.find((x) => x.uid === task.customerUid);
  const table = state.sim.tables.find((t) => t.uid === task.tableUid);
  if (!c || !table || c.state !== 'queueing') return finishTask(state, st, task);
  const indices = (task.seatIndices && task.seatIndices.length) ? task.seatIndices : [task.seatIndex ?? 0];
  const seat = table.seats[indices[0]] || table.seats[0];
  if (!seat) return finishTask(state, st, task);
  // 顧客自己走向座位（服務生在前帶位）
  releaseSeat(state, c);
  c.tableUid = table.uid;
  c.seatIndices = indices.slice();
  c.seat = { x: seat.x, y: seat.y };
  c.state = 'toSeat';
  setPathTo(state.layout, c, { x: seat.x, y: seat.y });
  if (!c.path.length && !atTile(c, seat, 0.2)) {
    seatParty(state, c, table, c.seatIndices);
    c.state = 'ordering';
    c.seatMinute = state.absMinute ?? state.minute;
  }
  createTask(state, 'order', { customerUid: c.uid, tableUid: table.uid, delay: 1 });
  finishTask(state, st, task);
}

function doOrder(state, st, task, rng) {
  const c = state.sim.customers.find((x) => x.uid === task.customerUid);
  const table = state.sim.tables.find((t) => t.uid === task.tableUid);
  if (!c || !c.tableUid || c.departing) return finishTask(state, st, task);
  // 服務生剛帶完位，客人才正要坐下：原地等一下再點餐（省下一趟走動）
  if (c.state === 'toSeat') {
    task.waitingForSeat = (task.waitingForSeat || 0) + 1;
    if (task.waitingForSeat <= 3) return;
    return finishTask(state, st, task);
  }
  if (c.state !== 'ordering') return finishTask(state, st, task);

  const order = chooseOrder(state, c, rng);
  if (!order || !order.length) {
    customerLeaves(state, c, 'sold_out');
    setBubble(c, 'angry', state, 3);
    finishTask(state, st, task);
    return;
  }
  c.order = order;
  c.orderMinute = state.absMinute ?? state.minute;
  c.state = 'waitingFood';
  setBubble(c, 'hungry', state, 2);
  for (const item of order) {
    state.stock[item.dishId] = Math.max(0, (state.stock[item.dishId] || 0) - 1);
    enqueueKitchen(state, c, table, item);
  }
  finishTask(state, st, task);
}

function doDeliver(state, st, task) {
  const table = state.sim.tables.find((t) => t.uid === task.tableUid);
  if (!table) return finishTask(state, st, task);
  const customerGone = (uid) => {
    const c = state.sim.customers.find((x) => x.uid === uid);
    return !c || c.departing || c.done || c.state === 'leaving' || c.state === 'angry';
  };
  if (!task.stage || task.stage === 'pickup') {
    const ready = state.sim.pass.filter((p) => p.tableUid === task.tableUid);
    if (!ready.length) return finishTask(state, st, task);
    // 客人已經走了就把餐點丟掉，不用再送
    const alive = ready.filter((p) => !customerGone(p.customerUid));
    if (!alive.length) {
      state.sim.pass = state.sim.pass.filter((p) => p.tableUid !== task.tableUid);
      return finishTask(state, st, task);
    }
    for (const item of alive) item.pickedUp = true;
    task.stage = 'drop';
    st.task = task.id;
    const target = taskTile(state, { ...task, stage: 'drop' });
    setPathTo(state.layout, st, target);
    return;
  }
  // 送達
  const carried = state.sim.pass.filter((p) => p.tableUid === task.tableUid && p.pickedUp);
  state.sim.pass = state.sim.pass.filter((p) => !(p.tableUid === task.tableUid && p.pickedUp));
  for (const item of carried) {
    const c = state.sim.customers.find((x) => x.uid === item.customerUid);
    // 客人若已離場就不可以把狀態改回用餐中
    if (customerGone(item.customerUid)) continue;
    const slot = c.order.find((o) => o.dishId === item.dishId && !o.delivered);
    if (slot) {
      slot.delivered = true;
      slot.score = item.score;
    }
    if (!c.firstFoodMinute) {
      c.firstFoodMinute = state.absMinute ?? state.minute;
      c.dishScoreAvg = item.score;
      c.mood = clamp(c.mood + 8, -100, 100);   // 終於上菜了，心情回升
    } else {
      c.dishScoreAvg = (c.dishScoreAvg + item.score) / 2;
    }
    state.sim.todayDishScores.push(item.score);
    if (c.order.every((o) => o.delivered)) {
      c.state = 'eating';
      c.eatDoneMinute = (state.absMinute ?? state.minute) + eatingMinutes(c);
      setBubble(c, 'happy', state, 2);
      for (const m of c.members || []) m.eating = true;
      const waitMin = Math.max(0, (state.absMinute ?? state.minute) - c.enterMinute);
      state.stats.today.waitSum += waitMin;
      state.stats.today.waitCount += 1;
    }
  }
  finishTask(state, st, task);
  // 這桌還有沒送完的餐點（廚房後續才做好）→ 立刻再排一趟，避免餐點卡在出餐口
  if (state.sim.pass.some((p) => p.tableUid === task.tableUid && !p.pickedUp)) {
    createTask(state, 'deliver', { tableUid: task.tableUid, customerUid: task.customerUid });
  }
}

function doBus(state, st, task) {
  const table = state.sim.tables.find((t) => t.uid === task.tableUid);
  if (!table) return finishTask(state, st, task);
  table.state = 'clean';
  table.dirtySince = null;
  state.sim.dirt.floor = clamp(state.sim.dirt.floor + 0.4, 0, 100);
  finishTask(state, st, task);
}

function doCash(state, st, task) {
  const c = state.sim.customers.find((x) => x.uid === task.customerUid);
  if (!c) return finishTask(state, st, task);
  const tableUid = c.tableUid;
  collectPayment(state, c);
  // 順手收桌：同一趟就把桌子清乾淨，省下再跑一趟
  const table = state.sim.tables.find((t) => t.uid === tableUid);
  if (table && !table.occupants.length && table.state === 'dirty') {
    table.state = 'clean';
    table.dirtySince = null;
    state.sim.tasks = state.sim.tasks.filter((t) => !(t.kind === 'bus' && t.tableUid === table.uid));
  }
  finishTask(state, st, task);
}

function doClean(state, st, task) {
  if (task.kind === 'cleanRestroom') state.sim.dirt.restroom = 0;
  else state.sim.dirt.floor = 0;
  finishTask(state, st, task);
}

/** 結帳（給 staffai 與顧客流程共用） */
export function collectPayment(state, c) {
  // 同一組客人只能結一次帳（服務生與自動結帳可能在同一 tick 都觸發）
  if (c.paid || c.departing || c.done) return { spent: 0, tip: 0 };
  c.paid = true;
  const party = Math.max(1, c.partySize || 1);
  const base = c.order.reduce((s, o) => s + (o.price || 0), 0) *
    (B.TYPE_SPEND[c.type] || 1) * party * B.PARTY_PAY_FACTOR;
  const value = c.order.length
    ? c.order.reduce((s, o) => s + (o.value ?? 1), 0) / c.order.length
    : 1;
  c.valueScore = value;
  c.mood = clamp(c.mood + (value - 1) * 22, -100, 100);
  state.sim.todayValueScores.push(value);
  let tip = 0;
  if (c.mood > B.MOOD.happy) {
    tip = base * B.MOOD.maxTip * (c.mood / 100);
    if (c.type === 'vip') tip *= 1.6;
    setBubble(c, 'money', state, 2.5);
  }
  c.spent = Math.round(base);
  c.tip = Math.round(tip);
  state.cash += c.spent + c.tip;
  state.stats.today.revenue += c.spent;
  state.stats.today.tips += c.tip;
  state.stats.today.served += party;
  state.sim.servedLog.push({ dishIds: c.order.map((o) => o.dishId), spent: c.spent, mood: c.mood, party });
  if (state.sim.servedLog.length > 200) state.sim.servedLog.shift();
  customerLeaves(state, c, null);
  return { spent: c.spent, tip: c.tip };
}

/* -------------------------------------------------------------------- 廚房 */

let kitchenSeq = 1;

export function enqueueKitchen(state, c, table, item) {
  const skill = bestChefOnShift(state);
  const speed = 0.72 + (skill / 200);
  const broken = state.sim.equipBroken?.stove ? 2.1 : 1;
  const cookMinutes = Math.max(1.5, (item.cookTime ?? 25) * B.COOK_TIME_SCALE * (1 / speed) * broken);
  state.sim.kitchen.push({
    id: `k${state.day}_${kitchenSeq++}`,
    dishId: item.dishId,
    tableUid: table.uid,
    customerUid: c.uid,
    score: item.score,
    remaining: cookMinutes,
    total: cookMinutes,
    chefUid: null,
    started: false
  });
}

export function bestChefOnShift(state) {
  const chefs = state.staff.filter((s) => s.role === 'chef' && s.working);
  if (!chefs.length) return 30;
  return Math.max(...chefs.map((c) => c.skill ?? 50));
}

export function updateChef(state, st, dtMin) {
  const home = chefSlot(state, st);
  st.x = home.x; st.y = home.y;
  st.frame = (st.frame + dtMin * 1.5) % 2;

  // 一位廚師同時可顧 CHEF_POTS 個鍋子（多請廚師＝同時出更多菜）
  let mine = state.sim.kitchen.filter((k) => k.chefUid === st.uid);
  for (const job of mine) job.started = true;
  while (mine.length < B.CHEF_POTS) {
    const free = state.sim.kitchen.find((k) => !k.chefUid);
    if (!free) break;
    free.chefUid = st.uid;
    free.started = true;
    mine.push(free);
  }
  if (!mine.length) { st.state = 'idle'; return; }
  st.state = 'cooking';

  // 爐具故障不是完全停擺，而是產能大幅下降（記得去修，否則客人等太久）
  const brokenMod = state.sim.equipBroken?.stove ? 0.6 : 1;
  const speedMod = (0.75 + (st.skill ?? 50) / 200) * (st.speedMod || 1) * brokenMod;
  const done = [];
  for (const job of mine) {
    job.remaining -= dtMin * speedMod;
    if (job.remaining <= 0) { job.remaining = 0; done.push(job); }
  }
  for (const job of done) {
    const c = state.sim.customers.find((x) => x.uid === job.customerUid);
    state.sim.kitchen = state.sim.kitchen.filter((k) => k.id !== job.id);
    if (c && (c.state === 'waitingFood' || c.state === 'ordering')) {
      state.sim.pass.push({ ...job, readyAt: state.minute, pickedUp: false });
      createTask(state, 'deliver', { tableUid: job.tableUid, customerUid: job.customerUid });
    }
  }
}

function releaseChef(state, st) {
  for (const job of state.sim.kitchen) {
    if (job.chefUid === st.uid) { job.chefUid = null; job.started = false; }
  }
}

/* --------------------------------------------------------------- 離職判定 */

export function checkResignations(state, rng) {
  const quitters = [];
  for (const st of state.staff) {
    if (st.role === 'chef' && state.staff.filter((s) => s.role === 'chef').length <= 1) continue;
    if ((st.mood ?? 70) < B.MOOD_QUIT && rng.chance(0.004)) quitters.push(st);
  }
  for (const st of quitters) {
    state.staff = state.staff.filter((s) => s.uid !== st.uid);
    cancelTasksFor(state, (t) => t.claimedBy === st.uid);
    pushLog(state, `${st.name} 因為心情太差離職了…`, 'bad');
    state.uiQueue.push({ type: 'toast', message: `${st.name} 離職了！記得調薪或減少工時`, kind: 'bad' });
  }
  return quitters;
}

export function refreshCandidates(state, rng, count = 5) {
  // 由 actions/state 提供候選名單，這裡只負責每週換一批
  return state.candidates;
}
