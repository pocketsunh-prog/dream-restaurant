// ============================================================================
// tests/smoke.mjs — 無 DOM 模擬煙霧測試
// 用法: node tests/smoke.mjs [days]
// 驗證：模擬不變式（現金有限、評價在範圍內、顧客不卡死、任務不會爆量），
//       並跑滿 N 天（預設 14 天，含兩次週結算）。
// ============================================================================
import { createNewGame } from '../src/core/state.js';
import { reduce } from '../src/core/actions.js';
import { stepSimulation } from '../src/sim/simulation.js';
import { getDish, dishesForStars } from '../src/data/dishes.js';
import { getLocation } from '../src/data/locations.js';
import { rebuildTables, seatCount } from '../src/sim/build.js';
import { menuLimitFor } from '../src/core/state.js';

const DAYS = Number(process.argv[2] || 14);
const SEED = Number(process.env.SEED || 20240101);

let failures = 0;
function check(cond, label, detail = '') {
  if (cond) return true;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  return false;
}

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

const state = createNewGame(SEED);
console.log(`=== 夢幻西餐廳 復刻版 · 模擬煙霧測試 ===`);
console.log(`seed=${SEED}  天數=${DAYS}`);
console.log(`起始地點：${getLocation(state.locationId)?.name}  現金 NT$ ${state.cash.toLocaleString('en-US')}`);
console.log(`起始座位：${seatCount(state.sim.tables)}  菜單：${state.menu.length} 道  員工：${state.staff.length} 人`);

// 開放更多菜色，讓模擬有變化
const extra = dishesForStars(state.stars).filter((d) => !state.menu.some((m) => m.dishId === d.id)).slice(0, 4);
for (const d of extra) reduce(state, { type: 'MENU_ADD', dishId: d.id });

let restockCount = 0;
const maxCustomersSeen = { value: 0 };
const maxTasksSeen = { value: 0 };

function invariants(tag) {
  check(finite(state.cash), `${tag}: 現金必須是有限數`, String(state.cash));
  check(state.reputation.community >= 0 && state.reputation.community <= 500,
    `${tag}: 社區評價需在 0..500`, String(state.reputation.community));
  check(state.reputation.outside >= 0 && state.reputation.outside <= 500,
    `${tag}: 區外評價需在 0..500`, String(state.reputation.outside));
  check(state.minute >= 0 && state.minute < 1440, `${tag}: 時間需在 0..1439`, String(state.minute));
  check(state.day >= 1, `${tag}: 天數需 >= 1`);
  check(state.stars >= 1 && state.stars <= 5, `${tag}: 星級需在 1..5`, String(state.stars));
  check(state.sim.customers.length <= 400, `${tag}: 顧客人數異常`, String(state.sim.customers.length));
  check(state.sim.tasks.length <= 400, `${tag}: 任務數量異常`, String(state.sim.tasks.length));
  check(state.staff.every((s) => finite(s.wage) && s.wage >= 1), `${tag}: 員工時薪異常`);
  for (const c of state.sim.customers) {
    if (!finite(c.x) || !finite(c.y)) {
      check(false, `${tag}: 顧客座標必須有限`, `${c.uid} (${c.x},${c.y})`);
      break;
    }
  }
  maxCustomersSeen.value = Math.max(maxCustomersSeen.value, state.sim.customers.length);
  maxTasksSeen.value = Math.max(maxTasksSeen.value, state.sim.tasks.length);
}

let totalGuests = 0;
let totalRevenue = 0;
let totalAngry = 0;
const dayLog = [];

/** 模擬一位「稱職的老闆」：修繕、清潔、叫貨、擴桌、補人、買防護設備 */
const EXPANSION_TABLES = [
  { x: 3, y: 8 }, { x: 3, y: 10 }, { x: 8, y: 10 }, { x: 12, y: 10 },
  { x: 16, y: 6 }, { x: 16, y: 8 }, { x: 9, y: 3 }, { x: 12, y: 3 }
];
const EXPANSION_CHAIRS = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 8, y: 9 }, { x: 12, y: 9 },
  { x: 16, y: 5 }, { x: 16, y: 7 }, { x: 9, y: 2 }, { x: 12, y: 2 }
];

