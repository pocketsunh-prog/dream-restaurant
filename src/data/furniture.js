// src/data/furniture.js
// 《夢幻西餐廳》傢俱／設備資料表（欄位形狀依 docs/ARCHITECTURE.md §2.4）
//
// 詞彙表：
//   category   : table | chair | counter | decor | equipment | restroom | kitchen
//   style      : nightmarket | harbor | office | nightmarket2 | mall | fashion | plain
//                （style 與 LOCATIONS[].decorStyle 相符時，裝潢分數才算滿分；'plain' 通用）
//   seatFacing : ['N','S','E','W'] 的子集合
//   設備與事件的關聯：cctv / infrared_sensor / fire_extinguisher / fire_system / security_host
//                （EVENTS[].mitigateBy 會引用這些 id）

export const FURNITURE = [
  // ────────────────────────────── 桌子 table（7） ──────────────────────────────
  {
    id: 'table_2a', name: '二人方桌', category: 'table',
    w: 1, h: 1, price: 900, seats: 2, seatFacing: ['N', 'S'],
    decorScore: 4, style: 'nightmarket', blocks: true, needsAdjacentFloor: true, durability: 100,
    desc: '夜市攤風格的小方桌，情侶剛好面對面。'
  },
  {
    id: 'table_4a', name: '四人圓桌', category: 'table',
    w: 2, h: 2, price: 2200, seats: 4, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 6, style: 'nightmarket', blocks: true, needsAdjacentFloor: true, durability: 110,
    desc: '一家四口剛剛好，夜市裡最常見的那種。'
  },
  {
    id: 'table_6a', name: '六人長桌', category: 'table',
    w: 2, h: 2, price: 3600, seats: 6, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 7, style: 'nightmarket', blocks: true, needsAdjacentFloor: true, durability: 120,
    desc: '同學會與公司聚餐的首選，拚桌才熱鬧。'
  },
  {
    id: 'table_2b', name: '二人雅座', category: 'table',
    w: 1, h: 1, price: 3200, seats: 2, seatFacing: ['N', 'S'],
    decorScore: 10, style: 'fashion', blocks: true, needsAdjacentFloor: true, durability: 130,
    desc: '鋪著白色桌巾的小圓桌，燈光一暗就有氣氛。'
  },
  {
    id: 'table_4b', name: '四人雅桌', category: 'table',
    w: 2, h: 2, price: 5600, seats: 4, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 14, style: 'fashion', blocks: true, needsAdjacentFloor: true, durability: 150,
    desc: '桌面鑲著深色木紋，擺在哪裡都顯得高級。'
  },
  {
    id: 'table_6b', name: '六人宴會桌', category: 'table',
    w: 2, h: 2, price: 8800, seats: 6, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 18, style: 'mall', blocks: true, needsAdjacentFloor: true, durability: 170,
    desc: '百貨公司等級的大桌，連轉盤都是亮晶晶的。'
  },
  {
    // 八人宴會長桌：腳印 2 寬 × 3 高（沿用既有的桌椅配對規則，只是多一排）。
    // 為什麼是 2×3 而不是 3×2：椅子依「北 → 南 → 西 → 東」的順序配位，
    // 每個方向都沿著腳印的每一格往外找一格，所以 2×3 剛好提供
    // 北 2＋南 2＋西 3＋東 3＝10 個候選位，扣掉牆邊／走道不足的仍能坐滿 8 人；
    // 3×2 的候選位落在「北 3＋南 3＋西 2＋東 2」，在北側靠牆或與鄰桌太近的排法會湊不滿。
    // 實際配置點：開局平面圖 (20,13)（第三排右側），景點格局見 src/sim/build.js#LAYOUT_VARIANTS 的 items。
    id: 'table_8b', name: '八人宴會長桌', category: 'table',
    w: 2, h: 3, price: 12500, seats: 8, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 20, style: 'mall', blocks: true, needsAdjacentFloor: true, durability: 190,
    desc: '兩排長桌併起來的氣派大桌，旅行團與大家族一坐滿就是八個人。'
  },

  // ────────────────────────────── 椅子 chair（3） ──────────────────────────────
  {
    id: 'chair_wood', name: '木頭板凳', category: 'chair',
    w: 1, h: 1, price: 250, seats: 1, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 3, style: 'nightmarket', blocks: false, needsAdjacentFloor: true, durability: 90,
    desc: '坐久了會屁股痛，但便宜耐操又不怕摔。'
  },
  {
    id: 'chair_iron', name: '鐵管椅', category: 'chair',
    w: 1, h: 1, price: 420, seats: 1, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 4, style: 'plain', blocks: false, needsAdjacentFloor: true, durability: 120,
    desc: '疊起來可以堆到天花板，小吃店的好朋友。'
  },
  {
    id: 'chair_sofa', name: '沙發座椅', category: 'chair',
    w: 1, h: 1, price: 1800, seats: 1, seatFacing: ['N', 'S', 'E', 'W'],
    decorScore: 9, style: 'fashion', blocks: false, needsAdjacentFloor: true, durability: 140,
    desc: '一坐下去就不想起來，翻桌率也跟著下降。'
  },

  // ────────────────────────────── 櫃台 counter（2） ──────────────────────────────
  {
    id: 'counter_cashier', name: '結帳櫃台', category: 'counter',
    w: 2, h: 1, price: 2600, seats: 0, seatFacing: [],
    decorScore: 5, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 150,
    desc: '一台收銀機、一本帳簿，錢從這裡進來也從這裡出去。'
  },
  {
    id: 'counter_bar', name: '時尚吧台', category: 'counter',
    w: 3, h: 1, price: 4200, seats: 0, seatFacing: [],
    decorScore: 8, style: 'fashion', blocks: true, needsAdjacentFloor: true, durability: 160,
    desc: '晚上燈一打，飲料還沒上桌就先加十分。'
  },

  // ────────────────────────────── 裝潢 decor（11） ──────────────────────────────
  {
    id: 'pot_plant', name: '萬年青盆栽', category: 'decor',
    w: 1, h: 1, price: 480, seats: 0, seatFacing: [],
    decorScore: 7, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 80,
    desc: '不管怎麼養都不會死，店裡唯一的綠意。'
  },
  {
    id: 'painting_landscape', name: '山水國畫', category: 'decor',
    w: 1, h: 1, price: 1600, seats: 0, seatFacing: [],
    decorScore: 10, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 100,
    desc: '掛在牆上立刻多三分氣質，雖然沒人看得懂。'
  },
  {
    id: 'carpet_red', name: '大紅地毯', category: 'decor',
    w: 2, h: 1, price: 1200, seats: 0, seatFacing: [],
    decorScore: 9, style: 'plain', blocks: false, needsAdjacentFloor: true, durability: 60,
    desc: '踩起來軟軟的，但打翻飲料就等著哭。'
  },
  {
    id: 'lantern_row', name: '大紅燈籠', category: 'decor',
    w: 1, h: 1, price: 900, seats: 0, seatFacing: [],
    decorScore: 11, style: 'nightmarket', blocks: false, needsAdjacentFloor: false, durability: 90,
    desc: '一掛上去，整條街都知道你這家開張了。'
  },
  {
    id: 'neon_sign', name: '霓虹招牌', category: 'decor',
    w: 1, h: 1, price: 2400, seats: 0, seatFacing: [],
    decorScore: 12, style: 'fashion', blocks: false, needsAdjacentFloor: false, durability: 110,
    desc: '晚上閃個不停，路過的人想不看都難。'
  },
  {
    id: 'aquarium', name: '大型水族箱', category: 'decor',
    w: 2, h: 1, price: 3800, seats: 0, seatFacing: [],
    decorScore: 13, style: 'harbor', blocks: true, needsAdjacentFloor: true, durability: 100,
    desc: '活魚現撈的保證，小朋友可以趴在玻璃前看半小時。'
  },
  {
    id: 'flower_stand', name: '鮮花檯', category: 'decor',
    w: 1, h: 1, price: 1400, seats: 0, seatFacing: [],
    decorScore: 8, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 70,
    desc: '每天都要換水，但客人一進門就先聞到香氣。'
  },
  {
    id: 'wooden_screen', name: '木雕屏風', category: 'decor',
    w: 2, h: 1, price: 2200, seats: 0, seatFacing: [],
    decorScore: 11, style: 'nightmarket2', blocks: true, needsAdjacentFloor: true, durability: 120,
    desc: '把吵架的客人跟約會的客人隔開，老闆的智慧。'
  },
  {
    id: 'photo_wall', name: '名人簽名牆', category: 'decor',
    w: 1, h: 1, price: 1800, seats: 0, seatFacing: [],
    decorScore: 9, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 100,
    desc: '整面牆都是簽名與合照，來的客人自動安靜三分。'
  },
  {
    id: 'fountain_small', name: '小型噴水池', category: 'decor',
    w: 2, h: 2, price: 6800, seats: 0, seatFacing: [],
    decorScore: 16, style: 'mall', blocks: true, needsAdjacentFloor: true, durability: 140,
    desc: '流水聲配上燈光，百貨公司中庭的氣派。'
  },
  {
    id: 'jukebox', name: '點唱機', category: 'decor',
    w: 1, h: 1, price: 5200, seats: 0, seatFacing: [],
    decorScore: 14, style: 'nightmarket2', blocks: true, needsAdjacentFloor: true, durability: 130,
    desc: '投十元選一首歌，客人常常忘了自己是來吃飯的。'
  },

  // ────────────────────────────── 設備 equipment（9） ──────────────────────────────
  // 冷氣／音響／燈具／冰箱＋五項防治設備（監視器、紅外線、滅火器、消防設備、保全主機）
  {
    id: 'ac_unit', name: '分離式冷氣', category: 'equipment',
    w: 1, h: 1, price: 12000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 100,
    desc: '台灣夏天的命脈，壞掉一天客人就跑一半。'
  },
  {
    id: 'stereo', name: '立體音響', category: 'equipment',
    w: 1, h: 1, price: 6500, seats: 0, seatFacing: [],
    decorScore: 6, style: 'plain', blocks: false, needsAdjacentFloor: true, durability: 90,
    desc: '放對音樂客人坐得久，放錯音樂客人吃得快。'
  },
  {
    id: 'ceiling_lamp', name: '吊燈組', category: 'equipment',
    w: 1, h: 1, price: 3200, seats: 0, seatFacing: [],
    decorScore: 8, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 85,
    desc: '燈光暖一點，菜看起來就貴一點。'
  },
  {
    id: 'fridge', name: '商用冰箱', category: 'equipment',
    w: 1, h: 2, price: 15000, seats: 0, seatFacing: [],
    decorScore: 3, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 120,
    desc: '食材的保命符，停電超過四小時就準備報廢。'
  },
  {
    id: 'cctv', name: '監視器', category: 'equipment',
    w: 1, h: 1, price: 8000, seats: 0, seatFacing: [],
    decorScore: 1, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 100,
    desc: '紅燈一閃，想順手牽羊的手就縮回去了。'
  },
  {
    id: 'infrared_sensor', name: '紅外線防盜', category: 'equipment',
    w: 1, h: 1, price: 12000, seats: 0, seatFacing: [],
    decorScore: 1, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 100,
    desc: '打烊後看不見的網，老鼠跟小偷都別想進來。'
  },
  {
    id: 'fire_extinguisher', name: '滅火器', category: 'equipment',
    w: 1, h: 1, price: 3500, seats: 0, seatFacing: [],
    decorScore: 1, style: 'plain', blocks: false, needsAdjacentFloor: true, durability: 110,
    desc: '掛在牆上十年用不到，用到的那一次救整間店。'
  },
  {
    id: 'fire_system', name: '消防設備', category: 'equipment',
    w: 1, h: 1, price: 28000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: false, needsAdjacentFloor: false, durability: 150,
    desc: '灑水頭、偵煙器加緊急照明，衛生局來檢查也不怕。'
  },
  {
    id: 'security_host', name: '保全主機', category: 'equipment',
    w: 1, h: 1, price: 45000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: false, needsAdjacentFloor: true, durability: 160,
    desc: '連線到保全公司，出事三分鐘內有人來按門鈴。'
  },

  // ────────────────────────────── 廁所 restroom（2） ──────────────────────────────
  {
    id: 'restroom_toilet', name: '沖水馬桶', category: 'restroom',
    w: 1, h: 1, price: 6000, seats: 0, seatFacing: [],
    decorScore: 3, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 130,
    desc: '廁所乾不乾淨，客人比廚房更在意。'
  },
  {
    id: 'restroom_sink', name: '洗手台', category: 'restroom',
    w: 1, h: 1, price: 4500, seats: 0, seatFacing: [],
    decorScore: 4, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 120,
    desc: '鏡子擦得亮，客人對整家店的印象就亮。'
  },

  // ────────────────────────────── 廚房 kitchen（3） ──────────────────────────────
  {
    id: 'kitchen_stove', name: '快速爐灶', category: 'kitchen',
    w: 2, h: 1, price: 22000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 140,
    desc: '火力全開時整間店都在震，師傅的命根子。'
  },
  {
    id: 'kitchen_worktable', name: '不鏽鋼料理台', category: 'kitchen',
    w: 2, h: 1, price: 9000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 130,
    desc: '切菜備料都在這裡，檯面永遠不夠放。'
  },
  {
    id: 'kitchen_dishwasher', name: '洗碗機', category: 'kitchen',
    w: 1, h: 1, price: 16000, seats: 0, seatFacing: [],
    decorScore: 2, style: 'plain', blocks: true, needsAdjacentFloor: true, durability: 120,
    desc: '省下一個洗碗阿姨，翻桌速度立刻快一截。'
  }
];

export function furnitureById(id) {
  return FURNITURE.find((f) => f.id === id);
}

export function furnitureByCategory(cat) {
  return FURNITURE.filter((f) => f.category === cat);
}

export function equipmentList() {
  return FURNITURE.filter((f) => f.category === 'equipment');
}
