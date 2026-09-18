// ============================================================================
// widgets.js — 共用 UI 元件（90 年代米黃色視窗風格）
// 契約見 docs/ARCHITECTURE.md §5.1。UI 面板一律使用這裡的元件，不得自建樣式。
// ============================================================================
import { MAX_STARS } from '../core/balance.js';

/* ---------------------------------------------------------------- DOM 工具 */

/**
 * 建立 DOM 元素。props 支援：class/className, style(物件), dataset(物件),
 * text, onclick/oninput/onchange/onmousedown... 其餘作為屬性。
 */
export function h(tag, props = null, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') node.className = value;
      else if (key === 'style') {
        if (typeof value === 'string') node.style.cssText = value;
        else for (const [k, v] of Object.entries(value)) {
          // 同時支援 camelCase（flexDirection）與 kebab-case（flex-direction）
          const prop = k.includes('-') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          node.style.setProperty(prop, v);
        }
      } else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'text') node.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** 由靜態 HTML 字串建立元素（禁止插入玩家輸入） */
export function el(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/* ------------------------------------------------------------------- 按鈕 */

export function button(label, onClick, opts = {}) {
  const node = h('button', {
    class: `btn${opts.kind ? ' kind-' + opts.kind : ''}${opts.small ? ' sm' : ''}${opts.on ? ' is-on' : ''}`,
    type: 'button',
    title: opts.title || '',
    disabled: !!opts.disabled
  }, label);
  if (onClick) node.addEventListener('click', (ev) => onClick(ev, node));
  return node;
}

export function toolbar(...children) {
  return h('div', { class: 'toolbar' }, ...children);
}

export function sep() {
  return h('div', { class: 'sep' });
}

/* --------------------------------------------------------------- 表單欄位 */

export function numberField({ label, value = 0, min = 0, max = 100, step = 1, onChange, suffix = '', width = 62 }) {
  const input = h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  input.style.width = width + 'px';
  const commit = () => {
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = value;
    v = Math.min(max, Math.max(min, v));
    input.value = String(v);
    if (onChange) onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { commit(); input.blur(); } });
  const node = h('div', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null,
    input,
    suffix ? h('span', { class: 'field-suffix' }, suffix) : null
  );
  return { el: node, input, set(v) { input.value = String(v); }, get() { return Number(input.value); } };
}

export function slider({ label, value = 50, min = 0, max = 100, step = 1, onChange, suffix = '' }) {
  const input = h('input', { type: 'range', value: String(value), min: String(min), max: String(max), step: String(step) });
  const out = h('span', { class: 'field-suffix' }, String(value) + suffix);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = String(v) + suffix;
    if (onChange) onChange(v);
  });
  const node = h('div', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null,
    input, out
  );
  return { el: node, input, set(v) { input.value = String(v); out.textContent = String(v) + suffix; }, get() { return Number(input.value); } };
}

export function select({ label, value, options = [], onChange }) {
  const node0 = h('select', {});
  for (const opt of options) node0.appendChild(h('option', { value: String(opt.value), selected: String(opt.value) === String(value) }, opt.label));
  node0.addEventListener('change', () => { if (onChange) onChange(node0.value); });
  const node = h('div', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, node0);
  return {
    el: node, input: node0,
    set(v) { node0.value = String(v); },
    get() { return node0.value; },
    setOptions(options2) { clear(node0); for (const o of options2) node0.appendChild(h('option', { value: String(o.value) }, o.label)); }
  };
}

export function checkbox({ label, checked = false, onChange }) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => { if (onChange) onChange(input.checked); });
  const node = h('label', { class: 'field', style: { cursor: 'pointer' } }, input, h('span', {}, label));
  return { el: node, input, set(v) { input.checked = !!v; }, get() { return input.checked; } };
}

/* ------------------------------------------------------------------- 分頁 */

