// ============================================================================
// src/ui/settle.js — 全螢幕事件畫面（週結算／升星／年度大獎／破產結局）
//   匯出（main.js 會呼叫，簽名固定）：
//     showWeekSettle({ state, ui, store })  週日 22:00 雜誌結算
//     showStarUp({ state, from, to, ui })   升星慶祝
//     showAnnualAward({ state, ui })        年度大獎 The Greatest Restaurant of the Year
//     showGameOver({ state, ui, store })    破產結局
//     hideCurtain()                         關閉並清空 #curtain
//     isCurtainOpen()                       目前是否有事件畫面
//   派送 action : ACK_SETTLE {}            （週結算「繼續營業」）
//                 NEW_GAME {seed}          （破產後「重新開始」，需先確認）
//   渲染位置   : #curtain（外殼已提供 .curtain-card / .curtain-head / .curtain-body 樣式）
//   注意       : 所有事件畫面只能用它自己的按鈕關閉（沒有點背景關閉），hideCurtain() 會清空 DOM。
//   依據       : docs/ARCHITECTURE.md §3.4、§4 Action、§5.4 ui 物件
//                docs/GAME_PROMPT.md §3.7 星級、§3.8 雜誌週排名、§3.12 財務、§6 UI/UX 流程
// ============================================================================
import * as DATA from '../data/index.js';
import { MAX_STARS, STAR_REQS } from '../core/balance.js';
import {
  h, clear, button, bar, stars, money, pct, statRow, section, hintbox, tag, emptyState, confirmDialog
} from './widgets.js';

/* --------------------------------------------------------------- 共用常數 */

const MAG_CATEGORIES = [
  { id: 'taste', label: '口味' },
  { id: 'service', label: '服務' },
  { id: 'decor', label: '裝潢' },
  { id: 'price', label: '價格' },
  { id: 'popularity', label: '人氣' }
];

/** 畫面用的「額外條件」文案（index = 目標星級）。分數門檻一律吃 core/balance.js#STAR_REQS。 */
const STAR_EXTRA = [
  null,
  '開業即達標',
  '營業滿 7 天',
  '週排名進前 8 名',
  '週排名進前 3 名，且曾拿過第一',
  '連兩週雜誌第一，評價 460 / 435',
  '營業滿 50 天、連兩週第一，且本週排名仍在前 2 名',
  '連三週雜誌總排名第一（評價 495 / 490）'
];

/** GAME_PROMPT §3.7（index = 星級）；金額門檻直接吃 core/balance.js#STAR_REQS，避免兩份表走鐘 */
const STAR_REQ = STAR_REQS.map((r, i) => (r
  ? { community: r.community, outside: r.outside, extra: STAR_EXTRA[i] ?? r.text }
  : null));

const COMMUNITY_BONUS = 200000;   // 每週一發放的社區獎金（原作約 20 萬）

/* --------------------------------------------------------------- 共用小工具 */

function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }

function num(v, digits = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function sumOf(list, key) {
  return (Array.isArray(list) ? list : []).reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0);
}

function dayNet(row) {
  const explicit = Number(row?.profit);
  if (Number.isFinite(explicit)) return explicit;
  return (Number(row?.revenue) || 0) + (Number(row?.tips) || 0) - (Number(row?.spend) || 0);
}

function statLine(label, text, kind) {
  const v = h('span', { class: 'v' }, String(text));
  const row = statRow(label, v, kind ? { kind } : {});
  return row;
}

function clampStars(n) { return Math.max(1, Math.min(MAX_STARS, Math.round(Number(n) || 1))); }

function nextStarReq(stars0) {
  const cur = clampStars(stars0);
  if (cur >= MAX_STARS) return null;
  return { star: cur + 1, ...(STAR_REQ[cur + 1] || STAR_REQ[MAX_STARS]) };
}

function magRow(rank, name, score, isMe) {
  return h('div', { class: `mag-row${isMe ? ' me' : ''}` },
    h('span', { class: 'rank' }, Number.isFinite(Number(rank)) && Number(rank) > 0 ? `#${int(rank)}` : '—'),
    h('span', { class: 'nm' }, String(name ?? '（不明店家）')),
    h('span', { class: 'sc' }, Number.isFinite(Number(score)) ? num(score, 1) : '—'));
}

