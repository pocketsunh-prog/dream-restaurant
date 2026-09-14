/**
 * locations.js — 店舖選址資料表（Location Master Data）
 *
 * 本檔案為《夢幻餐廳 3D》的選址主資料，提供 28 個日本實際商圈的可開店地點。
 * 遊戲流程：玩家在星級（stars）解鎖後，付出 moveCost 搬遷成本進駐該地，
 * 之後每日支付 rentPerDay 租金，並依 trafficBase、customerMix、spendLevel
 * 與 weather 產生來客數與營業額結算。
 *
 * 欄位契約（每個 entry 必有且僅有這些欄位，名稱與型別固定）：
 *   id          : string   蛇形命名、純 ASCII、全表唯一
 *   name        : string   日文原名（漢字／假名），遊戲內顯示名稱
 *   nameZh      : string   繁體中文譯名
 *   romaji      : string   羅馬拼音
 *   region      : string   北海道|東北|関東|中部|近畿|中国|四国|九州|沖縄
 *   city        : string   所在城市（日文）
 *   kind        : string   downtown|shopping|business|tourist|student|entertainment|
 *                          port|onsen|market|suburban|luxury
 *   stars       : number   解鎖星級 1..5（1 = 開局即可選）
 *   rentPerDay  : number   每日租金 2500..26000，隨 prestige（星級）遞增
 *   moveCost    : number   一次性搬遷成本 120000..2600000，隨星級遞增
 *   trafficBase : number   每小時基準來客數 18..140
 *   customerMix : object   客層比例；鍵固定為 office, student, tourist, family,
 *                          couple, elder, party 七項（無關者填 0），整數總和 = 100
 *   spendLevel  : number   消費力倍率 0.7..2.6
 *   decorStyle  : string   showa|modern|traditional|izakaya|kissaten|luxury|street
 *   specialties : string[] 2..4 個招牌菜色 id，取自 dishes 清單
 *   weather     : object   sunny, cloudy, rain, snow 整數百分比，總和 = 100
 *                          （溫暖地區 snow 一律為 0）
 *   desc        : string   1-2 句繁體中文說明，描述該地氛圍與適合的店型
 *
 * 註：kind 僅限上述 11 種列舉值；「傳統老街」這類風格以 decorStyle: 'traditional'
 * 表達（例如祇園、ならまち），不另開 kind 值。
 *
 * 設計原則：stars 越高，rentPerDay／moveCost／spendLevel 越高（區間互不重疊）；
 * 市場與溫泉地以清晨與家庭、銀髮客層為主；北海道（札幌、函館）冬季有雪，
 * 沖繩則全年無雪。本檔案無任何 import、無副作用，僅匯出資料與查詢函式。
 */