/** items: [{id, label, render() -> HTMLElement}] */
export function tabs(items) {
  const head = h('div', { class: 'tabs-head' });
  const body = h('div', { class: 'tabs-body' });
  const cache = new Map();
  let activeId = null;

  const buttons = items.map((item) => {
    const b = h('div', { class: 'tab', dataset: { tab: item.id } }, item.label);
    b.addEventListener('click', () => setActive(item.id));
    head.appendChild(b);
    return b;
  });

  function renderBody(id) {
    const item = items.find((i) => i.id === id);
    clear(body);
    if (!item) return;
    let node = cache.get(id);
    if (!node) { node = item.render(); if (node) cache.set(id, node); }
    if (node) body.appendChild(node);
  }

  function setActive(id) {
    activeId = id;
    buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === id));
    renderBody(id);
  }

  const node = h('div', { class: 'tabs' }, head, body);
  if (items.length) setActive(items[0].id);

  return {
    el: node, setActive, getActive: () => activeId,
    /** 丟棄快取的內容並重畫目前分頁（狀態變動後呼叫） */
    invalidate(id) {
      if (id) cache.delete(id); else cache.clear();
      if (activeId) renderBody(activeId);
    }
  };
}

/* ------------------------------------------------------------------- 表格 */

/** columns: [{key, label, width, align:'num'|'mid', format(value,row)}] */
export function table({ columns = [], rows = [], empty = '沒有資料', rowClass, onRowClick }) {
  const tbody = h('tbody');
  const thead = h('thead', null, h('tr', null, columns.map((c) =>
    h('th', { class: c.align || '', style: c.width ? { width: c.width } : null }, c.label))));
  const tbl = h('table', { class: 'tbl' }, thead, tbody);
  const wrap = h('div', { class: 'tbl-wrap' }, tbl);

  function setRows(next) {
    clear(tbody);
    const list = next || [];
    if (!list.length) {
      tbody.appendChild(h('tr', null, h('td', { colspan: String(Math.max(1, columns.length)) }, h('div', { class: 'tbl-empty' }, empty))));
      return;
    }
    for (const row of list) {
      const tr = h('tr', { class: (rowClass ? rowClass(row) : '') || '' });
      for (const c of columns) {
        const raw = c.key.includes('.') ? c.key.split('.').reduce((o, k) => (o == null ? o : o[k]), row) : row[c.key];
        const content = c.format ? c.format(raw, row) : (raw === null || raw === undefined ? '' : raw);
        const td = h('td', { class: c.align || '' });
        if (content instanceof Node) td.appendChild(content); else td.textContent = String(content);
        tr.appendChild(td);
      }
      if (onRowClick) tr.addEventListener('click', () => onRowClick(row, tr));
      tbody.appendChild(tr);
    }
  }

  setRows(rows);
  return { el: wrap, setRows, table: tbl };
}

/** 條列式清單（可選取） */
export function list({ items = [], renderItem, onSelect, empty = '沒有資料' }) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
  function setItems(next) {
    clear(box);
    if (!next || !next.length) { box.appendChild(h('div', { class: 'empty-state' }, empty)); return; }
    for (const item of next) {
      const node = renderItem(item);
      if (onSelect) {
        node.classList.add('clickable');
        node.addEventListener('click', () => onSelect(item, node));
      }
      box.appendChild(node);
    }
  }
  setItems(items);
  return { el: box, setItems };
}

/* ----------------------------------------------------------------- 數值顯示 */

export function bar({ value = 0, max = 100, color = null, label = '', showValue = true, format }) {
  const fill = h('div', { class: 'bar-fill' });
  const track = h('div', { class: 'bar-track' }, fill);
  const val = h('span', { class: 'bar-value' });
  const node = h('div', { class: 'bar-row' }, label ? h('span', { class: 'bar-label' }, label) : null, track, showValue ? val : null);

  function set(v, m) {
    const mm = m === undefined ? max : m;
    const pct = mm <= 0 ? 0 : Math.max(0, Math.min(1, v / mm));
    fill.style.width = (pct * 100).toFixed(1) + '%';
    if (typeof color === 'function') fill.style.background = color(v, mm);
    else if (color) fill.style.background = color;
    val.textContent = format ? format(v, mm) : `${Math.round(v)} / ${Math.round(mm)}`;
  }
  set(value, max);
  return { el: node, set, fill, track };
}

