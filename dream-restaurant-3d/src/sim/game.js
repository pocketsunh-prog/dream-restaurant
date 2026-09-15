// ============================================================================
// game.js — 3D 版核心模擬（無 DOM、可單獨測試）
//
//   顧客：進店 → 排隊/候位 →（服務生帶位）→ 入座 → 點餐
//         →（廚師煮菜 → 放上出餐口）→（服務生送菜）→ 用餐
//         →（服務生埋單）→ 離店；桌面變髒 →（服務生清潔）
//   員工：廚師(chef) / 外場(waiter)，員工會「認領任務」並走過去執行。
//   事件：隨機事件（天氣、設備、客訴、媒體、祭典…）影響客流／成本／人氣。
// ============================================================================
import { LOCATIONS, locationById } from '../data/locations.js';
import { DISHES, dishById } from '../data/dishes.js';
import { STAFF_POOL, staffById, candidatesFor, ROLE_LABEL } from '../data/staff.js';
import { initEvents, tickEvents, recomputeMults, activeEventInfo, forceEvent } from './events.js';
import { initMissions, tickMissions } from './missions.js';
import { tickPets } from './pets.js';

/* ---------------------------------------------------------------- 常數 */

export const OPEN_MINUTE = 11 * 60;
export const CLOSE_MINUTE = 23 * 60;
export const START_CASH = 999_999_999;

export const WEATHERS = ['sunny', 'cloudy', 'rain', 'snow', 'storm', 'heat', 'fog', 'sleet'];
export const WEATHER_JP = {
  sunny: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪',
  storm: '暴風雨', heat: '猛暑', fog: '霧', sleet: 'みぞれ'
};
/**
 * 天気ごとの客足倍率。雨・雪・暴風雨・みぞれは客足を落とし、
 * 猛暑は逆に少しだけ増える（外を歩きたくないので伸びは控えめ）。
 */
export const WEATHER_TRAFFIC = {
  sunny: 1.0, cloudy: 0.94, rain: 0.78, snow: 0.66,
  storm: 0.42, heat: 1.06, fog: 0.88, sleet: 0.72
};
/** 天気の「つらさ」0..1（顧客の機嫌・屋外系イベントの判定に使う） */
export const WEATHER_SEVERITY = {
  sunny: 0, cloudy: 0.1, rain: 0.5, snow: 0.7, storm: 1, heat: 0.6, fog: 0.35, sleet: 0.75
};

/** 走路速度：公尺 / 遊戲分鐘（會再乘上員工 speed 能力） */
export const WALK_M_PER_MIN = 2.6;
/** 員工上限 */
export const STAFF_LIMIT = 10;
/** 洗手間髒污累積速率（每分鐘，依來客數加成） */
export const RESTROOM_DIRT_PER_MIN = 0.09;

/** 顧客類型：來店時段權重（0-23 時）＋每組人數範圍＋消費倍率 */
export const CUSTOMER_KINDS = {
  office:  { jp: '会社員', zh: '上班族', party: [1, 2], spend: 1.15, patience: 1.0,  hours: { 11: 2.0, 12: 3.0, 13: 2.2, 18: 2.2, 19: 2.6, 20: 2.4, 21: 1.4 } },
  student: { jp: '学生',   zh: '學生',   party: [1, 3], spend: 0.8,  patience: 1.25, hours: { 12: 1.8, 13: 1.6, 17: 1.6, 18: 1.8, 19: 1.6, 20: 1.2 } },
  tourist: { jp: '観光客', zh: '觀光客', party: [2, 4], spend: 1.3,  patience: 1.1,  hours: { 11: 1.4, 12: 1.8, 13: 1.8, 14: 1.6, 17: 1.2, 18: 1.4, 19: 1.4 } },
  family:  { jp: '家族連れ', zh: '家庭客', party: [3, 5], spend: 1.05, patience: 0.95, hours: { 11: 1.2, 12: 1.6, 17: 1.8, 18: 2.0, 19: 1.8, 20: 1.2 } },
  couple:  { jp: 'カップル', zh: '情侶',  party: [2, 2], spend: 1.25, patience: 1.15, hours: { 18: 2.0, 19: 2.4, 20: 2.2, 21: 1.6, 22: 1.0 } },
  elder:   { jp: 'ご年配',  zh: '銀髮族', party: [1, 2], spend: 0.95, patience: 1.4,  hours: { 11: 1.6, 12: 1.4, 17: 1.4, 18: 1.2 } },
  party:   { jp: '宴会',   zh: '聚餐團', party: [4, 6], spend: 1.35, patience: 0.9,  hours: { 18: 2.2, 19: 2.4, 20: 2.0, 21: 1.2 } },
  // ── 追加客層：立地の customerMix に無くても base の割合で全地點に現れる ──
  //    pet  = 必ずペット連れ / fame = 満足したときの評價への追加ウエイト
  regular:    { jp: '常連さん',    zh: '常客',     party: [1, 2], spend: 1.1,  patience: 1.45, base: 7, hours: { 11: 1.4, 12: 1.6, 13: 1.4, 17: 1.4, 18: 1.8, 19: 1.8, 20: 1.6, 21: 1.4, 22: 1.0 } },
  solo:       { jp: 'おひとり様',  zh: '單人客',   party: [1, 1], spend: 0.95, patience: 1.2,  base: 6, hours: { 11: 1.4, 12: 1.8, 13: 1.8, 14: 1.6, 15: 1.4, 16: 1.2, 17: 1.4, 18: 1.6, 19: 1.6, 20: 1.4 } },
  business:   { jp: '接待',        zh: '商務接待', party: [2, 4], spend: 1.75, patience: 1.25, base: 3, hours: { 18: 2.4, 19: 2.6, 20: 2.2, 21: 1.4 } },
  influencer: { jp: 'SNS投稿客',   zh: '社群客',   party: [1, 2], spend: 1.45, patience: 1.05, base: 3, fame: 1.6, hours: { 12: 1.8, 13: 1.6, 14: 1.4, 18: 1.6, 19: 1.8, 20: 1.6 } },
  chefguest:  { jp: '同業の料理人', zh: '同業廚師', party: [1, 2], spend: 1.3,  patience: 1.15, base: 2, fame: 1.4, hours: { 14: 2.0, 15: 2.2, 16: 1.8, 17: 1.4 } },
  club:       { jp: '部活帰り',    zh: '社團學生', party: [3, 5], spend: 0.85, patience: 1.15, base: 4, hours: { 16: 2.0, 17: 2.4, 18: 2.0, 19: 1.2 } },
  nightworker:{ jp: '夜勤明け',    zh: '夜班下班', party: [1, 2], spend: 1.05, patience: 0.95, base: 3, hours: { 11: 2.0, 12: 1.6, 21: 1.4, 22: 1.8 } },
  petlover:   { jp: 'ペット連れ',  zh: '寵物客',   party: [2, 3], spend: 1.15, patience: 1.2,  base: 4, pet: true, hours: { 11: 1.6, 12: 1.6, 13: 1.4, 14: 1.4, 15: 1.2, 16: 1.2 } },
  // スプライトシート（6 コマ歩行）で描かれる特別な常連。一人で來て、甘い物とコーヒーを好む。
  cherish:    { jp: 'Cherish',     zh: 'Cherish',   party: [1, 1], spend: 1.5,  patience: 1.4,  base: 3, fame: 1.5, sheet: 'cherish', hours: { 11: 1.4, 12: 1.6, 13: 1.6, 14: 1.8, 15: 1.8, 16: 1.4, 17: 1.2, 18: 1.4, 19: 1.6, 20: 1.4 } },
  // ── 有名人・テレビ局（人氣が高い店にだけ來る。満足すれば大きく宣傳、怒らせれば大打擊）──
  actor:      { jp: '俳優',        zh: '演員',     party: [2, 3], spend: 1.8, patience: 1.3,  base: 2, famous: true, fame: 2.2, hours: { 12: 1.4, 13: 1.4, 18: 1.8, 19: 2.0, 20: 1.8, 21: 1.2 } },
  celebrity:  { jp: '人氣タレント', zh: '知名藝人', party: [2, 4], spend: 2.0, patience: 1.2,  base: 2, famous: true, fame: 2.0, hours: { 12: 1.6, 13: 1.4, 18: 1.6, 19: 2.0, 20: 1.8 } },
  tvcrew:     { jp: 'テレビ取材クルー', zh: '電視採訪組', party: [3, 5], spend: 1.6, patience: 1.35, base: 2, famous: true, fame: 1.8, hours: { 11: 1.6, 12: 1.8, 13: 1.6, 14: 1.4, 15: 1.2 } }
};
export const KIND_IDS = Object.keys(CUSTOMER_KINDS);
const KIND_JP = Object.fromEntries(Object.entries(CUSTOMER_KINDS).map(([k, v]) => [k, v.jp]));

/** 任務種類：角色、優先度（越大越先做）、基準作業時間（分鐘） */
export const TASK_KINDS = {
  collect:       { role: 'waiter', priority: 92, work: 1.2, jp: 'お会計' },
  deliver:       { role: 'waiter', priority: 86, work: 0.8, jp: '配膳' },
  seat:          { role: 'waiter', priority: 78, work: 0.6, jp: 'ご案内' },
  cleanTable:    { role: 'waiter', priority: 58, work: 2.0, jp: '片付け' },
  cleanRestroom: { role: 'waiter', priority: 46, work: 3.5, jp: 'トイレ清掃' },
  cook:          { role: 'chef',   priority: 80, work: 0,   jp: '調理' }
};

/* ---------------------------------------------------------------- 亂數 */

/**
 * 可序列化的亂數（存檔要能完全還原，所以狀態必須取得出來）。
 * 回傳的函式帶有 state()／setState()，存檔時只存數字即可。
 */
function mulberry32(a) {
  let s = a >>> 0;
  const fn = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.state = () => s >>> 0;
  fn.setState = (v) => { s = (v >>> 0) || 1; };
  return fn;
}
export { mulberry32 };

/* ---------------------------------------------------------------- 設定 */

/** 預設設定（存檔會保存它） */
export function defaultSettings() {
  return {
    openMinute: OPEN_MINUTE,
    closeMinute: CLOSE_MINUTE,
    floorCount: 1,            // 1〜3 樓
    speed: 1,                 // 開局速度
    autoRotate: false,        // 攝影機自動環繞
    fov: 46,
    graphics: {
      pixelRatio: 'auto',     // 'auto' | 1 | 1.5 | 2
      shadows: true,
      shadowQuality: 'high',  // 'high' | 'medium' | 'low'
      exposure: 1.0
    },
    audio: { master: 0.75, music: 0.5, sfx: 0.8, ambience: 0.45 },
    showHints: true
  };
}

export function openMinute(state) { return state?.settings?.openMinute ?? OPEN_MINUTE; }
export function closeMinute(state) { return state?.settings?.closeMinute ?? CLOSE_MINUTE; }

/** 更新營業時間（至少 2 小時，且開店早於打烊） */
/** 每加一層的擴建費用（索引 = 要新增的樓層） */
export const FLOOR_COST = [0, 0, 800000, 2400000];

export function setFloorCount(state, n) {
  const target = Math.max(1, Math.min(3, Math.round(n)));
  const current = state.plan?.floorCount || 1;
  if (target === current) return { ok: true, floorCount: current, cost: 0 };
  if (target < current) return { ok: false, error: '不能減少樓層' };
  // 一層一層往上加：1→3 也要付 2F + 3F 的錢
  let cost = 0;
  for (let f = current + 1; f <= target; f++) cost += FLOOR_COST[f] || 0;
  if (state.cash < cost) return { ok: false, error: `資金不足（擴建 ¥${cost.toLocaleString('en-US')}）` };
  state.cash -= cost;
  state.today.floorCost = (state.today.floorCost || 0) + cost;
  state.settings.floorCount = target;
  // 重建平面
  state.plan = buildFloorPlan(state.seed + state.day, { floorCount: target });
  state.restrooms = {};                 // 新しいフロアも含めて洗手間を作り直す
  syncRestroomAggregate(state);
  // 同步桌子狀態
  for (const s of state.staff) { s.taskId = null; s.carry = 0; }
  return { ok: true, floorCount: target, cost };
}