/** 五榜其中一榜：優先吃 stats.magazine.rank[cat].topList，其次吃 WeeklyStat.ranks/scores/topList */
function buildMagBoard(cat, state, weekly) {
  const entry = state?.stats?.magazine?.rank?.[cat.id];
  const isTotal = cat.id === 'total';
  const top = Array.isArray(entry?.topList)
    ? entry.topList
    : (isTotal && Array.isArray(weekly?.topList) ? weekly.topList : []);
  const myRank = Number(entry?.rank ?? (isTotal ? weekly?.totalRank : weekly?.ranks?.[cat.id] ?? weekly?.rank?.[cat.id]));
  const myScore = Number(entry?.score ?? weekly?.scores?.[cat.id]);
  const list = h('div', { class: 'mag-list' });

  if (top.length) {
    const rows = top.slice(0, 8).map((item, idx) => magRow(
      Number.isFinite(Number(item?.rank)) ? item.rank : idx + 1,
      item?.name ?? '（不明店家）',
      item?.score,
      !!item?.me
    ));
    rows.forEach((r) => list.appendChild(r));
    let sawMe = top.some((item) => !!item?.me);
    if (!sawMe && (Number.isFinite(myRank) || Number.isFinite(myScore))) {
      list.appendChild(magRow(myRank, '本店（你）', myScore, true));
      sawMe = true;
    }
    if (top.length > 8) list.appendChild(h('div', { class: 'muted' }, `…另有 ${top.length - 8} 家同業`));
    if (!sawMe) list.appendChild(h('div', { class: 'muted' }, '本週沒有排進這個榜。'));
  } else if (Number.isFinite(myRank) || Number.isFinite(myScore)) {
    list.appendChild(magRow(myRank, '本店（你）', myScore, true));
  } else {
    list.appendChild(h('div', { class: 'muted' }, '本週這個榜還沒有資料。'));
  }

  const right = `${Number.isFinite(myRank) && myRank > 0 ? `第 ${int(myRank)} 名` : '未入榜'}`
    + `${Number.isFinite(myScore) ? ` · ${num(myScore, 1)} 分` : ''}`;
  return { el: section({ title: cat.label, children: [list], right }).el, rank: myRank, score: myScore };
}

/** 本週的 DailyStat 切片（WeeklyStat 沒有存 tips/avgMood/支出細項，用日報表補齊） */
function weekRows(state, weekly) {
  const hist = Array.isArray(state?.stats?.history) ? state.stats.history : [];
  const s = Number(weekly?.startDay);
  const e = Number(weekly?.endDay);
  const rows = hist.filter((row) => {
    const d = Number(row?.day);
    if (!Number.isFinite(d)) return false;
    if (Number.isFinite(s) && d < s) return false;
    if (Number.isFinite(e) && d > e) return false;
    return true;
  });
  return rows.length ? rows : hist.slice(-7);
}

function weekAvgMood(state, weekly) {
  const direct = Number(weekly?.avgMood);
  if (Number.isFinite(direct)) return direct;
  const moods = weekRows(state, weekly)
    .map((row) => Number(row?.avgMood))
    .filter((n) => Number.isFinite(n));
  if (!moods.length) return null;
  return moods.reduce((a, b) => a + b, 0) / moods.length;
}

