// ============================================================================
// customer.js — 顧客有限狀態機
// ARRIVING → QUEUEING → TO_SEAT → ORDERING → WAITING_FOOD → EATING → PAYING → LEAVING
//                                               ↘ ANGRY（等太久／沒菜／沒位子／環境太差）
// ============================================================================
import { getDish } from '../data/dishes.js';
import { getLocation } from '../data/locations.js';
import { furnitureById } from '../data/furniture.js';
import { findPath, advanceAlong, dirFromDelta, tileDistance } from './pathfind.js';
import { isWalkableTile } from './build.js';
import * as B from '../core/balance.js';
import { clamp } from './economy.js';
import { randomAppearance } from './attract.js';
import { applyCustomerMood, rollOutside } from './rating.js';
import { pushLog } from '../core/state.js';

const TYPE_TAGS = Object.fromEntries(Object.entries(B.CUSTOMER_TYPES).map(([k, v]) => [k, v.tags]));
const TYPE_TASTE = Object.fromEntries(Object.entries(B.CUSTOMER_TYPES).map(([k, v]) => [k, v.taste]));

/** 各地點的額外偏好：哪些客群特別多（用來調整新類型在高雄/台北等地的比例） */
const LOCATION_TYPE_BIAS = {
  zhongli_xinming: { student: 1.5, family: 1.2, regulars: 1.3, soldiers: 1.4, colleagues: 0.9, couple: 1.0 },
  keelung_miaokou: { tourist: 1.5, tour_group: 1.6, family: 1.3, elderly: 1.3, office: 0.7 },
  taipei_nanyang: { office: 1.9, colleagues: 1.7, student: 1.3, cyclist: 1.1, cyclists: 1.2, tour_group: 0.6 },
  taichung_zhonghua: { couple: 1.5, student: 1.3, kids_party: 1.3, blogger: 1.3, regulars: 1.2 },
  tainan_dongdi: { family: 1.6, kids_party: 1.6, elderly: 1.5, office: 0.8, couple: 1.1 },
  kaohsiung_xinkujiang: { couple: 1.8, blogger: 1.6, colleagues: 1.4, student: 1.2, elderly: 0.7 }
};

export function typeName(type) { return B.CUSTOMER_TYPES[type]?.name || '顧客'; }

/** 這一組幾個人的範圍 */
export function partyRange(type) {
  return B.CUSTOMER_TYPES[type]?.party || [1, 2];
}

/** 依地點顧客組成＋知名度抽出顧客類型 */
export function pickCustomerType(state, rng) {
  const loc = getLocation(state.locationId);
  const mix = loc?.customerMix || { student: 0.4, office: 0.2, family: 0.3, tourist: 0.08, critic: 0.015, vip: 0.005 };
  const bias = LOCATION_TYPE_BIAS[state.locationId] || {};
  const h = state.minute / 60;
  const fame = state.fame || 0;
  const weights = [];
  for (const type of Object.keys(B.CUSTOMER_TYPES)) {
    let w = B.TYPE_BASE_WEIGHT[type] || 1;
    // 地點的顧客組成：有列在 mix 裡的類型按比例放大（15% 視為中性）
    const share = mix[type];
    if (share !== undefined) w *= clamp(share / 0.15, 0.35, 2.4);
    w *= bias[type] ?? 1;
    // 知名度帶動「慕名而來」的客群
    if (type === 'critic') w *= 0.6 + fame / 28;
    if (type === 'blogger') w *= 0.7 + fame / 22;
    if (type === 'vip') w *= 0.6 + fame / 26;
    if (type === 'tourist') w *= 0.7 + (state.stars || 1) * 0.12 + fame / 130;
    if (type === 'tour_group') w *= 0.5 + (state.stars || 1) * 0.2 + fame / 90;
    // 時段
    if (h >= 11 && h < 14) { if (type === 'office') w *= 2.2; if (type === 'colleagues') w *= 1.8; if (type === 'couple') w *= 0.6; }
    if (h >= 14 && h < 17) { if (type === 'cyclists' || type === 'elderly') w *= 1.6; if (type === 'office') w *= 0.6; }
    if (h >= 17 && h < 21) { if (type === 'family' || type === 'kids_party' || type === 'colleagues') w *= 1.7; if (type === 'couple') w *= 1.5; }
    if (h >= 21) { if (type === 'student' || type === 'soldiers') w *= 1.7; if (type === 'family' || type === 'kids_party' || type === 'elderly') w *= 0.5; }
    if (h < 11 && h >= 6) { if (type === 'elderly' || type === 'office') w *= 1.4; }
    weights.push({ v: type, w: Math.max(0.0001, w) });
  }
  return rng.weighted(weights) || 'student';
}

