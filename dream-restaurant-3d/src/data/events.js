/**
 * events.js — 突發事件資料表（Event Master Data）
 *
 * 本檔案為《夢幻餐廳 3D》的事件主資料，收錄 62 筆日本在地化的餐廳經營事件，
 * 分為正面（positive）、負面（negative）與中性（neutral）三種。
 *
 * 欄位契約（每個 entry 必有且僅有這些欄位，名稱與型別固定）：
 *   id             : string   蛇形命名、純 ASCII、全表唯一
 *   name           : string   日文原名（漢字／假名），遊戲內顯示名稱
 *   kana           : string   平假名讀音，對應 name
 *   kind           : string   positive|negative|neutral
 *   weight         : number   相對權重 1..10（越大越常發生）
 *   minStars       : number   最低星級 1..5
 *   maxStars       : number   最高星級 1..5，且 >= minStars
 *   onlyWhileOpen  : boolean  true 表示僅在營業時間（11:00-22:00）發生
 *   locations      : null 或 location kind 陣列
 *                            取自 locations.js 的 kind 列舉：
 *                            downtown|shopping|business|tourist|student|
 *                            entertainment|port|onsen|market|suburban|luxury
 *   requireWeather : null、單一天氣字串，或天氣字串陣列（後者為擴充用法）
 *                            成員取自 game.js 的 WEATHERS：
 *                            sunny|cloudy|rain|snow|storm|heat|fog|sleet
 *                            單一字串：僅在目前天氣相符時發生（原有行為）。
 *                            陣列如 ['rain','storm']：目前天氣為任一成員即成立。
 *                            省略／null 代表不受天氣限制（原有行為）。
 *   mitigateBy     : null 或設備 id：cctv|infrared_sensor|fire_extinguisher|
 *                            fire_system|security_host|fridge|ac_unit
 *                            買了對應設備，事件損失大幅下降（desc 會說明）
 *   message        : string   事件發生時顯示的繁體中文訊息（1 句，帶畫面感）
 *   log            : string   一行短紀錄，供事件列表使用
 *   desc           : string   1-2 句繁中說明事件內容與因應方式
 *   duration       : [number, number] 效果持續分鐘數，整數且 [0] <= [1]；
 *                            [0, 0] 代表立即事件（只有 effects 的立即值）
 *   effects        : object   僅可使用下列鍵（沒有的就省略）：
 *                            trafficMul 客流倍率、costMul 食材成本倍率、
 *                            fame 人氣、cash 現金（日圓）、dirt 髒污、
 *                            moodAll 全體顧客心情、staffFatigue 員工疲勞、
 *                            equipBroken 設備故障（ac_unit|fridge|stove|null）
 *
 * 平衡原則：正面事件權重與效果強度大致成反比（越強越少見）；
 * 負面事件僅星級高、規模大者才帶高權重，並盡量提供 mitigateBy 的防治設備解法；
 * 中性事件以氛圍與小幅度增減為主，避免與正負面事件的強度重疊。
 * 星級門檻：衛生檢查與米其林級評價僅 stars >= 3、有名部落客 stars >= 2、
 * 瑣碎的日常事件則在 stars = 1 即可發生。
 *
 * 本檔案無任何 import、無副作用，僅匯出資料與查詢函式。
 */

/** 事件種類列舉。 */
export const EVENT_KINDS = ['positive', 'negative', 'neutral'];

