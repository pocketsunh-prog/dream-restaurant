// ============================================================================
// hud.js — DOM 介面：頂部資訊、面板（立地／菜單／說明）、結算、提示
// ============================================================================
import { LOCATIONS, locationById, REGIONS } from '../data/locations.js';
import { DISHES, dishById } from '../data/dishes.js';
import {
  money, clockText, WEATHER_JP, CUSTOMER_KINDS,
  hireStaff, fireStaff, candidateInfo, ROLE_LABEL, STAFF_LIMIT,
  EQUIPMENT_CATALOG, buyEquipment, repairEquipment,
  activeEventInfo, TASK_KINDS
} from '../sim/game.js';
import { listSlots, deleteSlot, savedAtText, storageAvailable } from '../sim/save.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    this._locRegion = '';
    this._locSort = 'stars';
    this._staffTab = 'roster';
    this.bind();
  }

  bind() {
    // 速度
    document.querySelectorAll('.speeds button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.speeds button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.hooks.onSpeed?.(Number(b.dataset.speed));
      });
    });
    // 面板開關
    $('btn-staff')?.addEventListener('click', () => this.toggle('panel-staff'));
    $('btn-locations')?.addEventListener('click', () => this.toggle('panel-locations'));
    $('btn-menu')?.addEventListener('click', () => this.toggle('panel-menu'));
    $('btn-help')?.addEventListener('click', () => this.toggle('panel-help'));
    $('btn-camera')?.addEventListener('click', () => this.hooks.onCycleCamera?.());
    $('btn-settings')?.addEventListener('click', () => this.toggle('panel-settings'));
    document.querySelectorAll('#settings-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this._settingsTab = b.dataset.stab;
        document.querySelectorAll('#settings-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.renderSettings();
      });
    });
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => this.close(b.dataset.close));
    });
    // 員工面板分頁
    document.querySelectorAll('#staff-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this._staffTab = b.dataset.tab;
        document.querySelectorAll('#staff-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.renderStaff();
      });
    });
    // 立地篩選
    const sel = $('loc-region');
    if (sel) {
      for (const r of REGIONS) {
        const o = document.createElement('option');
        o.value = r; o.textContent = r;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { this._locRegion = sel.value; this.renderLocations(); });
    }
    const sort = $('loc-sort');
    sort?.addEventListener('change', () => { this._locSort = sort.value; this.renderLocations(); });
    $('settle-next')?.addEventListener('click', () => {
      $('settle').hidden = true;
      this.hooks.onNextDay?.();
    });
  }

  /* ── 面板 ───────────────────────────────────────────────────── */

  toggle(id) {
    const el = $(id);
    if (!el) return;
    const willOpen = el.hidden;
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
    el.hidden = !willOpen;
    if (willOpen) {
      if (id === 'panel-locations') this.renderLocations();
      if (id === 'panel-menu') this.renderMenu();
      if (id === 'panel-staff') this.renderStaff();
      if (id === 'panel-settings') this.renderSettings();
    }
  }

  close(id) { const el = $(id); if (el) el.hidden = true; }

  anyPanelOpen() { return [...document.querySelectorAll('.panel')].some((p) => !p.hidden); }

  closeAll() { document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; }); }

  /* ── 設定・存讀檔 ───────────────────────────────────────────── */

  renderSettings() {
    const tab = this._settingsTab || 'config';
    const cfg = $('settings-config');
    const sav = $('settings-saves');
    if (!cfg) return;
    cfg.hidden = tab !== 'config';
    sav.hidden = tab !== 'saves';
    if (tab === 'config') this.renderConfig();
    else this.renderSaves();
  }

  renderConfig() {
    const host = $('settings-config');
    if (!host) return;
    const st = this.game;
    const s = st.settings || {};
    const g = s.graphics || {};
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const openM = s.openMinute ?? 660;
    const closeM = s.closeMinute ?? 1380;
    host.innerHTML = `
      <div class="section-title">営業時間</div>
      <div class="card">
        <div class="cfgrow"><label>開店</label><input type="range" id="cfg-open" min="0" max="1380" step="30" value="${openM}"><b id="cfg-open-v">${hm(openM)}</b></div>
        <div class="cfgrow"><label>打烊</label><input type="range" id="cfg-close" min="120" max="1439" step="30" value="${closeM}"><b id="cfg-close-v">${hm(closeM)}</b></div>
        <div class="tagline">營業時數 ${((closeM - openM) / 60).toFixed(1)} 小時（至少 2 小時）。越長賺越多，但人件費與疲勞也越高。</div>
      </div>

      <div class="section-title">音量</div>
      <div class="card">
        <div class="cfgrow"><label>マスター</label><input type="range" id="cfg-vol-master" min="0" max="100" value="${Math.round((s.audio?.master ?? 0.75) * 100)}"><b id="cfg-vol-master-v">${Math.round((s.audio?.master ?? 0.75) * 100)}</b></div>
        <div class="cfgrow"><label>音楽</label><input type="range" id="cfg-vol-music" min="0" max="100" value="${Math.round((s.audio?.music ?? 0.5) * 100)}"><b id="cfg-vol-music-v">${Math.round((s.audio?.music ?? 0.5) * 100)}</b></div>
        <div class="cfgrow"><label>効果音</label><input type="range" id="cfg-vol-sfx" min="0" max="100" value="${Math.round((s.audio?.sfx ?? 0.8) * 100)}"><b id="cfg-vol-sfx-v">${Math.round((s.audio?.sfx ?? 0.8) * 100)}</b></div>
      </div>

      <div class="section-title">画質</div>
      <div class="card">
        <div class="cfgrow"><label>解像度</label>
          <select id="cfg-pixel">
            ${['auto', '1', '1.5', '2'].map((v) => `<option value="${v}" ${String(g.pixelRatio ?? 'auto') === v ? 'selected' : ''}>${v === 'auto' ? '自動（裝置比）' : v + '×'}</option>`).join('')}
          </select><b></b></div>
        <div class="cfgrow"><label>影</label>
          <select id="cfg-shadows"><option value="1" ${g.shadows !== false ? 'selected' : ''}>オン</option><option value="0" ${g.shadows === false ? 'selected' : ''}>オフ</option></select><b></b></div>
        <div class="cfgrow"><label>影の精度</label>
          <select id="cfg-shadowq">
            ${[['high', '高（2048）'], ['medium', '中（1024）'], ['low', '低（512）']].map(([v, label]) => `<option value="${v}" ${(g.shadowQuality ?? 'high') === v ? 'selected' : ''}>${label}</option>`).join('')}
          </select><b></b></div>
        <div class="tagline">畫質調低可以讓內顯或舊電腦更順。變更會立即生效。</div>
      </div>

      <div class="section-title">カメラ・ゲーム</div>
      <div class="card">
        <div class="cfgrow"><label>視野角</label><input type="range" id="cfg-fov" min="30" max="70" step="1" value="${s.fov ?? 46}"><b id="cfg-fov-v">${s.fov ?? 46}°</b></div>
        <div class="cfgrow"><label>自動旋轉</label>
          <select id="cfg-rotate"><option value="1" ${s.autoRotate ? 'selected' : ''}>オン</option><option value="0" ${!s.autoRotate ? 'selected' : ''}>オフ</option></select><b></b></div>
        <div class="cfgrow"><label>開始速度</label>
          <select id="cfg-speed">${[0, 1, 2, 4].map((v) => `<option value="${v}" ${(s.speed ?? 1) === v ? 'selected' : ''}>${v === 0 ? '停止' : v + '×'}</option>`).join('')}</select><b></b></div>
      </div>`;

    const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
    const num = (id) => Number($(id)?.value ?? 0);
    const setHm = (id, v) => { const e = $(id); if (e) e.textContent = hm(v); };
    on('cfg-open', 'input', () => { setHm('cfg-open-v', num('cfg-open')); this.hooks.onHours?.(num('cfg-open'), num('cfg-close')); });
    on('cfg-close', 'input', () => { setHm('cfg-close-v', num('cfg-close')); this.hooks.onHours?.(num('cfg-open'), num('cfg-close')); });
    for (const k of ['master', 'music', 'sfx']) {
      on(`cfg-vol-${k}`, 'input', () => {
        const v = num(`cfg-vol-${k}`) / 100;
        const el = $(`cfg-vol-${k}-v`);
        if (el) el.textContent = String(Math.round(v * 100));
        this.hooks.onVolume?.(k, v);
      });
    }
    on('cfg-pixel', 'change', () => this.hooks.onGraphics?.({ pixelRatio: $('cfg-pixel').value }));
    on('cfg-shadows', 'change', () => this.hooks.onGraphics?.({ shadows: $('cfg-shadows').value === '1' }));
    on('cfg-shadowq', 'change', () => this.hooks.onGraphics?.({ shadowQuality: $('cfg-shadowq').value }));
    on('cfg-fov', 'input', () => { setHm('cfg-fov-v', num('cfg-fov')); $('cfg-fov-v').textContent = `${num('cfg-fov')}°`; this.hooks.onCamera?.({ fov: num('cfg-fov') }); });
    on('cfg-rotate', 'change', () => this.hooks.onCamera?.({ autoRotate: $('cfg-rotate')?.value === '1' }));
    on('cfg-speed', 'change', () => this.hooks.onSpeed?.(num('cfg-speed')));
  }

  renderSaves() {
    const host = $('settings-saves');
    if (!host) return;
    const slots = listSlots();
    const loc = (id) => LOCATIONS.find((l) => l.id === id)?.name || id || '—';
    const here = this.game;
    let html = `<div class="section-title">セーブデータ　（${storageAvailable() ? 'localStorage 利用可' : 'この環境では保存できません'}）</div>`;
    for (const sl of slots) {
      if (sl.empty) {
        html += `
        <div class="card">
          <div class="card-head"><b>${esc(sl.label)}</b><span class="role">空き</span></div>
          <div class="card-actions">
            <button class="buy" data-save="${sl.id}">ここに保存</button>
            <button data-del="${sl.id}" disabled>削除</button>
          </div>
        </div>`;
      } else {
        html += `
        <div class="card">
          <div class="card-head"><b>${esc(sl.label)}</b><span class="kana">${savedAtText(sl.savedAt)}</span>
            <span class="role">${esc(loc(sl.locationId))}</span></div>
          <div class="card-sub">
            <span>${sl.day} 日目</span>
            <span>所持金 <b>${money(sl.cash)}</b></span>
            <span>★${sl.stars}</span>
            <span>従業員 ${sl.staff} 人</span>
            <span>人気 ${Math.round(sl.fame ?? 0)}</span>
          </div>
          <div class="card-actions">
            <button class="buy" data-load="${sl.id}">読み込む</button>
            <button data-save="${sl.id}">上書き保存</button>
            <button data-del="${sl.id}">削除</button>
          </div>
        </div>`;
      }
    }
    html += `<div class="tagline">※ 現在のプレイ：${here.day} 日目・${esc(loc(here.locationId))}・${money(here.cash)}。読み込むと店舗と従業員が再構築されます。</div>`;
    host.innerHTML = html;

    host.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => {
      const r = this.hooks.onSave?.(b.dataset.save);
      if (r && r.ok) this.toast(`保存しました（${b.dataset.save === 'auto' ? 'オート' : 'スロット ' + b.dataset.save}）`, 'good');
      else this.toast(r?.error || '保存に失敗しました', 'bad');
      this.renderSaves();
    }));
    host.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      const r = this.hooks.onLoad?.(b.dataset.load);
      if (r && r.ok) { this.toast('読み込みました', 'good'); this.renderSaves(); }
      else this.toast(r?.error || '読み込みに失敗しました', 'bad');
    }));
    host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const r = deleteSlot(b.dataset.del);
      this.toast(r.ok ? '削除しました' : r.error, r.ok ? '' : 'bad');
      this.renderSaves();
    }));
  }

  /* ── 員工面板 ───────────────────────────────────────────────── */

  renderStaff() {
    const tab = this._staffTab;
    const roster = $('staff-roster');
    const hire = $('staff-hire');
    const shop = $('staff-shop');
    if (!roster) return;
    roster.hidden = tab !== 'roster';
    hire.hidden = tab !== 'hire';
    shop.hidden = tab !== 'shop';
    if (tab === 'roster') this.renderRoster();
    else if (tab === 'hire') this.renderHire();
    else this.renderShop();
  }

  _bar(label, value, max = 100) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return `<div class="bar"><i>${label}</i><span class="track"><b style="width:${pct.toFixed(0)}%"></b></span><span>${Math.round(value)}</span></div>`;
  }

  renderRoster() {
    const host = $('staff-roster');
    if (!host) return;
    const st = this.game;
    const tasks = new Map((st.tasks || []).map((t) => [t.id, t]));
    const byRole = (r) => st.staff.filter((s) => s.role === r).length;
    let html = `<div class="section-title">現在のシフト　${st.staff.length} / ${STAFF_LIMIT} 人　（料理人 ${byRole('chef')}・ホール ${byRole('waiter')}）</div>`;
    if (!st.staff.length) html += `<div class="empty">沒有員工。到「招募」分頁雇用。</div>`;
    for (const s of st.staff) {
      const t = s.taskId ? tasks.get(s.taskId) : null;
      const doing = t ? (TASK_KINDS[t.type]?.jp || t.type) : '待機';
      html += `
      <div class="card" data-staff="${esc(s.id)}">
        <div class="card-head">
          <b>${esc(s.name)}</b><span class="kana">${esc(s.kana)}</span>
          <span class="role ${s.role === 'chef' ? 'chef' : ''}">${ROLE_LABEL[s.role] || s.role}</span>
        </div>
        <div class="card-sub">
          <span>${s.age} 歳</span>
          <span>時給 <b>${money(s.wage)}</b></span>
          <span>担当 <b>${esc(s.specialty)}</b></span>
          <span>現在 <b>${esc(doing)}</b>${s.carry > 0 ? `（運搬 ${s.carry}）` : ''}</span>
        </div>
        <div class="bars">
          ${this._bar('速度', s.speed)}
          ${this._bar('手腕', s.skill)}
          ${this._bar('体力', s.stamina)}
          ${this._bar('疲労', s.fatigue)}
        </div>
        <div class="traits">${(s.traits || []).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        <div class="card-desc">${esc(s.desc)}</div>
        <div class="card-actions">
          <button class="fire" data-fire="${esc(s.id)}">解雇（資遣費 ${money(s.wage * 4)}）</button>
        </div>
      </div>`;
    }
    html += `<div class="tagline">※ 人件費＝時給 × 營業時數，於打烊結算時支付。疲勞越高動作越慢。</div>`;
    host.innerHTML = html;
    host.querySelectorAll('[data-fire]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = fireStaff(this.game, b.dataset.fire);
        if (res.ok) this.toast(`解雇しました（資遣費 ${money(res.severance)}）`, 'bad');
        else this.toast(res.error, 'bad');
        this.renderStaff();
      });
    });
  }

  renderHire() {
    const host = $('staff-hire');
    if (!host) return;
    const st = this.game;
    const cands = candidateInfo(st);
    let html = `<div class="section-title">応募者　★${st.stars} までが出応募</div>`;
    if (!cands.length) html += `<div class="empty">目前沒有應徵者（提升星級或隔天再來）。</div>`;
    for (const c of cands) {
      const afford = st.cash >= c.hireCost;
      const full = st.staff.length >= STAFF_LIMIT;
      html += `
      <div class="card">
        <div class="card-head">
          <b>${esc(c.name)}</b><span class="kana">${esc(c.kana)}</span>
          <span class="role ${c.role === 'chef' ? 'chef' : ''}">${ROLE_LABEL[c.role] || c.role}</span>
        </div>
        <div class="card-sub">
          <span>${c.age} 歳 ★${c.stars}</span>
          <span>時給 <b>${money(c.wage)}</b></span>
          <span>担当 <b>${esc(c.specialty)}</b></span>
        </div>
        <div class="bars">
          ${this._bar('速度', c.speed)}
          ${this._bar('手腕', c.skill)}
          ${this._bar('体力', c.stamina)}
        </div>
        <div class="traits">${(c.traits || []).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        <div class="card-desc">${esc(c.desc)}</div>
        <div class="card-actions">
          <button class="buy" data-hire="${esc(c.id)}" ${(!afford || full) ? 'disabled' : ''}>
            雇用（簽約金 ${money(c.hireCost)}）
          </button>
          ${!afford ? '<span class="tagline">資金不足</span>' : full ? '<span class="tagline">員工已滿</span>' : ''}
        </div>
      </div>`;
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-hire]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = hireStaff(this.game, b.dataset.hire);
        if (res.ok) this.toast(`${res.staff.name} を雇いました（${ROLE_LABEL[res.staff.role]}）`, 'good');
        else this.toast(res.error, 'bad');
        this.hooks.onStaffChanged?.();
        this.renderStaff();
      });
    });
  }

  renderShop() {
    const host = $('staff-shop');
    if (!host) return;
    const st = this.game;
    const owned = st.equipment || [];
    let html = `<div class="section-title">設備（事件の被害を半分に）</div>`;
    for (const [id, def] of Object.entries(EQUIPMENT_CATALOG)) {
      const has = owned.includes(id);
      const afford = st.cash >= def.price;
      html += `
      <div class="card">
        <div class="card-head"><b>${esc(def.jp)}</b><span class="kana">${esc(def.zh)}</span>
          <span class="role">${has ? '導入済み' : money(def.price)}</span></div>
        <div class="card-desc">${esc(def.desc)}</div>
        <div class="card-actions">
          <button class="buy" data-buy="${esc(id)}" ${(has || !afford) ? 'disabled' : ''}>${has ? '已購入' : '購入する'}</button>
        </div>
      </div>`;
    }
    // 故障
    const broken = Object.entries(st.equipBroken || {}).filter(([, v]) => v).map(([k]) => k);
    if (broken.length) {
      html += `<div class="section-title">故障中</div>`;
      for (const id of broken) {
        const name = EQUIPMENT_CATALOG[id]?.jp || { stove: 'コンロ', fridge: '冷蔵庫', ac_unit: '空調' }[id] || id;
        const cost = id === 'stove' ? 90000 : id === 'fridge' ? 70000 : 120000;
        html += `<div class="card"><div class="card-head"><b>${esc(name)}</b><span class="role">故障</span></div>
          <div class="card-actions"><button class="buy" data-repair="${esc(id)}">修理する（${money(cost)}）</button></div></div>`;
      }
    }
    // 進行中事件
    const active = activeEventInfo(st);
    html += `<div class="section-title">発生中イベント　${active.length}</div>`;
    if (!active.length) html += `<div class="empty">目前沒有事件。</div>`;
    for (const a of active) {
      html += `<div class="evrow"><span class="k ${esc(a.kind)}">${a.kind === 'positive' ? '好' : a.kind === 'negative' ? '困' : '中'}</span>
        <span>${esc(a.name)}</span><span class="t">残り ${a.left} 分</span></div>`;
    }
    // 紀錄
    const log = st.eventLog || [];
    html += `<div class="section-title">記録</div>`;
    if (!log.length) html += `<div class="empty">還沒有事件紀錄。</div>`;
    for (const e of log.slice(0, 12)) {
      html += `<div class="evrow"><span class="k ${esc(e.kind)}">${e.kind === 'positive' ? '好' : e.kind === 'negative' ? '困' : '中'}</span>
        <span>${esc(e.name)}${e.mitigated ? '（設備で軽減）' : ''}</span>
        <span class="t">${clockText(e.at)}</span></div>`;
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = buyEquipment(st, b.dataset.buy);
        if (res.ok) this.toast(`${res.def.zh} を導入しました`, 'good');
        else this.toast(res.error, 'bad');
        this.renderShop();
      });
    });
    host.querySelectorAll('[data-repair]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = repairEquipment(st, b.dataset.repair);
        if (res.ok) this.toast(`修理しました（${money(res.cost)}）`, 'good');
        else this.toast(res.error, 'bad');
        this.renderShop();
      });
    });
  }

  /* ── 立地面板 ───────────────────────────────────────────────── */

  renderLocations() {
    const list = $('loc-list');
    if (!list) return;
    const st = this.game;
    let items = LOCATIONS.filter((l) => !this._locRegion || l.region === this._locRegion);
    const key = this._locSort;
    items = items.slice().sort((a, b) => {
      if (key === 'traffic') return b.trafficBase - a.trafficBase;
      if (key === 'rent') return a.rentPerDay - b.rentPerDay;
      if (key === 'spend') return b.spendLevel - a.spendLevel;
      return a.stars - b.stars || a.id.localeCompare(b.id);
    });
    list.innerHTML = '';
    for (const l of items) {
      const locked = l.stars > st.stars;
      const here = l.id === st.locationId;
      const li = document.createElement('li');
      li.className = 'loc' + (here ? ' here' : '') + (locked ? ' locked' : '');
      const mix = Object.entries(l.customerMix)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${CUSTOMER_KINDS[k]?.jp || k}${v}%`)
        .join('・');
      li.innerHTML = `
        <div class="loc-head">
          <span class="loc-name">${l.name}</span>
          <span class="loc-zh">${l.nameZh}</span>
          <span class="loc-badge">${locked ? '★' + l.stars + ' 解放' : (here ? '営業中' : '移動 ' + money(l.moveCost))}</span>
        </div>
        <div class="loc-meta">
          <span>${l.region}・${l.city}</span>
          <span>人通り <b>${l.trafficBase}</b></span>
          <span>家賃 <b>${money(l.rentPerDay)}</b>/日</span>
          <span>客単価 <b>×${l.spendLevel.toFixed(2)}</b></span>
        </div>
        <div class="loc-meta"><span>客層 ${mix}</span></div>
        <div class="loc-desc">${l.desc}</div>`;
      if (!locked && !here) {
        li.addEventListener('click', () => {
          const res = this.hooks.onMoveLocation?.(l.id);
          if (res && res.ok === false) this.toast(res.error, 'bad');
          else { this.renderLocations(); this.toast(`${l.name} に移転しました`, 'good'); }
        });
      }
      list.appendChild(li);
    }
    const cnt = $('loc-count');
    if (cnt) cnt.textContent = `${items.length} 件 / 全 ${LOCATIONS.length} 件`;
  }

  /* ── 菜單面板 ───────────────────────────────────────────────── */

  renderMenu() {
    const list = $('menu-list');
    if (!list) return;
    const st = this.game;
    const note = $('menu-note');
    const activeCount = st.menu.filter((m) => m.active).length;
    if (note) note.textContent = `現在 ${activeCount} 道菜單（星級 ${st.stars} 可選 ${DISHES.filter((d) => d.stars <= st.stars).length} 道）`;
    list.innerHTML = '';
    const avail = DISHES.filter((d) => d.stars <= st.stars).sort((a, b) => b.popularity - a.popularity);
    for (const d of avail) {
      const entry = st.menu.find((m) => m.id === d.id);
      const li = document.createElement('li');
      li.className = 'menu-row';
      const ratio = d.price / d.cost;
      li.innerHTML = `
        <input type="checkbox" ${entry?.active ? 'checked' : ''}>
        <span class="nm"><b>${d.name}</b><i>${d.nameZh} · ${d.category} · ${d.cookTime}分</i></span>
        <span class="num"><span>原価 ${money(d.cost)}</span><br><b>${money(d.price)}</b> <span>×${ratio.toFixed(1)}</span></span>`;
      const cb = li.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!entry) st.menu.push({ id: d.id, price: d.price, active: true, stock: 60 });
          else entry.active = true;
        } else if (entry) entry.active = false;
        this.renderMenu();
      });
      list.appendChild(li);
    }
  }

  /* ── 每幀更新頂部資訊 ───────────────────────────────────────── */

  update() {
    const st = this.game;
    const loc = locationById(st.locationId);
    $('hud-day').textContent = String(st.day);
    $('hud-clock').textContent = clockText(st.minute);
    $('hud-weather').textContent = WEATHER_JP[st.weather] || st.weather;
    $('hud-cash').textContent = money(st.cash);
    $('hud-stars').textContent = '★'.repeat(st.stars) + '☆'.repeat(5 - st.stars);
    $('hud-guests').textContent = String(st.today.guests);
    $('hud-seats').textContent = String(seatsOf(st));
    const q = $('hud-queue');
    if (q) {
      q.textContent = String((st.queue || []).length);
      q.style.color = (st.queue || []).length > 2 ? 'var(--shu-2)' : '';
    }
    const sf = $('hud-staff');
    if (sf) sf.textContent = String((st.staff || []).length);
    if (loc) {
      $('hud-location').textContent = loc.name;
      $('hud-region').textContent = `${loc.region} · ${loc.city}`;
    }
    // 生效中的事件顯示在右上
    const evHost = $('hud-events');
    if (evHost) {
      const act = activeEventInfo(st);
      evHost.innerHTML = act.slice(0, 3).map((a) =>
        `<span class="evchip ${a.kind}">${a.name}<i>${a.left}分</i></span>`).join('');
    }
    const speedBtn = document.querySelector(`.speeds button[data-speed="${st.speed}"]`);
    if (speedBtn && !speedBtn.classList.contains('on')) {
      document.querySelectorAll('.speeds button').forEach((x) => x.classList.remove('on'));
      speedBtn.classList.add('on');
    }
  }

  /* ── 提示 ───────────────────────────────────────────────────── */

  toast(text, kind = '') {
    let host = $('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ── 結算 ───────────────────────────────────────────────────── */

  showSettle(r) {
    const wrap = $('settle');
    if (!wrap) return;
    $('settle-title').textContent = `${r.day} 日目の営業`;
    const dl = $('settle-list');
    const rows = [
      ['来客数', `${r.guests} 人 / ${r.groups} 組`, ''],
      ['提供', `${r.served} 人`, 'pos'],
      ['怒って帰った', `${r.angry} 人（待ち放棄 ${r.walkouts}）`, r.angry > 0 ? 'neg' : ''],
      ['売上', money(r.revenue), 'pos'],
      ['食材費', '-' + money(r.cost), 'neg'],
      ['家賃', '-' + money(r.rent), 'neg'],
      ['水光熱費', '-' + money(r.util), 'neg'],
      ['人件費', '-' + money(r.wages), 'neg'],
      ['営業利益', money(r.net), r.net >= 0 ? 'pos' : 'neg'],
      ['所持金', money(r.cash), ''],
      ['評価', '★'.repeat(this.game.stars) + `（人気 ${r.fame.toFixed(1)}）`, '']
    ];
    dl.innerHTML = rows.map(([k, v, cls]) => `<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`).join('');
    wrap.hidden = false;
  }
}

export function seatsOf(st) {
  let n = 0;
  for (const t of st.plan.tables) n += t.seats;
  return n;
}

export default Hud;
