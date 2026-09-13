// src/data/staff.js
// 《夢幻西餐廳》員工人事資料表（欄位形狀依 docs/ARCHITECTURE.md §2.2）
//
// 詞彙表：
//   role        : waiter | chef
//   specialty   : waiter 一律填 'all'（見 §2.2 註解）；chef 填 DISH_CATEGORIES 之一
//   personality : diligent | cheerful | grumpy | lazy | pro | rookie
//   portrait    : { hair, skin, shirt, hat }  hat 為 0|1|2（帽型索引）
//
// 所有姓名皆為自創的諧音玩笑，與真實人物無關。

export const STAFF_POOL = [
  // ────────────────────────────── 服務生 waiter（15） ──────────────────────────────
  {
    id: 'w_chen_sha_la', name: '陳莎拉', role: 'waiter', age: 19, gender: 'f',
    speed: 46, skill: 38, stamina: 44, wage: 2, initWage: 2,
    specialty: 'all', personality: 'rookie',
    desc: '第一天上班就把沙拉倒在客人褲子上，但笑起來很甜。',
    portrait: { hair: '#3a2318', skin: '#f6d3ad', shirt: '#e08a9b', hat: 1 }
  },
  {
    id: 'w_wu_guo_ba', name: '吳鍋巴', role: 'waiter', age: 21, gender: 'm',
    speed: 52, skill: 45, stamina: 50, wage: 2, initWage: 2,
    specialty: 'all', personality: 'rookie',
    desc: '名字來自他第一次洗碗的成果，本人倒是很認命。',
    portrait: { hair: '#1f1a16', skin: '#e8c39b', shirt: '#6b8f5e', hat: 0 }
  },
  {
    id: 'w_lin_jiang_hu', name: '林漿糊', role: 'waiter', age: 24, gender: 'm',
    speed: 44, skill: 52, stamina: 46, wage: 2, initWage: 3,
    specialty: 'all', personality: 'lazy',
    desc: '動作永遠慢半拍，客人喊三次才會回頭。',
    portrait: { hair: '#2b1f14', skin: '#f0c9a0', shirt: '#8a8f9c', hat: 2 }
  },
  {
    id: 'w_huang_a_she', name: '黃阿舍', role: 'waiter', age: 33, gender: 'm',
    speed: 41, skill: 49, stamina: 40, wage: 2, initWage: 3,
    specialty: 'all', personality: 'grumpy',
    desc: '家裡其實有三間房，來打工純粹是被老婆趕出門。',
    portrait: { hair: '#4a3a2a', skin: '#dcae82', shirt: '#7a5c3c', hat: 0 }
  },
  {
    id: 'w_gao_li_cai', name: '高麗菜', role: 'waiter', age: 20, gender: 'f',
    speed: 58, skill: 54, stamina: 56, wage: 3, initWage: 3,
    specialty: 'all', personality: 'diligent',
    desc: '手腳快又不怕生，一開口就是標準的菜市場台語。',
    portrait: { hair: '#5c3a24', skin: '#f7d8b4', shirt: '#a8c65a', hat: 1 }
  },
  {
    id: 'w_ah_long', name: '阿龍', role: 'waiter', age: 22, gender: 'm',
    speed: 62, skill: 55, stamina: 70, wage: 3, initWage: 3,
    specialty: 'all', personality: 'diligent',
    desc: '夜市長大的少年，端盤子像在跳舞。',
    portrait: { hair: '#2b1b12', skin: '#f0c9a0', shirt: '#3a6ea5', hat: 0 }
  },
  {
    id: 'w_pan_la_jiao', name: '潘辣椒', role: 'waiter', age: 26, gender: 'f',
    speed: 60, skill: 63, stamina: 58, wage: 3, initWage: 4,
    specialty: 'all', personality: 'cheerful',
    desc: '嗓門大、記性好，一次記十桌的菜單也不會錯。',
    portrait: { hair: '#7a1f1f', skin: '#f2c49c', shirt: '#d2452f', hat: 2 }
  },
  {
    id: 'w_xiao_mi_fen', name: '蕭米粉', role: 'waiter', age: 23, gender: 'f',
    speed: 57, skill: 66, stamina: 62, wage: 4, initWage: 4,
    specialty: 'all', personality: 'cheerful',
    desc: '講話軟軟的，客人抱怨到她手上都會變成誇獎。',
    portrait: { hair: '#402a1c', skin: '#f8ddbd', shirt: '#e8e2d0', hat: 1 }
  },
  {
    id: 'w_ceng_xiao_fei', name: '曾小費', role: 'waiter', age: 28, gender: 'm',
    speed: 68, skill: 70, stamina: 64, wage: 4, initWage: 4,
    specialty: 'all', personality: 'cheerful',
    desc: '天生適合站外場，客人掏小費的時候手都很誠實。',
    portrait: { hair: '#241a12', skin: '#eec49a', shirt: '#2f4f7f', hat: 0 }
  },
  {
    id: 'w_zheng_fen_yuan', name: '鄭粉圓', role: 'waiter', age: 25, gender: 'f',
    speed: 72, skill: 68, stamina: 70, wage: 5, initWage: 5,
    specialty: 'all', personality: 'diligent',
    desc: '小小一隻卻能一次端六碗湯，平衡感好到不可思議。',
    portrait: { hair: '#33231a', skin: '#f5d2ad', shirt: '#c98ab0', hat: 2 }
  },
  {
    id: 'w_xu_mian_xian', name: '許麵線', role: 'waiter', age: 30, gender: 'm',
    speed: 66, skill: 74, stamina: 72, wage: 5, initWage: 5,
    specialty: 'all', personality: 'diligent',
    desc: '在廟口站了八年，什麼樣的客人都見過。',
    portrait: { hair: '#1d1610', skin: '#dfb489', shirt: '#5d7a48', hat: 1 }
  },
  {
    id: 'w_lai_da_pan', name: '賴大盤', role: 'waiter', age: 27, gender: 'm',
    speed: 78, skill: 72, stamina: 74, wage: 6, initWage: 6,
    specialty: 'all', personality: 'cheerful',
    desc: '一雙大手從沒摔過盤子，這點連他自己都覺得神奇。',
    portrait: { hair: '#2e2018', skin: '#e9bd93', shirt: '#b5544a', hat: 0 }
  },
  {
    id: 'w_qiu_yi_bei', name: '邱一杯', role: 'waiter', age: 29, gender: 'f',
    speed: 76, skill: 80, stamina: 70, wage: 6, initWage: 6,
    specialty: 'all', personality: 'pro',
    desc: '酒量好到客人先倒，吧台交給她從沒出過事。',
    portrait: { hair: '#3d2b1e', skin: '#f4d5b0', shirt: '#3f3a58', hat: 2 }
  },
  {
    id: 'w_ding_xiao_yu', name: '丁小雨', role: 'waiter', age: 24, gender: 'f',
    speed: 84, skill: 78, stamina: 76, wage: 7, initWage: 7,
    specialty: 'all', personality: 'cheerful',
    desc: '笑臉迎人的招牌工讀生，客人指定要她帶位。',
    portrait: { hair: '#141018', skin: '#fae0c2', shirt: '#f0f0f0', hat: 1 }
  },
  {
    id: 'w_ouyang_tang', name: '歐陽湯', role: 'waiter', age: 31, gender: 'm',
    speed: 80, skill: 85, stamina: 82, wage: 8, initWage: 8,
    specialty: 'all', personality: 'pro',
    desc: '外場老手，一眼就能看出哪桌快要發火。',
    portrait: { hair: '#20180f', skin: '#d9ab7e', shirt: '#1f3b5c', hat: 0 }
  },
  {
    id: 'w_pa_pa', name: '爸爸', role: 'waiter', age: 18, gender: 'm',
    speed: 99, skill: 99, stamina: 99, wage: 1, initWage: 1,
    specialty: 'all', personality: 'pro',
    desc: '靚仔一個。',
    portrait: { hair: '#20180f', skin: '#d9ab7e', shirt: '#1f3b5c', hat: 0 }
  },

  // ────────────────────────────── 廚師 chef（11） ──────────────────────────────
  {
    id: 'c_hu_yan_huo', name: '胡炎火', role: 'chef', age: 34, gender: 'm',
    speed: 40, skill: 42, stamina: 52, wage: 2, initWage: 2,
    specialty: 'staple', personality: 'rookie',
    desc: '名字聽起來很猛，實際上連荷包蛋都會煎焦。',
    portrait: { hair: '#2a1c12', skin: '#e5b98f', shirt: '#d9d4c4', hat: 1 }
  },
  {
    id: 'c_dai_liang_guang', name: '戴兩光', role: 'chef', age: 45, gender: 'm',
    speed: 38, skill: 48, stamina: 45, wage: 2, initWage: 3,
    specialty: 'side', personality: 'lazy',
    desc: '炒菜全靠心情，心情好時其實還滿好吃的。',
    portrait: { hair: '#4d4032', skin: '#d8a878', shirt: '#8d8577', hat: 0 }
  },
  {
    id: 'c_guo_tie_ban', name: '郭鐵板', role: 'chef', age: 23, gender: 'm',
    speed: 55, skill: 56, stamina: 60, wage: 3, initWage: 3,
    specialty: 'staple', personality: 'diligent',
    desc: '從鐵板燒學徒出身，翻鍋的手感天生就好。',
    portrait: { hair: '#1c1611', skin: '#eec9a1', shirt: '#f2eee2', hat: 1 }
  },
  {
    id: 'c_song_guo_zhi', name: '宋果汁', role: 'chef', age: 21, gender: 'f',
    speed: 58, skill: 52, stamina: 62, wage: 3, initWage: 3,
    specialty: 'drink', personality: 'cheerful',
    desc: '吧台出身，調飲料像在做化學實驗，客人看得入迷。',
    portrait: { hair: '#5a3320', skin: '#f9dcbb', shirt: '#f6a04a', hat: 2 }
  },
  {
    id: 'c_hong_niu_pai', name: '洪牛排', role: 'chef', age: 29, gender: 'm',
    speed: 52, skill: 66, stamina: 58, wage: 4, initWage: 4,
    specialty: 'staple', personality: 'diligent',
    desc: '牛排館待過五年，火候掌握得比誰都準。',
    portrait: { hair: '#26190f', skin: '#e0b184', shirt: '#ffffff', hat: 1 }
  },
  {
    id: 'c_li_shao_la', name: '李燒臘', role: 'chef', age: 38, gender: 'm',
    speed: 49, skill: 72, stamina: 64, wage: 4, initWage: 5,
    specialty: 'side', personality: 'grumpy',
    desc: '脾氣跟烤爐一樣燙，但燒臘真的沒人比得過。',
    portrait: { hair: '#181310', skin: '#cf9b6d', shirt: '#e6e0cf', hat: 0 }
  },
  {
    id: 'c_su_qing_zheng', name: '蘇清蒸', role: 'chef', age: 33, gender: 'f',
    speed: 54, skill: 75, stamina: 68, wage: 5, initWage: 5,
    specialty: 'soup', personality: 'pro',
    desc: '堅持不用味精，靠一鍋高湯走遍天下。',
    portrait: { hair: '#372619', skin: '#f4d2ae', shirt: '#dff0ef', hat: 1 }
  },
  {
    id: 'c_zhu_hong_shao', name: '朱紅燒', role: 'chef', age: 41, gender: 'm',
    speed: 51, skill: 80, stamina: 70, wage: 6, initWage: 6,
    specialty: 'staple', personality: 'pro',
    desc: '滷汁的年紀比店裡的工讀生還大，從來不外傳。',
    portrait: { hair: '#2d1d12', skin: '#d9a06f', shirt: '#f4efe0', hat: 0 }
  },
  {
    id: 'c_yang_bao_chao', name: '楊爆炒', role: 'chef', age: 28, gender: 'm',
    speed: 66, skill: 84, stamina: 66, wage: 6, initWage: 6,
    specialty: 'side', personality: 'pro',
    desc: '鍋氣十足的快炒快手，尖峰時間看他表演就值回票價。',
    portrait: { hair: '#151210', skin: '#eec49c', shirt: '#dbd6c8', hat: 2 }
  },
  {
    id: 'c_liao_kuai_chao', name: '廖快炒', role: 'chef', age: 26, gender: 'm',
    speed: 74, skill: 78, stamina: 72, wage: 7, initWage: 7,
    specialty: 'staple', personality: 'diligent',
    desc: '一次顧四個爐子，出菜速度讓外場來不及端。',
    portrait: { hair: '#1a1410', skin: '#e7bb91', shirt: '#f7f4ea', hat: 1 }
  },
  {
    id: 'c_lu_man_han', name: '盧滿漢', role: 'chef', age: 44, gender: 'm',
    speed: 60, skill: 92, stamina: 84, wage: 8, initWage: 8,
    specialty: 'soup', personality: 'pro',
    desc: '辦桌總舖師出身，一個人就能撐起整桌滿漢全席。',
    portrait: { hair: '#5a5248', skin: '#d3a274', shirt: '#ffffff', hat: 0 }
  },
  {
    id: 'c_chin_chin', name: '千千', role: 'chef', age: 12, gender: 'f',
    speed: 99, skill: 99, stamina: 99, wage: 1, initWage: 1,
    specialty: 'soup', personality: 'pro',
    desc: '傻瓜。',
    portrait: { hair: '#5a5248', skin: '#d3a274', shirt: '#ffffff', hat: 0 }
  },

  // ────────────────────────────── 特殊高階員工（2，wage >= 9） ──────────────────────────────
  {
    id: 'c_fu_guo_yan', name: '傅國宴', role: 'chef', age: 52, gender: 'm',
    speed: 70, skill: 96, stamina: 90, wage: 12, initWage: 12,
    specialty: 'staple', personality: 'pro',
    desc: '國宴退下來的大師傅，肯來小店全靠老闆一句誠意。',
    portrait: { hair: '#8b8578', skin: '#e0b78c', shirt: '#fbf8f0', hat: 1 }
  },
  {
    id: 'w_jiang_li_jing', name: '江麗晶', role: 'waiter', age: 36, gender: 'f',
    speed: 92, skill: 90, stamina: 88, wage: 9, initWage: 9,
    specialty: 'all', personality: 'pro',
    desc: '五星飯店外場經理出身，她一開口全場自動上軌道。',
    portrait: { hair: '#211827', skin: '#f6d6b6', shirt: '#2b2f52', hat: 2 }
  }
];

