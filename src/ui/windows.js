// ============================================================================
// windows.js — 可拖曳的 90 年代視窗管理員
// 契約見 docs/ARCHITECTURE.md §5.2 / §5.3
// ============================================================================
import { clear, h } from './widgets.js';

export class WindowManager {
  constructor() {
    this.registry = new Map();   // id -> factory
    this.panels = new Map();     // id -> panel instance
    this.zCounter = 810;
    this.cascade = 0;
    this.host = null;
    this.store = null;
    this.ui = null;
  }

  init({ store, ui, host }) {
    this.store = store;
    this.ui = ui;
    this.host = host || document.getElementById('window-host') || document.body;
    return this;
  }

  /** factory({store, ui, win}) -> panel */
  register(id, factory) {
    this.registry.set(id, factory);
    return this;
  }

  registerAll(map) {
    for (const [id, factory] of Object.entries(map)) this.register(id, factory);
    return this;
  }

  isOpen(id) { return this.panels.has(id); }

  listOpen() { return [...this.panels.keys()]; }

  _instantiate(id) {
    const factory = this.registry.get(id);
    if (!factory) return null;
    const panel = factory({ store: this.store, ui: this.ui, win: this });
    if (!panel) return null;
    if (!panel.id) panel.id = id;
    if (!panel.el) throw new Error(`面板 ${id} 沒有回傳 el`);
    return panel;
  }

  openWindow(id) {
    const existing = this.panels.get(id);
    if (existing) { this.focus(id); return existing; }

    const panel = this._instantiate(id);
    if (!panel) { console.warn('[windows] 未註冊的面板:', id); return null; }

    const width = panel.width || 460;
    const height = panel.height || 380;
    const off = (this.cascade++ % 7) * 22;

    const winEl = h('div', {
      class: 'win',
      dataset: { panel: id },
      style: {
        left: `${Math.max(8, Math.min(window.innerWidth - width - 24, 44 + off))}px`,
        top: `${Math.max(8, Math.min(window.innerHeight - height - 40, 42 + off))}px`,
        width: `${width}px`,
        height: `${height}px`
      }
    });

    const closeBtn = h('button', { class: 'win-btn', type: 'button', title: '關閉' }, '✕');
    const titleBar = h('div', { class: 'win-title' },
      h('span', { class: 'win-icon' }, panel.icon || '▣'),
      h('span', { class: 'win-name' }, panel.title || id),
      h('span', { class: 'win-btns' }, closeBtn));

    const body = h('div', { class: 'win-body' });
    body.appendChild(panel.el);
    winEl.appendChild(titleBar);
    winEl.appendChild(body);
    this.host.appendChild(winEl);

    panel._winEl = winEl;
    panel._titleEl = titleBar.querySelector('.win-name');
    this.panels.set(id, panel);

    closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this.closeWindow(id); });
    winEl.addEventListener('mousedown', () => this.focus(id), true);
    this._makeDraggable(winEl, titleBar);

    try { if (panel.open) panel.open(); } catch (err) { console.error(`[windows] ${id}.open() 失敗`, err); }
    this.focus(id);
    if (this.store) this._refreshPanel(panel, this.store.getState());
    return panel;
  }

  closeWindow(id) {
    const panel = this.panels.get(id);
    if (!panel) return;
    try { if (panel.close) panel.close(); } catch (err) { console.error(`[windows] ${id}.close() 失敗`, err); }
    if (panel._winEl) panel._winEl.remove();
    this.panels.delete(id);
  }

  toggle(id) {
    if (this.panels.has(id)) this.closeWindow(id);
    else this.openWindow(id);
  }

  closeAll() {
    for (const id of [...this.panels.keys()]) this.closeWindow(id);
  }

  focus(id) {
    const panel = this.panels.get(id);
    if (!panel || !panel._winEl) return;
    this.zCounter += 1;
    panel._winEl.style.zIndex = String(this.zCounter);
    for (const [otherId, other] of this.panels) {
      if (other._winEl) other._winEl.classList.toggle('is-active', otherId === id);
    }
  }

  _makeDraggable(winEl, handle) {
    let dragging = false;
    let startX = 0; let startY = 0; let originX = 0; let originY = 0;

    const onMove = (ev) => {
      if (!dragging) return;
      const nx = originX + (ev.clientX - startX);
      const ny = originY + (ev.clientY - startY);
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 30;
      winEl.style.left = `${Math.max(-winEl.offsetWidth + 80, Math.min(maxX, nx))}px`;
      winEl.style.top = `${Math.max(0, Math.min(maxY, ny))}px`;
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.win-btn')) return;
      dragging = true;
      startX = ev.clientX; startY = ev.clientY;
      originX = winEl.offsetLeft; originY = winEl.offsetTop;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });
  }

  _refreshPanel(panel, state) {
    if (!panel.refresh) return;
    try { panel.refresh(state); } catch (err) { console.error(`[windows] ${panel.id}.refresh() 失敗`, err); }
  }

  /** store 每次變更後呼叫；只更新已開啟的面板 */
  refreshAll(state) {
    for (const panel of this.panels.values()) this._refreshPanel(panel, state);
  }
}

export const windows = new WindowManager();
export default windows;