/** 星級顯示：預設畫到目前星級上限（★1 ～ ★7，見 core/balance.js#MAX_STARS），
 *  未達到的部分畫成暗色的 ★（.stars .off），所以面板上永遠看得到「還差幾顆」。 */
export function stars(n, max = MAX_STARS) {
  const on = Math.max(0, Math.min(max, Math.round(n)));
  return h('span', { class: 'stars', title: `${on} / ${max}` },
    '★'.repeat(on), h('span', { class: 'off' }, '★'.repeat(max - on)));
}

export function money(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}NT$ ${Math.abs(v).toLocaleString('en-US')}`;
}

export function pct(n, digits = 0) {
  return `${(Number(n) || 0).toFixed(digits)}%`;
}

export function statRow(label, value, opts = {}) {
  return h('div', { class: `stat-row${opts.kind ? ' ' + opts.kind : ''}` },
    h('span', { class: 'k' }, label, opts.hint ? h('span', { class: 'hint' }, opts.hint) : null),
    value instanceof Node ? value : h('span', { class: 'v' }, String(value)));
}

export function section({ title, children = [], collapsible = false, collapsed = false, right = null }) {
  const body = h('div', { class: 'section-body' }, ...(Array.isArray(children) ? children : [children]));
  const arrow = h('span', { class: 'arrow' }, collapsed ? '▶' : '▼');
  const head = h('div', { class: `section-head${collapsible ? ' collapsible' : ''}` },
    collapsible ? arrow : null, h('span', {}, title),
    right ? h('span', { class: 'right' }, right) : null);
  const node = h('div', { class: `section${collapsed ? ' collapsed' : ''}` }, head, body);
  if (collapsible) {
    head.addEventListener('click', () => {
      const isCollapsed = node.classList.toggle('collapsed');
      arrow.textContent = isCollapsed ? '▶' : '▼';
    });
  }
  return { el: node, body, head };
}

export function hintbox(text) {
  return h('div', { class: 'hintbox' }, text);
}

export function emptyState(text) {
  return h('div', { class: 'empty-state' }, text);
}

export function tag(text, kind = 'plain') {
  return h('span', { class: `tag ${kind}` }, text);
}

export function card(...children) {
  return h('div', { class: 'card' }, ...children);
}

/* --------------------------------------------------------------- 頭像繪製 */

let spritesModule = null;
let spritesTried = false;

async function getSprites() {
  if (!spritesTried) {
    spritesTried = true;
    try { spritesModule = await import('../render/sprites.js'); } catch { spritesModule = null; }
  }
  return spritesModule;
}

/**
 * 產生員工／顧客的像素頭像（可選 zoom 整數倍放大）。
 * 若繪圖模組尚未載入，先畫簡易色塊，載入後自動補畫。
 */
export function portraitCanvas(appearance = {}, opts = {}) {
  const size = opts.size || 32;
  const zoom = opts.zoom || 1;
  const dir = opts.dir || 'S';
  const canvas = h('canvas', { class: 'portrait', width: String(size), height: String(size) });
  canvas.style.width = size * zoom + 'px';
  canvas.style.height = size * zoom + 'px';

  const paint = (sprites) => {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#2b3a4a';
    ctx.fillRect(0, 0, size, size);
    if (sprites && typeof sprites.drawPerson === 'function') {
      try { sprites.drawPerson(ctx, appearance, Math.round(size / 2), size - 2, { dir, frame: 0, scale: 1 }); return; }
      catch { /* 落回色塊 */ }
    }
    ctx.fillStyle = appearance.skin || '#f0c9a0';
    ctx.fillRect(size / 2 - 4, size - 14, 8, 8);
    ctx.fillStyle = appearance.shirt || '#3a6ea5';
    ctx.fillRect(size / 2 - 6, size - 7, 12, 7);
    ctx.fillStyle = appearance.hair || '#2b1b12';
    ctx.fillRect(size / 2 - 4, size - 18, 8, 5);
  };

  paint(null);
  getSprites().then((s) => { if (s) paint(s); });
  return canvas;
}

/* --------------------------------------------------------- 提示 / 對話框 */

function host(id, cssClass) {
  let node = document.getElementById(id);
  if (!node) {
    node = h('div', { id, class: cssClass });
    document.body.appendChild(node);
  }
  return node;
}

export function toast(message, kind = 'info', ms = 3200) {
  const node = h('div', { class: `toast ${kind}` }, String(message));
  host('toast-host').appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; }, ms - 320);
  setTimeout(() => node.remove(), ms);
  return node;
}

/**
 * 模態對話框。resolve 值由各按鈕的 value 決定（取消為 null）。
 * buttons: [{label, value, kind}]，預設 [{label:'確定',value:true},{label:'取消',value:null}]
 */
export function modalDialog({ title = '訊息', body = '', buttons, width = 400 }) {
  return new Promise((resolve) => {
    const btns = buttons || [{ label: '確定', value: true, kind: 'primary' }, { label: '取消', value: null }];
    let done = false;
    const mask = h('div', { class: 'modal-mask' });
    const finish = (value) => { if (done) return; done = true; mask.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (ev) => { if (ev.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    const btnRow = h('div', { class: 'modal-btns' }, btns.map((b) =>
      button(b.label, () => finish(b.value === undefined ? true : b.value), { kind: b.kind })));

    const textNode = h('div', { class: 'modal-text' });
    if (body instanceof Node) textNode.appendChild(body); else textNode.textContent = String(body);

    const win = h('div', { class: 'win', style: { width: width + 'px' } },
      h('div', { class: 'win-title' }, h('span', { class: 'win-icon' }, '❔'), h('span', { class: 'win-name' }, title)),
      h('div', { class: 'win-body' }, textNode, btnRow));

    mask.appendChild(win);
    mask.addEventListener('mousedown', (ev) => { if (ev.target === mask) finish(null); });
    document.body.appendChild(mask);
    const first = btnRow.querySelector('.btn');
    if (first) first.focus();
  });
}

/** Promise<boolean> */
export async function confirmDialog({ title = '確認', message = '', okLabel = '確定', cancelLabel = '取消' }) {
  const r = await modalDialog({
    title, body: message,
    buttons: [{ label: okLabel, value: true, kind: 'primary' }, { label: cancelLabel, value: null }]
  });
  return r === true;
}

/** Promise<number|null>；value 可為數字或 {min,max} 內的初始值 */
export function promptNumber({ title = '輸入數值', message = '', value = 0, min = 0, max = 999999, step = 1, suffix = '' }) {
  return new Promise((resolve) => {
    const field = numberField({ value, min, max, step, suffix });
    let done = false;
    const mask = h('div', { class: 'modal-mask' });
    const finish = (v) => { if (done) return; done = true; mask.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (ev) => { if (ev.key === 'Escape') finish(null); if (ev.key === 'Enter') finish(field.get()); };
    document.addEventListener('keydown', onKey);

    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      message ? h('div', { class: 'modal-text' }, message) : null,
      field.el);
    const btns = h('div', { class: 'modal-btns' },
      button('確定', () => finish(field.get()), { kind: 'primary' }),
      button('取消', () => finish(null)));
    const win = h('div', { class: 'win', style: { width: '330px' } },
      h('div', { class: 'win-title' }, h('span', { class: 'win-icon' }, '✎'), h('span', { class: 'win-name' }, title)),
      h('div', { class: 'win-body' }, body, btns));
    mask.appendChild(win);
    document.body.appendChild(mask);
    field.input.focus();
    field.input.select();
  });
}

export default {
  h, el, clear, frag, button, toolbar, sep,
  numberField, slider, select, checkbox, tabs, table, list,
  bar, stars, money, pct, statRow, section, hintbox, emptyState, tag, card,
  portraitCanvas, toast, modalDialog, confirmDialog, promptNumber
};
