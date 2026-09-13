// ============================================================================
// state.js — 狀態建立與遷移。狀態形狀即 docs/ARCHITECTURE.md §3 的契約。
// ============================================================================
import { DISHES, getDish } from '../data/dishes.js';
import { STAFF_POOL, staffById, makeCandidateList } from '../data/staff.js';
import { LOCATIONS, getLocation } from '../data/locations.js';
import { FURNITURE, furnitureById } from '../data/furniture.js';
import { defaultLayout, rebuildTables, findAutoPlace } from '../sim/build.js';
import { makeRng, newSeed } from './rng.js';
import { START_CASH, RATING_START, GRID_W, GRID_H, MENU_LIMIT, STAR_REQS } from './balance.js';

export const SAVE_VERSION = 3;

let uidCounter = 1;
export function nextUid(state) {
  state.uidSeq = (state.uidSeq || 1) + 1;
  return `u${state.uidSeq}`;
}

/* --------------------------------------------------------------- 資料挑選器 */

function firstDishBy(pred) {
  return DISHES.find(pred) || DISHES[0];
}

function pickFurniture(pred, fallbackCategory) {
  const direct = FURNITURE.find(pred);
  if (direct) return direct;
  const byCat = FURNITURE.find((f) => f.category === fallbackCategory);
  return byCat || FURNITURE[0];
}

function cheapestStaff(role) {
  const pool = STAFF_POOL.filter((s) => s.role === role);
  if (!pool.length) return STAFF_POOL[0];
  return pool.slice().sort((a, b) => (a.wage || 0) - (b.wage || 0))[0];
}

/* ------------------------------------------------------------------ 新遊戲 */

