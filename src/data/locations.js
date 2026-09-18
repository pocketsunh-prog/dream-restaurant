// src/data/locations.js
// 《夢幻西餐廳：決戰全台灣》十四個營業地點（欄位形狀依 docs/ARCHITECTURE.md §2.3、數值依 GAME_PROMPT.md §3.9）
//
// 詞彙表：
//   decorStyle : nightmarket | harbor | office | nightmarket2 | mall | fashion | plain  （對應 FURNITURE[].style）
//   skyline    : nightmarket | harbor | office | nightstreet | mall | fashion | plain  （給 RENDER 畫窗外街景）
//   tastePrefs : 取自 DISHES 的 TAG_LIST
//   weatherWeights 鍵 : sunny | cloudy | rain | storm | cold | heat（總和 1）
//   customerMix  鍵 : student | office | family | tourist | critic | vip（總和 1）
//
// 價格水準不另設欄位：它是由 tastePrefs（cheap ↔ premium）＋ rentPerDay 一起表達的，
// 和既有的六個地點完全一致（菜單售價仍由玩家自己定，雜誌的「價格」榜看的是顧客划算度）。
//
// 星級需求 starsRequired ∈ 1..7（見 src/core/balance.js#MAX_STARS），
// 每個地點都要在 src/sim/build.js#LAYOUT_VARIANTS 有一組對應的格局。

