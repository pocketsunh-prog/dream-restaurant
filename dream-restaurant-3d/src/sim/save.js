// ============================================================================
// save.js — 存讀檔（localStorage，6 個槽位：1〜5 ＋ auto）
//   遊戲狀態幾乎都是純資料，只有亂數函式需要另外存「狀態數字」才能完全還原。
// ============================================================================
import { mulberry32, defaultSettings, ensureLedger, WEATHERS } from './game.js';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'dreamrestaurant3d.save.';
export const SLOTS = [
  { id: '1', label: 'スロット 1' },
  { id: '2', label: 'スロット 2' },
  { id: '3', label: 'スロット 3' },
  { id: '4', label: 'スロット 4' },
  { id: '5', label: 'スロット 5' },
  { id: 'auto', label: 'オートセーブ' }
];
export const SLOT_IDS = SLOTS.map((s) => s.id);

/** 儲存空間是否可用 */
export function storageAvailable() {
  try {
    const k = SAVE_KEY + '__test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

/**
 * 把遊戲狀態轉成可 JSON 化的物件。
 * - `rng` 是函式 → 改存 `rngState`
 * - 事件佇列（events）是給音效用的暫時資料 → 不存
 */
export function serializeGame(state) {
  const data = {};
  for (const [k, v] of Object.entries(state)) {
    if (k === 'rng' || k === 'events') continue;
    data[k] = v;
  }
  data.version = SAVE_VERSION;
  data.rngState = typeof state.rng?.state === 'function' ? state.rng.state() : 1;
  data.savedAt = Date.now();
  return data;
}

/** 由存檔資料還原成遊戲狀態（會補上缺少的欄位，容忍舊存檔） */
export function deserializeGame(data) {
  if (!data || typeof data !== 'object') return null;
  const state = JSON.parse(JSON.stringify(data));
  delete state.savedAt;
  const rngState = state.rngState || 1;
  delete state.rngState;

  state.rng = mulberry32(rngState);
  state.events = [];
  state.settings = { ...defaultSettings(), ...(state.settings || {}) };
  state.settings.graphics = { ...defaultSettings().graphics, ...(state.settings.graphics || {}) };
  state.settings.audio = { ...defaultSettings().audio, ...(state.settings.audio || {}) };
  // 相容性補齊
  state.tasks = state.tasks || [];
  state.pass = state.pass || [];
  state.queue = state.queue || [];
  state.staff = state.staff || [];
  state.activeEvents = state.activeEvents || [];
  state.eventLog = state.eventLog || [];
  state.eventMults = state.eventMults || { traffic: 1, cost: 1, mood: 0, fatigue: 0 };
  state.restroom = state.restroom || { dirt: 0 };
  state.equipment = state.equipment || ['fridge', 'ac_unit'];
  state.equipBroken = state.equipBroken || { fridge: false, ac_unit: false, stove: false };
  state.candidates = state.candidates || [];
  if (!state.restroomLv || typeof state.restroomLv !== 'object') state.restroomLv = {};
  // ミッション（依頼）：舊存檔は未着手として補う
  if (!state.missions || typeof state.missions !== 'object') state.missions = {};
  if (!state.missions.completed) state.missions.completed = {};
  if (!state.missions.claimed) state.missions.claimed = {};
  if (!Array.isArray(state.missions.titles)) state.missions.titles = [];
  if (!state.missions.unlockedTier) state.missions.unlockedTier = 1;
  // 天気：知らない値（舊存檔・已廢止の天気）は晴天に寄せる
  if (!WEATHERS.includes(state.weather)) state.weather = 'sunny';
  // 平面圖欄位（舊存檔沒有街道／候位動線）
  if (state.plan) {
    const D = state.plan.depth || 9.6;
    state.plan.street = state.plan.street || { ax: -12.4, az: D / 2 + 1.6, bx: 12.4, bz: D / 2 + 1.6 };
    state.plan.queue = state.plan.queue || { x: 2.6, z: D / 2 + 2.3, step: 1.15 };
    state.plan.floorHeight = state.plan.floorHeight || 3.4;
  }
  // 累計帳（排行榜）：舊存檔會補成空表
  ensureLedger(state);
  state.version = SAVE_VERSION;
  return state;
}

/** 寫入槽位 */
export function saveToSlot(state, slot) {
  if (!SLOT_IDS.includes(slot)) return { ok: false, error: '沒有這個槽位' };
  try {
    const data = serializeGame(state);
    localStorage.setItem(SAVE_KEY + slot, JSON.stringify(data));
    return { ok: true, savedAt: data.savedAt, day: data.day };
  } catch (err) {
    return { ok: false, error: '儲存失敗：' + (err?.message || err) };
  }
}

/** 讀取槽位 */
export function loadFromSlot(slot) {
  if (!SLOT_IDS.includes(slot)) return { ok: false, error: '沒有這個槽位' };
  try {
    const raw = localStorage.getItem(SAVE_KEY + slot);
    if (!raw) return { ok: false, error: '這個槽位是空的' };
    const state = deserializeGame(JSON.parse(raw));
    if (!state) return { ok: false, error: '存檔損壞' };
    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: '讀取失敗：' + (err?.message || err) };
  }
}

/** 槽位摘要（給 UI 列表用） */
export function slotInfo(slot) {
  try {
    const raw = localStorage.getItem(SAVE_KEY + slot);
    if (!raw) return { id: slot, empty: true };
    const d = JSON.parse(raw);
    return {
      id: slot,
      empty: false,
      day: d.day,
      locationId: d.locationId,
      cash: d.cash,
      stars: d.stars,
      fame: d.fame,
      staff: Array.isArray(d.staff) ? d.staff.length : 0,
      savedAt: d.savedAt,
      version: d.version,
      guests: d.today?.guests ?? 0
    };
  } catch {
    return { id: slot, empty: true, broken: true };
  }
}

export function listSlots() {
  return SLOTS.map((s) => ({ ...s, ...slotInfo(s.id) }));
}

export function deleteSlot(slot) {
  if (!SLOT_IDS.includes(slot)) return { ok: false, error: '沒有這個槽位' };
  try {
    localStorage.removeItem(SAVE_KEY + slot);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: '刪除失敗：' + (err?.message || err) };
  }
}

/** 自動存檔（打烊結算時呼叫） */
export function autoSave(state) {
  return saveToSlot(state, 'auto');
}

export function savedAtText(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default {
  SAVE_VERSION, SLOTS, SLOT_IDS, serializeGame, deserializeGame,
  saveToSlot, loadFromSlot, slotInfo, listSlots, deleteSlot, autoSave, savedAtText, storageAvailable
};
