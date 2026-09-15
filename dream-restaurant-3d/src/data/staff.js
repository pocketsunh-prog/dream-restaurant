/**
 * staff.js — 員工名簿資料表（Staff Master Data）
 *
 * 本檔案為《夢幻餐廳 3D》的人事主資料，提供 44 位日本在地員工：
 * 24 位ホール（外場／waiter）與 20 位料理人（內場／chef）。
 * 招募流程：玩家在 stars 解鎖後，由 candidatesFor() 取得當日面試名單，
 * 付 hireCost 簽約金後以 wage（時給，日圓）聘用，之後每日結算人事成本。
 *
 * 欄位契約（每個 entry 必有且僅有這些欄位，名稱與型別固定）：
 *   id          : string   蛇形命名、純 ASCII、全表唯一；外場 'w_' 開頭、廚師 'c_' 開頭
 *   name        : string   日文姓名，「姓 名」中間一個半角空白
 *   kana        : string   ひらがな讀音，須與 name 對應
 *   role        : string   'waiter' | 'chef'
 *   age         : number   18..58
 *   gender      : string   'f' | 'm'
 *   speed       : number   35..96，走動／作業速度（出餐與收桌的節奏）
 *   skill       : number   30..96，手藝；廚師→料理品質，外場→應對失誤率
 *   stamina     : number   30..96，疲勞累積越慢越高
 *   wage        : number   時給（日圓）900..3200
 *   hireCost    : number   簽約金（日圓）= Math.round(wage * 2 / 100) * 100
 *   stars       : number   1..5，需達此星級才會出現在招募名單
 *   specialty   : string   廚師取 DISH_CATEGORIES 之一；外場取 SERVICE_SPECIALTIES 之一
 *   personality : string   PERSONALITIES 之一
 *   traits      : string[] 2..3 個短日文特質標籤
 *   desc        : string   1..2 句繁體中文簡介（帶一點幽默感的履歷口吻）
 *   appearance  : object   { kind, seed, height } 供 3D 角色產生器使用
 *                          kind 必與 role 一致；seed 為整數，決定髮型／配件／長相；
 *                          height 為 1.52..1.88 公尺
 *
 * 平衡原則：
 *   - hireCost 一律等於 round(wage * 2 / 100) * 100（此表 wage 皆為 50 的倍數，
 *     故 hireCost 恰為兩倍時給）。
 *   - stars 越高 → skill／wage 越高：★1 平均時給約 1175、★5 約 2838；
 *     同一星級內廚師平均時給略高於外場（廚房技術溢價）。
 *   - 每個星級內刻意拉開 speed／skill／stamina 的組合，讓玩家真的需要取捨；
 *     全表 (role, speed, skill, stamina) 四元組不得重複。
 *   - stamina 隨年齡下滑：25 歲以下 70..96、26-40 歲 55..88、41 歲以上 35..70。
 *   - 10 種料理類別與 5 種外場專長皆有員工覆蓋。
 *
 * 所有姓名皆為虛構，與真實人物無關。本檔案無任何 import、無副作用，
 * 僅匯出資料與查詢函式。
 */