export function makeCustomer(state, rng, opts = {}) {
  const type = opts.type || pickCustomerType(state, rng);
  const loc = getLocation(state.locationId);
  const patienceRange = B.PATIENCE[type] || [40, 60];
  const [pMin, pMax] = partyRange(type);
  const starCap = 2 + clamp(state.stars || 1, 1, 5);          // 1★→3人、5★→7人
  const partySize = clamp(rng.int(pMin, pMax), 1, Math.min(8, starCap));
  const outside = rollOutside(state, rng);
  const spawn = state.layout.outside || { x: state.layout.door.x, y: state.layout.gridH - 0.5 };
  const customer = {
    uid: `c${state.day}_${state.sim.customersSpawned}_${Math.floor(rng.next() * 9999)}`,
    type,
    appearance: randomAppearance(rng),
    mood: rng.range(0, 12),
    patience: rng.range(patienceRange[0], patienceRange[1]) * (type === 'office' ? 0.85 : 1) *
      (1 + (partySize - 1) * B.PARTY_PATIENCE_BONUS),
    budget: 0,
    partySize,
    x: spawn.x,
    y: spawn.y,
    dir: 'N',
    frame: 0,
    path: [],
    pathIndex: 0,
    state: 'arriving',
    tableUid: null,
    seat: null,
    seatedDir: 'S',
    enterMinute: state.absMinute ?? state.minute,
    seatMinute: null,
    orderMinute: null,
    firstFoodMinute: null,
    eatDoneMinute: null,
    waitMin: 0,
    order: [],
    dishScoreAvg: 0,
    valueScore: 1,
    spent: 0,
    tip: 0,
    leftAngry: false,
    wasCritic: type === 'critic' || type === 'vip',
    _outsideRoll: outside,
    bubble: null,
    bubbleKind: null,
    bubbleUntil: 0,
    prefTaste: clamp((TYPE_TASTE[type] || 55) + rng.range(-12, 12), 0, 100),
    prefTags: TYPE_TAGS[type] || [],
    queueSpot: null,
    queueIndex: 0,
    memberLooks: Array.from({ length: Math.max(0, partySize - 1) }, () => randomAppearance(rng)),
    seatIndices: [],        // 這組佔用的座位索引
    members: [],            // 給繪圖層用的同桌成員（就座後才有）
    complained: false
  };
  state.sim.customersSpawned += 1;
  state.sim.customers.push(customer);
  // 來客數算「人」；另外記錄「組」數
  state.stats.today.guests += partySize;
  state.stats.today.parties = (state.stats.today.parties || 0) + 1;
  return customer;
}

/* --------------------------------------------------------------- 動線移動 */

/**
 * 沿路徑移動。回傳 { arrived, moved }
 */
export function moveEntity(layout, e, dtMin, tilesPerMinute = B.WALK_TILES_PER_MIN) {
  if (!e.path || e.pathIndex >= e.path.length) return { arrived: true, moved: false };
  const step = tilesPerMinute * dtMin;
  const before = { x: e.x, y: e.y };
  const res = advanceAlong(e.path, e.pathIndex, e.x, e.y, step, dirFromDelta);
  e.x = res.x; e.y = res.y; e.pathIndex = res.index;
  if (res.dir) e.dir = res.dir;
  const moved = before.x !== e.x || before.y !== e.y;
  if (moved) e.frame = (e.frame + dtMin * 2.4) % 2;
  else e.frame = 0;
  if (res.arrived) { e.path = []; e.pathIndex = 0; }
  return { arrived: res.arrived, moved };
}

export function setPathTo(layout, e, target) {
  const from = { x: Math.round(e.x), y: Math.round(e.y) };
  const to = { x: Math.round(target.x), y: Math.round(target.y) };
  const path = findPath(layout, from, to);
  if (!path) return false;
  e.path = path;
  e.pathIndex = 0;
  return true;
}

