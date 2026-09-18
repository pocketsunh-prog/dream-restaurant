// ============================================================================
// balance.js — 所有可調數值集中在此，方便調手感。
// 數值設計依據 docs/GAME_PROMPT.md §4 的公式。
// ============================================================================

/** 等角網格常數（與 render/iso.js 保持一致） */
/** 等角網格常數。
 *  像素尺寸的單一來源是 src/render/iso.js（TILE_W / TILE_H / LOGICAL_W / LOGICAL_H），
 *  這裡只是鏡射一份給模擬層參考，改解析度時記得同步。 */
export const TILE_W = 64;
export const TILE_H = 32;
export const GRID_W = 26;
export const GRID_H = 17;

/** 遊戲節奏 */
export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_SECOND = 1;          // 1 真實秒 = 1 遊戲分鐘（速度 1x）
export const SPEEDS = [0, 1, 2, 4];
export const SETTLE_MINUTE = 22 * 60;          // 週日 22:00 結算
export const WEEKLY_BONUS = 20000000;            // 每週一社區獎金（原作約 20 萬）
export const START_CASH = 90000000;
export const BANKRUPT_DAYS = 7;                // 現金為負超過 7 天 → 破產

/** 星級門檻（兩桶評價都必須達標） */
export const STAR_REQS = [
  null,
  { star: 1, community: 0, outside: 0, days: 0, rank: null, bestRank1: false, firstTwice: false, text: '開業即可' },
  { star: 2, community: 380, outside: 360, days: 7, rank: null, bestRank1: false, firstTwice: false, text: '營業滿 7 天' },
  { star: 3, community: 410, outside: 385, days: 14, rank: 8, bestRank1: false, firstTwice: false, text: '週排名進前 8 名' },
  { star: 4, community: 435, outside: 410, days: 21, rank: 3, bestRank1: true, firstTwice: false, text: '週排名進前 3 名且曾拿第一' },
  { star: 5, community: 460, outside: 435, days: 35, rank: 1, bestRank1: true, firstTwice: true, text: '連兩週雜誌總排名第一' }
];

/** 換地點時區外評價的下滑量（原作實測現象） */
export const MOVE_OUTSIDE_PENALTY = 45;

/** 評價桶上下限 */
export const RATING_MIN = 0;
export const RATING_MAX = 500;
export const RATING_START = 350;

/** 客人耐心（遊戲分鐘，從進門到第一道菜上桌） */
export const PATIENCE = {
  student: [78, 118],
  office: [56, 84],
  family: [70, 105],
  tourist: [62, 96],
  critic: [59, 86],
  vip: [51, 74],
  cherish: [82, 124]        // 常連さんなので気長に待ってくれる
};

/** 食譜標示的調理時間 → 實際經過的營業時間（原作 30 分鐘是食譜上的說法） */
export const COOK_TIME_SCALE = 0.32;

/** 每位廚師同時可顧的鍋數（多請廚師才能同時出多道菜） */
export const CHEF_POTS = 3;

/** 顧客類型權重（影響評價的力道） */
export const TYPE_WEIGHT = {
  student: 0.8,
  office: 1.0,
  family: 1.1,
  tourist: 1.25,
  critic: 5.0,
  vip: 3.0,
  couple: 1.1,
  colleagues: 1.2,
  tour_group: 1.4,
  soldiers: 1.0,
  regulars: 1.6,
  blogger: 3.5,
  cyclists: 0.9,
  elderly: 1.2,
  kids_party: 1.1
};

/** 顧客類型消費力（每人） */
export const TYPE_SPEND = {
  student: 0.85,
  office: 1.0,
  family: 1.25,
  tourist: 1.15,
  critic: 1.0,
  vip: 1.6,
  couple: 1.25,
  colleagues: 1.15,
  tour_group: 1.05,
  soldiers: 1.2,
  regulars: 1.1,
  blogger: 1.0,
  cyclists: 0.95,
  elderly: 1.1,
  kids_party: 1.0
};