/** 更新營業時間（至少 2 小時，且開店早於打烊） */
export function setBusinessHours(state, open, close) {
  const o = Math.max(0, Math.min(1439, Math.round(open)));
  const c = Math.max(0, Math.min(1439, Math.round(close)));
  if (!(o < c)) return { ok: false, error: '開店時間必須早於打烊時間' };
  if (c - o < 120) return { ok: false, error: '營業時間至少要 2 小時' };
  state.settings.openMinute = o;
  state.settings.closeMinute = c;
  // 營業中調整就即時反映
  if (state.phase === 'open' && state.minuteFloat >= c) state.phase = 'closing';
  return { ok: true, open: o, close: c };
}

/** 一般設定寫入（含畫質／相機） */
export function setSetting(state, path, value) {
  const parts = String(path).split('.');
  let node = state.settings;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return { ok: true, settings: state.settings };
}

/* ------------------------------------------------------- 店內平面配置 */

/**
 * 產生餐廳平面（支援多樓層）。
 * 一樓（floor 0）有大門、廚房、吧台、廁所；樓上（floor 1, 2）純用餐區。
 * 樓梯固定在 (stairX, stairZ)，連通所有樓層。
 */
export function buildFloorPlan(seed = 1, rooms = {}) {
  const rng = mulberry32(seed >>> 0);
  const W = 13.2, D = 9.6;
  const FLOOR_HEIGHT = 3.4;
  const stairX = -5.6, stairZ = 1.4;   // 樓梯位置（所有樓層相同 XY）
  const RW_X = -5.9, RW_Z = -4.15;     // 洗手間群（所有樓層相同位置・男性/女性で左右）

  /** 產生單一樓層的桌子 */
  function buildFloorTables(floorIdx, rng2) {
    const tables = [];
    const mk = (id, x, z, seats, style) => {
      const t = { id, x, z, floor: floorIdx, seats, style, occupants: [], seatPos: [], occupied: false, groupId: null, kind: 'free', dirty: 0, petOk: false };
      const R = style === 'chabudai' ? 0.78 : 0.82;
      for (let i = 0; i < seats; i++) {
        const ang = (i / seats) * Math.PI * 2 + (style === 'chabudai' ? Math.PI / 4 : 0);
        // ry 是「坐著的人」的面向：角色模型正面為 +Z，所以面向要指向桌心。
        // （以前寫成 -ang + PI，椅子與客人都是側向桌子 90°，看起來就是「椅子很亂」。）
        t.seatPos.push({
          x: x + Math.cos(ang) * R,
          z: z + Math.sin(ang) * R,
          ry: Math.atan2(-Math.cos(ang), -Math.sin(ang)),
          ang
        });
      }
      tables.push(t);
      return t;
    };
    if (floorIdx === 0) {
      // 一樓：靠窗四人桌 + 南側二人桌 + 榻榻米（北側是調理場與出餐口）
      const cols = [-4.6, -1.9];
      const rows = [-2.55, 0.15];
      let n = 0;
      for (const z of rows) for (const x of cols) mk('t' + (++n), x + (rng2() - 0.5) * 0.12, z + (rng2() - 0.5) * 0.12, 4, 'table');
      mk('t' + (++n), 3.1, -1.1, 4, 'table');
      mk('t' + (++n), 0.8, 0.15, 4, 'table');
      const pet1 = mk('t' + (++n), -4.9, 2.7, 2, 'table');
      const pet2 = mk('t' + (++n), -3.1, 2.75, 2, 'table');
      const pet3 = mk('t' + (++n), 3.5, 2.5, 4, 'chabudai');
      const pet4 = mk('t' + (++n), 5.3, 2.5, 4, 'chabudai');
      // ペット同伴席：靠門口與緣側的座位可以帶寵物進來（場景會鋪寵物墊、放水碗）
      for (const t of [pet1, pet2, pet3, pet4]) { t.petOk = true; t.kind = 'pet'; }
    } else {
      // 樓上：四人桌兩排（樓梯旁留走道）
      const cols = [-4.6, -1.9, 0.8, 3.4];
      const rows = [-2.5, 0.2];
      let n = floorIdx * 100;
      for (const z of rows) {
        for (const x of cols) {
          // 樓梯位置（x=-5.6, z=1.4）旁邊不擺桌
          if (Math.abs(x + 4.6) < 0.5 && Math.abs(z - 1.4) < 1.0) continue;
          mk('t' + (++n), x + (rng2() - 0.5) * 0.1, z + (rng2() - 0.5) * 0.1, 4, 'table');
        }
      }
    }
    return tables;
  }

  const floorCount = Math.max(1, Math.min(3, rooms.floorCount || 1));
  const floorPlans = [];
  for (let f = 0; f < floorCount; f++) {
    const tables = buildFloorTables(f, rng);
    floorPlans.push({
      tables,
      stair: { x: stairX, z: stairZ },
      // 各樓層に「男性用／女性用」の洗手間を必ず用意する（北西の角）
      restrooms: {
        m: { x: RW_X - 0.9, z: RW_Z, jp: 'お手洗い（男性）', zh: '男廁' },
        f: { x: RW_X + 0.9, z: RW_Z, jp: 'お手洗い（女性）', zh: '女廁' }
      },
      // 各樓層的地板高度（繪圖用）
      yOffset: f * FLOOR_HEIGHT
    });
  }

  return {
    width: W,
    depth: D,
    floorCount,
    floorHeight: FLOOR_HEIGHT,
    floorPlans,
    stairs: { x: stairX, z: stairZ },
    // 一樓專用設施位置（相容舊版 UI 與路徑搜尋）
    counter: { x: -5.2, z: -0.3, len: 3.4 },
    // 調理場（厨房）：北牆一帶，開放式（看得到廚師做菜）
    kitchen: { x: 3.6, z: -4.0, w: 5.6, d: 1.9 },
    stove: { x: 3.4, z: -3.55 },
    pass: { x: 1.9, z: -3.0 },
    // 舊版相容：1F 的洗手間（＝男性用）だけを指す
    restroom: { x: RW_X - 0.9, z: RW_Z },
    // 各樓層に男性用・女性用の洗手間がある（floorPlans[f].restrooms が正）
    restrooms: floorPlans.map((fp) => fp.restrooms),
    entrance: { x: 1.2, z: D / 2 - 0.1 },
    outside: { x: 1.2, z: D / 2 + 1.7 },
    // 街道（人行道兩端）：客人從這裡走過來，吃飽也從這裡走回去
    street: { ax: -12.4, az: D / 2 + 1.6, bx: 12.4, bz: D / 2 + 1.6 },
    // 候位動線：從店門口沿人行道往東排（step = 每組間距）
    queue: { x: 2.6, z: D / 2 + 2.3, step: 1.15 },
    tatami: { x: 4.4, z: 2.5, w: 4.4, d: 3.4 },
    ...rooms
  };
}

/** 取得某一樓層的桌子（全部樓層的 flat list 相容舊版） */
export function allTables(plan) {
  const out = [];
  for (const fp of plan.floorPlans || []) out.push(...fp.tables);
  return out;
}

/* ------------------------------------------------------------ 事件 */

export function emit(state, type, data = {}) {
  if (!Array.isArray(state.events)) state.events = [];
  state.events.push({ type, at: state.minute, ...data });
  if (state.events.length > 96) state.events.splice(0, state.events.length - 96);
}

export function drainEvents(state) {
  const out = Array.isArray(state.events) ? state.events : [];
  state.events = [];
  return out;
}

/* ------------------------------------------------- 名物（在地招牌菜） */

export const SPECIALTY_ALIAS = {
  sushi: 'nigiri_sushi', unagi: 'unagi_don', donburi: 'gyudon', curry_rice: 'curry_udon',
  champon: 'ramen', soki_soba: 'soba', gyoza_okinawa: 'gyoza', kissaten_set: 'teishoku',
  yakiniku: 'yakitori', shabu_shabu: 'oden'
};