/** 雜誌總排名：模擬層寫在 stats.magazine.lastTotalRank */
function magazineTotalRank(state) {
  const mag = state?.stats?.magazine ?? {};
  const list = Array.isArray(state?.stats?.weekly) ? state.stats.weekly : [];
  const n = Number(mag.lastTotalRank ?? mag.totalRank ?? list[list.length - 1]?.totalRank);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------- #curtain 生命週期 */

function curtainEl() {
  let node = document.getElementById('curtain');
  if (!node) {
    node = h('div', { id: 'curtain' });
    document.body.appendChild(node);
  }
  return node;
}

/** 清空並移除 #curtain 的 show 類別（不留下任何殘留 DOM） */
export function hideCurtain() {
  try {
    const node = document.getElementById('curtain');
    if (!node) return;
    clear(node);
    node.classList.remove('show');
  } catch { /* 沒有 DOM 時什麼都不做 */ }
}

export function isCurtainOpen() {
  try {
    const node = document.getElementById('curtain');
    return !!(node && node.classList.contains('show') && node.firstChild);
  } catch { return false; }
}

/** 開啟事件畫面：先清空再掛上新的卡片（重複呼叫不會疊圖） */
function openCurtain(title, bodyNodes, buttons) {
  const root = curtainEl();
  clear(root);
  const body = h('div', { class: 'curtain-body' }, ...bodyNodes,
    buttons && buttons.length ? h('div', { class: 'modal-btns' }, ...buttons) : null);
  const card = h('div', { class: 'curtain-card' },
    h('div', { class: 'curtain-head' }, String(title)),
    body);
  root.appendChild(card);
  root.classList.add('show');
  return { root, card, body };
}

function playSfx(ui, name) {
  try {
    if (ui && typeof ui.sfx === 'function') ui.sfx(name);
  } catch { /* 音效不是必要條件 */ }
}

async function ask(ui, opts) {
  try {
    if (ui && typeof ui.confirm === 'function') return !!(await ui.confirm(opts));
  } catch { /* 落回內建對話框 */ }
  try { return !!(await confirmDialog(opts)); } catch { return false; }
}

/* ===========================================================================
   1) 週日結算
   =========================================================================== */

export function showWeekSettle({ state, ui, store }) {
  const S = state ?? {};
  const weeklyList = Array.isArray(S?.stats?.weekly) ? S.stats.weekly : [];
  const weekly = weeklyList[weeklyList.length - 1] ?? null;

  const day = int(S?.day) || 1;
  const week = Number.isFinite(Number(weekly?.week))
    ? int(weekly.week)
    : Math.max(1, Math.ceil(day / 7));

  const rows = weekRows(S, weekly);
  const revenue = Number.isFinite(Number(weekly?.revenue)) ? Number(weekly.revenue) : sumOf(rows, 'revenue');
  const profit = Number.isFinite(Number(weekly?.profit)) ? Number(weekly.profit) : sumOf(rows, 'profit');
  const tips = sumOf(rows, 'tips');
  const spendFromRows = sumOf(rows, 'spend');
  const spend = Number.isFinite(Number(weekly?.spend))
    ? Number(weekly.spend)
    : (spendFromRows > 0 ? spendFromRows : Math.max(0, revenue + tips - profit));
  const guests = Number.isFinite(Number(weekly?.guests)) ? int(weekly.guests) : int(sumOf(rows, 'guests'));
  const served = Number.isFinite(Number(weekly?.served)) ? int(weekly.served) : int(sumOf(rows, 'served'));
  const angry = Number.isFinite(Number(weekly?.angry)) ? int(weekly.angry) : int(sumOf(rows, 'angry'));
  const avgMood = weekAvgMood(S, weekly);
  const prize = int(weekly?.prize);
  const totalRank = magazineTotalRank(S);

  const rep = S?.reputation ?? {};
  const community = Number(rep.community) || 0;
  const outside = Number(rep.outside) || 0;
  const stars0 = clampStars(S?.stars);
  const req = nextStarReq(stars0);

  const bodyParts = [];
  playSfx(ui, 'settle');

  bodyParts.push(hintbox('雜誌每週日 22:00 結算五大榜，名次越前面知名度長越快；'
    + `每週一 00:00 還會發放社區獎金 ${money(COMMUNITY_BONUS)}。`));

  if (!weekly) {
    bodyParts.push(emptyState('本週統計資料尚未產生（第 ' + day + ' 天）—— 結算完就會有完整數字。'));
  }

  /* 財務摘要 */
  const finance = section({ title: `本週財務摘要（第 ${int(weekly?.startDay) || Math.max(1, day - 6)} – ${int(weekly?.endDay) || day} 天）`, children: [
    h('div', { class: 'grid2' },
      statLine('營業額', money(revenue)),
      statLine('支出', money(spend)),
      statLine('淨利', money(profit), profit < 0 ? 'bad' : 'good'),
      statLine('小費', money(tips)),
      statLine('來客數', `${guests} 人`),
      statLine('服務完成', `${served} 人`),
      statLine('平均心情', avgMood === null ? '—' : `${avgMood >= 0 ? '+' : ''}${avgMood.toFixed(1)} 分`),
      statLine('雜誌獎金', prize > 0 ? money(prize) : '—', prize > 0 ? 'good' : undefined),
      statLine('生氣離開', `${angry} 人`, angry > Math.max(3, guests * 0.1) ? 'bad' : undefined),
      statLine('服務完成率', guests > 0 ? pct((served / guests) * 100, 1) : '—')
    )
  ] });
  bodyParts.push(finance.el);

  /* 雜誌五榜（加碼總排名榜；模擬層把總榜放在 stats.magazine.rank.total） */
  const boards = MAG_CATEGORIES.map((cat) => buildMagBoard(cat, S, weekly));
  const totalBoard = buildMagBoard({ id: 'total', label: '總排名' }, S, weekly);
  bodyParts.push(section({
    title: '雜誌五大榜',
    right: totalRank ? `總排名 第 ${totalRank} 名` : '總排名 —',
    children: [...boards.map((b) => b.el), totalBoard.el]
  }).el);

  /* 評價雙桶與升星門檻 */
  const commBar = bar({ value: community, max: 500, label: '社區評價', color: (v) => (v >= 350 ? '#1f6b3f' : '#9c2a20'), format: (v) => `${Math.round(v)} / 500` });
  const outBar = bar({ value: outside, max: 500, label: '區外評價', color: (v) => (v >= 350 ? '#1f6b3f' : '#9c2a20'), format: (v) => `${Math.round(v)} / 500` });
  const thresholdNodes = [];
  if (req) {
    commBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: `${Math.min(100, (req.community / 500) * 100).toFixed(1)}%` } }));
    outBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: `${Math.min(100, (req.outside / 500) * 100).toFixed(1)}%` } }));
    const cLeft = req.community - community;
    const oLeft = req.outside - outside;
    thresholdNodes.push(statLine(`★${req.star} 社區門檻`, cLeft > 0 ? `${req.community}（還差 ${cLeft.toFixed(1)} 分）` : `${req.community}（已達標）`, cLeft > 0 ? 'warn' : 'good'));
    thresholdNodes.push(statLine(`★${req.star} 區外門檻`, oLeft > 0 ? `${req.outside}（還差 ${oLeft.toFixed(1)} 分）` : `${req.outside}（已達標）`, oLeft > 0 ? 'warn' : 'good'));
    thresholdNodes.push(statLine('★' + req.star + ' 額外條件', req.extra ?? '—'));
  } else {
    thresholdNodes.push(statLine('星級', `${'★'.repeat(MAX_STARS)} 已滿星，接著挑戰年度大獎`, 'good'));
  }
  bodyParts.push(section({
    title: '評價與星級',
    children: [
      h('div', { class: 'settle-bars' }, commBar.el, outBar.el),
      ...thresholdNodes
    ]
  }).el);

  /* 升星／掉星通知：比較「上一次結算時的星級」與本週結算記錄的星級 */
  const prevWeek = weeklyList.length > 1 ? weeklyList[weeklyList.length - 2] : null;
  const starsAtPrev = Number.isFinite(Number(prevWeek?.stars)) ? int(prevWeek.stars) : null;
  const starsAtSettle = Number.isFinite(Number(weekly?.stars)) ? int(weekly.stars) : stars0;
  const notice = [];
  if (starsAtPrev !== null && starsAtSettle > starsAtPrev) {
    notice.push(h('div', { class: 'row' }, tag('升星', 'gold'),
      h('span', {}, `本週結算後星級提升到 ★${starsAtSettle} —— 新地點與新菜色已經解鎖，快去「搬遷資訊」看看！`)));
  } else if (starsAtPrev !== null && starsAtSettle < starsAtPrev) {
    notice.push(h('div', { class: 'row' }, tag('掉星', 'bad'),
      h('span', {}, `評價連續低於門檻，星級掉到 ★${starsAtSettle}。把售價、調理時間與動線重新檢查一遍吧。`)));
  } else if (req && community >= req.community && outside >= req.outside) {
    notice.push(h('div', { class: 'row' }, tag('門檻達成', 'ok'),
      h('span', {}, `兩桶評價都達到 ★${req.star} 門檻（${req.extra ?? '無額外條件'}），結算時就會評定星級。`)));
  } else {
    notice.push(h('div', { class: 'row' }, tag(`★${stars0}`, 'info'),
      h('span', { class: 'muted' }, '本週星級維持不變。想升星：先顧評價兩桶，再看雜誌總排名與營業天數。')));
  }
  if (req) {
    const cLeft = Math.max(0, req.community - community);
    const oLeft = Math.max(0, req.outside - outside);
    notice.push(statLine(`距 ★${req.star} 還差`, `社區 ${cLeft.toFixed(1)} 分 ／ 區外 ${oLeft.toFixed(1)} 分`, (cLeft + oLeft) > 0 ? 'warn' : 'good'));
  }
  bodyParts.push(section({ title: '星級評定', children: notice }).el);

  /* 社區獎金 */
  bodyParts.push(hintbox(`社區獎金：每週一 00:00 發放 ${money(COMMUNITY_BONUS)}，直接進現金。`
    + ' 這是原作最穩定的被動收入 —— 就算生意普通，撐著別倒就會有錢。'
    + ' 另外雜誌總排名前 8 名還有獎金：第 1 名 NT$ 150,000、前 3 名 NT$ 60,000、前 8 名 NT$ 20,000。'));

  openCurtain(`週日結算 · 第 ${week} 週`, bodyParts, [
    button('繼續營業', () => {
      try {
        if (store && typeof store.dispatch === 'function') {
          const res = store.dispatch({ type: 'ACK_SETTLE' });
          if (res && res.ok === false && ui && typeof ui.toast === 'function') ui.toast(res.error || '結算關閉失敗', 'bad');
        }
      } catch (err) {
        if (ui && typeof ui.toast === 'function') ui.toast(err?.message || '結算關閉失敗', 'bad');
      }
      hideCurtain();
    }, { kind: 'primary' })
  ]);
}