/** 顧客類型定義：每組人數、稱呼、喜好標籤、口味偏好、評價桶 */
export const CUSTOMER_TYPES = {
  student: { name: '學生', party: [1, 3], tags: ['cheap', 'fried', 'quick', 'rice', 'noodle', 'meat'], taste: 68, bucket: 'local' },
  office: { name: '上班族', party: [1, 2], tags: ['quick', 'rice', 'noodle', 'caffeine', 'mild'], taste: 52, bucket: 'local' },
  family: { name: '家庭客', party: [3, 6], tags: ['meat', 'soup', 'rice', 'local'], taste: 58, bucket: 'local' },
  couple: { name: '情侶', party: [2, 2], tags: ['sweet', 'premium', 'dessert', 'drink'], taste: 62, bucket: 'local' },
  colleagues: { name: '同事聚餐', party: [4, 6], tags: ['meat', 'alcohol', 'fried', 'rice'], taste: 60, bucket: 'local' },
  regulars: { name: '老主顧', party: [2, 3], tags: ['local', 'rice', 'soup', 'cheap'], taste: 55, bucket: 'local' },
  kids_party: { name: '親子團', party: [3, 7], tags: ['sweet', 'fried', 'drink', 'dessert'], taste: 60, bucket: 'local' },
  elderly: { name: '銀髮族', party: [2, 4], tags: ['mild', 'soup', 'veg', 'local'], taste: 45, bucket: 'local' },
  soldiers: { name: '阿兵哥', party: [3, 5], tags: ['meat', 'rice', 'cheap', 'fried'], taste: 70, bucket: 'local' },
  cyclists: { name: '單車族', party: [2, 4], tags: ['quick', 'cold', 'drink', 'cheap'], taste: 55, bucket: 'local' },
  tourist: { name: '觀光客', party: [2, 5], tags: ['local', 'tourist', 'seafood', 'fried'], taste: 62, bucket: 'outside' },
  tour_group: { name: '旅行團', party: [5, 8], tags: ['local', 'tourist', 'rice', 'soup'], taste: 60, bucket: 'outside' },
  critic: { name: '美食評論家', party: [1, 2], tags: ['premium', 'seafood', 'soup', 'local'], taste: 55, bucket: 'outside' },
  blogger: { name: '美食部落客', party: [1, 2], tags: ['premium', 'sweet', 'dessert', 'tourist'], taste: 58, bucket: 'outside' },
  vip: { name: '貴賓', party: [2, 4], tags: ['premium', 'seafood', 'meat'], taste: 50, bucket: 'outside' },
  // 常連のお客さん「Cherish」：スプライトシート（6 コマ歩行）で描かれる特別な常客。
  // 一人でふらっと來て、甘い物とコーヒーを好む。満足すると噂を広めてくれる。
  cherish: { name: 'Cherish', party: [1, 1], tags: ['sweet', 'dessert', 'caffeine', 'premium'], taste: 72, bucket: 'local' }
};

/** 各類型出現的基礎權重（會再依地點顧客組成與時段調整） */
export const TYPE_BASE_WEIGHT = {
  student: 22, office: 16, family: 14, couple: 9, colleagues: 7, regulars: 6,
  kids_party: 5, elderly: 5, soldiers: 3, cyclists: 4,
  tourist: 10, tour_group: 2.5, critic: 1.2, blogger: 1.6, vip: 1.2, cherish: 1.8
};

/** 一組客人的消費：整組金額 = 餐點小計 × 人數 × 這個折數（分食折扣，人多不會等比例貴） */
export const PARTY_PAY_FACTOR = 0.8;

/** 每位同桌成員額外增加的用餐時間（遊戲分鐘） */
export const EATING_PER_GUEST = 1.0;

/** 大組客人比較有耐心（都訂位了） */
export const PARTY_PATIENCE_BONUS = 0.03;   // 每多一人 +3%

/** 廚房設備：等級效果與升級費用 */
export const KITCHEN_MAX_LEVEL = 5;
export const KITCHEN_SPECS = {
  stove:  { name: '爐具',   icon: '🔥', base: 18000, mult: 1.9,
            desc: function(l){ return "煮菜速度 +" + (l*7) + "%（現在 " + (100-(1-Math.pow(0.93,l-1))*100).toFixed(0) + "% 加速）"; } },
  fridge: { name: '冰箱',   icon: '❄', base: 15000, mult: 1.85,
            desc: function(l){ return "食材折損 -" + (l*18) + "%（現在剩 " + Math.max(10,100-l*18) + "%）"; } },
  prep:   { name: '流理台', icon: '🔪', base: 12000, mult: 1.8,
            desc: function(l){ return "每位廚師多顧 " + (l-1) + " 個鍋（總鍋數 = 廚師 × " + (2+l-1) + "）"; } }
};
export function kitchenUpgradeCost(target, currentLevel) {
  var spec = KITCHEN_SPECS[target];
  if (!spec) return Infinity;
  return Math.round(spec.base * Math.pow(spec.mult, currentLevel - 1));
}
export function kitchenStoveMultiplier(level) {
  return Math.max(0.6, Math.pow(0.93, level - 1));
}
export function kitchenFridgeMultiplier(level) {
  return Math.max(0.15, 1 - (level - 1) * 0.18);
}
export function kitchenPrepPots(level) {
  return 2 + (level - 1);
}

/** 候位隊伍：從門口往外排，每格間隔 */
export const QUEUE_STEP = 1.05;

/** 顧客心情門檻 */
export const MOOD = {
  angryLeave: -55,      // 低於此值直接不爽走人
  complain: -20,        // 低於此值記一筆抱怨
  happy: 45,            // 高於此值給小費
  maxTip: 0.12          // 小費上限 12%
};