export function createNewGame(seed = newSeed(), opts = {}) {
  const rng = makeRng(seed);
  const location = getLocation('zhongli_xinming') || LOCATIONS[0];
  const layout = defaultLayout(location.id);
  layout.rev = 1;
  layout.items = [];

  // 開局基本設備：兩張桌、四張椅子、一個櫃台（可用 CLEAR_LAYOUT 重新規劃）
  const tableDef = pickFurniture((f) => f.category === 'table' && (f.seats || 0) >= 2, 'table');
  const chairDef = pickFurniture((f) => f.category === 'chair', 'chair');
  const counterDef = pickFurniture((f) => f.category === 'counter', 'counter');
  const starterSpots = [
    { type: tableDef, x: 8, y: 7 }, { type: chairDef, x: 8, y: 6 }, { type: chairDef, x: 8, y: 8 },
    { type: chairDef, x: 7, y: 7 }, { type: chairDef, x: 9, y: 7 },
    { type: tableDef, x: 12, y: 7 }, { type: chairDef, x: 12, y: 6 }, { type: chairDef, x: 12, y: 8 },
    { type: chairDef, x: 11, y: 7 }, { type: chairDef, x: 13, y: 7 },
    { type: counterDef, x: 15, y: 10 }
  ];

  const state = {
    version: SAVE_VERSION,
    seed,
    rng: rng.getState(),
    day: 1,
    minute: 9 * 60,
    minuteFloat: 9 * 60,
    absMinute: 9 * 60,   // 單調遞增（不隨跨日歸零），所有計時比較都用它
    speed: 1,
    phase: 'build',
    locationId: location.id,
    stars: 1,
    fame: 6,
    cash: START_CASH,
    uidSeq: 1,
    reputation: { community: RATING_START, outside: RATING_START },
    settings: {
      openMinute: 11 * 60,
      closeMinute: 23 * 60,
      acTemp: 24,
      music: 'lazy',
      openDays: [true, true, true, true, true, true, true]
    },
    menu: [],
    stock: {},
    store: {},
    suppliers: [],
    staff: [],
    candidates: [],
    layout: {
      gridW: GRID_W,
      gridH: GRID_H,
      tiles: layout.tiles,
      items: layout.items,
      door: layout.door,
      outside: layout.outside,
      kitchenTiles: layout.kitchenTiles,
      passTiles: layout.passTiles,
      restroomTiles: layout.restroomTiles,
      sidewalk: layout.sidewalk,
      rev: 1
    },
    sim: {
      customers: [],
      walkers: [],
      tables: [],
      tasks: [],
      kitchen: [],
      pass: [],
      complaintLog: [],
      servedLog: [],
      lureBoost: 0,
      lureDecayMinute: 0,
      activeEvents: [],
      trafficMul: 1,
      supplierPriceMul: 1,
      dirt: { floor: 0, restroom: 0 },
      equipBroken: { ac: false, stove: false, fridge: false },
      spawnAccumulator: 0,
      weather: 'sunny',
      eventTimer: 180,
      todayDishScores: [],
      todayValueScores: [],
      todayMoods: [],
      customersSpawned: 0,
      customersLost: 0,
      lureClicks: 0
    },
    stats: {
      today: emptyToday(),
      history: [],
      weekly: [],
      magazine: { rank: {}, lastSettleDay: 0, bestTotalRank: null, firstPlaceWeeks: 0 },
      ratingsScore: { taste: 0, service: 0, decor: 0, price: 0, popularity: 0 }
    },
    flags: {
      tutorialDone: false,
      annualAward: false,
      secretUnlocked: false,
      warnedWeek: 0,
      negativeCashDays: 0,
      starHistory: [1],
      annualStartDay: 0
    },
    uiQueue: [],
    log: []
  };

  // 擺放開局傢俱
  for (const spot of starterSpots) {
    if (!spot.type) continue;
    state.layout.items.push({
      uid: nextUid(state),
      typeId: spot.type.id,
      x: spot.x,
      y: spot.y,
      w: spot.type.w || 1,
      h: spot.type.h || 1,
      rot: 0,
      durability: 100,
      broken: false
    });
  }

  // 開局基本裝潢：讓新店面看起來像間餐廳（燈具也會產生夜間光池）
  const decorPlan = ['ceiling_lamp', 'ceiling_lamp', 'pot_plant', 'flower_stand', 'jukebox', 'aquarium', 'carpet_red'];
  for (const id of decorPlan) {
    const def = furnitureById(id) || FURNITURE.find((f) => f.category === 'decor' && !f.blocks);
    if (!def) continue;
    const spot = findAutoPlace(state.layout, def.id);
    if (!spot) continue;
    state.layout.items.push({
      uid: nextUid(state),
      typeId: def.id,
      x: spot.x,
      y: spot.y,
      w: def.w || 1,
      h: def.h || 1,
      rot: 0,
      durability: 100,
      broken: false
    });
  }

  // 開局菜單：原作前期最強的漢堡牛肉餅 + 蛋包飯 + 紅茶
  const starterDishes = [
    getDish('hamburg_steak') || firstDishBy((d) => d.category === 'staple'),
    DISHES.find((d) => d.name.includes('蛋包飯')) || DISHES.find((d) => d.category === 'staple' && d.id !== 'hamburg_steak'),
    DISHES.find((d) => d.name.includes('紅茶')) || DISHES.find((d) => d.category === 'drink')
  ].filter(Boolean);

  const seen = new Set();
  for (const dish of starterDishes) {
    if (seen.has(dish.id)) continue;
    seen.add(dish.id);
    state.menu.push({
      dishId: dish.id,
      price: Math.round((dish.expectedPrice || (dish.baseCost || 20) * 7) * 1.0),
      grade: dish.gradeDefault ?? 50,
      taste: dish.tasteDefault ?? 50,
      portion: dish.portionDefault ?? 50,
      cookTime: dish.cookTimeDefault ?? 25,
      active: true,
      sold: 0
    });
    state.stock[dish.id] = 60;
    state.store[dish.id] = 0;
  }

  // 開局員工：兩位服務生、一位廚師（原作要自己招募，這裡給基本班底）
  const startWaiters = STAFF_POOL.filter((s) => s.role === 'waiter')
    .sort((a, b) => (a.wage || 0) - (b.wage || 0)).slice(0, 2);
  const startChef = cheapestStaff('chef');
  for (const person of [...startWaiters, startChef]) {
    if (!person) continue;
    state.staff.push(makeStaffEntry(state, person, person.initWage || person.wage || 2));
  }
  // 第一位服務生負責帶位／點餐／送餐／收桌／掃廁所（原作要玩家自己指派）
  for (const st of state.staff.filter((s) => s.role === 'waiter')) {
    st.duties = { escort: true, serve: true, order: true, bus: true, cleanRestroom: true, cleanFloor: false, cashier: false };
    st.shift = { start: 10 * 60, end: 23 * 60 };
  }

  state.candidates = safeCandidates(1, 5, rng);

  const weatherRoll = makeRng(seed ^ 0x5f3a);
  state.sim.weather = rollWeather(location, weatherRoll);
  state.sim.trafficMul = 1;

  rebuildTables(state);
  layout.rev = (layout.rev || 1) + 1;
  state.layout.rev = layout.rev;
  syncMenuLimitNote(state);
  return state;
}

function safeCandidates(day, count, rng) {
  try {
    const list = makeCandidateList(day, count, rng);
    if (Array.isArray(list) && list.length) return list;
  } catch (err) {
    console.warn('[state] makeCandidateList 失敗，改用備援名單', err);
  }
  // 備援：直接從員工池取
  return STAFF_POOL.slice(0, count).map((s, i) => ({
    candidateId: `c_fallback_${i}_${s.id}`,
    staffId: s.id,
    askWage: s.initWage || s.wage || 2
  }));
}

