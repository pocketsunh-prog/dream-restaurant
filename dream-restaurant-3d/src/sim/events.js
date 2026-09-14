// ============================================================================
// events.js — 事件系統（隨機事件、持續效果、設備減免）
//   資料在 data/events.js；這裡負責「什麼時候發生、影響多久、怎麼結算」。
// ============================================================================
import { EVENTS, eventById, rollEvent } from '../data/events.js';
import { locationById } from '../data/locations.js';

/** 事件間隔（遊戲分鐘）：隨機 90～210 分鐘擲一次 */
const MIN_GAP = 90;
const MAX_GAP = 210;

export const EVENT_KIND_JP = { positive: '良い知らせ', negative: '困ったこと', neutral: 'できごと' };

/**
 * 建立事件排程狀態（掛在 game state 上）
 */
export function initEvents(state) {
  state.activeEvents = [];
  state.eventLog = [];
  state.eventTimer = 60 + Math.floor(state.rng() * 90);
  state.eventMults = { traffic: 1, cost: 1, mood: 0, fatigue: 0 };
  state.eventSeq = 1;
}

/** 目前是否應該擲事件 */
function shouldRoll(state) {
  if (state.phase !== 'open') return false;
  return state.minute >= 11 * 60 && state.minute <= 22 * 60;
}

/**
 * 推進事件：到期結算 + 時間到就擲新事件
 * @returns {Array} 這一步發生的事件（給 UI／音效用）
 */
export function tickEvents(state, dtMin) {
  const out = [];
  if (!Array.isArray(state.activeEvents)) initEvents(state);

  // 1) 到期
  for (let i = state.activeEvents.length - 1; i >= 0; i--) {
    const a = state.activeEvents[i];
    if (state.minute >= a.until) {
      state.activeEvents.splice(i, 1);
      out.push({ phase: 'end', id: a.id, name: a.name, message: `${a.name} が終わりました` });
      recomputeMults(state);
    }
  }

  // 2) 擲新事件
  state.eventTimer = (state.eventTimer || 0) - dtMin;
  if (state.eventTimer <= 0) {
    state.eventTimer = MIN_GAP + state.rng() * (MAX_GAP - MIN_GAP);
    if (shouldRoll(state)) {
      const ev = rollEvent({
        stars: state.stars,
        locationKind: locationById(state.locationId)?.kind || '',
        weather: state.weather,
        minute: state.minute,
        rng: state.rng,
        exclude: state.activeEvents.map((a) => a.id)
      });
      if (ev) {
        applyEvent(state, ev);
        out.push({ phase: 'start', id: ev.id, name: ev.name, kind: ev.kind, message: ev.message, log: ev.log });
      }
    }
  }
  return out;
}

/** 設備是否具備（用於減免） */
function hasEquipment(state, itemId) {
  if (!itemId) return false;
  return (state.plan?.tables ? true : true) && (state.equipment || []).includes(itemId);
}

/** 套用一個事件 */
export function applyEvent(state, ev) {
  const e = ev.effects || {};
  const mitigated = ev.mitigateBy && hasEquipment(state, ev.mitigateBy);
  const k = mitigated ? 0.5 : 1;

  // 立即效果
  if (e.cash) {
    const delta = Math.round(e.cash * k);
    state.cash += delta;
    state.today.eventCash = (state.today.eventCash || 0) + delta;
  }
  if (e.fame) state.fame = Math.max(0, Math.min(100, state.fame + e.fame * k));
  if (e.dirt) {
    state.restroom = state.restroom || { dirt: 0 };
    state.restroom.dirt = Math.min(100, state.restroom.dirt + e.dirt * k);
  }
  if (e.staffFatigue) {
    for (const s of state.staff) s.fatigue = Math.min(100, (s.fatigue || 0) + e.staffFatigue * k);
  }
  if (e.equipBroken) {
    state.equipBroken = state.equipBroken || { ac_unit: false, fridge: false, stove: false };
    state.equipBroken[e.equipBroken] = true;
  }

  // 持續效果
  const dur = Array.isArray(ev.duration) ? (ev.duration[0] + state.rng() * Math.max(0, ev.duration[1] - ev.duration[0])) : 0;
  if (dur > 0) {
    state.activeEvents.push({
      id: ev.id, name: ev.name, kind: ev.kind,
      until: state.minute + Math.round(dur),
      trafficMul: e.trafficMul ?? 1,
      costMul: e.costMul ?? 1,
      moodAll: e.moodAll ?? 0,
      minStars: ev.minStars,
      mitigated
    });
    recomputeMults(state);
  }

  state.eventLog.unshift({
    id: ev.id, name: ev.name, kind: ev.kind, at: Math.round(state.minute),
    message: ev.message, log: ev.log, mitigated
  });
  if (state.eventLog.length > 24) state.eventLog.length = 24;

  state.today.events = (state.today.events || 0) + 1;
  return { mitigated };
}

/** 依目前生效中的事件重算總倍率 */
export function recomputeMults(state) {
  let traffic = 1, cost = 1, mood = 0;
  for (const a of state.activeEvents) {
    traffic *= a.trafficMul ?? 1;
    cost *= a.costMul ?? 1;
    mood += a.moodAll ?? 0;
  }
  state.eventMults = { traffic, cost, mood, fatigue: 0 };
  return state.eventMults;
}

/** 給 UI：目前生效中的事件（含剩餘時間） */
export function activeEventInfo(state) {
  return (state.activeEvents || []).map((a) => ({
    id: a.id, name: a.name, kind: a.kind,
    left: Math.max(0, Math.round(a.until - state.minute))
  }));
}

/** 玩家手動測試用：立刻觸發指定事件 */
export function forceEvent(state, id) {
  const ev = eventById(id);
  if (!ev) return { ok: false, error: '沒有這個事件' };
  applyEvent(state, ev);
  return { ok: true, event: ev };
}

export { EVENTS, eventById, rollEvent };

export default { initEvents, tickEvents, applyEvent, recomputeMults, activeEventInfo, forceEvent };