/** 用餐時間（遊戲分鐘） */
export const EATING_MIN = 12;
export const EATING_PER_PORTION = 6;

/** 空調舒適帶 */
export const COMFORT = { min: 22, max: 26 };
export const WEATHER_COMFORT_SHIFT = {
  sunny: 0, cloudy: 0, rain: 1, storm: 2, cold: 4, heat: -4
};

/** 每日營運成本 */
export const UTILITY_BASE = 320;          // 水電基本費
export const UTILITY_PER_DEGREE = 26;     // 空調偏離舒適帶每度加收
export const CLEAN_FLOOR_COST = 4000;
export const CLEAN_RESTROOM_COST = 1500;
export const CLEAN_FLOOR_PER_MIN = 0.06;  // 店內髒污自然累積（每人每分鐘）
export const DIRT_PER_GUEST = 0.9;
export const RESTROOM_DIRT_PER_GUEST = 1.6;
export const DIRT_COMPLAIN = 60;
export const DIRT_BAD = 78;

/** 進貨 */
export const DELIVERY_MINUTES = 12;          // 進貨到貨時間（遊戲分鐘）
export const PERISHABLE_LOSS = 0.10;      // 生鮮隔日折損
export const PERISHABLE_CATEGORIES = ['staple', 'side', 'soup'];

/** 排班／人事 */
export const SEVERANCE_HOURS = 8;         // 資遣費 = 8 小時時薪
export const MIN_WAGE = 1;
export const MAX_WAGE = 60;
export const FATIGUE_PER_HOUR = 3.0;
export const FATIGUE_RECOVER_PER_HOUR = 8;
export const FATIGUE_REST_PER_DAY = 45;   // 收班後睡一覺恢復的量
export const FATIGUE_TIRED = 65;
export const MOOD_QUIT = 22;
export const MOOD_LOW = 38;

/** 週排名參數 */
export const MAG_CATEGORIES = [
  { id: 'taste', name: '口味' },
  { id: 'service', name: '服務' },
  { id: 'decor', name: '裝潢' },
  { id: 'price', name: '價格' },
  { id: 'popularity', name: '人氣' }
];
export const MAG_RIVALS = 19;

/** 拉客（點門口路人） */
export const LURE_PER_CLICK = 0.005;
export const LURE_MAX = 0.30;
export const LURE_HALF_LIFE_MIN = 20;

/** 上架料理上限（依星級） */
export const MENU_LIMIT = { 1: 8, 2: 14, 3: 22, 4: 99, 5: 99 };

/** 移動速度：每遊戲分鐘走幾格（餐廳只有 20 格寬，走太慢會讓出餐永遠來不及） */
export const WALK_TILES_PER_MIN = 4.2;

/** 顧客拜訪時段倍率 */
export function hourFactor(minute) {
  const h = minute / 60;
  if (h < 6) return 0.15;
  if (h < 9) return 0.45;      // 早餐
  if (h < 11) return 1.8;
  if (h < 14) return 3.6;      // 午餐尖峰
  if (h < 17) return 1.8;      // 下午
  if (h < 21) return 3.8;      // 晚餐尖峰
  if (h < 23) return 1.0;      // 宵夜
  return 0.4;
}

export const WEATHER_TRAFFIC = {
  sunny: 2.15,
  cloudy: 2.0,
  rain: 1.72,
  storm: 1.5,
  cold: 1.82,
  heat: 1.9
};

export const WEATHER_NAME = {
  sunny: '晴天',
  cloudy: '陰天',
  rain: '下雨',
  storm: '豪雨',
  cold: '寒流',
  heat: '熱浪'
};

export const MUSIC_NAME = {
  lazy: '慵懶',
  tropical: '南國風',
  classic1: '古典樂一',
  classic2: '古典樂二',
  pop: '流行',
  off: '關閉'
};

/** 音樂對顧客類型的吸引力 */
export const MUSIC_APPEAL = {
  lazy: { student: 0.3, family: 0.6, office: 0.4, tourist: 0.4, critic: 0.5, vip: 0.3 },
  tropical: { student: 0.4, family: 0.5, office: 0.2, tourist: 0.8, critic: 0.4, vip: 0.4 },
  classic1: { student: 0.1, family: 0.4, office: 0.5, tourist: 0.3, critic: 0.9, vip: 0.9 },
  classic2: { student: 0.1, family: 0.4, office: 0.5, tourist: 0.3, critic: 0.9, vip: 0.8 },
  pop: { student: 0.9, family: 0.3, office: 0.3, tourist: 0.5, critic: 0.2, vip: 0.4 },
  off: { student: 0.2, family: 0.3, office: 0.3, tourist: 0.2, critic: 0.1, vip: 0.1 }
};