export function resolveSpecialties(loc) {
  const out = [];
  for (const raw of loc?.specialties || []) {
    const id = dishById(raw) ? raw : SPECIALTY_ALIAS[raw];
    if (id && dishById(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function activeSpecialtyCount(state) {
  const sp = resolveSpecialties(locationById(state.locationId));
  if (!sp.length) return 0;
  return state.menu.filter((m) => m.active && sp.includes(m.id)).length;
}

/* ------------------------------------------------------------ 建立遊戲 */

export function createGame({ locationId = 'tokyo_shibuya', seed = 20240601, starterStaff = true } = {}) {
  const loc = locationById(locationId) || LOCATIONS[0];
  const state = {
    version: 2,
    seed,
    rng: mulberry32(seed),
    day: 1,
    minute: OPEN_MINUTE,
    minuteFloat: OPEN_MINUTE,
    settings: defaultSettings(),
    speed: 1,
    paused: false,
    phase: 'open',
    locationId: loc.id,
    cash: START_CASH,
    stars: 1,
    fame: 12,
    menu: [],
    plan: buildFloorPlan(seed),
    groups: [],
    queue: [],
    staff: [],
    tasks: [],
    pass: [],                  // 出餐口待送的菜
    restroom: { dirt: 0 },
    equipment: ['fridge', 'ac_unit'],
    equipBroken: { fridge: false, ac_unit: false, stove: false },
    candidates: [],
    events: [],
    eventLog: [],
    activeEvents: [],
    eventTimer: 120,
    eventMults: { traffic: 1, cost: 1, mood: 0, fatigue: 0 },
    taskSeq: 1,
    today: emptyDay(),
    ledger: emptyLedger(),
    history: [],
    weather: 'sunny',
    log: [],
    nextGroupId: 1,
    servedTotal: 0,
    angryTotal: 0
  };

  // 菜單：優先放入當地名物
  const specialties = resolveSpecialties(loc);
  const avail = DISHES.filter((d) => d.stars <= state.stars).sort((a, b) => b.popularity - a.popularity);
  const picked = [];
  for (const id of specialties) {
    const d = dishById(id);
    if (d && d.stars <= state.stars && !picked.includes(id)) picked.push(id);
  }
  for (const d of avail) {
    if (picked.length >= 6) break;
    if (!picked.includes(d.id)) picked.push(d.id);
  }
  for (const id of picked) {
    const d = dishById(id);
    state.menu.push({ id, price: d.price, active: true, stock: 60, specialty: specialties.includes(id) });
  }

  // 開局員工：一位料理人 + 一位ホール（最低限度能營運）
  if (starterStaff) {
    const chef = STAFF_POOL.find((s) => s.role === 'chef' && s.stars === 1) || STAFF_POOL.find((s) => s.role === 'chef');
    const waiter = STAFF_POOL.find((s) => s.role === 'waiter' && s.stars === 1) || STAFF_POOL.find((s) => s.role === 'waiter');
    for (const c of [chef, waiter]) if (c) state.staff.push(makeHiredStaff(c, 1));
  }
  layoutStaffHome(state);
  refreshCandidates(state);

  state.weather = rollWeather(state, loc);
  initEvents(state);
  initMissions(state);
  return state;
}

/** 由候選資料建立「已雇用員工」 */
export function makeHiredStaff(cand, day = 1) {
  const uniformId = cand.role === 'chef' ? 'chef_classic' : 'waiter_classic';
  return {
    id: cand.id,
    name: cand.name,
    kana: cand.kana,
    role: cand.role,
    age: cand.age,
    gender: cand.gender,
    skill: cand.skill,
    speed: cand.speed,
    stamina: cand.stamina,
    wage: cand.wage,
    specialty: cand.specialty,
    personality: cand.personality,
    traits: cand.traits || [],
    desc: cand.desc,
    appearance: cand.appearance,
    hiredDay: day,
    uniformId,
    mood: 72,
    fatigue: 0,
    taskId: null,
    x: 0, z: 0, dir: 0,
    pose: 'stand',
    carry: 0,
    workMinutes: 0
  };
}

/** 更換員工制服 */
export function setStaffUniform(state, staffId, uniformId) {
  const s = state.staff.find((x) => x.id === staffId);
  if (!s) return { ok: false, error: '沒有這位員工' };
  s.uniformId = uniformId;
  return { ok: true, staff: s };
}

/** 一次更換整個職種（料理人／ホール）所有人的制服 */
export function setRoleUniform(state, role, uniformId) {
  const list = (state.staff || []).filter((s) => s.role === role);
  if (!list.length) return { ok: false, error: role === 'chef' ? '料理人がいません' : 'ホールがいません' };
  for (const s of list) s.uniformId = uniformId;
  return { ok: true, role, uniformId, count: list.length };
}

/* ---------------------------------------------------- 星級の條件とヒント */

/**
 * 星級ごとの昇格條件。settleDay で満たしていれば自動で昇格する。
 *   guests: 累計來客 / fame: 人氣 / days: 営業日數 / missions: 依頼の達成數 / floors: 必要階數
 */
export const STAR_REQS = [
  null,
  null,
  { stars: 2, guests: 120, fame: 35, days: 3, missions: 0, floors: 1 },
  { stars: 3, guests: 400, fame: 55, days: 7, missions: 3, floors: 1 },
  { stars: 4, guests: 900, fame: 72, days: 14, missions: 6, floors: 2 },
  { stars: 5, guests: 1800, fame: 90, days: 24, missions: 10, floors: 3 }
];

export const STAR_LABEL = {
  guests: '累計來客', fame: '評價（人氣）', days: '營業日數', missions: '依頼の達成', floors: '階數'
};

/** 人氣を上げるための實戰ヒント（HUD の「⭐ 目標」に出す） */
export const FAME_TIPS = [
  '來客を増やす：名物をメニューに入れる／立地の客層に合った品書きにする／營業時間を延ばす',
  '怒らせない：ホールと料理人を増やして「帶位・配膳・お会計」が滯らないようにする',
  '清潔を保つ：洗手間が汚れると客の機嫌が下がる（トイレ清掃タスクを消化させる）',
  '設備を整える：空調・冷蔵庫・コンロが故障すると料理と評價が落ちる（故障は即修理）',
  '接客の質：腕前の高い従業員を雇い、疲労が溜まったらシフトを考え直す',
  'イベントを活かす：テレビ取材・SNS・祭りなどの好材料は逃さない（壞材料は設備で半減）'
];

/** 現在の星級・次の條件・進捗・ヒントをまとめて返す（HUD 用） */
export function starReport(state) {
  const stars = Math.max(1, Math.min(5, state.stars || 1));
  const req = STAR_REQS[Math.min(5, stars + 1)] || null;
  const missionsDone = state.missions ? Object.keys(state.missions.claimed || {}).length : 0;
  const cur = {
    guests: state.servedTotal || 0,
    fame: Math.round((state.fame || 0) * 10) / 10,
    days: state.day || 1,
    missions: missionsDone,
    floors: state.plan?.floorCount || 1
  };
  const list = req ? Object.keys(STAR_LABEL).map((k) => ({
    key: k,
    label: STAR_LABEL[k],
    cur: cur[k],
    target: req[k] || 0,
    ok: (cur[k] || 0) >= (req[k] || 0)
  })) : [];
  return {
    stars,
    max: 5,
    next: stars < 5 ? stars + 1 : null,
    req,
    list,
    cur,
    tips: FAME_TIPS,
    ready: !!req && list.every((r) => r.ok)
  };
}

/** 昇格條件を満たしているか（settleDay から呼ぶ）。昇格したら新しい星を返す */
export function checkStarUp(state) {
  const r = starReport(state);
  if (!r.next || !r.ready) return null;
  state.stars = r.next;
  state.fame = Math.min(100, (state.fame || 0) + 4);   // 昇格ボーナス
  emit(state, 'starup', { stars: state.stars });
  return state.stars;
}

/* ---------------------------------------------------- 店の混み具合（看板用） */

/**
 * 店內／候位的即時狀況：門口的「にぎわい看板」與 HUD 都用這份資料。
 *   insideGuests / insideGroups — 已經在店裡的人（不含還在街上走過來的）
 *   seats / seatsFree           — 座位數與空位
 *   waiting / waitingList       — 候位組數與每一組的人數、等了幾分鐘
 *   petInside / petWaiting      — 帶寵物的組數
 */
export function crowdInfo(state) {
  const groups = state.groups || [];
  const tables = allTables(state.plan);
  const seats = tables.reduce((a, t) => a + t.seats, 0);
  const inside = groups.filter((g) => g.state !== 'entering' && g.state !== 'gone'
    && g.state !== 'leaving' && g.state !== 'angryLeave');
  const queue = state.queue || [];
  const waitingList = queue.map((gid, i) => {
    const g = groups.find((x) => x.id === gid);
    return {
      no: i + 1,
      id: gid,
      size: g?.size || 0,
      kindJp: g?.kindJp || '',
      waitMin: Math.round(g?.wait || 0),
      pet: !!g?.pet,
      maxWait: Math.round(g?.patience || 0)
    };
  });
  const seatsFree = tables.filter((t) => !t.occupied && t.dirty === 0).reduce((a, t) => a + t.seats, 0);
  const queueGuests = (state.queue || []).reduce((a, gid) => a + (groups.find((x) => x.id === gid)?.size || 0), 0);
  return {
    insideGuests: inside.reduce((a, g) => a + g.size, 0),
    insideGroups: inside.length,
    walkingIn: groups.filter((g) => g.state === 'entering').length,
    seats,
    seatsFree,
    tables: tables.length,
    tablesFree: tables.filter((t) => !t.occupied && t.dirty === 0).length,
    petOkTables: tables.filter((t) => t.petOk).length,
    waiting: queue.length,
    waitingList,
    queueGuests,
    maxQueueWait: waitingList.reduce((a, w) => Math.max(a, w.waitMin), 0),
    petInside: inside.filter((g) => g.pet).length,
    petWaiting: waitingList.filter((w) => w.pet).length,
    petToday: state.today?.petGroups || 0,
    todayGuests: state.today?.guests || 0,
    full: seatsFree <= 0,
    phase: state.phase,
    minute: Math.round(state.minute || 0)
  };
}

/** 指派員工的待機位置（廚房／外場） */
export function layoutStaffHome(state) {
  const k = state.plan.kitchen;
  let ci = 0, wi = 0;
  for (const s of state.staff) {
    if (s.role === 'chef') {
      s.home = { x: k.x - 1.4 + ci * 1.1, z: k.z + 0.7 };
      ci++;
    } else {
      s.home = { x: -3.0 + wi * 1.6, z: 1.1 };
      wi++;
    }
    if (!s.taskId) { s.x = s.home.x; s.z = s.home.z; }
  }
}

export function emptyDay() {
  return {
    guests: 0, groups: 0, served: 0, angry: 0,
    revenue: 0, cost: 0, tips: 0, walkouts: 0, maxQueue: 0,
    wages: 0, eventCash: 0, events: 0, tasksDone: 0, hireCost: 0,
    kindCount: {}, dishCount: {}, taskCount: {}
  };
}

/* ------------------------------------------------- 累計帳（排行榜用） */

/**
 * 全期累計帳：排行榜（店內排行／全地點排行）的資料來源。
 *   dishes    : 每道菜的累計點餐數與營收
 *   kinds     : 客層的組數／人數／營收
 *   hours     : 時段（0-23）的組數／人數／營收
 *   staff     : 每位員工的任務數與經手營收
 *   locations : 每個待過的地點的最佳日、累計營收、天數
 */
export function emptyLedger() {
  return { dishes: {}, kinds: {}, hours: {}, staff: {}, locations: {}, meta: {} };
}

/** 把 ledger 補齊（讀舊存檔時用） */
export function ensureLedger(state) {
  const L = state.ledger && typeof state.ledger === 'object' ? state.ledger : {};
  const base = emptyLedger();
  state.ledger = {
    dishes: L.dishes || base.dishes,
    kinds: L.kinds || base.kinds,
    hours: L.hours || base.hours,
    staff: L.staff || base.staff,
    locations: L.locations || base.locations,
    meta: L.meta || base.meta
  };
  return state.ledger;
}

/** 累加某個 bucket 的欄位（bucket 不存在就建立） */
function bumpLedger(state, bucket, key, add) {
  const L = ensureLedger(state);
  const b = L[bucket];
  if (!b) return null;
  const cur = b[key] || (b[key] = {});
  for (const [k, v] of Object.entries(add)) cur[k] = (cur[k] || 0) + v;
  return cur;
}

/** 菜單上的售價（沒有自訂價就用定價） */
function menuPrice(state, id) {
  const m = (state.menu || []).find((x) => x.id === id);
  return m?.price || dishById(id)?.price || 0;
}

/**
 * その日の天気を決める。
 *   1) 立地ごとの基本割合（sunny / cloudy / rain / snow、合計 100）で抽選
 *   2) その上で季節・氣温・前日からの流れによる追加天気を上書き抽選する
 *      （猛暑・暴風雨・霧・みぞれ）。立地データを増やさずに天気の種類を増やすための仕組み。
 */
export function rollWeather(state, loc = locationById(state.locationId)) {
  const w = loc?.weather || { sunny: 40, cloudy: 30, rain: 20, snow: 10 };
  const r = state.rng() * 100;
  let base = 'sunny';
  let acc = 0;
  for (const k of WEATHERS) {
    const share = w[k] || 0;
    if (!share) continue;
    acc += share;
    if (r < acc) { base = k; break; }
  }
  // 追加天気の抽選（月 = 30 日區切りの季節で判定）
  const day = state.day || 1;
  const season = Math.floor(((day - 1) % 360) / 30);      // 0..11（0 = 4 月想定）
  const coldSeason = season >= 9 || season <= 2;          // 冬〜初春
  const hotSeason = season >= 4 && season <= 7;            // 夏
  const severe = WEATHER_SEVERITY[base] || 0;
  const roll = state.rng();
  // 猛暑：夏の晴れ／曇りの日に出やすい
  if (hotSeason && (base === 'sunny' || base === 'cloudy') && roll < 0.22) return 'heat';
  // 暴風雨：雨の日がさらに荒れる（初秋が最も多い）
  if (base === 'rain' && roll < (season >= 6 && season <= 9 ? 0.3 : 0.16)) return 'storm';
  // みぞれ：冬の雨（雪にならない程度の冷たい雨）
  if (base === 'rain' && coldSeason && roll < 0.34) return 'sleet';
  // 霧：寒い時期の曇り／晴れの朝
  if (coldSeason && (base === 'cloudy' || base === 'sunny') && roll < 0.2) return 'fog';
  // 前日が荒れていたら、翌日は少し落ち着いた曇りになりやすい
  if (severe >= 0.7 && base === 'sunny' && roll < 0.28) return 'cloudy';
  return base;
}

export function money(v) {
  const n = Math.round(Number(v) || 0);
  return '¥' + n.toLocaleString('en-US');
}

export function seatsOfPlan(plan) {
  let n = 0;
  for (const t of allTables(plan)) n += t.seats;
  return n;
}

export function clockText(minute) {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* -------------------------------------------------------- 雇用／解雇 */

export function refreshCandidates(state) {
  state.candidates = candidatesFor({
    stars: state.stars,
    day: state.day,
    count: 5,
    seed: state.seed + state.day * 17,
    exclude: state.staff.map((s) => s.id)
  }).map((c) => c.id);
  return state.candidates;
}

export function candidateInfo(state) {
  return state.candidates.map((id) => staffById(id)).filter(Boolean);
}

export function hireStaff(state, id) {
  const cand = staffById(id);
  if (!cand) return { ok: false, error: '找不到這位應徵者' };
  if (state.staff.length >= STAFF_LIMIT) return { ok: false, error: `員工上限 ${STAFF_LIMIT} 人` };
  if (state.staff.some((s) => s.id === id)) return { ok: false, error: '已經雇用過了' };
  if (state.cash < cand.hireCost) return { ok: false, error: `資金不足（簽約金 ${money(cand.hireCost)}）` };
  state.cash -= cand.hireCost;
  state.today.hireCost = (state.today.hireCost || 0) + cand.hireCost;
  const hired = makeHiredStaff(cand, state.day);
  state.staff.push(hired);
  layoutStaffHome(state);
  state.candidates = state.candidates.filter((c) => c !== id);
  emit(state, 'hired', { name: cand.name, role: cand.role, staffId: cand.id });
  return { ok: true, staff: hired };
}

export function fireStaff(state, id) {
  const idx = state.staff.findIndex((s) => s.id === id);
  if (idx < 0) return { ok: false, error: '沒有這位員工' };
  const target = state.staff[idx];
  if (target.role === 'chef' && state.staff.filter((s) => s.role === 'chef').length <= 1) {
    return { ok: false, error: '至少要留一位料理人' };
  }
  if (target.role === 'waiter' && state.staff.filter((s) => s.role === 'waiter').length <= 1) {
    return { ok: false, error: '至少要留一位ホール' };
  }
  const severance = Math.round(target.wage * 4);
  state.cash -= severance;
  state.staff.splice(idx, 1);
  for (const t of state.tasks) if (t.claimedBy === id) { t.claimedBy = null; t.phase = 'todo'; }
  layoutStaffHome(state);
  emit(state, 'fired', { name: target.name, severance, staffId: id });
  return { ok: true, severance };
}

/* ------------------------------------------------------------ 設備 */

/** 可購買的設備（事件減免用；fridge／ac_unit 開局就有） */
export const EQUIPMENT_CATALOG = {
  fridge:           { jp: '業務用冷蔵庫', zh: '商用冰箱',   price: 180000, desc: '食材の傷みと食中毒の噂を軽減' },
  ac_unit:          { jp: '冷暖房',       zh: '空調',       price: 240000, desc: '気温によるお客の不快感を軽減' },
  cctv:             { jp: '防犯カメラ',   zh: '監視器',     price: 180000, desc: '万引き・ネズミの被害を軽減' },
  infrared_sensor:  { jp: '赤外線センサー', zh: '紅外線感應', price: 260000, desc: '侵入・盗難の被害を軽減' },
  fire_extinguisher:{ jp: '消火器',       zh: '滅火器',     price: 42000,  desc: '厨房火災の被害を軽減' },
  fire_system:      { jp: '消防設備',     zh: '消防設備',   price: 380000, desc: '火災報知器の誤作動・検査を軽減' },
  security_host:    { jp: '警備システム', zh: '保全系統',   price: 520000, desc: '台風・災害時の被害を軽減' }
};

export function buyEquipment(state, id) {
  const def = EQUIPMENT_CATALOG[id];
  if (!def) return { ok: false, error: '沒有這項設備' };
  if ((state.equipment || []).includes(id)) return { ok: false, error: '已經購入' };
  if (state.cash < def.price) return { ok: false, error: `資金不足（${money(def.price)}）` };
  state.cash -= def.price;
  state.equipment.push(id);
  state.today.equipCost = (state.today.equipCost || 0) + def.price;
  emit(state, 'equip', { id, name: def.zh });
  return { ok: true, def };
}

export function repairEquipment(state, id) {
  const cost = id === 'stove' ? 90000 : id === 'fridge' ? 70000 : 120000;
  if (!state.equipBroken?.[id]) return { ok: false, error: '這項設備沒有故障' };
  if (state.cash < cost) return { ok: false, error: `資金不足（修理費 ${money(cost)}）` };
  state.cash -= cost;
  state.today.repairCost = (state.today.repairCost || 0) + cost;
  state.equipBroken[id] = false;
  emit(state, 'repair', { id });
  return { ok: true, cost };
}

/* ------------------------------------------------------------ 任務池 */

function addTask(state, type, data = {}) {
  const def = TASK_KINDS[type];
  if (!def) return null;
  const t = {
    id: 'k' + (state.taskSeq++),
    type,
    role: def.role,
    priority: def.priority,
    work: def.work,
    createdAt: state.minute,
    claimedBy: null,
    phase: 'todo',
    workLeft: 0,
    floor: 0,                 // 任務在哪一層（0 = 一樓）；服務生會走到那一層執行
    ...data
  };
  state.tasks.push(t);
  state.today.taskCount[type] = (state.today.taskCount[type] || 0) + 1;
  return t;
}

function hasTask(state, type, pred) {
  return state.tasks.some((t) => t.type === type && pred(t));
}

function removeTask(state, id) {
  const i = state.tasks.findIndex((t) => t.id === id);
  if (i >= 0) state.tasks.splice(i, 1);
}

/** 依能力換算作業時間（skill 越高越快，疲勞會拖慢） */
function workTime(staff, base) {
  const fatiguePenalty = 1 + (staff?.fatigue || 0) / 160;
  const skillFactor = staff ? (1.35 - staff.skill / 130) : 1;
  return Math.max(0.3, base * skillFactor * fatiguePenalty);
}

function walkSpeed(staff) {
  return WALK_M_PER_MIN * (0.75 + (staff?.speed ?? 60) / 220) * (1 - (staff?.fatigue || 0) / 260);
}

/* -------------------------------------------------------- 客流與生成 */

export function trafficMultiplier(state, loc) {
  const hour = Math.floor(state.minute / 60);
  let mul = 0;
  const mix = loc.customerMix || {};
  for (const [kind, weight] of Object.entries(mix)) {
    if (!weight) continue;
    const def = CUSTOMER_KINDS[kind];
    if (!def) continue;
    mul += (weight / 100) * (def.hours[hour] || 0);
  }
  if (hour === 12 || hour === 13) mul *= 1.15;
  if (hour === 19) mul *= 1.2;
  const weather = WEATHER_TRAFFIC[state.weather] ?? 1;
  const fame = 0.55 + Math.min(1.6, state.fame / 42);
  const stars = 0.85 + state.stars * 0.09;
  const spBonus = 1 + Math.min(0.28, activeSpecialtyCount(state) * 0.07);
  const evMul = state.eventMults?.traffic ?? 1;
  return mul * weather * fame * stars * spBonus * evMul;
}

export function pickKind(state, loc) {
  const hour = Math.floor(state.minute / 60);
  const mix = loc.customerMix || {};
  const pool = [];
  let total = 0;
  // テスト／デモ用：forceKindLeft があるうちはその客層を優先する（Cherish の確認に使う）
  if (state.forceKindLeft > 0 && CUSTOMER_KINDS[state.forceKind]) {
    state.forceKindLeft -= 1;
    return state.forceKind;
  }
  // 立地的な客層（customerMix）＋ 全地點共通の追加客層（base）の両方を候補にする
  const consider = (kind, weight) => {
    const def = CUSTOMER_KINDS[kind];
    if (!def || !weight) return;
    const h = (def.hours[hour] || 0) + 0.08;
    const w = weight * h;
    total += w;
    pool.push({ kind, w: total });
  };
  for (const [kind, weight] of Object.entries(mix)) {
    if (CUSTOMER_KINDS[kind]) consider(kind, weight);
    else consider(kind, weight);   // mix にしか無い客層もそのまま扱う
  }
  // customerMix に載っていない追加客層（base 持ち）を加える
  for (const [kind, def] of Object.entries(CUSTOMER_KINDS)) {
    if (mix[kind] !== undefined) continue;
    if (!def.base) continue;
    // 知名度が上がると「わざわざ來てくれる」客層（同業・SNS）が少し増える
    const fameBoost = def.fame ? (0.7 + Math.min(1.1, (state.fame || 0) / 55)) : 1;
    consider(kind, def.base * fameBoost);
  }
  if (!total) return 'office';
  const r = state.rng() * total;
  for (const p of pool) if (r <= p.w) return p.kind;
  return pool[pool.length - 1].kind;
}

function partySizeFor(state, kind) {
  const def = CUSTOMER_KINDS[kind];
  const [a, b] = def.party;
  const raw = a + Math.floor(state.rng() * (b - a + 1));
  return Math.max(1, Math.min(raw, 2 + state.stars));
}

/** 產生一組客人（測試用對外匯出） */
export function spawnGroup(state, loc) {
  const kind = pickKind(state, loc);
  const size = partySizeFor(state, kind);
  const def = CUSTOMER_KINDS[kind];
  // 顧客多樣化：寵物（家庭／情侶／銀髮約 13%；ペット連れ客層は必ず連れてくる）
  const PET_KINDS = ['dog', 'cat', 'rabbit', 'bird'];
  let pet = null, petSeed = 0;
  if (def.pet || ((kind === 'family' || kind === 'couple' || kind === 'elder') && state.rng() < 0.13)) {
    pet = PET_KINDS[Math.floor(state.rng() * PET_KINDS.length)];
    petSeed = Math.floor(state.rng() * 9999);
  }
  // 從街道的一端走過來（東西兩側隨機，看起來像真的從街上過來）
  const street = state.plan.street || { ax: -12.4, az: state.plan.outside.z, bx: 12.4, bz: state.plan.outside.z };
  const fromWest = state.rng() < 0.5;
  const startX = fromWest ? street.ax : street.bx;
  const startZ = fromWest ? street.az : street.bz;
  const exitX = fromWest ? street.bx : street.ax;      // 離店後往另一頭走去
  const exitZ = fromWest ? street.bz : street.az;
  const g = {
    id: 'g' + (state.nextGroupId++),
    kind,
    kindJp: KIND_JP[kind] || kind,
    size,
    state: 'entering',
    t: 0,
    patience: (170 + state.rng() * 90) * def.patience,
    wait: 0,
    tableId: null,
    seatIdx: [],
    floor: 0,
    orders: [],
    eatLeft: 0,
    paid: 0,
    mood: 0,
    served: false,
    escorted: false,
    spend: def.spend,
    pet,
    petSeed,
    // スプライトシートで描く客層（billboard）。未指定なら手続き的モデルを使う
    sheet: def.sheet || null,
    fromWest,
    exit: { x: exitX, z: exitZ },
    released: false,
    walk: { x: startX, z: startZ, speed: 1.15, dir: fromWest ? Math.PI / 2 : -Math.PI / 2 },
    members: []
  };
  for (let i = 0; i < size; i++) {
    // 隊伍成形：兩人一排，前後稍微錯開，走在路上不會疊成一團
    const ox = ((i % 2) - 0.5) * 0.52;
    const oz = (Math.floor(i / 2) - 0.4) * 0.5;
    g.members.push({
      seed: Math.floor(state.rng() * 1e9), seat: -1, eating: false,
      x: startX, z: startZ, ry: g.walk.dir, ox, oz
    });
  }
  state.today.kindCount[kind] = (state.today.kindCount[kind] || 0) + 1;
  if (pet) {
    state.today.petGroups = (state.today.petGroups || 0) + 1;
    bumpLedger(state, 'meta', 'petGroups', { count: 1 });
  }
  bumpLedger(state, 'kinds', kind, { groups: 1, guests: size });
  bumpLedger(state, 'hours', String(Math.min(23, Math.floor(state.minute / 60))), { groups: 1, guests: size });
  return g;
}

/** 幫新客人分配到一個有容量的樓層（回傳樓層 index 或 null） */
export function pickFloorForGroup(state, size) {
  const plan = state.plan;
  if (plan.floorCount <= 1) return 0;
  // 優先分配到桌子最充足的樓層
  let best = 0, bestSeats = -1;
  for (let f = 0; f < plan.floorCount; f++) {
    let free = 0;
    for (const t of plan.floorPlans[f].tables) {
      if (!t.occupied && t.dirty === 0 && t.seats >= size) free += t.seats;
    }
    if (free > bestSeats) { bestSeats = free; best = f; }
  }
  // 若全部沒空位，還是分配到 0 樓（等等候位）
  return best;
}
/**
 * 找一張適合的桌子。
 * @param {object} [opts] opts.pet = true → 帶寵物的客人優先坐「ペット同伴席」
 *                       opts.noPet = true → 沒帶寵物的客人先避開寵物席
 */
export function findTable(state, size, floorIdx = null, opts = {}) {
  const tables = allTables(state.plan).filter((t) => floorIdx === null || t.floor === floorIdx);
  const pick = (wantPet) => {
    let best = null;
    for (const t of tables) {
      if (t.occupied || t.dirty > 0) continue;
      if (t.seats < size) continue;
      if (wantPet !== null && !!t.petOk !== wantPet) continue;
      const waste = t.seats - size;
      if (!best || waste < best.waste) best = { t, waste };
    }
    return best ? best.t : null;
  };
  if (opts.pet) {
    // 帶寵物：先找寵物席，真的客滿才坐普通桌（寵物還是可以一起進店）
    return pick(true) || pick(null);
  }
  if (opts.noPet) {
    // 沒帶寵物：先坐普通桌，把寵物席留給需要的人
    return pick(false) || pick(null);
  }
  return pick(null);
}

function orderFor(state, group) {
  const picks = [];
  const actives = state.menu.filter((m) => m.active && (m.stock > 0));
  if (!actives.length) return picks;
  const count = 1 + Math.floor((group.size - 1) / 2) + (state.rng() < 0.45 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const d = actives[Math.floor(state.rng() * actives.length)];
    if (!d) break;
    picks.push(d.id);
    state.today.dishCount[d.id] = (state.today.dishCount[d.id] || 0) + 1;
    bumpLedger(state, 'dishes', d.id, { count: 1 });
    d.stock = Math.max(0, d.stock - 1);
  }
  return picks;
}

function cookMinutes(state, ids) {
  let t = 0;
  for (const id of ids) t += (dishById(id)?.cookTime || 8);
  return Math.max(1.5, t * 0.55);
}

function dishCost(state, ids, spend) {
  let c = 0;
  for (const id of ids) c += (dishById(id)?.cost || 100);
  const mul = state.eventMults?.cost ?? 1;
  return c * spend * mul;
}

function dishRevenue(state, ids, spend, size) {
  const sp = resolveSpecialties(locationById(state.locationId));
  let r = 0;
  for (const id of ids) {
    const base = dishById(id)?.price || 500;
    r += sp.includes(id) ? base * 1.12 : base;
  }
  const chefs = state.staff.filter((s) => s.role === 'chef');
  const avgSkill = chefs.length ? chefs.reduce((a, c) => a + c.skill, 0) / chefs.length : 50;
  const skillBonus = 0.96 + Math.min(0.14, (avgSkill - 50) / 500);
  return Math.round(r * spend * Math.max(1, size * 0.62) * skillBonus);
}

/* ------------------------------------------------------------- 主迴圈 */

export function tick(state, dtMin) {
  if (dtMin <= 0) return;
  const loc = locationById(state.locationId) || LOCATIONS[0];
  state.minuteFloat += dtMin;
  state.minute = state.minuteFloat;

  if (state.phase === 'open') {
    const mul = trafficMultiplier(state, loc);
    const perMin = (loc.trafficBase / 60) * mul * 0.5;
    state.spawnAcc = (state.spawnAcc || 0) + perMin * dtMin;
    const cap = 4 + state.stars * 2 + state.staff.length;
    while (state.spawnAcc >= 1) {
      state.spawnAcc -= 1;
      if (state.groups.length + state.queue.length < cap) {
        const g = spawnGroup(state, loc);
        state.today.groups += 1;
        state.today.guests += g.size;
        state.groups.push(g);
      }
    }
    if (state.minuteFloat >= closeMinute(state)) state.phase = 'closing';
  }

  for (const g of state.groups) updateGroup(state, g, dtMin);
  updateStaff(state, dtMin);
  tickPets(state, dtMin);       // ペットスペース：連れられたペットが遊びに行く
  cleanupTasks(state);
  updateDirt(state, dtMin);

  const evs = tickEvents(state, dtMin);
  for (const e of evs) emit(state, 'event', e);

  // ミッション（依頼）：達成したら通知イベントを積む（賞金は HUD の「受取」で）
  const fresh = tickMissions(state);
  for (const f of fresh) {
    emit(state, 'mission', {
      id: f.mission.id, jp: f.mission.jp, zh: f.mission.zh,
      reward: f.mission.reward
    });
  }

  for (let i = state.groups.length - 1; i >= 0; i--) {
    if (state.groups[i].state === 'gone') state.groups.splice(i, 1);
  }

  if (state.phase === 'closing' && !state.groups.length) state.phase = 'settle';
}

/**
 * 洗手間のグレード（改修）。グレードが高いほど汚れにくく、客の満足度が上がる。
 *   level 0 = 和式（初期狀態）→ 洋式 → ウォシュレット → 暖房便座＋自動清掃
 */
export const RESTROOM_LEVELS = [
  { level: 0, jp: '和式', zh: '和式', cost: 0, dirtMul: 1.0, fame: 0, mood: 0 },
  { level: 1, jp: '洋式', zh: '西式', cost: 120000, dirtMul: 0.7, fame: 0.02, mood: 0.4 },
  { level: 2, jp: 'ウォシュレット', zh: '免治馬桶', cost: 380000, dirtMul: 0.5, fame: 0.05, mood: 1.0 },
  { level: 3, jp: '暖房便座＋自動清掃', zh: '暖座＋自動清掃', cost: 900000, dirtMul: 0.28, fame: 0.09, mood: 1.8 }
];
export const RESTROOM_MAX_LEVEL = RESTROOM_LEVELS.length - 1;

/** その部屋の改装レベル（未改修は 0） */
export function restroomLevel(state, floor, which) {
  const map = state.restroomLv && typeof state.restroomLv === 'object' ? state.restroomLv : {};
  const v = map[restroomKey(floor, which)];
  return Number.isFinite(v) ? Math.max(0, Math.min(RESTROOM_MAX_LEVEL, v)) : 0;
}

export function restroomLevelInfo(level) {
  return RESTROOM_LEVELS[Math.max(0, Math.min(RESTROOM_MAX_LEVEL, level | 0))];
}

/** 全洗手間の平均グレード（0..3）。客の評価ボーナスに使う */
export function avgRestroomLevel(state) {
  const list = restroomList(state);
  if (!list.length) return 0;
  return list.reduce((a, r) => a + r.level, 0) / list.length;
}

/**
 * 洗手間を 1 段階改修する。
 * @param {number} floor 樓層 / @param {'m'|'f'} which 男性用・女性用
 * @returns {{ok:boolean, cost?:number, level?:number, jp?:string, error?:string}}
 */
export function renovateRestroom(state, floor, which, discount = 1) {
  const floors = state.plan && state.plan.floorPlans ? state.plan.floorPlans : [];
  const fp = floors[floor];
  if (!fp || !fp.restrooms || !fp.restrooms[which]) return { ok: false, error: 'その洗手間はありません' };
  const cur = restroomLevel(state, floor, which);
  if (cur >= RESTROOM_MAX_LEVEL) return { ok: false, error: 'これ以上は改装できません' };
  const next = restroomLevelInfo(cur + 1);
  const cost = Math.round(next.cost * discount);
  if ((state.cash || 0) < cost) return { ok: false, error: `資金不足（${money(cost)} 必要）` };
  state.cash -= cost;
  state.restroomLv = state.restroomLv || {};
  state.restroomLv[restroomKey(floor, which)] = cur + 1;
  // 改修した部屋はきれいな狀態から始まる
  setRestroomDirt(state, floor, which, 0);
  emit(state, 'renovate', { floor, which, level: cur + 1, jp: next.jp, cost });
  return { ok: true, cost, level: cur + 1, jp: next.jp, zh: next.zh };
}

/** その樓層の男性用・女性用をまとめて改修（10% 割引） */
export function renovateFloorRestrooms(state, floor) {
  const done = [];
  for (const which of ['m', 'f']) {
    const r = renovateRestroom(state, floor, which, 0.9);
    if (r.ok) done.push({ which, ...r });
  }
  if (!done.length) return { ok: false, error: '改修できる洗手間がありません（資金不足か最大グレード）' };
  const cost = done.reduce((a, d) => a + d.cost, 0);
  return { ok: true, cost, rooms: done, level: done[0].level };
}

/**
 * 各樓層・男女別の洗手間の汚れ（0..100）。
 * state.restrooms は "樓層:性別" をキーにした單なる數值マップ（存檔そのまま）。
 * 舊版との互換のため state.restroom.dirt には「一番汚い部屋」を入れておく。
 */
export function restroomKey(floor, which) { return `${floor}:${which}`; }

export function restroomDirt(state, floor, which) {
  if (!state.restrooms || typeof state.restrooms !== 'object') state.restrooms = {};
  const k = restroomKey(floor, which);
  if (typeof state.restrooms[k] !== 'number') state.restrooms[k] = 0;
  return state.restrooms[k];
}

export function setRestroomDirt(state, floor, which, v) {
  if (!state.restrooms || typeof state.restrooms !== 'object') state.restrooms = {};
  state.restrooms[restroomKey(floor, which)] = Math.max(0, Math.min(100, v));
  syncRestroomAggregate(state);
  return state.restrooms[restroomKey(floor, which)];
}

function syncRestroomAggregate(state) {
  let worst = 0;
  for (const v of Object.values(state.restrooms || {})) if (v > worst) worst = v;
  state.restroom = state.restroom || { dirt: 0 };
  state.restroom.dirt = worst;
  return worst;
}

/** 全洗手間（樓層×男女）の一覧。HUD・看板・テスト用 */
export function restroomList(state) {
  const out = [];
  const floors = state.plan?.floorPlans || [];
  for (let f = 0; f < floors.length; f++) {
    const rw = floors[f].restrooms || {};
    for (const which of ['m', 'f']) {
      const spot = rw[which];
      if (!spot) continue;
      out.push({
        floor: f, which, jp: spot.jp, zh: spot.zh, x: spot.x, z: spot.z,
        dirt: Math.round(restroomDirt(state, f, which)),
        level: restroomLevel(state, f, which),
        levelJp: restroomLevelInfo(restroomLevel(state, f, which)).jp
      });
    }
  }
  return out;
}

function updateDirt(state, dtMin) {
  const guests = state.groups.reduce((a, g) => a + g.size, 0);
  const floors = state.plan?.floorPlans || [];
  // 來客が多いほど汚れる。1F は出入口があるので少しだけ早い
  const rate = RESTROOM_DIRT_PER_MIN * 0.6 * (1 + guests * 0.06);
  for (let f = 0; f < floors.length; f++) {
    for (const which of ['m', 'f']) {
      if (!floors[f].restrooms || !floors[f].restrooms[which]) continue;
      const lvMul = restroomLevelInfo(restroomLevel(state, f, which)).dirtMul;
      const add = rate * (f === 0 ? 1 : 0.7) * lvMul;
      setRestroomDirt(state, f, which, restroomDirt(state, f, which) + add * dtMin);
    }
  }
  // 72 を超えた部屋ごとに「トイレ清掃」タスクを立てる（同時に立てすぎない）
  const dirty = restroomList(state).filter((r) => r.dirt > 72);
  if (dirty.length && state.tasks.filter((t) => t.type === 'cleanRestroom').length < 2) {
    const worst = dirty.sort((a, b) => b.dirt - a.dirt)[0];
    addTask(state, 'cleanRestroom', {
      tx: worst.x, tz: worst.z, floor: worst.floor, which: worst.which,
      jp: `${worst.jp}`
    });
  }
  // どこかが汚いと客の機嫌が下がる
  if ((state.restroom?.dirt || 0) > 60) {
    for (const g of state.groups) g.mood = Math.max(-3, g.mood - dtMin * 0.02);
  }
}

function moveToward(w, tx, tz, dtMin, speed) {
  const dx = tx - w.x, dz = tz - w.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) { w.x = tx; w.z = tz; return true; }
  const step = Math.min(d, speed * dtMin);
  w.x += (dx / d) * step;
  w.z += (dz / d) * step;
  w.dir = Math.atan2(dx, dz);
  return false;
}

/* ------------------------------------------------------- 顧客狀態機 */

function tableOf(state, g) {
  return allTables(state.plan).find((t) => t.id === g.tableId) || null;
}

/**
 * 客が怒って帰るときの共通處理。
 * 有名人・テレビ取材クルーを怒らせた場合は、噂になって評價が大きく落ちる。
 */
function emitAngry(state, g, reason) {
  emit(state, 'angry', { size: g.size, kind: g.kind, reason });
  const def = CUSTOMER_KINDS[g.kind] || {};
  if (def.famous) {
    const hit = 4 * (1 + Math.min(1.0, (state.fame || 0) / 70));
    state.fame = Math.max(0, (state.fame || 0) - hit);
    emit(state, 'famousAngry', { kind: g.kind, jp: def.jp, zh: def.zh, reason });
  }
}

function updateGroup(state, g, dtMin) {
  const plan = state.plan;
  switch (g.state) {
    case 'entering': {
      // 從街上走過來：先在店門前的人行道集合，再走進門（不會穿牆斜切）
      if (!g.frontReached) {
        const fx = plan.entrance.x + (g.fromWest ? 1.6 : -1.6);
        const fz = plan.outside.z;
        g.frontReached = moveToward(g.walk, fx, fz, dtMin, 1.25);
        syncMembers(g, 'walk', dtMin);
        if (!g.frontReached) break;
      }
      const atDoor = moveToward(g.walk, plan.entrance.x, plan.entrance.z, dtMin, 1.15);
      syncMembers(g, 'walk', dtMin);
      if (!atDoor) break;
      // 門口鈴只響一次
      if (!g.doorAnnounced) {
        g.doorAnnounced = true;
        emit(state, 'door', { size: g.size, kind: g.kind });
        if (g.sheet === 'cherish') emit(state, 'cherish', { size: g.size });
      }
      // 有位子 → 保留桌位並建立帶位任務；沒位子 → 到店外排隊
      if (!trySeatTable(state, g)) {
        g.state = 'queue';
        g.wait = 0;
        if (!state.queue.includes(g.id)) state.queue.push(g.id);
      }
      break;
    }

    case 'queue': {
      g.wait += dtMin;
      const idx = Math.max(0, state.queue.indexOf(g.id));
      const q = plan.queue || { x: plan.entrance.x + 1.4, z: plan.outside.z, step: 1.15 };
      // 沿著人行道（店外街道）排成一列，隊伍越長排越遠
      const qx = q.x + q.step * idx;
      const qz = q.z + (idx % 2 ? 0.16 : 0);
      const arrived = moveToward(g.walk, qx, qz, dtMin, 1.0);
      if (arrived) g.walk.dir = Math.atan2(plan.entrance.x - g.walk.x, plan.entrance.z - g.walk.z);
      syncMembers(g, arrived ? 'wait' : 'walk', dtMin);
      if (!state.queue.includes(g.id)) state.queue.push(g.id);
      state.today.maxQueue = Math.max(state.today.maxQueue, state.queue.length);
      if (g.wait > g.patience) {
        emitAngry(state, g, 'queue');
        state.today.angry += g.size;
        state.today.walkouts += 1;
        state.angryTotal += g.size;
        removeFromQueue(state, g.id);
        g.state = 'angryLeave';
        g.released = false;
        break;
      }
      trySeatTable(state, g);
      break;
    }

    case 'waitSeat': {
      g.wait += dtMin;
      syncMembers(g, 'wait', dtMin);
      if (g.escorted) { g.state = 'toSeat'; g.t = 0; break; }
      if (g.wait > g.patience * 0.75) {
        emitAngry(state, g, 'noWaiter');
        state.today.angry += g.size;
        state.angryTotal += g.size;
        releaseTable(state, g);
        g.state = 'angryLeave';
        g.released = false;
      }
      break;
    }

    case 'toSeat': {
      const table = tableOf(state, g);
      if (!table) { g.state = 'leaving'; g.released = false; break; }
      g.t += dtMin;
      // 樓上的位子：先走到樓梯再上樓
      if ((table.floor || 0) > 0 && (g.floor || 0) !== table.floor) {
        const st = plan.stairs || { x: -5.6, z: 1.4 };
        const atStairs = moveToward(g.walk, st.x, st.z, dtMin, 1.35);
        syncMembers(g, 'walk', dtMin);
        if (atStairs) g.floor = table.floor;
        break;
      }
      const seat = table.seatPos[g.seatIdx[0] % table.seats];
      const arrived = moveToward(g.walk, seat.x, seat.z, dtMin, 1.5);
      syncMembers(g, 'walk', dtMin);
      if (arrived || g.t > 6) {
        emit(state, 'seat', { size: g.size });
        g.floor = table.floor || 0;
        g.members.forEach((m, i) => {
          const sp = table.seatPos[g.seatIdx[i] % table.seats];
          m.x = sp.x; m.z = sp.z; m.ry = sp.ry;
        });
        g.state = 'ordering';
        g.t = 0;
        g.orderWait = 2.5 + state.rng() * 3;
      }
      break;
    }

    case 'ordering': {
      g.t += dtMin;
      syncMembers(g, 'sit', dtMin);
      if (g.t >= g.orderWait) {
        g.orders = orderFor(state, g);
        if (!g.orders.length) { g.state = 'waitPay'; g.t = 0; break; }
        state.today.cost += dishCost(state, g.orders, g.spend);
        emit(state, 'order', { dishes: g.orders.length, size: g.size });
        addTask(state, 'cook', {
          groupId: g.id, tableId: g.tableId,
          dishIds: g.orders.slice(),
          tx: plan.stove.x, tz: plan.stove.z + 0.9,
          floor: 0,
          work: cookMinutes(state, g.orders)
        });
        g.state = 'waitCook';
        g.t = 0;
      }
      break;
    }

    case 'waitCook': {
      g.t += dtMin;
      syncMembers(g, 'sit', dtMin);
      if (state.pass.some((p) => p.groupId === g.id)) {
        if (!hasTask(state, 'deliver', (t) => t.groupId === g.id)) {
          const table = tableOf(state, g);
          const seat = table?.seatPos?.[0];
          addTask(state, 'deliver', {
            groupId: g.id, tableId: g.tableId,
            tx: plan.pass.x, tz: plan.pass.z + 0.7,
            toX: seat?.x ?? table?.x ?? plan.pass.x,
            toZ: seat?.z ?? table?.z ?? plan.pass.z,
            floor: table?.floor ?? g.floor ?? 0
          });
        }
        g.state = 'waitServe';
        g.t = 0;
        break;
      }
      const chefs = state.staff.filter((s) => s.role === 'chef').length;
      if (chefs === 0 || g.t > g.patience) {
        emitAngry(state, g, chefs ? 'slowKitchen' : 'noChef');
        state.today.angry += g.size;
        state.angryTotal += g.size;
        releaseTable(state, g);
        g.state = 'angryLeave';
        g.t = 0;
      }
      break;
    }

    case 'waitServe': {
      g.t += dtMin;
      syncMembers(g, 'sit', dtMin);
      if (g.served) {
        emit(state, 'serve', { size: g.size });
        g.served = false;
        g.eatLeft = 8 + g.orders.length * 3.2 + state.rng() * 4;
        g.state = 'eating';
        g.t = 0;
        break;
      }
      const waiters = state.staff.filter((s) => s.role === 'waiter').length;
      if (waiters === 0 || g.t > g.patience) {
        emitAngry(state, g, waiters ? 'slowServe' : 'noWaiter');
        state.today.angry += g.size;
        state.angryTotal += g.size;
        clearPassFor(state, g.id);
        releaseTable(state, g);
        g.state = 'angryLeave';
        g.t = 0;
      }
      break;
    }

    case 'eating': {
      g.eatLeft -= dtMin;
      syncMembers(g, 'eat', dtMin);
      if (g.eatLeft <= 0) {
        g.state = 'waitPay';
        g.t = 0;
        const table = tableOf(state, g);
        const seat = table?.seatPos?.[0];
        addTask(state, 'collect', {
          groupId: g.id, tableId: g.tableId,
          tx: seat?.x ?? table?.x ?? 0, tz: seat?.z ?? table?.z ?? 0,
          floor: table?.floor ?? g.floor ?? 0
        });
      }
      break;
    }

    case 'waitPay': {
      g.t += dtMin;
      syncMembers(g, 'sit', dtMin);
      if (g.paid > 0) { g.state = 'leaving'; g.t = 0; g.released = false; break; }
      const waiters = state.staff.filter((s) => s.role === 'waiter').length;
      if (waiters === 0 || g.t > g.patience * 1.4) {
        const rev = dishRevenue(state, g.orders, g.spend, g.size);
        settlePayment(state, g, rev, 0.5);
        emit(state, 'pay', { amount: rev, size: g.size, self: true });
        g.state = 'leaving';
        g.t = 0;
        g.released = false;
      }
      break;
    }

    case 'angryLeave':
    case 'leaving': {
      const angry = g.state === 'angryLeave';
      // 樓上的客人：先走到樓梯下樓
      if ((g.floor || 0) > 0 && !g.released) {
        const st = plan.stairs || { x: -5.6, z: 1.4 };
        const atStairs = moveToward(g.walk, st.x, st.z, dtMin, 1.2);
        syncMembers(g, angry ? 'angry' : 'walk', dtMin);
        if (atStairs) g.floor = 0;
        g.t += dtMin;
        break;
      }
      // 1) 先走出大門（到人行道）→ 這時候就把桌子還給櫃檯，服務生才能收桌
      if (!g.released) {
        const atDoor = moveToward(g.walk, plan.entrance.x, plan.entrance.z, dtMin, 1.3);
        if (atDoor) {
          g.released = true;
          releaseTable(state, g);
        }
        syncMembers(g, angry ? 'angry' : 'walk', dtMin);
        g.t += dtMin;
        break;
      }
      // 2) 沿著人行道往街道另一頭走去，走遠了才真的消失
      const exit = g.exit || { x: plan.street?.bx ?? plan.outside.x, z: plan.street?.bz ?? plan.outside.z };
      const done = moveToward(g.walk, exit.x, exit.z, dtMin, 1.5);
      syncMembers(g, angry ? 'angry' : 'walk', dtMin);
      if (done || g.t > 90) g.state = 'gone';
      g.t += dtMin;
      break;
    }
    default: break;
  }
}

function removeFromQueue(state, id) {
  const qi = state.queue.indexOf(id);
  if (qi >= 0) state.queue.splice(qi, 1);
}

/** 試著幫這一組找位子：找到就保留桌位並建立「帶位」任務 */
function trySeatTable(state, g) {
  if (g.tableId) return true;
  const table = findTable(state, g.size, null, { pet: !!g.pet, noPet: !g.pet });
  if (!table) return false;
  table.occupied = true;
  table.groupId = g.id;
  g.tableId = table.id;
  g.petTable = !!table.petOk;
  g.seatIdx = [];
  for (let i = 0; i < g.size; i++) {
    g.seatIdx.push(i % table.seats);
    g.members[i].seat = i % table.seats;
  }
  removeFromQueue(state, g.id);
  g.state = 'waitSeat';
  g.wait = 0;
  g.escorted = false;
  g.floor = table.floor || 0;
  addTask(state, 'seat', {
    groupId: g.id, tableId: table.id,
    tx: g.walk.x, tz: g.walk.z,
    toX: table.x, toZ: table.z,
    floor: table.floor || 0
  });
  return true;
}

function releaseTable(state, g) {
  const table = tableOf(state, g);
  if (table) {
    table.occupied = false;
    table.groupId = null;
    if (table.dirty > 0) table.kind = 'dirty';
  }
  for (let i = state.tasks.length - 1; i >= 0; i--) {
    const t = state.tasks[i];
    if (t.groupId === g.id && (t.type === 'seat' || t.type === 'collect' || t.type === 'deliver')) {
      for (const s of state.staff) if (s.taskId === t.id) { s.taskId = null; s.carry = 0; }
      state.tasks.splice(i, 1);
    }
  }
  clearPassFor(state, g.id);
  g.tableId = null;
}

function clearPassFor(state, groupId) {
  state.pass = state.pass.filter((p) => p.groupId !== groupId);
}

function settlePayment(state, g, rev, quality = 1) {
  const tipRate = (state.stars >= 4 ? 0.06 : 0.03) * quality;
  const tip = Math.round(rev * tipRate * (1 + Math.max(-0.5, Math.min(0.5, g.mood / 6))));
  state.cash += rev + tip;
  state.today.revenue += rev;
  state.today.tips += tip;
  state.today.served += g.size;
  state.servedTotal += g.size;
  g.paid = rev + tip;
  // 累計帳：客層／時段／菜色營收（排行榜用）
  const hour = String(Math.min(23, Math.floor(state.minute / 60)));   // 打烊後的收尾一律算最後一小時
  bumpLedger(state, 'kinds', g.kind, { guests: g.size, revenue: rev + tip });
  bumpLedger(state, 'hours', hour, { guests: g.size, revenue: rev + tip });
  // 荒天（暴風雨・雪・みぞれ・猛暑）の接客数はミッションで使う
  if ((WEATHER_SEVERITY[state.weather] || 0) >= 0.6) bumpLedger(state, 'meta', 'severeServed', { count: g.size });
  for (const id of (g.orders || [])) bumpLedger(state, 'dishes', id, { revenue: menuPrice(state, id) });
  const table = tableOf(state, g);
  if (table) {
    table.dirty = 1;
    table.kind = 'dirty';
    if (!hasTask(state, 'cleanTable', (t) => t.tableId === table.id)) {
      addTask(state, 'cleanTable', { tableId: table.id, tx: table.x, tz: table.z, floor: table.floor || 0 });
    }
  }
  // 洗手間がきれい・上等だと評價が少し上がる
  const lvAvg = avgRestroomLevel(state);
  if (lvAvg > 0) state.fame = Math.min(100, state.fame + lvAvg * 0.12 * quality);
  // 客層ごとの「噂の広がり」：同業の料理人や SNS 投稿客は満足すると評價が大きく動く
  const kdef = CUSTOMER_KINDS[g.kind] || {};
  const fameMul = kdef.fame ?? 1;
  state.fame = Math.min(100, state.fame + 0.05 * g.size * quality * fameMul);
  // 有名人・テレビ取材：満足すれば一気に宣傳される（怒らせたときは angryAt 側で大打擊）
  if (kdef.famous) {
    const boost = 3.2 * (1 + Math.min(1.2, (state.fame || 0) / 60));
    state.fame = Math.min(100, state.fame + boost * quality);
    emit(state, 'famous', { kind: g.kind, jp: kdef.jp, zh: kdef.zh, size: g.size });
  }
}

/**
 * 把整組人排到隊伍位置上。
 * 每個人有自己的隊形偏移（ox/oz，隊伍座標），會依目前行進方向旋轉到世界座標；
 * dtMin > 0 時用平滑追趕，避免入座／離座瞬間「全體瞬移」。
 */
function syncMembers(g, pose, dtMin = 0) {
  g.pose = pose;
  const dir = g.walk.dir || 0;
  const cd = Math.cos(dir), sd = Math.sin(dir);
  for (const m of g.members) {
    if (m.seat >= 0 && (pose === 'sit' || pose === 'eat')) continue;
    const ox = m.ox || 0, oz = m.oz || 0;
    const tx = g.walk.x + ox * cd + oz * sd;
    const tz = g.walk.z - ox * sd + oz * cd;
    if (dtMin > 0) {
      const k = Math.min(0.6, dtMin * 5.0);
      m.x += (tx - m.x) * k;
      m.z += (tz - m.z) * k;
    } else {
      m.x = tx; m.z = tz;
    }
    m.ry = dir;
  }
}

/* --------------------------------------------------------- 員工 AI */

function updateStaff(state, dtMin) {
  for (const s of state.staff) {
    const working = !!s.taskId;
    s.fatigue = Math.max(0, Math.min(100, s.fatigue + (working ? 0.05 : -0.02) * dtMin * (1 + (100 - s.stamina) / 120)));
    if (working) s.workMinutes += dtMin;

    let task = s.taskId ? state.tasks.find((t) => t.id === s.taskId) : null;
    if (s.taskId && !task) { s.taskId = null; s.pose = 'stand'; }

    if (!s.taskId) {
      const t = claimTask(state, s);
      if (t) { s.taskId = t.id; task = t; s.floor = t.floor || 0; }
      else {
        const home = s.home || { x: 0, z: 0 };
        const arrived = moveToward(s, home.x, home.z, dtMin * walkSpeed(s), 1);
        if (arrived) s.floor = 0;
        s.pose = arrived ? (s.role === 'chef' ? 'stand' : 'wait') : 'walk';
        continue;
      }
    }
    if (!task) continue;

    if (task.phase === 'todo') { task.phase = 'walk'; s.pose = 'walk'; }

    if (task.phase === 'walk') {
      // 任務在別的樓層 → 先走到樓梯，到了就換樓層（視覺上真的走樓梯上下樓）
      const targetFloor = task.floor || 0;
      if ((s.floor || 0) !== targetFloor) {
        const st = state.plan.stairs || { x: -5.6, z: 1.4 };
        const atStairs = moveToward(s, st.x, st.z, dtMin * walkSpeed(s), 1);
        s.pose = 'walk';
        if (atStairs) s.floor = targetFloor;
        continue;
      }
      const arrived = moveToward(s, task.tx, task.tz, dtMin * walkSpeed(s), 1);
      s.pose = arrived ? (s.role === 'chef' ? 'stand' : 'wait') : 'walk';
      if (arrived) {
        // 送菜：先到出餐口取菜，再走去桌邊
        if (task.type === 'deliver' && !task.picked) {
          task.picked = true;
          const p = state.pass.find((x) => x.groupId === task.groupId && !x.taken);
          if (p) { p.taken = true; s.carry = (p.dishes || []).length; }
          task.tx = task.toX ?? task.tx;
          task.tz = task.toZ ?? task.tz;
          continue;
        }
        task.phase = 'work';
        task.started = true;
        task.workLeft = workTime(s, task.work || TASK_KINDS[task.type].work);
      }
      continue;
    }

    if (task.phase === 'work') {
      task.workLeft -= dtMin;
      // 廚師在爐前的動作：手在鍋上攪拌（cook 姿勢由 characters.js 提供）
      s.pose = s.role === 'chef' ? (task.type === 'cook' ? 'cook' : 'stand') : 'wait';
      if (task.workLeft <= 0) completeTask(state, s, task);
    }
  }
}

function claimTask(state, staff) {
  let best = null;
  for (const t of state.tasks) {
    if (t.claimedBy) continue;
    if (t.role !== staff.role) continue;
    if (!best) { best = t; continue; }
    if (t.priority > best.priority) best = t;
    else if (t.priority === best.priority && t.createdAt < best.createdAt) best = t;
  }
  if (!best) return null;
  best.claimedBy = staff.id;
  return best;
}

function completeTask(state, s, task) {
  const stat = (add) => bumpLedger(state, 'staff', s.id, add);
  switch (task.type) {
    case 'seat': {
      const g = state.groups.find((x) => x.id === task.groupId);
      if (g) g.escorted = true;
      stat({ seated: g?.size || 1 });
      break;
    }
    case 'cook': {
      state.pass.push({
        groupId: task.groupId, tableId: task.tableId,
        dishes: task.dishIds || [], placedAt: state.minute, taken: false
      });
      emit(state, 'cooked', { dishes: (task.dishIds || []).length });
      stat({ cooked: (task.dishIds || []).length || 1 });
      break;
    }
    case 'deliver': {
      const p = state.pass.find((x) => x.groupId === task.groupId && !x.taken);
      if (p) p.taken = true;
      const g = state.groups.find((x) => x.id === task.groupId);
      if (g) g.served = true;
      state.pass = state.pass.filter((x) => !(x.groupId === task.groupId && x.taken));
      stat({ delivered: g?.size || 1 });
      s.carry = 0;
      break;
    }
    case 'collect': {
      const g = state.groups.find((x) => x.id === task.groupId);
      if (g && g.paid <= 0) {
        const rev = dishRevenue(state, g.orders, g.spend, g.size);
        const quality = 1 + Math.max(-0.4, Math.min(0.4, (s.skill - 60) / 200));
        settlePayment(state, g, rev, quality);
        emit(state, 'pay', { amount: rev, size: g.size, by: s.name });
        stat({ payments: 1, revenue: g.paid || rev });
      }
      break;
    }
    case 'cleanTable': {
      const t = allTables(state.plan).find((x) => x.id === task.tableId);
      if (t) { t.dirty = 0; t.kind = 'free'; }
      stat({ cleaned: 1 });
      break;
    }
    case 'cleanRestroom': {
      // タスクが指している部屋（樓層×男女）だけをきれいにする
      const f = Number.isFinite(task.floor) ? task.floor : 0;
      const which = task.which === 'f' ? 'f' : 'm';
      setRestroomDirt(state, f, which, 0);
      emit(state, 'clean', { what: 'restroom', floor: f, which });
      stat({ cleaned: 1 });
      bumpLedger(state, 'meta', 'cleanRestroom', { count: 1 });
      break;
    }
    default: break;
  }
  stat({ tasks: 1 });
  s.mood = Math.min(100, s.mood + 0.6);
  state.today.tasksDone = (state.today.tasksDone || 0) + 1;
  s.taskId = null;
  s.carry = 0;
  removeTask(state, task.id);
}

function cleanupTasks(state) {
  for (let i = state.tasks.length - 1; i >= 0; i--) {
    const t = state.tasks[i];
    let dead = false;
    if (t.groupId) {
      const g = state.groups.find((x) => x.id === t.groupId);
      if (!g) dead = true;
      else if (t.type === 'collect' && g.state !== 'waitPay') dead = true;
      else if (t.type === 'deliver' && g.state !== 'waitServe') dead = true;
    }
    if (dead) {
      for (const s of state.staff) if (s.taskId === t.id) { s.taskId = null; s.carry = 0; }
      state.tasks.splice(i, 1);
    }
  }
  // 担当している部屋がもうきれいなら、未着手の清掃タスクは取り下げる
  for (let i = state.tasks.length - 1; i >= 0; i--) {
    const t = state.tasks[i];
    if (t.type !== 'cleanRestroom' || t.claimedBy || t.started) continue;
    const f = Number.isFinite(t.floor) ? t.floor : 0;
    const which = t.which === 'f' ? 'f' : 'm';
    if (restroomDirt(state, f, which) <= 5) state.tasks.splice(i, 1);
  }
}

/* -------------------------------------------------------------- 結算 */

export function settleDay(state) {
  const loc = locationById(state.locationId) || LOCATIONS[0];
  const rent = loc.rentPerDay;
  const util = 3200 + allTables(state.plan).length * 260;
  const hours = Math.max(0, (closeMinute(state) - openMinute(state)) / 60);
  let wages = 0;
  for (const s of state.staff) wages += Math.round(s.wage * hours);
  state.today.wages = wages;

  const gross = state.today.revenue + state.today.tips;
  const net = gross - state.today.cost - rent - util - wages + (state.today.eventCash || 0);
  state.cash += net;

  const served = state.today.served;
  const angry = state.today.angry;
  const rate = served + angry > 0 ? served / (served + angry) : 1;
  state.fame = Math.max(0, Math.min(100, state.fame + (rate - 0.86) * 3.2));
  for (const s of state.staff) {
    s.mood = Math.max(0, Math.min(100, s.mood + (rate - 0.85) * 4 - s.fatigue * 0.05));
    s.fatigue = Math.max(0, s.fatigue - 35);
    s.workMinutes = 0;
  }

  const report = {
    day: state.day, locationId: loc.id, locationName: loc.name,
    guests: state.today.guests, groups: state.today.groups,
    served, angry, walkouts: state.today.walkouts, maxQueue: state.today.maxQueue,
    revenue: gross, cost: state.today.cost, tips: state.today.tips,
    rent, util, wages, eventCash: state.today.eventCash || 0,
    net, cash: state.cash, fame: state.fame,
    staff: state.staff.length, tasksDone: state.today.tasksDone || 0,
    events: state.today.events || 0,
    kindCount: { ...state.today.kindCount }, dishCount: { ...state.today.dishCount },
    weather: state.weather
  };
  state.history.push(report);

  // 星級の昇格判定（條件を満たしていれば自動で上がる）
  report.starUp = checkStarUp(state) || null;
  report.stars = state.stars;

  // 累計帳：各地點的成績（全地點排行 + 店史紀錄用）
  const L = ensureLedger(state);
  const rec = L.locations[loc.id] || (L.locations[loc.id] = {
    days: 0, totalRevenue: 0, bestRevenue: 0, bestDay: 0, bestGuests: 0, bestNet: 0, lastDay: 0
  });
  rec.days = (rec.days || 0) + 1;
  rec.totalRevenue = (rec.totalRevenue || 0) + gross;
  rec.lastDay = state.day;
  if (gross > (rec.bestRevenue || 0)) { rec.bestRevenue = gross; rec.bestDay = state.day; }
  if (state.today.guests > (rec.bestGuests || 0)) rec.bestGuests = state.today.guests;
  if (net > (rec.bestNet || 0)) rec.bestNet = net;
  report.best = { revenue: rec.bestRevenue, day: rec.bestDay, guests: rec.bestGuests, days: rec.days };
  return report;
}

export function startNextDay(state) {
  state.day += 1;
  state.phase = 'open';
  state.minuteFloat = openMinute(state);
  state.minute = state.minuteFloat;
  state.today = emptyDay();
  state.spawnAcc = 0;
  state.weather = rollWeather(state);
  state.tasks.length = 0;
  state.pass.length = 0;
  // 各樓層×男女の洗手間を新品に戻す
  state.restrooms = {};
  syncRestroomAggregate(state);
  state.equipBroken = { fridge: false, ac_unit: false, stove: false };
  allTables(state.plan).forEach((t) => { t.occupied = false; t.groupId = null; t.dirty = 0; t.kind = 'free'; });
  state.groups.length = 0;
  state.queue.length = 0;
  for (const m of state.menu) m.stock = Math.max(m.stock, 60);
  for (const s of state.staff) { s.taskId = null; s.carry = 0; s.pose = 'stand'; s.x = s.home?.x ?? 0; s.z = s.home?.z ?? 0; }
  initEvents(state);
  refreshCandidates(state);
  return state;
}

export function moveToLocation(state, id) {
  const loc = locationById(id);
  if (!loc) return { ok: false, error: '沒有這個地點' };
  if (state.cash < loc.moveCost) return { ok: false, error: `資金不足（需要 ${money(loc.moveCost)}）` };
  state.cash -= loc.moveCost;
  state.locationId = loc.id;
  state.plan = buildFloorPlan(state.seed + state.day, {});
  state.restroomLv = {};
  state.tasks.length = 0;
  state.pass.length = 0;
  // 各樓層×男女の洗手間を新品に戻す
  state.restrooms = {};
  syncRestroomAggregate(state);
  layoutStaffHome(state);
  state.weather = rollWeather(state, loc);
  initEvents(state);
  return { ok: true, location: loc };
}

export function setStars(state, n) {
  state.stars = Math.max(1, Math.min(5, Math.round(n)));
  refreshCandidates(state);
  return state.stars;
}

/** 給 UI／場景用的任務快照 */
export function taskSummary(state) {
  const by = {};
  for (const t of state.tasks) by[t.type] = (by[t.type] || 0) + 1;
  return { total: state.tasks.length, by, queue: state.queue.length, pass: state.pass.length };
}

/** 熱門菜單報表：各品項的點餐數、營收與占比（由高到低） */
export function topMenuReport(state) {
  const dc = state.today?.dishCount || {};
  const menuById = new Map((state.menu || []).map(m => [m.id, m]));
  let totalCount = 0;
  for (const n of Object.values(dc)) totalCount += n;
  const items = Object.entries(dc)
    .map(([id, count]) => {
      const m = menuById.get(id);
      const def = dishById(id);
      const price = m?.price || def?.price || 0;
      return {
        id,
        name: def?.name || id,
        nameZh: def?.nameZh || id,
        price,
        count,
        revenue: count * price,
        pct: totalCount ? +(count / totalCount * 100).toFixed(1) : 0
      };
    })
    .sort((a, b) => b.count - a.count);
  return { items, totalCount, totalRevenue: items.reduce((a, i) => a + i.revenue, 0) };
}

/* ------------------------------------------------- 調理場（廚房的樣子） */

/**
 * 調理場の状況：現在誰在煮什麼、煮到幾成、出餐口上有什麼菜。
 * 給「料理を見る」面板與場景中的調理標籤使用（純資料，無 DOM）。
 */
export function kitchenReport(state) {
  const plan = state.plan;
  const chefs = (state.staff || []).filter((s) => s.role === 'chef');
  const byId = new Map((state.tasks || []).map((t) => [t.id, t]));
  const dishRows = (ids) => (ids || []).map((id) => {
    const d = dishById(id);
    return {
      id,
      name: d?.name || id,
      nameZh: d?.nameZh || id,
      cookTime: d?.cookTime || 0,
      price: menuPrice(state, id)
    };
  });

  const cooking = chefs.map((s) => {
    const t = s.taskId ? byId.get(s.taskId) : null;
    const isCook = !!t && t.type === 'cook';
    const total = isCook ? (t.work || 0) : 0;
    return {
      id: s.id, name: s.name, uniformId: s.uniformId,
      skill: s.skill, mood: Math.round(s.mood ?? 0), fatigue: Math.round(s.fatigue || 0),
      taskId: t?.id || null,
      phase: isCook ? t.phase : 'idle',
      working: isCook && t.phase === 'work',
      dishes: isCook ? dishRows(t.dishIds) : [],
      progress: isCook && total > 0 ? +(1 - Math.max(0, t.workLeft) / total).toFixed(3) : 0
    };
  });

  const pass = (state.pass || []).map((p) => {
    const t = allTables(state.plan).find((x) => x.id === p.tableId);
    const g = (state.groups || []).find((x) => x.id === p.groupId);
    return {
      groupId: p.groupId, tableId: p.tableId, floor: t?.floor || 0,
      dishes: dishRows(p.dishes), count: (p.dishes || []).length,
      waitMin: Math.max(0, Math.round(state.minute - (p.placedAt ?? state.minute))),
      taken: !!p.taken,
      guestKind: g?.kindJp || ''
    };
  });

  return {
    chefs: cooking,
    pass,
    stove: { x: plan.stove.x, z: plan.stove.z },
    counts: {
      chefs: chefs.length,
      cooking: cooking.filter((c) => c.working).length,
      walking: cooking.filter((c) => c.phase === 'walk').length,
      idle: cooking.filter((c) => c.phase === 'idle').length,
      ready: pass.filter((p) => !p.taken).length
    }
  };
}

/* ------------------------------------------------- 番付（排行榜） */

/** 該地點的「平均日商」基準：別的店家在這裡大概做多少生意 */
export function locationPotential(loc) {
  if (!loc) return 0;
  return Math.round(loc.trafficBase * (loc.spendLevel || 1) * 2200 * (0.92 + (loc.stars || 1) * 0.04));
}

/**
 * 排行榜（番付）：
 *   local  — 這家店自己的排行（菜色、員工、客層、時段、店史紀錄）
 *   global — 全部 28 個地點的排行（別的店家的平均日商 vs 本店的最佳日）
 */
export function rankings(state) {
  const L = ensureLedger(state);
  const loc = locationById(state.locationId) || LOCATIONS[0];

  // ── 店內：菜色 ──
  const dishTotal = Object.values(L.dishes).reduce((a, v) => a + (v.count || 0), 0) || 1;
  const dishAll = Object.entries(L.dishes)
    .map(([id, v]) => {
      const d = dishById(id);
      return {
        id, name: d?.name || id, nameZh: d?.nameZh || id,
        count: v.count || 0, revenue: Math.round(v.revenue || 0),
        pct: +(((v.count || 0) / dishTotal) * 100).toFixed(1),
        today: state.today?.dishCount?.[id] || 0
      };
    })
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // ── 店內：員工 ──
  const staffRows = (state.staff || []).map((s) => {
    const st = L.staff[s.id] || {};
    return {
      id: s.id, name: s.name, role: s.role, roleJp: ROLE_LABEL[s.role] || s.role,
      skill: s.skill, speed: s.speed, mood: Math.round(s.mood ?? 0), fatigue: Math.round(s.fatigue || 0),
      wage: s.wage, uniformId: s.uniformId,
      tasks: st.tasks || 0, cooked: st.cooked || 0, delivered: st.delivered || 0,
      seated: st.seated || 0, cleaned: st.cleaned || 0, payments: st.payments || 0,
      revenue: Math.round(st.revenue || 0),
      score: (st.tasks || 0)
    };
  });
  const chefs = staffRows.filter((s) => s.role === 'chef').sort((a, b) => b.cooked - a.cooked || b.tasks - a.tasks).map((r, i) => ({ ...r, rank: i + 1 }));
  const waiters = staffRows.filter((s) => s.role === 'waiter').sort((a, b) => b.revenue - a.revenue || b.tasks - a.tasks).map((r, i) => ({ ...r, rank: i + 1 }));

  // ── 店內：客層與時段 ──
  const kindTotal = Object.values(L.kinds).reduce((a, v) => a + (v.guests || 0), 0) || 1;
  const kinds = Object.entries(L.kinds)
    .map(([k, v]) => {
      const def = CUSTOMER_KINDS[k] || {};
      return {
        id: k, name: def.jp || k, nameZh: def.zh || k,
        groups: v.groups || 0, guests: v.guests || 0, revenue: Math.round(v.revenue || 0),
        pct: +(((v.guests || 0) / kindTotal) * 100).toFixed(0)
      };
    })
    .sort((a, b) => b.guests - a.guests)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const hours = Object.entries(L.hours)
    .map(([h, v]) => ({ hour: Number(h), groups: v.groups || 0, guests: v.guests || 0, revenue: Math.round(v.revenue || 0) }))
    .sort((a, b) => a.hour - b.hour);
  const bestHour = hours.slice().sort((a, b) => b.revenue - a.revenue)[0] || null;

  const rec = L.locations[loc.id] || { days: 0, totalRevenue: 0, bestRevenue: 0, bestDay: 0, bestGuests: 0, bestNet: 0 };

  // ── 全地點 ──
  const global = LOCATIONS.map((l) => {
    const r = L.locations[l.id] || {};
    const potential = locationPotential(l);
    const myBest = Math.round(r.bestRevenue || 0);
    return {
      id: l.id, name: l.name, nameZh: l.nameZh, region: l.region, city: l.city,
      kind: l.kind, stars: l.stars, trafficBase: l.trafficBase, rentPerDay: l.rentPerDay,
      spendLevel: l.spendLevel, specialties: l.specialties,
      potential, myBest, myDays: r.days || 0, isHere: l.id === loc.id,
      score: Math.max(potential, myBest)
    };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));

  const todayRevenue = Math.round(state.today?.revenue || 0);
  const myScore = Math.max(rec.bestRevenue || 0, todayRevenue);
  const myRow = global.find((g) => g.isHere) || null;
  const myRank = myRow ? myRow.rank : global.length;                  // 自店這個地點的名次
  const revenueRank = Math.min(global.length, global.filter((g) => g.potential > myScore).length + 1);
  const beaten = global.filter((g) => g.potential < myScore).length;

  return {
    locationId: loc.id,
    locationName: loc.name,
    locationNameZh: loc.nameZh,
    day: state.day,
    local: {
      dishes: dishAll,
      dishesToday: topMenuReport(state).items,
      chefs,
      waiters,
      kinds,
      hours,
      bestHour,
      record: {
        days: rec.days || 0,
        totalRevenue: Math.round(rec.totalRevenue || 0),
        bestRevenue: Math.round(rec.bestRevenue || 0),
        bestDay: rec.bestDay || 0,
        bestGuests: rec.bestGuests || 0,
        bestNet: Math.round(rec.bestNet || 0),
        todayRevenue,
        todayGuests: state.today?.guests || 0
      }
    },
    global,
    summary: {
      myScore,
      myRank,                       // 自店在全部地點中的名次（1..28）
      revenueRank,                  // 用營業額換算的目安名次（1..28）
      totalLocations: global.length,
      beaten,
      potentialHere: locationPotential(loc),
      todayRevenue
    }
  };
}

export { ROLE_LABEL, activeEventInfo, forceEvent, recomputeMults, candidatesFor, staffById };

export default {
  createGame, tick, settleDay, startNextDay, moveToLocation, setStars,
  buildFloorPlan, findTable, money, clockText, trafficMultiplier,
  hireStaff, fireStaff, candidateInfo, refreshCandidates, taskSummary, drainEvents,
  buyEquipment, repairEquipment, EQUIPMENT_CATALOG, setStaffUniform, topMenuReport, spawnGroup,
  setFloorCount, allTables, pickFloorForGroup,
  kitchenReport, rankings, locationPotential, emptyLedger, ensureLedger,
  setRoleUniform, crowdInfo, FLOOR_COST
};
