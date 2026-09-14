// ============================================================================
// hud.js — DOM 介面：頂部資訊、面板（立地／菜單／說明）、結算、提示
// ============================================================================
import { LOCATIONS, locationById, REGIONS } from '../data/locations.js';
import { DISHES, dishById } from '../data/dishes.js';
import { money, clockText, WEATHER_JP, CUSTOMER_KINDS } from '../sim/game.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    this._locRegion = '';
    this._locSort = 'stars';
    this._toastTimer = null;
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
    $('btn-locations')?.addEventListener('click', () => this.toggle('panel-locations'));
    $('btn-menu')?.addEventListener('click', () => this.toggle('panel-menu'));
    $('btn-help')?.addEventListener('click', () => this.toggle('panel-help'));
    $('btn-camera')?.addEventListener('click', () => this.hooks.onCycleCamera?.());
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => this.close(b.dataset.close));
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
    }
  }

  close(id) { const el = $(id); if (el) el.hidden = true; }

  anyPanelOpen() { return [...document.querySelectorAll('.panel')].some((p) => !p.hidden); }

  closeAll() { document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; }); }

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
    if (loc) {
      $('hud-location').textContent = loc.name;
      $('hud-region').textContent = `${loc.region} · ${loc.city}`;
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