function morningRoutine(day) {
  // 修設備、修傢俱、清潔
  for (const target of ['ac', 'stove', 'fridge']) {
    if (state.sim.equipBroken[target]) reduce(state, { type: 'REPAIR', target });
  }
  for (const item of state.layout.items) {
    if (item.broken || (item.durability ?? 100) < 55) reduce(state, { type: 'REPAIR', uid: item.uid });
  }
  if (state.sim.dirt.restroom > 55) reduce(state, { type: 'CLEAN', target: 'restroom' });
  if (state.sim.dirt.floor > 65) reduce(state, { type: 'CLEAN', target: 'floor' });

  // 叫貨
  for (const entry of state.menu.filter((m) => m.active)) {
    const have = state.stock[entry.dishId] || 0;
    const incoming = state.suppliers.filter((s) => s.dishId === entry.dishId).reduce((a, b) => a + b.servings, 0);
    if (have + incoming < 50) {
      const res = reduce(state, { type: 'BUY_STOCK', dishId: entry.dishId, servings: 60 });
      if (res.ok) restockCount += 1;
    }
  }

  // 開幕大補帖：防護設備與裝飾
  if (day === 1) {
    for (const id of ['cctv', 'infrared_sensor', 'fire_system', 'security_host', 'fire_extinguisher', 'fridge', 'ceiling_lamp', 'stereo', 'painting_landscape', 'wooden_screen', 'flower_stand', 'aquarium']) {
      reduce(state, { type: 'PLACE_FURNITURE', typeId: id, x: -1, y: -1 });
    }
  }

  // 隨生意成長擴桌
  const tables = state.layout.items.filter((i) => i.typeId.startsWith('table_')).length;
  if (tables < 8 && state.cash > 120000) {
    const t = EXPANSION_TABLES[tables - 2];
    const c = EXPANSION_CHAIRS[tables - 2];
    if (t) reduce(state, { type: 'PLACE_FURNITURE', typeId: 'table_2a', x: t.x, y: t.y });
    if (c) reduce(state, { type: 'PLACE_FURNITURE', typeId: 'chair_wood', x: c.x, y: c.y });
  }

  // 補人（最多 8 位）
  if (state.staff.length < 12 && state.cash > 80000 && state.candidates.length) {
    reduce(state, { type: 'HIRE', candidateId: state.candidates[0].candidateId });
  }
  // 加菜（讓菜單更豐富）
  const wantDishes = Math.min(menuLimitFor(state.stars), 4 + day);
  if (state.menu.length < wantDishes) {
    const pool = dishesForStars(state.stars).filter((d) => !state.menu.some((m) => m.dishId === d.id));
    if (pool.length) {
      const pick = pool.reduce((best, d2) => ((d2.popularity?.[state.locationId] ?? 1) > (best.popularity?.[state.locationId] ?? 1) ? d2 : best), pool[0]);
      reduce(state, { type: 'MENU_ADD', dishId: pick.id });
    }
  }
  // 有錢就提升材料等級（口味分數的主要來源）＋ 買裝飾
  if (state.cash > 200000) {
    for (const entry of state.menu.filter((m) => m.active)) {
      if ((entry.grade ?? 50) < 88) {
        reduce(state, { type: 'MENU_UPDATE', dishId: entry.dishId, patch: { grade: Math.min(90, (entry.grade ?? 50) + 4) } });
      }
    }
    for (const id of ['painting_landscape', 'flower_stand', 'aquarium', 'wooden_screen', 'carpet_red', 'lantern_row']) {
      reduce(state, { type: 'PLACE_FURNITURE', typeId: id, x: -1, y: -1 });
    }
  }
  // 士氣管理：心情差就調薪，班表一律涵蓋營業時間，指派櫃台結帳與清掃
  const waiters = state.staff.filter((s) => s.role === 'waiter');
  waiters.forEach((st, i) => {
    reduce(state, { type: 'SET_SHIFT', uid: st.uid, start: 600, end: 1380 });
    reduce(state, { type: 'SET_DUTY', uid: st.uid, duty: 'cleanFloor', on: true });
    reduce(state, { type: 'SET_DUTY', uid: st.uid, duty: 'cleanRestroom', on: true });
    if (i === 0) reduce(state, { type: 'SET_DUTY', uid: st.uid, duty: 'cashier', on: true });
    if ((st.mood ?? 70) < 45) reduce(state, { type: 'SET_WAGE', uid: st.uid, wage: Math.max(3, st.wage + 1) });
  });
  for (const st of state.staff.filter((s) => s.role === 'chef')) {
    reduce(state, { type: 'SET_SHIFT', uid: st.uid, start: 600, end: 1380 });
    if ((st.mood ?? 70) < 45) reduce(state, { type: 'SET_WAGE', uid: st.uid, wage: Math.max(3, st.wage + 1) });
  }
}