/** 全部突發事件。 */
export const EVENTS = [
  // ══════════════════════════ 正面 positive（24） ══════════════════════════
  {
    id: 'tv_interview',
    name: 'テレビ取材',
    kana: 'てれびしゅざい',
    kind: 'positive',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '電視台的採訪車停在店門口，攝影機對準了你最自豪的招牌菜。',
    log: '電視台採訪：知名度大幅提升。',
    desc: '地方電視台的傍晚情報節目臨時決定來採訪你的招牌菜，播出後隔天來客明顯變多。人氣與客流同時上升，是開店初期最划算的曝光。',
    duration: [120, 240],
    effects: { trafficMul: 1.6, fame: 12, moodAll: 8 }
  },
  {
    id: 'famous_blogger',
    name: '有名ブロガー来店',
    kana: 'ゆうめいぶろがーらいてん',
    kind: 'positive',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '一位揹著單眼相機的客人從頭拍到尾，說要寫成部落格文章。',
    log: '知名部落客來店：網路討論度上升。',
    desc: '擁有數萬讀者的美食部落客悄悄來店試吃，回去後寫了一篇好評。文章上線後年輕客層明顯增加，口碑會持續一段時間。',
    duration: [180, 360],
    effects: { trafficMul: 1.45, fame: 9 }
  },
  {
    id: 'regular_word_of_mouth',
    name: '常連客の口コミ',
    kana: 'じょうれんきゃくのくちこみ',
    kind: 'positive',
    weight: 6,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['onsen', 'suburban', 'downtown', 'shopping'],
    requireWeather: null,
    mitigateBy: null,
    message: '那位每週都來的老先生，這次帶了整桌親戚說要介紹好店。',
    log: '常客口耳相傳：社區口碑上漲。',
    desc: '熟客主動替你在鄰里之間宣傳，還帶了家人一起來用餐。這種口碑最扎實，人氣與顧客心情都會穩定上升。',
    duration: [0, 0],
    effects: { fame: 4, cash: 9000, moodAll: 6 }
  },
  {
    id: 'shotengai_prize',
    name: '商店街の福引景品提供',
    kana: 'しょうてんがいのふくびきけいひんていきょう',
    kind: 'positive',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: ['shopping', 'downtown', 'suburban'],
    requireWeather: null,
    mitigateBy: null,
    message: '商店街的福引抽獎攤位掛出你的餐券，抽中的人都笑著跑來兌換。',
    log: '提供商店街福引景品：在地好感提升。',
    desc: '你提供餐券當作商店街福引的獎品，主辦方補貼了費用並在廣播裡一再提到你的店名。付出的成本不多，卻換到整條街的善意。',
    duration: [0, 0],
    effects: { cash: 8000, fame: 5 }
  },
  {
    id: 'bonenkai_booking',
    name: '近隣企業の忘年会予約',
    kana: 'きんりんきぎょうのぼうねんかいよやく',
    kind: 'positive',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['business', 'entertainment', 'downtown'],
    requireWeather: null,
    mitigateBy: null,
    message: '附近的公司打電話來，一口氣訂下三十人份的忘年会宴席。',
    log: '接到忘年会團訂：單筆營業額大增。',
    desc: '歲末將近，附近的公司行號訂下大桌忘年会。大筆訂金立刻入帳，同時也帶來一批第一次上門的新客人。',
    duration: [0, 0],
    effects: { cash: 55000, fame: 4, moodAll: 8 }
  },
  {
    id: 'sakura_matsuri',
    name: '桜まつりの人出',
    kana: 'さくらまつりのひとで',
    kind: 'positive',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['tourist', 'suburban', 'downtown'],
    requireWeather: 'sunny',
    mitigateBy: null,
    message: '櫻花滿開，賞花客把整條街塞得滿滿的，店裡一位難求。',
    log: '櫻花祭人潮：來客數大幅成長。',
    desc: '櫻花季加上好天氣，賞花人潮沿著街道一路湧進店裡。這種天時地利的日子翻桌率極高，適合提前備料。',
    duration: [300, 600],
    effects: { trafficMul: 1.75, moodAll: 6 }
  },
  {
    id: 'hanabi_taikai',
    name: '花火大会の帰り客',
    kana: 'はなびたいかいのかえりきゃく',
    kind: 'positive',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['tourist', 'entertainment', 'port', 'downtown'],
    requireWeather: null,
    mitigateBy: null,
    message: '煙火施放結束，穿著浴衣的人潮一路笑著走回車站，全擠進店裡。',
    log: '花火大會散場：宵夜時段爆滿。',
    desc: '煙火大會散場後，浴衣客與家庭客同時湧入。營業後半段的來客數暴增，現金收入也跟著水漲船高。',
    duration: [120, 240],
    effects: { trafficMul: 1.8, cash: 22000, moodAll: 10 }
  },
  {
    id: 'magazine_feature',
    name: '雑誌の特集',
    kana: 'ざっしのとくしゅう',
    kind: 'positive',
    weight: 3,
    minStars: 3,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '雜誌社派人來拍了一整個下午，說要把你放進這個月的專題。',
    log: '雜誌特集報導：外地客人也上門。',
    desc: '知名美食雜誌把你選進本月特集，攝影師與編輯花了整個下午拍攝。刊出後不只人氣上升，連外縣市的客人都專程前來。',
    duration: [240, 480],
    effects: { trafficMul: 1.4, fame: 10 }
  },
  {
    id: 'michelin_rating',
    name: 'ミシュラン級の高評価',
    kana: 'みしゅらんきゅうのこうひょうか',
    kind: 'positive',
    weight: 2,
    minStars: 4,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '美食指南的調查員低調來過兩次，最新一版把你列進了推薦名單。',
    log: '獲得米其林級評價：名聲大噪。',
    desc: '權威美食指南把你列進推薦名單，消息一出預約電話整天沒停過。人氣與客流同時躍升，是高星級店面最夢寐以求的肯定。',
    duration: [600, 1200],
    effects: { trafficMul: 1.9, fame: 22, moodAll: 5 }
  },
  {
    id: 'celebrity_visit',
    name: '芸能人の来店',
    kana: 'げいのうじんのらいてん',
    kind: 'positive',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['luxury', 'entertainment', 'downtown', 'tourist'],
    requireWeather: null,
    mitigateBy: null,
    message: '一位常在電視上出現的大人物走進來，還指定要坐靠窗那桌。',
    log: '藝人來店：全場客人都在偷看。',
    desc: '知名藝人悄悄來店用餐，離開前還拍了紀念照上傳社群。店裡的話題度瞬間爆表，人氣與現金收入一起進帳。',
    duration: [0, 0],
    effects: { fame: 14, cash: 12000, moodAll: 12 }
  },
  {
    id: 'local_tv_live',
    name: '地元テレビの生中継',
    kana: 'じもとてれびのなまちゅうけい',
    kind: 'positive',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['downtown', 'shopping', 'market', 'tourist'],
    requireWeather: null,
    mitigateBy: null,
    message: '地方電視台的轉播車就停在對街，你的店招牌出現在生中繼畫面裡。',
    log: '地方電視生中繼：瞬間來客暴增。',
    desc: '傍晚的在地新聞節目從商店街做現場連線，鏡頭正好帶到你的店面。播出後半小時內來客量翻倍，是最即時的免費宣傳。',
    duration: [90, 180],
    effects: { trafficMul: 2.2, fame: 12 }
  },
  {
    id: 'sns_buzz',
    name: 'SNSでバズる',
    kana: 'えすえぬえすでばずる',
    kind: 'positive',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '有客人拍的短影片一夜之間瘋傳，隔天門口排起長長的隊伍。',
    log: '社群瘋傳：店門口大排長龍。',
    desc: '客人隨手拍下的短影片在社群上瘋傳，隔天門口就排起了長龍。人氣快速上升，但排隊人潮也讓外場忙得不可開交。',
    duration: [180, 360],
    effects: { trafficMul: 1.7, fame: 11, staffFatigue: 8 }
  },
  {
    id: 'gourmet_tv_feature',
    name: 'グルメ番組の取材',
    kana: 'ぐるめばんぐみのしゅざい',
    kind: 'positive',
    weight: 3,
    minStars: 3,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '全國網的美食節目帶著整組攝影機來借廚房，說要拍你的招牌定食。',
    log: '美食節目取材：全國播出，名氣大漲。',
    desc: '全國播送的美食節目花了整個下午拍攝你的招牌定食，播出時段還排在黃金檔。人氣一舉躍升，慕名而來的客人會在往後幾天陸續上門。',
    duration: [360, 720],
    effects: { trafficMul: 1.5, fame: 14 }
  },
  {
    id: 'inbound_surge',
    name: 'インバウンド急増',
    kana: 'いんばうんどきゅうぞう',
    kind: 'positive',
    weight: 5,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['tourist', 'luxury', 'port', 'downtown', 'entertainment'],
    requireWeather: null,
    mitigateBy: null,
    message: '拖著行李箱的外國客一桌接一桌，指著隔壁桌的料理比手畫腳地點餐。',
    log: '外國客激增：翻桌率明顯上升。',
    desc: '海外旅客大量湧入，店裡整天聽得到各國語言。照片菜單與比手畫腳成了主要溝通方式，來客與現金收入同步成長，但外場員工會明顯變累。',
    duration: [240, 480],
    effects: { trafficMul: 1.6, cash: 25000, moodAll: 5, staffFatigue: 8 }
  },
  {
    id: 'health_boom',
    name: '健康ブーム',
    kana: 'けんこうぶーむ',
    kind: 'positive',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '雜誌做了低糖質特集，客人一坐下就先問有沒有多一點蔬菜的定食。',
    log: '健康風潮：清淡菜色大受歡迎。',
    desc: '健康風潮吹進外食市場，少油多菜的定食成為話題，連平常不來的客層也上門嚐鮮。來客穩定增加，但改用有機蔬菜與雞胸肉的進貨成本也跟著上升。',
    duration: [720, 1440],
    effects: { trafficMul: 1.35, costMul: 1.08, fame: 6 }
  },
  {
    id: 'payday_rush',
    name: '給料日',
    kana: 'きゅうりょうび',
    kind: 'positive',
    weight: 6,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['business', 'downtown', 'shopping', 'entertainment'],
    requireWeather: null,
    mitigateBy: null,
    message: '發薪日的傍晚，附近辦公室的員工一批批湧進來，說今天想吃好一點。',
    log: '發薪日人潮：客單價與來客數齊揚。',
    desc: '每月二十五號是這一帶的發薪日，錢包剛補滿的上班族特別捨得點餐，連酒水都賣得比平常好。來客與現金收入一起上升，是月內最好賺的幾天。',
    duration: [120, 300],
    effects: { trafficMul: 1.45, cash: 16000, moodAll: 7 }
  },
  {
    id: 'natsumatsuri_crowd',
    name: '夏祭り',
    kana: 'なつまつり',
    kind: 'positive',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['downtown', 'shopping', 'tourist', 'suburban', 'entertainment'],
    requireWeather: ['sunny', 'cloudy'],
    mitigateBy: null,
    message: '神社的夏祭り鼓聲響起，穿浴衣的客人沿著參道一路逛到店門口。',
    log: '夏祭り人潮：宵夜時段一位難求。',
    desc: '夏祭り的鼓聲與屋台燈籠把整條街塞得滿滿的，浴衣客與家庭客在祭典結束後擠進店裡吃宵夜。來客與現金收入同時暴增，員工得一路忙到打烊。',
    duration: [180, 360],
    effects: { trafficMul: 1.7, cash: 20000, moodAll: 8, staffFatigue: 10, dirt: 8 }
  },
  {
    id: 'nenmatsu_nenshi',
    name: '年末年始の書き入れ時',
    kana: 'ねんまつねんしのかきいれどき',
    kind: 'positive',
    weight: 5,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '年底的街道擠滿採買人潮，返鄉的家族與尾牙客把預約表填得滿滿的。',
    log: '年末年始旺季：營業額衝上年度高峰。',
    desc: '年末年始是一年裡最旺的檔期，返鄉家族、年始聚餐與觀光客同時上門。營業額大幅成長，但食材漲價與加班費也讓成本與員工疲勞一起上升。',
    duration: [300, 720],
    effects: { trafficMul: 1.6, cash: 30000, costMul: 1.1, moodAll: 6, staffFatigue: 12 }
  },
  {
    id: 'thunderstorm_brownout',
    name: '雷雨の停電',
    kana: 'らいうのていでん',
    kind: 'positive',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['storm'],
    mitigateBy: 'fridge',
    message: '落雷で街の電壓が跳ね上がり、冷蔵庫が一度止まってから、また唸り始めた。',
    log: '雷雨の停電：冷蔵庫が再起動、庫内は無事。',
    desc: '雷雨造成瞬間停電，幸好平時就備好冷藏設備（fridge），庫內溫度立刻回穩、食材幾乎沒受影響。外頭風雨太大，附近的人乾脆進店躲雨順便吃飯。',
    duration: [60, 180],
    effects: { cash: -4000, trafficMul: 1.1, moodAll: 4, staffFatigue: 5 }
  },
  {
    id: 'heat_haze',
    name: '陽炎の午後',
    kana: 'かげろうのごご',
    kind: 'positive',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['heat'],
    mitigateBy: 'ac_unit',
    message: '柏油路上浮起一層搖晃的陽炎，客人一進門就長長吐一口氣說：「得救了。」',
    log: '陽炎の午後：冷房目的の來店が増加。',
    desc: '猛暑の午後、涼を求めて人が店に逃げ込んでくる。空調（ac_unit）が効いた店内は滞在時間が伸び、追加注文も増えやすい。',
    duration: [120, 300],
    effects: { trafficMul: 1.3, cash: 9000, moodAll: 8 }
  },
  {
    id: 'snow_accumulation',
    name: '雪の積もる音',
    kana: 'ゆきのつもるおと',
    kind: 'positive',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['snow', 'sleet'],
    mitigateBy: null,
    message: '雪が音を吸い込んで、店内はしんと靜か。窓の外では子供が雪だるまをつくっている。',
    log: '雪の積もる音：靜かな店内で滯在が延びる。',
    desc: '雪が街の音を吸い込み、店内は不思議なほど靜か。客はゆっくり長居をして、溫かい汁物と甘味を追加で注文していく。ただし雪かきと足元の水拭きで外場は少し忙しくなる。',
    duration: [180, 420],
    effects: { trafficMul: 1.05, cash: 7000, moodAll: 7, dirt: 6, staffFatigue: 5 }
  },
  {
    id: 'fog_couple_found',
    name: '霧の中の一組',
    kana: 'きりのなかのひとくみ',
    kind: 'positive',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['fog'],
    mitigateBy: null,
    message: '濃霧で道に迷った一組が、暖簾の灯りを頼りに店へ入ってきた。「ここだけ光って見えた」と笑う。',
    log: '霧の中の一組：暖簾の灯りが道しるべに。',
    desc: '濃霧で先が見えない中、店の灯りだけが道しるべになって偶然の客が入ってくる。數は多くないが、溫かい料理に満足して評價がじわりと上がる。',
    duration: [120, 300],
    effects: { trafficMul: 1.1, cash: 6000, fame: 2, moodAll: 6 }
  },
  {
    id: 'inspection_followup',
    name: '衛生検査の再検査',
    kana: 'えいせいけんさのさいけんさ',
    kind: 'positive',
    weight: 3,
    minStars: 3,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: '保健所の担当者が改善確認に來て、冷藏庫の温度記録をめくりながら何度もうなずいた。',
    log: '衛生検査の再検査：前回の指摘が解除。',
    desc: '前回の指導事項をきちんと直したため、再検査はそのまま合格。冷藏設備（fridge）の管理記録が決め手になり、衛生面の信用が上がって客足も戻ってくる。',
    duration: [0, 0],
    effects: { cash: 12000, fame: 5, moodAll: 4 }
  },
  {
    id: 'tv_rerun',
    name: 'テレビ特集の再放送',
    kana: 'てれびとくしゅうのさいほうそう',
    kind: 'positive',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '去年の特集が昼下がりに再放送され、見終わったお客様がその足で店に來た。',
    log: 'テレビ特集の再放送：忘れていた客が戻る。',
    desc: '以前に取材された特集が再放送され、その番組を見た人が「そういえば」と久しぶりに暖簾をくぐる。新しい費用は一切かからない、ありがたい再曝光。',
    duration: [180, 360],
    effects: { trafficMul: 1.4, fame: 6 }
  },

  // ══════════════════════════ 負面 negative（26） ══════════════════════════
  {
    id: 'typhoon_approaching',
    name: '台風接近',
    kana: 'たいふうせっきん',
    kind: 'negative',
    weight: 6,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: 'rain',
    mitigateBy: 'security_host',
    message: '氣象預報說颱風正朝這裡直撲而來，街上的人全急著趕回家。',
    log: '颱風接近：街上空無一人。',
    desc: '颱風逼近，狂風暴雨讓整條街幾乎沒有人影，備好的食材只能報廢。雇用防災駐點人員（security_host）協助防颱，可讓損失明顯縮小。',
    duration: [180, 480],
    effects: { trafficMul: 0.4, cash: -28000, moodAll: -8, staffFatigue: 12, dirt: 18 }
  },
  {
    id: 'heavy_snow',
    name: '大雪',
    kana: 'おおゆき',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: 'snow',
    mitigateBy: null,
    message: '大雪下了一整夜，門前的積雪把客人的腳步全擋在街口。',
    log: '大雪：來客腰斬，門前積雪難清。',
    desc: '大雪把街道埋了一半，除雪趕不上降雪的速度，客人幾乎出不了門。來客數腰斬，員工還得提前到店鏟雪。',
    duration: [240, 600],
    effects: { trafficMul: 0.5, moodAll: -6, staffFatigue: 15, dirt: 10 }
  },
  {
    id: 'ingredient_price_up',
    name: '食材値上げ',
    kana: 'しょくざいねあげ',
    kind: 'negative',
    weight: 6,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: '批發市場傳來消息，蔬菜與肉類全面喊漲，供應商的電話一直打來。',
    log: '食材漲價：進貨成本上升。',
    desc: '產地歉收導致蔬菜與肉類全面漲價，供應商通知下週起調漲進貨價。妥善使用冷藏設備（fridge）降低耗損，能抵掉一部分成本壓力。',
    duration: [1440, 2880],
    effects: { costMul: 1.25, cash: -8000 }
  },
  {
    id: 'fridge_broken',
    name: '冷蔵庫故障',
    kana: 'れいぞうここしょう',
    kind: 'negative',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: '冰箱門一開就聞到不對勁的味道，裡面的食材全毀了。',
    log: '冷藏庫故障：庫存報廢。',
    desc: '冷藏庫的壓縮機突然停擺，整櫃海鮮與肉品在常溫下慢慢變質。平時備有備用冷藏設備（fridge）可即時轉移食材，大幅減少報廢。',
    duration: [0, 0],
    effects: { cash: -45000, equipBroken: 'fridge', dirt: 12 }
  },
  {
    id: 'stove_broken',
    name: 'ガスコンロ故障',
    kana: 'がすこんろこしょう',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fire_extinguisher',
    message: '快炒到一半爐火突然熄了，師傅敲了半天也點不起來。',
    log: '瓦斯爐故障：出餐速度大打折扣。',
    desc: '瓦斯爐的點火裝置燒壞，主力爐口全部停擺，出餐速度直接崩掉。廚房備有滅火器（fire_extinguisher）與檢修包時，能更快排除狀況、縮短停擺時間。',
    duration: [0, 0],
    effects: { cash: -18000, equipBroken: 'stove', moodAll: -10, trafficMul: 0.7 }
  },
  {
    id: 'power_outage',
    name: '停電',
    kana: 'ていでん',
    kind: 'negative',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '整條街啪地一聲全黑，只剩隔壁的收音機還響著。',
    log: '停電：摸黑營業，客人跑掉一半。',
    desc: '變電箱故障造成整條街停電，廚房設備全數停擺，客人摸黑結帳後陸續離開。冷藏庫溫度回升，食材也開始受到影響。',
    duration: [60, 180],
    effects: { trafficMul: 0.3, cash: -22000, moodAll: -14, dirt: 6, staffFatigue: 8 }
  },
  {
    id: 'water_main_work',
    name: '水道工事',
    kana: 'すいどうこうじ',
    kind: 'negative',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '門口的馬路被挖開一大半，自來水公司說今天白天都會停水。',
    log: '自來水工程：停水又擋路。',
    desc: '自來水管線更新工程就在店門口，白天全面停水、路面又被圍籬佔去一半。洗滌與備料都受影響，客人也難以靠近門口。',
    duration: [240, 600],
    effects: { trafficMul: 0.6, moodAll: -7, dirt: 8 }
  },
  {
    id: 'health_inspection',
    name: '衛生検査（抜き打ち）',
    kana: 'えいせいけんさぬきうち',
    kind: 'negative',
    weight: 4,
    minStars: 3,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: '衛生稽查員亮出證件走進廚房，手指沿著流理台邊緣一抹。',
    log: '衛生突擊檢查：被開立改善通知。',
    desc: '保健所的稽查員無預警上門，翻查冰箱溫度紀錄與流理台清潔。平時維持冷藏設備（fridge）的運作與環境整潔，才能把罰款與人氣損失壓到最低。',
    duration: [0, 0],
    effects: { cash: -35000, fame: -8, dirt: 10, staffFatigue: 10 }
  },
  {
    id: 'food_poisoning_rumor',
    name: '食中毒の噂',
    kana: 'しょくちゅうどくのうわさ',
    kind: 'negative',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: '社群上出現一篇貼文，說吃完你的料理之後全家都不舒服。',
    log: '食中毒傳聞：評價重挫。',
    desc: '未經查證的食中毒貼文在社群上快速擴散，客人紛紛取消訂位。嚴格管理冷藏設備（fridge）與保存期限，才能在事後提出完整的紀錄自清。',
    duration: [720, 1440],
    effects: { trafficMul: 0.5, fame: -18, cash: -30000, moodAll: -12 }
  },
  {
    id: 'construction_noise',
    name: '近隣工事の騒音',
    kana: 'きんりんこうじのそうおん',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '隔壁大樓開始打樁，震得碗盤叮噹作響，客人講話都得用喊的。',
    log: '鄰近工程噪音：客人抱怨連連。',
    desc: '隔壁大樓的拆除工程從早吵到晚，震動讓餐具互相碰撞，客人根本無法好好用餐。抱怨與苦情電話同時湧入。',
    duration: [240, 720],
    effects: { trafficMul: 0.65, moodAll: -12, staffFatigue: 8, dirt: 10 }
  },
  {
    id: 'shoplifting',
    name: '万引き',
    kana: 'まんびき',
    kind: 'negative',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: 'infrared_sensor',
    message: '監視畫面上有個身影把商品塞進外套，轉眼就消失在人群裡。',
    log: '店內遭竊：商品與現金短少。',
    desc: '趁外場忙碌時，有人把商品塞進外套帶走，收銀機的零錢也少了。加裝紅外線感測器（infrared_sensor）與監視器，能在宵小靠近儲藏區時就發出警示，把損失大幅壓低。',
    duration: [0, 0],
    effects: { cash: -26000, moodAll: -6 }
  },
  {
    id: 'rat_sighting',
    name: 'ネズミ出現',
    kana: 'ねずみしゅつげん',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: 'cctv',
    message: '一位客人尖叫著站起來，指著牆角那個快速移動的影子。',
    log: '老鼠出沒：客人觀感大受打擊。',
    desc: '牆角的黑影在桌椅間竄過，整間店瞬間安靜下來。透過監視器（cctv）找出鼠道並封堵，才能避免牠再次現身。',
    duration: [0, 0],
    effects: { cash: -18000, fame: -7, dirt: 20, moodAll: -14 }
  },
  {
    id: 'staff_absence',
    name: '従業員の急な欠勤',
    kana: 'じゅうぎょういんのきゅうなけっきん',
    kind: 'negative',
    weight: 7,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '一早接到電話：「老闆，我昨天吃壞肚子，今天真的沒辦法上班。」',
    log: '員工臨時請假：人手不足。',
    desc: '開店前十分鐘接到請假電話，外場少了一個人手，出餐與帶位全部塞車。留下的員工得扛下兩倍工作量。',
    duration: [0, 0],
    effects: { staffFatigue: 18, moodAll: -8, trafficMul: 0.85 }
  },
  {
    id: 'bad_review',
    name: '悪質な口コミ',
    kana: 'あくしつなくちこみ',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '評論網站上出現一顆星的長文，把昨天的味噌湯寫得一文不值。',
    log: '惡質負評：網路評價下滑。',
    desc: '評論網站出現措辭激烈的負評，內容與事實有出入卻已被大量轉發。人氣下滑，員工士氣也受到打擊。',
    duration: [480, 960],
    effects: { trafficMul: 0.85, fame: -9, staffFatigue: 6 }
  },
  {
    id: 'fire_alarm_false',
    name: '火災報知器の誤作動',
    kana: 'かさいほうちきのごさどう',
    kind: 'negative',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fire_system',
    message: '火災警報突然大作，店內客人全部放下筷子往門口衝。',
    log: '火災警報誤動作：緊急疏散。',
    desc: '廚房的煙霧讓火災警報器誤動作，全店緊急疏散，客人回到座位上時餐點早已冷掉。建置完整的消防系統（fire_system）可縮短復原時間。',
    duration: [0, 0],
    effects: { cash: -12000, moodAll: -10, dirt: 5, staffFatigue: 6 }
  },
  {
    id: 'pest_control',
    name: '害虫駆除の立入検査',
    kana: 'がいちゅうくじょのたちいりけんさ',
    kind: 'negative',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'cctv',
    message: '大樓管委會通知，明天上午要進廚房做全面消毒與鼠蟑檢查。',
    log: '害蟲防治檢查：清潔與消毒支出。',
    desc: '大樓管委會安排專業除蟲公司進店消毒，廚房必須全面清空，還得支付檢驗費用。平時以監視器（cctv）監控陰暗角落，可提早發現蟲鼠蹤跡。',
    duration: [0, 0],
    effects: { cash: -15000, dirt: 25, moodAll: -4 }
  },
  {
    id: 'typhoon_landfall',
    name: '台風上陸',
    kana: 'たいふうじょうりく',
    kind: 'negative',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: ['rain', 'storm'],
    mitigateBy: 'security_host',
    message: '颱風直接在附近登陸，招牌被吹得嘎嘎作響，玻璃門外什麼都看不見。',
    log: '颱風登陸：暴風雨讓街上淨空。',
    desc: '颱風挾著暴風圈在本地上陸，來客幾乎歸零，備好的食材只能報廢，店裡還得忙著處理漏水的汙漬。簽約的防災警備系統（security_host）能協助加固門窗、搬移設備，把損失壓到最低。',
    duration: [300, 720],
    effects: { trafficMul: 0.25, cash: -60000, moodAll: -16, staffFatigue: 20, dirt: 26 }
  },
  {
    id: 'blizzard',
    name: '吹雪',
    kana: 'ふぶき',
    kind: 'negative',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['snow', 'sleet'],
    mitigateBy: 'security_host',
    message: '風雪把整條街吹成一片白，連門口的暖簾都結上了一層冰。',
    log: '暴風雪：交通中斷，來客凍結。',
    desc: '暴風雪讓視線幾乎為零，客人不敢出門，食材配送也全面延誤。員工得頂著風雪提早到店除雪、替水管與設備防凍。防災警備系統（security_host）能協助除雪與防凍，減少停擺時間。',
    duration: [240, 600],
    effects: { trafficMul: 0.35, cash: -18000, moodAll: -12, staffFatigue: 18, dirt: 14 }
  },
  {
    id: 'heat_wave',
    name: '猛暑日',
    kana: 'もうしょび',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['heat'],
    mitigateBy: 'fridge',
    message: '氣溫飆破三十八度，柏油路都在冒煙，廚房裡像烤箱一樣。',
    log: '猛暑日：食慾下降、食材耗損加快。',
    desc: '連日猛暑讓客人食慾大減、只想點冷食，廚房溫度飆高，生鮮食材的耗損也明顯加快。妥善使用冷藏設備（fridge）控溫，能減少報廢與隨之而來的客訴。',
    duration: [300, 720],
    effects: { trafficMul: 0.8, costMul: 1.12, cash: -10000, moodAll: -10, staffFatigue: 15 }
  },
  {
    id: 'long_rain',
    name: '長雨',
    kana: 'ながあめ',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: ['rain'],
    mitigateBy: 'fridge',
    message: '雨已經下了整整一週，門口的傘架積滿了水，客人明顯少了一截。',
    log: '連日長雨：客足持續低迷。',
    desc: '雨季的長雨一連下了好幾天，外出用餐的人變少，濕氣也讓乾貨與麵粉容易受潮變質。來客下滑、保存耗損增加，只能靠外帶訂單撐住營收；善用冷藏設備（fridge）管理庫存可減少報廢。',
    duration: [1440, 4320],
    effects: { trafficMul: 0.7, costMul: 1.1, moodAll: -8, dirt: 12 }
  },
  {
    id: 'dense_fog',
    name: '濃霧',
    kana: 'のうむ',
    kind: 'negative',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['fog'],
    mitigateBy: null,
    message: '濃霧把街景吞掉一半，招牌燈在霧裡暈成一團光，客人說差點找不到店。',
    log: '濃霧：能見度差，來客與配送受阻。',
    desc: '濃霧讓能見度降到幾十公尺，開車的客人不敢上路，食材配送也遲到。門口的招牌幾乎看不見，來客數下滑，遲到的員工還得摸黑趕路。',
    duration: [120, 360],
    effects: { trafficMul: 0.7, cash: -6000, moodAll: -6, staffFatigue: 6 }
  },
  {
    id: 'food_origin_fraud',
    name: '産地偽装の報道',
    kana: 'さんちぎそうのほうどう',
    kind: 'negative',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '晚間新聞踢爆供應商偽造產地標示，你昨天才進的那批貨正好在名單上。',
    log: '產地偽裝報導：菜單信任度動搖。',
    desc: '供應商把進口貨標成國產高級食材，新聞一報就燒到用貨的店家。客人開始逐道追問產地，人氣與現金收入一起下滑，得靠公開進貨來源慢慢重建信任。',
    duration: [720, 1440],
    effects: { trafficMul: 0.6, fame: -14, cash: -25000, moodAll: -10, staffFatigue: 8 }
  },
  {
    id: 'kitchen_equipment_recall',
    name: '厨房機器のリコール',
    kana: 'ちゅうぼうききのりこーる',
    kind: 'negative',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fire_extinguisher',
    message: '廠商寄來一封掛號信，說你主力爐具的型號有安全疑慮，必須立刻停用。',
    log: '廚房機器召回：設備停用與檢修支出。',
    desc: '製造商公告爐具型號有起火疑慮，要求全面停用並等待料件更換。主力爐口停擺、出餐速度大降，還得支付臨時檢修費。平時備妥滅火器（fire_extinguisher）與檢修包，能縮短停擺時間。',
    duration: [180, 480],
    effects: { cash: -40000, equipBroken: 'stove', trafficMul: 0.8, moodAll: -8, staffFatigue: 8 }
  },
  {
    id: 'water_pipe_burst',
    name: '水道管の破裂',
    kana: 'すいどうかんのはれつ',
    kind: 'negative',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: ['snow', 'sleet'],
    mitigateBy: null,
    message: '寒流把地下的老舊水管凍裂了，水從店門口的地面不斷湧出來。',
    log: '水管凍裂：停水、廚房淹水。',
    desc: '嚴寒讓埋在地下的老舊水管凍裂，水柱從門口湧出，廚房被迫停水、地板一片狼藉。修繕費與清理時間都跑不掉，還得臨時買水應急才能繼續出餐。',
    duration: [180, 480],
    effects: { cash: -38000, trafficMul: 0.5, moodAll: -10, dirt: 22, staffFatigue: 12 }
  },
  {
    id: 'long_rain_logistics',
    name: '長雨の仕入れ遅延',
    kana: 'ながあめのしいれちえん',
    kind: 'negative',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: ['rain'],
    mitigateBy: 'fridge',
    message: '雨で高速道路が止まり、朝に届くはずの魚がまだ來ない。冷蔵ケースは半分空いたままだ。',
    log: '長雨の仕入れ遅延：配送が滯り、献立が縮む。',
    desc: '長雨で物流網が滯り、生鮮の配送が丸一日遅れる。定番の料理が作れず、代わりの食材は割高になる。冷藏設備（fridge）で在庫を上手に回せば、欠品と廃棄の両方を抑えられる。',
    duration: [720, 1440],
    effects: { trafficMul: 0.85, costMul: 1.12, moodAll: -6 }
  },
  {
    id: 'washroom_pipe_clog',
    name: 'トイレの詰まり',
    kana: 'といれのつまり',
    kind: 'negative',
    weight: 5,
    minStars: 1,
    maxStars: 3,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: 'トイレから異音がして、水がまったく流れなくなった。外の業者を呼ぶしかない。',
    log: 'トイレ詰まり：配管修理と悪臭で客足に影響。',
    desc: '古い配管に汚れが溜まり、お手洗いが完全に詰まってしまう。修理業者を呼ぶ間は使えない上に臭いが広がり、客の苦情と掃除の手間が同時に増える。',
    duration: [120, 360],
    effects: { cash: -24000, fame: -4, dirt: 26, moodAll: -10, staffFatigue: 10 }
  },

  // ══════════════════════════ 中性 neutral（12） ══════════════════════════
  {
    id: 'shotengai_cleanup',
    name: '商店街の清掃活動',
    kana: 'しょうてんがいのせいそうかつどう',
    kind: 'neutral',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: ['shopping', 'downtown', 'suburban', 'market'],
    requireWeather: null,
    mitigateBy: null,
    message: '商店街舉辦聯合清掃，店門前的地磚被刷得發亮。',
    log: '商店街清掃活動：環境變乾淨。',
    desc: '商店街的聯合清掃活動讓門前廣場煥然一新，但員工也得出人幫忙打掃。店內外都乾淨了，午餐時段的來客稍微增加。',
    duration: [0, 0],
    effects: { dirt: -15, cash: -5000, moodAll: 4 }
  },
  {
    id: 'matsuri_road_closed',
    name: '祭りの準備で通行止め',
    kana: 'まつりのじゅんびでつうこうどめ',
    kind: 'neutral',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['shopping', 'downtown', 'tourist', 'suburban'],
    requireWeather: null,
    mitigateBy: null,
    message: '祭典的山車停在街口，大會人員開始架起交通錐管制通行。',
    log: '祭典準備交通管制：動線改變。',
    desc: '祭典準備期間，商店街部分路段封閉，客人得繞路才能到店。等祭典正式開始時，人潮又會回頭補上。',
    duration: [120, 360],
    effects: { trafficMul: 0.85, dirt: 6 }
  },
  {
    id: 'community_circular',
    name: '地域の回覧板',
    kana: 'ちいきのかいらんばん',
    kind: 'neutral',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: ['onsen', 'suburban', 'shopping'],
    requireWeather: null,
    mitigateBy: null,
    message: '鄰居送來回覧板，上頭夾著一張溫泉旅館與商店街的聯合會議通知單。',
    log: '收到回覧板：鄰里關係變化。',
    desc: '回覧板輪到你這戶，裡面除了會議通知，還附上商店街的活動問卷。撥點時間回覆，能換來鄰里的好感。',
    duration: [0, 0],
    effects: { fame: 3, staffFatigue: 2 }
  },
  {
    id: 'weather_clears',
    name: '天候回復',
    kana: 'てんこうかいふく',
    kind: 'neutral',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: 'rain',
    mitigateBy: null,
    message: '連日的雨終於停了，雲縫間透出光，外頭的人一下子多了起來。',
    log: '天氣轉晴：外出人潮回流。',
    desc: '下了好幾天的雨終於停歇，憋壞的人們紛紛出門。來客數小幅回升，員工的心情也跟著輕鬆些。',
    duration: [120, 300],
    effects: { trafficMul: 1.15, moodAll: 3 }
  },
  {
    id: 'supplier_change',
    name: '仕入れ業者の変更',
    kana: 'しいれぎょうしゃのへんこう',
    kind: 'neutral',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '新的批發商上門遞名片，說同樣的貨可以再便宜一點，但得整箱叫。',
    log: '更換進貨業者：成本結構變動。',
    desc: '新的批發商提出更低的單價，條件是必須整箱進貨。短期成本下降，但保存與耗損的壓力也跟著增加。',
    duration: [1440, 2880],
    effects: { costMul: 0.92, dirt: 3 }
  },
  {
    id: 'tv_shoot_interrupt',
    name: 'テレビ番組のロケ中断',
    kana: 'てれびばんぐみのろけちゅうだん',
    kind: 'neutral',
    weight: 2,
    minStars: 3,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: ['downtown', 'tourist', 'shopping', 'entertainment'],
    requireWeather: null,
    mitigateBy: null,
    message: '綜藝節目的外景隊借用門口拍攝，剛好把想進門的客人擋在鏡頭外。',
    log: '綜藝節目外景：動線受阻。',
    desc: '綜藝節目的外景隊借了門口的街道拍攝，圍觀人潮擋住入口動線。雖然拿到了些許場地費，但真正進門用餐的客人變少了。',
    duration: [60, 180],
    effects: { cash: 6000, trafficMul: 0.85, moodAll: -3 }
  },
  {
    id: 'hatsuyuki',
    name: '初雪',
    kana: 'はつゆき',
    kind: 'neutral',
    weight: 4,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: ['snow', 'sleet'],
    mitigateBy: null,
    message: '今年第一片雪落在門口的暖簾上，客人進門時都忍不住回頭多看一眼。',
    log: '今年初雪：窗邊座位特別受歡迎。',
    desc: '今年的初雪無聲地落下，靠窗的座位忽然成了最搶手的位置，客人邊吃邊看雪。來客數變化不大，但店裡的氣氛明顯柔和了些，地板也得多拖幾次。',
    duration: [120, 360],
    effects: { moodAll: 5, trafficMul: 1.05, dirt: 6, staffFatigue: 3 }
  },
  {
    id: 'peer_inspection',
    name: '同業者の視察',
    kana: 'どうぎょうしゃのしさつ',
    kind: 'neutral',
    weight: 3,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: true,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '隔壁町的老闆帶著筆記本上門，從菜單一路問到廚房的動線。',
    log: '同業視察：員工緊張、口碑微升。',
    desc: '同業的老闆特地來店視察，坐在角落一頁頁抄著菜單與價格，還要求參觀廚房。員工被看得渾身不自在，但對方事後在商圈聚會上替你說了幾句好話。',
    duration: [60, 180],
    effects: { moodAll: -4, staffFatigue: 6, fame: 2 }
  },
  {
    id: 'celebrity_rumor',
    name: '有名人が來るらしい',
    kana: 'ゆうめいじんがくるらしい',
    kind: 'neutral',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '社群上瘋傳「那位人氣甜點師好像常去某間店」，客人一進門就先四處張望。',
    log: '名人來店傳聞：客人好奇上門，卻沒等到本人。',
    desc: '網路上出現「有名人常來這家店」的傳聞，好奇的客人一批批上門張望，真正的那位卻始終沒有出現。來客與營業額小幅上升，員工則被問了一整天「他今天會來嗎」。',
    duration: [180, 480],
    effects: { trafficMul: 1.25, cash: 5000, moodAll: -3, staffFatigue: 6 }
  },
  {
    id: 'staff_training',
    name: '本社スタッフの接客研修',
    kana: 'ほんしゃすたっふのせっきゃくけんしゅう',
    kind: 'neutral',
    weight: 4,
    minStars: 2,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '本社から指導員が來て、お辭儀の角度から盆の持ち方まで全員やり直しになった。',
    log: '接客研修：手が止まるが、動きが揃う。',
    desc: '本社派來的指導員替全體員工做了一整天的接客研修，從鞠躬角度到端盤手勢全部重來。研修期間出餐明顯變慢，但員工的動作變齊、疲勞也比較不容易堆積。',
    duration: [180, 360],
    effects: { cash: -12000, staffFatigue: -10, moodAll: 3 }
  },
  {
    id: 'supplier_special',
    name: '仕入れ業者の特価品',
    kana: 'しいれぎょうしゃのとっかひん',
    kind: 'neutral',
    weight: 5,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: 'fridge',
    message: 'いつもの業者が「產地直送の余り物だけど」と、箱を一つ格安で置いていった。',
    log: '仕入れ特価品：原價下降，但得自己想辦法用完。',
    desc: '批發商把產地直送的餘貨便宜讓給你，進貨成本立刻下降。但數量不少、保存期限又短，得靠廚房的創意菜單跟冷藏設備（fridge）一起消化，否則只是換個方式報廢。',
    duration: [720, 1440],
    effects: { costMul: 0.9, dirt: 4, staffFatigue: 4 }
  },
  {
    id: 'washroom_renewal_plan',
    name: 'お手洗い改修の噂',
    kana: 'おてあらいかいしゅうのうわさ',
    kind: 'neutral',
    weight: 3,
    minStars: 1,
    maxStars: 5,
    onlyWhileOpen: false,
    locations: null,
    requireWeather: null,
    mitigateBy: null,
    message: '常連客が「お手洗い、ちょっと直したら？」と笑いながら耳打ちしていった。',
    log: 'お手洗い改修の噂：常連が工事を勧めてくる。',
    desc: '常客半開玩笑地提起お手洗い的狀況，話題就這樣在熟客之間傳開。改修工事期間客人會少一點、費用也跑不掉，但把お手洗い整理好，之後的清潔與評價都會跟著改善。',
    duration: [120, 360],
    effects: { trafficMul: 0.8, cash: -20000, dirt: 15, moodAll: -2 }
  }
];