export function staffById(id) {
  return STAFF_POOL.find((s) => s.id === id);
}

// 綜合能力值（1..100），用來決定這個人有多強、開價有多敢。
function qualityOf(staff) {
  return (staff.speed + staff.skill + staff.stamina) / 3;
}

function roundHalf(x) {
  return Math.round(x * 2) / 2;
}

/**
 * 產生今日的應徵者名單。
 * 同一組 (day, count, rng 狀態) 一定產生同一份名單（決定性）。
 * 天數越大 → 解鎖越強的員工，且期望時薪因物價而上升。
 *
 * @param {number} day   遊戲日（1 起算）
 * @param {number} count 要幾位應徵者
 * @param {{next:Function,int:Function,pick:Function,chance:Function,shuffle:Function}} rng
 * @returns {{candidateId:string, staffId:string, askWage:number}[]}
 */
export function makeCandidateList(day, count, rng) {
  const d = Math.max(1, Math.floor(Number(day)) || 1);
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  if (n === 0) return [];

  // 名師不是天天有：能力上限隨天數慢慢打開（約第 45 天後全員都有可能出現）。
  const cap = Math.min(97, 54 + (d - 1) * 1.0);
  let pool = STAFF_POOL.filter((s) => qualityOf(s) <= cap);

  // 保險：永遠留一點挑人的空間，不足時補進最接近門檻的幾位。
  if (pool.length < n + 2) {
    pool = STAFF_POOL.slice().sort((a, b) => qualityOf(a) - qualityOf(b)).slice(0, Math.min(STAFF_POOL.length, n + 3));
  }

  const shuffled = rng.shuffle(pool.slice());
  const inflation = 1 + Math.min(0.3, (d - 1) * 0.004); // 越晚開店，人事成本越高
  const out = [];
  for (let i = 0; i < n; i++) {
    const staff = shuffled[i % shuffled.length];
    const q = qualityOf(staff);
    const greed = 0.85 + (q / 100) * 0.55;        // 能力越強越敢開價
    const jitter = 0.94 + rng.next() * 0.14;      // 一點人情味的浮動
    let ask = roundHalf(staff.wage * greed * inflation * jitter);
    if (ask < 1.5) ask = 1.5;
    if (ask > 20) ask = 20;
    out.push({
      candidateId: `cand_${d}_${i}_${staff.id}`,
      staffId: staff.id,
      askWage: ask
    });
  }
  return out;
}
