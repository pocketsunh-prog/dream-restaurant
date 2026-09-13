// ============================================================================
// panels/staff.js — 員工管理面板
//   panel id : 'staff'  標題 : 員工管理  👥  640 x 490
//   分頁     : 現有員工 / 招募 / 排班
//   dispatches（僅使用 docs/ARCHITECTURE.md §4 表上的 action）：
//     HIRE       { candidateId }
//     FIRE       { uid }
//     SET_WAGE   { uid, wage }
//     SET_SHIFT  { uid, start, end }
//     SET_DUTY   { uid, duty, on }
//   本面板不直接修改 state，也不 import 任何 CSS。
// ============================================================================
import { MAX_WAGE, MIN_WAGE, SEVERANCE_HOURS } from '../../core/balance.js';
import { STAFF_POOL, staffById } from '../../data/index.js';
import {
  bar, button, card, checkbox, clear, emptyState, h, hintbox, money, numberField,
  portraitCanvas, statRow, table, tabs, tag, toolbar
} from '../widgets.js';

/* ------------------------------------------------------------------ 常數 */

const MINUTES_PER_DAY = 1440;
const DEFAULT_OPEN = 660;    // 11:00
const DEFAULT_CLOSE = 1380;  // 23:00

/** 服務生可指派職務（原作：帶位、點餐、送餐、收桌、掃廁所、掃店內、櫃檯） */
const DUTIES = [
  { id: 'escort', label: '帶位', hint: '在門口招呼、帶客人入座' },
  { id: 'serve', label: '送餐', hint: '把出餐口的菜送到桌上（沒人送餐客人會等到生氣）' },
  { id: 'order', label: '點餐', hint: '到桌邊抄單' },
  { id: 'bus', label: '收桌', hint: '收空盤、整理桌面，影響翻桌率' },
  { id: 'cleanRestroom', label: '清掃廁所', hint: '原作指定：廁所必須有人定時打掃，否則評價重扣' },
  { id: 'cleanFloor', label: '清掃店內', hint: '掃地板、拖地，髒污度高時客人會嫌' },
  { id: 'cashier', label: '櫃檯結帳', hint: '結帳收銀、收小費' }
];

const PERSONALITY_LABEL = {
  diligent: '勤勞', cheerful: '開朗', grumpy: '脾氣差', lazy: '懶散', pro: '老手', rookie: '菜鳥'
};
const ROLE_LABEL = { waiter: '服務生', chef: '廚師' };
const SPECIALTY_LABEL = {
  staple: '主食', side: '小菜', soup: '湯品', drink: '飲料', alcohol: '酒類',
  dessert: '甜點', secret: '隱藏料理', all: '全能'
};

/* ------------------------------------------------------------------ 工具 */

export function pad2(n) { return String(n).padStart(2, '0'); }

/** 遊戲分鐘 → 'HH:MM'（可跨日） */
export function clockOf(minute) {
  const total = Math.round(Number(minute) || 0);
  const day = Math.floor(total / MINUTES_PER_DAY);
  const m = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const label = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  return day > 0 ? `${label} +${day}日` : label;
}

/** 解析 'HH:MM' / 'HH：MM' / 純分鐘數 → 分鐘，失敗回 null */
export function parseClock(text) {
  const s = String(text == null ? '' : text).trim();
  const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(s);
  if (m) {
    const hh = Number(m[1]), mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
    return hh * 60 + mm;
  }
  if (/^\d+$/.test(s)) {
    const v = Number(s);
    if (v >= 0 && v < MINUTES_PER_DAY) return v;
  }
  return null;
}

/** 班表是否涵蓋營業時段 */
export function shiftCovers(shift, openMinute, closeMinute) {
  if (!shift) return false;
  return Number(shift.start) <= Number(openMinute) && Number(shift.end) >= Number(closeMinute);
}

/** 該班別在 [from,to) 之間是否有上班 */
export function shiftOverlaps(shift, from, to) {
  if (!shift) return false;
  const s = Number(shift.start) || 0;
  const e = Number(shift.end) || 0;
  return Math.max(s, from) < Math.min(e, to);
}