/** 開局佈置：桌椅、裝飾、人手 */
function setupFirstDay() {
  const plan = [
    { id: 'table_2a', x: 5, y: 7 }, { id: 'table_2a', x: 5, y: 9 },
    { id: 'table_2a', x: 15, y: 6 }, { id: 'table_2a', x: 15, y: 8 },
    { id: 'chair_wood', x: 5, y: 6 }, { id: 'chair_wood', x: 5, y: 8 },
    { id: 'chair_wood', x: 15, y: 5 }, { id: 'chair_wood', x: 15, y: 7 }
  ];
  for (const p of plan) {
    const res = reduce(state, { type: 'PLACE_FURNITURE', typeId: p.id, x: p.x, y: p.y });
    if (!res.ok) console.warn(`  (擺設略過 ${p.id}@${p.x},${p.y}: ${res.error})`);
  }
  for (const cand of state.candidates.slice(0, 3)) {
    const res = reduce(state, { type: 'HIRE', candidateId: cand.candidateId });
    if (!res.ok) break;
  }
}
setupFirstDay();

for (let d = 0; d < DAYS; d++) {
  morningRoutine(d + 1);
  const open = reduce(state, { type: 'START_DAY' });
  if (!open.ok) {
    check(false, `第 ${state.day} 天無法開店`, open.error);
    // 嘗試補救：加桌椅
    reduce(state, { type: 'PLACE_FURNITURE', typeId: 'table_2a', x: 5, y: 9 });
    const retry = reduce(state, { type: 'START_DAY' });
    if (!retry.ok) break;
  }

  let guard = 0;
  const startDay = state.day;
  while (state.phase === 'open' || state.phase === 'closing') {
    stepSimulation(state, 5);           // 每步 5 遊戲分鐘
    guard += 1;
    if (guard % 24 === 0) {
      invariants(`第 ${startDay} 天 / ${Math.floor(state.minute / 60)}:00`);
      if (guard % 96 === 0) morningRoutine(startDay);
    }
    if (guard > 1200) {
      check(false, `第 ${startDay} 天無法結束（顧客卡住）`, `customers=${state.sim.customers.length} phase=${state.phase}`);
      break;
    }
  }
  invariants(`第 ${startDay} 天結束`);

  const rec = state.stats.history[state.stats.history.length - 1];
  if (rec && rec.day === startDay) {
    totalGuests += rec.guests;
    totalRevenue += rec.revenue;
    totalAngry += rec.angry;
    dayLog.push({
      day: rec.day,
      guests: rec.guests,
      served: rec.served,
      angry: rec.angry,
      revenue: rec.revenue,
      profit: rec.profit,
      repC: rec.repCommunity,
      repO: rec.repOutside,
      stars: rec.stars
    });
  }

  // 清空結算事件佇列（模擬 UI 已關閉）
  state.uiQueue.length = 0;

  if (d < DAYS - 1) {
    const next = reduce(state, { type: 'NEXT_DAY' });
    if (!next.ok) {
      check(false, '無法進入隔天', next.error);
      break;
    }
  }
}