/** 全部可選址地點，依遊戲建議解鎖順序排列。 */
export const LOCATIONS = [
  {
    id: 'tokyo_shibuya',
    name: '渋谷センター街',
    nameZh: '澀谷中心街',
    romaji: 'Shibuya Center-gai',
    region: '関東',
    city: '東京',
    kind: 'downtown',
    stars: 1,
    rentPerDay: 4800,
    moveCost: 210000,
    trafficBase: 96,
    customerMix: { office: 25, student: 25, tourist: 20, family: 8, couple: 17, elder: 5, party: 0 },
    spendLevel: 1.0,
    decorStyle: 'street',
    specialties: ['ramen', 'gyoza', 'karaage'],
    weather: { sunny: 42, cloudy: 30, rain: 22, snow: 6 },
    desc: '澀谷中心街是年輕潮流與夜生活的十字路口，全天人流不斷，學生與上班族混雜。這裡最適合翻桌快、價格親民的街頭食堂。'
  },
  {
    id: 'tokyo_shinjuku_yokocho',
    name: '新宿思い出横丁',
    nameZh: '新宿回憶橫丁',
    romaji: 'Shinjuku Omoide Yokocho',
    region: '関東',
    city: '東京',
    kind: 'entertainment',
    stars: 2,
    rentPerDay: 6800,
    moveCost: 380000,
    trafficBase: 112,
    customerMix: { office: 30, student: 12, tourist: 18, family: 4, couple: 14, elder: 8, party: 14 },
    spendLevel: 1.12,
    decorStyle: 'showa',
    specialties: ['yakitori', 'ramen', 'oden'],
    weather: { sunny: 42, cloudy: 30, rain: 22, snow: 6 },
    desc: '新宿回憶橫丁是保留戰後風情的窄巷燒烤街，入夜後擠滿小酌的上班族與慕名而來的觀光客。狹小的店面最適合居酒屋型的串燒與關東煮。'
  },
  {
    id: 'tokyo_asakusa',
    name: '浅草仲見世',
    nameZh: '淺草仲見世',
    romaji: 'Asakusa Nakamise',
    region: '関東',
    city: '東京',
    kind: 'tourist',
    stars: 1,
    rentPerDay: 4600,
    moveCost: 195000,
    trafficBase: 104,
    customerMix: { office: 10, student: 12, tourist: 38, family: 16, couple: 12, elder: 12, party: 0 },
    spendLevel: 0.95,
    decorStyle: 'traditional',
    specialties: ['tempura', 'soba', 'unagi', 'onigiri'],
    weather: { sunny: 43, cloudy: 30, rain: 21, snow: 6 },
    desc: '淺草仲見世位於淺草寺參道，白天觀光客與修學旅行團絡繹不絕，老字號氣息濃厚。天婦羅、蕎麥與糰子類和食老舖在此最能發揮。'
  },
  {
    id: 'tokyo_ginza',
    name: '銀座',
    nameZh: '銀座',
    romaji: 'Ginza',
    region: '関東',
    city: '東京',
    kind: 'luxury',
    stars: 5,
    rentPerDay: 26000,
    moveCost: 2600000,
    trafficBase: 78,
    customerMix: { office: 34, student: 2, tourist: 20, family: 8, couple: 20, elder: 10, party: 6 },
    spendLevel: 2.6,
    decorStyle: 'luxury',
    specialties: ['sushi', 'kaiseki', 'tempura', 'unagi'],
    weather: { sunny: 44, cloudy: 30, rain: 20, snow: 6 },
    desc: '銀座是日本最具代表性的高級商圈，百貨公司與老舖料亭林立，客單價極高。頂級壽司、懷石與割烹類店家在此最為合適。'
  },
  {
    id: 'tokyo_akihabara',
    name: '秋葉原電気街',
    nameZh: '秋葉原電氣街',
    romaji: 'Akihabara Denki-gai',
    region: '関東',
    city: '東京',
    kind: 'shopping',
    stars: 2,
    rentPerDay: 6200,
    moveCost: 340000,
    trafficBase: 108,
    customerMix: { office: 22, student: 30, tourist: 22, family: 4, couple: 10, elder: 4, party: 8 },
    spendLevel: 1.05,
    decorStyle: 'street',
    specialties: ['curry_rice', 'ramen', 'donburi', 'karaage'],
    weather: { sunny: 42, cloudy: 30, rain: 22, snow: 6 },
    desc: '秋葉原電氣街是動漫與電子產品的聖地，學生與外國觀光客密度極高。平價咖哩、丼飯與速食型拉麵最能滿足快速用餐的需求。'
  },
  {
    id: 'tokyo_kichijoji',
    name: '吉祥寺サンロード',
    nameZh: '吉祥寺太陽道商店街',
    romaji: 'Kichijoji Sunroad',
    region: '関東',
    city: '東京',
    kind: 'suburban',
    stars: 2,
    rentPerDay: 5200,
    moveCost: 260000,
    trafficBase: 74,
    customerMix: { office: 20, student: 18, tourist: 6, family: 26, couple: 16, elder: 14, party: 0 },
    spendLevel: 1.08,
    decorStyle: 'kissaten',
    specialties: ['kissaten_set', 'curry_rice', 'yakitori'],
    weather: { sunny: 42, cloudy: 30, rain: 22, snow: 6 },
    desc: '吉祥寺太陽道是東京西郊的在地商店街，家庭主婦與下班居民構成穩定客源。純喫茶與家庭取向的定食、咖哩最受歡迎。'
  },
  {
    id: 'kanagawa_yokohama_chukagai',
    name: '横浜中華街',
    nameZh: '橫濱中華街',
    romaji: 'Yokohama Chukagai',
    region: '関東',
    city: '横浜',
    kind: 'tourist',
    stars: 3,
    rentPerDay: 9800,
    moveCost: 560000,
    trafficBase: 118,
    customerMix: { office: 16, student: 16, tourist: 32, family: 18, couple: 10, elder: 6, party: 2 },
    spendLevel: 1.3,
    decorStyle: 'street',
    specialties: ['champon', 'gyoza', 'ramen', 'donburi'],
    weather: { sunny: 43, cloudy: 30, rain: 21, snow: 6 },
    desc: '橫濱中華街是日本最大的中華街，觀光客與家庭客並肩而行，假日人潮洶湧。強棒麵、餃子與中華拉麵等熱食攤位最能聚客。'
  },
  {
    id: 'osaka_dotonbori',
    name: '道頓堀',
    nameZh: '道頓堀',
    romaji: 'Dotonbori',
    region: '近畿',
    city: '大阪',
    kind: 'entertainment',
    stars: 2,
    rentPerDay: 7200,
    moveCost: 400000,
    trafficBase: 132,
    customerMix: { office: 20, student: 16, tourist: 26, family: 8, couple: 14, elder: 6, party: 10 },
    spendLevel: 1.18,
    decorStyle: 'street',
    specialties: ['takoyaki', 'okonomiyaki', 'ramen'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '道頓堀是大阪南區的霓虹美食河岸，觀光客與下班人潮徹夜不散，翻桌率驚人。章魚燒、大阪燒等粉物料理在此是必備招牌。'
  },
  {
    id: 'osaka_shinsekai',
    name: '新世界',
    nameZh: '新世界',
    romaji: 'Shinsekai',
    region: '近畿',
    city: '大阪',
    kind: 'downtown',
    stars: 1,
    rentPerDay: 2900,
    moveCost: 130000,
    trafficBase: 88,
    customerMix: { office: 14, student: 18, tourist: 14, family: 16, couple: 10, elder: 22, party: 6 },
    spendLevel: 0.78,
    decorStyle: 'showa',
    specialties: ['takoyaki', 'okonomiyaki', 'karaage'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '新世界是通天閣下的昭和懷舊下町，以價格導向的在地常客與銀髮族為主。便宜、份量足的粉物料理正是此地的靈魂。'
  },
  {
    id: 'kyoto_gion',
    name: '祇園',
    nameZh: '祇園',
    romaji: 'Gion',
    region: '近畿',
    city: '京都',
    kind: 'luxury',
    stars: 4,
    rentPerDay: 17500,
    moveCost: 1150000,
    trafficBase: 82,
    customerMix: { office: 14, student: 4, tourist: 36, family: 6, couple: 22, elder: 12, party: 6 },
    spendLevel: 1.92,
    decorStyle: 'traditional',
    specialties: ['kaiseki', 'sushi', 'oden', 'teishoku'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '祇園是京都花街的核心，石板路兩側盡是茶屋與高級料亭，客層講究氛圍與服務。懷石與高級壽司等精緻和食在此最相稱。'
  },
  {
    id: 'kyoto_nishiki',
    name: '錦市場',
    nameZh: '錦市場',
    romaji: 'Nishiki Ichiba',
    region: '近畿',
    city: '京都',
    kind: 'market',
    stars: 3,
    rentPerDay: 10500,
    moveCost: 620000,
    trafficBase: 96,
    customerMix: { office: 12, student: 10, tourist: 34, family: 16, couple: 14, elder: 14, party: 0 },
    spendLevel: 1.38,
    decorStyle: 'traditional',
    specialties: ['sushi', 'soba', 'onigiri', 'teishoku'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '錦市場被稱為京都的廚房，狹長拱廊裡擠滿採買的居民與觀光客。壽司、蕎麥與飯糰等即食和食攤位從清晨就開始熱鬧。'
  },
  {
    id: 'hyogo_kobe_sannomiya',
    name: '三宮',
    nameZh: '三宮',
    romaji: 'Sannomiya',
    region: '近畿',
    city: '神戸',
    kind: 'downtown',
    stars: 3,
    rentPerDay: 9200,
    moveCost: 580000,
    trafficBase: 102,
    customerMix: { office: 26, student: 18, tourist: 16, family: 12, couple: 16, elder: 6, party: 6 },
    spendLevel: 1.34,
    decorStyle: 'modern',
    specialties: ['yakiniku', 'shabu_shabu', 'ramen'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '三宮是神戶的交通與商業樞紐，辦公人潮與時尚客層交錯，晚間應酬需求旺盛。以神戶牛為號召的燒肉與涮涮鍋店在此最具吸引力。'
  },
  {
    id: 'aichi_nagoya_sakae',
    name: '栄',
    nameZh: '榮',
    romaji: 'Sakae',
    region: '中部',
    city: '名古屋',
    kind: 'shopping',
    stars: 3,
    rentPerDay: 8800,
    moveCost: 540000,
    trafficBase: 106,
    customerMix: { office: 28, student: 18, tourist: 14, family: 12, couple: 14, elder: 6, party: 8 },
    spendLevel: 1.32,
    decorStyle: 'modern',
    specialties: ['miso_katsu', 'hitsumabushi', 'teishoku', 'karaage'],
    weather: { sunny: 42, cloudy: 30, rain: 24, snow: 4 },
    desc: '榮是名古屋最繁華的購物區，百貨、地下街與商辦共構出穩定客流。味噌炸豬排與鰻魚飯三吃等名古屋名物是此地招牌。'
  },
  {
    id: 'hokkaido_sapporo_susukino',
    name: 'すすきの',
    nameZh: '薄野',
    romaji: 'Susukino',
    region: '北海道',
    city: '札幌',
    kind: 'entertainment',
    stars: 3,
    rentPerDay: 9600,
    moveCost: 640000,
    trafficBase: 110,
    customerMix: { office: 28, student: 14, tourist: 18, family: 6, couple: 16, elder: 6, party: 12 },
    spendLevel: 1.4,
    decorStyle: 'izakaya',
    specialties: ['jingisukan', 'seafood_bowl', 'ramen', 'sake_set'],
    weather: { sunny: 34, cloudy: 30, rain: 16, snow: 20 },
    desc: '薄野（すすきの）是北海道最大的歡樂街，雪國的夜晚聚集大量飲酒客，冬季仍有旺盛的宵夜需求。成吉思汗烤肉、海鮮丼與味噌拉麵能撐起整夜的生意。'
  },
  {
    id: 'hokkaido_hakodate_asaichi',
    name: '函館朝市',
    nameZh: '函館朝市',
    romaji: 'Hakodate Asaichi',
    region: '北海道',
    city: '函館',
    kind: 'market',
    stars: 4,
    rentPerDay: 13800,
    moveCost: 880000,
    trafficBase: 92,
    customerMix: { office: 10, student: 6, tourist: 34, family: 20, couple: 14, elder: 16, party: 0 },
    spendLevel: 1.62,
    decorStyle: 'street',
    specialties: ['seafood_bowl', 'donburi', 'sushi', 'ramen'],
    weather: { sunny: 34, cloudy: 30, rain: 16, snow: 20 },
    desc: '函館朝市以清晨的活跳海鮮聞名，觀光客一早就來排隊吃海鮮丼，午后即收攤。從清晨開始營業的海鮮與丼飯店舖在此最為吃香。'
  },
  {
    id: 'miyagi_sendai_kokubuncho',
    name: '国分町',
    nameZh: '國分町',
    romaji: 'Kokubuncho',
    region: '東北',
    city: '仙台',
    kind: 'entertainment',
    stars: 4,
    rentPerDay: 13200,
    moveCost: 840000,
    trafficBase: 104,
    customerMix: { office: 30, student: 14, tourist: 10, family: 6, couple: 16, elder: 8, party: 16 },
    spendLevel: 1.6,
    decorStyle: 'izakaya',
    specialties: ['gyoza', 'yakiniku', 'sake_set'],
    weather: { sunny: 36, cloudy: 30, rain: 20, snow: 14 },
    desc: '國分町是東北最大的夜之街，仙台的上班族下班後幾乎都往這裡聚集。餃子、燒肉與日本酒搭配的居酒屋最適合此地。'
  },
  {
    id: 'fukuoka_hakata_nakasu',
    name: '博多中洲',
    nameZh: '博多中洲',
    romaji: 'Hakata Nakasu',
    region: '九州',
    city: '福岡',
    kind: 'entertainment',
    stars: 4,
    rentPerDay: 14500,
    moveCost: 900000,
    trafficBase: 124,
    customerMix: { office: 28, student: 14, tourist: 20, family: 6, couple: 16, elder: 6, party: 10 },
    spendLevel: 1.65,
    decorStyle: 'street',
    specialties: ['ramen', 'gyoza', 'oden', 'sake_set'],
    weather: { sunny: 42, cloudy: 30, rain: 28, snow: 0 },
    desc: '博多中洲是被屋台與霓虹包圍的歡樂街，深夜人潮與觀光客帶來極高的翻桌率。豚骨拉麵、一口餃子與關東煮等博多名物是此地的基本盤。'
  },
  {
    id: 'hiroshima_okonomimura',
    name: 'お好み村',
    nameZh: '好味村',
    romaji: 'Okonomimura',
    region: '中国',
    city: '広島',
    kind: 'downtown',
    stars: 2,
    rentPerDay: 5400,
    moveCost: 280000,
    trafficBase: 86,
    customerMix: { office: 22, student: 20, tourist: 14, family: 14, couple: 12, elder: 10, party: 8 },
    spendLevel: 1.06,
    decorStyle: 'showa',
    specialties: ['okonomiyaki', 'ramen', 'karaage'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '好味村是廣島市中心的大阪燒主題大樓，在地客與觀光客慕名前來，鐵板前座位總是滿的。大阪燒專門店與平價鐵板料理在此最能生存。'
  },
  {
    id: 'nagasaki_shinchi_chukagai',
    name: '長崎新地中華街',
    nameZh: '長崎新地中華街',
    romaji: 'Nagasaki Shinchi Chukagai',
    region: '九州',
    city: '長崎',
    kind: 'tourist',
    stars: 3,
    rentPerDay: 8200,
    moveCost: 500000,
    trafficBase: 98,
    customerMix: { office: 14, student: 14, tourist: 34, family: 16, couple: 12, elder: 8, party: 2 },
    spendLevel: 1.3,
    decorStyle: 'street',
    specialties: ['champon', 'gyoza', 'seafood_bowl', 'udon'],
    weather: { sunny: 42, cloudy: 30, rain: 28, snow: 0 },
    desc: '長崎新地中華街是日本三大中華街之一，觀光客與家庭客比例高，街道小巧而熱鬧。強棒麵與皿烏龍等長崎中華料理是必備菜色。'
  },
  {
    id: 'okinawa_naha_kokusai',
    name: '国際通り',
    nameZh: '國際通',
    romaji: 'Kokusai-dori',
    region: '沖縄',
    city: '那覇',
    kind: 'shopping',
    stars: 2,
    rentPerDay: 5600,
    moveCost: 300000,
    trafficBase: 100,
    customerMix: { office: 12, student: 14, tourist: 36, family: 20, couple: 10, elder: 6, party: 2 },
    spendLevel: 1.1,
    decorStyle: 'street',
    specialties: ['soki_soba', 'gyoza_okinawa', 'seafood_bowl'],
    weather: { sunny: 52, cloudy: 30, rain: 18, snow: 0 },
    desc: '國際通是沖繩最熱鬧的購物大道，觀光客與家庭旅遊人潮終年不斷，全年高溫無雪。沖繩蕎麥與苦瓜料理等在地口味最能吸引旅客。'
  },
  {
    id: 'ishikawa_kanazawa_omicho',
    name: '近江町市場',
    nameZh: '近江町市場',
    romaji: 'Omicho Ichiba',
    region: '中部',
    city: '金沢',
    kind: 'market',
    stars: 4,
    rentPerDay: 12800,
    moveCost: 820000,
    trafficBase: 94,
    customerMix: { office: 12, student: 6, tourist: 32, family: 20, couple: 14, elder: 16, party: 0 },
    spendLevel: 1.58,
    decorStyle: 'traditional',
    specialties: ['seafood_bowl', 'sushi', 'tempura', 'teishoku'],
    weather: { sunny: 30, cloudy: 32, rain: 24, snow: 14 },
    desc: '近江町市場是金澤的廚房，清晨的日本海漁獲與加賀蔬菜吸引居民與觀光客上門。海鮮丼與壽司等講求鮮度的店家清晨即開門營業。'
  },
  {
    id: 'nara_naramachi',
    name: 'ならまち',
    nameZh: '奈良町',
    romaji: 'Naramachi',
    region: '近畿',
    city: '奈良',
    kind: 'tourist',
    stars: 3,
    rentPerDay: 7800,
    moveCost: 460000,
    trafficBase: 68,
    customerMix: { office: 10, student: 14, tourist: 30, family: 18, couple: 14, elder: 14, party: 0 },
    spendLevel: 1.28,
    decorStyle: 'kissaten',
    specialties: ['kissaten_set', 'onigiri', 'soba'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '奈良町是元興寺一帶的町家老街，觀光客與在地人步調悠閒，午後客流平緩。喫茶店、飯糰與蕎麥等輕食最能融入古都風景。'
  },
  {
    id: 'tokyo_ueno_ameyoko',
    name: 'アメ横',
    nameZh: '阿美橫丁',
    romaji: 'Ameyoko',
    region: '関東',
    city: '東京',
    kind: 'market',
    stars: 1,
    rentPerDay: 4100,
    moveCost: 175000,
    trafficBase: 116,
    customerMix: { office: 18, student: 20, tourist: 24, family: 12, couple: 10, elder: 10, party: 6 },
    spendLevel: 0.85,
    decorStyle: 'showa',
    specialties: ['seafood_bowl', 'yakitori', 'donburi', 'onigiri'],
    weather: { sunny: 42, cloudy: 30, rain: 22, snow: 6 },
    desc: '阿美橫丁是上野高架橋下的傳統市場街，叫賣聲與小吃攤吸引全年齡層，上午就開始熱鬧。海鮮丼、串燒與乾貨小吃以低價與速度取勝。'
  },
  {
    id: 'chiba_kaihin_makuhari',
    name: '海浜幕張',
    nameZh: '海濱幕張',
    romaji: 'Kaihin Makuhari',
    region: '関東',
    city: '千葉',
    kind: 'business',
    stars: 3,
    rentPerDay: 8400,
    moveCost: 520000,
    trafficBase: 72,
    customerMix: { office: 42, student: 10, tourist: 8, family: 20, couple: 10, elder: 6, party: 4 },
    spendLevel: 1.36,
    decorStyle: 'modern',
    specialties: ['teishoku', 'curry_rice', 'tonkatsu', 'kissaten_set'],
    weather: { sunny: 43, cloudy: 30, rain: 21, snow: 6 },
    desc: '海濱幕張是千葉的會展與商辦新都心，平日以辦公人潮為主、假日與展期落差極大。定食、咖哩與喫茶套餐等商業午餐最符合這裡的需求。'
  },
  {
    id: 'shizuoka_atami_onsen',
    name: '熱海温泉',
    nameZh: '熱海溫泉',
    romaji: 'Atami Onsen',
    region: '中部',
    city: '熱海',
    kind: 'onsen',
    stars: 3,
    rentPerDay: 9000,
    moveCost: 600000,
    trafficBase: 80,
    customerMix: { office: 8, student: 6, tourist: 30, family: 24, couple: 18, elder: 14, party: 0 },
    spendLevel: 1.42,
    decorStyle: 'traditional',
    specialties: ['seafood_bowl', 'sushi', 'teishoku', 'sake_set'],
    weather: { sunny: 42, cloudy: 30, rain: 24, snow: 4 },
    desc: '熱海溫泉是東京近郊的老牌溫泉地，旅館住客與家庭旅客從早到晚川流不息，清晨與傍晚各有一次用餐高峰。海鮮丼、壽司與會席定食最能配合泡湯行程。'
  },
  {
    id: 'ehime_dogo_onsen',
    name: '道後温泉',
    nameZh: '道後溫泉',
    romaji: 'Dogo Onsen',
    region: '四国',
    city: '松山',
    kind: 'onsen',
    stars: 5,
    rentPerDay: 20000,
    moveCost: 1500000,
    trafficBase: 84,
    customerMix: { office: 8, student: 4, tourist: 34, family: 20, couple: 20, elder: 14, party: 0 },
    spendLevel: 2.1,
    decorStyle: 'traditional',
    specialties: ['kaiseki', 'teishoku', 'sake_set', 'sushi'],
    weather: { sunny: 44, cloudy: 28, rain: 28, snow: 0 },
    desc: '道後溫泉是日本最古老的溫泉之一，旅館與觀光客帶來高消費力的過夜客層，清晨入浴後與晚間會席是兩大時段。懷石與會席料理等高單價和食在此最為合適。'
  },
  {
    id: 'kumamoto_shimotori',
    name: '下通り',
    nameZh: '下通',
    romaji: 'Shimotori',
    region: '九州',
    city: '熊本',
    kind: 'shopping',
    stars: 2,
    rentPerDay: 5800,
    moveCost: 320000,
    trafficBase: 98,
    customerMix: { office: 22, student: 22, tourist: 12, family: 16, couple: 12, elder: 6, party: 10 },
    spendLevel: 1.14,
    decorStyle: 'modern',
    specialties: ['ramen', 'tonkatsu', 'karaage'],
    weather: { sunny: 42, cloudy: 30, rain: 28, snow: 0 },
    desc: '下通是熊本市中心最大的拱廊商店街，學生與在地家庭客是主力，雨天照樣有人潮。豚骨拉麵、炸物與丼飯等平價餐點在此最受歡迎。'
  },
  {
    id: 'kagoshima_tenmonkan',
    name: '天文館',
    nameZh: '天文館',
    romaji: 'Tenmonkan',
    region: '九州',
    city: '鹿児島',
    kind: 'downtown',
    stars: 2,
    rentPerDay: 5000,
    moveCost: 250000,
    trafficBase: 92,
    customerMix: { office: 18, student: 22, tourist: 14, family: 16, couple: 12, elder: 10, party: 8 },
    spendLevel: 1.08,
    decorStyle: 'showa',
    specialties: ['ramen', 'karaage', 'seafood_bowl'],
    weather: { sunny: 42, cloudy: 30, rain: 28, snow: 0 },
    desc: '天文館是鹿兒島最繁華的繁華街，購物人潮與夜間飲酒客並存，學生比例偏高。拉麵、炸物與海鮮料理最貼近南九州的口味偏好。'
  }
];

/** 全部地區名稱，依地理由北到南的顯示順序排列（供 UI 分區使用）。 */
export const REGIONS = [
  '北海道',
  '東北',
  '関東',
  '中部',
  '近畿',
  '中国',
  '四国',
  '九州',
  '沖縄'
];

/**
 * 以 id 取得單一地點。
 * @param {string} id 地點 id（蛇形命名）
 * @returns {object|undefined} 找到的地點，找不到時為 undefined
 */
export function locationById(id) {
  if (typeof id !== 'string') return undefined;
  for (let i = 0; i < LOCATIONS.length; i += 1) {
    if (LOCATIONS[i].id === id) return LOCATIONS[i];
  }
  return undefined;
}

/**
 * 取得在指定星級已解鎖的所有地點（entry.stars <= stars）。
 * @param {number} stars 目前星級
 * @returns {object[]} 符合條件的地點陣列（維持 LOCATIONS 順序）
 */
export function locationsForStars(stars) {
  const level = typeof stars === 'number' && Number.isFinite(stars) ? stars : 0;
  return LOCATIONS.filter((location) => location.stars <= level);
}

export default LOCATIONS;
