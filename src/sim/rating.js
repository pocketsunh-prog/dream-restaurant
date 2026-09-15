// ============================================================================
// rating.js — 社區／區外雙桶評價、知名度、星級判定
// 考據：原作評價分「社區」與「區外」兩桶，換地點會讓區外評價大幅下滑。
// ============================================================================
import { RATING_MIN, RATING_MAX, TYPE_WEIGHT, STAR_REQS } from '../core/balance.js';
import { locationsForStars } from '../data/locations.js';
import { clamp } from './economy.js';
import { pushLog } from '../core/state.js';

/** 一次顧客離場對評價的影響
 *  好評的加成比負評的懲罰大（讓認真經營的玩家能穩定爬升），
 *  但生氣離開另外重扣，所以擺爛一定會掉評價。 */
export function applyCustomerMood(state, customer) {
  const bucket = customerBucket(state, customer);
  const weight = TYPE_WEIGHT[customer.type] ?? 1;
  const m = clamp(customer.mood, -100, 100);
  let delta = (m >= 0 ? (m / 100) * 0.4 : (m / 100) * 0.25) * weight;
  if (customer.leftAngry) delta -= 0.45 * weight;
  if (customer.wasCritic && customer.mood > 30) delta += 0.4;   // 評論家好評加成
  if (customer.type === 'cherish' && customer.mood > 20) delta += 0.25;  // 常連 Cherish の口コミ
  // 區外客比較少，同一份意見在外面傳得比較遠
  if (bucket === 'outside') delta *= 1.45;
  // 一組人的聲量：人越多，一句話傳得越廣
  delta *= (customer.partyVoice || 1);
  addRating(state, bucket, delta);
  return { bucket, delta };
}

export function customerBucket(state, customer) {
  if (customer.type === 'critic' || customer.type === 'vip' || customer.type === 'tourist') return 'outside';
  // 本地客約 1/3 的意見會流傳到區外
  return customer._outsideRoll ? 'outside' : 'community';
}

export function addRating(state, bucket, delta) {
  const key = bucket === 'outside' ? 'outside' : 'community';
  state.reputation[key] = clamp(state.reputation[key] + delta, RATING_MIN, RATING_MAX);
}

/** 每日知名度變化：由星級與評價推向目標值，事件會直接加減 */
export function dailyFame(state, record) {
  const target = clamp(3 + state.stars * 7 + (state.reputation.community - 350) / 9 + (state.reputation.outside - 350) / 14, 0, 100);
  const pull = (target - state.fame) * 0.07;
  const moodPush = record ? ((record.avgMood ?? 50) - 50) / 50 * 0.5 : 0;
  state.fame = clamp(state.fame + pull + moodPush, 0, 100);
}

/** 建立顧客時擲一次「是否算區外客」 */
export function rollOutside(state, rng) {
  return rng.chance(0.33);
}

export function starProgress(state) {
  const nextStar = Math.min(5, state.stars + 1);
  if (state.stars >= 5) {
    return {
      nextStar: null,
      community: { have: state.reputation.community, need: null, ok: true },
      outside: { have: state.reputation.outside, need: null, ok: true },
      text: '已達五星，挑戰年度大獎'
    };
  }
  const req = STAR_REQS[nextStar];
  const rank = state.stats.magazine.lastTotalRank;
  return {
    nextStar,
    community: { have: state.reputation.community, need: req.community, ok: state.reputation.community >= req.community },
    outside: { have: state.reputation.outside, need: req.outside, ok: state.reputation.outside >= req.outside },
    days: { have: state.day, need: req.days, ok: state.day >= req.days },
    rank: req.rank ? { have: rank, need: req.rank, ok: rank !== null && rank !== undefined && rank <= req.rank } : null,
    bestRank1: req.bestRank1 ? { have: state.stats.magazine.bestTotalRank, ok: state.stats.magazine.bestTotalRank === 1 } : null,
    firstTwice: req.firstTwice ? { have: state.stats.magazine.firstPlaceWeeks || 0, need: 2, ok: (state.stats.magazine.firstPlaceWeeks || 0) >= 2 } : null,
    text: req.text
  };
}

/**
 * 每日檢查升星。回傳 {from,to} 或 null。
 * 原作需要兩個評價桶都達標，這是玩家最常卡關的地方。
 */
export function checkStars(state) {
  if (state.stars >= 5) return null;
  const p = starProgress(state);
  const req = STAR_REQS[p.nextStar];
  if (!req) return null;
  if (!p.community.ok || !p.outside.ok) return null;
  if (req.days && state.day < req.days) return null;
  const rank = state.stats.magazine.lastTotalRank;
  if (req.rank && (rank === null || rank === undefined || rank > req.rank)) return null;
  if (req.bestRank1 && state.stats.magazine.bestTotalRank !== 1) return null;
  if (req.firstTwice && (state.stats.magazine.firstPlaceWeeks || 0) < 2) return null;

  const from = state.stars;
  state.stars = p.nextStar;
  state.flags.starHistory = state.flags.starHistory || [];
  state.flags.starHistory.push(state.stars);
  if (!state.flags.annualStartDay) state.flags.annualStartDay = state.day;

  const newLocations = locationsForStars(state.stars).filter((l) => l.starsRequired > from);
  pushLog(state, `升上 ${state.stars} 星！解鎖 ${newLocations.map((l) => l.name).join('、') || '新料理'}`, 'good');
  state.uiQueue.push({
    type: 'starUp',
    from,
    to: state.stars,
    locations: newLocations.map((l) => l.id)
  });
  return { from, to: state.stars };
}

/** 連續三週評價低於門檻 → 掉星（保留壓力但不至於直接 GG） */
export function checkDropStar(state) {
  if (state.stars <= 1) return null;
  const req = STAR_REQS[state.stars];
  if (!req) return null;
  const floorC = (req.community || 0) - 50;
  const floorO = (req.outside || 0) - 50;
  if (state.reputation.community < floorC || state.reputation.outside < floorO) {
    state.flags.warnedWeek = (state.flags.warnedWeek || 0) + 1;
    if (state.flags.warnedWeek >= 3) {
      state.flags.warnedWeek = 0;
      const from = state.stars;
      state.stars -= 1;
      pushLog(state, `評價長期低迷，雜誌把星級降回 ${state.stars} 星…`, 'bad');
      state.uiQueue.push({ type: 'toast', message: `星級被降為 ${state.stars} 星，趕快改善評價！`, kind: 'bad' });
      return { from, to: state.stars };
    }
    state.uiQueue.push({ type: 'toast', message: `警告：評價低於 ${state.stars} 星門檻（${state.flags.warnedWeek}/3 週）`, kind: 'bad' });
    return null;
  }
  state.flags.warnedWeek = 0;
  return null;
}

/** 年度大獎判定：五星後再撐滿 120 天（約四個遊戲月，實際遊玩時間考量）
 *  且年度總排名第一 */
export function checkAnnualAward(state) {
  if (state.flags.annualAward || state.stars < 5) return false;
  const start = state.flags.annualStartDay || state.day;
  if (state.day - start < 120) return false;
  const rank = state.stats.magazine.lastTotalRank;
  if (rank !== 1) return false;
  state.flags.annualAward = true;
  state.flags.secretUnlocked = true;
  pushLog(state, '榮獲年度大獎 The Greatest Restaurant of the Year！解鎖隱藏料理', 'good');
  state.uiQueue.push({ type: 'annualAward' });
  return true;
}