export const LOCATIONS = [
  {
    id: 'zhongli_xinming',
    name: '中壢新明夜市',
    city: '桃園',
    starsRequired: 1,
    rentPerDay: 1800,
    baseTraffic: 1.0,
    moveCost: 0,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.4, office: 0.15, family: 0.3, tourist: 0.1, critic: 0.03, vip: 0.02 },
    tastePrefs: ['cheap', 'fried', 'local', 'meat', 'quick'],
    weatherWeights: { sunny: 0.35, cloudy: 0.25, rain: 0.2, storm: 0.05, cold: 0.07, heat: 0.08 },
    decorStyle: 'nightmarket',
    skyline: 'nightmarket',
    palette: { sky: '#1b2340', wall: '#c9a26b', floor: '#8c6a44', accent: '#e8552e' },
    desc: '一切從這個小小的夜市開始，攤車的燈泡就是你的招牌。'
  },
  {
    id: 'yilan_luodong',
    name: '宜蘭羅東夜市',
    city: '宜蘭',
    starsRequired: 2,
    rentPerDay: 2600,
    baseTraffic: 1.15,
    moveCost: 100000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.26, office: 0.12, family: 0.38, tourist: 0.18, critic: 0.04, vip: 0.02 },
    tastePrefs: ['soup', 'local', 'mild', 'seafood', 'cheap'],
    weatherWeights: { sunny: 0.16, cloudy: 0.26, rain: 0.34, storm: 0.1, cold: 0.09, heat: 0.05 },
    decorStyle: 'nightmarket',
    skyline: 'nightmarket',
    palette: { sky: '#1d2a2a', wall: '#cbb489', floor: '#7f6c4e', accent: '#e07a32' },
    desc: '雨鄉的夜市，羊肉湯與一串心冒著白煙，騎樓下永遠擠滿人。'
  },
  {
    id: 'keelung_miaokou',
    name: '基隆廟口',
    city: '基隆',
    starsRequired: 2,
    rentPerDay: 3200,
    baseTraffic: 1.5,
    moveCost: 120000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.18, office: 0.1, family: 0.32, tourist: 0.34, critic: 0.04, vip: 0.02 },
    tastePrefs: ['seafood', 'soup', 'local', 'tourist', 'hot'],
    weatherWeights: { sunny: 0.2, cloudy: 0.25, rain: 0.3, storm: 0.12, cold: 0.08, heat: 0.05 },
    decorStyle: 'harbor',
    skyline: 'harbor',
    palette: { sky: '#243b52', wall: '#b9c3c9', floor: '#6f7d86', accent: '#2f8fb5' },
    desc: '雨下不停的廟口，熱湯的蒸氣就是最好的宣傳。'
  },
  {
    id: 'chiayi_wenhua',
    name: '嘉義文化路夜市',
    city: '嘉義',
    starsRequired: 3,
    rentPerDay: 3600,
    baseTraffic: 1.35,
    moveCost: 200000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.29, office: 0.13, family: 0.31, tourist: 0.23, critic: 0.03, vip: 0.01 },
    tastePrefs: ['rice', 'local', 'soup', 'cheap', 'sweet'],
    weatherWeights: { sunny: 0.38, cloudy: 0.26, rain: 0.18, storm: 0.05, cold: 0.04, heat: 0.09 },
    decorStyle: 'nightmarket',
    skyline: 'nightmarket',
    palette: { sky: '#243049', wall: '#cfae76', floor: '#8a6f4c', accent: '#d0442c' },
    desc: '火雞肉飯的香氣整條街都聞得到，阿里山腳下的夜裡人潮不斷。'
  },
  {
    id: 'taipei_nanyang',
    name: '台北南陽街',
    city: '台北',
    starsRequired: 3,
    rentPerDay: 6500,
    baseTraffic: 2.0,
    moveCost: 250000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.34, office: 0.4, family: 0.12, tourist: 0.08, critic: 0.04, vip: 0.02 },
    tastePrefs: ['quick', 'caffeine', 'rice', 'cheap', 'premium'],
    weatherWeights: { sunny: 0.25, cloudy: 0.3, rain: 0.25, storm: 0.08, cold: 0.07, heat: 0.05 },
    decorStyle: 'office',
    skyline: 'office',
    palette: { sky: '#3a4658', wall: '#cfc7a8', floor: '#7d7460', accent: '#c9a227' },
    desc: '補習街的招牌一路疊到天邊，中午十二點像打仗。'
  },
  {
    id: 'taichung_zhonghua',
    name: '台中中華路夜市',
    city: '台中',
    starsRequired: 4,
    rentPerDay: 4800,
    baseTraffic: 1.6,
    moveCost: 320000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.28, office: 0.12, family: 0.28, tourist: 0.27, critic: 0.03, vip: 0.02 },
    tastePrefs: ['sweet', 'fried', 'cold', 'local', 'cheap'],
    weatherWeights: { sunny: 0.4, cloudy: 0.25, rain: 0.15, storm: 0.04, cold: 0.05, heat: 0.11 },
    decorStyle: 'nightmarket2',
    skyline: 'nightstreet',
    palette: { sky: '#2b1f3a', wall: '#d2a35c', floor: '#8a6a46', accent: '#e0457b' },
    desc: '一整條大馬路都是吃的，情侶牽著手從街頭吃到街尾。'
  },
  {
    id: 'tainan_dongdi',
    name: '台南東帝士廣場',
    city: '台南',
    starsRequired: 4,
    rentPerDay: 4200,
    baseTraffic: 1.4,
    moveCost: 300000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.2, office: 0.12, family: 0.38, tourist: 0.24, critic: 0.04, vip: 0.02 },
    tastePrefs: ['sweet', 'local', 'mild', 'seafood', 'tourist'],
    weatherWeights: { sunny: 0.45, cloudy: 0.22, rain: 0.12, storm: 0.03, cold: 0.04, heat: 0.14 },
    decorStyle: 'mall',
    skyline: 'mall',
    palette: { sky: '#3c4a3a', wall: '#e0d3b0', floor: '#9a8a6c', accent: '#a8562f' },
    desc: '百貨公司樓下的寬敞店面，一家老小週末都往這裡走。'
  },
  {
    id: 'changhua_baguashan',
    name: '彰化八卦山腳',
    city: '彰化',
    starsRequired: 5,
    rentPerDay: 4000,
    baseTraffic: 1.5,
    moveCost: 320000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.22, office: 0.14, family: 0.4, tourist: 0.18, critic: 0.04, vip: 0.02 },
    tastePrefs: ['meat', 'soup', 'local', 'mild', 'rice'],
    weatherWeights: { sunny: 0.33, cloudy: 0.28, rain: 0.2, storm: 0.06, cold: 0.05, heat: 0.08 },
    decorStyle: 'plain',
    skyline: 'nightstreet',
    palette: { sky: '#2e2a3c', wall: '#c8b493', floor: '#7b6a52', accent: '#b5452e' },
    desc: '大佛腳下的老字號街區，肉圓與爌肉的蒸氣一路飄到牌樓。'
  },
  {
    id: 'hualien_dongdamen',
    name: '花蓮東大門夜市',
    city: '花蓮',
    starsRequired: 5,
    rentPerDay: 4400,
    baseTraffic: 1.35,
    moveCost: 380000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.2, office: 0.1, family: 0.3, tourist: 0.34, critic: 0.04, vip: 0.02 },
    tastePrefs: ['local', 'seafood', 'tourist', 'meat', 'hot'],
    weatherWeights: { sunny: 0.32, cloudy: 0.26, rain: 0.22, storm: 0.08, cold: 0.04, heat: 0.08 },
    decorStyle: 'nightmarket2',
    skyline: 'nightmarket',
    palette: { sky: '#1f2a44', wall: '#cbaa74', floor: '#857050', accent: '#e2703a' },
    desc: '原住民風味的烤肉香混著海風，遊覽車一車一車地開進來。'
  },
  {
    id: 'tainan_anping',
    name: '台南安平老街',
    city: '台南',
    starsRequired: 5,
    rentPerDay: 3800,
    baseTraffic: 1.3,
    moveCost: 340000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.16, office: 0.1, family: 0.36, tourist: 0.33, critic: 0.03, vip: 0.02 },
    tastePrefs: ['sweet', 'seafood', 'local', 'tourist', 'cheap'],
    weatherWeights: { sunny: 0.44, cloudy: 0.24, rain: 0.1, storm: 0.03, cold: 0.04, heat: 0.15 },
    decorStyle: 'harbor',
    skyline: 'harbor',
    palette: { sky: '#2c3b3e', wall: '#ddcba4', floor: '#8d7a5e', accent: '#b8503a' },
    desc: '紅磚巷弄與百年樹王，蚵仔煎的香味把整條老街的人留住。'
  },
  {
    id: 'kaohsiung_xinkujiang',
    name: '高雄新堀江',
    city: '高雄',
    starsRequired: 6,
    rentPerDay: 9000,
    baseTraffic: 2.4,
    moveCost: 500000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.3, office: 0.16, family: 0.18, tourist: 0.28, critic: 0.05, vip: 0.03 },
    tastePrefs: ['cold', 'sweet', 'tourist', 'premium', 'seafood'],
    weatherWeights: { sunny: 0.48, cloudy: 0.22, rain: 0.12, storm: 0.04, cold: 0.03, heat: 0.11 },
    decorStyle: 'fashion',
    skyline: 'fashion',
    palette: { sky: '#22243c', wall: '#d8d2e0', floor: '#6d6a80', accent: '#00b3b0' },
    desc: '南台灣最時髦的商圈，裝潢不夠炫就等著被隔壁笑。'
  },
  {
    id: 'hsinchu_science_park',
    name: '新竹科學園區',
    city: '新竹',
    starsRequired: 6,
    rentPerDay: 10500,
    baseTraffic: 2.55,
    moveCost: 620000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.12, office: 0.5, family: 0.2, tourist: 0.1, critic: 0.05, vip: 0.03 },
    tastePrefs: ['premium', 'quick', 'caffeine', 'meat', 'cold'],
    weatherWeights: { sunny: 0.24, cloudy: 0.22, rain: 0.22, storm: 0.06, cold: 0.18, heat: 0.08 },
    decorStyle: 'office',
    skyline: 'office',
    palette: { sky: '#2b3547', wall: '#ced3d8', floor: '#727b86', accent: '#3f7fd0' },
    desc: '工程師的深夜食堂：開會開到九點，還要一桌能談 case 的位置。'
  },
  {
    id: 'pingtung_kenting',
    name: '屏東墾丁大街',
    city: '屏東',
    starsRequired: 7,
    rentPerDay: 9500,
    baseTraffic: 1.85,
    moveCost: 700000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.24, office: 0.08, family: 0.23, tourist: 0.38, critic: 0.04, vip: 0.03 },
    tastePrefs: ['cold', 'seafood', 'tourist', 'fried', 'alcohol'],
    weatherWeights: { sunny: 0.5, cloudy: 0.2, rain: 0.12, storm: 0.05, cold: 0.02, heat: 0.11 },
    decorStyle: 'fashion',
    skyline: 'fashion',
    palette: { sky: '#1a2a46', wall: '#e6d7bd', floor: '#8b8a74', accent: '#ff7a2f' },
    desc: '夏天永遠不結束的大街，穿比基尼的客人與炒海鮮的鑊氣同時上桌。'
  },
  {
    id: 'penghu_magong',
    name: '澎湖馬公中央街',
    city: '澎湖',
    starsRequired: 7,
    rentPerDay: 14000,
    baseTraffic: 3.1,
    moveCost: 1600000,
    gridW: 26, gridH: 17,
    customerMix: { student: 0.12, office: 0.08, family: 0.22, tourist: 0.45, critic: 0.08, vip: 0.05 },
    tastePrefs: ['premium', 'seafood', 'tourist', 'alcohol', 'soup'],
    weatherWeights: { sunny: 0.34, cloudy: 0.3, rain: 0.14, storm: 0.12, cold: 0.06, heat: 0.04 },
    decorStyle: 'harbor',
    skyline: 'harbor',
    palette: { sky: '#1c3550', wall: '#d6cfc0', floor: '#6b7a80', accent: '#1f9fb8' },
    desc: '花火節的四百年老街，全台最挑剔的饕客都搭飛機來吃你的海鮮。'
  }
];

export function getLocation(id) {
  return LOCATIONS.find((l) => l.id === id);
}

export function locationsForStars(stars) {
  const s = Number(stars) || 0;
  return LOCATIONS.filter((l) => l.starsRequired <= s);
}
