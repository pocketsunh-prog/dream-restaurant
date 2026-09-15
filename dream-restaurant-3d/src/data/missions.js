// ============================================================================
// missions.js — ミッション（依頼）表
//
//   お店を育てるための「依頼」を tier（1〜5）ごとに並べたデータ。
//   進捗の計算は sim/missions.js が state から行う（この檔案は純資料）。
//
//   契約（各 entry）:
//     id      : string  蛇形命名・全表で一意
//     tier    : number  1..5（解錠の段階。上位 tier は後から解放される）
//     jp      : string  日本語の依頼名
//     zh      : string  繁體中文名
//     desc    : string  1〜2 行の説明（プレイヤーが何をすればいいか）
//     goal    : object  { kind, target, scope?, extra? } — kind は GOAL_KINDS のいずれか
//     reward  : object  { cash?, fame?, equipment?, title? } — 達成報告でもらえるもの
//     stars   : number? この星級以上でないと出てこない（省略時は 1）
// ============================================================================

/** 目標の種類（sim/missions.js が進捗を計算する。ここは説明文だけ持つ） */
export const GOAL_KINDS = {
  serveGuests: '來客数',
  revenue: '売上',
  netProfit: '1日の利益',
  tips: 'チップ',
  cash: '所持金',
  fame: '評価',
  stars: '星級',
  days: '営業日数',
  cookDishes: '調理した品数',
  cleanRestroom: 'トイレ清掃',
  petGroups: 'ペット同伴',
  kindsServed: '客層の種類',
  staffCount: '従業員数',
  staffSkill: '従業員の腕前',
  uniforms: '制服の種類',
  menus: '品書きの数',
  specialties: '名物の数',
  floors: '階数',
  maxQueue: '行列',
  noAngryDay: '怒らせない日',
  severeServed: '荒天の日の接客'
};