/**
 * 以 id 取得單一事件。
 * @param {string} id 事件 id（蛇形命名）
 * @returns {object|undefined} 找到的事件，找不到時為 undefined
 */
export function eventById(id) {
  if (typeof id !== 'string') return undefined;
  for (let i = 0; i < EVENTS.length; i += 1) {
    if (EVENTS[i].id === id) return EVENTS[i];
  }
  return undefined;
}

/**
 * 判斷天氣條件是否成立。
 * requireWeather 可為 null（不限天氣）、單一天氣字串（原有用法），
 * 或天氣字串陣列（擴充用法，命中任一成員即可）。
 * @param {null|string|string[]} required 事件的天氣條件
 * @param {string} weather 目前天氣
 * @returns {boolean} 是否符合
 */
function weatherMatches(required, weather) {
  if (required === null || required === undefined) return true;
  if (Array.isArray(required)) return required.indexOf(weather) !== -1;
  return required === weather;
}

/**
 * 依當下遊戲狀態抽出一個突發事件。
 *
 * 篩選條件：
 *   stars        : minStars <= stars <= maxStars
 *   minute       : onlyWhileOpen 的事件僅在 660..1320（11:00-22:00）內出現
 *   weather      : 事件有 requireWeather 時必須相符；
 *                   requireWeather 為陣列時，天氣只要命中任一成員即可
 *   locationKind : 事件有 locations 時必須包含此地點種類
 *   exclude      : 排除清單中的 id
 *
 * 同一組 rng 序列必定得到相同結果（決定性）。
 *
 * @param {object} [state] 遊戲狀態
 * @param {number} [state.stars] 目前星級
 * @param {string} [state.locationKind] 目前店址的種類
 * @param {string} [state.weather] 目前天氣
 * @param {number} [state.minute] 目前時刻（分鐘，0..1439）
 * @param {function} [state.rng] 亂數函式，預設 Math.random
 * @param {string[]} [state.exclude] 要排除的事件 id 陣列
 * @returns {object|null} 命中的事件，無符合者為 null
 */
export function rollEvent(state) {
  const options = state || {};
  const stars = typeof options.stars === 'number' ? options.stars : 1;
  const locationKind = typeof options.locationKind === 'string' ? options.locationKind : '';
  const weather = typeof options.weather === 'string' ? options.weather : 'sunny';
  const minute = typeof options.minute === 'number' ? options.minute : 720;
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const exclude = Array.isArray(options.exclude) ? options.exclude : [];

  const pool = EVENTS.filter((event) => (
    stars >= event.minStars &&
    stars <= event.maxStars &&
    !(event.onlyWhileOpen && (minute < 660 || minute > 1320)) &&
    weatherMatches(event.requireWeather, weather) &&
    (event.locations === null || event.locations.indexOf(locationKind) !== -1) &&
    exclude.indexOf(event.id) === -1
  ));

  if (pool.length === 0) return null;

  let total = 0;
  for (let i = 0; i < pool.length; i += 1) total += pool[i].weight;

  let needle = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    needle -= pool[i].weight;
    if (needle < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export default EVENTS;
