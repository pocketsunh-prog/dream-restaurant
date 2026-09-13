// src/data/events.js
// 《夢幻西餐廳》突發事件表（欄位形狀依 docs/ARCHITECTURE.md §2.5、內容依 GAME_PROMPT.md §3.11）
//
// kind      : positive | negative | neutral
// locations : null（全地點）或 LOCATIONS[].id 陣列
// mitigateBy: null 或 FURNITURE[].id 陣列 —— 買了對應防治設備，事件損失大幅下降
// effects 僅可使用下列鍵：
//   fame, reputation:{community,outside}, cash, moodAll,
//   supplierPriceMul, trafficMul, trafficMulMinutes, damage, stockLoss
//   damage ∈ 'ac' | 'stove' | 'fridge' | 'random_item' | null

export const EVENTS = [
  // ══════════════════════════ 正面 positive（13） ══════════════════════════
  {
    id: 'tv_interview', name: '電視台採訪',
    kind: 'positive', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '電視台聞風而來，攝影機對準了你的招牌菜！',
    effects: { fame: 12, reputation: { community: 6, outside: 14 }, moodAll: 10, trafficMul: 1.8, trafficMulMinutes: 120 },
    log: '電視採訪：知名度大幅提升。'
  },
  {
    id: 'food_critic_visit', name: '美食評論家突擊',
    kind: 'positive', weight: 5, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '戴著眼鏡的陌生人默默記著筆記，他點的每一道菜都被放大檢視。',
    effects: { fame: 6, reputation: { community: 4, outside: 10 }, moodAll: 4 },
    log: '美食評論家突擊：區外評價提升。'
  },
  {
    id: 'celebrity_visit', name: '名人來訪',
    kind: 'positive', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '一位常在電視上出現的大人物走進來，還指定要坐靠窗那桌。',
    effects: { fame: 10, reputation: { community: 8, outside: 8 }, cash: 8000, moodAll: 12 },
    log: '名人來訪：全場客人都在偷看。'
  },
  {
    id: 'community_subsidy', name: '社區活動補助',
    kind: 'positive', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '里長親自送來一只信封，感謝你讓這條街晚上亮了起來。',
    effects: { cash: 60000, reputation: { community: 12, outside: 0 } },
    log: '社區活動補助：收到補助款 NT$ 60,000。'
  },
  {
    id: 'neighbor_closed', name: '隔壁店家倒閉',
    kind: 'positive', weight: 3, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '隔壁的老店面悄悄拉下鐵門，原本的客人全往你這裡走。',
    effects: { trafficMul: 1.35, trafficMulMinutes: 240, reputation: { community: 4, outside: 0 } },
    log: '隔壁店家倒閉：客人轉往本店。'
  },
  {
    id: 'magazine_feature', name: '雜誌美食專欄',
    kind: 'positive', weight: 3, minStars: 3, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '雜誌社派人來拍了一整個下午，說要把你放進本月專題。',
    effects: { fame: 8, reputation: { community: 5, outside: 12 }, trafficMul: 1.4, trafficMulMinutes: 180 },
    log: '雜誌專欄報導：外縣市客人也找上門。'
  },
  {
    id: 'bbs_recommend', name: 'BBS 美食板爆推',
    kind: 'positive', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '有人在 BBS 美食板貼了一篇「這家一定要吃」，推文一路推到爆。',
    effects: { fame: 7, reputation: { community: 2, outside: 8 }, trafficMul: 1.5, trafficMulMinutes: 150 },
    log: 'BBS 爆推：學生族群蜂擁而至。'
  },
  {
    id: 'school_trip', name: '學校校外教學',
    kind: 'positive', weight: 3, minStars: 2, maxStars: 5,
    locations: ['taipei_nanyang', 'taichung_zhonghua', 'tainan_dongdi'], onlyWhileOpen: true, mitigateBy: null,
    message: '老師帶著一整班學生殺進來，說要吃「課本裡寫的那一道」。',
    effects: { cash: 12000, moodAll: 6, reputation: { community: 6, outside: 2 } },
    log: '校外教學團：一整個下午座無虛席。'
  },
  {
    id: 'festival_parade', name: '廟會繞境人潮',
    kind: 'positive', weight: 4, minStars: 1, maxStars: 5,
    locations: ['keelung_miaokou', 'taichung_zhonghua', 'tainan_dongdi'], onlyWhileOpen: true, mitigateBy: null,
    message: '鑼鼓聲從街口傳來，繞境隊伍把整條街塞得滿滿的。',
    effects: { trafficMul: 1.6, trafficMulMinutes: 200, moodAll: 8 },
    log: '廟會繞境：街上人潮爆滿。'
  },
  {
    id: 'tv_drama_shoot', name: '連續劇借景拍攝',
    kind: 'positive', weight: 2, minStars: 3, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '劇組想借你的店拍一場分手戲，還願意付場地費。',
    effects: { cash: 35000, fame: 6, reputation: { community: 0, outside: 8 } },
    log: '連續劇借景：收到場地費並打響名號。'
  },
  {
    id: 'sunny_weekend', name: '大晴天假日',
    kind: 'positive', weight: 6, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '太陽大得刺眼，全家出遊的人潮一波接一波。',
    effects: { trafficMul: 1.25, trafficMulMinutes: 480, moodAll: 5 },
    log: '大晴天假日：來客數明顯成長。'
  },
  {
    id: 'loyal_regular', name: '老主顧帶整團來',
    kind: 'positive', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '那位每週都來的老先生，這次帶了整桌親戚說要介紹好店。',
    effects: { cash: 9000, reputation: { community: 8, outside: 0 }, moodAll: 6 },
    log: '老主顧帶團：社區口碑上漲。'
  },
  {
    id: 'supplier_discount', name: '供應商回饋降價',
    kind: 'positive', weight: 3, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '菜販阿伯說最近批價漂亮，算你便宜一點當作交朋友。',
    effects: { supplierPriceMul: 0.85 },
    log: '供應商降價：進貨成本下降 15%。'
  },

  // ══════════════════════════ 負面 negative（15） ══════════════════════════
  {
    id: 'stove_broken', name: '爐具故障',
    kind: 'negative', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['fire_system'],
    message: '快炒到一半爐火突然熄了，師傅敲了半天也發不起來。',
    effects: { moodAll: -8, reputation: { community: -4, outside: -2 }, damage: 'stove' },
    log: '爐具故障：出餐速度大打折扣。'
  },
  {
    id: 'ac_broken', name: '冷氣故障',
    kind: 'negative', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['security_host'],
    message: '冷氣發出最後一聲呻吟就停了，整間店瞬間變成蒸籠。',
    effects: { moodAll: -12, reputation: { community: -5, outside: -2 }, damage: 'ac' },
    log: '冷氣故障：客人頻頻搧風抱怨。'
  },
  {
    id: 'fridge_broken', name: '冰箱故障',
    kind: 'negative', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: ['security_host'],
    message: '冰箱門一開就聞到不對勁的味道，裡面的食材全毀了。',
    effects: { cash: -6000, stockLoss: 0.25, damage: 'fridge' },
    log: '冰箱故障：庫存報廢，損失慘重。'
  },
  {
    id: 'power_outage', name: '停電',
    kind: 'negative', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['security_host'],
    message: '整條街啪地一聲全黑，只剩隔壁的收音機還在響。',
    effects: { cash: -9000, moodAll: -14, reputation: { community: -6, outside: -3 }, damage: 'random_item', trafficMul: 0.5, trafficMulMinutes: 60 },
    log: '停電：摸黑營業，客人跑掉一半。'
  },
  {
    id: 'ingredient_price_up', name: '食材漲價',
    kind: 'negative', weight: 6, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '市場傳來消息，青菜與肉類全面喊漲，供應商電話一直打來。',
    effects: { supplierPriceMul: 1.3 },
    log: '食材漲價：進貨成本上升 30%。'
  },
  {
    id: 'rat_infestation', name: '老鼠出沒',
    kind: 'negative', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['cctv'],
    message: '一位客人尖叫著站起來，指著牆角那個快速移動的影子。',
    effects: { cash: -4000, moodAll: -8, reputation: { community: -10, outside: -6 }, stockLoss: 0.08 },
    log: '老鼠出沒：客人觀感大受打擊。'
  },
  {
    id: 'burglary', name: '宵小竊盜',
    kind: 'negative', weight: 4, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: ['cctv', 'infrared_sensor', 'security_host'],
    message: '早上開門發現後門被撬開，收銀機抽屜整個被搬走。',
    effects: { cash: -45000, damage: 'random_item', reputation: { community: -4, outside: -2 } },
    log: '宵小竊盜：現金與設備損失。'
  },
  {
    id: 'staff_leave', name: '員工請假',
    kind: 'negative', weight: 7, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '一早接到電話：「老闆，我昨天吃壞肚子，今天真的不行。」',
    effects: { moodAll: -6, reputation: { community: -3, outside: -1 } },
    log: '員工請假：人手不足，外場一片混亂。'
  },
  {
    id: 'staff_quit', name: '員工離職',
    kind: 'negative', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '有人把圍裙摺好放在櫃台上，說對面那家開的時薪比較高。',
    effects: { moodAll: -10, reputation: { community: -6, outside: -2 } },
    log: '員工離職：士氣低落，得趕快再找人。'
  },
  {
    id: 'food_poisoning', name: '食物中毒',
    kind: 'negative', weight: 3, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '兩桌客人同時捂著肚子站起來，臉色比桌上的魚還白。',
    effects: { cash: -30000, fame: -8, moodAll: -20, reputation: { community: -35, outside: -25 } },
    log: '食物中毒：評價重挫，還得賠醫藥費。'
  },
  {
    id: 'karen_customer', name: '奧客鬧場',
    kind: 'negative', weight: 6, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '一位客人拍桌大吼說湯是涼的，還要把整桌的帳都算在你頭上。',
    effects: { moodAll: -10, reputation: { community: -12, outside: -6 } },
    log: '奧客鬧場：鄰桌客人也跟著心情變差。'
  },
  {
    id: 'toilet_clog', name: '廁所堵塞',
    kind: 'negative', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: null,
    message: '廁所傳來一陣騷動，水已經慢慢從門縫底下流出來。',
    effects: { cash: -3500, moodAll: -10, reputation: { community: -8, outside: -3 } },
    log: '廁所堵塞：清潔度崩盤。'
  },
  {
    id: 'water_leak', name: '漏水',
    kind: 'negative', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['fire_system'],
    message: '天花板開始滴水，正好滴在剛坐下的那桌客人頭上。',
    effects: { cash: -12000, damage: 'random_item', moodAll: -6, reputation: { community: -5, outside: -2 } },
    log: '漏水：裝潢受損，還得叫水電師傅。'
  },
  {
    id: 'gas_leak', name: '瓦斯外洩',
    kind: 'negative', weight: 3, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['fire_extinguisher', 'fire_system'],
    message: '廚房飄出濃濃的瓦斯味，所有人立刻被趕到街上。',
    effects: { cash: -15000, moodAll: -12, reputation: { community: -8, outside: -4 }, damage: 'stove' },
    log: '瓦斯外洩：緊急停業檢修。'
  },
  {
    id: 'electrical_fire', name: '電線走火',
    kind: 'negative', weight: 2, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: true, mitigateBy: ['fire_extinguisher', 'fire_system'],
    message: '插座冒出火花，牆邊的延長線瞬間燒了起來！',
    effects: { cash: -40000, damage: 'random_item', moodAll: -18, reputation: { community: -14, outside: -8 }, trafficMul: 0.6, trafficMulMinutes: 90 },
    log: '電線走火：設備燒毀，生意大受影響。'
  },

  // ══════════════════════════ 中性 neutral（4） ══════════════════════════
  {
    id: 'weather_shift', name: '天氣驟變',
    kind: 'neutral', weight: 5, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '氣象報告說鋒面要來，街上的人一下子多了起來。',
    effects: { trafficMul: 1.1, trafficMulMinutes: 120 },
    log: '天氣驟變：來客數略有變化。'
  },
  {
    id: 'market_renovation', name: '市場整修公告',
    kind: 'neutral', weight: 4, minStars: 1, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '市府貼出公告，門口那條路要挖開重鋪，工期兩週。',
    effects: { trafficMul: 0.85, trafficMulMinutes: 240 },
    log: '市場整修：門口施工，來客稍減。'
  },
  {
    id: 'bus_stop_moved', name: '公車站牌遷移',
    kind: 'neutral', weight: 3, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '公車站牌往你這邊移了三十公尺，等車的人潮就在門口排隊。',
    effects: { trafficMul: 1.06, trafficMulMinutes: 300 },
    log: '站牌遷移：人流結構改變。'
  },
  {
    id: 'health_inspection', name: '衛生局例行檢查',
    kind: 'neutral', weight: 3, minStars: 2, maxStars: 5,
    locations: null, onlyWhileOpen: false, mitigateBy: null,
    message: '衛生局來抽查，看了廚房與冰箱之後默默在表格上打了勾。',
    effects: { fame: 3, reputation: { community: 3, outside: 0 }, cash: -2000 },
    log: '衛生局檢查：合格通過，小幅加分。'
  }
];

export function eventById(id) {
  return EVENTS.find((e) => e.id === id);
}

export function eventsFor(stars, locationId) {
  const s = Number(stars) || 1;
  return EVENTS.filter((e) => s >= e.minStars && s <= e.maxStars &&
    (!e.locations || e.locations.includes(locationId)));
}
