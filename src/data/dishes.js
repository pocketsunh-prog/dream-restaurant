// src/data/dishes.js
// 《夢幻西餐廳》料理資料表（欄位形狀依 docs/ARCHITECTURE.md §2.1）
// popularity 的鍵固定為 LOCATIONS[].id：
//   zhongli_xinming 中壢新明夜市 / keelung_miaokou 基隆廟口 / taipei_nanyang 台北南陽街
//   taichung_zhonghua 台中中華路 / tainan_dongdi 台南東帝士廣場 / kaohsiung_xinkujiang 高雄新堀江
// 每個數值代表「該地點顧客對這道菜的偏好係數」，範圍 0.2 ~ 2.0。

export const DISH_CATEGORIES = ['staple', 'side', 'soup', 'drink', 'alcohol', 'dessert', 'secret'];

export const TAG_LIST = ['spicy', 'mild', 'sweet', 'cold', 'hot', 'fried', 'seafood', 'noodle', 'rice', 'meat', 'veg',
  'local', 'tourist', 'cheap', 'premium', 'quick', 'alcohol', 'caffeine', 'dessert', 'soup'];

export const DISHES = [
  // ────────────────────────────── 主食 staple（16） ──────────────────────────────
  {
    id: 'hamburg_steak', name: '漢堡牛肉餅', category: 'staple',
    baseCost: 25, expectedPrice: 180, unlockStars: 1, secret: false,
    tags: ['meat', 'fried', 'hot'],
    cookTimeDefault: 25, portionDefault: 55, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.9, keelung_miaokou: 1.1, taipei_nanyang: 1.2, taichung_zhonghua: 1.3, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.3 },
    desc: '鐵板滋滋作響，夜市裡的無敵招牌。'
  },
  {
    id: 'omelet_rice', name: '蛋包飯', category: 'staple',
    baseCost: 22, expectedPrice: 190, unlockStars: 1, secret: false,
    tags: ['rice', 'hot', 'quick'],
    cookTimeDefault: 20, portionDefault: 60, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.6, keelung_miaokou: 1.2, taipei_nanyang: 1.4, taichung_zhonghua: 1.3, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.2 },
    desc: '番茄醬畫出笑臉，學生一吃就是三年。'
  },
  {
    id: 'fried_pork_chop', name: '炸豬排', category: 'staple',
    baseCost: 30, expectedPrice: 260, unlockStars: 1, secret: false,
    tags: ['meat', 'fried', 'hot'],
    cookTimeDefault: 25, portionDefault: 65, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.1, taipei_nanyang: 1.3, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.2 },
    desc: '金黃外皮一咬就響，是台灣人共同的童年。'
  },
  {
    id: 'squid_pasta', name: '墨魚義大利麵', category: 'staple',
    baseCost: 38, expectedPrice: 320, unlockStars: 2, secret: false,
    tags: ['seafood', 'noodle', 'premium'],
    cookTimeDefault: 30, portionDefault: 60, tasteDefault: 65, gradeDefault: 60,
    popularity: { zhongli_xinming: 0.9, keelung_miaokou: 1.4, taipei_nanyang: 1.3, taichung_zhonghua: 1.1, tainan_dongdi: 1.1, kaohsiung_xinkujiang: 1.5 },
    desc: '吃完牙齒黑一圈，情侶照樣搶著點。'
  },
  {
    id: 'casserole_fish_head', name: '砂鍋魚頭', category: 'staple',
    baseCost: 55, expectedPrice: 470, unlockStars: 3, secret: false,
    tags: ['seafood', 'soup', 'hot', 'local'],
    cookTimeDefault: 40, portionDefault: 80, tasteDefault: 70, gradeDefault: 65,
    popularity: { zhongli_xinming: 1.0, keelung_miaokou: 1.6, taipei_nanyang: 0.9, taichung_zhonghua: 1.1, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '整顆大頭鰱在砂鍋裡翻滾，冬天最奢侈的一鍋。'
  },
  {
    id: 'sirloin_steak', name: '莎朗牛排', category: 'staple',
    baseCost: 80, expectedPrice: 680, unlockStars: 3, secret: false,
    tags: ['meat', 'premium', 'hot'],
    cookTimeDefault: 30, portionDefault: 70, tasteDefault: 68, gradeDefault: 70,
    popularity: { zhongli_xinming: 0.5, keelung_miaokou: 0.5, taipei_nanyang: 0.5, taichung_zhonghua: 0.5, tainan_dongdi: 0.5, kaohsiung_xinkujiang: 0.5 },
    desc: '名字很氣派，客人卻總是翻到下一頁。'
  },
  {
    id: 'beef_noodle', name: '牛肉麵', category: 'staple',
    baseCost: 28, expectedPrice: 230, unlockStars: 1, secret: false,
    tags: ['noodle', 'meat', 'hot', 'local'],
    cookTimeDefault: 30, portionDefault: 75, tasteDefault: 66, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.2, taipei_nanyang: 1.5, taichung_zhonghua: 1.3, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.2 },
    desc: '滷到透的牛腩配酸菜，上班族的午餐救星。'
  },
  {
    id: 'pork_chop_rice', name: '排骨飯', category: 'staple',
    baseCost: 24, expectedPrice: 200, unlockStars: 1, secret: false,
    tags: ['rice', 'meat', 'fried', 'local'],
    cookTimeDefault: 25, portionDefault: 70, tasteDefault: 60, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.1, taipei_nanyang: 1.6, taichung_zhonghua: 1.3, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.1 },
    desc: '便當盒一打開，整間教室都知道你吃什麼。'
  },
  {
    id: 'chicken_leg_rice', name: '雞腿飯', category: 'staple',
    baseCost: 26, expectedPrice: 210, unlockStars: 1, secret: false,
    tags: ['rice', 'meat', 'hot', 'local'],
    cookTimeDefault: 28, portionDefault: 72, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.2, taipei_nanyang: 1.4, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.2 },
    desc: '滷得油亮的雞腿壓在飯上，誠意全在這一支。'
  },
  {
    id: 'braised_pork_rice', name: '滷肉飯', category: 'staple',
    baseCost: 8, expectedPrice: 65, unlockStars: 1, secret: false,
    tags: ['rice', 'cheap', 'local', 'meat'],
    cookTimeDefault: 15, portionDefault: 45, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.4, taipei_nanyang: 1.3, taichung_zhonghua: 1.3, tainan_dongdi: 1.6, kaohsiung_xinkujiang: 1.2 },
    desc: '一勺滷汁淋上白飯，全台灣最強的平民美食。'
  },
  {
    id: 'fried_rice', name: '蛋炒飯', category: 'staple',
    baseCost: 18, expectedPrice: 150, unlockStars: 1, secret: false,
    tags: ['rice', 'quick', 'cheap', 'hot'],
    cookTimeDefault: 15, portionDefault: 60, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.1, taipei_nanyang: 1.6, taichung_zhonghua: 1.3, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.1 },
    desc: '大火快炒、粒粒分明，五分鐘就能上桌。'
  },
  {
    id: 'oyster_omelet', name: '蚵仔煎', category: 'staple',
    baseCost: 20, expectedPrice: 160, unlockStars: 1, secret: false,
    tags: ['seafood', 'local', 'hot', 'fried'],
    cookTimeDefault: 18, portionDefault: 60, tasteDefault: 64, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.5, taipei_nanyang: 0.9, taichung_zhonghua: 1.3, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.2 },
    desc: '粉漿、鮮蚵與青菜，淋上甜甜的紅色醬汁。'
  },
  {
    id: 'stinky_tofu', name: '臭豆腐', category: 'staple',
    baseCost: 12, expectedPrice: 95, unlockStars: 1, secret: false,
    tags: ['local', 'fried', 'hot', 'cheap'],
    cookTimeDefault: 15, portionDefault: 50, tasteDefault: 62, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.4, taipei_nanyang: 1.0, taichung_zhonghua: 1.5, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '臭得整條街都知道，配泡菜才是內行人。'
  },
  {
    id: 'tempura', name: '甜不辣', category: 'staple',
    baseCost: 15, expectedPrice: 120, unlockStars: 1, secret: false,
    tags: ['fried', 'local', 'cheap', 'hot'],
    cookTimeDefault: 12, portionDefault: 50, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.3, taipei_nanyang: 1.1, taichung_zhonghua: 1.4, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.2 },
    desc: '一串在手，邊走邊吃才是夜市的正統姿勢。'
  },
  {
    id: 'curry_rice', name: '咖哩飯', category: 'staple',
    baseCost: 22, expectedPrice: 180, unlockStars: 2, secret: false,
    tags: ['rice', 'mild', 'hot'],
    cookTimeDefault: 25, portionDefault: 65, tasteDefault: 60, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.0, taipei_nanyang: 1.4, taichung_zhonghua: 1.2, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.4 },
    desc: '黃澄澄的醬汁配馬鈴薯，小朋友的最愛。'
  },
  {
    id: 'fried_chicken', name: '香雞排', category: 'staple',
    baseCost: 20, expectedPrice: 150, unlockStars: 1, secret: false,
    tags: ['meat', 'fried', 'hot', 'cheap'],
    cookTimeDefault: 18, portionDefault: 55, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.6, keelung_miaokou: 1.1, taipei_nanyang: 1.4, taichung_zhonghua: 1.5, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.3 },
    desc: '比臉還大的一塊，撒上胡椒鹽就是人間美味。'
  },

  // ────────────────────────────── 小菜 side（12） ──────────────────────────────
  {
    id: 'fried_spring_roll', name: '炸春捲', category: 'side',
    baseCost: 15, expectedPrice: 130, unlockStars: 1, secret: false,
    tags: ['fried', 'hot', 'local', 'cheap'],
    cookTimeDefault: 15, portionDefault: 40, tasteDefault: 62, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.6, keelung_miaokou: 1.3, taipei_nanyang: 1.4, taichung_zhonghua: 1.5, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.4 },
    desc: '喀滋一聲，裡頭的韭黃香氣才剛剛開始。'
  },
  {
    id: 'kimchi', name: '韓式泡菜', category: 'side',
    baseCost: 8, expectedPrice: 65, unlockStars: 2, secret: false,
    tags: ['spicy', 'cold', 'veg', 'cheap'],
    cookTimeDefault: 10, portionDefault: 35, tasteDefault: 65, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.1, keelung_miaokou: 0.9, taipei_nanyang: 1.2, taichung_zhonghua: 1.1, tainan_dongdi: 1.0, kaohsiung_xinkujiang: 1.3 },
    desc: '又酸又辣，夏天配白飯可以多吃兩碗。'
  },
  {
    id: 'peanuts_fish', name: '花生小魚乾', category: 'side',
    baseCost: 12, expectedPrice: 100, unlockStars: 1, secret: false,
    tags: ['seafood', 'local', 'mild'],
    cookTimeDefault: 12, portionDefault: 35, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.5, taipei_nanyang: 1.1, taichung_zhonghua: 1.1, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '下酒菜的王者，越嚼越香停不下來。'
  },
  {
    id: 'seaweed_salad', name: '涼拌海帶芽', category: 'side',
    baseCost: 10, expectedPrice: 85, unlockStars: 1, secret: false,
    tags: ['cold', 'veg', 'mild', 'cheap'],
    cookTimeDefault: 10, portionDefault: 35, tasteDefault: 55, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.0, keelung_miaokou: 1.4, taipei_nanyang: 1.3, taichung_zhonghua: 1.1, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.3 },
    desc: '冰冰涼涼帶點醋香，油膩全消。'
  },
  {
    id: 'century_egg_tofu', name: '皮蛋豆腐', category: 'side',
    baseCost: 12, expectedPrice: 95, unlockStars: 1, secret: false,
    tags: ['cold', 'mild', 'local', 'cheap'],
    cookTimeDefault: 10, portionDefault: 35, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.1, taipei_nanyang: 1.2, taichung_zhonghua: 1.2, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.1 },
    desc: '醬油膏加柴魚片，外國觀光客看了都愣住。'
  },
  {
    id: 'sausage_plate', name: '香腸切盤', category: 'side',
    baseCost: 20, expectedPrice: 160, unlockStars: 2, secret: false,
    tags: ['meat', 'local', 'hot'],
    cookTimeDefault: 14, portionDefault: 40, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.2, taipei_nanyang: 0.9, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.0 },
    desc: '配蒜頭一口一片，台灣人的浪漫不過如此。'
  },
  {
    id: 'salt_pepper_chicken', name: '鹹酥雞', category: 'side',
    baseCost: 18, expectedPrice: 150, unlockStars: 1, secret: false,
    tags: ['fried', 'meat', 'hot', 'cheap'],
    cookTimeDefault: 15, portionDefault: 45, tasteDefault: 65, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.7, keelung_miaokou: 1.2, taipei_nanyang: 1.5, taichung_zhonghua: 1.6, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.4 },
    desc: '九層塔一丟下油鍋，整條巷子都聞到了。'
  },
  {
    id: 'garlic_bread', name: '大蒜麵包', category: 'side',
    baseCost: 10, expectedPrice: 85, unlockStars: 2, secret: false,
    tags: ['mild', 'hot', 'cheap'],
    cookTimeDefault: 12, portionDefault: 35, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 0.9, keelung_miaokou: 0.8, taipei_nanyang: 1.4, taichung_zhonghua: 0.9, tainan_dongdi: 1.0, kaohsiung_xinkujiang: 1.4 },
    desc: '烤得酥脆的蒜香，是西餐廳最親切的問候。'
  },
  {
    id: 'pickled_cucumber', name: '涼拌小黃瓜', category: 'side',
    baseCost: 8, expectedPrice: 70, unlockStars: 1, secret: false,
    tags: ['cold', 'veg', 'cheap', 'mild'],
    cookTimeDefault: 10, portionDefault: 30, tasteDefault: 55, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.1, taipei_nanyang: 1.3, taichung_zhonghua: 1.2, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.2 },
    desc: '拍碎了才入味，蒜頭辣椒一樣都不能少。'
  },
  {
    id: 'fried_dumpling', name: '煎餃', category: 'side',
    baseCost: 18, expectedPrice: 150, unlockStars: 1, secret: false,
    tags: ['fried', 'meat', 'hot', 'quick'],
    cookTimeDefault: 15, portionDefault: 45, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.0, taipei_nanyang: 1.5, taichung_zhonghua: 1.3, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.2 },
    desc: '底部煎成一片脆皮，起鍋時整排連在一起。'
  },
  {
    id: 'fried_tofu', name: '炸豆腐', category: 'side',
    baseCost: 14, expectedPrice: 110, unlockStars: 1, secret: false,
    tags: ['fried', 'veg', 'hot', 'cheap'],
    cookTimeDefault: 14, portionDefault: 40, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.2, taipei_nanyang: 1.1, taichung_zhonghua: 1.3, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '外酥內嫩，沾蒜蓉醬油最對味。'
  },
  {
    id: 'takoyaki', name: '章魚燒', category: 'side',
    baseCost: 20, expectedPrice: 170, unlockStars: 3, secret: false,
    tags: ['seafood', 'hot', 'tourist', 'fried'],
    cookTimeDefault: 16, portionDefault: 45, tasteDefault: 63, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.3, taipei_nanyang: 1.1, taichung_zhonghua: 1.5, tainan_dongdi: 1.1, kaohsiung_xinkujiang: 1.6 },
    desc: '柴魚片在熱氣裡跳舞，年輕人一盒接一盒。'
  },

  // ────────────────────────────── 湯品 soup（9） ──────────────────────────────
  {
    id: 'corn_soup', name: '玉米濃湯', category: 'soup',
    baseCost: 12, expectedPrice: 100, unlockStars: 1, secret: false,
    tags: ['soup', 'mild', 'hot', 'cheap'],
    cookTimeDefault: 20, portionDefault: 55, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.1, taipei_nanyang: 1.3, taichung_zhonghua: 1.2, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.2 },
    desc: '濃稠微甜，小朋友喝湯的第一個選擇。'
  },
  {
    id: 'clam_soup', name: '蛤蜊湯', category: 'soup',
    baseCost: 22, expectedPrice: 180, unlockStars: 2, secret: false,
    tags: ['soup', 'seafood', 'hot', 'local'],
    cookTimeDefault: 25, portionDefault: 60, tasteDefault: 66, gradeDefault: 60,
    popularity: { zhongli_xinming: 1.0, keelung_miaokou: 1.6, taipei_nanyang: 0.9, taichung_zhonghua: 1.0, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.3 },
    desc: '加了薑絲的清湯，鮮得像是剛從海裡撈上來。'
  },
  {
    id: 'squid_thick_soup', name: '魷魚羹', category: 'soup',
    baseCost: 25, expectedPrice: 200, unlockStars: 2, secret: false,
    tags: ['soup', 'seafood', 'local', 'hot'],
    cookTimeDefault: 30, portionDefault: 60, tasteDefault: 66, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.6, taipei_nanyang: 1.1, taichung_zhonghua: 1.2, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.2 },
    desc: '勾了芡的濃湯配沙茶，標準的廟口滋味。'
  },
  {
    id: 'pork_rib_soup', name: '排骨酥湯', category: 'soup',
    baseCost: 22, expectedPrice: 180, unlockStars: 2, secret: false,
    tags: ['soup', 'meat', 'hot', 'local'],
    cookTimeDefault: 30, portionDefault: 60, tasteDefault: 64, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.2, taipei_nanyang: 1.2, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '炸過的排骨再蒸到軟爛，湯頭濁得理直氣壯。'
  },
  {
    id: 'miso_fish_soup', name: '味噌魚湯', category: 'soup',
    baseCost: 26, expectedPrice: 210, unlockStars: 3, secret: false,
    tags: ['soup', 'seafood', 'hot', 'mild'],
    cookTimeDefault: 28, portionDefault: 60, tasteDefault: 66, gradeDefault: 60,
    popularity: { zhongli_xinming: 0.9, keelung_miaokou: 1.5, taipei_nanyang: 1.1, taichung_zhonghua: 1.0, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.4 },
    desc: '味噌的鹹甜配上現流魚塊，日本客也點頭。'
  },
  {
    id: 'borscht_soup', name: '羅宋湯', category: 'soup',
    baseCost: 30, expectedPrice: 250, unlockStars: 3, secret: false,
    tags: ['soup', 'meat', 'hot', 'premium'],
    cookTimeDefault: 35, portionDefault: 65, tasteDefault: 68, gradeDefault: 65,
    popularity: { zhongli_xinming: 0.7, keelung_miaokou: 0.8, taipei_nanyang: 1.5, taichung_zhonghua: 0.9, tainan_dongdi: 1.0, kaohsiung_xinkujiang: 1.5 },
    desc: '番茄與牛肉燉到化開，老西餐廳的體面。'
  },
  {
    id: 'wonton_soup', name: '餛飩湯', category: 'soup',
    baseCost: 16, expectedPrice: 130, unlockStars: 1, secret: false,
    tags: ['soup', 'hot', 'cheap', 'local'],
    cookTimeDefault: 22, portionDefault: 55, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.3, taipei_nanyang: 1.3, taichung_zhonghua: 1.2, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.1 },
    desc: '薄皮裹著一團鮮肉，配榨菜與芹菜珠。'
  },
  {
    id: 'hot_sour_soup', name: '酸辣湯', category: 'soup',
    baseCost: 16, expectedPrice: 135, unlockStars: 2, secret: false,
    tags: ['soup', 'spicy', 'hot', 'cheap'],
    cookTimeDefault: 25, portionDefault: 55, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.0, taipei_nanyang: 1.4, taichung_zhonghua: 1.2, tainan_dongdi: 1.1, kaohsiung_xinkujiang: 1.2 },
    desc: '又酸又辣，加點白胡椒更夠勁。'
  },
  {
    id: 'sesame_chicken_soup', name: '麻油雞湯', category: 'soup',
    baseCost: 40, expectedPrice: 330, unlockStars: 3, secret: false,
    tags: ['soup', 'meat', 'hot', 'local'],
    cookTimeDefault: 40, portionDefault: 70, tasteDefault: 70, gradeDefault: 65,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.1, taipei_nanyang: 1.0, taichung_zhonghua: 1.3, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.0 },
    desc: '寒流來的晚上，這鍋湯能救回一條命。'
  },

  // ────────────────────────────── 飲料 drink（12） ──────────────────────────────
  {
    id: 'black_tea', name: '紅茶', category: 'drink',
    baseCost: 8, expectedPrice: 60, unlockStars: 1, secret: false,
    tags: ['cold', 'sweet', 'cheap', 'quick'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 58, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.6, keelung_miaokou: 1.2, taipei_nanyang: 1.7, taichung_zhonghua: 1.6, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.5 },
    desc: '大桶泡起來、冰塊加滿，一杯接一杯。'
  },
  {
    id: 'orange_juice', name: '柳橙汁', category: 'drink',
    baseCost: 10, expectedPrice: 80, unlockStars: 1, secret: false,
    tags: ['cold', 'sweet', 'quick', 'cheap'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.3, taipei_nanyang: 1.3, taichung_zhonghua: 1.5, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.5 },
    desc: '現榨的酸酸甜甜，小朋友指定要這杯。'
  },
  {
    id: 'milk_tea', name: '珍珠奶茶', category: 'drink',
    baseCost: 15, expectedPrice: 120, unlockStars: 2, secret: false,
    tags: ['cold', 'sweet', 'tourist', 'quick'],
    cookTimeDefault: 12, portionDefault: 50, tasteDefault: 65, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.2, taipei_nanyang: 1.6, taichung_zhonghua: 1.7, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.8 },
    desc: '粉圓要Q、奶味要夠，這年頭最時髦的飲料。'
  },
  {
    id: 'green_tea', name: '綠茶', category: 'drink',
    baseCost: 6, expectedPrice: 50, unlockStars: 1, secret: false,
    tags: ['cold', 'mild', 'cheap', 'quick'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 55, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.2, taipei_nanyang: 1.4, taichung_zhonghua: 1.3, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.4 },
    desc: '無糖去冰，講究的客人都這樣點。'
  },
  {
    id: 'plum_juice', name: '酸梅湯', category: 'drink',
    baseCost: 8, expectedPrice: 65, unlockStars: 2, secret: false,
    tags: ['cold', 'sweet', 'local', 'cheap'],
    cookTimeDefault: 12, portionDefault: 45, tasteDefault: 62, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.2, taipei_nanyang: 1.0, taichung_zhonghua: 1.4, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.1 },
    desc: '烏梅熬成的老味道，吃完油膩剛好解膩。'
  },
  {
    id: 'sugarcane_juice', name: '甘蔗汁', category: 'drink',
    baseCost: 9, expectedPrice: 75, unlockStars: 1, secret: false,
    tags: ['cold', 'sweet', 'local', 'cheap'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.0, taipei_nanyang: 1.1, taichung_zhonghua: 1.5, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.3 },
    desc: '現榨的甜，甜到喉嚨會微微發癢。'
  },
  {
    id: 'cola', name: '可樂', category: 'drink',
    baseCost: 7, expectedPrice: 55, unlockStars: 1, secret: false,
    tags: ['cold', 'sweet', 'cheap', 'quick'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 55, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.1, taipei_nanyang: 1.2, taichung_zhonghua: 1.4, tainan_dongdi: 1.1, kaohsiung_xinkujiang: 1.4 },
    desc: '倒進玻璃杯加檸檬片，立刻貴了三十元。'
  },
  {
    id: 'hot_coffee', name: '熱咖啡', category: 'drink',
    baseCost: 12, expectedPrice: 100, unlockStars: 2, secret: false,
    tags: ['hot', 'caffeine', 'quick', 'mild'],
    cookTimeDefault: 12, portionDefault: 40, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 0.8, keelung_miaokou: 0.8, taipei_nanyang: 1.8, taichung_zhonghua: 0.9, tainan_dongdi: 0.9, kaohsiung_xinkujiang: 1.5 },
    desc: '補習街的深夜，這一杯比什麼都提神。'
  },
  {
    id: 'iced_coffee', name: '冰咖啡', category: 'drink',
    baseCost: 12, expectedPrice: 100, unlockStars: 2, secret: false,
    tags: ['cold', 'caffeine', 'quick'],
    cookTimeDefault: 12, portionDefault: 40, tasteDefault: 62, gradeDefault: 55,
    popularity: { zhongli_xinming: 0.9, keelung_miaokou: 0.8, taipei_nanyang: 1.6, taichung_zhonghua: 1.1, tainan_dongdi: 0.9, kaohsiung_xinkujiang: 1.7 },
    desc: '冰塊撞上杯壁，夏天的續命道具。'
  },
  {
    id: 'sparkling_water', name: '氣泡礦泉水', category: 'drink',
    baseCost: 10, expectedPrice: 85, unlockStars: 3, secret: false,
    tags: ['cold', 'mild', 'premium'],
    cookTimeDefault: 10, portionDefault: 40, tasteDefault: 55, gradeDefault: 60,
    popularity: { zhongli_xinming: 0.5, keelung_miaokou: 0.6, taipei_nanyang: 1.2, taichung_zhonghua: 0.7, tainan_dongdi: 0.8, kaohsiung_xinkujiang: 1.6 },
    desc: '沒有味道卻最貴，時髦的人喝的是氣氛。'
  },
  {
    id: 'winter_melon_tea', name: '冬瓜茶', category: 'drink',
    baseCost: 7, expectedPrice: 55, unlockStars: 1, secret: false,
    tags: ['cold', 'sweet', 'local', 'cheap'],
    cookTimeDefault: 10, portionDefault: 45, tasteDefault: 60, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.1, taipei_nanyang: 1.0, taichung_zhonghua: 1.5, tainan_dongdi: 1.6, kaohsiung_xinkujiang: 1.2 },
    desc: '古法熬煮的甜，退火又解渴。'
  },
  {
    id: 'yogurt_shake', name: '優酪乳', category: 'drink',
    baseCost: 14, expectedPrice: 115, unlockStars: 2, secret: false,
    tags: ['cold', 'sweet', 'mild'],
    cookTimeDefault: 12, portionDefault: 45, tasteDefault: 60, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.0, keelung_miaokou: 0.9, taipei_nanyang: 1.3, taichung_zhonghua: 1.2, tainan_dongdi: 1.2, kaohsiung_xinkujiang: 1.5 },
    desc: '酸酸甜甜又標榜健康，媽媽們最買帳。'
  },

  // ────────────────────────────── 酒類 alcohol（7） ──────────────────────────────
  {
    id: 'taiwan_beer', name: '台灣啤酒', category: 'alcohol',
    baseCost: 20, expectedPrice: 180, unlockStars: 1, secret: false,
    tags: ['alcohol', 'cold', 'local', 'cheap'],
    cookTimeDefault: 8, portionDefault: 50, tasteDefault: 65, gradeDefault: 60,
    popularity: { zhongli_xinming: 1.6, keelung_miaokou: 1.5, taipei_nanyang: 1.2, taichung_zhonghua: 1.6, tainan_dongdi: 1.7, kaohsiung_xinkujiang: 1.5 },
    desc: '台灣人的血液裡流著這個牌子，冰的才叫啤酒。'
  },
  {
    id: 'canned_beer', name: '罐裝啤酒', category: 'alcohol',
    baseCost: 15, expectedPrice: 130, unlockStars: 1, secret: false,
    tags: ['alcohol', 'cold', 'cheap', 'quick'],
    cookTimeDefault: 8, portionDefault: 45, tasteDefault: 58, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.5, keelung_miaokou: 1.4, taipei_nanyang: 1.1, taichung_zhonghua: 1.5, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.3 },
    desc: '拉環一開就上桌，快炒店的基本禮貌。'
  },
  {
    id: 'taiwan_draft_beer', name: '台灣生啤酒', category: 'alcohol',
    baseCost: 22, expectedPrice: 190, unlockStars: 2, secret: false,
    tags: ['alcohol', 'cold', 'local', 'premium'],
    cookTimeDefault: 8, portionDefault: 50, tasteDefault: 70, gradeDefault: 65,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.6, taipei_nanyang: 1.3, taichung_zhonghua: 1.5, tainan_dongdi: 1.6, kaohsiung_xinkujiang: 1.6 },
    desc: '十八天的新鮮，泡沫細得像剛下的雪。'
  },
  {
    id: 'kaoliang', name: '高粱酒', category: 'alcohol',
    baseCost: 45, expectedPrice: 400, unlockStars: 3, secret: false,
    tags: ['alcohol', 'hot', 'local', 'premium'],
    cookTimeDefault: 8, portionDefault: 40, tasteDefault: 72, gradeDefault: 70,
    popularity: { zhongli_xinming: 0.8, keelung_miaokou: 0.9, taipei_nanyang: 0.8, taichung_zhonghua: 1.1, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 0.9 },
    desc: '小小一杯就燒到胃裡，敬長輩的必備款。'
  },
  {
    id: 'red_wine', name: '紅酒', category: 'alcohol',
    baseCost: 80, expectedPrice: 720, unlockStars: 3, secret: false,
    tags: ['alcohol', 'premium', 'mild'],
    cookTimeDefault: 10, portionDefault: 40, tasteDefault: 70, gradeDefault: 75,
    popularity: { zhongli_xinming: 0.5, keelung_miaokou: 0.6, taipei_nanyang: 1.3, taichung_zhonghua: 0.9, tainan_dongdi: 0.8, kaohsiung_xinkujiang: 1.7 },
    desc: '醒酒要等半小時，情侶約會就是要這個派頭。'
  },
  {
    id: 'whiskey', name: '威士忌', category: 'alcohol',
    baseCost: 90, expectedPrice: 820, unlockStars: 4, secret: false,
    tags: ['alcohol', 'premium', 'hot'],
    cookTimeDefault: 10, portionDefault: 40, tasteDefault: 72, gradeDefault: 78,
    popularity: { zhongli_xinming: 0.4, keelung_miaokou: 0.5, taipei_nanyang: 1.2, taichung_zhonghua: 0.8, tainan_dongdi: 0.7, kaohsiung_xinkujiang: 1.6 },
    desc: '加一顆大冰塊，大人的味道小朋友不懂。'
  },
  {
    id: 'sake', name: '清酒', category: 'alcohol',
    baseCost: 55, expectedPrice: 480, unlockStars: 4, secret: false,
    tags: ['alcohol', 'mild', 'premium', 'tourist'],
    cookTimeDefault: 10, portionDefault: 40, tasteDefault: 68, gradeDefault: 72,
    popularity: { zhongli_xinming: 0.5, keelung_miaokou: 1.0, taipei_nanyang: 1.0, taichung_zhonghua: 0.7, tainan_dongdi: 0.7, kaohsiung_xinkujiang: 1.8 },
    desc: '溫熱或冰鎮都行，配生魚片最對味。'
  },

  // ────────────────────────────── 甜點 dessert（10） ──────────────────────────────
  {
    id: 'mango_shaved_ice', name: '芒果剉冰', category: 'dessert',
    baseCost: 15, expectedPrice: 120, unlockStars: 2, secret: false,
    tags: ['dessert', 'cold', 'sweet', 'local'],
    cookTimeDefault: 12, portionDefault: 50, tasteDefault: 68, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.0, taipei_nanyang: 1.2, taichung_zhonghua: 1.6, tainan_dongdi: 1.6, kaohsiung_xinkujiang: 1.7 },
    desc: '夏天限定的黃金色，淋上煉乳才算完成。'
  },
  {
    id: 'taro_ball', name: '芋圓', category: 'dessert',
    baseCost: 12, expectedPrice: 100, unlockStars: 2, secret: false,
    tags: ['dessert', 'sweet', 'hot', 'local'],
    cookTimeDefault: 18, portionDefault: 45, tasteDefault: 66, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.3, taipei_nanyang: 1.0, taichung_zhonghua: 1.3, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.3 },
    desc: '又Q又香，熱的冰的都有人愛。'
  },
  {
    id: 'pineapple_cake', name: '鳳梨酥', category: 'dessert',
    baseCost: 14, expectedPrice: 120, unlockStars: 2, secret: false,
    tags: ['dessert', 'sweet', 'tourist', 'local'],
    cookTimeDefault: 20, portionDefault: 35, tasteDefault: 68, gradeDefault: 60,
    popularity: { zhongli_xinming: 1.0, keelung_miaokou: 1.3, taipei_nanyang: 1.1, taichung_zhonghua: 1.2, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.3 },
    desc: '觀光客整盒整盒買，帶回去當伴手禮。'
  },
  {
    id: 'egg_pudding', name: '雞蛋布丁', category: 'dessert',
    baseCost: 8, expectedPrice: 65, unlockStars: 1, secret: false,
    tags: ['dessert', 'cold', 'sweet', 'cheap'],
    cookTimeDefault: 15, portionDefault: 35, tasteDefault: 62, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.0, taipei_nanyang: 1.2, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.2 },
    desc: '焦糖苦甜剛好，小朋友吃完還想再一個。'
  },
  {
    id: 'red_bean_soup', name: '紅豆湯', category: 'dessert',
    baseCost: 10, expectedPrice: 85, unlockStars: 1, secret: false,
    tags: ['dessert', 'hot', 'sweet', 'local'],
    cookTimeDefault: 25, portionDefault: 45, tasteDefault: 64, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.3, keelung_miaokou: 1.1, taipei_nanyang: 1.1, taichung_zhonghua: 1.3, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.1 },
    desc: '寒流夜裡的溫暖，加了湯圓更幸福。'
  },
  {
    id: 'douhua', name: '豆花', category: 'dessert',
    baseCost: 10, expectedPrice: 85, unlockStars: 1, secret: false,
    tags: ['dessert', 'cold', 'sweet', 'local'],
    cookTimeDefault: 15, portionDefault: 45, tasteDefault: 64, gradeDefault: 50,
    popularity: { zhongli_xinming: 1.4, keelung_miaokou: 1.3, taipei_nanyang: 1.2, taichung_zhonghua: 1.4, tainan_dongdi: 1.5, kaohsiung_xinkujiang: 1.2 },
    desc: '綿密到入口即化，糖水是整碗的靈魂。'
  },
  {
    id: 'ice_cream_sundae', name: '冰淇淋聖代', category: 'dessert',
    baseCost: 16, expectedPrice: 140, unlockStars: 3, secret: false,
    tags: ['dessert', 'cold', 'sweet', 'premium'],
    cookTimeDefault: 12, portionDefault: 40, tasteDefault: 68, gradeDefault: 60,
    popularity: { zhongli_xinming: 0.9, keelung_miaokou: 1.0, taipei_nanyang: 1.3, taichung_zhonghua: 1.4, tainan_dongdi: 1.3, kaohsiung_xinkujiang: 1.8 },
    desc: '插上巧克力棒與櫻桃，端上桌就有面子。'
  },
  {
    id: 'tangyuan', name: '湯圓', category: 'dessert',
    baseCost: 12, expectedPrice: 100, unlockStars: 2, secret: false,
    tags: ['dessert', 'hot', 'sweet', 'local'],
    cookTimeDefault: 20, portionDefault: 45, tasteDefault: 64, gradeDefault: 55,
    popularity: { zhongli_xinming: 1.2, keelung_miaokou: 1.2, taipei_nanyang: 1.0, taichung_zhonghua: 1.3, tainan_dongdi: 1.4, kaohsiung_xinkujiang: 1.1 },
    desc: '冬至前後點整碗公，甜湯裡滾著白胖小子。'
  },
  {
    id: 'cheesecake', name: '起司蛋糕', category: 'dessert',
    baseCost: 22, expectedPrice: 190, unlockStars: 4, secret: false,
    tags: ['dessert', 'sweet', 'premium', 'cold'],
    cookTimeDefault: 30, portionDefault: 40, tasteDefault: 72, gradeDefault: 68,
    popularity: { zhongli_xinming: 0.6, keelung_miaokou: 0.8, taipei_nanyang: 1.5, taichung_zhonghua: 1.1, tainan_dongdi: 0.9, kaohsiung_xinkujiang: 1.8 },
    desc: '切面要漂亮、叉子要陷下去，這才叫高級甜點。'
  },
  {
    id: 'souffle', name: '舒芙蕾', category: 'dessert',
    baseCost: 30, expectedPrice: 280, unlockStars: 4, secret: false,
    tags: ['dessert', 'sweet', 'premium', 'hot'],
    cookTimeDefault: 28, portionDefault: 40, tasteDefault: 74, gradeDefault: 72,
    popularity: { zhongli_xinming: 0.4, keelung_miaokou: 0.6, taipei_nanyang: 1.4, taichung_zhonghua: 0.9, tainan_dongdi: 0.7, kaohsiung_xinkujiang: 1.9 },
    desc: '出爐三分鐘內沒吃掉就會塌，師傅會哭。'
  },

  // ────────────────────────────── 隱藏料理 secret（2） ──────────────────────────────
  // 兩道以自創歌名為梗的隱藏料理，需五星後挑戰年度大獎才解鎖。
  {
    id: 'secret_oh_yeah', name: '歐耶！夢幻鐵板燒', category: 'secret',
    baseCost: 45, expectedPrice: 420, unlockStars: 5, secret: true,
    tags: ['local', 'premium', 'hot', 'meat'],
    cookTimeDefault: 35, portionDefault: 75, tasteDefault: 82, gradeDefault: 82,
    popularity: { zhongli_xinming: 1.8, keelung_miaokou: 1.7, taipei_nanyang: 1.8, taichung_zhonghua: 1.9, tainan_dongdi: 1.7, kaohsiung_xinkujiang: 2.0 },
    desc: '傳說中的點歌單招牌，鐵板一響全場都跟著唱。'
  },
  {
    id: 'secret_one_more', name: '通通給我來一份', category: 'secret',
    baseCost: 35, expectedPrice: 330, unlockStars: 5, secret: true,
    tags: ['premium', 'tourist', 'hot', 'rice'],
    cookTimeDefault: 40, portionDefault: 80, tasteDefault: 80, gradeDefault: 80,
    popularity: { zhongli_xinming: 1.7, keelung_miaokou: 1.6, taipei_nanyang: 1.9, taichung_zhonghua: 1.7, tainan_dongdi: 1.8, kaohsiung_xinkujiang: 1.9 },
    desc: '一道菜擺滿整桌，客人喊的其實是那句副歌。'
  }
];

export function getDish(id) {
  return DISHES.find((d) => d.id === id);
}

export function dishesForStars(stars) {
  const s = Number(stars) || 0;
  return DISHES.filter((d) => d.unlockStars <= s);
}