export function atTile(e, t, tol = 0.12) {
  return Math.abs(e.x - t.x) <= tol && Math.abs(e.y - t.y) <= tol;
}

/* ------------------------------------------------------------- 菜單與計分 */

export function cookTimeScore(cookTime) {
  const t = cookTime ?? 25;
  if (t < 8) return 5;          // 原作：調理時間太短會被當成微波食品，重扣評價
  if (t < 15) return 45;
  if (t < 20) return 72;
  if (t <= 40) return 95;
  if (t <= 50) return 68;
  return 40;
}

export function tasteMatch(entry, customer) {
  return clamp(100 - Math.abs((entry.taste ?? 50) - customer.prefTaste) * 1.4, 0, 100);
}

export function dishScoreFor(state, entry, customer, chefSkill = 45) {
  const def = getDish(entry.dishId) || {};
  const cookScore = cookTimeScore(entry.cookTime);
  let score = (chefSkill * 0.4) + ((entry.grade ?? 50) * 0.35) +
    (tasteMatch(entry, customer) * 0.15) + (cookScore * 0.10);
  if (state.sim.equipBroken?.stove) score *= 0.62;
  if (def.category === 'drink' || def.category === 'alcohol') {
    score = score * 0.35 + (entry.grade ?? 50) * 0.45 + (cookScore * 0.2);
  }
  return clamp(score, 0, 100);
}

export function valueScoreFor(entry) {
  const def = getDish(entry.dishId) || {};
  const expect = def.expectedPrice || (def.baseCost || 20) * 7;
  return clamp(expect / Math.max(1, entry.price), 0, 1.4);
}

/** 顧客點餐：必須至少有一道主食有庫存，否則生氣離開 */
export function chooseOrder(state, customer, rng) {
  const loc = getLocation(state.locationId);
  const active = state.menu.filter((m) => m.active && (state.stock[m.dishId] || 0) > 0);
  if (!active.length) return null;

  const weightOf = (entry, def) => {
    const pop = def.popularity?.[state.locationId] ?? 1;
    let tagScore = 1;
    for (const tag of def.tags || []) if (customer.prefTags.includes(tag)) tagScore += 0.35;
    const value = valueScoreFor(entry);
    return Math.max(0.05, pop * tagScore * (0.4 + value * 0.8));
  };

  const staples = active.filter((m) => getDish(m.dishId)?.category === 'staple');
  if (!staples.length) return null;

  const party = clamp(customer.partySize || 1, 1, 8);
  const base = 1 + Math.floor((party - 1) / 2);
  const count = clamp(base + (rng.chance(0.35) ? 1 : 0), 1, 4);
  const picked = [];
  const staple = rng.weighted(staples.map((m) => ({ v: m, w: weightOf(m, getDish(m.dishId)) })));
  if (staple) picked.push(staple);

  for (let i = 1; i < count; i++) {
    const pool = active.filter((m) => !picked.some((p) => p.dishId === m.dishId) && getDish(m.dishId)?.category !== 'staple');
    if (!pool.length) break;
    const pick = rng.weighted(pool.map((m) => ({ v: m, w: weightOf(m, getDish(m.dishId)) })));
    if (pick) picked.push(pick);
    else break;
  }
  // 飲料或酒：晚上比較會點酒
  if (rng.chance(0.35)) {
    const evening = state.minute >= 16 * 60;
    const drinks = active.filter((m) => {
      const def = getDish(m.dishId);
      if (!def) return false;
      if (def.category === 'drink') return true;
      return def.category === 'alcohol' && evening;
    });
    if (drinks.length) {
      const pick = rng.weighted(drinks.map((m) => ({ v: m, w: weightOf(m, getDish(m.dishId)) })));
      if (pick) picked.push(pick);
    }
  }

  return picked.map((entry) => ({
    dishId: entry.dishId,
    price: entry.price,
    cookTime: entry.cookTime,
    grade: entry.grade,
    taste: entry.taste,
    portion: entry.portion,
    score: dishScoreFor(state, entry, customer, bestChefSkill(state)),
    value: valueScoreFor(entry),
    ready: false,
    delivered: false
  }));
}

export function bestChefSkill(state) {
  const chefs = state.staff.filter((s) => s.role === 'chef' && s.working);
  if (!chefs.length) return state.staff.some((s) => s.role === 'chef') ? 40 : 30;
  return Math.max(...chefs.map((c) => c.skill ?? 50));
}

