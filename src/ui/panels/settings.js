// ============================================================================
// src/ui/panels/settings.js — 環境設定面板（營業時間／空調／音樂與天氣）
//   面板 id    : 'settings'
//   標題 / 圖示: 環境設定 / ❄
//   建議尺寸   : 460 × 420
//   匯出       : createSettingsPanel({ store, ui, win })
//   分頁       : 營業 / 空調 / 音樂與天氣
//   派送 action: SET_HOURS {openMinute, closeMinute}
//                TOGGLE_DAY {index}
//                SET_AC {temp}
//                SET_MUSIC {id}
//                REPAIR {target:'ac'}   ← 僅在空調故障時提供的維修捷徑
//   依據       : docs/ARCHITECTURE.md §3.1 根狀態、§4 Action 一覽、§5.3 面板契約
//                docs/GAME_PROMPT.md §3.1 時間、§3.10 天氣與環境、§3.12 財務
// ============================================================================
import {
  h, tabs, numberField, slider, select, checkbox, bar, statRow, section, hintbox, button,
  toast, money, pct
} from '../widgets.js';

/* --------------------------------------------------------------- 共用小工具 */

const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

const PHASE_LABEL = {
  build: '裝修準備（開店前）',
  open: '營業中',
  closing: '打烊清場',
  closed: '已打烊',
  settle: '週結算',
  gameover: '結束營業'
};

const WEATHER_LABEL = {
  sunny: '晴天', cloudy: '陰天', rain: '下雨', storm: '豪雨', cold: '寒流', heat: '熱浪'
};

/** 天氣本身的客流倍率（對應 src/core/balance.js WEATHER_TRAFFIC） */
const WEATHER_TRAFFIC = {
  sunny: 1.15, cloudy: 1.0, rain: 0.72, storm: 0.5, cold: 0.82, heat: 0.9
};

const WEATHER_EFFECTS = {
  sunny: ['天氣晴朗，客流 ×1.15 —— 做生意的好日子。', '沒有額外需求偏移。'],
  cloudy: ['陰天，客流 ×1.00，一切照常。', '沒有額外需求偏移。'],
  rain: ['下雨，客流 ×0.72；外送進貨會延誤。', '叫貨請提早，別等庫存見底才補。'],
  storm: ['豪雨，客流 ×0.50 —— 今天人會少一半。', '進貨延誤最嚴重，備貨寧可多留一天安全量。'],
  cold: ['寒流，客流 ×0.82。', '客人上門就想喝熱的：熱湯、酒類需求上升（舒適帶也要往上調）。'],
  heat: ['熱浪，客流 ×0.90。', '客人只想灌冰的：飲料、冰品需求上升（冷氣要開強一點）。']
};

const MUSIC_STYLES = [
  { value: 'lazy', label: '慵懶', desc: '慵懶爵士。家庭客 0.6、評論家 0.5，午後與宵夜時段最對味；學生、VIP 反應普通（0.3）。' },
  { value: 'tropical', label: '南國風', desc: '南國情調。觀光客 0.8、家庭客 0.5 最買單，廟口、港邊型地點加成明顯；上班族不太領情（0.2）。' },
  { value: 'classic1', label: '古典樂一', desc: '輕快古典。美食評論家與 VIP 都是 0.9，上班族 0.5；學生幾乎無感（0.1）。' },
  { value: 'classic2', label: '古典樂二', desc: '沉穩古典。評論家 0.9、VIP 0.8，適合高價菜單與高級裝潢；學生同樣無感（0.1）。' },
  { value: 'pop', label: '流行', desc: '流行金曲。學生 0.9 最嗨，觀光客 0.5；評論家不愛（0.2），宵夜場人氣高。' },
  { value: 'off', label: '關閉', desc: '不播音樂。省下音響耗電，但所有客層的音樂加成全部歸零（最高只剩 0.1～0.3）。' }
];