/* ===========================================================================
   2) 升星慶祝
   =========================================================================== */

export function showStarUp({ state, from, to, ui }) {
  const S = state ?? {};
  const fromN = clampStars(from ?? S?.stars);
  const toN = clampStars(to ?? (fromN + 1));
  playSfx(ui, 'star');

  const starLine = h('div', { class: 'star-pop row', style: { 'justify-content': 'center', gap: '10px' } },
    stars(toN));
  const bodyParts = [
    h('div', { class: 'award-big' }, `${'★'.repeat(toN)} 升星！`),
    h('div', { class: 'award-sub' }, `你的餐廳從 ★${fromN} 升上了 ★${toN} —— ${locName(S?.locationId)}的老闆，現在走路有風。`),
    starLine
  ];

  /* 新解鎖地點 */
  const newLocations = [];
  try {
    const all = typeof DATA?.locationsForStars === 'function' ? DATA.locationsForStars(toN) : null;
    const before = typeof DATA?.locationsForStars === 'function' ? DATA.locationsForStars(fromN) : null;
    if (Array.isArray(all)) {
      const beforeIds = new Set((Array.isArray(before) ? before : []).map((l) => l?.id));
      for (const loc of all) {
        if (!beforeIds.has(loc?.id)) newLocations.push(loc);
      }
    } else if (Array.isArray(DATA?.LOCATIONS)) {
      for (const loc of DATA.LOCATIONS) {
        const need = Number(loc?.starsRequired ?? 99);
        if (need > fromN && need <= toN) newLocations.push(loc);
      }
    }
  } catch { /* 資料模組尚未就緒時就只顯示星級 */ }

  /* 新解鎖菜色數量 */
  let newDishCount = 0;
  try {
    if (typeof DATA?.dishesForStars === 'function') {
      const after = DATA.dishesForStars(toN);
      const before = DATA.dishesForStars(fromN);
      if (Array.isArray(after) && Array.isArray(before)) newDishCount = Math.max(0, after.length - before.length);
    } else if (Array.isArray(DATA?.DISHES)) {
      newDishCount = DATA.DISHES.filter((d) => {
        const need = Number(d?.unlockStars ?? 99);
        return need > fromN && need <= toN && !d?.secret;
      }).length;
    }
  } catch { /* 同上 */ }

  const unlockLines = [];
  unlockLines.push(statLine('可上架料理', `新增 ${newDishCount} 道（菜單上限也提高了）`, newDishCount > 0 ? 'good' : undefined));
  if (newLocations.length) {
    for (const loc of newLocations) {
      unlockLines.push(statLine('新地點', `${loc?.name ?? loc?.id ?? '未知地點'}（★${int(loc?.starsRequired)} ／ 日租金 ${money(loc?.rentPerDay)}）`, 'good'));
    }
  } else {
    unlockLines.push(statLine('新地點', '這次沒有新地點（高星級主要解鎖新城市與更大的客群，菜單與上限也一起提高）'));
  }
  bodyParts.push(section({ title: '本次解鎖', children: unlockLines }).el);
  bodyParts.push(hintbox('星級越高，顧客組成會越來越挑：評論家、VIP 出現的機率上升，'
    + '他們給的分數權重也更高（評論家 ×5）。與此同時，租金、薪資與客人的期待都會一起變高。'));

  openCurtain(`升星 · ★${toN}`, bodyParts, [
    button('太棒了！', () => hideCurtain(), { kind: 'primary' })
  ]);
}

