// ============================================================================
// magazine.js — 每週日 22:00 的雜誌五榜排名
// 考據：原作每週日晚上進行評分總結算，名次越前知名度與人氣越高。
// ============================================================================
import { MAG_CATEGORIES, MAG_RIVALS, WEEKLY_BONUS } from '../core/balance.js';
import { getLocation } from '../data/locations.js';
import { clamp, avgOf } from './economy.js';
import { pushLog } from '../core/state.js';

const RIVAL_NAMES = [
  '阿坤快炒', '三姊妹小吃', '廟口海鮮樓', '小胖牛排館', '幸福食堂', '夜貓子食堂',
  '東方明珠餐廳', '阿婆乾麵', '好朋友簡餐', '廟東蚵仔煎', '老地方牛肉麵', '金太陽西餐廳',
  '小巷咖啡', '大胃王食堂', '海派熱炒', '阿美便當', '檳榔樹下小吃', '夜市王炸雞',
  '福氣小館', '八八食堂', '彩虹義大利麵', '嘟嘟牛排', '好味道麵店', '金牌快炒',
  '香蕉新樂園', '阿忠海產', '小南碗粿', '雙囍樓'
];

export function weekNumber(day) {
  return Math.ceil(day / 7);
}

function recordsForWeek(state, week) {
  const start = (week - 1) * 7 + 1;
  const end = week * 7;
  const rows = state.stats.history.filter((r) => r.day >= start && r.day <= end);
  if (rows.length) return rows;
  return state.stats.history.slice(-7);
}

/** 本週五項分數（0 ～ 100） */
export function computeScores(state, rows) {
  const loc = getLocation(state.locationId);
  const guests = rows.reduce((s, r) => s + (r.guests || 0), 0);
  const served = rows.reduce((s, r) => s + (r.served || 0), 0);
  const angry = rows.reduce((s, r) => s + (r.angry || 0), 0);
  const waits = rows.filter((r) => r.avgWaitSec !== undefined);
  const avgWaitMin = waits.length ? waits.reduce((s, r) => s + r.avgWaitSec, 0) / waits.length / 60 : 30;
  const decor = rows.length ? rows[rows.length - 1].decor || 0 : 0;
  const dishScores = rows.map((r) => r.dishScoreAvg || 0).filter((v) => v > 0);
  const valueScores = rows.map((r) => r.valueScoreAvg || 0).filter((v) => v > 0);

  const taste = clamp(avgOf(dishScores) || 45, 0, 100);
  const angryRate = guests ? angry / Math.max(1, guests) : 0;
  const waitPenalty = clamp((avgWaitMin / 45) * 35, 0, 45);
  const angryPenalty = clamp(angryRate * 85, 0, 45);
  const service = clamp(100 - waitPenalty - angryPenalty, 0, 100);
  const decorScore = clamp(decor / 5, 0, 100);
  const price = clamp((avgOf(valueScores) || 0.8) * 71, 0, 100);
  const targetGuests = 7 * (loc?.baseTraffic || 1) * 130;   // 以「人」計
  const popularity = clamp((guests / Math.max(40, targetGuests)) * 70 + state.stars * 3, 0, 100);

  return { taste, service, decor: decorScore, price, popularity, guests, served, angry, avgWaitMin };
}

/**
 * 執行週結算。回傳 weekly 記錄；同時更新 state.stats.magazine。
 */