/** 全體員工名簿，依 role 分組、組內依 stars 由低到高排列。 */
export const STAFF_POOL = [
  // ────────────────────────────── ホール／外場 waiter（24） ──────────────────────────────
  // ── ★1 ───────────────────────────────────────────────────────────────
  {
    id: 'w_sato_yuki',
    name: '佐藤 結衣',
    kana: 'さとう ゆい',
    role: 'waiter',
    age: 22,
    gender: 'f',
    speed: 78,
    skill: 82,
    stamina: 71,
    wage: 1250,
    hireCost: 2500,
    stars: 1,
    specialty: 'hall',
    personality: 'rookie',
    traits: ['新人', '笑顔', 'うっかり'],
    desc: '短大畢業後的第一份工作，還在努力記住完整菜單。被客人大聲一點就會連續鞠躬三次。',
    appearance: { kind: 'waiter', seed: 48213, height: 1.6 },
  },
  {
    id: 'w_tanaka_haruto',
    name: '田中 陽翔',
    kana: 'たなか はると',
    role: 'waiter',
    age: 19,
    gender: 'm',
    speed: 92,
    skill: 44,
    stamina: 90,
    wage: 1000,
    hireCost: 2000,
    stars: 1,
    specialty: 'kitchen_run',
    personality: 'hotblooded',
    traits: ['早い', '元気', 'そそっかしい'],
    desc: '跑得比店裡的送餐推車還快，只是端來的味噌湯常常只剩七分滿。他自己覺得這樣比較不容易灑。',
    appearance: { kind: 'waiter', seed: 13097, height: 1.76 },
  },
  {
    id: 'w_suzuki_mei',
    name: '鈴木 芽依',
    kana: 'すずき めい',
    role: 'waiter',
    age: 20,
    gender: 'f',
    speed: 44,
    skill: 86,
    stamina: 84,
    wage: 1300,
    hireCost: 2600,
    stars: 1,
    specialty: 'register',
    personality: 'quiet',
    traits: ['無口', '几帳面', 'レジ早い'],
    desc: '講話小聲到客人得往前傾才聽得見，但收銀從沒錯過一塊錢，結帳速度還是同期第一。',
    appearance: { kind: 'waiter', seed: 27654, height: 1.57 },
  },
  {
    id: 'w_takahashi_kaito',
    name: '高橋 海斗',
    kana: 'たかはし かいと',
    role: 'waiter',
    age: 24,
    gender: 'm',
    speed: 66,
    skill: 55,
    stamina: 88,
    wage: 950,
    hireCost: 1900,
    stars: 1,
    specialty: 'cleaning',
    personality: 'lazy',
    traits: ['マイペース', '省エネ'],
    desc: '自稱「省能源達人」，擦一張桌子要花三分鐘，理由是慢慢擦才真的擦得乾淨。',
    appearance: { kind: 'waiter', seed: 33871, height: 1.71 },
  },
  {
    id: 'w_watanabe_aoi',
    name: '渡辺 葵',
    kana: 'わたなべ あおい',
    role: 'waiter',
    age: 27,
    gender: 'f',
    speed: 62,
    skill: 63,
    stamina: 66,
    wage: 1150,
    hireCost: 2300,
    stars: 1,
    specialty: 'host',
    personality: 'friendly',
    traits: ['愛想良し', '記憶力', '方向音痴'],
    desc: '記得住三百位常客的臉和忌口，卻始終記不住自己這週排哪個班。',
    appearance: { kind: 'waiter', seed: 51240, height: 1.63 },
  },
  {
    id: 'w_yamaguchi_chihiro',
    name: '山口 千尋',
    kana: 'やまぐち ちひろ',
    role: 'waiter',
    age: 21,
    gender: 'f',
    speed: 71,
    skill: 58,
    stamina: 87,
    wage: 1100,
    hireCost: 2200,
    stars: 1,
    specialty: 'kitchen_run',
    personality: 'rookie',
    traits: ['新人', 'メモ魔', '素直'],
    desc: '入店才兩週，端托盤時碗盤還是會互相打招呼。不過她把客人的每一句抱怨都抄進筆記本，據說已經寫到第三冊。',
    appearance: { kind: 'waiter', seed: 61027, height: 1.58 },
  },

  // ── ★2 ───────────────────────────────────────────────────────────────
  {
    id: 'w_ito_ren',
    name: '伊藤 蓮',
    kana: 'いとう れん',
    role: 'waiter',
    age: 23,
    gender: 'm',
    speed: 88,
    skill: 62,
    stamina: 80,
    wage: 1400,
    hireCost: 2800,
    stars: 2,
    specialty: 'kitchen_run',
    personality: 'steady',
    traits: ['段取り', '力持ち', '無遅刻'],
    desc: '高中打過排球，一次端四盤也不會晃。廚房出什麼菜他一律先喊一聲，前後場都安心。',
    appearance: { kind: 'waiter', seed: 18866, height: 1.74 },
  },
  {
    id: 'w_yamamoto_hina',
    name: '山本 陽菜',
    kana: 'やまもと ひな',
    role: 'waiter',
    age: 25,
    gender: 'f',
    speed: 60,
    skill: 90,
    stamina: 76,
    wage: 1650,
    hireCost: 3300,
    stars: 2,
    specialty: 'register',
    personality: 'perfectionist',
    traits: ['丁寧', '数字に強い', 'こだわり'],
    desc: '帳目對不上寧願留下來重算，讓客人多等兩分鐘她會先送上一杯茶道歉。',
    appearance: { kind: 'waiter', seed: 40319, height: 1.59 },
  },
  {
    id: 'w_nakamura_daiki',
    name: '中村 大輝',
    kana: 'なかむら だいき',
    role: 'waiter',
    age: 30,
    gender: 'm',
    speed: 74,
    skill: 70,
    stamina: 72,
    wage: 1500,
    hireCost: 3000,
    stars: 2,
    specialty: 'hall',
    personality: 'friendly',
    traits: ['落ち着き', '教え上手', '聞き上手'],
    desc: '在家庭餐廳待過四年，什麼樣的客人都能聊上兩句，連奧客都會被他講到笑出來。',
    appearance: { kind: 'waiter', seed: 25078, height: 1.78 },
  },
  {
    id: 'w_kobayashi_rin',
    name: '小林 凛',
    kana: 'こばやし りん',
    role: 'waiter',
    age: 21,
    gender: 'f',
    speed: 82,
    skill: 76,
    stamina: 92,
    wage: 1550,
    hireCost: 3100,
    stars: 2,
    specialty: 'cleaning',
    personality: 'hotblooded',
    traits: ['体力', '負けず嫌い', '早起き'],
    desc: '體育系出身，收店時一個人可以扛三桶水，口頭禪是「再來一輪」。',
    appearance: { kind: 'waiter', seed: 36442, height: 1.55 },
  },
  {
    id: 'w_ikeda_minato',
    name: '池田 湊',
    kana: 'いけだ みなと',
    role: 'waiter',
    age: 29,
    gender: 'm',
    speed: 76,
    skill: 74,
    stamina: 72,
    wage: 1600,
    hireCost: 3200,
    stars: 2,
    specialty: 'hall',
    personality: 'steady',
    traits: ['真面目', '段取り', '力持ち'],
    desc: '前居酒屋店長，收桌、點餐、勸架三件事都很擅長。他說外場靠的是眼睛不是腳，只是他的腳也從來沒慢過。',
    appearance: { kind: 'waiter', seed: 58134, height: 1.75 },
  },

  // ── ★3 ───────────────────────────────────────────────────────────────
  {
    id: 'w_kato_sora',
    name: '加藤 空',
    kana: 'かとう そら',
    role: 'waiter',
    age: 26,
    gender: 'm',
    speed: 94,
    skill: 68,
    stamina: 74,
    wage: 1750,
    hireCost: 3500,
    stars: 3,
    specialty: 'kitchen_run',
    personality: 'hotblooded',
    traits: ['俊足', '皿洗い早い', 'せっかち'],
    desc: '出菜速度全店第一，從廚房走到最遠那桌只要九秒，代價是偶爾會撞到門框。',
    appearance: { kind: 'waiter', seed: 5917, height: 1.8 },
  },
  {
    id: 'w_yoshida_sakura',
    name: '吉田 さくら',
    kana: 'よしだ さくら',
    role: 'waiter',
    age: 34,
    gender: 'f',
    speed: 58,
    skill: 93,
    stamina: 70,
    wage: 2050,
    hireCost: 4100,
    stars: 3,
    specialty: 'host',
    personality: 'veteran',
    traits: ['ベテラン', '交渉上手', '褒め上手'],
    desc: '外場十年資歷，客人一皺眉她就知道是湯太鹹還是冷氣太冷，連客訴都能處理成常客。',
    appearance: { kind: 'waiter', seed: 44905, height: 1.62 },
  },
  {
    id: 'w_yamada_yuto',
    name: '山田 悠斗',
    kana: 'やまだ ゆうと',
    role: 'waiter',
    age: 28,
    gender: 'm',
    speed: 70,
    skill: 80,
    stamina: 86,
    wage: 1850,
    hireCost: 3700,
    stars: 3,
    specialty: 'hall',
    personality: 'steady',
    traits: ['手際', '忍耐', '無遅刻'],
    desc: '話不多，但每一桌的順序、誰先上菜誰後結帳，他心裡有一張看不見的表。',
    appearance: { kind: 'waiter', seed: 22037, height: 1.73 },
  },
  {
    id: 'w_sasaki_nanami',
    name: '佐々木 七海',
    kana: 'ささき ななみ',
    role: 'waiter',
    age: 24,
    gender: 'f',
    speed: 76,
    skill: 63,
    stamina: 90,
    wage: 1700,
    hireCost: 3400,
    stars: 3,
    specialty: 'cleaning',
    personality: 'friendly',
    traits: ['笑顔', '体力', '朝型'],
    desc: '從早班做到打烊都不會累，笑容也一直維持在同一個角度，同事懷疑她是機器人。',
    appearance: { kind: 'waiter', seed: 30784, height: 1.66 },
  },
  {
    id: 'w_mori_chinatsu',
    name: '森 ちなつ',
    kana: 'もり ちなつ',
    role: 'waiter',
    age: 25,
    gender: 'f',
    speed: 84,
    skill: 80,
    stamina: 78,
    wage: 1900,
    hireCost: 3800,
    stars: 3,
    specialty: 'register',
    personality: 'perfectionist',
    traits: ['数字に強い', '丁寧', '早起き'],
    desc: '能在三秒內算出七桌的總金額，卻算不出自己這個月又買了幾件衣服。找錯錢的機率是零，店長因此很放心把收銀台交給她。',
    appearance: { kind: 'waiter', seed: 12745, height: 1.6 },
  },
  {
    id: 'w_hashimoto_soma',
    name: '橋本 蒼真',
    kana: 'はしもと そうま',
    role: 'waiter',
    age: 33,
    gender: 'm',
    speed: 88,
    skill: 69,
    stamina: 63,
    wage: 2000,
    hireCost: 4000,
    stars: 3,
    specialty: 'cleaning',
    personality: 'hotblooded',
    traits: ['体力', '潔癖', '負けず嫌い'],
    desc: '看到桌上一粒米就會衝過去，據說他家的地板可以照出人影。同事一致同意：絕對不要讓他碰到醬油瓶，那會讓他失眠。',
    appearance: { kind: 'waiter', seed: 39082, height: 1.83 },
  },

  // ── ★4 ───────────────────────────────────────────────────────────────
  {
    id: 'w_matsumoto_kaede',
    name: '松本 楓',
    kana: 'まつもと かえで',
    role: 'waiter',
    age: 31,
    gender: 'f',
    speed: 90,
    skill: 80,
    stamina: 78,
    wage: 2250,
    hireCost: 4500,
    stars: 4,
    specialty: 'register',
    personality: 'perfectionist',
    traits: ['正確', '丁寧', 'こだわり'],
    desc: '收銀五年零失誤，連折扣券的有效期限都背得出來，她排的那條隊伍永遠最短。',
    appearance: { kind: 'waiter', seed: 15620, height: 1.68 },
  },
  {
    id: 'w_inoue_ryota',
    name: '井上 涼太',
    kana: 'いのうえ りょうた',
    role: 'waiter',
    age: 38,
    gender: 'm',
    speed: 54,
    skill: 95,
    stamina: 62,
    wage: 2500,
    hireCost: 5000,
    stars: 4,
    specialty: 'host',
    personality: 'greedy',
    traits: ['ベテラン', '押し強い', '数字に強い'],
    desc: '五星飯店出身，最擅長把等待時間講成「為您保留的專屬時段」，加價套餐賣得比誰都好。',
    appearance: { kind: 'waiter', seed: 47311, height: 1.82 },
  },
  {
    id: 'w_kimura_yui',
    name: '木村 結',
    kana: 'きむら ゆい',
    role: 'waiter',
    age: 29,
    gender: 'f',
    speed: 72,
    skill: 86,
    stamina: 82,
    wage: 2100,
    hireCost: 4200,
    stars: 4,
    specialty: 'hall',
    personality: 'friendly',
    traits: ['気配り', '記憶力', 'おっとり'],
    desc: '客人的名字、小孩的年級、上次點了什麼，她全記得，回頭客多半是為了她來的。',
    appearance: { kind: 'waiter', seed: 26195, height: 1.58 },
  },
  {
    id: 'w_miura_sanae',
    name: '三浦 早苗',
    kana: 'みうら さなえ',
    role: 'waiter',
    age: 37,
    gender: 'f',
    speed: 79,
    skill: 88,
    stamina: 60,
    wage: 2400,
    hireCost: 4800,
    stars: 4,
    specialty: 'host',
    personality: 'veteran',
    traits: ['ベテラン', '気配り', '聞き上手'],
    desc: '外場十五年，能從客人的坐姿判斷今天該多送一碟小菜還是少講兩句話。她帶過的後輩，後來有一半當上了店長。',
    appearance: { kind: 'waiter', seed: 46219, height: 1.64 },
  },

  // ── ★5 ───────────────────────────────────────────────────────────────
  {
    id: 'w_hayashi_misaki',
    name: '林 美咲',
    kana: 'はやし みさき',
    role: 'waiter',
    age: 36,
    gender: 'f',
    speed: 86,
    skill: 96,
    stamina: 74,
    wage: 2900,
    hireCost: 5800,
    stars: 5,
    specialty: 'host',
    personality: 'veteran',
    traits: ['外場の鬼', '一匹狼', '品質重視'],
    desc: '曾任飯店宴會廳經理，一站在門口全場節奏就自動上軌道。據說她一眼就能看出這桌會不會給小費。',
    appearance: { kind: 'waiter', seed: 38906, height: 1.7 },
  },
  {
    id: 'w_shimizu_kenta',
    name: '清水 健太',
    kana: 'しみず けんた',
    role: 'waiter',
    age: 42,
    gender: 'm',
    speed: 62,
    skill: 92,
    stamina: 58,
    wage: 2550,
    hireCost: 5100,
    stars: 5,
    specialty: 'hall',
    personality: 'perfectionist',
    traits: ['ベテラン', '目配り', '頑固'],
    desc: '外場二十年，客人手一抬他就知道是要加水還是要結帳。對他來說，服務是一種肌肉記憶。',
    appearance: { kind: 'waiter', seed: 10933, height: 1.75 },
  },
  {
    id: 'w_hirano_toru',
    name: '平野 徹',
    kana: 'ひらの とおる',
    role: 'waiter',
    age: 43,
    gender: 'm',
    speed: 86,
    skill: 91,
    stamina: 52,
    wage: 2800,
    hireCost: 5600,
    stars: 5,
    specialty: 'hall',
    personality: 'greedy',
    traits: ['売上重視', '押し強い', '頑固'],
    desc: '他最經典的一句是「為您留了最後一桌」——店裡明明還有十桌空著。客人抱怨他太會推銷，卻又年年指定要他服務。',
    appearance: { kind: 'waiter', seed: 20863, height: 1.79 },
  },

  // ────────────────────────────── 料理人／廚師 chef（20） ──────────────────────────────
  // ── ★1 ───────────────────────────────────────────────────────────────
  {
    id: 'c_ono_kenta',
    name: '小野 健太',
    kana: 'おの けんた',
    role: 'chef',
    age: 20,
    gender: 'm',
    speed: 90,
    skill: 50,
    stamina: 86,
    wage: 1150,
    hireCost: 2300,
    stars: 1,
    specialty: 'fried',
    personality: 'hotblooded',
    traits: ['早い', '火加減', '熱血'],
    desc: '油溫全靠手背試，炸東西沒失敗過，只是燙傷貼布的用量也是全店第一。',
    appearance: { kind: 'chef', seed: 17458, height: 1.72 },
  },
  {
    id: 'c_hasegawa_nao',
    name: '長谷川 奈緒',
    kana: 'はせがわ なお',
    role: 'chef',
    age: 23,
    gender: 'f',
    speed: 55,
    skill: 84,
    stamina: 80,
    wage: 1300,
    hireCost: 2600,
    stars: 1,
    specialty: 'dessert',
    personality: 'prodigy',
    traits: ['天才肌', '盛り付け', '甘党'],
    desc: '甜點學校第一名畢業，擺盤像在畫圖。缺點是試味道時常常自己吃掉一整份。',
    appearance: { kind: 'chef', seed: 29517, height: 1.61 },
  },
  {
    id: 'c_ishikawa_takumi',
    name: '石川 拓海',
    kana: 'いしかわ たくみ',
    role: 'chef',
    age: 26,
    gender: 'm',
    speed: 70,
    skill: 62,
    stamina: 72,
    wage: 1300,
    hireCost: 2600,
    stars: 1,
    specialty: 'soup',
    personality: 'burnout',
    traits: ['出汁', '無口', '省エネ'],
    desc: '在割烹修業五年後燒光了熱情，現在只想好好煮一鍋湯，偶爾還會對著鍋子小聲說話。',
    appearance: { kind: 'chef', seed: 41260, height: 1.77 },
  },
  {
    id: 'c_shinohara_yamato',
    name: '篠原 大和',
    kana: 'しのはら やまと',
    role: 'chef',
    age: 24,
    gender: 'm',
    speed: 68,
    skill: 60,
    stamina: 85,
    wage: 1200,
    hireCost: 2400,
    stars: 1,
    specialty: 'grilled',
    personality: 'rookie',
    traits: ['新人', '炭火', '不器用'],
    desc: '烤爐前的新人，一緊張就會把串燒翻得太用力。師傅嫌他手拙，卻也承認他從沒烤焦過任何一串。',
    appearance: { kind: 'chef', seed: 33470, height: 1.72 },
  },

  // ── ★2 ───────────────────────────────────────────────────────────────
  {
    id: 'c_nakajima_shota',
    name: '中島 翔太',
    kana: 'なかじま しょうた',
    role: 'chef',
    age: 25,
    gender: 'm',
    speed: 84,
    skill: 70,
    stamina: 84,
    wage: 1600,
    hireCost: 3200,
    stars: 2,
    specialty: 'noodle',
    personality: 'hotblooded',
    traits: ['麺の湯切り', '早い', '声大きい'],
    desc: '拉麵店學徒出身，甩麵的架勢很好看，喊單的聲音也大到隔壁店聽得見。',
    appearance: { kind: 'chef', seed: 8394, height: 1.69 },
  },
  {
    id: 'c_fujita_misaki',
    name: '藤田 美咲',
    kana: 'ふじた みさき',
    role: 'chef',
    age: 31,
    gender: 'f',
    speed: 58,
    skill: 91,
    stamina: 66,
    wage: 1850,
    hireCost: 3700,
    stars: 2,
    specialty: 'rice',
    personality: 'perfectionist',
    traits: ['丁寧', '品質重視', '火加減'],
    desc: '堅持用土鍋煮飯，火候差十秒就整鍋重來，她說白飯才是丼飯的主角。',
    appearance: { kind: 'chef', seed: 35725, height: 1.64 },
  },
  {
    id: 'c_okada_ryo',
    name: '岡田 亮',
    kana: 'おかだ りょう',
    role: 'chef',
    age: 28,
    gender: 'm',
    speed: 76,
    skill: 78,
    stamina: 78,
    wage: 1700,
    hireCost: 3400,
    stars: 2,
    specialty: 'side',
    personality: 'greedy',
    traits: ['原価計算', '手際', 'しっかり者'],
    desc: '會把每道小菜的食材成本算到個位數，省下來的錢全反映在他的加薪談判上。',
    appearance: { kind: 'chef', seed: 20981, height: 1.81 },
  },
  {
    id: 'c_goto_ayaka',
    name: '後藤 彩花',
    kana: 'ごとう あやか',
    role: 'chef',
    age: 22,
    gender: 'f',
    speed: 88,
    skill: 58,
    stamina: 90,
    wage: 1600,
    hireCost: 3200,
    stars: 2,
    specialty: 'drink',
    personality: 'friendly',
    traits: ['愛想良し', 'リズム感', '甘党'],
    desc: '調飲料時會跟著節奏抖肩，客人以為她在表演，其實只是耳機忘了拔。',
    appearance: { kind: 'chef', seed: 44638, height: 1.56 },
  },
  {
    id: 'c_hattori_chika',
    name: '服部 千佳',
    kana: 'はっとり ちか',
    role: 'chef',
    age: 27,
    gender: 'f',
    speed: 74,
    skill: 82,
    stamina: 74,
    wage: 1800,
    hireCost: 3600,
    stars: 2,
    specialty: 'dessert',
    personality: 'prodigy',
    traits: ['パティシエ', '甘党', '几帳面'],
    desc: '甜點專門學校講師推薦來的，出手就自帶裝飾線條。試吃份量總是剛好少一口，因為那一口在她嘴裡。',
    appearance: { kind: 'chef', seed: 51208, height: 1.57 },
  },

  // ── ★3 ───────────────────────────────────────────────────────────────
  {
    id: 'c_maeda_daisuke',
    name: '前田 大輔',
    kana: 'まえだ だいすけ',
    role: 'chef',
    age: 35,
    gender: 'm',
    speed: 92,
    skill: 80,
    stamina: 68,
    wage: 1950,
    hireCost: 3900,
    stars: 3,
    specialty: 'grilled',
    personality: 'veteran',
    traits: ['炭火', 'ベテラン', '香ばし'],
    desc: '炭火前站了十五年，串燒的鹽量用手抓就準。夏天廚房再熱，他也不會少烤一串。',
    appearance: { kind: 'chef', seed: 12276, height: 1.74 },
  },
  {
    id: 'c_murata_ayumi',
    name: '村田 歩',
    kana: 'むらた あゆみ',
    role: 'chef',
    age: 39,
    gender: 'f',
    speed: 60,
    skill: 94,
    stamina: 60,
    wage: 2200,
    hireCost: 4400,
    stars: 3,
    specialty: 'sushi',
    personality: 'perfectionist',
    traits: ['包丁', '丁寧', 'こだわり'],
    desc: '握壽司的手勁精準到能感覺出醋飯多了兩克，她收刀的方式像在收劍。',
    appearance: { kind: 'chef', seed: 33008, height: 1.6 },
  },
  {
    id: 'c_kuroda_ryusei',
    name: '黒田 隆成',
    kana: 'くろだ りゅうせい',
    role: 'chef',
    age: 27,
    gender: 'm',
    speed: 80,
    skill: 72,
    stamina: 82,
    wage: 1850,
    hireCost: 3700,
    stars: 3,
    specialty: 'noodle',
    personality: 'hotblooded',
    traits: ['体力', 'スピード重視', '負けず嫌い'],
    desc: '一次顧四個爐子，出菜快到外場來不及端。他相信湯頭會說話，只是他說得比較大聲。',
    appearance: { kind: 'chef', seed: 27443, height: 1.86 },
  },
  {
    id: 'c_uchida_yuma',
    name: '内田 悠真',
    kana: 'うちだ ゆうま',
    role: 'chef',
    age: 31,
    gender: 'm',
    speed: 81,
    skill: 85,
    stamina: 66,
    wage: 2100,
    hireCost: 4200,
    stars: 3,
    specialty: 'soup',
    personality: 'quiet',
    traits: ['出汁', '無口', '丁寧'],
    desc: '昆布與柴魚的比例他記在腦子裡，不寫食譜。據說他能閉著眼睛分辨味噌的產地，只是不肯表演給客人看。',
    appearance: { kind: 'chef', seed: 27136, height: 1.76 },
  },

  // ── ★4 ───────────────────────────────────────────────────────────────
  {
    id: 'c_aoki_tetsuya',
    name: '青木 哲也',
    kana: 'あおき てつや',
    role: 'chef',
    age: 44,
    gender: 'm',
    speed: 66,
    skill: 96,
    stamina: 52,
    wage: 2600,
    hireCost: 5200,
    stars: 4,
    specialty: 'sushi',
    personality: 'veteran',
    traits: ['熟成', '無口'],
    desc: '專攻熟成，為了養一缸魚可以半夜爬起來換水。話少，但一開口都是關鍵。',
    appearance: { kind: 'chef', seed: 50162, height: 1.7 },
  },
  {
    id: 'c_nishimura_kaori',
    name: '西村 香織',
    kana: 'にしむら かおり',
    role: 'chef',
    age: 33,
    gender: 'f',
    speed: 84,
    skill: 88,
    stamina: 72,
    wage: 2300,
    hireCost: 4600,
    stars: 4,
    specialty: 'set',
    personality: 'genius',
    traits: ['天才肌', '段取り', '研究熱心'],
    desc: '定食的配菜每天都不一樣，靠的是當天市場買到什麼。她說菜單應該由季節決定。',
    appearance: { kind: 'chef', seed: 19604, height: 1.65 },
  },
  {
    id: 'c_tamura_rena',
    name: '田村 玲奈',
    kana: 'たむら れな',
    role: 'chef',
    age: 36,
    gender: 'f',
    speed: 83,
    skill: 92,
    stamina: 64,
    wage: 2500,
    hireCost: 5000,
    stars: 4,
    specialty: 'sushi',
    personality: 'genius',
    traits: ['包丁', '天才肌', '集中力'],
    desc: '握壽司的節奏像在打拍子，一次能同時應付三張吧檯的單。她唯一的怪癖是刀沒磨完之前不跟任何人說話。',
    appearance: { kind: 'chef', seed: 44925, height: 1.62 },
  },
  {
    id: 'c_kondo_hayato',
    name: '近藤 隼人',
    kana: 'こんどう はやと',
    role: 'chef',
    age: 47,
    gender: 'm',
    speed: 77,
    skill: 87,
    stamina: 44,
    wage: 2650,
    hireCost: 5300,
    stars: 4,
    specialty: 'fried',
    personality: 'veteran',
    traits: ['ベテラン', '揚げ物', '頑固'],
    desc: '炸物專門店出身，對油溫的堅持近乎宗教。有人建議他換新油，他只回了一句「油也有脾氣」，然後繼續炸。',
    appearance: { kind: 'chef', seed: 18349, height: 1.81 },
  },

  // ── ★5 ───────────────────────────────────────────────────────────────
  {
    id: 'c_endo_masaru',
    name: '遠藤 勝',
    kana: 'えんどう まさる',
    role: 'chef',
    age: 51,
    gender: 'm',
    speed: 58,
    skill: 96,
    stamina: 46,
    wage: 3200,
    hireCost: 6400,
    stars: 5,
    specialty: 'set',
    personality: 'veteran',
    traits: ['大将', '頑固'],
    desc: '前料亭料理長，會席的流程倒背如流。肯來小店掌勺，據說只因為老闆的誠意和一碗好吃的白飯。',
    appearance: { kind: 'chef', seed: 36779, height: 1.67 },
  },
  {
    id: 'c_sakamoto_akira',
    name: '坂本 晃',
    kana: 'さかもと あきら',
    role: 'chef',
    age: 46,
    gender: 'm',
    speed: 74,
    skill: 95,
    stamina: 55,
    wage: 2700,
    hireCost: 5400,
    stars: 5,
    specialty: 'rice',
    personality: 'veteran',
    traits: ['土鍋', 'ベテラン', '寡黙'],
    desc: '土鍋煮飯的職人，一口飯就能說出產地與年份，同行來吃都會先安靜三秒。',
    appearance: { kind: 'chef', seed: 24150, height: 1.79 },
  },
  {
    id: 'c_shimada_hideki',
    name: '島田 秀樹',
    kana: 'しまだ ひでき',
    role: 'chef',
    age: 52,
    gender: 'm',
    speed: 72,
    skill: 95,
    stamina: 41,
    wage: 2900,
    hireCost: 5800,
    stars: 5,
    specialty: 'noodle',
    personality: 'veteran',
    traits: ['麺職人', '寡黙', 'こだわり'],
    desc: '一天只煮一百碗，賣完就收工，理由是「湯已經盡力了」。有人排了三小時，只為聽他問一句「好吃嗎」。',
    appearance: { kind: 'chef', seed: 60751, height: 1.68 },
  },
];

