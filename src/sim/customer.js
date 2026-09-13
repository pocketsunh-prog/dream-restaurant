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

const TYPE_TAGS = {
  student: ['cheap', 'fried', 'quick', 'rice', 'noodle', 'meat'],
  office: ['quick', 'rice', 'noodle', 'caffeine', 'mild'],
  family: ['meat', 'soup', 'rice', 'local'],
  tourist: ['local', 'tourist', 'seafood', 'fried'],
  critic: ['premium', 'seafood', 'soup', 'local'],
  vip: ['premium', 'seafood', 'meat']
};

const TYPE_TASTE = { student: 68, office: 52, family: 58, tourist: 62, critic: 55, vip: 50 };
const TYPE_NAME = { student: '學生', office: '上班族', family: '家庭', tourist: '觀光客', critic: '美食評論家', vip: '貴賓' };

export function typeName(type) { return TYPE_NAME[type] || '顧客'; }

/** 依地點顧客組成＋知名度抽出顧客類型 */
export function pickCustomerType(state, rng) {
  const loc = getLocation(state.locationId);
  const mix = { ...(loc?.customerMix || { student: 0.4, office: 0.2, family: 0.3, tourist: 0.08, critic: 0.015, vip: 0.005 }) };
  const fameBoost = 1 + state.fame / 45;
  mix.tourist = (mix.tourist || 0) * (0.7 + state.stars * 0.12 + state.fame / 120);
  mix.critic = (mix.critic || 0) * fameBoost;
  mix.vip = (mix.vip || 0) * fameBoost;
  // 時段影響
  const h = state.minute / 60;
  if (h >= 11 && h < 14) mix.office *= 1.5;
  if (h >= 17 && h < 21) mix.family *= 1.4;
  if (h >= 21) { mix.student *= 1.5; mix.family *= 0.7; }
  return rng.weighted(Object.entries(mix).map(([v, w]) => ({ v, w: Math.max(0.0001, w) }))) || 'student';
}

export function makeCustomer(state, rng, opts = {}) {
  const type = opts.type || pickCustomerType(state, rng);
  const loc = getLocation(state.locationId);
  const patienceRange = B.PATIENCE[type] || [40, 60];
  const outside = rollOutside(state, rng);
  const spawn = state.layout.outside || { x: state.layout.door.x, y: state.layout.gridH - 0.5 };
  const customer = {
    uid: `c${state.day}_${state.sim.customersSpawned}_${Math.floor(rng.next() * 9999)}`,
    type,
    appearance: randomAppearance(rng),
    mood: rng.range(0, 12),
    patience: rng.range(patienceRange[0], patienceRange[1]) * (type === 'office' ? 0.85 : 1),
    budget: 0,
    partySize: 1,
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
    complained: false
  };
  state.sim.customersSpawned += 1;
  state.sim.customers.push(customer);
  state.stats.today.guests += 1;
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

  const count = rng.weighted([{ v: 1, w: customer.type === 'office' ? 5 : 3 }, { v: 2, w: 3 }, { v: 3, w: 1 }]);
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
  const angry = reason !== null;
  c.leftAngry = angry;
  c.state = angry ? 'angry' : 'leaving';
  c.leaveReason = reason;
  c.leaveMinute = state.absMinute ?? state.minute;

  if (c.seat && c.tableUid) releaseSeat(state, c);

  if (angry) {
    state.stats.today.angry += 1;
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
    dishes: c.order.length
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
