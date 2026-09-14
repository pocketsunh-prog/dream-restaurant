// ============================================================================
// economy.js — 成本、水電、每日結算
// ============================================================================
import { getDish } from '../data/dishes.js';
import { getLocation } from '../data/locations.js';
import { decorScore } from './build.js';
import {
  UTILITY_BASE, UTILITY_PER_DEGREE, PERISHABLE_LOSS, PERISHABLE_CATEGORIES,
  COMFORT, WEATHER_COMFORT_SHIFT, DELIVERY_MINUTES
} from '../core/balance.js';
import { emptyToday, pushLog } from '../core/state.js';

/**
 * 單份材料成本：材料等級與份量都會推高成本（對應原作「材料等級最高 100 元」）。
 */
export function ingredientCost(entry, dish = null) {
  const def = dish || getDish(entry?.dishId) || {};
  const base = def.baseCost ?? 20;
  const grade = clamp(entry?.grade ?? 50, 0, 100);
  const portion = clamp(entry?.portion ?? 50, 0, 100);
  return base * (0.6 + (grade / 100) * 0.9) * (0.75 + portion / 150);
}

export function unitCost(entry) {
  return Math.round(ingredientCost(entry) * 10) / 10;
}

export function buyCost(entry, servings, supplierPriceMul = 1) {
  return Math.round(ingredientCost(entry) * servings * supplierPriceMul);
}

export function deliveryDelay() {
  return DELIVERY_MINUTES;
}

/** 每日水電：空調偏離舒適帶越遠越貴，燈具與設備也要錢 */
export function dailyUtilities(state) {
  const weather = state.sim.weather || 'sunny';
  const shift = WEATHER_COMFORT_SHIFT[weather] || 0;
  const band = { min: COMFORT.min + shift, max: COMFORT.max + shift };
  const dev = state.sim.equipBroken?.ac
    ? 6
    : Math.max(0, band.min - state.settings.acTemp, state.settings.acTemp - band.max);
  const lights = state.layout.items.filter((i) => {
    const id = i.typeId || '';
    return id.includes('lamp') || id.includes('light') || id.includes('chandelier');
  }).length;
  const fridge = state.sim.equipBroken?.fridge ? 900 : 0;
  return Math.round(UTILITY_BASE + dev * UTILITY_PER_DEGREE + lights * 45 + fridge);
}

/** 生鮮隔日折損 */
export function applyPerishableLoss(state) {
  let lost = 0;
  for (const [dishId, qty] of Object.entries(state.stock || {})) {
    const def = getDish(dishId);
    if (!def) continue;
    if (!PERISHABLE_CATEGORIES.includes(def.category)) continue;
    const gone = Math.floor(qty * PERISHABLE_LOSS);
    if (gone > 0) { state.stock[dishId] = qty - gone; lost += gone; }
  }
  return lost;
}

/**
 * 每日打烊結算：水電、折損、統計寫入 history。
 * 薪資與租金在營業中／開店時就即時扣除，這裡只彙總。
 */
export function finalizeDay(state) {
  const today = state.stats.today;
  const utilities = dailyUtilities(state);
  state.cash -= utilities;
  today.utilities = utilities;
  today.spend += utilities;

  const lost = applyPerishableLoss(state);
  if (lost > 0) pushLog(state, `生鮮折損 ${lost} 份`, 'warn');

  // 到貨清單清理
  state.suppliers = [];

  const dec = decorScore(state.layout, getLocation(state.locationId));
  today.decorations = dec.total;

  const avgWait = today.waitCount ? today.waitSum / today.waitCount : 0;
  const avgMood = today.moodCount ? today.moodSum / today.moodCount : 0;
  const profit = today.revenue + today.tips - today.spend;

  const record = {
    day: state.day,
    locationId: state.locationId,
    weather: today.weather,
    revenue: Math.round(today.revenue),
    tips: Math.round(today.tips),
    spend: Math.round(today.spend),
    profit: Math.round(profit),
    inventory: Math.round(today.inventory),
    wages: Math.round(today.wages),
    rent: Math.round(today.rent),
    utilities,
    repairs: Math.round(today.repairs || 0),
    guests: today.guests,
    parties: today.parties || 0,
    served: today.served,
    angry: today.angry,
    avgWaitSec: Math.round(avgWait * 60),
    avgMood: Math.round(avgMood * 10) / 10,
    complaints: { ...today.complaints },
    decor: dec.total,
    repCommunity: Math.round(state.reputation.community * 10) / 10,
    repOutside: Math.round(state.reputation.outside * 10) / 10,
    fame: Math.round(state.fame * 10) / 10,
    stars: state.stars,
    magazineRank: state.stats.magazine.lastTotalRank ?? null,
    dishScoreAvg: avgOf(state.sim.todayDishScores),
    valueScoreAvg: avgOf(state.sim.todayValueScores)
  };
  state.stats.history.push(record);
  if (state.stats.history.length > 400) state.stats.history.splice(0, state.stats.history.length - 400);

  state.stats.today = emptyToday();
  return record;
}

export function decorScoreOf(state) {
  return decorScore(state.layout, getLocation(state.locationId));
}

export function avgOf(arr) {
  if (!arr || !arr.length) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return Math.round((sum / arr.length) * 10) / 10;
}

export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}
