// ============================================================================
// store.js — 極簡狀態容器：dispatch / subscribe / refreshAll
// ============================================================================
import { reduce } from './actions.js';
import { createNewGame, migrate } from './state.js';
import { saveGame, loadGame, AUTO_SLOT } from './save.js';

export function createStore(initialState) {
  let state = initialState || createNewGame();
  const subscribers = new Set();
  let notices = [];
  let rev = 0;

  function emit() {
    rev += 1;
    state.rev = rev;
    for (const fn of subscribers) {
      try { fn(state); } catch (err) { console.error('[store] 訂閱者發生錯誤', err); }
    }
  }

  const store = {
    getState() { return state; },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    select(fn) { return fn(state); },

    get revision() { return rev; },

    /**
     * @returns {{ok:boolean, error?:string, info?:string}}
     */
    dispatch(action) {
      if (!action || typeof action.type !== 'string') return { ok: false, error: '無效的操作' };

      // 存讀檔與新遊戲由 store 處理（需要 localStorage）
      if (action.type === 'SAVE_GAME') {
        const res = saveGame(state, action.slot || '1');
        if (res.ok) {
          notices.push({ kind: 'good', message: `已存檔到槽位 ${action.slot || '1'}` });
          pushNotice(state, { kind: 'good', message: `已存檔到槽位 ${action.slot || '1'}` });
          emit();
          return { ok: true, info: '存檔完成' };
        }
        return res;
      }
      if (action.type === 'LOAD_GAME') {
        const res = loadGame(action.slot || '1');
        if (!res.ok) return res;
        state = res.state;
        rev += 1;
        state.rev = rev;
        pushNotice(state, { kind: 'info', message: '讀檔完成' });
        emit();
        return { ok: true, info: '讀檔完成' };
      }
      if (action.type === 'NEW_GAME') {
        state = createNewGame(action.seed);
        rev += 1;
        state.rev = rev;
        emit();
        return { ok: true, info: '新遊戲開始' };
      }

      let result;
      try {
        result = reduce(state, action);
      } catch (err) {
        console.error('[store] reducer 例外', err);
        return { ok: false, error: '內部錯誤：' + err.message };
      }
      if (result && result.ok) {
        if (result.info) pushNotice(state, { kind: 'info', message: result.info });
        emit();
      }
      return result || { ok: true };
    },

    /** 直接替換狀態（讀檔、外部注入、測試用） */
    replaceState(next, { silent = false } = {}) {
      state = migrate(next) || next;
      rev += 1;
      state.rev = rev;
      if (!silent) emit();
      return state;
    },

    /** 取出累積的提示訊息（給 UI 顯示 toast） */
    drainNotices() {
      const out = notices;
      notices = [];
      return out;
    },

    autoSave() {
      return saveGame(state, AUTO_SLOT, '每日自動存檔');
    }
  };

  function pushNotice(st, notice) {
    notices.push(notice);
    if (notices.length > 30) notices.splice(0, notices.length - 30);
  }

  return store;
}

export const store = createStore();
export default store;