/** role 的日文顯示名稱。 */
export const ROLE_LABEL = { waiter: 'ホール', chef: '料理人' };

/** 廚師的料理類別（順序同 dishes.js 的 CATEGORIES）。 */
export const DISH_SPECIALTIES = [
  'noodle',
  'rice',
  'sushi',
  'grilled',
  'fried',
  'side',
  'soup',
  'dessert',
  'drink',
  'set',
];

/** 外場的服務專長。 */
export const SERVICE_SPECIALTIES = ['hall', 'register', 'cleaning', 'host', 'kitchen_run'];

/** 全部合法 specialty，依顯示順序排列（料理類別在前，服務專長在後）。 */
export const SPECIALTIES = [...DISH_SPECIALTIES, ...SERVICE_SPECIALTIES];

/** 全部合法 personality，依顯示順序排列。 */
export const PERSONALITIES = [
  'rookie',
  'steady',
  'veteran',
  'genius',
  'lazy',
  'hotblooded',
  'perfectionist',
  'friendly',
  'quiet',
  'greedy',
  'prodigy',
  'burnout',
];

/** 以 id 取得員工，找不到時回傳 undefined。 */
export function staffById(id) {
  return STAFF_POOL.find((staff) => staff.id === id);
}

// ────────────────────────────── 招募名單 ──────────────────────────────