/* --------------------------------------------------------------- 結果輸出 */

console.log('\n--- 逐日結果 ---');
console.log('天  來客  服務  生氣   營業額      淨利      社區   區外  星');
for (const r of dayLog) {
  console.log(
    `${String(r.day).padStart(2)}  ${String(r.guests).padStart(4)}  ${String(r.served).padStart(4)}  ${String(r.angry).padStart(4)}  ` +
    `${String(r.revenue).padStart(9)}  ${String(r.profit).padStart(9)}  ${String(Math.round(r.repC)).padStart(5)}  ${String(Math.round(r.repO)).padStart(5)}  ${r.stars}`
  );
}

console.log('\n--- 總計 ---');
console.log(`天數        : ${state.day}`);
console.log(`總來客      : ${totalGuests}`);
console.log(`總營業額    : NT$ ${totalRevenue.toLocaleString('en-US')}`);
console.log(`總生氣離開  : ${totalAngry}`);
console.log(`目前現金    : NT$ ${Math.round(state.cash).toLocaleString('en-US')}`);
console.log(`星級        : ${state.stars}`);
console.log(`評價(社區/區外): ${Math.round(state.reputation.community)} / ${Math.round(state.reputation.outside)}`);
console.log(`週結算次數  : ${state.stats.weekly.length}`);
if (state.stats.weekly.length) {
  const w = state.stats.weekly[state.stats.weekly.length - 1];
  console.log(`最近週排名  : 總第 ${w.totalRank} 名（口味 ${w.ranks.taste} / 服務 ${w.ranks.service} / 裝潢 ${w.ranks.decor} / 價格 ${w.ranks.price} / 人氣 ${w.ranks.popularity}）`);
}
console.log(`進貨次數    : ${restockCount}`);
console.log(`最大同時顧客: ${maxCustomersSeen.value}`);
console.log(`最大任務數  : ${maxTasksSeen.value}`);

console.log('\n--- 週結算摘要 ---');
console.log('週  期間        總排名  口味 服務 裝潢 價格 人氣  星  獎金');
for (const w of state.stats.weekly) {
  console.log(`${String(w.week).padStart(2)}  d${w.startDay}-${w.endDay}  ${String(w.totalRank).padStart(5)}  ${String(w.ranks.taste).padStart(4)} ${String(w.ranks.service).padStart(4)} ${String(w.ranks.decor).padStart(4)} ${String(w.ranks.price).padStart(4)} ${String(w.ranks.popularity).padStart(4)}  ${w.stars}  ${w.prize}`);
}
console.log('分數:', JSON.stringify(state.stats.weekly.at(-1)?.scores || {}));

/* ---------------------------------------------------------- 最終不變式 */

console.log('\n--- 驗收檢查 ---');
check(state.stats.history.length === DAYS, `應產生 ${DAYS} 筆日報表`, String(state.stats.history.length));
check(totalGuests > 0, '應該要有客人上門');
check(state.stats.weekly.length === Math.floor(DAYS / 7), '每 7 天要有一次週結算', String(state.stats.weekly.length));
check(state.reputation.community !== 350 || state.day > 1, '評價應該要有變化');
check(state.stats.history.every((r) => finite(r.profit) && finite(r.revenue)), '日報表數值必須有限');
check(state.staff.every((s) => s.hoursToday >= 0), '工時不得為負');
check(state.menu.length <= 99, '菜單數量合理');
check(state.stats.history.every((r) => (r.served + r.angry) <= r.guests + 1), '服務＋生氣不得超過來客數');

// 進貨到貨驗證
const arrived = state.menu.some((m) => (state.stock[m.dishId] || 0) > 0);
check(arrived, '庫存應該要有貨');

if (failures) {
  console.error(`\n❌ 煙霧測試失敗：${failures} 項`);
  process.exit(1);
} else {
  console.log('\n✅ 煙霧測試全數通過');
}

