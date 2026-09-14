// ============================================================================
// controls.js — 極簡環繞攝影機控制器（自行實作，不依賴 three addons）
//   左鍵拖曳＝環繞、滾輪＝遠近、右/中鍵拖曳＝平移、雙指＝縮放＋平移
// ============================================================================
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, lambda, dt) => THREE.MathUtils.damp(cur, target, lambda, dt);

export class OrbitCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;

    this.target = new THREE.Vector3(0, 1.1, 0);
    this._targetGoal = this.target.clone();

    this.az = Math.PI * 0.25;     // 水平角
    this.pol = Math.PI * 0.33;    // 極角（0=正上方）
    this.dist = 11;
    this._azGoal = this.az;
    this._polGoal = this.pol;
    this._distGoal = this.dist;

    this.minDist = 2.2;
    this.maxDist = 34;
    this.minPol = 0.12;
    this.maxPol = Math.PI * 0.495;
    this.enabled = true;
    this.damping = 9;

    this._drag = null;
    this._ptrs = new Map();
    this._pinch = 0;
    this._bind();
  }

  /* ── 事件 ─────────────────────────────────────────────────────── */

  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', this._onDown = (e) => {
      if (!this.enabled) return;
      d.setPointerCapture?.(e.pointerId);
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 1) {
        this._drag = {
          id: e.pointerId,
          x: e.clientX, y: e.clientY,
          mode: (e.button === 2 || e.button === 1) ? 'pan' : 'orbit'
        };
      } else if (this._ptrs.size === 2) {
        this._drag = null;
        const [a, b] = [...this._ptrs.values()];
        this._pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    d.addEventListener('pointermove', this._onMove = (e) => {
      if (!this._ptrs.has(e.pointerId)) return;
      const prev = this._ptrs.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._ptrs.size === 2) {
        const [a, b] = [...this._ptrs.values()];
        const nd = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch > 0) this.dolly(Math.pow(this._pinch / Math.max(1, nd), 1.6));
        this._pinch = nd;
        this.pan(dx * 0.5, dy * 0.5);
        return;
      }
      if (!this._drag) return;
      if (this._drag.mode === 'pan') this.pan(dx, dy);
      else this.orbit(dx, dy);
    });
    const end = this._onUp = (e) => {
      this._ptrs.delete(e.pointerId);
      if (this._ptrs.size < 2) this._pinch = 0;
      if (this._drag && this._drag.id === e.pointerId) this._drag = null;
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('pointerleave', end);
    d.addEventListener('wheel', this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.dolly(Math.pow(1.0016, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
    }, { passive: false });
  }

  /* ── 操作 ─────────────────────────────────────────────────────── */

  orbit(dx, dy) {
    this.orbitCalls = (this.orbitCalls || 0) + 1;
    this._azGoal -= dx * 0.006;
    this._polGoal = clamp(this._polGoal - dy * 0.005, this.minPol, this.maxPol);
  }

  dolly(factor) {
    this._distGoal = clamp(this._distGoal * factor, this.minDist, this.maxDist);
  }

  pan(dx, dy) {
    this.panCalls = (this.panCalls || 0) + 1;
    const scale = this._distGoal * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this._targetGoal
      .addScaledVector(right, -dx * scale)
      .addScaledVector(up, dy * scale);
    this._targetGoal.y = clamp(this._targetGoal.y, 0.2, 6);
    const r = Math.hypot(this._targetGoal.x, this._targetGoal.z);
    if (r > 30) { this._targetGoal.x *= 30 / r; this._targetGoal.z *= 30 / r; }
  }

  /** 立即跳到指定機位（用於預設視角） */
  jumpTo({ az, pol, dist, target }) {
    if (az !== undefined) this._azGoal = this.az = az;
    if (pol !== undefined) this._polGoal = this.pol = clamp(pol, this.minPol, this.maxPol);
    if (dist !== undefined) this._distGoal = this.dist = clamp(dist, this.minDist, this.maxDist);
    if (target) this._targetGoal.copy(target);
  }

  /** 平滑移動到機位 */
  flyTo({ az, pol, dist, target }, _immediate = false) {
    if (az !== undefined) this._azGoal = az;
    if (pol !== undefined) this._polGoal = clamp(pol, this.minPol, this.maxPol);
    if (dist !== undefined) this._distGoal = clamp(dist, this.minDist, this.maxDist);
    if (target) this._targetGoal.copy(target);
  }

  /* ── 更新 ─────────────────────────────────────────────────────── */

  update(dt) {
    const l = this.damping;
    this.az = damp(this.az, this._azGoal, l, dt);
    this.pol = damp(this.pol, this._polGoal, l, dt);
    this.dist = damp(this.dist, this._distGoal, l, dt);
    this.target.x = damp(this.target.x, this._targetGoal.x, l, dt);
    this.target.y = damp(this.target.y, this._targetGoal.y, l, dt);
    this.target.z = damp(this.target.z, this._targetGoal.z, l, dt);

    const sp = Math.sin(this.pol);
    this.camera.position.set(
      this.target.x + this.dist * sp * Math.sin(this.az),
      this.target.y + this.dist * Math.cos(this.pol),
      this.target.z + this.dist * sp * Math.cos(this.az)
    );
    if (this.camera.position.y < 0.35) this.camera.position.y = 0.35;
    this.camera.lookAt(this.target);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onDown);
    d.removeEventListener('pointermove', this._onMove);
    d.removeEventListener('pointerup', this._onUp);
    d.removeEventListener('pointercancel', this._onUp);
    d.removeEventListener('pointerleave', this._onUp);
    d.removeEventListener('wheel', this._onWheel);
  }
}

export default OrbitCam;