/** 自帶的 mulberry32：同一個 seed 永遠產生同一串亂數。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把 seed / day / stars / count 混成一個 32 位元整數，作為 RNG 的種子。 */
function mixSeed(a, b, c, d) {
  let h = 0x811c9dc5;
  const parts = [a, b, c, d];
  for (let i = 0; i < parts.length; i++) {
    h ^= parts[i] | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * 星級權重：低星候選人在低星餐廳更常出現。
 *
 * ratio 是「每升一星」的相對權重倍率：
 *   ratio < 1 → 偏向低星（開幕初期、低星餐廳，看到的以平價人手為主）
 *   ratio = 1 → 各星級平均
 *   ratio > 1 → 偏向高星（高星餐廳且名聲已開，比較容易遇到高手）
 * 對應 2D 版「名師不是天天有，名聲打開後才請得到」的設計。
 */
function tierWeight(entryStars, maxStars, day) {
  const dayRamp = Math.min(1, Math.max(0, (day - 1) / 30));
  const tilt = 1 + 0.1 * (maxStars - 3) * (0.4 + 0.6 * dayRamp) - 0.18 * (1 - dayRamp);
  const ratio = Math.max(0.5, Math.min(1.35, tilt));
  return Math.pow(ratio, entryStars - maxStars);
}

/**
 * 產生今日的應徵者名單（決定性：同一組參數一定得到同一份名單）。
 *
 * 規則：
 *   1. 只取 stars <= arg.stars 的員工，再排除 exclude 內的 id。
 *   2. 加權抽樣 count 位，低星候選人在低星餐廳較常見。
 *   3. 至少回傳 3 位（名單充足時），最多 count 位。
 *   4. 若第一層條件下無人可以面試，退回到全表最低星級的那一階（仍尊重 exclude）。
 *
 * @param {object}   [opts]
 * @param {number}   [opts.stars=1]   餐廳星級 1..5
 * @param {number}   [opts.day=1]     遊戲日（1 起算），會影響名單
 * @param {number}   [opts.count=5]   想要幾位應徵者
 * @param {number}   [opts.seed=1]    亂數種子
 * @param {string[]} [opts.exclude=[]] 已聘用／已拒絕的員工 id
 * @returns {object[]} 員工 entry 陣列（長度 3..count，或 0）
 */
export function candidatesFor(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const maxStars = clamp(options.stars === undefined ? 1 : options.stars, 1, 5);
  const day = Math.max(1, clamp(options.day === undefined ? 1 : options.day, 1, 9999));
  const wantRaw = Number(options.count);
  const want = Number.isFinite(wantRaw) && wantRaw >= 1 ? Math.floor(wantRaw) : 5;
  const seedRaw = Number(options.seed);
  const seed = Number.isFinite(seedRaw) ? Math.floor(seedRaw) : 1;
  const excluded = new Set(Array.isArray(options.exclude) ? options.exclude : []);

  // 1) 星級門檻 + 排除名單
  let pool = STAFF_POOL.filter((staff) => staff.stars <= maxStars && !excluded.has(staff.id));

  // 2) 保底：退回到全表最低星級那一階（永遠留一點挑人的空間）
  if (pool.length === 0) {
    const lowest = STAFF_POOL.reduce((min, s) => Math.min(min, s.stars), 5);
    pool = STAFF_POOL.filter((staff) => staff.stars === lowest && !excluded.has(staff.id));
  }
  if (pool.length === 0) return [];

  const remaining = pool.slice();
  const floorTarget = Math.min(3, remaining.length);
  const target = Math.max(Math.min(want, remaining.length), floorTarget);

  const rand = mulberry32(mixSeed(seed, day, maxStars, want));
  const picked = [];
  while (picked.length < target && remaining.length > 0) {
    let total = 0;
    for (let i = 0; i < remaining.length; i++) {
      total += tierWeight(remaining[i].stars, maxStars, day);
    }
    let roll = rand() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= tierWeight(remaining[i].stars, maxStars, day);
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

export default STAFF_POOL;
