// ============================================================================
// src/ui/panels/report.js — 營運報表 / 雜誌排名面板
//   面板 id    : 'report'
//   標題 / 圖示: 營運報表 / 📊
//   建議尺寸   : 640 × 480
//   匯出       : createReportPanel({ store, ui, win })
//   分頁       : 今日 / 歷史 / 雜誌排名 / 評價
//   派送 action: 無 —— 本面板純唯讀報表，所有變更請由 菜單／員工／裝潢／環境設定 面板進行。
//   依據       : docs/ARCHITECTURE.md §3 狀態契約、§4 Action 一覽、§5.3 面板契約
//                docs/GAME_PROMPT.md §3.7 星級、§3.8 雜誌週排名、§3.12 財務
// ============================================================================
import {
  h, clear, tabs, table, bar, stars, money, pct, statRow, section, hintbox, emptyState, tag
} from '../widgets.js';

/* --------------------------------------------------------------- 共用小工具 */

const WEATHER_LABEL = {
  sunny: '晴天', cloudy: '陰天', rain: '下雨', storm: '豪雨', cold: '寒流', heat: '熱浪'
};

const WEEKDAY_LABEL = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

/** GAME_PROMPT §3.7：兩桶評價都要達標才能升星（index = 目標星級 1..5） */
const STAR_REQ = [
  null,
  { community: 350, outside: 350, extra: '開業即達標' },
  { community: 380, outside: 360, extra: '營業滿 7 天' },
  { community: 410, outside: 385, extra: '週排名進前 8 名' },
  { community: 435, outside: 410, extra: '週排名進前 3 名，且曾拿過第一' },
  { community: 460, outside: 435, extra: '連兩週雜誌第一，評價 460 / 435' }
];

const MAG_CATEGORIES = [
  { id: 'taste', label: '口味' },
  { id: 'service', label: '服務' },
  { id: 'decor', label: '裝潢' },
  { id: 'price', label: '價格' },
  { id: 'popularity', label: '人氣' }
];

const CUSTOMER_LABEL = {
  student: '學生', office: '上班族', family: '家庭', tourist: '觀光客', critic: '美食評論家', vip: 'VIP'
};

/**
 * 抱怨原因對照表。模擬層實際使用的代碼（src/sim/customer.js#REASON_TEXT）優先，
 * 其餘為防禦性別名；真的遇到沒見過的代碼就原樣顯示。
 */
const COMPLAINT_LABEL = {
  wait_too_long: '等太久', no_table: '等不到位子', sold_out: '點不到餐（賣完）',
  unhappy: '環境或服務太差', closed: '打烊被趕',
  wait: '候位／等餐過久', queue: '候位過久', slow: '上餐太慢', slow_serve: '上餐太慢',
  no_stock: '點不到餐（賣完）', out_of_stock: '點不到餐（賣完）', no_seat: '等不到位子',
  price: '價格太貴', expensive: '價格太貴', taste: '口味不佳', bad_taste: '口味不佳',
  portion: '份量太少', temp: '空調太冷／太熱', temperature: '空調太冷／太熱',
  dirty_restroom: '廁所太髒', restroom: '廁所太髒', dirty_floor: '地板太髒', dirty: '環境太髒',
  noise: '環境太吵', service: '服務態度差', staff: '服務生態度差', broken: '設備故障'
};

const REASON_UNKNOWN = '其他抱怨';

/** 抱怨記錄可能是「新在前」（sim 用 unshift）也可能是「舊在前」，這裡一律整理成新在前 */
function newestFirst(log) {
  const list = Array.isArray(log) ? log.slice() : [];
  if (list.length < 2) return list;
  const a = list[0];
  const b = list[list.length - 1];
  const ka = (Number(a?.day) || 0) * 1440 + (Number(a?.minute) || 0);
  const kb = (Number(b?.day) || 0) * 1440 + (Number(b?.minute) || 0);
  return ka >= kb ? list : list.reverse();
}

function complaintText(entry) {
  const key = entry?.reason ?? entry?.key ?? entry?.type;
  const mapped = COMPLAINT_LABEL[key];
  if (mapped) return mapped;
  const raw = entry?.text ?? entry?.message;
  return raw ? String(raw) : String(key ?? REASON_UNKNOWN);
}

function complaintWhen(entry) {
  const day = Number(entry?.day);
  const minute = Number(entry?.minute);
  if (Number.isFinite(day) && day > 0) return `第 ${Math.round(day)} 天 ${Number.isFinite(minute) ? hhmm(minute) : '--:--'}`;
  return Number.isFinite(minute) ? hhmm(minute) : '時間不明';
}

function complaintDetail(entry) {
  const who = CUSTOMER_LABEL[entry?.type] ?? null;
  const wait = Number(entry?.wait);
  const parts = [];
  if (who) parts.push(who);
  if (Number.isFinite(wait) && wait > 0) parts.push(`等 ${Math.round(wait)} 分`);
  return parts.length ? `（${parts.join('、')}）` : '';
}

