// ============================================================================
// sim/missions.js — ミッション（依頼）の進行・達成・報酬
//
//   data/missions.js の依頼表を、実際の state から計算した進捗で判定する。
//   - 進捗は「累計」と「1日」の 2 種類（goal.scope）
//   - 達成しただけでは賞金は入らず、HUD の「受取」で初めて手に入る
//     （達成 → completed、受取 → claimed）
//   - tier は達成数に応じて解放される（3 件達成ごとに次の tier が開く）
// ============================================================================
import { MISSIONS, MISSION_TIERS, missionById, missionsForTier } from '../data/missions.js';
import { EQUIPMENT_CATALOG } from './game.js';
import { activeSpecialtyCount, money } from './game.js';

/** 状態の初期化（createGame／讀檔の両方から呼ばれる） */
export function initMissions(state) {
  const m = state.missions && typeof state.missions === 'object' ? state.missions : {};
  state.missions = {
    completed: m.completed && typeof m.completed === 'object' ? m.completed : {},   // id -> { day }
    claimed: m.claimed && typeof m.claimed === 'object' ? m.claimed : {},          // id -> { day, reward }
    titles: Array.isArray(m.titles) ? m.titles : [],
    unlockedTier: Math.max(1, Math.min(MISSION_TIERS.length, m.unlockedTier || 1)),
    boardDay: m.boardDay || 0
  };
  return state.missions;
}

/** 依頼が今この店で「出ている」か（tier と星級の條件） */
export function missionAvailable(state, mission) {
  if (!mission) return false;
  const ms = state.missions || initMissions(state);
  if (mission.tier > ms.unlockedTier) return false;
  if (mission.stars && (state.stars || 1) < mission.stars) return false;
  return true;
}

/* ------------------------------------------------------------ 進捗の計算 */

const sumLedger = (state, bucket, key) => {
  const b = state.ledger && state.ledger[bucket];
  if (!b) return 0;
  return Object.values(b).reduce((a, v) => a + (v && v[key] ? v[key] : 0), 0);
};

const histMax = (state, pick) => {
  const h = Array.isArray(state.history) ? state.history : [];
  let best = 0;
  for (const r of h) { const v = Number(pick(r)) || 0; if (v > best) best = v; }
  return best;
};

/**
 * 目標の現在値と目標値を返す。
 * @returns {{cur:number, target:number, done:boolean, unit:string}}
 */
export function missionProgress(state, mission) {
  const g = mission?.goal || {};
  const target = Math.max(1, Number(g.target) || 1);
  const today = state.today || {};
  const ms = state.missions || initMissions(state);
  let cur = 0;
  switch (g.kind) {
    case 'serveGuests':
      cur = g.scope === 'day' ? (today.served || 0) : (state.servedTotal || 0);
      break;
    case 'revenue':
      cur = g.scope === 'day'
        ? Math.round((today.revenue || 0) + (today.tips || 0))
        : histMax(state, (r) => (r.revenue || 0));
      break;
    case 'netProfit':
      cur = histMax(state, (r) => r.net);
      break;
    case 'tips':
      cur = Math.round(today.tips || 0);
      break;
    case 'cash':
      cur = Math.round(state.cash || 0);
      break;
    case 'fame':
      cur = Math.round((state.fame || 0) * 10) / 10;
      break;
    case 'stars':
      cur = state.stars || 1;
      break;
    case 'days':
      cur = state.day || 1;
      break;
    case 'cookDishes':
      cur = sumLedger(state, 'staff', 'cooked');
      break;
    case 'cleanRestroom':
      cur = (state.ledger?.meta?.cleanRestroom?.count) || 0;
      break;
    case 'petGroups':
      cur = (state.ledger?.meta?.petGroups?.count) || 0;
      break;
    case 'severeServed':
      cur = (state.ledger?.meta?.severeServed?.count) || 0;
      break;
    case 'kindsServed':
      cur = Object.values(state.ledger?.kinds || {}).filter((v) => v && (v.guests || 0) > 0).length;
      break;
    case 'staffCount':
      cur = (state.staff || []).filter((s) => !g.extra || s.role === g.extra).length;
      break;
    case 'staffSkill': {
      const list = (state.staff || []).filter((s) => !g.extra || s.role === g.extra);
      cur = list.reduce((a, s) => Math.max(a, s.skill || 0), 0);
      break;
    }
    case 'uniforms':
      cur = new Set((state.staff || []).map((s) => s.uniformId).filter(Boolean)).size;
      break;
    case 'menus':
      cur = (state.menu || []).filter((x) => x.active).length;
      break;
    case 'specialties':
      cur = activeSpecialtyCount(state);
      break;
    case 'floors':
      cur = state.plan?.floorCount || 1;
      break;
    case 'maxQueue':
      cur = Math.max(today.maxQueue || 0, histMax(state, (r) => r.maxQueue));
      break;
    case 'noAngryDay': {
      // 10 名以上接客した日に怒らせなかったか（今日 or 過去のどの日か）
      const okToday = (today.served || 0) >= 10 && (today.angry || 0) === 0;
      const okHist = (Array.isArray(state.history) ? state.history : [])
        .some((r) => (r.served || 0) >= 10 && (r.angry || 0) === 0);
      cur = okToday || okHist ? 1 : 0;
      break;
    }
    default:
      cur = 0;
  }
  const done = !!ms.completed[mission.id] || cur >= target;
  return { cur: Math.round(cur * 10) / 10, target, done, unit: g.scope === 'day' ? 'day' : 'total' };
}