/** 每人今日工時（遊戲小時） */
export function shiftHours(shift) {
  if (!shift) return 0;
  return Math.max(0, (Number(shift.end) || 0) - (Number(shift.start) || 0)) / 60;
}

/** 資遣費：與 reducer 同步（B.SEVERANCE_HOURS 小時的時薪） */
export function severanceOf(staff) {
  const wage = Number(staff && staff.wage) || 0;
  return Math.round(wage * SEVERANCE_HOURS);
}

/** 雇用簽約金：與 reducer 同步（action HIRE 收 askWage × 2） */
export function hireFeeOf(askWage) {
  return Math.round((Number(askWage) || 0) * 2);
}

export function dutyOf(staff, duty) {
  if (!staff || !staff.duties) return duty === 'serve'; // 契約預設 serve:true
  return !!staff.duties[duty];
}

function staffAppearance(staffId) {
  const def = (typeof staffById === 'function' && staffById(staffId)) || null;
  const src = (def && def.portrait) || (STAFF_POOL || []).find((p) => p && p.id === staffId)?.portrait || null;
  const out = {};
  for (const k of ['hair', 'skin', 'shirt', 'hat']) if (src && src[k] !== undefined && src[k] !== null) out[k] = src[k];
  return out;
}

function staffDef(staffId) {
  const def = (typeof staffById === 'function' && staffById(staffId)) || null;
  if (def) return def;
  return (STAFF_POOL || []).find((p) => p && p.id === staffId) || {};
}

function pctColor(v, max) {
  const r = max <= 0 ? 0 : v / max;
  if (r >= 0.66) return 'var(--ok)';
  if (r >= 0.33) return 'var(--gold)';
  return 'var(--bad)';
}

/** 疲勞／髒污：越高越糟 → 反色 */
function badColor(v, max) {
  const r = max <= 0 ? 0 : v / max;
  if (r >= 0.66) return 'var(--bad)';
  if (r >= 0.33) return 'var(--warn)';
  return 'var(--ok)';
}

function statChip(label, value) {
  return h('span', null, `${label} `, h('b', null, String(value)));
}

function timeField(value, onChange) {
  const input = h('input', { type: 'text', value: clockOf(value), style: { width: '52px', textAlign: 'center' } });
  input.title = '可直接輸入 HH:MM，或填 0–1439 的分鐘數';
  const commit = () => {
    const v = parseClock(input.value);
    if (v === null) { input.value = clockOf(value); return; }
    onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { commit(); input.blur(); } });
  return { el: input, input, set(v) { if (document.activeElement !== input) input.value = clockOf(v); } };
}

function keyedList(host, data, keyOf, make) {
  if (!host._nodes) host._nodes = new Map();
  const cache = host._nodes;
  const seen = new Set();
  data.forEach((item, i) => {
    const k = String(keyOf(item, i));
    seen.add(k);
    let node = cache.get(k);
    if (!node) { node = make(item); cache.set(k, node); }
    const at = host.children[i];
    if (at !== node) host.insertBefore(node, at || null);
  });
  for (const [k, node] of [...cache]) {
    if (seen.has(k)) continue;
    cache.delete(k);
    if (node.parentNode === host) host.removeChild(node);
  }
  return cache;
}

function refreshAll(handlers, name) {
  return function refresh(state) {
    for (const fn of handlers) {
      try { fn(state); } catch (err) { console.error(`[${name}] refresh 子項失敗`, err); }
    }
  };
}

/* ------------------------------------------------------------------ 面板 */

