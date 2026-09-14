// ============================================================================
// src/ui/panels/system.js — 系統面板（存讀檔／搬遷資訊／玩法說明／統計總覽）
//   面板 id    : 'system'
//   標題 / 圖示: 系統 / 💾
//   建議尺寸   : 520 × 470
//   匯出       : createSystemPanel({ store, ui, win })
//   分頁       : 存讀檔 / 搬遷資訊 / 玩法說明 / 統計總覽
//   派送 action: SAVE_GAME {slot}   LOAD_GAME {slot}   NEW_GAME {seed}
//                MOVE_LOCATION {locationId}
//   例外說明   : §4 沒有「刪除存檔」action，因此刪除是由本面板直接呼叫
//                localStorage.removeItem('dreamrestaurant.save.' + slot)，
//                金鑰前綴固定為 dreamrestaurant.save.（槽位 '1'..'5' 與 'auto'），
//                與 src/core/save.js 約定一致。
//   依據       : docs/ARCHITECTURE.md §2 資料契約、§3 狀態契約、§4 Action 一覽、§5.3 面板契約
//                docs/GAME_PROMPT.md §1 考據、§3.5 員工、§3.7 星級、§3.9 地點、§3.11 事件、§3.13 存讀檔
// ============================================================================
import * as DATA from '../../data/index.js';
import * as B from '../../core/balance.js';
import {
  h, el as htmlEl, clear, tabs, table, statRow, section, hintbox, tag, button,
  toolbar, sep, toast, money, pct, stars, confirmDialog
} from '../widgets.js';

/* --------------------------------------------------------------- 共用小工具 */

const SAVE_PREFIX = 'dreamrestaurant.save.';

const SLOTS = [
  { id: '1', label: '手動 1' },
  { id: '2', label: '手動 2' },
  { id: '3', label: '手動 3' },
  { id: '4', label: '手動 4' },
  { id: '5', label: '手動 5' },
  { id: 'auto', label: '自動存檔' }
];

const CUSTOMER_LABEL = {
  student: '學生', office: '上班族', family: '家庭', tourist: '觀光客', critic: '美食評論家', vip: 'VIP'
};

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

function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }

function sumOf(list, key) {
  return (Array.isArray(list) ? list : []).reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0);
}

function dayNet(row) {
  const explicit = Number(row?.profit);
  if (Number.isFinite(explicit)) return explicit;
  return (Number(row?.revenue) || 0) + (Number(row?.tips) || 0) - (Number(row?.spend) || 0);
}

function fmtSavedAt(v) {
  if (v === null || v === undefined || v === '') return '—';
  try {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ms = v < 1e12 ? v * 1000 : v;              // 秒或毫秒都吃
      return new Date(ms).toLocaleString('zh-TW', { hour12: false });
    }
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString('zh-TW', { hour12: false });
      return v;
    }
  } catch { /* 時間格式無法解析就原樣顯示 */ }
  return String(v);
}

/* --------------------------------------------------------- 資料模組存取層 */
// 以 namespace import 取得資料，缺檔／改名都不會讓整個面板掛掉（回空陣列 → 顯示空狀態）。

function allLocations() {
  return Array.isArray(DATA?.LOCATIONS) ? DATA.LOCATIONS : [];
}

function locOf(id) {
  try {
    if (typeof DATA?.getLocation === 'function') {
      const found = DATA.getLocation(id);
      if (found) return found;
    }
  } catch { /* 落回線性搜尋 */ }
  return allLocations().find((l) => l?.id === id) ?? null;
}

function furnOf(typeId) {
  try {
    if (typeof DATA?.furnitureById === 'function') {
      const found = DATA.furnitureById(typeId);
      if (found) return found;
    }
  } catch { /* 落回線性搜尋 */ }
  const list = Array.isArray(DATA?.FURNITURE) ? DATA.FURNITURE : [];
  return list.find((f) => f?.id === typeId) ?? null;
}

/* ------------------------------------------------------------ 存檔槽讀取 */

/** 回傳 {state, savedAt, raw} 或 null（沒有存檔／格式壞掉都回 null） */
function readSlot(slot) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    // 存檔可能包成 { version, savedAt, state } 或直接就是 state，兩種都吃
    const inner = (obj.state && typeof obj.state === 'object') ? obj.state : obj;
    const savedAt = obj.savedAt ?? obj.savedTime ?? obj.time ?? obj.timestamp ?? obj.date ?? null;
    return { state: inner, savedAt, raw };
  } catch { return null; }
}

function removeSlot(slot) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    localStorage.removeItem(SAVE_PREFIX + slot);
    return true;
  } catch { return false; }
}