/* ------------------------------------------------------------ 毎フレーム */

/**
 * 毎 tick 呼ぶ。達成した依頼を completed に移し、tier を解放する。
 * @returns {Array<object>} 新しく達成した依頼（通知用）
 */
export function tickMissions(state) {
  const ms = state.missions || initMissions(state);
  const fresh = [];
  for (const mission of MISSIONS) {
    if (ms.completed[mission.id]) continue;
    if (!missionAvailable(state, mission)) continue;
    const p = missionProgress(state, mission);
    if (!p.done) continue;
    ms.completed[mission.id] = { day: state.day || 1, at: Math.round(state.minute || 0) };
    fresh.push({ mission, progress: p });
  }
  if (fresh.length) {
    // 3 件達成ごとに次の tier を解放（最大 tier 5）
    const n = Object.keys(ms.completed).length;
    ms.unlockedTier = Math.max(ms.unlockedTier, Math.min(MISSION_TIERS.length, 1 + Math.floor(n / 3)));
  }
  return fresh;
}

/** 未受取の達成済み依頼（HUD の「受取」対象） */
export function claimableMissions(state) {
  const ms = state.missions || initMissions(state);
  return MISSIONS.filter((m) => ms.completed[m.id] && !ms.claimed[m.id]);
}

/** 進行中の依頼（達成済み・未解錠は除く） */
export function activeMissions(state, limit = 8) {
  const ms = state.missions || initMissions(state);
  const out = [];
  for (const m of MISSIONS) {
    if (ms.completed[m.id] || ms.claimed[m.id]) continue;
    if (!missionAvailable(state, m)) continue;
    const p = missionProgress(state, m);
    out.push({ mission: m, progress: p });
    if (out.length >= limit * 3) break;
  }
  // 達成が近い順に見せる
  out.sort((a, b) => (b.progress.cur / b.progress.target) - (a.progress.cur / a.progress.target));
  return out.slice(0, limit);
}

/** 報酬を受け取る（1 回だけ） */
export function claimMission(state, id) {
  const ms = state.missions || initMissions(state);
  const mission = missionById(id);
  if (!mission) return { ok: false, error: 'そんな依頼はありません' };
  if (!ms.completed[id]) return { ok: false, error: 'まだ達成していません' };
  if (ms.claimed[id]) return { ok: false, error: '受け取り済みです' };
  const r = mission.reward || {};
  const got = [];
  if (r.cash) { state.cash = (state.cash || 0) + r.cash; got.push(money(r.cash)); }
  if (r.fame) { state.fame = Math.min(100, (state.fame || 0) + r.fame); got.push(`評価 +${r.fame}`); }
  if (r.equipment && EQUIPMENT_CATALOG[r.equipment]) {
    state.equipment = state.equipment || [];
    if (!state.equipment.includes(r.equipment)) {
      state.equipment.push(r.equipment);
      got.push(EQUIPMENT_CATALOG[r.equipment].jp);
    }
  }
  if (r.title) {
    ms.titles = ms.titles || [];
    if (!ms.titles.includes(r.title)) ms.titles.push(r.title);
    got.push(`称号「${r.title}」`);
  }
  ms.claimed[id] = { day: state.day || 1, reward: got.slice() };
  return { ok: true, mission, got, reward: r };
}

/** HUD 用のまとめ */
export function missionReport(state) {
  const ms = state.missions || initMissions(state);
  const claimable = claimableMissions(state).map((m) => ({ mission: m, progress: missionProgress(state, m) }));
  const active = activeMissions(state, 8);
  const claimedList = MISSIONS.filter((m) => ms.claimed[m.id]);
  return {
    unlockedTier: ms.unlockedTier,
    claimable,
    active,
    claimedCount: claimedList.length,
    completedCount: Object.keys(ms.completed).length,
    total: MISSIONS.length,
    titles: ms.titles || [],
    byTier: MISSION_TIERS.map((t) => ({
      tier: t,
      locked: t > ms.unlockedTier,
      missions: missionsForTier(t).map((m) => ({
        mission: m,
        progress: missionProgress(state, m),
        completed: !!ms.completed[m.id],
        claimed: !!ms.claimed[m.id]
      }))
    })),
    claimed: claimedList.map((m) => ({ mission: m, info: ms.claimed[m.id] }))
  };
}

export default {
  initMissions, missionAvailable, missionProgress, tickMissions,
  claimableMissions, activeMissions, claimMission, missionReport
};
