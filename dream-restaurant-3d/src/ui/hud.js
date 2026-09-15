// ============================================================================
// hud.js — DOM 介面：頂部資訊、面板（立地／菜單／說明）、結算、提示
// ============================================================================
import { LOCATIONS, locationById, REGIONS } from '../data/locations.js';
import { DISHES, dishById } from '../data/dishes.js';
import {
  money, clockText, WEATHER_JP, CUSTOMER_KINDS, WEATHER_TRAFFIC,
  hireStaff, fireStaff, candidateInfo, ROLE_LABEL, STAFF_LIMIT,
  EQUIPMENT_CATALOG, buyEquipment, repairEquipment,
  activeEventInfo, TASK_KINDS, allTables, FLOOR_COST,
  topMenuReport, kitchenReport, rankings, crowdInfo, setRoleUniform, starReport,
  restroomList, restroomLevel, restroomLevelInfo, renovateRestroom, renovateFloorRestrooms, RESTROOM_MAX_LEVEL
} from '../sim/game.js';
import { listSlots, deleteSlot, savedAtText, storageAvailable } from '../sim/save.js';
import { uniformsForRole, uniformById, UNIFORMS } from '../data/uniforms.js';
import { missionReport, claimMission } from '../sim/missions.js';
import { goalLabel } from '../data/missions.js';

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
    $('btn-report')?.addEventListener('click', () => { this.toggle('panel-report'); this.renderReport(); });
    $('btn-rank')?.addEventListener('click', () => { this.toggle('panel-rank'); this.renderRank(); });
    $('btn-shop')?.addEventListener('click', () => { this.toggle('panel-shop'); this.renderShopPanel(); });
    $('btn-missions')?.addEventListener('click', () => { this.toggle('panel-missions'); this.renderMissions(); });
    // 店舗面板分頁（拡張 / 制服）
    document.querySelectorAll('#shop-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this._shopTab = b.dataset.shop;
        this.renderShopPanel();
      });
    });
    $('btn-cook')?.addEventListener('click', () => this.hooks.onFocusCook?.());
    // 番付の分頁
    document.querySelectorAll('#rank-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this._rankTab = b.dataset.rtab;
        this.renderRank();
      });
    });
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
      if (id === 'panel-report') this.renderReport();
      if (id === 'panel-rank') this.renderRank();
      if (id === 'panel-shop') this.renderShopPanel();
      if (id === 'panel-missions') this.renderMissions();
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

  /* ── 店舗：増築（2F/3F）と制服 ─────────────────────────────── */

  renderShopPanel() {
    const host = $('shop-expand');
    if (!host) return;
    const tab = this._shopTab || 'expand';
    document.querySelectorAll('#shop-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.shop === tab));
    const exp = $('shop-expand');
    const uni = $('shop-uniform');
    const toi = $('shop-toilet');
    if (exp) exp.hidden = tab !== 'expand';
    if (uni) uni.hidden = tab !== 'uniform';
    if (toi) toi.hidden = tab !== 'toilet';
    if (tab === 'expand') this.renderExpand();
    else if (tab === 'toilet') this.renderToilets();
    else this.renderUniforms();
  }

  /** 増築：現在幾層、每層幾個位子、下一層多少錢 */
  renderExpand() {
    const host = $('shop-expand');
    if (!host) return;
    const st = this.game;
    const plan = st.plan || {};
    const fc = plan.floorCount || 1;
    const perFloor = (plan.floorPlans || []).map((fp, i) => ({
      floor: i,
      tables: (fp.tables || []).length,
      seats: (fp.tables || []).reduce((a, t) => a + t.seats, 0),
      pet: (fp.tables || []).filter((t) => t.petOk).length
    }));
    const totalSeats = perFloor.reduce((a, f) => a + f.seats, 0);
    const totalTables = perFloor.reduce((a, f) => a + f.tables, 0);
    const c = crowdInfo(st);

    let html = `<div class="section-title">店舗の広さ</div>
    <div class="card">
      <div class="card-head"><b>現在 ${fc} 階</b><span class="role">${totalTables} 卓 / ${totalSeats} 席</span></div>
      <div class="card-sub">
        <span>店内 <b>${c.insideGuests}</b> 名</span>
        <span>空き <b>${c.seatsFree}</b> 席</span>
        <span>行列 <b>${c.waiting}</b> 組</span>
        <span>ペット同伴席 <b>${c.petOkTables}</b> 卓</span>
      </div>
    </div>`;

    for (const f of perFloor) {
      const name = f.floor === 0 ? '1F（客席・調理場・お手洗い）' : `${f.floor + 1}F（客席のみ）`;
      html += `<div class="report-row">
        <span class="r-name"><b>${name}</b><i>${f.pet ? `ペット同伴席 ${f.pet} 卓` : ' '}</i></span>
        <span class="r-num">${f.tables} 卓</span>
        <span class="r-rev">${f.seats} 席</span>
      </div>`;
    }
    html += `<p class="muted">增築すると新しい客席が増えます。${fc > 1 ? '客人とスタッフは<b>階段</b>で各階を行き来します。' : ''}</p>`;

    if (fc >= 3) {
      html += `<div class="section-title">増築</div>
      <div class="card"><div class="card-head"><b>これ以上は増築できません</b><span class="role">3 階建て</span></div>
      <div class="card-desc">すでに最上階まで増築済みです。席を増やしたいときは「設備・事件」で内装を整え、回転率を上げましょう。</div></div>`;
    } else {
      const next = fc + 1;
      const cost = FLOOR_COST[next] || 0;
      const afford = st.cash >= cost;
      const addSeats = next === 2 ? 32 : 32;   // 樓上的座位數（參考值）
      html += `<div class="section-title">増築</div>
      <div class="card">
        <div class="card-head"><b>${next}F を増築する</b><span class="role">${money(cost)}</span></div>
        <div class="card-desc">客席が約 ${addSeats} 席増えます（4 人卓 ×8）。費用は 2F ¥800,000／3F ¥2,400,000、
          まとめて増築するとその分だけかかります。</div>
        <div class="card-actions">
          <button class="buy" data-floor="${next}" ${afford ? '' : 'disabled'}>${next}F を増築（${money(cost)}）</button>
        </div>
      </div>`;
      if (fc === 1 && st.cash >= (FLOOR_COST[2] || 0) + (FLOOR_COST[3] || 0)) {
        html += `<div class="card">
          <div class="card-head"><b>一気に 3F まで</b><span class="role">${money((FLOOR_COST[2] || 0) + (FLOOR_COST[3] || 0))}</span></div>
          <div class="card-desc">2F と 3F をまとめて増築します（2 層分の費用）。</div>
          <div class="card-actions"><button data-floor="3">3F まで増築</button></div>
        </div>`;
      }
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-floor]').forEach((b) => b.addEventListener('click', () => {
      const res = this.hooks.onFloor?.(Number(b.dataset.floor));
      if (res && res.ok) this.toast(`${res.floorCount} 階に増築しました（${money(res.cost)}）`, 'good');
      else if (res && res.error) this.toast(res.error, 'bad');
      this.renderExpand();
    }));
  }

  /** 制服：職種ごとに一括で選ぶ／個人ごとに選ぶ */
  _uniformSwatch(u) {
    const c = (col) => `<i class="sw" style="background:${esc(col || '#888')}"></i>`;
    return `<span class="sw-row">${c(u.shirt)}${c(u.vest)}${c(u.pants)}${c(u.hat || u.accent)}</span>`;
  }

  renderUniforms() {
    const host = $('shop-uniform');
    if (!host) return;
    const st = this.game;
    const roles = [
      { role: 'chef', jp: '料理人', zh: '廚師' },
      { role: 'waiter', jp: 'ホール', zh: '服務生' }
    ];
    let html = '';
    for (const r of roles) {
      const members = st.staff.filter((s) => s.role === r.role);
      const ids = uniformsForRole(r.role);
      html += `<div class="section-title">${r.jp}の制服（${r.zh}）　${members.length} 人</div>`;
      if (!members.length) html += `<div class="empty">${r.jp}がいません。「従業員 → 招募」で雇ってください。</div>`;
      for (const uid of ids) {
        const u = uniformById(uid);
        const used = members.filter((s) => s.uniformId === uid).length;
        html += `
        <div class="card uniform-card${used ? ' on' : ''}">
          <div class="card-head"><b>${esc(u.label)}</b><span class="role">${used ? used + ' 人が着用' : '未使用'}</span></div>
          <div class="card-sub">${this._uniformSwatch(u)}<span>${esc(u.labelZh)}</span></div>
          <div class="card-actions">
            <button class="buy" data-role-uniform="${esc(r.role)}:${esc(uid)}" ${members.length ? '' : 'disabled'}>全員に適用</button>
          </div>
        </div>`;
      }
      if (members.length) {
        html += `<div class="section-title">個人ごと</div>`;
        for (const s of members) {
          const opts = ids.map((uid) => {
            const u = uniformById(uid);
            return `<option value="${uid}" ${uid === s.uniformId ? 'selected' : ''}>${esc(u?.label || uid)}</option>`;
          }).join('');
          html += `<div class="uniform-row"><span class="nm"><b>${esc(s.name)}</b><i>${r.jp}</i></span>
            <select data-uni="${esc(s.id)}">${opts}</select></div>`;
        }
      }
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-role-uniform]').forEach((b) => b.addEventListener('click', () => {
      const [role, uid] = b.dataset.roleUniform.split(':');
      const res = this.hooks.onRoleUniform?.(role, uid) || setRoleUniform(st, role, uid);
      if (res && res.ok) this.toast(`${role === 'chef' ? '料理人' : 'ホール'} ${res.count} 人の制服を「${uniformById(uid)?.label}」にしました`, 'good');
      this.renderUniforms();
    }));
    host.querySelectorAll('[data-uni]').forEach((sel) => sel.addEventListener('change', () => {
      const res = this.hooks.onUniform?.(sel.dataset.uni, sel.value);
      if (res && res.ok) this.toast(`制服を「${uniformById(sel.value)?.label}」にしました`, 'good');
      this.renderUniforms();
    }));
  }

  /* ── 依頼（ミッション）─────────────────────────────────────── */

  renderMissions() {
    const host = $('missions-body');
    if (!host) return;
    const st = this.game;
    const R = missionReport(st);
    const rewardText = (r) => {
      const out = [];
      if (r.cash) out.push(money(r.cash));
      if (r.fame) out.push(`評価 +${r.fame}`);
      if (r.equipment) out.push(EQUIPMENT_CATALOG[r.equipment]?.jp || r.equipment);
      if (r.title) out.push(`称号「${r.title}」`);
      return out.join('・') || '—';
    };

    let html = `<div class="rank-banner">
      <div class="rb-main"><b>依頼（ミッション）</b><span>達成して「受取」すると賞金・評價・称号がもらえます</span></div>
      <div class="rb-score"><em>達成 / 全件</em><b>${R.completedCount}/${R.total}</b></div>
      <div class="rb-sub">受取済み <b>${R.claimedCount}</b> 件　解放ティア <b>${R.unlockedTier} / 5</b>（達成 3 件ごとに次のティアが開きます）
        ${R.titles.length ? `<br>称号：${R.titles.map((t) => `<b>${esc(t)}</b>`).join('・')}` : ''}</div>
    </div>`;

    // ⓪ 星級の條件とヒント（依頼と同じ「目標」なのでここに出す）
    const SR = starReport(st);
    html += `<div class="section-title">⭐ 星級：${'★'.repeat(SR.stars)}${'☆'.repeat(SR.max - SR.stars)}　${SR.next ? `次の ★${SR.next} の條件` : '最高星に到達'}</div>`;
    if (SR.next) {
      html += `<div class="card"><div class="card-head"><b>★${SR.next} への條件</b><span class="role">${SR.ready ? '達成（打烊時に昇格）' : '進行中'}</span></div>`;
      for (const r of SR.list) {
        const pct = Math.max(0, Math.min(100, Math.round((r.cur / Math.max(1, r.target)) * 100)));
        html += `<div class="report-row${r.ok ? ' me' : ''}">
          <span class="r-rank">${r.ok ? '✅' : '▢'}</span>
          <span class="r-name"><b>${esc(r.label)}</b></span>
          <span class="r-num">${r.cur.toLocaleString('en-US')}</span>
          <span class="r-bar"><b style="width:${pct}%"></b></span>
          <span class="r-rev">${r.target.toLocaleString('en-US')}</span>
        </div>`;
      }
      html += `<div class="card-desc">条件を満たした狀態で<b>打烊結算</b>すると ★${SR.next} に上がります（昇格時に人氣 +4）。</div></div>`;
    } else {
      html += `<div class="card"><div class="card-desc">最高星（★5）です。ここからは依頼の達成と週の利益で店を磨きましょう。</div></div>`;
    }
    html += `<div class="section-title">人氣を上げるヒント</div><div class="card"><div class="card-desc">`
      + SR.tips.map((t) => `・${esc(t)}`).join('<br>') + `</div></div>`;

    // ① 受取可能
    html += `<div class="section-title">受取できます（${R.claimable.length}）</div>`;
    if (!R.claimable.length) html += `<div class="empty">達成した依頼はありません。営業を続けましょう。</div>`;
    for (const c of R.claimable) {
      const m = c.mission;
      html += `<div class="card mission-card claimable">
        <div class="card-head"><b>🎯 ${esc(m.jp)}</b><span class="role">達成</span></div>
        <div class="card-sub"><span>${esc(m.zh)}</span><span>報酬 <b>${esc(rewardText(m.reward))}</b></span></div>
        <div class="card-actions"><button class="buy" data-claim="${esc(m.id)}">報酬を受け取る</button></div>
      </div>`;
    }

    // ② 進行中
    html += `<div class="section-title">進行中（達成が近い順）</div>`;
    if (!R.active.length) html += `<div class="empty">進行中の依頼はありません。</div>`;
    for (const a of R.active) {
      const m = a.mission;
      const p = a.progress;
      const pct = Math.max(0, Math.min(100, Math.round((p.cur / p.target) * 100)));
      html += `<div class="card">
        <div class="card-head"><b>${esc(m.jp)}</b><span class="kana">${esc(m.zh)}</span></div>
        <div class="card-desc">${esc(m.desc)}</div>
        <div class="report-row">
          <span class="r-name"><i>${esc(goalLabel(m.goal))}</i></span>
          <span class="r-num">${p.cur.toLocaleString('en-US')}</span>
          <span class="r-bar"><b style="width:${pct}%"></b></span>
          <span class="r-pct">${pct}%</span>
          <span class="r-rev">${p.target.toLocaleString('en-US')}</span>
        </div>
        <div class="card-sub"><span>報酬 <b>${esc(rewardText(m.reward))}</b></span><span>tier ${m.tier}</span></div>
      </div>`;
    }

    // ③ ティア別の一覧
    for (const t of R.byTier) {
      html += `<div class="section-title">tier ${t.tier}${t.locked ? '（未解放）' : ''}</div>`;
      if (t.locked) {
        html += `<div class="empty">達成 3 件ごとに次のティアが解放されます。</div>`;
        continue;
      }
      for (const row of t.missions) {
        const m = row.mission;
        const mark = row.claimed ? '✅ 受取済み' : row.completed ? '🎁 受取待ち' : `${row.progress.cur.toLocaleString('en-US')} / ${row.progress.target.toLocaleString('en-US')}`;
        html += `<div class="report-row${row.claimed ? ' me' : ''}">
          <span class="r-name"><b>${esc(m.jp)}</b><i>${esc(m.zh)}・${esc(goalLabel(m.goal))}</i></span>
          <span class="r-num">${mark}</span>
          <span class="r-rev">${esc(rewardText(m.reward))}</span>
        </div>`;
      }
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
      const res = this.hooks.onClaimMission?.(b.dataset.claim) || claimMission(st, b.dataset.claim);
      if (res && res.ok) this.toast(`報酬を受け取りました：${(res.got || []).join('・')}`, 'good');
      else if (res && res.error) this.toast(res.error, 'bad');
      this.renderMissions();
    }));
  }

  /* ── 熱門菜單報表 ＋ 調理場の状況 ───────────────────────────── */

  renderReport() {
    const host = $('report-body');
    if (!host) return;
    const st = this.game;
    const r = topMenuReport(st);
    const k = kitchenReport(st);
    const c = crowdInfo(st);
    const rank = ['🥇', '🥈', '🏅', '4.', '5.', '6.', '7.', '8.'];

    let html = `<div class="section-title">にぎわい看板（門前の掲示）</div>
    <div class="card">
      <div class="card-head"><b>${c.full ? '満席' : '空席あり'}</b><span class="role">店内 ${c.insideGuests} 名 / ${c.seats} 席</span></div>
      <div class="card-sub">
        <span>本日の来客 <b>${c.todayGuests}</b> 名</span>
        <span>行列 <b>${c.waiting}</b> 組（待ち ${c.maxQueueWait} 分）</span>
        <span>ペット同伴 <b>${c.petInside}</b> 組</span>
      </div>
    </div>`;
    if (c.waitingList.length) {
      html += `<div class="section-title">候位名單（店外の列）</div>`;
      html += c.waitingList.map((w, i) => `
        <div class="report-row">
          <span class="r-rank">${i + 1}.</span>
          <span class="r-name"><b>${w.size} 名様</b><i>${esc(w.kindJp)}${w.pet ? '・🐾 ペット同伴' : ''}</i></span>
          <span class="r-pct">${w.waitMin} 分</span>
        </div>`).join('');
    }

    html += `<div class="section-title">調理場　（料理人 ${k.counts.chefs} 人・調理中 ${k.counts.cooking}・出餐口 ${k.counts.ready}）</div>`;
    if (!k.chefs.length) html += `<div class="empty">料理人がいません。「従業員 → 招募」で料理人を雇ってください。</div>`;
    for (const c of k.chefs) {
      const dishes = c.dishes.length
        ? c.dishes.map((d) => `<b>${esc(d.name)}</b><i>${esc(d.nameZh)}</i>`).join('、')
        : '—';
      const pct = Math.round(c.progress * 100);
      const stateJp = c.working ? '調理中' : c.phase === 'walk' ? '爐へ移動中' : '待機中';
      html += `
      <div class="card">
        <div class="card-head"><b>🍳 ${esc(c.name)}</b><span class="role">${stateJp}</span>
          <button class="mini" data-cook="${esc(c.id)}">この料理を見る</button></div>
        <div class="card-sub"><span>料理 <b>${dishes}</b></span><span>腕前 <b>${c.skill}</b></span><span>疲労 <b>${c.fatigue}</b></span></div>
        <div class="report-row" style="margin-top:4px">
          <span class="r-bar"><b style="width:${c.working ? pct : 0}%"></b></span>
          <span class="r-pct">${c.working ? pct + '%' : '—'}</span>
        </div>
      </div>`;
    }
    html += `<div class="section-title">出餐口（配膳待ち）</div>`;
    if (!k.pass.length) html += `<div class="empty">出餐口は空です。</div>`;
    else html += k.pass.map((p) => `
      <div class="report-row">
        <span class="r-name"><b>${p.dishes.map((d) => esc(d.name)).join('、') || '—'}</b>
          <i>${p.dishes.map((d) => esc(d.nameZh)).join('、')}</i></span>
        <span class="r-num">${p.floor + 1}F</span>
        <span class="r-pct">${p.taken ? '配膳中' : '待ち ' + p.waitMin + '分'}</span>
      </div>`).join('');

    html += `<div class="section-title">今日点単ランキング　（計 ${r.totalCount} 点 / 売上 ¥${r.totalRevenue.toLocaleString('en-US')}）</div>`;
    if (!r.items.length) html += `<div class="empty">まだ注文がありません。</div>`;
    r.items.forEach((it, i) => {
      const w = r.totalCount ? Math.round(it.pct) : 0;
      html += `
      <div class="report-row">
        <span class="r-rank">${rank[i] || (i + 1) + '.'}</span>
        <span class="r-name"><b>${esc(it.name)}</b><i>${esc(it.nameZh)}</i></span>
        <span class="r-num">×${it.count}</span>
        <span class="r-bar"><b style="width:${w}%"></b></span>
        <span class="r-pct">${it.pct}%</span>
        <span class="r-rev">${money(it.revenue)}</span>
      </div>`;
    });
    // 顧客客層統計
    const kc = st.today?.kindCount || {};
    const totalK = Object.values(kc).reduce((a, b) => a + b, 0) || 1;
    html += `<div class="section-title">客層別</div>`;
    html += Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([k2, n]) =>
      `<div class="report-row"><span class="r-name">${esc((CUSTOMER_KINDS[k2] || {}).jp || k2)}</span><span class="r-num">×${n}</span>
        <span class="r-bar"><b style="width:${Math.round(n / totalK * 100)}%"></b></span><span class="r-pct">${(n / totalK * 100).toFixed(0)}%</span></div>`
    ).join('');
    host.innerHTML = html;
    host.querySelectorAll('[data-cook]').forEach((b) => {
      b.addEventListener('click', () => this.hooks.onFocusCook?.(b.dataset.cook));
    });
  }

  /* ── 番付（排行榜：店內 / 全地點）───────────────────────────── */

  renderRank() {
    const host = $('rank-body');
    if (!host) return;
    const st = this.game;
    const R = rankings(st);
    const tab = this._rankTab || 'local';
    document.querySelectorAll('#rank-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.rtab === tab));
    const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.');
    const L = R.local;
    let html = '';

    if (tab === 'local') {
      // 本店在全部地點中的位置
      const s = R.summary;
      html += `<div class="rank-banner">
        <div class="rb-main"><b>${esc(R.locationName)}</b><span>${esc(R.locationNameZh)}</span></div>
        <div class="rb-score"><em>全 ${s.totalLocations} 地点中</em><b>${s.myRank} 位</b></div>
        <div class="rb-sub">売上順位の目安 <b>${s.revenueRank} 位</b>　本日の売上 <b>${money(s.todayRevenue)}</b>　自己ベスト <b>${money(L.record.bestRevenue)}</b>（${L.record.bestDay || '—'} 日目）
          　この地点の平均日商 <b>${money(s.potentialHere)}</b>　<b>${s.beaten}</b> 地点を上回った</div>
      </div>`;

      html += `<div class="section-title">店史（この店の記録）</div>
      <div class="card"><div class="card-sub">
        <span>営業日数 <b>${L.record.days}</b></span>
        <span>累計売上 <b>${money(L.record.totalRevenue)}</b></span>
        <span>最高日商 <b>${money(L.record.bestRevenue)}</b></span>
        <span>最多来客 <b>${L.record.bestGuests} 人</b></span>
        <span>最高利益 <b>${money(L.record.bestNet)}</b></span>
      </div></div>`;

      html += `<div class="section-title">料理ランキング（全期間）</div>`;
      if (!L.dishes.length) html += `<div class="empty">まだデータがありません。</div>`;
      L.dishes.slice(0, 12).forEach((d, i) => {
        html += `<div class="report-row">
          <span class="r-rank">${medal(i)}</span>
          <span class="r-name"><b>${esc(d.name)}</b><i>${esc(d.nameZh)}</i></span>
          <span class="r-num">×${d.count}</span>
          <span class="r-bar"><b style="width:${Math.min(100, d.pct)}%"></b></span>
          <span class="r-pct">${d.pct}%</span>
          <span class="r-rev">${money(d.revenue)}</span>
        </div>`;
      });

      html += `<div class="section-title">料理人ランキング（調理した品数）</div>`;
      if (!L.chefs.length) html += `<div class="empty">料理人がいません。</div>`;
      L.chefs.forEach((s2) => {
        html += `<div class="report-row">
          <span class="r-rank">${medal(s2.rank - 1)}</span>
          <span class="r-name"><b>${esc(s2.name)}</b><i>${esc(s2.roleJp)}・腕前 ${s2.skill}</i></span>
          <span class="r-num">${s2.cooked} 品</span>
          <span class="r-bar"><b style="width:${Math.min(100, s2.cooked / Math.max(1, L.chefs[0].cooked) * 100)}%"></b></span>
          <span class="r-pct">${s2.tasks} 件</span>
        </div>`;
      });

      html += `<div class="section-title">ホールランキング（担当した売上）</div>`;
      if (!L.waiters.length) html += `<div class="empty">ホールがいません。</div>`;
      L.waiters.forEach((s2) => {
        html += `<div class="report-row">
          <span class="r-rank">${medal(s2.rank - 1)}</span>
          <span class="r-name"><b>${esc(s2.name)}</b><i>案内 ${s2.seated}・配膳 ${s2.delivered}・会計 ${s2.payments}・清掃 ${s2.cleaned}</i></span>
          <span class="r-num">${s2.tasks} 件</span>
          <span class="r-bar"><b style="width:${Math.min(100, s2.revenue / Math.max(1, L.waiters[0].revenue) * 100)}%"></b></span>
          <span class="r-rev">${money(s2.revenue)}</span>
        </div>`;
      });

      html += `<div class="section-title">客層ランキング</div>`;
      L.kinds.forEach((k2) => {
        html += `<div class="report-row">
          <span class="r-rank">${medal(k2.rank - 1)}</span>
          <span class="r-name"><b>${esc(k2.name)}</b><i>${esc(k2.nameZh)}</i></span>
          <span class="r-num">${k2.groups} 組 / ${k2.guests} 人</span>
          <span class="r-bar"><b style="width:${k2.pct}%"></b></span>
          <span class="r-pct">${k2.pct}%</span>
          <span class="r-rev">${money(k2.revenue)}</span>
        </div>`;
      });

      html += `<div class="section-title">時間帯別（売上）</div>`;
      if (!L.hours.length) html += `<div class="empty">まだデータがありません。</div>`;
      const maxRev = Math.max(1, ...L.hours.map((h) => h.revenue));
      for (const h of L.hours) {
        html += `<div class="report-row">
          <span class="r-rank">${String(h.hour).padStart(2, '0')}時</span>
          <span class="r-name"><i>${h.groups} 組 / ${h.guests} 人</i></span>
          <span class="r-bar"><b style="width:${Math.round(h.revenue / maxRev * 100)}%"></b></span>
          <span class="r-rev">${money(h.revenue)}</span>
        </div>`;
      }
      if (L.bestHour) html += `<p class="muted">一番稼ぐ時間帯：<b>${L.bestHour.hour} 時</b>（${money(L.bestHour.revenue)}）</p>`;
    } else {
      // 全地點排行
      const s = R.summary;
      html += `<div class="rank-banner">
        <div class="rb-main"><b>全地点ランキング</b><span>平均日商ベース・${R.global.length} 地点</span></div>
        <div class="rb-score"><em>自店の順位</em><b>${s.myRank} 位</b></div>
        <div class="rb-sub">売上順位の目安 <b>${s.revenueRank} 位</b>（自己ベストと本日の高い方 <b>${money(s.myScore)}</b>）
          　— 現在の立地：<b>${esc(R.locationName)}</b>
          ${s.beaten === 0 ? '<br>まだどの地点の平均日商にも届いていない（営業日を重ねて客数を伸ばそう）' : `　<b>${s.beaten}</b> 地点の平均を上回った`}</div>
      </div>
      <div class="section-title">地点別（平均日商）</div>`;
      for (const g of R.global) {
        const mine = g.myBest > 0;
        html += `<div class="report-row${g.isHere ? ' me' : ''}">
          <span class="r-rank">${medal(g.rank - 1)}</span>
          <span class="r-name"><b>${esc(g.name)}</b><i>${esc(g.region)}・${esc(g.city)}　★${g.stars}　人通り ${g.trafficBase}/時　家賃 ${money(g.rentPerDay)}/日</i></span>
          <span class="r-num">${g.isHere ? '自店' : ''}</span>
          <span class="r-rev">${money(g.potential)}</span>
          <span class="r-pct">${mine ? '自己ベスト ' + money(g.myBest) : ''}</span>
        </div>`;
        if (g.isHere) {
          html += `<div class="rank-marker">▲ いま営業しているのはここ（${g.rank} 位 / ${R.global.length} 地点）</div>`;
        }
      }
    }
    host.innerHTML = html;
  }

  /* ── 顧客詳情 ───────────────────────────────────────────────── */

  renderCustomerDetail(group) {
    const host = $('customer-detail');
    if (!host || !group) return;
    const st = this.game;
    const def = CUSTOMER_KINDS[group.kind] || {};
    const stateLabel = {
      entering: '来店中', queue: '行列で待機中', wait席: '席案内待ち', to席: '席へ移動中',
      ordering: '注文中', waitCook: '調理待ち', waitServe: '配膳待ち', eating: '食事中',
      waitPay: '会計待ち', leaving: '退店中', angryLeave: '怒って帰った', gone: '帰りました'
    };
    const stMap = { entering: '来店中', waitSeat: '席案内待ち', toSeat: '席へ移動中', ordering: '注文中', waitCook: '調理待ち', waitServe: '配膳待ち', eating: '食事中', waitPay: '会計待ち', leaving: '退店中', angryLeave: '怒って帰った' };
    const stateText = stMap[group.state] || group.state;
    const patienceLeft = Math.max(0, Math.round(group.patience - group.wait));
    const orderedNames = (group.orders || []).map(id => {
      const d = dishById(id);
      return d ? `${d.name}（${d.nameZh}）${money(d.price)}` : id;
    });

    let html = `
      <div class="section-title">${esc(def.jp || group.kind)}　${group.size} 名様</div>
      <div class="card">
        <div class="card-head"><b>状態</b><span class="role">${esc(stateText)}</span></div>
        <div class="card-sub">
          <span>組 <b>#${group.id.replace('g','')}</b></span>
          <span>客単価 <b>×${group.spend.toFixed(2)}</b></span>
          <span>気分 <b>${group.mood > 0 ? '😊' : group.mood < -2 ? '😠' : '😐'} ${group.mood.toFixed(1)}</b></span>
          <span>待ち <b>${Math.round(group.wait)} 分</b></span>
        </div>
      </div>`;

    html += `<div class="section-title">注文　${orderedNames.length} 点</div>`;
    if (!orderedNames.length) html += `<div class="empty">まだ注文していません。</div>`;
    else html += orderedNames.map(n => `<div class="menu-row" style="cursor:default"><span class="nm"><b>${esc(n)}</b></span></div>`).join('');

    // 調理の進み具合：この注文を今誰が作っているか
    const cookTask = (st.tasks || []).find((t) => t.type === 'cook' && t.groupId === group.id);
    const passItem = (st.pass || []).find((p) => p.groupId === group.id);
    if (cookTask || passItem) {
      const chef = cookTask?.claimedBy ? (st.staff || []).find((s) => s.id === cookTask.claimedBy) : null;
      const total = Math.max(0.001, cookTask?.work || 1);
      const pct = cookTask ? Math.round(Math.max(0, Math.min(1, 1 - Math.max(0, cookTask.workLeft) / total)) * 100) : 100;
      const phaseJp = passItem ? '出餐口にできあがり（配膳待ち）'
        : cookTask.phase === 'walk' ? '料理人が爐へ移動中'
          : `${chef?.name || '料理人'}が調理中`;
      html += `<div class="section-title">調理の状況</div>
        <div class="card">
          <div class="card-head"><b>${esc(phaseJp)}</b><span class="role">${pct}%</span></div>
          <div class="report-row"><span class="r-bar"><b style="width:${pct}%"></b></span></div>
        </div>`;
    }

    if (group.pet) {
      const petJp = { dog: '犬', cat: '猫', rabbit: 'うさぎ', bird: '鳥' };
      html += `<div class="section-title">ペット</div><div class="card"><div class="card-head"><b>${esc(petJp[group.pet] || group.pet)}</b></div></div>`;
    }
    host.innerHTML = html;
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
        <div class="uniform-row"><span class="tagline">制服</span>
          <select class="uni-select" data-uni="${esc(s.id)}">
            ${uniformsForRole(s.role).map((uid) => {
              const u = uniformById(uid);
              return `<option value="${uid}" ${uid === s.uniformId ? 'selected' : ''}>${u ? esc(u.label) : uid}</option>`;
            }).join('')}
          </select>
        </div>
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
    host.querySelectorAll('.uni-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const res = this.hooks.onUniform?.(sel.dataset.uni, sel.value);
        if (res && res.ok) this.toast('制服を変更しました', 'good');
        else if (res && res.error) this.toast(res.error, 'bad');
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

    // 擴建樓層移到「🏗 店舗」面板（這裡只留提示，避免兩個地方各有一份）
    const fc = st.plan?.floorCount || 1;
    if (fc < 3) {
      const cost = FLOOR_COST[fc + 1] || 0;
      host.innerHTML = `<div class="section-title">増築</div>
      <div class="card"><div class="card-head"><b>${fc + 1}F を増築できます</b><span class="role">${money(cost)}</span></div>
        <div class="card-desc">現在 ${fc} 階。増築の詳細は「🏗 店舗」パネル（<kbd>E</kbd>）で。</div>
        <div class="card-actions"><button class="buy" data-goshop="1">🏗 店舗を開く</button></div></div>` + host.innerHTML;
      host.querySelector('[data-goshop]')?.addEventListener('click', () => this.toggle('panel-shop'));
    }

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
      const c = crowdInfo(st);
      q.textContent = String(c.waiting);
      q.title = c.waiting ? `待ち ${c.maxQueueWait} 分（最長）` : '行列なし';
      q.style.color = c.waiting > 2 ? 'var(--shu-2)' : '';
    }
    const sf = $('hud-staff');
    if (sf) sf.textContent = String((st.staff || []).length);
    if (loc) {
      $('hud-location').textContent = loc.name;
      $('hud-region').textContent = `${loc.region} · ${loc.city}`;
    }
    // 生效中的事件顯示在右上（依頼の受取待ちもここに出す）
    const evHost = $('hud-events');
    if (evHost) {
      const act = activeEventInfo(st);
      const mr = missionReport(st);
      const chips = act.slice(0, 3).map((a) =>
        `<span class="evchip ${a.kind}">${a.name}<i>${a.left}分</i></span>`).join('');
      const missionChip = mr.claimable.length
        ? `<span class="evchip mission" title="依頼 → 受取">🎯 受取待ち ${mr.claimable.length}</span>` : '';
      evHost.innerHTML = missionChip + chips;
    }
    const wEl = $('hud-weather');
    if (wEl) {
      const bad = st.weather === 'storm' || st.weather === 'sleet' || st.weather === 'snow';
      const hot = st.weather === 'heat';
      wEl.style.color = bad ? 'var(--shu-2)' : hot ? 'var(--kin)' : '';
      wEl.title = `客足 ${Math.round((WEATHER_TRAFFIC[st.weather] ?? 1) * 100)}%`;
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
  for (const t of allTables(st.plan)) n += t.seats;
  return n;
}

export default Hud;
