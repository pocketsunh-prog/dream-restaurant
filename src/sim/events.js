// ============================================================================
// events.js — 突發事件（含電視採訪、竊盜等）
// ============================================================================
import { EVENTS } from '../data/events.js';
import { pushLog } from '../core/state.js';
import { clamp } from './economy.js';

/** 事件表中負面事件對評價的影響整體調弱，
 *  否則光是隨機事件就足以抵銷玩家認真經營累積的評價（原作裡評價主要還是由顧客決定）。 */
const NEGATIVE_REP_SCALE = 0.45;

/** 額外的觸發條件（讓事件與經營狀況掛勾，比較有因果感） */
const EVENT_CONDITIONS = {
  // 材料等級太低才會食物中毒（原作：便宜材料＝容易出事）
  food_poisoning: (state) => averageGrade(state) < 42,
  // 客人太少的時候不會有人來鬧場
  karen_customer: (state) => (state.stats.today.guests || 0) >= 8,
  // 生意太差時電視台不會來採訪
  tv_interview: (state) => state.fame >= 8 || (state.stats.today.guests || 0) >= 25,
  // 沒有廁所可堵塞就不會堵塞
  toilet_clog: (state) => (state.layout.restroomTiles || []).length > 0
};

export function averageGrade(state) {
  const active = state.menu.filter((m) => m.active);
  if (!active.length) return 50;
  return active.reduce((s, m) => s + (m.grade ?? 50), 0) / active.length;
}

export function eventAllowed(state, eventDef) {
  const cond = EVENT_CONDITIONS[eventDef.id];
  if (!cond) return true;
  try { return !!cond(state); } catch { return true; }
}

export function eventsFor(stars, locationId) {
  return EVENTS.filter((e) => {
    if ((e.minStars ?? 1) > stars) return false;
    if ((e.maxStars ?? 5) < stars) return false;
    if (Array.isArray(e.locations) && e.locations.length && !e.locations.includes(locationId)) return false;
    return true;
  });
}

export function absMinute(state) {
  return state.absMinute ?? (state.day * 1440 + state.minute);
}

/** 每 N 遊戲分鐘擲一次事件 */
export function tickEvents(state, dtMin, rng) {
  const open = state.phase === 'open';
  state.sim.eventTimer = (state.sim.eventTimer ?? 180) - dtMin;
  if (state.sim.eventTimer > 0) return null;
  state.sim.eventTimer = rng.int(120, 260);

  const pool = eventsFor(state.stars, state.locationId)
    .filter((e) => (!e.onlyWhileOpen || open) && eventAllowed(state, e));
  if (!pool.length) return null;
  const picked = rng.weighted(pool.map((e) => ({ v: e, w: e.weight || 1 })));
  if (!picked) return null;
  return triggerEvent(state, picked, rng);
}

export function hasMitigation(state, eventDef) {
  if (!eventDef?.mitigateBy || !eventDef.mitigateBy.length) return false;
  const owned = new Set(state.layout.items.map((i) => i.typeId));
  return eventDef.mitigateBy.some((id) => owned.has(id));
}