function pad2(n) { return String(Math.max(0, Math.round(Number(n) || 0))).padStart(2, '0'); }

/** 遊戲分鐘 → HH:MM */
function hhmm(minute) {
  const m = Number(minute);
  if (!Number.isFinite(m)) return '--:--';
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

function weekdayLabel(day) {
  const n = Number(day);
  if (!Number.isFinite(n)) return '—';
  return WEEKDAY_LABEL[(((Math.round(n) - 1) % 7) + 7) % 7];
}

function weatherLabel(key) {
  if (!key) return '—';
  return WEATHER_LABEL[key] ?? String(key);
}

/** 秒 → 分:秒 */
function waitText(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '0 分 00 秒';
  return `${Math.floor(s / 60)} 分 ${pad2(s % 60)} 秒`;
}

function moodText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '— 分';
  const face = n >= 30 ? '😄' : n >= 0 ? '🙂' : n >= -30 ? '😐' : '🙁';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)} 分 ${face}`;
}

function starText(n) {
  const s = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return s > 0 ? '★'.repeat(s) : '—';
}

function num(v, digits = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }

function sumOf(list, key) {
  return (Array.isArray(list) ? list : []).reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0);
}

function dayNet(row) {
  const explicit = Number(row?.profit);
  if (Number.isFinite(explicit)) return explicit;
  return (Number(row?.revenue) || 0) + (Number(row?.tips) || 0) - (Number(row?.spend) || 0);
}

/** 一個「標籤 : 可更新數值」列 */
function valueRow(label, opts = {}) {
  const v = h('span', { class: 'v' }, '—');
  const row = statRow(label, v, opts);
  return {
    row,
    node: v,
    set(text) { v.textContent = String(text); },
    kind(k) { row.classList.toggle('good', k === 'good'); row.classList.toggle('bad', k === 'bad'); row.classList.toggle('warn', k === 'warn'); }
  };
}

/** 橫向儀表列：標籤 + bar（bar 需要明確寬度才不會塌掉） */
function meterRow(label, barObj) {
  barObj.el.style.flex = '1';
  barObj.el.style.minWidth = '0';
  return h('div', { class: 'row' },
    h('span', { class: 'muted', style: { 'min-width': '66px' } }, label),
    barObj.el);
}

/* ------------------------------------------------------------ 星級進度共用 */

const repColor = (v, max) => {
  const ratio = max > 0 ? v / max : 0;
  if (ratio >= 0.78) return '#1f6b3f';
  if (ratio >= 0.68) return '#9a6a10';
  return '#9c2a20';
};

function nextStarReq(stars) {
  const cur = Math.max(1, Math.min(5, Math.round(Number(stars) || 1)));
  if (cur >= 5) return null;
  return { star: cur + 1, ...(STAR_REQ[cur + 1] || STAR_REQ[5]) };
}

/** 實作上的營業天數門檻（對應 src/core/balance.js STAR_REQS[].days），index = 目標星級 */
const STAR_MIN_DAYS = [0, 0, 7, 14, 21, 35];

/**
 * 下一星的「額外條件」狀態。
 * 文字取自 GAME_PROMPT §3.7；判定則對照模擬層真正使用的欄位
 * （state.day、stats.magazine.lastTotalRank / bestTotalRank / firstPlaceWeeks），
 * 無法判定時回 done:null（顯示「待結算」而不是亂說已達成）。
 */
function starExtraState(req, state) {
  if (!req) return { text: '已達五星，改挑戰年度大獎', days: null, dayOk: null, done: true };
  const day = Number(state?.day);
  const mag = state?.stats?.magazine ?? {};
  const lastRank = Number(mag.lastTotalRank ?? mag.totalRank);
  const bestRank = Number(mag.bestTotalRank);
  const firstWeeks = Number(mag.firstPlaceWeeks) || 0;
  const days = STAR_MIN_DAYS[req.star] ?? 0;
  const dayOk = Number.isFinite(day) ? day >= days : null;

  let done = null;
  if (req.star === 2) {
    done = dayOk;
  } else if (req.star === 3) {
    done = Number.isFinite(lastRank) ? lastRank <= 8 : null;
  } else if (req.star === 4) {
    done = Number.isFinite(lastRank) ? (lastRank <= 3 && bestRank === 1) : null;
  } else if (req.star === 5) {
    done = bestRank === 1 ? firstWeeks >= 2 : null;
  }
  if (done !== null && dayOk === false) done = false;
  return { text: req.extra, days, dayOk, done };
}

/** 雜誌總排名（模擬層寫入 magazine.lastTotalRank） */
function magazineTotalRank(state) {
  const mag = state?.stats?.magazine ?? {};
  const weekly = Array.isArray(state?.stats?.weekly) ? state.stats.weekly : [];
  const lastWeek = weekly[weekly.length - 1] ?? null;
  const n = Number(mag.lastTotalRank ?? mag.totalRank ?? lastWeek?.totalRank);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ===========================================================================
   折線圖（原生 Canvas 2D、無外部資源、1px 手工對齊）
   =========================================================================== */

function drawTrendChart(canvas, history) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;

  // 讓 backing store 盡量接近 CSS 像素寬（1:1 時 1px 線才真正銳利）
  const cssW = Number(canvas.clientWidth) || 0;
  if (cssW > 80 && Math.abs(cssW - Number(canvas.width)) > 2) canvas.width = Math.round(cssW);

  const W = Math.max(120, Number(canvas.width) || 600);
  const H = Math.max(60, Number(canvas.height) || 120);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fdfcf6';
  ctx.fillRect(0, 0, W, H);

  const data = (Array.isArray(history) ? history : []).slice(-30);
  const padL = 54; const padR = 46; const padT = 16; const padB = 20;
  const plotW = Math.max(20, W - padL - padR);
  const plotH = Math.max(20, H - padT - padB);

  // 水平格線 + 外框（+0.5 偏移 = 像素完美 1px）
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#dedac9';
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(padT + (plotH * i) / 4) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  ctx.strokeStyle = '#6e6a5c';
  ctx.strokeRect(padL + 0.5, padT + 0.5, plotW, plotH);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#4b4a44';
  ctx.textBaseline = 'middle';

  if (data.length < 2) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#736f63';
    ctx.font = '12px monospace';
    ctx.fillText('營業紀錄不足（需要至少 2 個營業日）', padL + plotW / 2, padT + plotH / 2);
    return;
  }

  const profits = data.map((d) => (Number.isFinite(Number(d?.profit))
    ? Number(d.profit)
    : (Number(d?.revenue) || 0) + (Number(d?.tips) || 0) - (Number(d?.spend) || 0)));
  const guests = data.map((d) => Number(d?.guests) || 0);

  const pMin = Math.min(0, ...profits);
  const pMax = Math.max(0, ...profits, 1);
  const gMax = Math.max(1, ...guests);
  const pSpan = (pMax - pMin) || 1;

  const xPix = (i) => Math.round(padL + (plotW * i) / (data.length - 1));
  const yProfit = (v) => Math.round(padT + plotH * (1 - (v - pMin) / pSpan));
  const yGuest = (v) => Math.round(padT + plotH * (1 - v / gMax));

  // 左軸（淨利，元）／右軸（來客，人）
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) {
    const frac = i / 4;
    const y = Math.round(padT + plotH * frac) + 0.5;
    ctx.fillText(String(Math.round(pMax - pSpan * frac)), padL - 5, y);
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(gMax * (1 - frac))), padL + plotW + 5, y);
    ctx.textAlign = 'right';
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1f6b3f';
  ctx.fillText('淨利(元)', 2, padT - 7);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1f4f8a';
  ctx.fillText('來客(人)', W - 2, padT - 7);

  // 零線（有虧損日才有意義）
  if (pMin < 0) {
    const y0 = yProfit(0) + 0.5;
    ctx.strokeStyle = '#a9a496';
    ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + plotW, y0); ctx.stroke();
  }

  const polyline = (values, yf) => {
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xPix(i) + 0.5; const y = yf(v) + 0.5;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1f4f8a';
  polyline(guests, yGuest);
  ctx.strokeStyle = '#1f6b3f';
  polyline(profits, yProfit);

  // 資料點：2×2 像素方塊（保留 16-bit 手感）
  ctx.fillStyle = '#1f4f8a';
  guests.forEach((v, i) => ctx.fillRect(xPix(i) - 1, yGuest(v) - 1, 2, 2));
  ctx.fillStyle = '#1f6b3f';
  profits.forEach((v, i) => ctx.fillRect(xPix(i) - 1, yProfit(v) - 1, 2, 2));

  // X 軸日期標籤（避免重疊）
  ctx.fillStyle = '#736f63';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(data.length / 6));
  let lastX = -999;
  for (let i = 0; i < data.length; i += 1) {
    const isLast = i === data.length - 1;
    if (!isLast && i % step !== 0) continue;
    const x = xPix(i);
    if (x - lastX < 22) continue;
    lastX = x;
    ctx.fillText(`第${int(data[i]?.day)}天`, Math.min(padL + plotW - 12, Math.max(padL + 12, x)), padT + plotH + 4);
  }
}

/* ===========================================================================
   面板
   =========================================================================== */

export function createReportPanel({ store, ui, win }) {   // eslint-disable-line no-unused-vars
  const el = h('div', {
    class: 'report-panel',
    style: { display: 'flex', 'flex-direction': 'column', gap: '6px', height: '100%' }
  });

  /* --------------------------------------------------------------- 今日分頁 */
  function buildTodayTab() {
    const rRevenue = valueRow('營業額');
    const rInventory = valueRow('進貨成本');
    const rWages = valueRow('員工薪資');
    const rRent = valueRow('租金');
    const rUtilities = valueRow('水電');
    const rOther = valueRow('其他支出', { hint: '維修／清潔／事件' });
    const rTips = valueRow('小費');
    const rSpend = valueRow('支出合計');
    const rNet = valueRow('淨利', { hint: '營業額＋小費－支出' });

    const rGuests = valueRow('來客數');
    const rServed = valueRow('服務完成');
    const rAngry = valueRow('生氣離開');
    const rServeRate = valueRow('服務完成率', { hint: '完成 ÷ 來客' });
    const rWait = valueRow('平均等待', { hint: '分:秒' });

    const moodBar = bar({
      value: 100, max: 200,
      color: (v) => (v >= 100 ? '#1f6b3f' : '#9c2a20'),
      format: (v) => moodText(v - 100)
    });
    moodBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: '50%' } }));

    const fameBar = bar({ value: 0, max: 100, color: '#1f4f8a', format: (v) => `${Math.round(v)} / 100` });

    const starBox = h('span', { class: 'row' }, '—');

    const commBar = bar({ value: 0, max: 500, color: repColor, format: (v) => `${Math.round(v)} / 500` });
    const commMark = h('div', { class: 'bar-seg', style: { left: '76%' } });
    commBar.track.appendChild(commMark);
    const rCommNeed = valueRow('社區下一星門檻');

    const outBar = bar({ value: 0, max: 500, color: repColor, format: (v) => `${Math.round(v)} / 500` });
    const outMark = h('div', { class: 'bar-seg', style: { left: '72%' } });
    outBar.track.appendChild(outMark);
    const rOutNeed = valueRow('區外下一星門檻');

    const node = h('div', { class: 'report-today', style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '今日損益', children: [
        rRevenue.row, rInventory.row, rWages.row, rRent.row, rUtilities.row, rTips.row, rOther.row, rSpend.row, rNet.row
      ] }).el,
      section({ title: '來客與服務', children: [
        rGuests.row, rServed.row, rAngry.row, rServeRate.row, rWait.row,
        meterRow('平均心情', moodBar)
      ] }).el,
      section({ title: '評價與星級', children: [
        meterRow('知名度', fameBar),
        statRow('星級', starBox),
        meterRow('社區評價', commBar),
        rCommNeed.row,
        meterRow('區外評價', outBar),
        rOutNeed.row
      ] }).el,
      hintbox('淨利 = 營業額 ＋ 小費 － 支出合計。小費不計入營業額，但會進你的口袋。'
        + ' 評價分「社區」與「區外」兩桶，兩桶都過門檻才會升星。')
    );

    let lastKey = null;
    function update(S) {
      const today = S?.stats?.today ?? {};
      const rep = S?.reputation ?? {};
      const stars0 = Math.max(1, Math.min(5, Math.round(Number(S?.stars) || 1)));
      const req = nextStarReq(stars0);
      const key = [
        today.revenue, today.inventory, today.wages, today.rent, today.utilities, today.tips, today.spend,
        today.repairs, today.guests, today.served, today.angry, today.avgWaitSec, today.waitSum, today.waitCount,
        today.moodSum, today.moodCount, today.avgMood,
        rep.community, rep.outside, S?.fame, stars0
      ].join('|');
      if (key === lastKey) return;
      lastKey = key;

      const revenue = int(today.revenue);
      const tips = int(today.tips);
      const spend = int(today.spend);
      const inventory = int(today.inventory);
      const wages = int(today.wages);
      const rent = int(today.rent);
      const utilities = int(today.utilities);
      const repairs = int(today.repairs);
      const net = revenue + tips - spend;

      rRevenue.set(money(revenue));
      rInventory.set(money(inventory));
      rWages.set(money(wages));
      rRent.set(money(rent));
      rUtilities.set(money(utilities));
      rTips.set(money(tips));
      const other = spend - inventory - wages - rent - utilities - repairs;
      rOther.set(other > 0 ? `${money(other)}${repairs > 0 ? `（含維修 ${money(repairs)}）` : ''}` : (repairs > 0 ? `維修 ${money(repairs)}` : '—'));
      rSpend.set(money(spend));
      rNet.set(money(net));
      rNet.kind(net < 0 ? 'bad' : 'good');

      const guests = int(today.guests);
      const served = int(today.served);
      const angry = int(today.angry);
      rGuests.set(`${guests} 人`);
      rServed.set(`${served} 人`);
      rAngry.set(`${angry} 人`);
      rAngry.kind(angry > Math.max(3, guests * 0.1) ? 'bad' : (angry > 0 ? 'warn' : 'good'));
      rServeRate.set(guests > 0 ? pct((served / guests) * 100, 1) : '—');
      rServeRate.kind(guests > 0 && served / guests < 0.85 ? 'warn' : 'good');

      const rawWait = Number(today.avgWaitSec);
      const avgWait = Number.isFinite(rawWait)
        ? rawWait
        : (int(today.waitCount) > 0 ? (Number(today.waitSum) || 0) / int(today.waitCount) : 0);
      rWait.set(waitText(avgWait));
      rWait.kind(avgWait > 300 ? 'bad' : avgWait > 150 ? 'warn' : 'good');

      const moodDirect = Number(today.avgMood);
      const moodCount = int(today.moodCount);
      const mood = Number.isFinite(moodDirect)
        ? moodDirect
        : (moodCount > 0 ? (Number(today.moodSum) || 0) / moodCount : 0);
      moodBar.set(mood + 100, 200);

      const fame = Math.max(0, Math.min(100, Number(S?.fame) || 0));
      fameBar.set(fame, 100);

      clear(starBox);
      starBox.appendChild(stars(stars0));
      starBox.appendChild(h('span', { class: 'muted' }, ` 第 ${stars0} 星`));

      const community = Number(rep.community) || 0;
      const outside = Number(rep.outside) || 0;
      commBar.set(community, 500);
      outBar.set(outside, 500);

      if (req) {
        commMark.style.left = `${Math.min(100, (req.community / 500) * 100).toFixed(1)}%`;
        outMark.style.left = `${Math.min(100, (req.outside / 500) * 100).toFixed(1)}%`;
        const cLeft = req.community - community;
        const oLeft = req.outside - outside;
        rCommNeed.set(cLeft > 0 ? `★${req.star} 需 ${req.community}（還差 ${cLeft.toFixed(1)} 分）` : `★${req.star} 需 ${req.community}（已達標 +${Math.abs(cLeft).toFixed(1)}）`);
        rOutNeed.set(oLeft > 0 ? `★${req.star} 需 ${req.outside}（還差 ${oLeft.toFixed(1)} 分）` : `★${req.star} 需 ${req.outside}（已達標 +${Math.abs(oLeft).toFixed(1)}）`);
        rCommNeed.kind(cLeft > 0 ? 'warn' : 'good');
        rOutNeed.kind(oLeft > 0 ? 'warn' : 'good');
      } else {
        commMark.style.left = '100%';
        outMark.style.left = '100%';
        rCommNeed.set('已達五星，改挑戰年度大獎');
        rOutNeed.set('已達五星，改挑戰年度大獎');
        rCommNeed.kind('good');
        rOutNeed.kind('good');
      }
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------------- 歷史分頁 */
  function buildHistoryTab() {
    const chart = h('canvas', { class: 'report-chart', width: '600', height: '120' });
    const legend = h('div', { class: 'row wrap' },
      h('span', { style: { color: '#1f6b3f', 'font-weight': 'bold' } }, '■ 淨利'),
      h('span', { style: { color: '#1f4f8a', 'font-weight': 'bold' } }, '■ 來客數'),
      h('span', { class: 'muted' }, '最近 30 個營業日')
    );

    const cumulative = {};
    cumulative.days = valueRow('營業天數');
    cumulative.revenue = valueRow('總營業額');
    cumulative.profit = valueRow('總淨利');
    cumulative.guests = valueRow('總來客數');
    cumulative.served = valueRow('總服務完成');
    cumulative.angry = valueRow('總生氣離開');

    const hist = table({
      columns: [
        { key: 'day', label: '日', align: 'num', width: '44px', format: (v) => `第 ${int(v)} 天` },
        { key: 'weather', label: '天氣', format: (v) => weatherLabel(v) },
        { key: 'revenue', label: '營業額', align: 'num', format: (v) => money(v) },
        { key: 'spend', label: '支出', align: 'num', format: (v) => money(v) },
        {
          key: 'profit', label: '淨利', align: 'num',
          format: (v, row) => {
            const n = Number.isFinite(Number(v)) ? Number(v) : dayNet(row);
            return h('span', { style: { color: n < 0 ? '#9c2a20' : '#1f6b3f', 'font-weight': 'bold' } }, money(n));
          }
        },
        { key: 'guests', label: '來客', align: 'num', format: (v) => `${int(v)} 人` },
        { key: 'served', label: '服務', align: 'num', format: (v) => `${int(v)} 人` },
        { key: 'angry', label: '生氣', align: 'num', format: (v) => `${int(v)} 人` },
        { key: 'avgMood', label: '平均心情', align: 'num', format: (v) => moodText(v) },
        { key: 'repCommunity', label: '社區', align: 'num', format: (v) => (Number.isFinite(Number(v)) ? num(v, 0) : '—') },
        { key: 'repOutside', label: '區外', align: 'num', format: (v) => (Number.isFinite(Number(v)) ? num(v, 0) : '—') },
        { key: 'stars', label: '星級', align: 'mid', format: (v) => starText(v) },
        {
          key: 'magazineRank', label: '週排名', align: 'num',
          format: (v) => (Number(v) > 0 ? `第 ${int(v)} 名` : '—')
        }
      ],
      rows: [],
      empty: '還沒有完成任何營業日 —— 打烊結算後就會出現日報表。'
    });
    hist.el.style.maxHeight = '230px';

    const node = h('div', { class: 'report-history', style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '走勢圖', children: [legend, chart] }).el,
      section({ title: '累計成績', children: [
        cumulative.days.row, cumulative.revenue.row, cumulative.profit.row,
        cumulative.guests.row, cumulative.served.row, cumulative.angry.row
      ] }).el,
      section({ title: '每日報表（新 → 舊）', children: [hist.el] }).el
    );

    let lastKey = null;
    let lastHistory = null;
    function update(S) {
      const list = Array.isArray(S?.stats?.history) ? S.stats.history : [];
      const lastRow = list[list.length - 1] ?? {};
      const key = [
        list.length, lastRow.day, lastRow.revenue, lastRow.profit, lastRow.guests, lastRow.avgMood, lastRow.spend
      ].join('|');
      if (key === lastKey) return;
      lastKey = key;

      const totalRevenue = sumOf(list, 'revenue');
      const totalProfit = list.reduce((acc, row) => acc + dayNet(row), 0);
      const totalGuests = sumOf(list, 'guests');
      const totalServed = sumOf(list, 'served');
      const totalAngry = sumOf(list, 'angry');

      cumulative.days.set(`${list.length} 天`);
      cumulative.revenue.set(money(totalRevenue));
      cumulative.profit.set(money(totalProfit));
      cumulative.profit.kind(totalProfit < 0 ? 'bad' : 'good');
      cumulative.guests.set(`${int(totalGuests)} 人`);
      cumulative.served.set(`${int(totalServed)} 人`);
      cumulative.angry.set(`${int(totalAngry)} 人（${totalGuests > 0 ? pct((totalAngry / totalGuests) * 100, 1) : '0%'}）`);
      cumulative.angry.kind(totalGuests > 0 && totalAngry / totalGuests > 0.12 ? 'bad' : 'good');

      hist.setRows([...list].reverse());

      if (lastHistory !== list) {
        drawTrendChart(chart, list);
        lastHistory = list;
      }
    }

    return { el: node, update };
  }

  /* ----------------------------------------------------------- 雜誌排名分頁 */
  function buildMagazineTab() {
    // 五個分類榜 + 總排名榜（模擬層在 stats.magazine.rank.total 另外放一份總榜）
    const BOARDS = [...MAG_CATEGORIES, { id: 'total', label: '總排名' }];

    const rSettleDay = valueRow('上次結算');
    const rTotalRank = valueRow('雜誌總排名');
    const rNextSettle = valueRow('下次結算', { hint: '每週日 22:00' });

    const cats = new Map();
    const catSections = BOARDS.map((cat) => {
      const list = h('div', { class: 'mag-list' });
      const right = h('span', { class: 'right' }, '—');
      const sec = section({ title: cat.label, children: [list], right });
      cats.set(cat.id, { list, right });
      return sec.el;
    });

    const emptyBox = emptyState('還沒有雜誌排名資料 —— 每週日 22:00 進行結算，五個榜各取 1～20 名。');
    const body = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '6px' } }, ...catSections);

    const node = h('div', { class: 'report-magazine', style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '結算資訊', children: [rSettleDay.row, rTotalRank.row, rNextSettle.row] }).el,
      body,
      emptyBox,
      hintbox('雜誌每週日 22:00 結算：口味、服務、裝潢、價格、人氣五個榜，各取 1～20 名。'
        + ' 總排名越前面，知名度（fame）長得越快，來客數也會跟著上升；總排名前 8 名還有雜誌獎金'
        + '（第 1 名 NT$ 150,000、前 3 名 NT$ 60,000、前 8 名 NT$ 20,000），每週一另外發放社區獎金 NT$ 200,000。')
    );

    let lastKey = null;
    function update(S) {
      const mag = S?.stats?.magazine ?? {};
      const rank = (mag.rank && typeof mag.rank === 'object') ? mag.rank : {};
      const hasRank = BOARDS.some((c) => rank[c.id] && typeof rank[c.id] === 'object');

      const settleDay = Number(mag.lastSettleDay) || 0;
      const totalRank = magazineTotalRank(S) ?? 0;
      const key = [settleDay, totalRank, hasRank ? 1 : 0, S?.day, JSON.stringify(rank)].join('|');
      if (key === lastKey) return;
      lastKey = key;

      rSettleDay.set(settleDay > 0 ? `第 ${settleDay} 天（${weekdayLabel(settleDay)} 22:00）` : '尚未結算過');
      rSettleDay.kind(settleDay > 0 ? 'good' : 'warn');
      rTotalRank.set(totalRank > 0 ? `第 ${totalRank} 名` : '—');
      rTotalRank.kind(totalRank > 0 && totalRank <= 8 ? 'good' : undefined);

      const day = int(S?.day) || 1;
      const inWeek = ((day - 1) % 7) + 1;               // day 1 = 週一
      const toSunday = 7 - inWeek;                      // 距離本週日
      const minsNow = int(S?.minute);
      const before2200 = minsNow < 1320;
      const waitDays = toSunday + (toSunday === 0 && !before2200 ? 7 : 0);
      rNextSettle.set(waitDays === 0
        ? (before2200 ? '今天 22:00（本日）' : '下週日 22:00')
        : `${waitDays} 天後的週日 22:00`);

      body.style.display = hasRank ? 'flex' : 'none';
      emptyBox.style.display = hasRank ? 'none' : 'block';

      for (const cat of BOARDS) {
        const ref = cats.get(cat.id);
        if (!ref) continue;
        const entry = rank[cat.id];
        clear(ref.list);
        if (!entry || typeof entry !== 'object') {
          ref.right.textContent = '—';
          ref.list.appendChild(h('div', { class: 'muted' }, '本週尚未取得這個榜的資料。'));
          continue;
        }
        const myRank = Number(entry.rank);
        const myScore = Number(entry.score);
        ref.right.textContent = `${Number.isFinite(myRank) && myRank > 0 ? `第 ${int(myRank)} 名` : '未入榜'}`
          + `${Number.isFinite(myScore) ? ` · ${num(myScore, 1)} 分` : ''}`;

        const top = Array.isArray(entry.topList) ? entry.topList : [];
        if (!top.length) {
          ref.list.appendChild(h('div', {
            class: `mag-row${entry.me !== false ? ' me' : ''}`
          },
            h('span', { class: 'rank' }, Number.isFinite(myRank) ? `#${int(myRank)}` : '—'),
            h('span', { class: 'nm' }, '本店'),
            h('span', { class: 'sc' }, Number.isFinite(myScore) ? num(myScore, 1) : '—')));
          continue;
        }
        top.slice(0, 8).forEach((item, idx) => {
          const isMe = !!(item?.me);
          const r = Number.isFinite(Number(item?.rank)) ? int(item.rank) : idx + 1;
          const sc = Number(item?.score);
          ref.list.appendChild(h('div', { class: `mag-row${isMe ? ' me' : ''}` },
            h('span', { class: 'rank' }, `#${r}`),
            h('span', { class: 'nm' }, String(item?.name ?? '（不明店家）')),
            h('span', { class: 'sc' }, Number.isFinite(sc) ? num(sc, 1) : '—')));
        });
        if (top.length > 8) {
          ref.list.appendChild(h('div', { class: 'muted' }, `…另有 ${top.length - 8} 家同業`));
        }
        // 前 6 名沒有本店時，補一列自己的成績（永遠高亮本店）
        if (!top.some((item) => item?.me) && (Number.isFinite(myRank) || Number.isFinite(myScore))) {
          ref.list.appendChild(h('div', { class: 'mag-row me' },
            h('span', { class: 'rank' }, Number.isFinite(myRank) ? `#${int(myRank)}` : '—'),
            h('span', { class: 'nm' }, '本店（你）'),
            h('span', { class: 'sc' }, Number.isFinite(myScore) ? num(myScore, 1) : '—')));
        }
      }
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------------- 評價分頁 */
  function buildRatingTab() {
    const rComm = valueRow('社區評價');
    const rOut = valueRow('區外評價');
    const rTarget = valueRow('下一星目標');
    const checklist = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '3px' } });

    const complaintTable = table({
      columns: [
        { key: 'reason', label: '抱怨原因' },
        { key: 'count', label: '次數', align: 'num', format: (v) => `${int(v)} 次` }
      ],
      rows: [],
      empty: '今天沒有任何抱怨 —— 繼續保持！'
    });
    complaintTable.el.style.maxHeight = '120px';

    const logBox = h('div', { class: 'mag-list' });

    const node = h('div', { class: 'report-rating', style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '雙桶評價', children: [
        hintbox('本作有兩個獨立的評價桶：'
          + '「社區評價」看的是附近鄰居與老主顧的觀感；「區外評價」看的是外地客、觀光客與美食評論家的評價。'
          + '兩桶都必須達到門檻才能升星 —— 這也是原作最容易卡星的地方。'
          + ' 特別注意：換地點（搬遷）會讓「區外評價」大幅下滑，得靠重新經營慢慢爬回來。'),
        rComm.row, rOut.row, rTarget.row, checklist
      ] }).el,
      section({ title: '今日抱怨統計', children: [complaintTable.el] }).el,
      section({ title: '抱怨記錄（新 → 舊）', children: [logBox] }).el
    );

    let lastKey = null;
    function update(S) {
      const rep = S?.reputation ?? {};
      const stars0 = Math.max(1, Math.min(5, Math.round(Number(S?.stars) || 1)));
      const today = S?.stats?.today ?? {};
      const complaints = (today.complaints && typeof today.complaints === 'object') ? today.complaints : {};
      const log = Array.isArray(S?.sim?.complaintLog) ? S.sim.complaintLog : [];
      const newest = newestFirst(log);
      const key = [
        rep.community, rep.outside, stars0, int(S?.day), JSON.stringify(complaints), log.length,
        newest[0] ? `${newest[0]?.day}:${newest[0]?.minute}:${newest[0]?.reason}` : '',
        S?.stats?.magazine?.lastTotalRank, S?.stats?.magazine?.bestTotalRank, S?.stats?.magazine?.firstPlaceWeeks
      ].join('|');
      if (key === lastKey) return;
      lastKey = key;

      const community = Number(rep.community) || 0;
      const outside = Number(rep.outside) || 0;
      const req = nextStarReq(stars0);

      rComm.set(`${num(community, 1)} / 500`);
      rComm.kind(community >= 460 ? 'good' : community < 350 ? 'bad' : undefined);
      rOut.set(`${num(outside, 1)} / 500`);
      rOut.kind(outside >= 435 ? 'good' : outside < 350 ? 'bad' : undefined);

      clear(checklist);
      if (!req) {
        rTarget.set('★★★★★ 已滿星');
        rTarget.kind('good');
        checklist.appendChild(h('div', { class: 'row' },
          tag('五星達成', 'gold'),
          h('span', { class: 'muted' }, '接著把每週排名維持在前段，挑戰年度大獎 The Greatest Restaurant of the Year。')));
      } else {
        rTarget.set(`★${req.star}（社區 ${req.community} ／ 區外 ${req.outside}）`);
        const cLeft = req.community - community;
        const oLeft = req.outside - outside;
        const extra = starExtraState(req, S);
        const day = int(S?.day);
        checklist.appendChild(h('div', { class: 'row' },
          cLeft <= 0 ? tag('已達成', 'ok') : tag(`還差 ${cLeft.toFixed(1)} 分`, 'warn'),
          h('span', {}, `社區評價需 ${req.community}（目前 ${num(community, 1)}）`)));
        checklist.appendChild(h('div', { class: 'row' },
          oLeft <= 0 ? tag('已達成', 'ok') : tag(`還差 ${oLeft.toFixed(1)} 分`, 'warn'),
          h('span', {}, `區外評價需 ${req.outside}（目前 ${num(outside, 1)}）`)));
        checklist.appendChild(h('div', { class: 'row' },
          extra.done === true ? tag('已達成', 'ok') : extra.done === false ? tag('未達成', 'bad') : tag('待結算', 'plain'),
          h('span', {}, extra.text || '（無額外條件）')));
        if (extra.days) {
          checklist.appendChild(h('div', { class: 'row' },
            extra.dayOk === true ? tag('已達成', 'ok') : extra.dayOk === false ? tag(`還差 ${extra.days - day} 天`, 'warn') : tag('—', 'plain'),
            h('span', {}, `營業天數需滿 ${extra.days} 天（目前第 ${day} 天）`)));
        }
        if (cLeft <= 0 && oLeft <= 0 && extra.done !== false && extra.dayOk !== false) {
          checklist.appendChild(h('div', { class: 'row' },
            tag('可望升星', 'gold'),
            h('span', { class: 'muted' }, '每天打烊結算時評定星級；週日 22:00 結算的週排名也會一起算進去。')));
        }
      }

      const rows = Object.entries(complaints)
        .map(([reason, count]) => ({ reason: COMPLAINT_LABEL[reason] ?? String(reason), count: int(count), raw: reason }))
        .sort((a, b) => b.count - a.count);
      complaintTable.setRows(rows);

      clear(logBox);
      if (!log.length) {
        logBox.appendChild(emptyState('目前沒有任何客人抱怨。'));
      } else {
        const recent = newest.slice(0, 20);
        for (const c of recent) {
          logBox.appendChild(h('div', { class: 'mag-row' },
            h('span', { class: 'rank' }, Number.isFinite(Number(c?.mood)) ? `${Math.round(Number(c.mood))}` : '!'),
            h('span', { class: 'nm' }, `${complaintText(c)}${complaintDetail(c)}`),
            h('span', { class: 'sc' }, complaintWhen(c))));
        }
        logBox.appendChild(h('div', { class: 'muted' },
          `顯示最近 ${recent.length} 筆（共 ${log.length} 筆）；左欄數字是客人當下的心情（−100 ～ +100）。`));
      }
    }

    return { el: node, update };
  }

  /* ------------------------------------------------------------------ 組裝 */
  const todayTab = buildTodayTab();
  const historyTab = buildHistoryTab();
  const magazineTab = buildMagazineTab();
  const ratingTab = buildRatingTab();

  const tabset = tabs([
    { id: 'today', label: '今日', render: () => todayTab.el },
    { id: 'history', label: '歷史', render: () => historyTab.el },
    { id: 'magazine', label: '雜誌排名', render: () => magazineTab.el },
    { id: 'rating', label: '評價', render: () => ratingTab.el }
  ]);
  el.appendChild(tabset.el);

  function refresh(state) {
    const S = state ?? {};
    todayTab.update(S);
    historyTab.update(S);
    magazineTab.update(S);
    ratingTab.update(S);
  }

  // 面板建立時先填一次（store 已可用；store 每次變更時 windows 仍會呼叫 refresh）
  try {
    if (store && typeof store.getState === 'function') refresh(store.getState());
  } catch { /* 尚未連上 store 時維持空白畫面，第一次 refresh 會補上 */ }

  return {
    id: 'report',
    title: '營運報表',
    icon: '📊',
    width: 640,
    height: 480,
    el,
    open() { /* 內容隨 refresh 更新，開啟時不需重建 */ },
    close() { /* 保留 DOM，方便下次開啟立即顯示 */ },
    refresh
  };
}

export default createReportPanel;