/* ===========================================================================
   玩法說明（1998 年遊戲手冊語氣）
   =========================================================================== */

const MANUAL = [
  {
    title: '基本操作',
    body: `<div class="help-text">
      <b>一個營業日是這樣跑的：</b>
      <ul>
        <li><b>開店前</b>：把桌椅擺好、把菜單編好、把料進好，空調與音樂順手調一調，然後按「開始營業」。</li>
        <li><b>營業中</b>：客人自動上門，你可以即時改售價、叫貨、調空調、指派清掃、點店門口的過路人拉客。想改裝潢得先打烊。</li>
        <li><b>打烊後</b>：清場完畢自動日結算，秀出營收、成本、來客、抱怨。系統同時幫你<b>自動存檔</b>一次。</li>
        <li>右上角可切換 <b>1x / 2x / 4x / 暫停</b>：1 真實秒 = 1 遊戲分鐘，趕時間就開 4 倍速。</li>
      </ul>
      <b>小提示：</b>左下角「餐廳小提示」會滾動顯示即時狀況（太冷、太熱、有人在等、廁所髒、庫存不足），
      看到紅字就快去處理，那是客人在翻白眼的聲音。
    </div>`
  },
  {
    title: '動線設計',
    body: `<div class="help-text">
      <b>這是本作最痛、也最賺的一門學問。</b>
      <ul>
        <li>服務生負責的桌數上限，取決於座位<b>與廚房出餐口的距離</b>：離出餐口越遠，一位服務生能顧的桌數越少
          （大約是 <b>6 × (1 − 正規化距離)</b>，最少 1 桌、最多 6 桌）。</li>
        <li>所以別把所有桌子塞到離廚房最遠的角落 —— 那邊的客人會等到天荒地老。</li>
        <li>大門 → 座位、座位 → 出餐口之間<b>必須走得通</b>，系統會用路徑檢查擋你。走道太窄服務生會互卡，上餐變慢、翻桌率直接崩。</li>
        <li>桌子要<b>相鄰且可達</b>才算有效座位，擺在死角的桌子等於白花錢。</li>
        <li>來客速率有<b>天花板</b>，而且跟座位數成正比 —— 桌子擺得少，客人再多也進不來。
          想賺更多，就得在動線還順得起來的前提下把座位數拉高。</li>
      </ul>
      <b>一句話：</b>動線就是你的翻桌率，翻桌率就是你的營業額。
    </div>`
  },
  {
    title: '菜單與定價',
    body: `<div class="help-text">
      <b>每道菜可以調五個東西：</b>材料等級、味道濃淡、份量、調理時間、售價。
      <ul>
        <li><b>材料等級</b>越高越好吃，但成本越高；<b>份量</b>影響飽足感與成本；<b>味道濃淡</b>要對上當地口味（夜市重鹹重炸、台南偏甜）。</li>
        <li><b>調理時間</b>是新手最容易踩的雷：3 分鐘上菜客人只會覺得你微波食品（評分 5 分，<b>評價暴跌</b>）；
          8～15 分只有 45 分、15～20 分 72 分、<b>20～40 分才是 95 分的最佳區間</b>、
          40～50 分掉到 68 分、超過 50 分只剩 40 分（客人等到不耐煩）。</li>
        <li><b>售價</b>：主食常見 200–300 元，飲料酒類約 200 元，成本拉到成本價的 10 倍是原作的常態。
          太貴客人覺得被坑（划算度 = 期望價 ÷ 售價），太便宜你自己賺不到錢。</li>
        <li>同時上架有上限（一星 8 道，星級越高越多，四星全菜單解鎖）。</li>
        <li><b>庫存賣完＝客人點不到餐＝重扣評價。</b>營業中隨時可以叫貨，外送 30 分鐘後到，雨天會更久。</li>
        <li>生鮮類隔日折損約 10%，飲料酒類不折損；進貨價會受季節、事件與通膨影響（±30%）。</li>
        <li><b>漢堡牛肉餅</b>是前期無敵招牌；炸春捲、炸豬排、墨魚義大利麵、砂鍋魚頭、蛋包飯、台灣啤酒系列都很好賣。</li>
      </ul>
    </div>`
  },
  {
    title: '員工管理',
    body: `<div class="help-text">
      <b>廚師管好吃，服務生管速度。</b>
      <ul>
        <li><b>廚師</b>：廚藝（好吃度加成）與料理速度。擅長菜系對上菜單會有額外加分。</li>
        <li><b>服務生</b>：移動速度與服務態度；可指派職務 —— 帶位、點餐、送餐、收桌、<b>清掃廁所</b>、清掃店內、站櫃台結帳。</li>
        <li>薪資是<b>時薪</b>（原作常見 2～10 元），薪資支出 = 時薪 × 工時。生意好就加薪留人，虧錢就排短班。</li>
        <li><b>排班</b>要對上尖峰：中午 11–14 點、晚上 17–21 點。人手不足會直接反映在等待時間上。</li>
        <li>連續上班超過 8 小時效率下降、心情變差，可能<b>請假或離職</b>；疲勞是會累積的。</li>
        <li>廁所要派服務生定時掃（原作建議每小時一次），店內大約每 15 天掃一次；太髒重扣評價。</li>
      </ul>
    </div>`
  },
  {
    title: '評價與升星',
    body: `<div class="help-text">
      <b>評價分成兩桶，這是你卡星的主因：</b>
      <ul>
        <li><b>社區評價</b>看在地鄰居與老主顧；<b>區外評價</b>看外地客、觀光客與美食評論家（評論家權重 ×5）。</li>
        <li>兩桶都從 350 分上下起跑（0–500），顧客結帳時把心情灌進其中一桶。</li>
        <li>升星門檻（兩桶都要達標，外加條件）：★2 = 380／360（營業滿 7 天）、★3 = 410／385（週排名前 8）、
          ★4 = 435／410（週排名前 3 且曾拿第一）、★5 = 460／435（連兩週雜誌第一）。</li>
        <li><b>每週日 22:00</b> 雜誌結算五大榜（口味／服務／裝潢／價格／人氣），名次越前面知名度（fame）長越快，
          知名度又帶來更多客人 —— 這是原作最爽的正回饋。</li>
        <li><b>每週一</b>發放社區獎金 NT$ 200,000，是你最穩定的現金來源。</li>
        <li>連續 3 週評價低於門檻會<b>掉星</b>；搬遷到新地點後<b>區外評價會大幅下滑</b>，因為外地人還不認識你，得重新爬回來。</li>
      </ul>
    </div>`
  },
  {
    title: '突發事件與設備',
    body: `<div class="help-text">
      <b>每天 1～3 件突發事件，好的壞的都有：</b>
      <ul>
        <li><b>好事</b>：電視台採訪（知名度暴增）、美食評論家突擊、名人來訪、社區活動補助、隔壁倒閉帶來人流。</li>
        <li><b>壞事</b>：爐具／冷氣／冰箱故障、停電、食材漲價、老鼠出沒、宵小竊盜、員工請假或離職、
          客人食物中毒（食材等級太低機率上升）、奧客鬧場、廁所堵塞、漏水。</li>
        <li><b>防治設備</b>要先買：監視器、紅外線防盜、滅火器、保全主機 —— 買了對應事件損失會大幅下降，
          老手都是一口氣買齊。</li>
        <li><b>空調</b>設定在舒適帶（22–26℃，寒流熱浪會位移）：偏離每 1℃ 都在累積顧客煩躁度，太冷太熱都會被抱怨。</li>
        <li>設備壞了要修、地板廁所髒了要掃 —— 這款遊戲的錢不是只靠菜單賺的，是靠<b>不扣分</b>省下來的。</li>
        <li>五星之後還有 <b>The Greatest Restaurant of the Year 年度大獎</b>：撐滿一年且年度評比第一，
          就能解鎖兩道隱藏的歌名料理。</li>
      </ul>
    </div>`
  }
];