function locName(locationId) {
  try {
    if (typeof DATA?.getLocation === 'function') {
      const loc = DATA.getLocation(locationId);
      if (loc?.name) return loc.name;
    }
  } catch { /* 落回線性搜尋 */ }
  const list = Array.isArray(DATA?.LOCATIONS) ? DATA.LOCATIONS : [];
  return list.find((l) => l?.id === locationId)?.name ?? '本店';
}

/* ===========================================================================
   3) 年度大獎
   =========================================================================== */

export function showAnnualAward({ state, ui }) {
  const S = state ?? {};
  playSfx(ui, 'star');

  const history = Array.isArray(S?.stats?.history) ? S.stats.history : [];
  const totalProfit = history.reduce((acc, row) => acc + dayNet(row), 0);
  const totalGuests = sumOf(history, 'guests');
  const loc = locName(S?.locationId);
  const starsN = clampStars(S?.stars);
  const secretUnlocked = !!S?.flags?.secretUnlocked;

  const secretNames = (() => {
    try {
      const list = Array.isArray(DATA?.DISHES) ? DATA.DISHES.filter((d) => d?.secret) : [];
      return list.slice(0, 2).map((d) => d?.name).filter(Boolean);
    } catch { return []; }
  })();

  const bodyParts = [
    h('div', { class: 'award-big' }, 'The Greatest Restaurant of the Year'),
    h('div', { class: 'award-sub' }, '年度最佳餐廳 —— 全台灣都在問：這家店到底是誰開的？'),
    h('div', { class: 'star-pop row', style: { 'justify-content': 'center' } }, stars(starsN)),
    section({ title: '得獎資料', children: [
      statLine('餐廳地點', `${loc}（${history.length} 個營業日）`),
      statLine('星級', `★${starsN} / ★${MAX_STARS}`),
      statLine('總淨利', money(totalProfit), totalProfit < 0 ? 'bad' : 'good'),
      statLine('總來客數', `${int(totalGuests)} 人`),
      statLine('知名度', `${int(S?.fame)} / 100`)
    ] }).el,
    hintbox(secretUnlocked
      ? `兩道隱藏的歌名料理已經解鎖${secretNames.length ? `：${secretNames.join('、')}` : ''} —— 到「菜單」面板上架，讓老饕們聞香而來。`
      : '年度評比第一的獎勵是兩道隱藏的歌名料理：到「菜單」面板就能看到它們。'),
    hintbox('獎盃拿到手，遊戲還沒結束：繼續把每週排名維持在前面，'
      + '挑戰連續年度第一，或者搬去澎湖馬公、墾丁大街開一間最貴最時尚的店。')
  ];

  openCurtain('年度大獎', bodyParts, [
    button('接受獎盃', () => hideCurtain(), { kind: 'primary' })
  ]);
}