/** 依頼の全体（40 件）。tier が小さいほど序盤向け。 */
export const MISSIONS = [
  // ── tier 1：開店直後にやること ─────────────────────────────────────
  { id: 'm_first_guests', tier: 1, jp: '初めてのお客様', zh: '第一批客人',
    desc: '1 日のうちに 20 名さまをご案内しましょう。まずは暖簾をくぐってもらうことから。',
    goal: { kind: 'serveGuests', target: 20, scope: 'day' }, reward: { cash: 30000, fame: 1 } },
  { id: 'm_first_revenue', tier: 1, jp: '初日の売上', zh: '第一天的營業額',
    desc: '1 日の売上 ¥80,000 を超えましょう。値段と量のバランスを見直す良い機会です。',
    goal: { kind: 'revenue', target: 80000, scope: 'day' }, reward: { cash: 40000 } },
  { id: 'm_clean_restroom', tier: 1, jp: 'お手洗いをきれいに', zh: '把洗手間打掃乾淨',
    desc: 'トイレ清掃を累計 3 回行いましょう。汚れたままにすると客足が落ちます。',
    goal: { kind: 'cleanRestroom', target: 3, scope: 'total' }, reward: { cash: 15000 } },
  { id: 'm_two_waiters', tier: 1, jp: 'ホールを増やす', zh: '增加外場人手',
    desc: 'ホール（外場）を 2 名以上にしましょう。人手不足は料理が出る前の最大の敵です。',
    goal: { kind: 'staffCount', target: 2, extra: 'waiter' }, reward: { cash: 25000, title: '段取り上手' } },
  { id: 'm_five_menus', tier: 1, jp: '品書きを増やす', zh: '菜單擴充',
    desc: '提供中の料理を 5 品以上にしましょう。選択肢が増えると客単価も上がります。',
    goal: { kind: 'menus', target: 5 }, reward: { cash: 20000 } },
  { id: 'm_restroom_ten', tier: 1, jp: '掃除の習慣', zh: '打掃的習慣',
    desc: 'トイレ清掃を累計 10 回行いましょう。汚れは評判に直結します。',
    goal: { kind: 'cleanRestroom', target: 10 }, reward: { cash: 35000 } },
  { id: 'm_serve_300', tier: 1, jp: '累計 300 名', zh: '累計服務 300 人',
    desc: 'これまでの來客数の合計を 300 名にしましょう。',
    goal: { kind: 'serveGuests', target: 300, scope: 'total' }, reward: { cash: 50000, fame: 1 } },
  { id: 'm_rain_day_service', tier: 1, jp: '雨の日の一組', zh: '雨天也要接一組',
    desc: '荒天（暴風雨・雪・みぞれ・猛暑）の日に累計 10 名をご案内しましょう。悪天候ほど暖簾のありがたみが出ます。',
    goal: { kind: 'severeServed', target: 10 }, reward: { cash: 45000 } },

  // ── tier 2：基礎を固める ───────────────────────────────────────────
  { id: 'm_no_angry_day', tier: 2, jp: '誰も怒らせない日', zh: '沒人生氣的一天',
    desc: '10 名以上をご案内した日に、怒って帰るお客様を 0 人にしましょう。',
    goal: { kind: 'noAngryDay', target: 1 }, reward: { cash: 60000, fame: 2, title: 'ホスピタリティ' } },
  { id: 'm_serve_100', tier: 2, jp: '累計 100 名', zh: '累計服務 100 人',
    desc: 'これまでの來客数の合計を 100 名にしましょう。',
    goal: { kind: 'serveGuests', target: 100, scope: 'total' }, reward: { cash: 80000 } },
  { id: 'm_pet_welcome', tier: 2, jp: 'ペット同伴のお客様', zh: '接待帶寵物的客人',
    desc: 'ペット連れのお客様を累計 3 組ご案内しましょう。ペット同伴席は一階の窓側です。',
    goal: { kind: 'petGroups', target: 3 }, reward: { cash: 35000, fame: 1 } },
  { id: 'm_second_floor', tier: 2, jp: '二階をつくる', zh: '擴建二樓',
    desc: '店舗を 2 階に増築しましょう。席数が増えると行列が売上に変わります。',
    goal: { kind: 'floors', target: 2 }, reward: { cash: 150000, title: '増築の達人' } },
  { id: 'm_good_tips', tier: 2, jp: '気前のいい一日', zh: '慷慨的一天',
    desc: '1 日のチップを ¥8,000 以上にしましょう。接客の質がそのまま出ます。',
    goal: { kind: 'tips', target: 8000, scope: 'day' }, reward: { cash: 45000 } },
  { id: 'm_uniform_pair', tier: 2, jp: '制服を二着', zh: '兩套制服',
    desc: '2 種類の制服を従業員に着せましょう。色が揃うと店内の印象が締まります。',
    goal: { kind: 'uniforms', target: 2 }, reward: { cash: 40000 } },
  { id: 'm_pet_twenty', tier: 2, jp: 'ペット席の常連', zh: '寵物席的常客',
    desc: 'ペット連れのお客様を累計 20 組ご案内しましょう。水飲み場と足拭きを忘れずに。',
    goal: { kind: 'petGroups', target: 20 }, reward: { cash: 130000, fame: 1, title: 'ペット席の主' } },

  // ── tier 3：お店らしさを出す ───────────────────────────────────────
  { id: 'm_fame_40', tier: 3, jp: '評判が広がる', zh: '口碑擴散',
    desc: '評価（人気）を 40 以上にしましょう。常連さんが友達を連れて來ます。',
    goal: { kind: 'fame', target: 40 }, reward: { cash: 150000, fame: 3 } },
  { id: 'm_skilled_chef', tier: 3, jp: '板前の腕', zh: '廚師的手藝',
    desc: '腕前 70 以上の料理人を雇いましょう。調理が速く、味の評價も上がります。',
    goal: { kind: 'staffSkill', target: 70, extra: 'chef' }, reward: { cash: 120000, title: '料理長' } },
  { id: 'm_cook_500', tier: 3, jp: '500 品を調理', zh: '累計出餐 500 道',
    desc: '厨房で累計 500 品をつくりましょう。',
    goal: { kind: 'cookDishes', target: 500 }, reward: { cash: 130000 } },
  { id: 'm_kinds_8', tier: 3, jp: '八つの客層', zh: '八種客層',
    desc: '8 種類の客層をお迎えしましょう。品書きと雰囲気で客層は変わります。',
    goal: { kind: 'kindsServed', target: 8 }, reward: { cash: 90000, fame: 2 } },
  { id: 'm_uniforms_4', tier: 3, jp: '制服を揃える', zh: '制服要整齊',
    desc: '4 種類以上の制服を従業員に着せましょう。店の印象が変わります。',
    goal: { kind: 'uniforms', target: 4 }, reward: { cash: 70000 } },
  { id: 'm_specialty_3', tier: 3, jp: '名物を三つ', zh: '三道名物',
    desc: 'この土地の名物を 3 品以上メニューに入れましょう。來客と単価が上がります。',
    goal: { kind: 'specialties', target: 3 }, reward: { cash: 100000, fame: 1 } },
  { id: 'm_famous_kinds', tier: 3, jp: '有名人の客層', zh: '名流客層上門',
    desc: '俳優・人氣タレント・テレビ取材クルーなど、有名人の客層を 2 種類お迎えしましょう。接客が良ければ大きく宣傳してくれます。',
    goal: { kind: 'kindsServed', target: 2 }, reward: { cash: 120000, fame: 2 } },
  { id: 'm_uniforms_eight', tier: 3, jp: '制服を八種類', zh: '八種制服',
    desc: '8 種類以上の制服を揃えましょう。場面ごとに着替えると接客の氣合いも変わります。',
    goal: { kind: 'uniforms', target: 8 }, reward: { cash: 130000, title: '制服コレクター' } },

  // ── tier 4：腕試し ─────────────────────────────────────────────────
  { id: 'm_storm_service', tier: 4, jp: '嵐の日の営業', zh: '暴風雨也要營業',
    desc: '荒天（暴風雨・みぞれ・雪）の日に累計 25 名をご案内しましょう。',
    goal: { kind: 'severeServed', target: 25 }, reward: { cash: 160000, title: '雨ニモマケズ' } },
  { id: 'm_third_floor', tier: 4, jp: '三階建て', zh: '三層樓店面',
    desc: '店舗を 3 階まで増築しましょう。',
    goal: { kind: 'floors', target: 3 }, reward: { cash: 400000, title: '三階建ての主' } },
  { id: 'm_net_300k', tier: 4, jp: '一日の利益 ¥300,000', zh: '單日淨利 30 萬',
    desc: 'いずれかの日の営業利益を ¥300,000 以上にしましょう。',
    goal: { kind: 'netProfit', target: 300000 }, reward: { cash: 200000 } },
  { id: 'm_star_4', tier: 4, jp: '四つ星', zh: '四星評價',
    desc: '店の星級を 4 にしましょう。',
    goal: { kind: 'stars', target: 4 }, reward: { cash: 250000, fame: 4 } },
  { id: 'm_queue_5', tier: 4, jp: '行列五組', zh: '排隊五組',
    desc: '同時に 5 組以上の行列をつくりましょう（断られないことが前提です）。',
    goal: { kind: 'maxQueue', target: 5 }, reward: { cash: 110000, title: '行列のできる店' } },
  { id: 'm_ace_waiter', tier: 4, jp: '看板ホール', zh: '招牌外場',
    desc: '腕前 80 以上のホール（外場）を雇いましょう。行列のさばき方がまるで変わります。',
    goal: { kind: 'staffSkill', target: 80, extra: 'waiter' }, reward: { cash: 140000, title: '看板ホール' } },
  { id: 'm_cook_1500', tier: 4, jp: '1500 品の経験', zh: '累計 1500 道',
    desc: '厨房で累計 1,500 品をつくりましょう。手数が店の厚みになります。',
    goal: { kind: 'cookDishes', target: 1500 }, reward: { cash: 260000, title: '鉄鍋の職人' } },

  // ── tier 5：一流店への道 ───────────────────────────────────────────
  { id: 'm_fame_80', tier: 5, jp: '評價 80', zh: '評價 80',
    desc: '評価（人気）を 80 以上にしましょう。',
    goal: { kind: 'fame', target: 80 }, reward: { cash: 500000, fame: 5, title: '名店' } },
  { id: 'm_million_day', tier: 5, jp: '日商 ¥1,000,000', zh: '單日營業額 100 萬',
    desc: '1 日の売上 ¥1,000,000 を達成しましょう。',
    goal: { kind: 'revenue', target: 1000000, scope: 'day' }, reward: { cash: 400000, fame: 3 } },
  { id: 'm_all_kinds', tier: 5, jp: '全客層制覇', zh: '全客層制霸',
    desc: '15 種類すべての客層をお迎えしましょう。',
    goal: { kind: 'kindsServed', target: 15 }, reward: { cash: 350000, title: '萬人受け' } },
  { id: 'm_cash_10m', tier: 5, jp: '現金 ¥10,000,000', zh: '現金一千萬',
    desc: '所持金を ¥10,000,000 以上にしましょう。',
    goal: { kind: 'cash', target: 10000000 }, reward: { cash: 500000, fame: 3, title: '大旦那' } },
  { id: 'm_pet_twelve', tier: 5, jp: 'ペットの常連', zh: '寵物常客',
    desc: 'ペット連れのお客様を累計 12 組ご案内しましょう。',
    goal: { kind: 'petGroups', target: 12 }, reward: { cash: 140000, fame: 2, title: 'ペット友の会' } },
  { id: 'm_twenty_days', tier: 5, jp: '二十日の暖簾', zh: '第二十天的暖簾',
    desc: '20 日以上営業を続けましょう。暖簾が街に根づいた証拠です。',
    goal: { kind: 'days', target: 20 }, reward: { cash: 220000 } },
  { id: 'm_famous_visits', tier: 5, jp: '有名人御用達', zh: '名流御用店',
    desc: '俳優・人氣タレント・テレビ取材クルーなど、有名人の客層をすべてお迎えしましょう。',
    goal: { kind: 'kindsServed', target: 3 }, reward: { cash: 300000, fame: 3, title: '有名人御用達' } },
  { id: 'm_restroom_fifty', tier: 5, jp: '清掃五十回', zh: '清掃五十回',
    desc: 'トイレ清掃を累計 50 回行いましょう。清潔さこそ一流店の最低條件です。',
    goal: { kind: 'cleanRestroom', target: 50 }, reward: { cash: 240000, fame: 1 } },
  { id: 'm_rain_two_hundred', tier: 5, jp: '雨ニモマケズ', zh: '風雨無阻',
    desc: '荒天（暴風雨・雪・みぞれ・猛暑）の日に累計 200 名をご案内しましょう。',
    goal: { kind: 'severeServed', target: 200 }, reward: { cash: 320000, fame: 2, equipment: 'security_host' } },
  { id: 'm_cash_30m', tier: 5, jp: '現金 ¥30,000,000', zh: '現金三千萬',
    desc: '所持金を ¥30,000,000 以上にしましょう。次の一手のための軍資金です。',
    goal: { kind: 'cash', target: 30000000 }, reward: { cash: 420000, fame: 3, equipment: 'fire_system' } }
];

export const MISSION_IDS = MISSIONS.map((m) => m.id);
export const MISSION_TIERS = [1, 2, 3, 4, 5];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

export function missionsForTier(tier) {
  return MISSIONS.filter((m) => m.tier === tier);
}

/** 依頼の説明用ラベル（HUD と レポートで共用） */
export function goalLabel(goal) {
  const base = GOAL_KINDS[goal?.kind] || goal?.kind || '目標';
  return goal?.scope === 'day' ? `1日の${base}` : base;
}

export default { MISSIONS, MISSION_IDS, MISSION_TIERS, GOAL_KINDS, missionById, missionsForTier, goalLabel };
