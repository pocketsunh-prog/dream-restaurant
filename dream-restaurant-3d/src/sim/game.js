// ============================================================================
// game.js — 3D 版核心模擬（無 DOM、可單獨測試）
//   顧客生命週期：進店 → 帶位 → 點餐 → 等餐 → 用餐 → 結帳 → 離店
//   一個「group（組）」= 一組客人（1~6 人），佔用同桌多個座位。
// ============================================================================
import { LOCATIONS, locationById } from '../data/locations.js';
import { DISHES, dishById } from '../data/dishes.js';

/* ---------------------------------------------------------------- 常數 */

export const OPEN_MINUTE = 11 * 60;
export const CLOSE_MINUTE = 23 * 60;
export const START_CASH = 1_200_000;

export const WEATHERS = ['sunny', 'cloudy', 'rain', 'snow'];
export const WEATHER_JP = { sunny: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪' };
export const WEATHER_TRAFFIC = { sunny: 1.0, cloudy: 0.94, rain: 0.78, snow: 0.66 };

/** 顧客類型：來店時段權重（0-23 時）＋每組人數範圍＋消費倍率 */
export const CUSTOMER_KINDS = {
  office:  { jp: '会社員', zh: '上班族', party: [1, 2], spend: 1.15, patience: 1.0,  hours: { 11: 2.0, 12: 3.0, 13: 2.2, 18: 2.2, 19: 2.6, 20: 2.4, 21: 1.4 } },
  student: { jp: '学生',   zh: '學生',   party: [1, 3], spend: 0.8,  patience: 1.25, hours: { 12: 1.8, 13: 1.6, 17: 1.6, 18: 1.8, 19: 1.6, 20: 1.2 } },
  tourist: { jp: '観光客', zh: '觀光客', party: [2, 4], spend: 1.3,  patience: 1.1,  hours: { 11: 1.4, 12: 1.8, 13: 1.8, 14: 1.6, 17: 1.2, 18: 1.4, 19: 1.4 } },
  family:  { jp: '家族連れ', zh: '家庭客', party: [3, 5], spend: 1.05, patience: 0.95, hours: { 11: 1.2, 12: 1.6, 17: 1.8, 18: 2.0, 19: 1.8, 20: 1.2 } },
  couple:  { jp: 'カップル', zh: '情侶',  party: [2, 2], spend: 1.25, patience: 1.15, hours: { 18: 2.0, 19: 2.4, 20: 2.2, 21: 1.6, 22: 1.0 } },
  elder:   { jp: 'ご年配',  zh: '銀髮族', party: [1, 2], spend: 0.95, patience: 1.4,  hours: { 11: 1.6, 12: 1.4, 17: 1.4, 18: 1.2 } },
  party:   { jp: '宴会',   zh: '聚餐團', party: [4, 6], spend: 1.35, patience: 0.9,  hours: { 18: 2.2, 19: 2.4, 20: 2.0, 21: 1.2 } }
};

export const KIND_IDS = Object.keys(CUSTOMER_KINDS);

const KIND_JP = Object.fromEntries(Object.entries(CUSTOMER_KINDS).map(([k, v]) => [k, v.jp]));

/* ---------------------------------------------------------------- 亂數 */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------- 店內平面配置 */

/**
 * 產生餐廳平面：回傳桌子、座位、廚房、櫃台、入口等 3D 座標（公尺）。
 * 房間固定 13.2 × 9.6 m，原點在房間中心，入口在南側（+Z）。
 */
export function buildFloorPlan(seed = 1, rooms = {}) {
  const rng = mulberry32(seed >>> 0);
  const W = 13.2, D = 9.6;

  const tables = [];
  const mk = (id, x, z, seats, style) => {
    const t = { id, x, z, seats, style, occupants: [], seatPos: [], occupied: false, kind: 'free', dirty: 0 };
    // 座位環繞桌子（順時針），面向桌心
    const R = style === 'chabudai' ? 0.78 : 0.82;
    for (let i = 0; i < seats; i++) {
      const ang = (i / seats) * Math.PI * 2 + (style === 'chabudai' ? Math.PI / 4 : 0);
      t.seatPos.push({ x: x + Math.cos(ang) * R, z: z + Math.sin(ang) * R, ry: -ang + Math.PI });
    }
    tables.push(t);
    return t;
  };

  // 靠窗（北側）四人桌兩排
  const cols = [-4.6, -1.9, 0.8];
  const rows = [-2.55, 0.15];
  let n = 0;
  for (const z of rows) {
    for (const x of cols) {
      mk('t' + (++n), x + (rng() - 0.5) * 0.12, z + (rng() - 0.5) * 0.12, 4, 'table');
    }
  }
  // 南側兩張二人桌
  mk('t' + (++n), -4.9, 2.7, 2, 'table');
  mk('t' + (++n), -3.1, 2.75, 2, 'table');
  // 榻榻米座敷：兩張矮桌（各 4 席，坐地墊）
  mk('t' + (++n), 3.5, 2.5, 4, 'chabudai');
  mk('t' + (++n), 5.3, 2.5, 4, 'chabudai');

  const plan = {
    width: W,
    depth: D,
    tables,
    counter: { x: -5.2, z: -0.3, len: 3.4 },     // 吧台（西側）
    kitchen: { x: 3.6, z: -3.4, w: 5.6, d: 2.2 }, // 廚房（東北）
    pass: { x: 2.0, z: -2.3 },                    // 出餐口
    entrance: { x: 1.2, z: D / 2 - 0.1 },         // 入口（南）
    outside: { x: 1.2, z: D / 2 + 3.2 },          // 店外排隊起點
    tatami: { x: 4.4, z: 2.5, w: 4.4, d: 3.4 },   // 榻榻米區
    staffSpots: [
      { role: 'chef', x: 3.8, z: -3.5, ry: Math.PI },
      { role: 'chef', x: 5.4, z: -3.5, ry: Math.PI },
      { role: 'waiter', x: 0.4, z: 0.6, ry: 0 },
      { role: 'waiter', x: -2.4, z: -0.4, ry: 0 }
    ],
    ...rooms
  };
  return plan;
}

/* ------------------------------------------------- 名物（在地招牌菜） */

/**
 * locations.js 的 specialties 用的是較廣的料理 id 集合，其中 10 個在 dishes.js
 * 沒有對應條目。這裡做正式對照（不修改資料檔），確保「名物」加成永遠能解析到真實菜色。
 */
export const SPECIALTY_ALIAS = {
  sushi: 'nigiri_sushi',
  unagi: 'unagi_don',
  donburi: 'gyudon',
  curry_rice: 'curry_udon',
  champon: 'ramen',
  soki_soba: 'soba',
  gyoza_okinawa: 'gyoza',
  kissaten_set: 'teishoku',
  yakiniku: 'yakitori',
  shabu_shabu: 'oden'
};

/** 把地點的 specialties 解析成 dishes.js 真的存在的 dish id（去重、保序） */
export function resolveSpecialties(loc) {
  const out = [];
  for (const raw of loc?.specialties || []) {
    const id = dishById(raw) ? raw : SPECIALTY_ALIAS[raw];
    if (id && dishById(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 目前菜單中啟用中的名物數量（給客流與客單價加成用） */
export function activeSpecialtyCount(state) {
  const loc = locationById(state.locationId);
  const sp = resolveSpecialties(loc);
  if (!sp.length) return 0;
  return state.menu.filter((m) => m.active && sp.includes(m.id)).length;
}

/* ------------------------------------------------------------ 事件 */

/**
 * 事件佇列：模擬層只負責記錄「發生了什麼」，音效／特效由呈現層消費。
 * 最多保留 64 筆，避免長時間沒消費時無限成長。
 */
export function emit(state, type, data = {}) {
  if (!Array.isArray(state.events)) state.events = [];
  state.events.push({ type, at: state.minute, ...data });
  if (state.events.length > 64) state.events.splice(0, state.events.length - 64);
}

/** 取出並清空事件（呈現層每幀呼叫一次） */
export function drainEvents(state) {
  const out = Array.isArray(state.events) ? state.events : [];
  state.events = [];
  return out;
}

/* ------------------------------------------------------------ 建立遊戲 */

export function createGame({ locationId = 'tokyo_shibuya', seed = 20240601 } = {}) {
  const loc = locationById(locationId) || LOCATIONS[0];
  const state = {
    version: 1,
    seed,
    rng: mulberry32(seed),
    day: 1,
    minute: OPEN_MINUTE,
    minuteFloat: OPEN_MINUTE,
    speed: 1,
    paused: false,
    phase: 'open',            // open | closing | settle
    locationId: loc.id,
    cash: START_CASH,
    stars: 1,
    fame: 12,
    menu: [],
    plan: buildFloorPlan(seed),
    groups: [],               // 客人組
    queue: [],                // 候位
    staff: [],
    events: [],               // 給音效／特效消費的事件佇列
    today: emptyDay(),
    history: [],
    weather: 'sunny',
    log: [],
    nextGroupId: 1,
    servedTotal: 0,
    angryTotal: 0
  };

  // 初始菜單：星級可用的前 6 道（依人氣），並優先放入當地名物
  const specialties = resolveSpecialties(loc);
  const avail = DISHES.filter((d) => d.stars <= state.stars).sort((a, b) => b.popularity - a.popularity);
  const picked = [];
  for (const id of specialties) {
    const d = dishById(id);
    if (d && d.stars <= state.stars && !picked.includes(id)) picked.push(id);
  }
  for (const d of avail) {
    if (picked.length >= 6) break;
    if (!picked.includes(d.id)) picked.push(d.id);
  }
  for (const id of picked) {
    const d = dishById(id);
    state.menu.push({ id, price: d.price, active: true, stock: 60, specialty: specialties.includes(id) });
  }

  state.weather = rollWeather(state, loc);
  state.staff = state.plan.staffSpots.map((s, i) => ({ id: 's' + i, ...s, busy: 0 }));
  return state;
}

export function emptyDay() {
  return {
    guests: 0, groups: 0, served: 0, angry: 0,
    revenue: 0, cost: 0, tips: 0, walkouts: 0, maxQueue: 0,
    kindCount: {}, dishCount: {}
  };
}

export function rollWeather(state, loc = locationById(state.locationId)) {
  const w = loc?.weather || { sunny: 40, cloudy: 30, rain: 20, snow: 10 };
  const r = state.rng() * 100;
  let acc = 0;
  for (const k of WEATHERS) {
    acc += w[k] || 0;
    if (r < acc) return k;
  }
  return 'sunny';
}

export function money(v) {
  const n = Math.round(Number(v) || 0);
  return '¥' + n.toLocaleString('en-US');
}

/** 平面圖的總座位數 */
export function seatsOfPlan(plan) {
  let n = 0;
  for (const t of plan?.tables || []) n += t.seats;
  return n;
}

export function clockText(minute) {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* -------------------------------------------------------- 客流與生成 */

/** 該小時的來客倍率（依地點顧客組成） */
export function trafficMultiplier(state, loc) {
  const hour = Math.floor(state.minute / 60);
  let mul = 0;
  const mix = loc.customerMix || {};
  for (const [kind, weight] of Object.entries(mix)) {
    if (!weight) continue;
    const def = CUSTOMER_KINDS[kind];
    if (!def) continue;
    const h = def.hours[hour] || 0;
    mul += (weight / 100) * h;
  }
  // 尖峰加成：午餐與晚餐
  if (hour === 12 || hour === 13) mul *= 1.15;
  if (hour === 19) mul *= 1.2;
  const weather = WEATHER_TRAFFIC[state.weather] ?? 1;
  const fame = 0.55 + Math.min(1.6, state.fame / 42);
  const stars = 0.85 + state.stars * 0.09;
  // 名物加成：菜單裡有當地在名物時，客人更願意上門（最多 +28%）
  const spBonus = 1 + Math.min(0.28, activeSpecialtyCount(state) * 0.07);
  return mul * weather * fame * stars * spBonus;
}

/** 挑一位顧客類型（依地點組成加權） */
export function pickKind(state, loc) {
  const hour = Math.floor(state.minute / 60);
  const mix = loc.customerMix || {};
  const pool = [];
  let total = 0;
  for (const [kind, weight] of Object.entries(mix)) {
    if (!weight) continue;
    const def = CUSTOMER_KINDS[kind];
    if (!def) continue;
    const h = (def.hours[hour] || 0) + 0.08;
    const w = weight * h;
    total += w;
    pool.push({ kind, w: total });
  }
  if (!total) return 'office';
  const r = state.rng() * total;
  for (const p of pool) if (r <= p.w) return p.kind;
  return pool[pool.length - 1].kind;
}

function partySizeFor(state, kind) {
  const def = CUSTOMER_KINDS[kind];
  const [a, b] = def.party;
  const raw = a + Math.floor(state.rng() * (b - a + 1));
  // 星級越高越能接到大組（與 2D 版規則一致：上限 2 + 星級）
  return Math.max(1, Math.min(raw, 2 + state.stars));
}

function spawnGroup(state, loc) {
  const kind = pickKind(state, loc);
  const size = partySizeFor(state, kind);
  const def = CUSTOMER_KINDS[kind];
  const g = {
    id: 'g' + (state.nextGroupId++),
    kind,
    kindJp: KIND_JP[kind] || kind,
    size,
    state: 'entering',
    t: 0,
    patience: (150 + state.rng() * 90) * def.patience,
    wait: 0,
    tableId: null,
    seatIdx: [],
    orders: [],
    eatTime: 0,
    paid: 0,
    spend: def.spend,
    walk: { x: state.plan.outside.x, z: state.plan.outside.z, tx: state.plan.outside.x, tz: state.plan.outside.z, speed: 1.15 + state.rng() * 0.35, dir: 0 },
    members: []
  };
  // 每位成員的外觀種子
  for (let i = 0; i < size; i++) {
    g.members.push({ seed: Math.floor(state.rng() * 1e9), seat: -1, eating: false, x: g.walk.x, z: g.walk.z, ry: 0 });
  }
  state.today.kindCount[kind] = (state.today.kindCount[kind] || 0) + 1;
  return g;
}

/** 找一張坐得下的空桌 */
export function findTable(state, size) {
  let best = null;
  for (const t of state.plan.tables) {
    if (t.occupied) continue;
    if (t.seats < size) continue;
    const waste = t.seats - size;
    if (!best || waste < best.waste) best = { t, waste };
  }
  return best ? best.t : null;
}

function orderFor(state, group) {
  const picks = [];
  const actives = state.menu.filter((m) => m.active && (m.stock > 0));
  if (!actives.length) return picks;
  const count = 1 + Math.floor((group.size - 1) / 2) + (state.rng() < 0.45 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const d = actives[Math.floor(state.rng() * actives.length)];
    if (!d) break;
    picks.push(d.id);
    state.today.dishCount[d.id] = (state.today.dishCount[d.id] || 0) + 1;
    d.stock = Math.max(0, d.stock - 1);
  }
  return picks;
}

function dishTime(state, ids) {
  let t = 0;
  for (const id of ids) t += (dishById(id)?.cookTime || 8);
  const chefs = state.staff.filter((s) => s.role === 'chef').length || 1;
  return Math.max(2, (t / chefs) * 0.72);
}

function dishCost(ids, spend) {
  let c = 0;
  for (const id of ids) c += (dishById(id)?.cost || 100);
  return c * spend;
}

function dishRevenue(state, ids, spend, size) {
  const sp = resolveSpecialties(locationById(state.locationId));
  let r = 0;
  for (const id of ids) {
    const d = dishById(id);
    const base = d?.price || 500;
    r += sp.includes(id) ? base * 1.12 : base;   // 名物可以賣貴一點
  }
  return Math.round(r * spend * Math.max(1, size * 0.62));
}

/* ------------------------------------------------------------- 主迴圈 */

export function tick(state, dtMin) {
  if (dtMin <= 0) return;
  const loc = locationById(state.locationId) || LOCATIONS[0];
  state.minuteFloat += dtMin;
  state.minute = state.minuteFloat;
  const groupSize = state.groups.length;

  // 生成客人
  if (state.phase === 'open') {
    const mul = trafficMultiplier(state, loc);
    const perMin = (loc.trafficBase / 60) * mul * 0.5;
    state.spawnAcc = (state.spawnAcc || 0) + perMin * dtMin;
    const cap = 3 + state.stars * 2;
    while (state.spawnAcc >= 1) {
      state.spawnAcc -= 1;
      if (state.groups.length + state.queue.length < cap) {
        const g = spawnGroup(state, loc);
        state.today.groups += 1;
        state.today.guests += g.size;
        state.groups.push(g);
      }
    }
    if (state.minuteFloat >= CLOSE_MINUTE) state.phase = 'closing';
  }

  // 顧客狀態機
  for (const g of state.groups) updateGroup(state, g, dtMin);

  // 移除離店的組
  for (let i = state.groups.length - 1; i >= 0; i--) {
    if (state.groups[i].state === 'gone') state.groups.splice(i, 1);
  }

  // 打烊：等所有客人離開
  if (state.phase === 'closing' && !state.groups.length) state.phase = 'settle';
  void groupSize;
}

function moveToward(w, tx, tz, dtMin) {
  const dx = tx - w.x, dz = tz - w.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.04) { w.x = tx; w.z = tz; return true; }
  const step = Math.min(d, w.speed * dtMin * 0.55);
  w.x += (dx / d) * step;
  w.z += (dz / d) * step;
  w.dir = Math.atan2(dx, dz);
  return false;
}

function updateGroup(state, g, dtMin) {
  const plan = state.plan;
  switch (g.state) {
    case 'entering': {
      g.walk.tx = plan.entrance.x; g.walk.tz = plan.entrance.z;
      const atDoor = moveToward(g.walk, g.walk.tx, g.walk.tz, dtMin);
      syncMembers(g, 'walk');
      if (!atDoor) break;
      emit(state, 'door', { size: g.size, kind: g.kind });
      const table = findTable(state, g.size);
      if (table) {
        table.occupied = true;
        table.groupId = g.id;
        g.tableId = table.id;
        g.state = 'toSeat';
        g.t = 0;
        // 指派座位
        g.seatIdx = [];
        for (let i = 0; i < g.size; i++) {
          g.seatIdx.push(i % table.seats);
          g.members[i].seat = i % table.seats;
        }
      } else {
        g.state = 'queue';
        g.wait = 0;
        state.queue.push(g.id);
        state.today.maxQueue = Math.max(state.today.maxQueue, state.queue.length);
      }
      break;
    }
    case 'queue': {
      g.wait += dtMin;
      const idx = state.queue.indexOf(g.id);
      const slot = Math.max(0, idx);
      g.walk.tx = plan.outside.x - 0.7 * slot;
      g.walk.tz = plan.outside.z + 0.25 * slot;
      moveToward(g.walk, g.walk.tx, g.walk.tz, dtMin);
      syncMembers(g, 'wait');
      // 有位置就入座
      const table = findTable(state, g.size);
      if (table) {
        const qi = state.queue.indexOf(g.id);
        if (qi >= 0) state.queue.splice(qi, 1);
        table.occupied = true;
        table.groupId = g.id;
        g.tableId = table.id;
        g.seatIdx = [];
        for (let i = 0; i < g.size; i++) { g.seatIdx.push(i % table.seats); g.members[i].seat = i % table.seats; }
        g.state = 'toSeat';
        g.t = 0;
        break;
      }
      if (g.wait > g.patience) {
        emit(state, 'angry', { size: g.size, kind: g.kind });
        g.state = 'angryLeave';
        state.today.angry += g.size;
        state.today.walkouts += 1;
        state.angryTotal += g.size;
        const qi = state.queue.indexOf(g.id);
        if (qi >= 0) state.queue.splice(qi, 1);
      }
      break;
    }
    case 'toSeat': {
      const table = tableOf(state, g);
      if (!table) { g.state = 'leaving'; break; }
      g.t += dtMin;
      const seat = table.seatPos[g.seatIdx[0]];
      const arrived = moveToward(g.walk, seat.x, seat.z, dtMin * 1.35);
      syncMembers(g, 'walk');
      if (arrived || g.t > 8) {
        emit(state, 'seat', { size: g.size });
        g.state = 'ordering';
        g.t = 0;
        g.orderWait = 3 + state.rng() * 3;
        // 入座位置
        g.members.forEach((m, i) => {
          const sp = table.seatPos[g.seatIdx[i] % table.seats];
          m.x = sp.x; m.z = sp.z; m.ry = sp.ry;
        });
      }
      break;
    }
    case 'ordering': {
      g.t += dtMin;
      syncMembers(g, 'sit');
      if (g.t >= g.orderWait) {
        g.orders = orderFor(state, g);
        if (!g.orders.length) { g.state = 'leaving'; break; }
        g.cookLeft = dishTime(state, g.orders);
        emit(state, 'order', { dishes: g.orders.length, size: g.size });
        g.state = 'waitingFood';
        state.today.cost += dishCost(g.orders, g.spend);
      }
      break;
    }
    case 'waitingFood': {
      g.cookLeft -= dtMin;
      syncMembers(g, 'sit');
      if (g.cookLeft <= 0) {
        g.eatLeft = 9 + g.orders.length * 3.5 + state.rng() * 5;
        emit(state, 'serve', { size: g.size });
        g.state = 'eating';
      }
      break;
    }
    case 'eating': {
      g.eatLeft -= dtMin;
      syncMembers(g, 'eat');
      if (g.eatLeft <= 0) {
        const table = tableOf(state, g);
        const rev = dishRevenue(state, g.orders, g.spend, g.size);
        const tip = Math.round(rev * (state.stars >= 4 ? 0.06 : 0.03));
        state.cash += rev + tip;
        state.today.revenue += rev;
        state.today.tips += tip;
        state.today.served += g.size;
        state.servedTotal += g.size;
        g.paid = rev + tip;
        emit(state, 'pay', { amount: rev + tip, size: g.size, kind: g.kind });
        if (table) { table.dirty = 1; table.kind = 'dirty'; }
        // 評價
        state.fame = Math.min(100, state.fame + 0.05 * g.size);
        g.state = 'leaving';
        g.t = 0;
      }
      break;
    }
    case 'angryLeave':
    case 'leaving': {
      const done = moveToward(g.walk, plan.outside.x, plan.outside.z, dtMin * 1.3);
      syncMembers(g, g.state === 'angryLeave' ? 'angry' : 'walk');
      if (done || g.t > 30) {
        const table = tableOf(state, g);
        if (table) { table.occupied = false; table.groupId = null; }
        g.state = 'gone';
      }
      g.t += dtMin;
      break;
    }
    default: break;
  }
}

function syncMembers(g, pose) {
  g.pose = pose;
  for (const m of g.members) {
    if (m.seat >= 0 && (pose === 'sit' || pose === 'eat')) continue;
    m.x = g.walk.x; m.z = g.walk.z; m.ry = g.walk.dir;
  }
}

function tableOf(state, g) {
  return state.plan.tables.find((t) => t.id === g.tableId) || null;
}

/* -------------------------------------------------------------- 結算 */

export function settleDay(state) {
  const loc = locationById(state.locationId) || LOCATIONS[0];
  const rent = loc.rentPerDay;
  const util = 3200 + state.plan.tables.length * 260;
  const wages = state.staff.length * 9200;
  const gross = state.today.revenue + state.today.tips;
  const net = gross - state.today.cost - rent - util - wages;
  state.cash += net;

  const served = state.today.served;
  const angry = state.today.angry;
  const rate = served + angry > 0 ? served / (served + angry) : 1;
  state.fame = Math.max(0, Math.min(100, state.fame + (rate - 0.86) * 3.2));

  const report = {
    day: state.day, locationId: loc.id, locationName: loc.name,
    guests: state.today.guests, groups: state.today.groups,
    served, angry, walkouts: state.today.walkouts, maxQueue: state.today.maxQueue,
    revenue: gross, cost: state.today.cost, tips: state.today.tips,
    rent, util, wages, net, cash: state.cash, fame: state.fame,
    kindCount: { ...state.today.kindCount }, dishCount: { ...state.today.dishCount },
    weather: state.weather
  };
  state.history.push(report);

  return report;
}

export function startNextDay(state) {
  state.day += 1;
  state.phase = 'open';
  state.minuteFloat = OPEN_MINUTE;
  state.minute = OPEN_MINUTE;
  state.today = emptyDay();
  state.spawnAcc = 0;
  state.weather = rollWeather(state);
  state.plan.tables.forEach((t) => { t.occupied = false; t.groupId = null; t.dirty = 0; t.kind = 'free'; });
  state.groups.length = 0;
  state.queue.length = 0;
  // 補貨
  for (const m of state.menu) m.stock = Math.max(m.stock, 60);
  return state;
}

export function moveToLocation(state, id) {
  const loc = locationById(id);
  if (!loc) return { ok: false, error: '沒有這個地點' };
  if (state.cash < loc.moveCost) return { ok: false, error: `資金不足（需要 ${money(loc.moveCost)}）` };
  state.cash -= loc.moveCost;
  state.locationId = loc.id;
  state.plan = buildFloorPlan(state.seed + state.day, {});
  state.weather = rollWeather(state, loc);
  return { ok: true, location: loc };
}

export function setStars(state, n) {
  state.stars = Math.max(1, Math.min(5, Math.round(n)));
  return state.stars;
}

export default {
  createGame, tick, settleDay, startNextDay, moveToLocation,
  buildFloorPlan, findTable, money, clockText, trafficMultiplier, setStars
};
