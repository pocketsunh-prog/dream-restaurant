// src/data/locations.js
// 《夢幻西餐廳：決戰全台灣》六個營業地點（欄位形狀依 docs/ARCHITECTURE.md §2.3、數值依 GAME_PROMPT.md §3.9）
//
// 詞彙表：
//   decorStyle : nightmarket | harbor | office | nightmarket2 | mall | fashion | plain  （對應 FURNITURE[].style）
//   skyline    : nightmarket | harbor | office | nightstreet | mall | fashion        （給 RENDER 畫窗外街景）
//   tastePrefs : 取自 DISHES 的 TAG_LIST
//   weatherWeights 鍵 : sunny | cloudy | rain | storm | cold | heat（總和 1）
//   customerMix  鍵 : student | office | family | tourist | critic | vip（總和 1）

export const LOCATIONS = [
  {
    id: 'zhongli_xinming',
    name: '中壢新明夜市',
    city: '桃園',
    starsRequired: 1,
    rentPerDay: 1800,
    baseTraffic: 1.0,
    moveCost: 0,
    gridW: 20, gridH: 13,
    customerMix: { student: 0.4, office: 0.15, family: 0.3, tourist: 0.1, critic: 0.03, vip: 0.02 },
    tastePrefs: ['cheap', 'fried', 'local', 'meat', 'quick'],
    weatherWeights: { sunny: 0.35, cloudy: 0.25, rain: 0.2, storm: 0.05, cold: 0.07, heat: 0.08 },
    decorStyle: 'nightmarket',
    skyline: 'nightmarket',
    palette: { sky: '#1b2340', wall: '#c9a26b', floor: '#8c6a44', accent: '#e8552e' },
    desc: '一切從這個小小的夜市開始，攤車的燈泡就是你的招牌。'
  },
  {
    id: 'keelung_miaokou',
    name: '基隆廟口',
    city: '基隆',
    starsRequired: 2,
    rentPerDay: 3200,
    baseTraffic: 1.5,
    moveCost: 120000,
    gridW: 20, gridH: 13,
    customerMix: { student: 0.18, office: 0.1, family: 0.32, tourist: 0.34, critic: 0.04, vip: 0.02 },
    tastePrefs: ['seafood', 'soup', 'local', 'tourist', 'hot'],
    weatherWeights: { sunny: 0.2, cloudy: 0.25, rain: 0.3, storm: 0.12, cold: 0.08, heat: 0.05 },
    decorStyle: 'harbor',
    skyline: 'harbor',
    palette: { sky: '#243b52', wall: '#b9c3c9', floor: '#6f7d86', accent: '#2f8fb5' },
    desc: '雨下不停的廟口，熱湯的蒸氣就是最好的宣傳。'
  },
  {
    id: 'taipei_nanyang',
    name: '台北南陽街',
    city: '台北',
    starsRequired: 3,
    rentPerDay: 6500,
    baseTraffic: 2.0,
    moveCost: 250000,
    gridW: 20, gridH: 13,
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
    gridW: 20, gridH: 13,
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
    gridW: 20, gridH: 13,
    customerMix: { student: 0.2, office: 0.12, family: 0.38, tourist: 0.24, critic: 0.04, vip: 0.02 },
    tastePrefs: ['sweet', 'local', 'mild', 'seafood', 'tourist'],
    weatherWeights: { sunny: 0.45, cloudy: 0.22, rain: 0.12, storm: 0.03, cold: 0.04, heat: 0.14 },
    decorStyle: 'mall',
    skyline: 'mall',
    palette: { sky: '#3c4a3a', wall: '#e0d3b0', floor: '#9a8a6c', accent: '#a8562f' },
    desc: '百貨公司樓下的寬敞店面，一家老小週末都往這裡走。'
  },
  {
    id: 'kaohsiung_xinkujiang',
    name: '高雄新堀江',
    city: '高雄',
    starsRequired: 5,
    rentPerDay: 9000,
    baseTraffic: 2.4,
    moveCost: 500000,
    gridW: 20, gridH: 13,
    customerMix: { student: 0.3, office: 0.16, family: 0.18, tourist: 0.28, critic: 0.05, vip: 0.03 },
    tastePrefs: ['cold', 'sweet', 'tourist', 'premium', 'seafood'],
    weatherWeights: { sunny: 0.48, cloudy: 0.22, rain: 0.12, storm: 0.04, cold: 0.03, heat: 0.11 },
    decorStyle: 'fashion',
    skyline: 'fashion',
    palette: { sky: '#22243c', wall: '#d8d2e0', floor: '#6d6a80', accent: '#00b3b0' },
    desc: '南台灣最時髦的商圈，裝潢不夠炫就等著被隔壁笑。'
  }
];

export function getLocation(id) {
  return LOCATIONS.find((l) => l.id === id);
}

export function locationsForStars(stars) {
  const s = Number(stars) || 0;
  return LOCATIONS.filter((l) => l.starsRequired <= s);
}