/** 空調舒適帶：22–26℃，依當日天氣整體位移（對應 src/core/balance.js COMFORT / WEATHER_COMFORT_SHIFT） */
const COMFORT = { min: 22, max: 26 };
const WEATHER_COMFORT_SHIFT = { sunny: 0, cloudy: 0, rain: 1, storm: 2, cold: 4, heat: -4 };

function comfortBand(weather) {
  const shift = WEATHER_COMFORT_SHIFT[weather] ?? 0;
  const lo = COMFORT.min + shift;
  const hi = COMFORT.max + shift;
  let note = '一般天氣的舒適帶是 22–26℃。';
  if (shift > 0) note = `${WEATHER_LABEL[weather] ?? '這種天氣'}會讓客人怕冷，舒適帶整體上移 ${shift}℃。`;
  else if (shift < 0) note = `${WEATHER_LABEL[weather] ?? '這種天氣'}會讓客人怕熱，舒適帶整體下移 ${Math.abs(shift)}℃。`;
  return { lo, hi, shift, note };
}

function pad2(n) { return String(Math.max(0, Math.round(Number(n) || 0))).padStart(2, '0'); }

function hhmm(minute) {
  const m = Number(minute);
  if (!Number.isFinite(m)) return '--:--';
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

function weekdayLabel(day) {
  const n = Number(day);
  if (!Number.isFinite(n)) return '—';
  return WEEKDAYS[(((Math.round(n) - 1) % 7) + 7) % 7];
}

function weatherLabel(key) {
  if (!key) return '未知';
  return WEATHER_LABEL[key] ?? String(key);
}

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

function meterRow(label, barObj, labelWidth = '72px') {
  barObj.el.style.flex = '1';
  barObj.el.style.minWidth = '0';
  return h('div', { class: 'row' },
    h('span', { class: 'muted', style: { 'min-width': labelWidth } }, label),
    barObj.el);
}

/** 今日天氣：sim.weather → today.weather → 最後一筆 DailyStat.weather（缺一不可全缺） */
function weatherOf(S) {
  const w = S?.sim?.weather ?? S?.stats?.today?.weather;
  if (w) return w;
  const hist = Array.isArray(S?.stats?.history) ? S.stats.history : [];
  const last = hist[hist.length - 1];
  return last?.weather ?? null;
}

/* ===========================================================================
   面板
   =========================================================================== */

export function createSettingsPanel({ store, ui, win }) {   // eslint-disable-line no-unused-vars
  const el = h('div', {
    class: 'settings-panel',
    style: { display: 'flex', 'flex-direction': 'column', gap: '6px', height: '100%' }
  });

  let S = {};

  function notify(msg, kind = 'info') {
    try {
      if (ui && typeof ui.toast === 'function') { ui.toast(msg, kind); return; }
    } catch { /* 落回內建 toast */ }
    try { toast(msg, kind); } catch { /* 連 toast 都沒有就放棄 */ }
  }

  function dispatch(action) {
    try {
      if (!store || typeof store.dispatch !== 'function') {
        notify('尚未連接遊戲狀態，指令未送出', 'bad');
        return { ok: false, error: 'store 尚未就緒' };
      }
      const res = store.dispatch(action);
      if (res && res.ok === false) notify(res.error || '指令失敗', 'bad');
      return res ?? { ok: true };
    } catch (err) {
      notify(err?.message || '指令執行失敗', 'bad');
      return { ok: false, error: err?.message };
    }
  }

  function liveState() {
    try {
      if (store && typeof store.getState === 'function') return store.getState() ?? S;
    } catch { /* 用最後一次 refresh 的狀態 */ }
    return S;
  }

  function isEditing(input) {
    try { return typeof document !== 'undefined' && !!input && document.activeElement === input; } catch { return false; }
  }

  function syncField(field, value) {
    if (!field || typeof field.set !== 'function') return;
    if (value === null || value === undefined) return;
    if (isEditing(field.input)) return;
    field.set(value);
  }

  /* --------------------------------------------------------------- 營業分頁 */
  function buildHoursTab() {
    let draftOpen = 660;
    let draftClose = 1380;

    function commitHours() {
      const open = Math.round(draftOpen);
      const close = Math.round(draftClose);
      if (!Number.isFinite(open) || !Number.isFinite(close)) return;
      const span = close - open;
      if (!(open < close) || span < 120) {
        // 與 reducer 的規則一致（src/core/actions.js#SET_HOURS：至少要 2 小時）
        notify(!(open < close) ? '開店時間必須早於打烊時間，設定未變更。' : '營業時間至少要 2 小時，設定未變更。', 'bad');
        const now = liveState();
        draftOpen = Number(now?.settings?.openMinute ?? 660);
        draftClose = Number(now?.settings?.closeMinute ?? 1380);
        syncHours(now);
        return;
      }
      if (span > 12 * 60) {
        notify(`${(span / 60).toFixed(1)} 小時的長班：薪資按時薪 × 工時計算，工時越長人事成本越高，員工超過 8 小時也會開始疲勞、心情變差。`, 'warn');
      } else if (span < 4 * 60) {
        notify('營業時間不到 4 小時，來客數會很少，恐怕連租金都賺不回來。', 'warn');
      }
      dispatch({ type: 'SET_HOURS', openMinute: open, closeMinute: close });
      syncHours(liveState());
    }

    const openField = numberField({
      label: '開店時間', value: 660, min: 0, max: 1439, step: 5, suffix: '分',
      onChange: (v) => { draftOpen = v; commitHours(); }
    });
    const closeField = numberField({
      label: '打烊時間', value: 1380, min: 0, max: 1439, step: 5, suffix: '分',
      onChange: (v) => { draftClose = v; commitHours(); }
    });

    const openClock = h('span', { class: 'muted' }, '11:00');
    const closeClock = h('span', { class: 'muted' }, '23:00');
    const rSpan = valueRow('營業時數', { hint: '打烊 － 開店' });
    const rWarn = valueRow('加班提醒');

    const dayBoxes = WEEKDAYS.map((label, idx) => checkbox({
      label,
      checked: true,
      onChange: (on) => {
        const cur = !!liveState()?.settings?.openDays?.[idx];
        if (on === cur) return;              // 已經一致就不必切換（TOGGLE_DAY 是翻轉）
        dispatch({ type: 'TOGGLE_DAY', index: idx });
        syncDays(liveState());
      }
    }));

    const rNow = valueRow('現在時間');
    const rDay = valueRow('今天是第幾天');
    const rPhase = valueRow('目前階段');
    const rRest = valueRow('今日營業狀態');

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '營業時間', children: [
        h('div', { class: 'row' }, openField.el, openClock),
        h('div', { class: 'row' }, closeField.el, closeClock),
        rSpan.row,
        rWarn.row,
        hintbox('時間以「遊戲分鐘」為單位（0 = 00:00、1439 = 23:59），可直接輸入數字或按 Enter 確認。'
          + ' 原作可以自訂成 10:50–23:50，也能全年無休 —— 營業越久賺得越多，但人事成本與疲勞也跟著漲。')
      ] }).el,
      section({ title: '營業日（週一 → 週日）', children: [
        h('div', { class: 'row wrap' }, ...dayBoxes.map((b) => b.el)),
        hintbox('打勾代表當天營業。原作允許全年無休，關掉某一天就少一天收入，但也能省下當天的時薪與水電。')
      ] }).el,
      section({ title: '目前狀態', children: [rNow.row, rDay.row, rPhase.row, rRest.row] }).el
    );

    function syncHours(state) {
      const s = state?.settings ?? {};
      const open = Number(s.openMinute);
      const close = Number(s.closeMinute);
      if (Number.isFinite(open)) { draftOpen = open; syncField(openField, open); openClock.textContent = hhmm(open); }
      if (Number.isFinite(close)) { draftClose = close; syncField(closeField, close); closeClock.textContent = hhmm(close); }
      const span = (Number.isFinite(open) && Number.isFinite(close)) ? close - open : 0;
      rSpan.set(`${(span / 60).toFixed(1)} 小時（${hhmm(open)} → ${hhmm(close)}）`);
      rSpan.kind(span <= 0 ? 'bad' : span < 4 * 60 ? 'warn' : span > 12 * 60 ? 'warn' : 'good');
      rWarn.set(span > 12 * 60
        ? '工時超過 12 小時：加班薪資高、員工疲勞快速累積，容易請假或離職。'
        : '工時正常，人事成本可控。');
      rWarn.kind(span > 12 * 60 ? 'warn' : 'good');
    }

    function syncDays(state) {
      const days = Array.isArray(state?.settings?.openDays) ? state.settings.openDays : [];
      dayBoxes.forEach((b, i) => {
        const v = days[i] === undefined ? true : !!days[i];
        if (b.input && b.input.checked !== v) b.set(v);
      });
    }

    function syncNow(state) {
      const minute = Number(state?.minute);
      rNow.set(Number.isFinite(minute) ? hhmm(minute) : '--:--');
      const day = Number(state?.day);
      const wd = weekdayLabel(day);
      rDay.set(Number.isFinite(day) ? `第 ${Math.round(day)} 天（${wd}）` : '—');
      const phase = state?.phase;
      rPhase.set(PHASE_LABEL[phase] ?? (phase ? String(phase) : '—'));
      const idx = Number.isFinite(day) ? (((Math.round(day) - 1) % 7) + 7) % 7 : -1;
      const openToday = idx >= 0 ? (state?.settings?.openDays?.[idx] !== false) : true;
      rRest.set(openToday ? '今天排定營業' : '今天是公休日（不營業）');
      rRest.kind(openToday ? 'good' : 'warn');
    }

    let lastKey = null;
    function update(state) {
      const s = state?.settings ?? {};
      const key = [s.openMinute, s.closeMinute, JSON.stringify(s.openDays), state?.minute, state?.day, state?.phase].join('|');
      if (key === lastKey) return;
      lastKey = key;
      syncHours(state);
      syncDays(state);
      syncNow(state);
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------------- 空調分頁 */
  function buildAcTab() {
    const rWeather = valueRow('今日天氣');
    const rWeatherMul = valueRow('天氣客流倍率');
    const rTraffic = valueRow('事件客流加成', { hint: 'state.sim.trafficMul' });
    const rSetting = valueRow('目前空調設定');
    const rBand = valueRow('舒適帶');
    const rStatus = valueRow('顧客感受');
    const rBroken = valueRow('設備狀態');
    const rUtility = valueRow('今日水電', { hint: '空調偏離舒適帶會加收' });

    const acSlider = slider({
      label: '空調溫度', value: 24, min: 16, max: 30, step: 1, suffix: '℃',
      onChange: (v) => dispatch({ type: 'SET_AC', temp: v })
    });

    // 直立溫度計（純 DIV，16℃ 在下、30℃ 在上）
    const thermo = h('div', {
      style: {
        position: 'relative', width: '26px', height: '150px', background: '#fdfcf6',
        'box-shadow': 'inset 1px 1px 0 #a9a496, inset -1px -1px 0 #fbfaf4'
      }
    });
    const bandEl = h('div', { style: { position: 'absolute', left: '0', right: '0', background: '#cfe3c8' } });
    const setEl = h('div', { style: { position: 'absolute', left: '0', right: '0', height: '2px', background: '#9c2a20' } });
    thermo.appendChild(bandEl);
    thermo.appendChild(setEl);

    const scale = h('div', {
      style: { display: 'flex', 'flex-direction': 'column', 'justify-content': 'space-between', height: '150px', 'font-size': '10px', color: '#736f63' }
    }, ...Array.from({ length: 15 }, (_, i) => h('span', null, `${30 - i}℃`)));

    const repairBtn = button('叫修空調（NT$ 12,000）', () => dispatch({ type: 'REPAIR', target: 'ac' }), { kind: 'primary', small: true });

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '今日環境', children: [rWeather.row, rWeatherMul.row, rTraffic.row] }).el,
      section({ title: '空調設定', children: [
        acSlider.el,
        h('div', { class: 'row', style: { 'align-items': 'flex-start', gap: '10px' } }, thermo, scale),
        rSetting.row, rBand.row, rStatus.row, rBroken.row, rUtility.row,
        repairBtn,
        hintbox('顧客舒適帶是 22–26℃，並依當日天氣整體位移：雨天 +1℃、豪雨 +2℃、寒流 +4℃、熱浪 −4℃。'
          + '偏離舒適帶每 1℃ 都會持續累積顧客煩躁度（太冷太熱都會有人抱怨甚至翻臉走人），'
          + '而且每偏離 1℃ 每天水電多收 NT$ 26；空調故障期間更會直接當成偏離 6℃ 計費。'
          + '溫度開越低越耗電，這是很多新手忽略的隱形成本。')
      ] }).el
    );

    function update(state) {
      const weather = weatherOf(state);
      const band = comfortBand(weather);
      const temp = Number(state?.settings?.acTemp);
      const safeTemp = Number.isFinite(temp) ? temp : 24;
      const mul = Number(state?.sim?.trafficMul);
      const acBroken = !!(state?.sim?.equipBroken?.ac);
      const cash = Number(state?.cash);

      rWeather.set(`${weatherLabel(weather)}${acBroken ? '（空調故障中）' : ''}`);
      const wMul = WEATHER_TRAFFIC[weather];
      rWeatherMul.set(Number.isFinite(wMul)
        ? `× ${wMul.toFixed(2)}（${wMul >= 1 ? '+' : ''}${((wMul - 1) * 100).toFixed(0)}%）`
        : '—');
      rWeatherMul.kind(Number.isFinite(wMul) && wMul < 0.9 ? 'warn' : 'good');
      rTraffic.set(Number.isFinite(mul) ? `× ${mul.toFixed(2)}（${mul >= 1 ? '+' : ''}${((mul - 1) * 100).toFixed(0)}%）` : '—');
      rTraffic.kind(Number.isFinite(mul) && mul < 0.9 ? 'warn' : 'good');

      syncField(acSlider, safeTemp);
      rSetting.set(`${safeTemp}℃`);
      rBand.set(`${band.lo}–${band.hi}℃　${band.note}`);
      rBand.kind('good');

      const off = safeTemp < band.lo ? band.lo - safeTemp : safeTemp > band.hi ? safeTemp - band.hi : 0;
      const dev = acBroken ? 6 : off;
      rUtility.set(`預估 ${money(320 + dev * 26)}（基本 320 ＋ 偏離 ${dev}℃ × 26）`);
      rUtility.kind(dev === 0 ? 'good' : dev >= 3 ? 'bad' : 'warn');

      if (acBroken) {
        rStatus.set('空調掛了：室溫失控，顧客煩躁度直線上升，請盡快維修！');
        rStatus.kind('bad');
        rBroken.set('空調故障中');
        rBroken.kind('bad');
      } else if (off === 0) {
        rStatus.set('溫度落在舒適帶內，顧客心情穩定。');
        rStatus.kind('good');
        rBroken.set('設備正常');
        rBroken.kind('good');
      } else {
        rStatus.set(`${safeTemp < band.lo ? '偏冷' : '偏熱'} ${off}℃：${safeTemp < band.lo ? '客人覺得冷，會抱怨冷氣太強' : '客人覺得悶熱，煩躁度持續上升'}。`);
        rStatus.kind(off >= 3 ? 'bad' : 'warn');
        rBroken.set('設備正常');
        rBroken.kind('good');
      }
      repairBtn.disabled = !acBroken || (Number.isFinite(cash) && cash < 12000);

      const pctTop = (t) => (30 - Math.max(16, Math.min(30, t))) / 14 * 100;
      bandEl.style.top = `${pctTop(band.hi).toFixed(2)}%`;
      bandEl.style.height = `${(((band.hi - band.lo) / 14) * 100).toFixed(2)}%`;
      setEl.style.top = `${pctTop(safeTemp).toFixed(2)}%`;
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------- 音樂與天氣分頁 */
  function buildMusicTab() {
    const musicDesc = h('div', { class: 'muted' }, '');
    const musicSelect = select({
      label: '店內音樂',
      value: 'lazy',
      options: MUSIC_STYLES.map((m) => ({ value: m.value, label: m.label })),
      onChange: (id) => {
        dispatch({ type: 'SET_MUSIC', id });
        syncMusic(liveState());
      }
    });

    const rWeather = valueRow('今日天氣');
    const rWeatherMul = valueRow('天氣客流倍率');
    const rTraffic = valueRow('事件客流加成', { hint: 'state.sim.trafficMul' });
    const rWeatherBar = bar({ value: 1, max: 1.5, color: (v) => (v >= 1 ? '#1f6b3f' : '#9a6a10'), format: (v) => `× ${v.toFixed(2)}` });
    rWeatherBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: `${((1 / 1.5) * 100).toFixed(1)}%` } }));
    const rTrafficBar = bar({ value: 1, max: 1.5, color: (v) => (v >= 1 ? '#1f6b3f' : '#9a6a10'), format: (v) => `× ${v.toFixed(2)}` });
    rTrafficBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: `${((1 / 1.5) * 100).toFixed(1)}%` } }));
    const rLure = valueRow('拉客加成', { hint: '點店門口路人' });
    const lureBar = bar({ value: 0, max: 30, color: '#1f4f8a', format: (v) => pct(v, 1) });
    lureBar.track.appendChild(h('div', { class: 'bar-seg', style: { left: '100%' } }));

    const effects = h('div', { class: 'help-text' });
    const effectList = h('ul');

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '音樂', children: [
        musicSelect.el, musicDesc,
        hintbox('曲風要跟顧客組成對上才有加分（括號內是各客層的喜好係數）：夜市以學生、家庭為主，'
          + '廟口多觀光客，南陽街是上班族與評論家，新堀江則是年輕人與情侶。'
          + '選錯不會扣分，但顧客心情就少了那一段加成。')
      ] }).el,
      section({ title: '今日天氣', children: [
        rWeather.row, rWeatherMul.row, meterRow('天氣倍率', rWeatherBar, '84px'),
        rTraffic.row, meterRow('事件加成', rTrafficBar, '84px'),
        effects
      ] }).el,
      section({ title: '拉客', children: [
        rLure.row, meterRow('拉客加成', lureBar, '84px'),
        hintbox('營業中點擊店門口的過路人就可以拉客：每次 +0.5%，上限 +30%，半衰期 20 分鐘（不再點就會慢慢衰退）。'
          + ' 拉客加成是直接乘在來客速率上的，尖峰時段前先拉一波效果最明顯。')
      ] }).el
    );

    effects.appendChild(effectList);

    function syncMusic(state) {
      const id = state?.settings?.music ?? 'lazy';
      syncField(musicSelect, id);
      const found = MUSIC_STYLES.find((m) => m.value === id);
      musicDesc.textContent = found ? found.desc : '（未設定曲風）';
    }

    function update(state) {
      syncMusic(state);

      const weather = weatherOf(state);
      const wMul = WEATHER_TRAFFIC[weather];
      const mul = Number(state?.sim?.trafficMul);
      const lure = Number(state?.sim?.lureBoost);
      rWeather.set(weatherLabel(weather));
      rWeatherMul.set(Number.isFinite(wMul)
        ? `× ${wMul.toFixed(2)}（${wMul >= 1 ? '+' : ''}${((wMul - 1) * 100).toFixed(0)}%）`
        : '—');
      rWeatherMul.kind(Number.isFinite(wMul) && wMul < 0.9 ? 'warn' : 'good');
      rWeatherBar.set(Number.isFinite(wMul) ? wMul : 1, 1.5);
      rTraffic.set(Number.isFinite(mul)
        ? `× ${mul.toFixed(2)}（${mul >= 1 ? '+' : ''}${((mul - 1) * 100).toFixed(0)}%）`
        : '—');
      rTrafficBar.set(Number.isFinite(mul) ? mul : 1, 1.5);

      const lurePct = Number.isFinite(lure) ? (lure <= 1 ? lure * 100 : lure) : 0;   // 0.12 或 12 都吃
      rLure.set(`${pct(Math.max(0, Math.min(30, lurePct)), 1)}（上限 30%）`);
      rLure.kind(lurePct >= 10 ? 'good' : undefined);
      lureBar.set(Math.max(0, Math.min(30, lurePct)), 30);

      const lines = WEATHER_EFFECTS[weather] ?? ['天氣資料尚未產生，通常會在開始營業後寫入。', '沒有額外需求偏移。'];
      while (effectList.firstChild) effectList.removeChild(effectList.firstChild);
      for (const line of lines) effectList.appendChild(h('li', null, line));
      if (weather === 'rain' || weather === 'storm') {
        effectList.appendChild(h('li', null, '進貨外送延誤：叫貨後 30 分鐘到貨，雨天還會更久，別等庫存見底才補。'));
      }
      const activeEvents = Array.isArray(state?.sim?.activeEvents) ? state.sim.activeEvents : [];
      if (activeEvents.length) {
        effectList.appendChild(h('li', null, `目前有 ${activeEvents.length} 件突發事件正在生效（事件會改變客流、成本或顧客心情）。`));
      }
      if (state?.sim?.supplierPriceMul !== undefined && Number(state.sim.supplierPriceMul) !== 1) {
        const pm = Number(state.sim.supplierPriceMul);
        effectList.appendChild(h('li', null, `目前食材進貨價倍率 × ${pm.toFixed(2)}（漲價事件或季節通膨影響）。`));
      }
      if (Number.isFinite(Number(state?.cash)) && Number(state.cash) < 0) {
        effectList.appendChild(h('li', null, `目前現金為負（${money(state.cash)}），連續 7 天赤字就會破產收店。`));
      }
    }

    return { el: node, update };
  }

  /* ------------------------------------------------------------------ 組裝 */
  const hoursTab = buildHoursTab();
  const acTab = buildAcTab();
  const musicTab = buildMusicTab();

  const tabset = tabs([
    { id: 'hours', label: '營業', render: () => hoursTab.el },
    { id: 'ac', label: '空調', render: () => acTab.el },
    { id: 'music', label: '音樂與天氣', render: () => musicTab.el }
  ]);
  el.appendChild(tabset.el);

  function refresh(state) {
    S = state ?? {};
    hoursTab.update(S);
    acTab.update(S);
    musicTab.update(S);
  }

  try {
    if (store && typeof store.getState === 'function') refresh(store.getState());
  } catch { /* 尚未連上 store 時維持空白，第一次 refresh 會補上 */ }

  return {
    id: 'settings',
    title: '環境設定',
    icon: '❄',
    width: 460,
    height: 420,
    el,
    open() { /* 內容隨 refresh 更新，開啟時不需重建 */ },
    close() { /* 保留 DOM */ },
    refresh
  };
}

export default createSettingsPanel;
