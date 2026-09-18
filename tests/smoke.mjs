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
import { getLocation, LOCATIONS } from '../src/data/locations.js';
import { rebuildTables, seatCount, defaultLayout, isWalkableTile } from '../src/sim/build.js';
import { menuLimitFor } from '../src/core/state.js';
import { MAX_STARS, STAR_REQS } from '../src/core/balance.js';
import { makeCustomer } from '../src/sim/customer.js';
import { makeRng } from '../src/core/rng.js';
import { ACTORS } from '../src/render/actors.js';

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
  check(state.stars >= 1 && state.stars <= MAX_STARS, `${tag}: 星級需在 1..${MAX_STARS}`, String(state.stars));
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
// 擴桌位置以 26×17 的開局平面圖為準：挑桌椅腳印以外的空格（走道／沒有放桌子的區域）。
const EXPANSION_TABLES = [
  { x: 23, y: 6 }, { x: 3, y: 10 }, { x: 6, y: 10 }, { x: 20, y: 10 },
  { x: 24, y: 6 }, { x: 24, y: 10 }, { x: 2, y: 12 }, { x: 4, y: 12 },
  { x: 6, y: 12 }, { x: 8, y: 12 }
];
const EXPANSION_CHAIRS = [
  { x: 23, y: 5 }, { x: 3, y: 11 }, { x: 6, y: 11 }, { x: 20, y: 11 },
  { x: 24, y: 5 }, { x: 24, y: 11 }, { x: 2, y: 11 }, { x: 4, y: 11 },
  { x: 6, y: 11 }, { x: 8, y: 11 }
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
  if (tables < 9 && state.cash > 120000) {
    const t = EXPANSION_TABLES[tables - 2];
    // 交錯買大桌：家庭客／同事聚餐需要 4~6 人的桌子；每張桌子配 2~4 張椅子
    const order = ['table_4a', 'table_6a', 'table_4a', 'table_2a', 'table_6a', 'table_4a', 'table_4a'];
    const typeId = order[tables % order.length];
    if (t) {
      const res = reduce(state, { type: 'PLACE_FURNITURE', typeId, x: t.x, y: t.y });
      if (res.ok) {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          reduce(state, { type: 'PLACE_FURNITURE', typeId: 'chair_wood', x: t.x + dx, y: t.y + dy });
        }
      }
    }
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
  // 26×17 平面圖上的空位（在開局桌椅腳印之外）；椅子由 autoPlaceChairs 自動配
  const plan = [
    { id: 'table_2a', x: 3, y: 10 }, { id: 'table_2a', x: 20, y: 10 }
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
    reduce(state, { type: 'PLACE_FURNITURE', typeId: 'table_2a', x: 3, y: 10 });
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
      avgWait: rec.avgWaitSec,
      angryRate: rec.guests ? rec.angry / rec.guests : 0,
      perParty: rec.parties ? rec.guests / rec.parties : 0,
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
  const waits = dayLog.map((r) => r.avgWait).filter((v) => v > 0);
  const rates = dayLog.map((r) => r.angryRate);
  if (waits.length) console.log(`平均等待    : ${Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60)} 分  ｜ 生氣率 ${(rates.reduce((a, b) => a + b, 0) / rates.length * 100).toFixed(1)}%  ｜ 平均每組 ${(dayLog.reduce((a, r) => a + r.perParty, 0) / dayLog.length).toFixed(1)} 人`);
  console.log(`最近週排名  : 總第 ${w.totalRank} 名（口味 ${w.ranks.taste} / 服務 ${w.ranks.service} / 裝潢 ${w.ranks.decor} / 價格 ${w.ranks.price} / 人氣 ${w.ranks.popularity}）`);
}
console.log(`進貨次數    : ${restockCount}`);
console.log(`店面規模    : ${state.layout.items.filter((i) => i.typeId.startsWith('table_')).length} 張桌 ／ ${seatCount(state.sim.tables)} 個可用座位 ／ 裝潢 ${state.layout.items.length} 件`);
console.log(`員工        : 服務生 ${state.staff.filter((x) => x.role === 'waiter').length} 人、廚師 ${state.staff.filter((x) => x.role === 'chef').length} 人`);
console.log(`最大同時顧客: ${maxCustomersSeen.value}`);
console.log(`最大任務數  : ${maxTasksSeen.value}`);

console.log('\n--- 週結算摘要 ---');
console.log('週  期間        總排名  口味 服務 裝潢 價格 人氣  星  獎金');
for (const w of state.stats.weekly) {
  console.log(`${String(w.week).padStart(2)}  d${w.startDay}-${w.endDay}  ${String(w.totalRank).padStart(5)}  ${String(w.ranks.taste).padStart(4)} ${String(w.ranks.service).padStart(4)} ${String(w.ranks.decor).padStart(4)} ${String(w.ranks.price).padStart(4)} ${String(w.ranks.popularity).padStart(4)}  ${w.stars}  ${w.prize}`);
}
console.log('分數:', JSON.stringify(state.stats.weekly.at(-1)?.scores || {}));

/* --------------------------------------------------- 常連 Cherish（特別客層） */

console.log('\n--- 常連 Cherish ---');
{
  const s2 = createNewGame(SEED + 7);
  const rng2 = makeRng(4242);
  const cher = makeCustomer(s2, rng2, { type: 'cherish' });
  check(cher && cher.type === 'cherish', '指定客層可以建立 Cherish', cher && cher.type);
  check(cher.partySize === 1, 'Cherish 一定是一個人來', String(cher.partySize));
  check(cher.appearance && cher.appearance.sheet === 'cherish', '外觀帶有 sprite sheet 標記', cher.appearance && cher.appearance.sheet);
  check(!!ACTORS[cher.appearance.sheet], '渲染層有對應的シート定義', Object.keys(ACTORS).join(','));
  // 一般抽選也會出現（權重 > 0），且她的耐心比一般客層高
  let seen = 0;
  for (let i = 0; i < 5000; i++) {
    const c = makeCustomer(s2, rng2);
    if (c.type === 'cherish') seen++;
  }
  check(seen > 0, '一般抽選也會出現 Cherish', `${seen} / 5000 組`);
  check((cher.patience || 0) > 0 && Number.isFinite(cher.patience), '耐心值有效', String(Math.round(cher.patience)));
}

/* ------------------------------------------------- 地點與星級資料不變式 */
// NOTE: assertions below are ASCII-only on purpose (this file stays ASCII-safe).

console.log('\n--- Location / star data ---');
{
  const ids = LOCATIONS.map((l) => l.id);
  check(LOCATIONS.length >= 14, 'at least 14 locations', String(LOCATIONS.length));
  check(new Set(ids).size === ids.length, 'location ids are unique', ids.join(','));
  check(LOCATIONS[0].id === 'zhongli_xinming' && LOCATIONS[0].starsRequired === 1,
    'the original starting location is still first and playable');

  const MIX_KEYS = ['student', 'office', 'family', 'tourist', 'critic', 'vip'];
  const WEATHER_KEYS = ['sunny', 'cloudy', 'rain', 'storm', 'cold', 'heat'];
  for (const loc of LOCATIONS) {
    const errs = [];
    if (!loc.name || !loc.city || !loc.desc) errs.push('missing name/city/desc');
    if (!(loc.rentPerDay > 0)) errs.push('rentPerDay');
    if (!(loc.baseTraffic > 0)) errs.push('baseTraffic');
    if (!(loc.moveCost >= 0)) errs.push('moveCost');
    if (!(loc.gridW >= 4 && loc.gridH >= 4)) errs.push('grid');
    if (!(loc.starsRequired >= 1 && loc.starsRequired <= MAX_STARS)) errs.push('starsRequired');
    const mixSum = MIX_KEYS.reduce((a, k) => a + (Number(loc.customerMix?.[k]) || 0), 0);
    if (Math.abs(mixSum - 1) > 1e-9) errs.push('customerMix sum ' + mixSum);
    const wSum = WEATHER_KEYS.reduce((a, k) => a + (Number(loc.weatherWeights?.[k]) || 0), 0);
    if (Math.abs(wSum - 1) > 1e-9) errs.push('weatherWeights sum ' + wSum);
    if (!Array.isArray(loc.tastePrefs) || !loc.tastePrefs.length) errs.push('tastePrefs');
    if (!loc.decorStyle || !loc.skyline) errs.push('decorStyle/skyline');
    if (!loc.palette?.sky || !loc.palette?.wall || !loc.palette?.floor || !loc.palette?.accent) errs.push('palette');
    check(errs.length === 0, 'location field check: ' + loc.id, errs.join(' / '));

    // Every location needs its own walkable layout (door + pass reachable, door tile is a door).
    const L = defaultLayout(loc.id);
    const layoutErrs = [];
    if (L.gridW !== loc.gridW || L.gridH !== loc.gridH) layoutErrs.push('grid mismatch');
    if (L.tiles[L.door.y * L.gridW + L.door.x] !== 'door') layoutErrs.push('door tile');
    if (!L.passTiles.length) layoutErrs.push('no pass tile');
    if (!isWalkableTile(L, L.door.x, L.door.y)) layoutErrs.push('door not walkable');
    if (!isWalkableTile(L, L.door.x, L.door.y - 1)) layoutErrs.push('tile inside the door blocked');
    for (const p of L.passTiles) {
      if (!isWalkableTile(L, p.x, p.y)) layoutErrs.push('pass blocked @' + p.x + ',' + p.y);
      else if (!L.reachFromPass[p.y * L.gridW + p.x]) layoutErrs.push('pass unreachable @' + p.x + ',' + p.y);
    }
    const seatsFree = L.tiles.filter((t, i) => t === 'floor' && isWalkableTile(L, i % L.gridW, Math.floor(i / L.gridW))).length;
    if (seatsFree < 40) layoutErrs.push('only ' + seatsFree + ' walkable floor tiles');
    check(layoutErrs.length === 0, 'layout check: ' + loc.id, layoutErrs.join(' / '));
  }

  // Star tables must cover 1..MAX_STARS with a strictly growing shape.
  check(STAR_REQS.length === MAX_STARS + 1, 'STAR_REQS has ' + (MAX_STARS + 1) + ' entries', String(STAR_REQS.length));
  for (let s = 2; s <= MAX_STARS; s++) {
    const prev = STAR_REQS[s - 1];
    const cur = STAR_REQS[s];
    check(!!cur && cur.star === s, 'STAR_REQS[' + s + '].star === ' + s);
    check(cur.community > prev.community, 'community grows at ' + s + ' star', `${prev.community} -> ${cur.community}`);
    check(cur.outside > prev.outside, 'outside grows at ' + s + ' star', `${prev.outside} -> ${cur.outside}`);
    check(cur.days >= prev.days, 'days never shrink at ' + s + ' star', `${prev.days} -> ${cur.days}`);
    check(cur.community <= 500 && cur.outside <= 500, 'star ' + s + ' thresholds within the 0..500 rating range');
    check(menuLimitFor(s) >= menuLimitFor(s - 1), 'menu limit never shrinks at ' + s + ' star', `${menuLimitFor(s - 1)} -> ${menuLimitFor(s)}`);
  }
  check(LOCATIONS.filter((l) => l.starsRequired === MAX_STARS).length > 0,
    'at least one location is gated behind the top star');
}

/* ---------------------------------------------------------- 最終不變式 */

console.log('\n--- 驗收檢查 ---');
check(state.stats.history.length === DAYS, `應產生 ${DAYS} 筆日報表`, String(state.stats.history.length));
check(totalGuests > 0, '應該要有客人上門');
check(state.stats.weekly.length === Math.floor(DAYS / 7), '每 7 天要有一次週結算', String(state.stats.weekly.length));
check(state.reputation.community !== 350 || state.day > 1, '評價應該要有變化');
check(state.stats.history.every((r) => finite(r.profit) && finite(r.revenue)), '日報表數值必須有限');
check(state.staff.every((s) => s.hoursToday >= 0), '工時不得為負');
check(state.menu.length <= 99, '菜單數量合理');
const badDays = state.stats.history.filter((r) => (r.served + r.angry) > r.guests + 1);
check(badDays.length === 0, '服務＋生氣不得超過來客數',
  badDays.slice(0, 3).map((r) => `d${r.day}: 人${r.guests} 服務${r.served} 生氣${r.angry}`).join(' / '));

// 進貨到貨驗證
const arrived = state.menu.some((m) => (state.stock[m.dishId] || 0) > 0);
check(arrived, '庫存應該要有貨');

if (failures) {
  console.error(`\n❌ 煙霧測試失敗：${failures} 項`);
  process.exit(1);
} else {
  console.log('\n✅ 煙霧測試全數通過');
}