/* ===========================================================================
   4) 破產結局
   =========================================================================== */

export function showGameOver({ state, ui, store }) {
  const S = state ?? {};
  playSfx(ui, 'alarm');

  const history = Array.isArray(S?.stats?.history) ? S.stats.history : [];
  const totalRevenue = sumOf(history, 'revenue');
  const totalProfit = history.reduce((acc, row) => acc + dayNet(row), 0);
  const totalGuests = sumOf(history, 'guests');
  const totalAngry = sumOf(history, 'angry');
  const best = history.reduce((acc, row) => {
    const rev = Number(row?.revenue) || 0;
    return rev > acc.rev ? { rev, day: int(row?.day) } : acc;
  }, { rev: 0, day: 0 });
  const rep = S?.reputation ?? {};

  const bodyParts = [
    h('div', { class: 'award-big', style: { color: '#9c2a20', 'text-shadow': '2px 2px 0 #4a1008' } }, '破產收店'),
    h('div', { class: 'award-sub' }, `現金 ${money(S?.cash)} —— 負債已經連續超過 7 天，房東、供應商與員工都來討錢了。`),
    hintbox('《夢幻西餐廳》的規矩：現金為負超過 7 天就結束營業。破產不是死路 —— '
      + '可以讀取存檔重來，或者換個地點、換個菜單、換個動線，重新開一間店。'),
    section({ title: '本局統計', children: [
      statLine('營業天數', `${history.length} 天`),
      statLine('所在位置', locName(S?.locationId)),
      statLine('總營業額', money(totalRevenue)),
      statLine('總淨利', money(totalProfit), totalProfit < 0 ? 'bad' : 'good'),
      statLine('最高單日營業額', best.rev > 0 ? `${money(best.rev)}（第 ${best.day} 天）` : '—'),
      statLine('總來客數', `${int(totalGuests)} 人`),
      statLine('生氣離開', `${int(totalAngry)} 人`),
      statLine('最終評價', `社區 ${num(rep.community, 1)} ／ 區外 ${num(rep.outside, 1)}　★${clampStars(S?.stars)}`)
    ] }).el,
    hintbox('下次可以注意這幾件事：調理時間不要低於 20 分鐘、庫存別賣完、'
      + '座位不要太遠離出餐口、空調維持在 22–26℃、每週一記得收社區獎金。')
  ];

  openCurtain('結束營業', bodyParts, [
    button('讀取存檔', () => {
      let opened = false;
      try {
        if (ui && typeof ui.openWindow === 'function') { ui.openWindow('system'); opened = true; }
      } catch { opened = false; }
      hideCurtain();
      if (!opened && ui && typeof ui.toast === 'function') {
        ui.toast('請從下方工具列開啟「系統」視窗讀取存檔。', 'warn');
      }
    }, { kind: 'primary' }),
    button('重新開始', async () => {
      const ok = await ask(ui, {
        title: '重新開始',
        message: '確定要放棄這一局，從中壢新明夜市的一星小店重新來過嗎？\n（想保留這局的話，請先選「讀取存檔」。）',
        okLabel: '重新開始', cancelLabel: '取消'
      });
      if (!ok) return;
      try {
        if (store && typeof store.dispatch === 'function') {
          const res = store.dispatch({ type: 'NEW_GAME', seed: Date.now() & 0xffffffff });
          if (res && res.ok === false && ui && typeof ui.toast === 'function') ui.toast(res.error || '開新遊戲失敗', 'bad');
        }
      } catch (err) {
        if (ui && typeof ui.toast === 'function') ui.toast(err?.message || '開新遊戲失敗', 'bad');
      }
      hideCurtain();
    })
  ]);
}