export function triggerEvent(state, eventDef, rng) {
  const mitigated = hasMitigation(state, eventDef);
  const scale = mitigated ? 0.22 : 1;
  const fx = eventDef.effects || {};
  const notes = [];

  if (fx.fame) {
    state.fame = clamp(state.fame + fx.fame * (fx.fame > 0 ? 1 : scale), 0, 100);
    notes.push(`知名度 ${fx.fame > 0 ? '+' : ''}${Math.round(fx.fame * (fx.fame > 0 ? 1 : scale))}`);
  }
  if (fx.reputation) {
    for (const key of ['community', 'outside']) {
      const v = fx.reputation[key];
      if (!v) continue;
      const base = v > 0 ? v : v * NEGATIVE_REP_SCALE;
      const delta = base * (v > 0 ? 1 : scale);
      state.reputation[key] = clamp(state.reputation[key] + delta, 0, 500);
    }
    notes.push('評價變動');
  }
  if (fx.cash) {
    const amount = Math.round(fx.cash * (fx.cash > 0 ? 1 : scale));
    state.cash += amount;
    state.stats.today.revenue += Math.max(0, amount);
    state.stats.today.spend += Math.max(0, -amount);
    notes.push(`${amount > 0 ? '進帳' : '損失'} NT$ ${Math.abs(amount).toLocaleString('en-US')}`);
  }
  if (fx.moodAll) {
    for (const c of state.sim.customers) {
      c.mood = clamp(c.mood + fx.moodAll, -100, 100);
    }
  }
  if (fx.supplierPriceMul && fx.supplierPriceMul !== 1) {
    state.sim.supplierPriceMul = fx.supplierPriceMul;
    state.sim.supplierPriceMulUntil = absMinute(state) + 480;
    notes.push(`進貨價 ×${fx.supplierPriceMul}`);
  }
  if (fx.trafficMul && fx.trafficMul !== 1) {
    const until = absMinute(state) + (fx.trafficMulMinutes || 120);
    state.sim.activeEvents.push({
      eventId: eventDef.id,
      name: eventDef.name,
      until,
      trafficMul: fx.trafficMul > 1 ? fx.trafficMul : 1 + (fx.trafficMul - 1) * scale
    });
    notes.push(`客流 ×${(fx.trafficMul > 1 ? fx.trafficMul : 1 + (fx.trafficMul - 1) * scale).toFixed(2)}`);
  }
  if (fx.damage) {
    if (mitigated) {
      notes.push('防護設備發揮作用，損害輕微');
    } else if (fx.damage === 'ac' || fx.damage === 'stove' || fx.damage === 'fridge') {
      state.sim.equipBroken[fx.damage] = true;
      notes.push(`${fx.damage === 'ac' ? '空調' : fx.damage === 'stove' ? '爐具' : '冰箱'}故障`);
    } else if (fx.damage === 'random_item') {
      const candidates = state.layout.items.filter((i) => !i.broken && (i.durability ?? 100) > 20);
      const target = candidates.length ? rng.pick(candidates) : null;
      if (target) {
        target.durability = Math.max(0, (target.durability ?? 100) - 55);
        if (target.durability <= 10) target.broken = true;
        notes.push('店內設備受損');
      }
    }
  }
  if (fx.stockLoss) {
    let lost = 0;
    for (const dishId of Object.keys(state.stock || {})) {
      const gone = Math.floor(state.stock[dishId] * fx.stockLoss * scale);
      if (gone > 0) { state.stock[dishId] -= gone; lost += gone; }
    }
    if (lost) notes.push(`報廢 ${lost} 份食材`);
  }
  if (eventDef.onTrigger) {
    try { eventDef.onTrigger(state); } catch { /* 事件鉤子失敗不影響模擬 */ }
  }

  pushLog(state, `${eventDef.name}：${eventDef.log || eventDef.message}${mitigated ? '（防護有效）' : ''}`, eventDef.kind === 'negative' ? 'bad' : eventDef.kind === 'positive' ? 'good' : 'info');
  state.uiQueue.push({
    type: 'event',
    kind: eventDef.kind,
    title: eventDef.name,
    message: eventDef.message,
    notes
  });
  return { event: eventDef, mitigated, notes };
}

/** 清理過期的事件加成 */
export function expireEvents(state) {
  const now = absMinute(state);
  const before = state.sim.activeEvents.length;
  state.sim.activeEvents = state.sim.activeEvents.filter((e) => e.until > now);
  if (state.sim.supplierPriceMulUntil && state.sim.supplierPriceMulUntil <= now) {
    state.sim.supplierPriceMul = 1;
    state.sim.supplierPriceMulUntil = 0;
  }
  return before !== state.sim.activeEvents.length;
}

export function trafficMultiplierFromEvents(state) {
  let mul = 1;
  for (const e of state.sim.activeEvents) mul *= (e.trafficMul || 1);
  return mul;
}