/* ------------------------------------------------------------------- 心情 */

export function comfortBand(state) {
  const weather = state.sim.weather || 'sunny';
  const shift = B.WEATHER_COMFORT_SHIFT[weather] || 0;
  return { min: B.COMFORT.min + shift, max: B.COMFORT.max + shift };
}

export function temperatureDeviation(state) {
  const band = comfortBand(state);
  // 空調故障只是「比較不舒服」，不會讓客人瞬間暴怒
  if (state.sim.equipBroken?.ac) return 2.5;
  return Math.max(0, band.min - state.settings.acTemp, state.settings.acTemp - band.max);
}

/**
 * 就座：把整組人安排到 seats 這些座位上（第一個是首領坐的位置）。
 * 會建立給繪圖層用的 members（其餘成員的就座位置與外觀）。
 */
export function seatParty(state, customer, table, seatIndices) {
  const seats = seatIndices.map((i) => table.seats[i]).filter(Boolean);
  if (!seats.length) return false;
  customer.seat = { x: seats[0].x, y: seats[0].y };
  customer.seatedDir = seats[0].facing;
  customer.dir = seats[0].facing;
  customer.seatIndices = seatIndices.slice(0, seats.length);
  customer.members = seats.slice(1).map((s, i) => ({
    seat: { x: s.x, y: s.y },
    dir: s.facing,
    appearance: (customer.memberLooks && customer.memberLooks[i]) || customer.appearance,
    eating: false,
    frame: i % 2
  }));
  if (!table.occupants.includes(customer.uid)) table.occupants.push(customer.uid);
  table.state = 'occupied';
  return true;
}

/** 客人離場時把成員清掉（繪圖層就不會再畫同桌的人） */
export function clearParty(customer) {
  customer.members = [];
  customer.seatIndices = [];
}

/** 這組人吃飯要吃多久 */
export function eatingMinutes(customer) {
  return B.EATING_MIN + (customer.order?.length || 0) * B.EATING_PER_PORTION +
    Math.max(0, (customer.partySize || 1) - 1) * B.EATING_PER_GUEST;
}

export function updateMood(state, c, dtMin) {
  const dirt = state.sim.dirt;
  const loc = getLocation(state.locationId);
  let delta = 0;

  if (c.state === 'queueing') delta -= 0.5;
  if (c.state === 'ordering') delta -= 0.2;
  if (c.state === 'waitingFood') {
    const waited = (state.absMinute ?? state.minute) - (c.orderMinute ?? state.absMinute ?? state.minute);
    delta -= 0.45 * clamp(waited / Math.max(8, c.patience), 0, 1.5);
  }
  if (c.state === 'paying') delta -= 0.4;
  if (c.state === 'eating') {
    const quality = (c.dishScoreAvg - 50) / 50;
    delta += 0.9 * quality;
    delta += 0.25;
  }
  // 環境（整間店的舒適度，最多每分鐘扣 0.85，避免單一因素把客人逼走）
  let env = temperatureDeviation(state) * 0.24;
  if (dirt.floor > B.DIRT_BAD) env += 0.3;
  else if (dirt.floor > B.DIRT_COMPLAIN) env += 0.12;
  if (dirt.restroom > B.DIRT_BAD) env += 0.32;
  else if (dirt.restroom > B.DIRT_COMPLAIN) env += 0.14;
  if (state.sim.equipBroken?.ac) env += 0.12;
  delta -= Math.min(0.85, env);

  // 音樂
  const appeal = B.MUSIC_APPEAL[state.settings.music || 'off']?.[c.type] ?? 0.2;
  delta += appeal * 0.3;

  // 音響壞掉會吵
  if (loc?.decorStyle === 'fashion' && state.settings.music === 'off') delta -= 0.1;

  c.mood = clamp(c.mood + delta * dtMin, -100, 100);
  return c.mood;
}

export function setBubble(c, kind, state, minutes = 3) {
  c.bubble = kind;
  c.bubbleKind = kind;
  c.bubbleUntil = (state.absMinute ?? (state.day * 1440 + state.minute)) + minutes;
}

/* --------------------------------------------------------------- 離場處理 */