export function createStaffPanel({ store, ui }) {
  const dispatch = (action) => {
    let res;
    try { res = store.dispatch(action); } catch (err) { res = { ok: false, error: String(err && err.message ? err.message : err) }; }
    if (!res || res.ok !== true) ui.toast((res && res.error) || '操作失敗', 'bad');
    return res;
  };

  const state = () => (store.getState ? store.getState() : null);

  /* ------------------------------------------------------------ 摘要列 */
  const cashValue = h('span', { class: 'v' }, money(0));
  const wageValue = h('span', { class: 'v' }, money(0));
  const headValue = h('span', { class: 'v' }, '0 人');
  const summary = h('div', { class: 'row wrap', style: { gap: '10px' } },
    statRow('現金', cashValue),
    statRow('人事時薪合計', wageValue),
    statRow('員工／應徵者', headValue));
  const alertRegion = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });

  /* -------------------------------------------------------- 現有員工頁 */
  const rosterHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
  const rosterTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    hintbox('原作重點：廚房到座位的動線決定服務生能帶幾桌；廁所若沒人負責清掃，評價會被重扣。時薪太低員工會心情差，最後請假或離職。'),
    rosterHost);

  /* ---------------------------------------------------------- 招募頁 */
  const candidateHead = h('div', { class: 'muted' }, '');
  const candidateHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
  const candidateTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    hintbox('應徵者每天更新。雇用時需先付一筆簽約金（時薪 × 2），之後依排班時數按時薪計薪；週日結算時付清當週薪水。'),
    candidateHead, candidateHost);

  /* ---------------------------------------------------------- 排班頁 */
  const applyAllBtn = button('全員套用營業時間', () => {
    const st = state();
    if (!st) return;
    const open = Number(st.settings && st.settings.openMinute);
    const close = Number(st.settings && st.settings.closeMinute);
    const list = st.staff || [];
    if (!list.length) { ui.toast('目前沒有員工可以排班。', 'warn'); return; }
    let ok = 0;
    for (const s of list) {
      const res = dispatch({ type: 'SET_SHIFT', uid: s.uid, start: open, end: close });
      if (res && res.ok) ok += 1;
    }
    if (ok) ui.toast(`已把 ${ok} 位員工的班表設為 ${clockOf(open)}–${clockOf(close)}。`, 'good');
  }, { small: true, kind: 'primary' });

  const hoursLabel = h('span', { class: 'right' }, '');
  const openDaysRow = h('div', { class: 'row wrap', style: { gap: '4px' } });
  const shiftHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
  const coverageHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
  const shiftTab = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    toolbar(applyAllBtn, h('span', { class: 'muted' }, '（把所有人的上下班時間對齊營業時間）')),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, '營業日（唯讀，於設定面板調整）', hoursLabel), openDaysRow),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, '班表'), shiftHost),
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, '人力覆蓋表（每小時在班人數）'), coverageHost));

  const tabsNode = tabs([
    { id: 'roster', label: '現有員工', render: () => rosterTab },
    { id: 'hire', label: '招募', render: () => candidateTab },
    { id: 'shift', label: '排班', render: () => shiftTab }
  ]);

  const root = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', minHeight: '0', flex: '1' } },
    summary, alertRegion, tabsNode.el);

  /* ------------------------------------------------------------ 摘要更新 */
  function refreshSummary(st) {
    const staff = st.staff || [];
    cashValue.textContent = money(st.cash);
    const totalWage = staff.reduce((n, s) => n + (Number(s.wage) || 0), 0);
    wageValue.textContent = `${money(totalWage)} / 時`;
    headValue.textContent = `${staff.length} 人 / ${(st.candidates || []).length} 位`;
  }

  /** 回傳目前人力配置的紅字警告清單 */
  function collectAlerts(st) {
    const staff = st.staff || [];
    const waiters = staff.filter((s) => s.role === 'waiter');
    const chefs = staff.filter((s) => s.role === 'chef');
    const openMinute = Number(st.settings && st.settings.openMinute);
    const closeMinute = Number(st.settings && st.settings.closeMinute);
    const alerts = [];
    if (!staff.length) {
      alerts.push('店裡一個員工都沒有。沒有廚師就沒人料理、沒有服務生就沒人送餐，客人會全部氣走。');
    } else {
      if (!waiters.length) alerts.push('沒有服務生：沒人帶位、點餐、送餐、收桌，客人進門只能乾等。');
      if (!chefs.length) alerts.push('沒有廚師：出餐口不會出菜，客人點什麼都吃不到。');
      if (waiters.length && !waiters.some((s) => dutyOf(s, 'serve'))) {
        alerts.push('沒有服務生負責「送餐」：菜會卡在出餐口，客人等太久直接翻臉。');
      }
      if (waiters.length && !waiters.some((s) => dutyOf(s, 'cleanRestroom'))) {
        alerts.push('沒有服務生負責「清掃廁所」：原作設定廁所必須有人定時打掃，否則評價重扣。');
      }
      const late = staff.filter((s) => !shiftCovers(s.shift, openMinute, closeMinute));
      if (late.length) {
        alerts.push(`有 ${late.length} 位員工的班表沒有涵蓋營業時間 ${clockOf(openMinute)}–${clockOf(openMinute === closeMinute ? closeMinute : closeMinute)}`
          + `（${late.map((s) => s.name).join('、')}）：開店或打烊時段會唱空城。`);
      }
      if (!waiters.some((s) => dutyOf(s, 'cashier'))) alerts.push('沒有服務生站「櫃檯結帳」：客人吃完找不到人付錢，翻桌率會被拖垮。');
      if (!waiters.some((s) => dutyOf(s, 'cleanFloor'))) alerts.push('沒有服務生負責「清掃店內」：地板髒污累積後客人會嫌環境。');
    }
    return alerts;
  }

  function refreshAlerts(st) {
    const alerts = collectAlerts(st);
    clear(alertRegion);
    for (const text of alerts) {
      alertRegion.appendChild(h('div', {
        class: 'hintbox',
        style: { color: 'var(--bad)', background: '#f4e0dc' }
      }, h('b', null, '⚠ 人力警告：'), text));
    }
  }

  /* -------------------------------------------------------- 員工卡片建構 */
  function buildStaffCard(staff) {
    const portrait = portraitCanvas(staffAppearance(staff.staffId), { size: 32, zoom: 2 });
    const nameEl = h('span', { class: 'staff-name' }, staff.name || staff.staffId);
    const roleTag = tag(ROLE_LABEL[staff.role] || staff.role || '員工', staff.role === 'chef' ? 'info' : 'ok');
    const specTag = tag(`擅長 ${SPECIALTY_LABEL[staff.specialty] || staff.specialty || '—'}`, 'plain');
    const wageField = numberField({
      label: '時薪', value: staff.wage, min: MIN_WAGE, max: MAX_WAGE, step: 1, suffix: '元/時', width: 50,
      onChange: (v) => dispatch({ type: 'SET_WAGE', uid: staff.uid, wage: v })
    });
    const bars = {
      speed: bar({ value: staff.speedMod ? 60 : 60, max: 100, color: (v) => pctColor(v, 100), label: '速度' }),
      skill: bar({ value: 60, max: 100, color: (v) => pctColor(v, 100), label: '技術' }),
      stamina: bar({ value: 60, max: 100, color: (v) => pctColor(v, 100), label: '體力' }),
      fatigue: bar({ value: 0, max: 100, color: (v) => badColor(v, 100), label: '疲勞' }),
      mood: bar({ value: 70, max: 100, color: (v) => (v >= 60 ? 'var(--ok)' : v >= 30 ? 'var(--gold)' : 'var(--bad)'), label: '心情' })
    };
    const statLine = h('div', { class: 'staff-stats' });
    const hoursLine = h('div', { class: 'muted' }, '');
    const shiftLine = h('div', { class: 'muted' }, '');
    const dutyRow = h('div', { class: 'row wrap', style: { gap: '3px' } });
    const dutyBoxes = staff.role === 'waiter' ? DUTIES.map((d) => {
      const box = checkbox({
        label: d.label,
        checked: dutyOf(staff, d.id),
        onChange: (on) => dispatch({ type: 'SET_DUTY', uid: staff.uid, duty: d.id, on })
      });
      box.el.title = d.hint;
      box.el.style.minWidth = '74px';
      return { def: d, box };
    }) : [];
    for (const { box } of dutyBoxes) dutyRow.appendChild(box.el);
    const fireBtn = button('解僱', async () => {
      const pay = severanceOf(staff);
      const ok = await ui.confirm({
        title: '解僱員工',
        message: `確定要解僱「${staff.name}」嗎？\n\n需支付資遣費 ${money(pay)}（時薪 ${money(staff.wage)} × ${SEVERANCE_HOURS} 小時）。\n對方會很生氣，之後不會再回來應徵。`,
        okLabel: `付 ${money(pay)} 解僱`, cancelLabel: '留住他'
      });
      if (ok) {
        const res = dispatch({ type: 'FIRE', uid: staff.uid });
        if (res && res.ok) ui.toast(`${staff.name} 已離職。`, 'warn');
      }
    }, { small: true, kind: 'danger' });

    const actions = h('div', { class: 'staff-actions' }, wageField.el, fireBtn);
    const main = h('div', { class: 'staff-main' },
      h('div', { class: 'card-title' }, nameEl, roleTag, specTag, h('span', { class: 'tagline' }, `到職第 ${Number(staff.hireDay) || 1} 天`)),
      statLine, hoursLine, shiftLine,
      h('div', null, bars.speed.el),
      h('div', null, bars.skill.el),
      h('div', null, bars.stamina.el),
      h('div', null, bars.fatigue.el),
      h('div', null, bars.mood.el),
      staff.role === 'waiter'
        ? h('div', null, h('div', { class: 'muted' }, '職務指派（可多選）'), dutyRow)
        : h('div', { class: 'muted' }, '廚師不分派外場職務，固定在廚房出餐；廚藝越高，菜越好吃。'));
    const node = card(h('div', { class: 'staff-card' }, h('div', null, portrait), main, actions));
    return { node, staff, bars, wageField, statLine, hoursLine, shiftLine, dutyBoxes, roleTag };
  }

  function refreshStaffCard(rec, staff, st) {
    const def = staffDef(staff.staffId);
    const speed = Math.round(Number(staff.role === 'chef' ? (def.skill || 50) : (def.speed || 50)));
    const skill = Math.round(Number(def.skill) || 50);
    const stamina = Math.round(Number(def.stamina) || 50);
    const fatigue = Math.round(Number(staff.fatigue) || 0);
    const mood = Math.round(Number(staff.mood) || 0);
    rec.bars.speed.set(speed, 100);
    rec.bars.skill.set(skill, 100);
    rec.bars.stamina.set(stamina, 100);
    rec.bars.fatigue.set(fatigue, 100);
    rec.bars.mood.set(mood, 100);
    const mod = Number(staff.speedMod);
    rec.bars.speed.track.title = `移動速度 ${speed}` + (Number.isFinite(mod) && mod !== 1 ? `（目前效率 ×${mod.toFixed(2)}）` : '');
    clear(rec.statLine);
    rec.statLine.appendChild(statChip('速度', speed));
    rec.statLine.appendChild(statChip('技術', skill));
    rec.statLine.appendChild(statChip('體力', stamina));
    rec.statLine.appendChild(statChip('疲勞', fatigue));
    rec.statLine.appendChild(statChip('心情', mood));
    rec.statLine.appendChild(statChip('專長', SPECIALTY_LABEL[staff.specialty] || staff.specialty || '—'));
    rec.statLine.appendChild(statChip('個性', PERSONALITY_LABEL[def.personality] || def.personality || '—'));
    const hrs = shiftHours(staff.shift);
    rec.hoursLine.textContent = `今日工時 ${hrs.toFixed(1)} 小時（${clockOf(staff.shift && staff.shift.start)}–${clockOf(staff.shift && staff.shift.end)}）`
      + (staff.working ? '・目前在班' : '・目前不在班');
    rec.hoursLine.style.color = staff.working ? 'var(--ok)' : 'var(--ink-dim)';
    rec.shiftLine.textContent = `今日薪資約 ${money(hrs * (Number(staff.wage) || 0))}｜疲勞超過 80 可能請假或離職`;
    const covered = shiftCovers(staff.shift, Number(st.settings && st.settings.openMinute), Number(st.settings && st.settings.closeMinute));
    rec.shiftLine.appendChild(h('span', { style: { marginLeft: '6px', color: covered ? 'var(--ok)' : 'var(--bad)', fontWeight: 'bold' } },
      covered ? '班表涵蓋營業時間' : '班表未涵蓋營業時間'));
    for (const { def: d, box } of rec.dutyBoxes) {
      const on = dutyOf(staff, d.id);
      if (box.get() !== on) box.set(on);
    }
  }

  function refreshRoster(st) {
    const staff = st.staff || [];
    if (!staff.length) {
      clear(rosterHost);
      rosterHost._nodes = new Map();
      rosterHost.appendChild(emptyState('店裡還沒有半個員工。切到「招募」分頁找人，先請一位廚師與一位服務生就能開店。'));
      return;
    }
    if (rosterHost.firstChild && rosterHost.firstChild.classList && rosterHost.firstChild.classList.contains('empty-state')) {
      clear(rosterHost);
      rosterHost._nodes = new Map();
    }
    // 容器以 uid 為鍵重用；真正的卡片內容建一次之後只更新數值
    keyedList(rosterHost, staff, (s) => s.uid, () => h('div'));
    for (const staffMember of staff) {
      const slot = rosterHost._nodes.get(String(staffMember.uid));
      if (!slot) continue;
      if (!slot._built) {
        const built = buildStaffCard(staffMember);
        slot._built = built;
        clear(slot);
        slot.appendChild(built.node);
      }
      const built = slot._built;
      if (String(built.wageField.get()) !== String(staffMember.wage)) built.wageField.set(staffMember.wage);
      built.roleTag.textContent = ROLE_LABEL[staffMember.role] || staffMember.role || '員工';
      refreshStaffCard(built, staffMember, st);
    }
  }

  /* ------------------------------------------------------------ 招募頁 */
  function buildCandidateCard(cand) {
    const def = staffDef(cand.staffId);
    const portrait = portraitCanvas(staffAppearance(cand.staffId), { size: 32, zoom: 2 });
    const askWage = Number(cand.askWage != null ? cand.askWage : def.wage) || 0;
    const signCost = hireFeeOf(askWage);
    const role = def.role || 'waiter';
    const hireBtn = button(`雇用（簽約金 ${money(signCost)}）`, () => {
      const res = dispatch({ type: 'HIRE', candidateId: cand.candidateId });
      if (res && res.ok) ui.toast(`已雇用 ${def.name || cand.staffId}，別忘了到「排班」分頁設定班表。`, 'good');
    }, { small: true, kind: 'primary' });
    const cashNote = h('span', { class: 'muted' }, '現金 —');
    const main = h('div', { class: 'staff-main' },
      h('div', { class: 'card-title' }, def.name || cand.staffId, tag(ROLE_LABEL[role], role === 'chef' ? 'info' : 'ok'),
        def.age ? h('span', { class: 'tagline' }, `${def.age} 歲`) : null),
      h('div', { class: 'staff-stats' },
        statChip('速度', def.speed || 0),
        statChip('技術', def.skill || 0),
        statChip('體力', def.stamina || 0),
        statChip('期望時薪', `${money(askWage)} / 時`),
        statChip('專長', SPECIALTY_LABEL[def.specialty] || def.specialty || '—'),
        statChip('個性', PERSONALITY_LABEL[def.personality] || def.personality || '—')),
      h('div', { class: 'muted' }, def.desc || '（沒有自我介紹）'),
      h('div', { class: 'muted' }, `簽約金 ${money(signCost)}（時薪 × 2，雇用時一次付清）｜若排每日 8 小時，每日薪資約 ${money(askWage * 8)}`));
    const actions = h('div', { class: 'staff-actions' }, hireBtn, cashNote);
    return { node: card(h('div', { class: 'staff-card' }, h('div', null, portrait), main, actions)), hireBtn, cashNote, signCost, askWage };
  }

  function refreshCandidates(st) {
    const cands = (st.candidates || []).filter((c) => c && c.candidateId);
    candidateHead.textContent = cands.length
      ? `今日有 ${cands.length} 位應徵者（依到店順序）`
      : '今日沒有人來應徵。';
    if (!cands.length) {
      clear(candidateHost);
      candidateHost._nodes = new Map();
      candidateHost.appendChild(emptyState(
        '今天沒有人上門應徵。\n明天再來看看，或先讓現有員工加班頂一下。\n（員工心情太差時要記得調薪，不然會離職。）'));
      return;
    }
    if (candidateHost.firstChild && candidateHost.firstChild.classList && candidateHost.firstChild.classList.contains('empty-state')) {
      clear(candidateHost);
      candidateHost._nodes = new Map();
    }
    keyedList(candidateHost, cands, (c) => c.candidateId, (c) => {
      const built = buildCandidateCard(c);
      built.node._built = built;
      return built.node;
    });
    for (const cand of cands) {
      const node = candidateHost._nodes.get(String(cand.candidateId));
      if (!node) continue;
      const built = node._built;
      const candCost = hireFeeOf(Number(cand.askWage) || 0);
      node.classList.toggle('disabled', (Number(st.cash) || 0) < candCost);
      const btn = built ? built.hireBtn : null;
      if (btn) {
        btn.disabled = (Number(st.cash) || 0) < candCost;
        btn.title = btn.disabled ? `現金不足（需要 ${money(candCost)}）` : `雇用後時薪 ${money(cand.askWage)}`;
      }
      if (built && built.cashNote) built.cashNote.textContent = `現金 ${money(st.cash)}`;
    }
  }

  /* ------------------------------------------------------------ 排班頁 */
  function buildShiftRow(staff) {
    const startField = timeField(staff.shift && staff.shift.start, (v) => dispatch({ type: 'SET_SHIFT', uid: staff.uid, start: v, end: Number(staff.shift && staff.shift.end) || DEFAULT_CLOSE }));
    const endField = timeField(staff.shift && staff.shift.end, (v) => dispatch({ type: 'SET_SHIFT', uid: staff.uid, start: Number(staff.shift && staff.shift.start) || DEFAULT_OPEN, end: v }));
    const hoursCell = h('span', { class: 'num' }, '0.0 時');
    const flagCell = h('span', null);
    const row = {
      uid: staff.uid,
      name: h('span', null, h('b', null, staff.name || staff.staffId), h('span', { class: 'muted' }, ` ${ROLE_LABEL[staff.role] || ''}`)),
      role: ROLE_LABEL[staff.role] || '—',
      start: startField.el,
      end: endField.el,
      hours: hoursCell,
      flag: flagCell
    };
    return { row, startField, endField, hoursCell, flagCell, staff };
  }

  const shiftTable = table({
    columns: [
      { key: '_idx', label: '#', width: '22px', align: 'num' },
      { key: 'name', label: '姓名／職種', width: '112px' },
      { key: 'start', label: '上班', width: '64px', align: 'mid' },
      { key: 'end', label: '下班', width: '64px', align: 'mid' },
      { key: 'hours', label: '今日工時', width: '70px', align: 'num' },
      { key: 'flag', label: '班表檢查' }
    ],
    rows: [],
    empty: '沒有員工可以排班。'
  });
  // 班表掛進「班表」區塊；列內容每次 refresh 時更新（保留輸入焦點）
  shiftHost.appendChild(shiftTable.el);

  function refreshShift(st) {
    const staff = st.staff || [];
    const open = Number(st.settings && st.settings.openMinute);
    const close = Number(st.settings && st.settings.closeMinute);
    hoursLabel.textContent = `營業 ${clockOf(open)}–${clockOf(close)}（共 ${((Math.max(0, close - open)) / 60).toFixed(1)} 小時）`;

    clear(openDaysRow);
    const days = (st.settings && st.settings.openDays) || [];
    const dayNames = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    for (let i = 0; i < 7; i += 1) {
      const on = !!days[i];
      openDaysRow.appendChild(tag(`${dayNames[i]}${on ? '營業' : '公休'}`, on ? 'ok' : 'plain'));
    }
    openDaysRow.appendChild(h('span', { class: 'muted' }, '（公休日照常付租金，但員工不上班；調整請至「營業設定」面板）'));

    // 班表列（沿用舊列以保留輸入焦點）
    const cache = shiftTable._rows || new Map();
    const live = new Set(staff.map((s) => String(s.uid)));
    for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key);
    const recs = staff.map((s, i) => {
      const key = String(s.uid);
      let rec = cache.get(key);
      if (!rec) { rec = buildShiftRow(s); cache.set(key, rec); }
      rec.staff = s;
      rec.row._idx = i + 1;
      return rec;
    });
    shiftTable._rows = cache;
    shiftTable.setRows(recs.map((rec) => rec.row));
    for (const rec of recs) {
      const s = rec.staff;
      rec.startField.set(Number(s.shift && s.shift.start) || 0);
      rec.endField.set(Number(s.shift && s.shift.end) || 0);
      const hrs = shiftHours(s.shift);
      rec.hoursCell.textContent = `${hrs.toFixed(1)} 時`;
      clear(rec.flagCell);
      const covered = shiftCovers(s.shift, open, close);
      rec.flagCell.appendChild(tag(covered ? '涵蓋營業時間' : '不足', covered ? 'ok' : 'bad'));
      if (hrs > 8) rec.flagCell.appendChild(tag(`加班 ${(hrs - 8).toFixed(1)} 時（易疲勞）`, 'warn'));
    }

    // 人力覆蓋表
    clear(coverageHost);
    if (!staff.length) {
      coverageHost.appendChild(emptyState('沒有員工，無法計算人力覆蓋。'));
      return;
    }
    const startHour = Math.floor(Math.max(0, Math.min(open, close)) / 60);
    const endHour = Math.min(24, Math.ceil(Math.max(open, close) / 60));
    const waiters = staff.filter((s) => s.role === 'waiter');
    const chefs = staff.filter((s) => s.role === 'chef');
    const header = h('div', { class: 'row', style: { gap: '6px', fontWeight: 'bold', fontSize: '12px' } },
      h('span', { style: { width: '46px' } }, '時段'),
      h('span', { style: { width: '52px', textAlign: 'right' } }, '服務生'),
      h('span', { style: { width: '52px', textAlign: 'right' } }, '廚師'),
      h('span', null, '（■ = 在班人數）'));
    coverageHost.appendChild(header);
    let barren = 0;
    for (let hour = startHour; hour < endHour; hour += 1) {
      const from = hour * 60;
      const to = from + 60;
      const w = waiters.filter((s) => shiftOverlaps(s.shift, from, to)).length;
      const c = chefs.filter((s) => shiftOverlaps(s.shift, from, to)).length;
      const short = w === 0 || c === 0;
      if (short) barren += 1;
      coverageHost.appendChild(h('div', {
        class: 'row',
        style: { gap: '6px', fontSize: '12px', background: short ? '#f6e0dd' : 'transparent' }
      },
        h('span', { style: { width: '46px' } }, `${pad2(hour)}:00`),
        h('span', { style: { width: '52px', textAlign: 'right', color: w === 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 'bold' } }, `${w} 人`),
        h('span', { style: { width: '52px', textAlign: 'right', color: c === 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 'bold' } }, `${c} 人`),
        h('span', { style: { color: 'var(--ink-dim)' } }, '■'.repeat(Math.min(12, w + c)) || '—'),
        h('span', { class: 'muted' }, w === 0 ? '沒有服務生！' : (c === 0 ? '沒有廚師！' : ''))));
    }
    coverageHost.appendChild(h('div', { class: 'muted' },
      barren
        ? `⚠ 有 ${barren} 個時段缺人手（服務生或廚師為 0 人），該時段客人會大量生氣離開。`
        : '所有營業時段都有人手，動線順的話翻桌率會很漂亮。'));
    coverageHost.appendChild(h('div', { class: 'muted' },
      `營業時間內共需約 ${((Math.max(0, close - open)) / 60).toFixed(1)} 小時 × 人數的工時；週日 22:00 結算時會依實際打卡時數付薪。`));
  }

  /* ------------------------------------------------------------ 對外介面 */
  return {
    id: 'staff',
    title: '員工管理',
    icon: '👥',
    width: 640,
    height: 490,
    el: root,
    open() {
      const st = state();
      if (st) { try { this.refresh(st); } catch (err) { console.error('[staff] open 失敗', err); } }
    },
    close() {},
    refresh: refreshAll([
      (st) => { if (st) refreshSummary(st); },
      (st) => { if (st) refreshAlerts(st); },
      (st) => { if (st) refreshRoster(st); },
      (st) => { if (st) refreshCandidates(st); },
      (st) => { if (st) refreshShift(st); }
    ], 'staff')
  };
}