/* ===========================================================================
   面板
   =========================================================================== */

export function createSystemPanel({ store, ui, win }) {   // eslint-disable-line no-unused-vars
  const el = h('div', {
    class: 'system-panel',
    style: { display: 'flex', 'flex-direction': 'column', gap: '6px', height: '100%' }
  });

  let S = {};

  function notify(msg, kind = 'info') {
    try {
      if (ui && typeof ui.toast === 'function') { ui.toast(msg, kind); return; }
    } catch { /* 落回內建 toast */ }
    try { toast(msg, kind); } catch { /* 放棄 */ }
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

  async function ask(opts) {
    try {
      if (ui && typeof ui.confirm === 'function') return !!(await ui.confirm(opts));
    } catch { /* 落回內建對話框 */ }
    try { return !!(await confirmDialog(opts)); } catch { return false; }
  }

  /* ----------------------------------------------------------- 存讀檔分頁 */
  function buildSavesTab() {
    let forceSlots = true;
    let lastScan = 0;

    const saveTable = table({
      columns: [
        { key: 'label', label: '槽位', width: '70px' },
        { key: 'status', label: '狀態', format: (v, row) => (row.empty ? tag('空', 'plain') : tag('有存檔', 'ok')) },
        { key: 'day', label: '第幾天', align: 'num', format: (v, row) => (row.empty ? '—' : `第 ${int(v)} 天`) },
        { key: 'loc', label: '地點', format: (v, row) => (row.empty ? '—' : String(v ?? '不明地點')) },
        { key: 'cash', label: '現金', align: 'num', format: (v, row) => (row.empty ? '—' : money(v)) },
        { key: 'star', label: '星級', align: 'mid', format: (v, row) => (row.empty ? '—' : stars(int(v))) },
        { key: 'savedAt', label: '存檔時間', format: (v, row) => (row.empty ? '—' : fmtSavedAt(v)) },
        { key: 'ops', label: '操作', format: (v, row) => row.ops }
      ],
      rows: [],
      empty: '沒有可用的存檔槽位。'
    });
    saveTable.el.style.maxHeight = '210px';

    function makeOps(slot, info) {
      const actions = [
        button('存檔', () => {
          dispatch({ type: 'SAVE_GAME', slot });
          forceSlots = true;
          notify(`已存檔到「${SLOTS.find((s) => s.id === slot)?.label ?? slot}」。`, 'good');
          refresh(liveState());
        }, { kind: 'primary', small: true, title: `將目前進度寫入槽位 ${slot}` }),
        button('讀檔', async () => {
          if (!info) { notify('這個槽位沒有存檔。', 'warn'); return; }
          const ok = await ask({
            title: '讀取存檔',
            message: `讀取「${SLOTS.find((s) => s.id === slot)?.label ?? slot}」會覆蓋目前進度`
              + `（第 ${int(info?.state?.day)} 天、${locOf(info?.state?.locationId)?.name ?? '不明地點'}），確定要讀取嗎？`,
            okLabel: '讀取', cancelLabel: '取消'
          });
          if (!ok) return;
          dispatch({ type: 'LOAD_GAME', slot });
          forceSlots = true;
        }, { small: true, disabled: !info }),
        button('刪除', async () => {
          if (!info) { notify('這個槽位本來就是空的。', 'warn'); return; }
          const ok = await ask({
            title: '刪除存檔',
            message: `確定要刪除「${SLOTS.find((s) => s.id === slot)?.label ?? slot}」的存檔嗎？刪掉就救不回來了。`,
            okLabel: '刪除', cancelLabel: '取消'
          });
          if (!ok) return;
          // §4 沒有刪除 action，因此直接操作 localStorage（金鑰前綴 dreamrestaurant.save.）
          if (removeSlot(slot)) notify('存檔已刪除。', 'good');
          else notify('刪除失敗（瀏覽器可能停用了本機儲存）。', 'bad');
          forceSlots = true;
          refresh(liveState());
        }, { kind: 'danger', small: true, disabled: !info })
      ];
      return h('div', { class: 'row' }, ...actions);
    }

    function scanSlots() {
      const rows = SLOTS.map((slot) => {
        let info = null;
        try { info = readSlot(slot.id); } catch { info = null; }
        if (!info) {
          return { label: slot.label, empty: true, ops: makeOps(slot.id, null) };
        }
        const st = info.state ?? {};
        return {
          label: slot.label,
          empty: false,
          day: st.day,
          loc: locOf(st.locationId)?.name ?? st.locationId ?? '不明地點',
          cash: st.cash,
          star: st.stars,
          savedAt: info.savedAt,
          ops: makeOps(slot.id, info)
        };
      });
      saveTable.setRows(rows);
      lastScan = Date.now();
      forceSlots = false;
    }

    const newGameBtn = button('新遊戲（放棄目前進度）', async () => {
      const ok = await ask({
        title: '開新遊戲',
        message: '確定要放棄目前的餐廳，重新從中壢新明夜市的一星小店開始嗎？\n'
          + '（目前的進度不會自動存檔，建議先存到槽位再重來。）',
        okLabel: '重新開始', cancelLabel: '取消'
      });
      if (!ok) return;
      const seed = Date.now() & 0xffffffff;
      dispatch({ type: 'NEW_GAME', seed });
      notify(`新遊戲開始，亂數種子 ${seed}。`, 'good');
      forceSlots = true;
    }, { kind: 'danger' });
    const rebuildBtn = button('🏗 自動重建頂級餐廳（NT$ 1）', async () => {
      const st = liveState();
      if (!st) return;
      const ok = await ask({
        title: '自動重建餐廳',
        message: '確定要花 NT$ 1 把現有裝潢全部清空，重新配置頂級餐廳嗎？\n\n'
          + '• 9 張六人宴會桌（自動配滿椅子）\n'
          + '• 頂級裝潢：噴水池、點唱機、霓虹招牌、國畫\n'
          + '• 全套防治設備：監視器、紅外線、滅火器、消防、保全\n'
          + '• 廚房設備全滿級（爐具／冰箱／流理台）\n'
          + '• 時尚吧台、廁所\n\n'
          + '現有員工與菜單不變，現金只扣 NT$ 1。',
        okLabel: '花 NT$ 1 重建', cancelLabel: '取消'
      });
      if (!ok) return;
      const res = dispatch({ type: 'REBUILD_RESTAURANT' });
      if (res && res.ok) notify(res.info || '已重建頂級餐廳！', 'good');
      else if (res && res.error) notify(res.error, 'bad');
    }, { kind: 'primary', title: '一鍵重置為頂級餐廳配置（只要 NT$ 1）' });

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '存檔槽位', children: [
        hintbox('手動存檔 5 個槽位 + 1 個自動存檔槽。原版《夢幻西餐廳》常因當機吃掉進度，'
          + '所以本作「立即自動存檔」——每天打烊結算時自動寫入「自動存檔」槽，隔天開機就能接關。'),
        saveTable.el
      ] }).el,
      section({ title: '其他', children: [
        toolbar(newGameBtn, sep(), h('span', { class: 'muted' }, '存檔使用瀏覽器 localStorage，換瀏覽器或清除網站資料會一併消失。'))
      ] }).el
    );

    function update() {
      if (forceSlots || Date.now() - lastScan > 2000) scanSlots();
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------- 搬遷資訊分頁 */
  function buildMoveTab() {
    const rCurName = valueRow('目前地點');
    const rCurRent = valueRow('日租金');
    const rCurTraffic = valueRow('基礎客流');
    const rCurNeed = valueRow('星級需求');
    const rCurMix = valueRow('顧客組成');
    const rCurPref = valueRow('口味偏好');
    const rProfit = valueRow('累計淨利', { hint: '已完成營業日' });
    const rCash = valueRow('目前現金');
    const rPhase = valueRow('搬遷時機');
    const descBox = h('div', { class: 'help-text' }, '');

    const locTable = table({
      columns: [
        { key: 'name', label: '地點' },
        { key: 'city', label: '地區' },
        { key: 'need', label: '星級需求', align: 'mid' },
        { key: 'rent', label: '日租金', align: 'num' },
        { key: 'traffic', label: '基礎客流', align: 'num' },
        { key: 'unlock', label: '解鎖', align: 'mid' },
        { key: 'cost', label: '搬遷費(含押金)', align: 'num' },
        { key: 'ops', label: '操作', format: (v, row) => row.ops }
      ],
      rows: [],
      empty: '目前沒有可搬遷的地點資料。'
    });

    async function moveTo(loc) {
      const st = liveState();
      // 實際扣款 = 搬遷費 + 3 天租金押金；裝潢會依估價退回約 30%（見 src/core/actions.js#MOVE_LOCATION）
      const moveCost = Number(loc?.moveCost) || 0;
      const deposit = (Number(loc?.rentPerDay) || 0) * 3;
      const total = moveCost + deposit;
      const ok = await ask({
        title: `搬遷到${loc?.name ?? '新地點'}`,
        message: `確定要搬到「${loc?.name ?? '未知地點'}」嗎？\n\n`
          + `• 店內裝潢會全部清空，必須重新花錢購買與擺設（這是原作的搬家痛點）；`
          + `原有裝潢會依估價退回約 30%。\n`
          + `• 區外評價會大幅下滑（外地客人還不認識你），要重新經營才爬得回來。\n`
          + `• 搬遷費 ${money(moveCost)} ＋ 押金（3 天租金）${money(deposit)} ＝ 立刻扣款 ${money(total)}。\n`
          + `• 目前現金 ${money(st?.cash)}，搬過去之後每天還要付 ${money(loc?.rentPerDay)} 租金。\n\n`
          + '真的要搬嗎？',
        okLabel: '搬了！', cancelLabel: '再想想'
      });
      if (!ok) return;
      dispatch({ type: 'MOVE_LOCATION', locationId: loc?.id });
    }

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '目前店面', children: [
        rCurName.row, rCurRent.row, rCurTraffic.row, rCurNeed.row, rCurMix.row, rCurPref.row, descBox
      ] }).el,
      section({ title: '經營成績', children: [rProfit.row, rCash.row, rPhase.row] }).el,
      section({ title: '全台灣六個地點', children: [
        locTable.el,
        hintbox('搬遷只能在「裝修準備」或「已打烊」階段進行，營業中不能搬家。'
          + '「搬遷費(含押金)」是實際扣款金額＝搬遷費 ＋ 3 天租金押金；搬走後店內裝潢全部清空，'
          + '原裝潢約可退回 30%，而區外評價會立刻下滑一大段。'
          + '原作沒有分店系統 —— 你只能舉家搬過去，所以搬之前先想清楚：租金變貴、客人變多、口味偏好也會變。')
      ] }).el
    );

    function update(state) {
      const loc = locOf(state?.locationId);
      const stars0 = Math.max(1, Math.round(Number(state?.stars) || 1));
      const history = Array.isArray(state?.stats?.history) ? state.stats.history : [];
      const totalProfit = history.reduce((acc, row) => acc + dayNet(row), 0);
      const phase = state?.phase;
      const canMove = phase === 'build' || phase === 'closed';

      rCurName.set(loc ? `${loc.name}（${loc.city ?? '台灣'}）` : '—');
      rCurRent.set(loc ? `${money(loc.rentPerDay)} / 天` : '—');
      rCurTraffic.set(Number.isFinite(Number(loc?.baseTraffic)) ? `× ${Number(loc.baseTraffic).toFixed(2)} 人／遊戲分鐘` : '—');
      rCurNeed.set(loc ? `★${int(loc.starsRequired)}` : '—');
      rCurNeed.kind(Number(loc?.starsRequired) > stars0 ? 'bad' : 'good');

      const mix = loc?.customerMix && typeof loc.customerMix === 'object' ? loc.customerMix : {};
      const mixText = Object.entries(mix)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .map(([k, v]) => `${CUSTOMER_LABEL[k] ?? k} ${Math.round((Number(v) || 0) * 100)}%`)
        .join('、');
      rCurMix.set(mixText || '—');

      const prefs = Array.isArray(loc?.tastePrefs) ? loc.tastePrefs : [];
      clear(rCurPref.node);
      if (!prefs.length) rCurPref.node.textContent = '—';
      else {
        rCurPref.node.appendChild(h('span', { class: 'row wrap' }, ...prefs.map((t) => tag(String(t), 'info'))));
      }

      descBox.textContent = loc?.desc ? String(loc.desc) : '（這個地點沒有簡介。）';

      rProfit.set(money(totalProfit));
      rProfit.kind(totalProfit < 0 ? 'bad' : 'good');
      rCash.set(money(state?.cash));
      rCash.kind(Number(state?.cash) < 0 ? 'bad' : 'good');
      rPhase.set(canMove ? '可以搬遷' : '營業中不能搬遷（請先打烊）');
      rPhase.kind(canMove ? 'good' : 'warn');

      const locations = allLocations();
      const rows = locations.map((l) => {
        const unlocked = Number(l?.starsRequired ?? 99) <= stars0;
        const isCurrent = l?.id === state?.locationId;
        const ops = h('div', { class: 'row' },
          isCurrent
            ? tag('目前店面', 'gold')
            : button('搬遷', () => moveTo(l), {
              small: true,
              kind: 'primary',
              disabled: !unlocked || !canMove,
              title: !unlocked ? `需要 ★${int(l?.starsRequired)} 才能搬遷` : (!canMove ? '打烊後才能搬遷' : `搬到 ${l?.name}`)
            }),
          isCurrent || unlocked ? null : tag('未解鎖', 'plain')
        );
        const total = (Number(l?.moveCost) || 0) + (Number(l?.rentPerDay) || 0) * 3;
        const affordable = Number(state?.cash) + 0 >= total;
        return {
          name: l?.name ?? l?.id ?? '未知地點',
          city: l?.city ?? '—',
          need: `★${int(l?.starsRequired)}`,
          rent: money(l?.rentPerDay),
          traffic: Number.isFinite(Number(l?.baseTraffic)) ? `× ${Number(l.baseTraffic).toFixed(2)}` : '—',
          unlock: unlocked ? tag('已解鎖', 'ok') : tag('未解鎖', 'plain'),
          cost: h('span', { style: affordable ? null : { color: '#9c2a20', 'font-weight': 'bold' } }, money(total)),
          ops
        };
      });
      locTable.setRows(rows);
    }

    return { el: node, update };
  }

  /* --------------------------------------------------------- 玩法說明分頁 */
  function buildManualTab() {
    const secs = MANUAL.map((entry, i) => section({
      title: entry.title,
      collapsible: true,
      collapsed: i > 0,
      children: [htmlEl(entry.body)]
    }));
    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '6px' } },
      hintbox('《夢幻西餐廳：決戰全台灣》復刻版遊戲手冊 —— 從中壢新明夜市的一星小店，做到年度大獎。'
        + '點標題可以展開／收起。'),
      ...secs.map((s) => s.el)
    );
    return { el: node, update() { /* 靜態說明，不需更新 */ } };
  }

  /* --------------------------------------------------------- 統計總覽分頁 */
  function buildStatsTab() {
    const rDays = valueRow('營業天數');
    const rGuests = valueRow('總來客數');
    const rRevenue = valueRow('總營業額');
    const rProfit = valueRow('總淨利');
    const rBest = valueRow('最高單日營業額');
    const rMood = valueRow('平均心情');
    const rAngry = valueRow('生氣離開總數');
    const rServe = valueRow('服務完成率');
    const rStaff = valueRow('員工總數');
    const rChef = valueRow('廚師');
    const rWaiter = valueRow('服務生');
    const rWage = valueRow('人事時薪合計', { hint: '目前員工時薪加總' });
    const rDecor = valueRow('裝潢總分');
    const rItems = valueRow('傢俱件數');
    const rLoc = valueRow('所在位置');
    const flagBox = h('div', { class: 'row wrap' });

    const node = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '7px' } },
      section({ title: '歷史累計', children: [
        rDays.row, rGuests.row, rRevenue.row, rProfit.row, rBest.row, rMood.row, rAngry.row, rServe.row
      ] }).el,
      section({ title: '目前規模', children: [
        rLoc.row, rStaff.row, rChef.row, rWaiter.row, rWage.row, rDecor.row, rItems.row
      ] }).el,
      section({ title: '成就', children: [flagBox] }).el
    );

    function update(state) {
      const history = Array.isArray(state?.stats?.history) ? state.stats.history : [];
      const totalGuests = sumOf(history, 'guests');
      const totalServed = sumOf(history, 'served');
      const totalAngry = sumOf(history, 'angry');
      const totalRevenue = sumOf(history, 'revenue');
      const totalProfit = history.reduce((acc, row) => acc + dayNet(row), 0);
      const moods = history.map((row) => Number(row?.avgMood)).filter((n) => Number.isFinite(n));
      const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
      const best = history.reduce((acc, row) => {
        const rev = Number(row?.revenue) || 0;
        return rev > acc.rev ? { rev, day: int(row?.day) } : acc;
      }, { rev: 0, day: 0 });

      rDays.set(`${history.length} 天`);
      rGuests.set(`${int(totalGuests)} 人`);
      rRevenue.set(money(totalRevenue));
      rProfit.set(money(totalProfit));
      rProfit.kind(totalProfit < 0 ? 'bad' : 'good');
      rBest.set(best.rev > 0 ? `${money(best.rev)}（第 ${best.day} 天）` : '—');
      rMood.set(avgMood === null ? '—' : `${avgMood >= 0 ? '+' : ''}${avgMood.toFixed(1)} 分`);
      rMood.kind(avgMood === null ? undefined : (avgMood >= 0 ? 'good' : 'bad'));
      rAngry.set(`${int(totalAngry)} 人`);
      rAngry.kind(totalAngry > totalGuests * 0.1 ? 'bad' : 'good');
      rServe.set(totalGuests > 0 ? pct((totalServed / totalGuests) * 100, 1) : '—');
      rServe.kind(totalGuests > 0 && totalServed / totalGuests < 0.85 ? 'warn' : 'good');

      const staff = Array.isArray(state?.staff) ? state.staff : [];
      const chefs = staff.filter((s) => s?.role === 'chef');
      const waiters = staff.filter((s) => s?.role === 'waiter');
      rStaff.set(`${staff.length} 人`);
      rChef.set(`${chefs.length} 人`);
      rChef.kind(chefs.length === 0 ? 'warn' : 'good');
      rWaiter.set(`${waiters.length} 人`);
      rWaiter.kind(waiters.length === 0 ? 'warn' : 'good');
      const wageSum = staff.reduce((acc, s) => acc + (Number(s?.wage) || 0), 0);
      rWage.set(`${money(wageSum)} / 小時`);

      const items = Array.isArray(state?.layout?.items) ? state.layout.items : [];
      const decor = items.reduce((acc, item) => acc + (Number(furnOf(item?.typeId)?.decorScore) || 0), 0);
      rDecor.set(`${int(decor)} 分`);
      rItems.set(`${items.length} 件`);

      const loc = locOf(state?.locationId);
      rLoc.set(loc ? `${loc.name}（${loc.city ?? '台灣'}）★${int(state?.stars) || 1}` : '—');

      const flags = state?.flags ?? {};
      clear(flagBox);
      const flagRows = [
        ['教學完成', !!flags.tutorialDone],
        ['年度大獎', !!flags.annualAward],
        ['隱藏料理解鎖', !!flags.secretUnlocked]
      ];
      for (const [label, done] of flagRows) {
        flagBox.appendChild(tag(`${done ? '✔' : '✘'} ${label}`, done ? 'gold' : 'plain'));
      }
      flagBox.appendChild(tag(`累計評價 ★${int(state?.stars) || 1} / 5`, 'info'));
      flagBox.appendChild(tag(`知名度 ${int(state?.fame)} / 100`, 'info'));
    }

    return { el: node, update };
  }

  /* ------------------------------------------------------------------ 組裝 */
  const savesTab = buildSavesTab();
  const moveTab = buildMoveTab();
  const manualTab = buildManualTab();

  /* ------------------------------------------------------------ 廚房設備 */
  function buildKitchenTab() {
    const rows = new Map();
    const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    for (const target of ['stove', 'fridge', 'prep']) {
      const spec = B.KITCHEN_SPECS[target];
      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('span', { style: { fontSize: '18px' } }, spec.icon),
        h('span', { style: { fontWeight: 'bold' } }, spec.name),
        h('span', { class: 'muted', style: { marginLeft: 'auto' } }, '等級 —'));
      const descEl = h('div', { class: 'muted' }, '');
      const costEl = h('span', { class: 'k' }, '');
      const btn = button('升級', () => {
        const st = liveState();
        const cur = (st.kitchen && st.kitchen[target]) || 1;
        if (cur >= B.KITCHEN_MAX_LEVEL) { notify(spec.name + ' 已滿級', 'info'); return; }
        const cost = B.kitchenUpgradeCost(target, cur);
        if ((st.cash || 0) < cost) { notify('現金不足（需要 ' + money(cost) + '）', 'bad'); return; }
        ask({
          title: '升級' + spec.name,
          message: '確定要花 ' + money(cost) + ' 把' + spec.name + '升到等級 ' + (cur + 1) + '？\n' + spec.desc(cur + 1),
          okLabel: '支付 ' + money(cost) + ' 升級',
          cancelLabel: '取消'
        }).then((ok) => { if (ok) dispatch({ type: 'UPGRADE_KITCHEN', target }); });
      }, { kind: 'primary' });
      const row = h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
        head, descEl, h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          h('span', { class: 'muted' }, costEl), btn));
      rows.set(target, { head, descEl, costEl, btn });
      box.appendChild(row);
    }

    function update(state) {
      const st = state || {};
      const fx = st.kitchen || {};
      for (const target of ['stove', 'fridge', 'prep']) {
        const spec = B.KITCHEN_SPECS[target];
        const cur = fx[target] || 1;
        const r = rows.get(target);
        if (!r) continue;
        r.head.childNodes[2].textContent = '等級 ' + cur + ' / ' + B.KITCHEN_MAX_LEVEL;
        r.descEl.textContent = spec.desc(cur);
        if (cur >= B.KITCHEN_MAX_LEVEL) {
          r.costEl.textContent = '已滿級';
          r.btn.disabled = true;
          r.btn.textContent = '已滿級';
        } else {
          const cost = B.kitchenUpgradeCost(target, cur);
          r.costEl.textContent = '升級費用 ' + money(cost);
          r.btn.disabled = (st.cash || 0) < cost;
          r.btn.textContent = '升到 ' + (cur + 1) + ' 級';
        }
      }
    }

    update(liveState());
    return { el: box, update };
  }


  const statsTab = buildStatsTab();
  const kitchenTab = buildKitchenTab();

  const tabset = tabs([
    { id: 'saves', label: '存讀檔', render: () => savesTab.el },
    { id: 'move', label: '搬遷資訊', render: () => moveTab.el },
    { id: 'manual', label: '玩法說明', render: () => manualTab.el },
    { id: 'stats', label: '統計總覽', render: () => statsTab.el },
    { id: 'kitchen', label: '廚房設備', render: () => kitchenTab.el }
  ]);
  el.appendChild(tabset.el);

  function refresh(state) {
    S = state ?? {};
    savesTab.update(S);
    moveTab.update(S);
    manualTab.update(S);
    statsTab.update(S);
    kitchenTab.update(S);
  }

  try {
    if (store && typeof store.getState === 'function') refresh(store.getState());
  } catch { /* 尚未連上 store 時維持空白，第一次 refresh 會補上 */ }

  return {
    id: 'system',
    title: '系統／廚房',
    icon: '💾',
    width: 520,
    height: 470,
    el,
    open() { /* 內容隨 refresh 更新；存檔槽每次開啟都會重掃 */ },
    close() { /* 保留 DOM */ },
    refresh
  };
}

export default createSystemPanel;