const WEATHER_MAP = {
  sunny: ['sunny'], cloudy: ['cloudy'], rain: ['rain'], storm: ['storm'], cold: ['cold'], heat: ['heat']
};

export function rollWeather(location, rng) {
  const weights = location?.weatherWeights || { sunny: 0.4, cloudy: 0.25, rain: 0.2, storm: 0.05, cold: 0.05, heat: 0.05 };
  const entries = Object.entries(weights).map(([v, w]) => ({ v, w }));
  const picked = rng.weighted ? rng.weighted(entries) : entries[0].v;
  return WEATHER_MAP[picked] ? picked : 'sunny';
}

export function makeStaffEntry(state, person, wage) {
  return {
    uid: nextUid(state),
    staffId: person.id,
    name: person.name,
    role: person.role,
    wage: Math.max(1, Math.round(wage)),
    hireDay: state.day,
    shift: { start: 10 * 60, end: 23 * 60 },
    duties: { escort: true, serve: true, order: true, bus: true, cleanRestroom: false, cleanFloor: false, cashier: false },
    fatigue: 0,
    mood: 70,
    specialty: person.specialty || 'all',
    speedMod: 1,
    working: false,
    hoursToday: 0,
    x: 0,
    y: 0,
    dir: 'S',
    frame: 0,
    path: [],
    pathIndex: 0,
    task: null,
    state: 'idle',
    restTimer: 0,
    appearance: person.portrait ? { ...person.portrait } : { hair: '#2b1b12', skin: '#f0c9a0', shirt: '#3a6ea5', hat: 0 }
  };
}

export function emptyToday() {
  return {
    revenue: 0, spend: 0, tips: 0, wages: 0, rent: 0, utilities: 0, inventory: 0, repairs: 0,
    guests: 0, served: 0, angry: 0, waitSum: 0, waitCount: 0, moodSum: 0, moodCount: 0,
    complaints: {}, weather: 'sunny', decorations: 0
  };
}

function syncMenuLimitNote(state) {
  state.menuLimit = MENU_LIMIT[state.stars] || 99;
}

export function menuLimitFor(stars) {
  return MENU_LIMIT[stars] || 99;
}

export function starsRequirement(star) {
  return STAR_REQS[star] || STAR_REQS[5];
}

/** 遷移舊存檔 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw;
  s.version = s.version || 1;
  s.sim = s.sim || {};
  s.sim.customers = s.sim.customers || [];
  s.sim.walkers = s.sim.walkers || [];
  s.sim.tables = s.sim.tables || [];
  s.sim.tasks = s.sim.tasks || [];
  s.sim.kitchen = s.sim.kitchen || [];
  s.sim.pass = s.sim.pass || [];
  s.sim.complaintLog = s.sim.complaintLog || [];
  s.sim.servedLog = s.sim.servedLog || [];
  s.sim.activeEvents = s.sim.activeEvents || [];
  s.sim.dirt = s.sim.dirt || { floor: 0, restroom: 0 };
  s.sim.equipBroken = s.sim.equipBroken || { ac: false, stove: false, fridge: false };
  s.sim.trafficMul = s.sim.trafficMul ?? 1;
  s.sim.supplierPriceMul = s.sim.supplierPriceMul ?? 1;
  s.sim.lureBoost = s.sim.lureBoost ?? 0;
  s.sim.weather = s.sim.weather || 'sunny';
  s.stats = s.stats || {};
  s.stats.today = { ...emptyToday(), ...(s.stats.today || {}) };
  s.stats.history = s.stats.history || [];
  s.stats.weekly = s.stats.weekly || [];
  s.stats.magazine = s.stats.magazine || { rank: {}, lastSettleDay: 0 };
  s.flags = s.flags || { tutorialDone: false, annualAward: false, secretUnlocked: false, negativeCashDays: 0 };
  s.flags.negativeCashDays = s.flags.negativeCashDays || 0;
  s.uiQueue = s.uiQueue || [];
  s.log = s.log || [];
  s.suppliers = s.suppliers || [];
  s.stock = s.stock || {};
  s.store = s.store || {};
  s.menu = s.menu || [];
  s.staff = s.staff || [];
  s.candidates = s.candidates || [];
  s.uidSeq = s.uidSeq || 1000;
  s.layout = s.layout || {};
  s.layout.items = s.layout.items || [];
  s.layout.rev = s.layout.rev || 1;
  s.minuteFloat = s.minuteFloat ?? s.minute ?? 540;
  s.absMinute = s.absMinute ?? ((s.day || 1) * 1440 + s.minuteFloat);
  s.version = SAVE_VERSION;
  return s;
}

export function pushLog(state, text, kind = 'info') {
  state.log.push({ day: state.day, minute: Math.floor(state.minute), text, kind });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}