export function customerLeaves(state, c, reason = null) {
  if (c.departing || c.done) return c;      // 避免重複計數／重複扣評價
  const angry = reason !== null;
  c.leftAngry = angry;
  c.state = angry ? 'angry' : 'leaving';
  c.leaveReason = reason;
  clearParty(c);
  c.leaveMinute = state.absMinute ?? state.minute;

  if (c.seat && c.tableUid) releaseSeat(state, c);

  if (angry) {
    state.stats.today.angry += (c.partySize || 1);
    if (reason === 'no_table' && (c.partySize || 1) >= 4) {
      state.stats.today.noBigTable = (state.stats.today.noBigTable || 0) + 1;
    }
    if (!c.complained) recordComplaint(state, c, reason);
    setBubble(c, 'angry', state, 2.5);
  }

  // 走到門口再消失
  const door = state.layout.door;
  const outside = state.layout.outside || { x: door.x, y: state.layout.gridH - 0.5 };
  const path = findPath(state.layout, { x: Math.round(c.x), y: Math.round(c.y) }, door);
  if (path) {
    path.push({ x: outside.x, y: outside.y });
    c.path = path;
    c.pathIndex = 0;
    c.departing = true;
  } else {
    c.done = true;
  }

  // 心情回饋到評價
  const { bucket, delta } = applyCustomerMood(state, c);
  state.stats.today.moodSum += c.mood;
  state.stats.today.moodCount += 1;
  state.sim.todayMoods.push(c.mood);
  c._ratingBucket = bucket;
  c._ratingDelta = delta;

  // 拜訪紀錄（給報表分析等待時間用）
  if (!state.sim.visitLog) state.sim.visitLog = [];
  state.sim.visitLog.push({
    type: c.type,
    enter: c.enterMinute,
    seat: c.seatMinute,
    order: c.orderMinute,
    food: c.firstFoodMinute ?? c.orderMinute ?? c.enterMinute,
    leave: state.absMinute ?? state.minute,
    reason: reason || 'served',
    mood: Math.round(c.mood),
    spent: c.spent,
    dishes: c.order.length,
    partySize: c.partySize || 1
  });
  if (state.sim.visitLog.length > 300) state.sim.visitLog.shift();
  return c;
}

export function recordComplaint(state, c, reason) {
  c.complained = true;
  const entry = {
    reason,
    type: c.type,
    day: state.day,
    minute: Math.floor(state.minute),
    mood: Math.round(c.mood),
    wait: Math.round(c.waitMin)
  };
  state.sim.complaintLog.unshift(entry);
  if (state.sim.complaintLog.length > 60) state.sim.complaintLog.pop();
  const key = String(reason);
  state.stats.today.complaints[key] = (state.stats.today.complaints[key] || 0) + 1;
  return entry;
}

export const REASON_TEXT = {
  wait_too_long: '等太久',
  no_table: '等不到位子',
  sold_out: '點不到餐',
  unhappy: '環境或服務太差',
  closed: '打烊被趕'
};

/* ------------------------------------------------------------------ 就座 */

export function seatAt(state, c, table, seat) {
  c.tableUid = table.uid;
  c.seat = { x: seat.x, y: seat.y };
  c.seatedDir = seat.facing;
  c.dir = seat.facing;
  c.state = 'ordering';
  c.seatMinute = state.absMinute ?? state.minute;
  if (!table.occupants.includes(c.uid)) table.occupants.push(c.uid);
  table.state = 'occupied';
  const decor = decorAvg(state);
  c.mood = clamp(c.mood + clamp((decor - 40) / 12, -8, 8), -100, 100);
  c.partyVoice = clamp(0.85 + 0.15 * (c.partySize || 1), 1, 1.6);
}

export function releaseSeat(state, c) {
  const table = state.sim.tables.find((t) => t.uid === c.tableUid);
  if (table) {
    table.occupants = table.occupants.filter((uid) => uid !== c.uid);
    if (!table.occupants.length) {
      table.state = 'dirty';
      table.dirtySince = state.minute;
    }
  }
  c.tableUid = null;
  c.seat = null;
  clearParty(c);
}

export function decorAvg(state) {
  const items = state.layout.items;
  if (!items.length) return 0;
  let total = 0;
  for (const it of items) {
    const def = furnitureById(it.typeId);
    total += def?.decorScore || 0;
  }
  return total / Math.max(1, items.length);
}