export function runWeeklySettlement(state, rng) {
  const week = weekNumber(state.day);
  const rows = recordsForWeek(state, week);
  const scores = computeScores(state, rows);
  const rivalBase = 52 + week * 0.7;

  const rank = {};
  const categoryRanks = [];
  let bestList = null;

  for (const cat of MAG_CATEGORIES) {
    const playerScore = clamp(scores[cat.id], 0, 100);
    const rivals = [];
    const names = rng.shuffle(RIVAL_NAMES).slice(0, MAG_RIVALS);
    for (const name of names) {
      const s = clamp(rivalBase + rng.range(-16, 16), 15, 100);
      rivals.push({ name, score: Math.round(s * 10) / 10 });
    }
    const ahead = rivals.filter((r) => r.score > playerScore).length;
    const myRank = ahead + 1;
    const topList = [...rivals, { name: '本店', score: Math.round(playerScore * 10) / 10, me: true }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    rank[cat.id] = { rank: myRank, score: Math.round(playerScore * 10) / 10, topList, category: cat.name };
    categoryRanks.push(myRank);
  }

  // 總排名：以五項平均分數與對手平均值比較
  const playerAvg = MAG_CATEGORIES.reduce((s, c) => s + rank[c.id].score, 0) / MAG_CATEGORIES.length;
  const totalRivals = [];
  const totalNames = rng.shuffle(RIVAL_NAMES).slice(0, MAG_RIVALS);
  for (const name of totalNames) {
    const s = clamp(rivalBase + rng.range(-13, 13), 15, 100);
    totalRivals.push({ name, score: Math.round(s * 10) / 10 });
  }
  const totalAhead = totalRivals.filter((r) => r.score > playerAvg).length;
  const totalRank = totalAhead + 1;
  rank.total = {
    rank: totalRank,
    score: Math.round(playerAvg * 10) / 10,
    topList: [...totalRivals, { name: '本店', score: Math.round(playerAvg * 10) / 10, me: true }]
      .sort((a, b) => b.score - a.score).slice(0, 8).map((r, i) => ({ ...r, rank: i + 1 })),
    category: '總排名'
  };
  bestList = rank.total.topList;

  const mag = state.stats.magazine;
  mag.rank = rank;
  mag.lastSettleDay = state.day;
  mag.lastTotalRank = totalRank;
  mag.bestTotalRank = mag.bestTotalRank === null || mag.bestTotalRank === undefined
    ? totalRank : Math.min(mag.bestTotalRank, totalRank);
  if (totalRank === 1) mag.firstPlaceWeeks = (mag.firstPlaceWeeks || 0) + 1;

  // 知名度與獎金
  const fameGain = clamp((21 - totalRank) * 0.28, -2, 6);
  state.fame = clamp(state.fame + fameGain, 0, 100);
  let prize = 0;
  if (totalRank === 1) prize = 150000;
  else if (totalRank <= 3) prize = 60000;
  else if (totalRank <= 8) prize = 20000;
  if (prize) {
    state.cash += prize;
    state.stats.today.revenue += prize;
  }

  const weekly = {
    week,
    startDay: (week - 1) * 7 + 1,
    endDay: week * 7,
    revenue: rows.reduce((s, r) => s + (r.revenue || 0), 0),
    profit: rows.reduce((s, r) => s + (r.profit || 0), 0),
    guests: scores.guests,
    served: scores.served,
    angry: scores.angry,
    scores: {
      taste: Math.round(scores.taste * 10) / 10,
      service: Math.round(scores.service * 10) / 10,
      decor: Math.round(scores.decor * 10) / 10,
      price: Math.round(scores.price * 10) / 10,
      popularity: Math.round(scores.popularity * 10) / 10
    },
    ranks: Object.fromEntries(MAG_CATEGORIES.map((c) => [c.id, rank[c.id].rank])),
    totalRank,
    prize,
    repCommunity: Math.round(state.reputation.community * 10) / 10,
    repOutside: Math.round(state.reputation.outside * 10) / 10,
    stars: state.stars,
    topList: bestList
  };
  state.stats.weekly.push(weekly);
  pushLog(state, `第 ${week} 週雜誌結算：總排名第 ${totalRank} 名${prize ? `，獲得獎金 NT$ ${prize.toLocaleString('en-US')}` : ''}`, totalRank <= 8 ? 'good' : 'info');
  return weekly;
}

export function weeklyBonus(state) {
  state.cash += WEEKLY_BONUS;
  state.stats.today.revenue += WEEKLY_BONUS;
  pushLog(state, `社區獎金 NT$ ${WEEKLY_BONUS.toLocaleString('en-US')} 入帳`, 'good');
  state.uiQueue.push({ type: 'toast', message: `社區獎金 NT$ ${WEEKLY_BONUS.toLocaleString('en-US')} 入帳`, kind: 'good' });
  return WEEKLY_BONUS;
}
