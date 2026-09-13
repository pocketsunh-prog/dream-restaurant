// ============================================================================
// save.js — localStorage 存讀檔（5 個手動槽 + 每日自動存檔）
// ============================================================================
import { SAVE_VERSION, migrate } from './state.js';

export const SAVE_PREFIX = 'dreamrestaurant.save.';
export const MANUAL_SLOTS = ['1', '2', '3', '4', '5'];
export const AUTO_SLOT = 'auto';

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function saveKey(slot) {
  return `${SAVE_PREFIX}${slot}`;
}

export function saveGame(state, slot, label = '') {
  const store = storage();
  const payload = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    label,
    state: serialize(state)
  };
  const json = JSON.stringify(payload);
  if (!store) return { ok: false, error: '這個瀏覽器不支援存檔' };
  try {
    store.setItem(saveKey(slot), json);
    return { ok: true, bytes: json.length };
  } catch (err) {
    return { ok: false, error: '存檔失敗：' + err.message };
  }
}

export function loadGame(slot) {
  const store = storage();
  if (!store) return { ok: false, error: '這個瀏覽器不支援讀檔' };
  const raw = store.getItem(saveKey(slot));
  if (!raw) return { ok: false, error: '這個槽位沒有存檔' };
  try {
    const payload = JSON.parse(raw);
    const state = migrate(payload.state);
    if (!state) return { ok: false, error: '存檔格式錯誤' };
    return { ok: true, state, meta: { savedAt: payload.savedAt, label: payload.label } };
  } catch (err) {
    return { ok: false, error: '讀檔失敗：' + err.message };
  }
}

export function slotInfo(slot) {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(saveKey(slot));
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    const s = payload.state || {};
    return {
      slot,
      savedAt: payload.savedAt,
      day: s.day,
      locationId: s.locationId,
      cash: s.cash,
      stars: s.stars,
      version: payload.version
    };
  } catch {
    return { slot, broken: true };
  }
}

export function deleteSave(slot) {
  const store = storage();
  if (!store) return false;
  store.removeItem(saveKey(slot));
  return true;
}

export function listSlots() {
  return [...MANUAL_SLOTS, AUTO_SLOT].map((slot) => ({ slot, info: slotInfo(slot) }));
}

/**
 * 序列化：移除執行期暫存（路徑、任務參照）以免存檔肥大或循環參照。
 */
export function serialize(state) {
  const clean = JSON.parse(JSON.stringify(state, (key, value) => {
    if (key === '_pathCache') return undefined;
    return value;
  }));
  // 顧客與員工的路徑不必存（重開後重算）
  for (const c of clean.sim?.customers || []) { c.path = []; c.pathIndex = 0; }
  for (const s of clean.staff || []) { s.path = []; s.pathIndex = 0; s.task = null; }
  for (const w of clean.sim?.walkers || []) { /* 保留 */ }
  clean.uiQueue = [];
  return clean;
}

export function hasAnySave() {
  const store = storage();
  if (!store) return false;
  return [...MANUAL_SLOTS, AUTO_SLOT].some((slot) => !!store.getItem(saveKey(slot)));
}
