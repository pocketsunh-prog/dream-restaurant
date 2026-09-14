// ============================================================================
// restaurant.js — 日式餐廳場景組裝（房間、裝潢、傢俱、客人、員工）
//   所有道具來自 props.js；若某個道具不存在會自動退回佔位幾何，不會整場爆掉。
// ============================================================================
import * as THREE from 'three';
import * as Props from './props.js';
import * as Chars from './characters.js';

/* ------------------------------------------------------------ 工具 */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const snake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());

/** 退回佔位幾何的次數（>0 表示有道具找不到；供驗證用） */
export const propStats = { ok: 0, fallback: 0, missing: [] };

function makePropSafe(id, opts = {}, fallbackSize = { x: 1, y: 1, z: 1 }) {
  const candidates = [id, cap(id)];
  try {
    for (const c of candidates) {
      const fn = Props[c] || Props['make' + cap(c)];
      if (typeof fn === 'function') {
        const g = fn(opts);
        if (g && g.isObject3D) { propStats.ok += 1; return g; }
      }
    }
    if (typeof Props.makeProp === 'function') {
      for (const c of [id, snake(id), id.replace(/_/g, '')]) {
        try {
          const g = Props.makeProp(c, opts);
          if (g && g.isObject3D) { propStats.ok += 1; return g; }
        } catch { /* 換下一個命名 */ }
      }
    }
  } catch (err) {
    console.warn('[restaurant] prop failed:', id, err?.message);
  }
  propStats.fallback += 1;
  propStats.missing.push(id);
  const f = fallbackSize;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(f.x, f.y, f.z),
    new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 })
  );
  box.position.y = f.y / 2;
  box.castShadow = true; box.receiveShadow = true;
  const g = new THREE.Group();
  g.add(box);
  return g;
}

function shadowize(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return obj;
}

function place(obj, x, y, z, ry = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  return obj;
}

/* 假接觸陰影（AO 貼片）：一張帶徑向漸層 alpha 的平面，貼在地面上。
   比陰影貼圖便宜，而且在任何時刻／天氣都能提供「接地感」。 */
let AO_TEX = null;
function aoTexture() {
  if (AO_TEX) return AO_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const grd = c.createRadialGradient(64, 64, 3, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.80)');
  grd.addColorStop(0.30, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.62, 'rgba(0,0,0,0.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = grd;
  c.fillRect(0, 0, 128, 128);
  AO_TEX = new THREE.CanvasTexture(cv);
  if ('colorSpace' in AO_TEX) AO_TEX.colorSpace = THREE.SRGBColorSpace;
  return AO_TEX;
}

let AO_MAT = null;
function aoMaterial() {
  if (AO_MAT) return AO_MAT;
  AO_MAT = new THREE.MeshBasicMaterial({
    map: aoTexture(), transparent: true, depthWrite: false,
    opacity: 1.0, blending: THREE.NormalBlending
  });
  return AO_MAT;
}

/** 放一片接觸陰影（半徑 r，可橢圓） */
function aoBlob(parent, x, y, z, r, rz = r, opacity = 1.0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, rz * 2), aoMaterial());
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 1;
  m.userData.ao = opacity;
  m.scale.setScalar(opacity > 0.99 ? 1 : opacity);
  parent.add(m);
  return m;
}

/** 把一個節點底下所有材質複製一份並染色（不影響其他共用同一材質的道具） */
function tintGroup(obj, mul, warm = 0) {
  const seen = new Map();
  obj.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const src = o.material;
    if (seen.has(src)) { o.material = seen.get(src); return; }
    const m = src.clone();
    if (m.color) {
      m.color.multiply(new THREE.Color(mul));
      if (warm) m.color.offsetHSL(0.015 * warm, 0.05 * warm, 0);
    }
    seen.set(src, m);
    o.material = m;
  });
  return obj;
}

/* ------------------------------------------------------------ 類別 */

export class RestaurantView {
  constructor(scene, plan) {
    this.scene = scene;
    this.plan = plan;
    this.root = new THREE.Group();
    this.root.name = 'restaurant';
    scene.add(this.root);

    this.groupMeshes = new Map();   // groupId -> [meshes]
    this.staffMeshes = [];
    this.lampPointers = [];         // 需要隨夜晚開關的發光體
    this.tableProps = [];
    this._tmp = new THREE.Vector3();
    this._clock = 0;

    this.buildRoom();
    this.buildFurniture();
    this.buildDecor();
    this.buildOutside();
    this.buildStaff();
  }

  /* ── 房間本體 ───────────────────────────────────────────────── */

  buildRoom() {
    const p = this.plan;
    const W = p.width, D = p.depth, H = 2.85;

    // 地板：只鋪房間本體＋一圈緣側（外面的街道由 buildOutside 處理）
    const floor = makePropSafe('woodFloor', { w: W + 0.9, h: D + 0.9 }, { x: W + 0.9, y: 0.1, z: D + 0.9 });
    floor.position.set(0, 0, 0);
    tintGroup(floor, new THREE.Color(0.70, 0.60, 0.50), 1);
    this.root.add(shadowize(floor));
    this.floorY = 0.1;

    // 榻榻米區（抬高一階）
    const tat = p.tatami;
    const tatamiGroup = new THREE.Group();
    const cols = Math.floor(tat.w / 0.9);
    const rows = Math.floor(tat.d / 1.8);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const mat = makePropSafe('tatami', { w: 0.88, h: 1.78 }, { x: 0.88, y: 0.06, z: 1.78 });
        mat.position.set(
          tat.x - tat.w / 2 + 0.45 + i * 0.9,
          this.floorY + 0.06,
          tat.z - tat.d / 2 + 0.9 + j * 1.8
        );
        mat.rotation.y = ((i + j) % 2) ? Math.PI / 2 : 0;
        tatamiGroup.add(shadowize(mat));
      }
    }
    this.tatamiY = this.floorY + 0.12;
    tintGroup(tatamiGroup, new THREE.Color(0.88, 0.86, 0.74), 0.6);
    this.root.add(tatamiGroup);

    /* 牆與天花板：朝「房間內側」的單面平面。
       從店外或上方看會直接看穿 → 娃娃屋視角；從店內看則是完整牆面。*/
    this.buildShell(W, D, H);

    // 柱子與樑
    const pillarAt = [
      [-W / 2 + 0.5, -D / 2 + 0.5], [W / 2 - 0.5, -D / 2 + 0.5],
      [-W / 2 + 0.5, D / 2 - 0.5], [W / 2 - 0.5, D / 2 - 0.5],
      [-W / 2 + 0.5, 0], [W / 2 - 0.5, 0]
    ];
    for (const [x, z] of pillarAt) {
      const pil = makePropSafe('pillar', { h: H }, { x: 0.18, y: H, z: 0.18 });
      place(pil, x, this.floorY, z);
      this.root.add(shadowize(pil));
    }
    for (const z of [-D / 2 + 1.2, D / 2 - 1.2]) {
      const beam = makePropSafe('beam', { len: W }, { x: W, y: 0.16, z: 0.18 });
      place(beam, 0, this.floorY + H - 0.2, z);
      this.root.add(shadowize(beam));
    }
    // 屋樑（橫向），讓天花板有結構感
    for (const x of [-4.4, -1.4, 1.6, 4.6]) {
      const beam = makePropSafe('beam', { len: D }, { x: D, y: 0.14, z: 0.16 });
      place(beam, x, this.floorY + H - 0.16, 0, Math.PI / 2);
      this.root.add(shadowize(beam));
    }

    // 障子（拉門）＋ 暖簾（入口）
    const shojiXs = [-W / 2 + 0.6, -W / 2 + 1.75, W / 2 - 1.75, W / 2 - 0.6];
    for (const x of shojiXs) {
      const s = makePropSafe('shoji', { w: 1.1, h: 1.95, lit: true }, { x: 1.1, y: 1.95, z: 0.08 });
      place(s, x, this.floorY, -D / 2 + 0.14, 0);
      this.root.add(shadowize(s));
      this.lampPointers.push({ obj: s, kind: 'shoji' });
    }
    const e = p.entrance;
    const noren = makePropSafe('noren', { w: 1.9, h: 0.62, text: '食堂', color: '#1d3b5c' }, { x: 1.9, y: 0.62, z: 0.06 });
    place(noren, e.x, this.floorY + 1.86, D / 2 - 0.02, Math.PI);
    this.root.add(shadowize(noren));

    // 看板（門外上方）
    const sign = makePropSafe('signboard', { w: 1.7, h: 0.5, text: '夢幻食堂' }, { x: 1.7, y: 0.5, z: 0.1 });
    place(sign, e.x, this.floorY + 2.62, D / 2 + 0.12, Math.PI);
    this.root.add(shadowize(sign));

    // 縱向霓虹（掛在東牆內側）
    const neon = makePropSafe('neonSign', { w: 0.7, h: 2.0, text: '居酒屋' }, { x: 0.7, y: 2.0, z: 0.12 });
    place(neon, W / 2 - 0.16, this.floorY + 1.5, 1.2, -Math.PI / 2);
    this.root.add(shadowize(neon));
    this.lampPointers.push({ obj: neon, kind: 'neon' });

    // 緣側（榻榻米區外緣木台）
    const eng = makePropSafe('engawa', { len: 4.2, w: 0.7 }, { x: 4.2, y: 0.18, z: 0.7 });
    place(eng, tat.x, this.floorY + 0.08, tat.z - tat.d / 2 - 0.35, 0);
    this.root.add(shadowize(eng));
  }

  /* 牆面／天花板（單面朝內）＋ 牆裙、樑下壓條 */
  buildShell(W, D, H) {
    const shell = new THREE.Group();
    shell.name = 'shell';

    const plaster = this._plasterMaterial();
    const wood = this._woodMaterial();

    const wallPlane = (w, h, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plaster);
      m.position.set(x, this.floorY + y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      return m;
    };
    const wainscot = (w, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.05), wood);
      m.position.set(x, this.floorY + y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      return m;
    };

    const zN = -D / 2 + 0.01, zS = D / 2 - 0.01;
    const xW = -W / 2 + 0.01, xE = W / 2 - 0.01;

    // 北牆（法線 +Z，朝店內）
    shell.add(wallPlane(W, H, 0, H / 2, zN, 0));
    shell.add(wainscot(W, 0, 0.525, zN + 0.012, 0));
    // 西牆（法線 +X）
    shell.add(wallPlane(D, H, xW, H / 2, 0, Math.PI / 2));
    shell.add(wainscot(D, xW + 0.012, 0.525, 0, Math.PI / 2));
    // 東牆（法線 -X）
    shell.add(wallPlane(D, H, xE, H / 2, 0, -Math.PI / 2));
    shell.add(wainscot(D, xE - 0.012, 0.525, 0, -Math.PI / 2));
    // 南牆兩段（法線 -Z）
    const doorW = 1.9, e = this.plan.entrance;
    const segW = (W - doorW) / 2;
    for (const sx of [e.x - doorW / 2 - segW / 2, e.x + doorW / 2 + segW / 2]) {
      shell.add(wallPlane(segW, H, sx, H / 2, zS, Math.PI));
      shell.add(wainscot(segW, sx, 0.525, zS - 0.012, Math.PI));
    }
    // 門楣內側
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(doorW, H - 2.2), plaster);
    lintel.position.set(e.x, this.floorY + 2.2 + (H - 2.2) / 2, zS);
    lintel.rotation.y = Math.PI;
    lintel.receiveShadow = true;
    shell.add(lintel);

    // 天花板（法線 -Y，從下方看得到、從上方看穿）
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this._ceilingMaterial());
    ceil.position.set(0, this.floorY + H, 0);
    ceil.rotation.x = Math.PI / 2;
    ceil.receiveShadow = true;
    shell.add(ceil);

    // 屋頂遮蔽：只投影、不顯示（colorWrite = false）。
    // 沒有這片，太陽會直接照進「沒有屋頂」的娃娃屋，室內會死白、沒有層次。
    const roofBlocker = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.5, D + 0.5),
      new THREE.MeshBasicMaterial({ colorWrite: false })
    );
    roofBlocker.position.set(0, this.floorY + H + 0.06, 0);
    roofBlocker.rotation.x = Math.PI / 2;
    roofBlocker.castShadow = true;
    roofBlocker.receiveShadow = false;
    shell.add(roofBlocker);

    this.root.add(shell);
    this.shell = shell;
  }

  _plasterMaterial() {
    if (this._plasterMat) return this._plasterMat;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#e6dccb';
    c.fillRect(0, 0, 256, 256);
    // 土壁の細かい斑
    for (let i = 0; i < 5200; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const v = 214 + Math.random() * 34;
      c.fillStyle = `rgba(${v},${v - 8},${v - 20},${0.16 + Math.random() * 0.22})`;
      c.fillRect(x, y, 1 + Math.random() * 1.6, 1);
    }
    for (let i = 0; i < 42; i++) {
      c.strokeStyle = `rgba(196,184,166,${0.06 + Math.random() * 0.08})`;
      c.lineWidth = 0.7 + Math.random();
      c.beginPath();
      const y0 = Math.random() * 256;
      c.moveTo(0, y0);
      c.bezierCurveTo(80, y0 + (Math.random() - 0.5) * 10, 170, y0 + (Math.random() - 0.5) * 10, 256, y0);
      c.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.2, 1.4);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._plasterMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.96, metalness: 0 });
    return this._plasterMat;
  }

  _woodMaterial() {
    if (this._woodMat) return this._woodMat;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#4b3524';
    c.fillRect(0, 0, 256, 256);
    // 板目
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * 256 + (Math.random() - 0.5) * 3;
      c.fillStyle = `rgba(${30 + Math.random() * 26},${20 + Math.random() * 18},${12 + Math.random() * 12},0.5)`;
      c.fillRect(x, 0, 1 + Math.random() * 2, 256);
    }
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${120 + Math.random() * 60},${86 + Math.random() * 40},${54 + Math.random() * 30},${0.05 + Math.random() * 0.1})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 1, 6 + Math.random() * 26);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._woodMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.72, metalness: 0.02 });
    return this._woodMat;
  }

  _ceilingMaterial() {
    if (this._ceilMat) return this._ceilMat;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#3a2a1c';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) {
      c.fillStyle = i % 2 ? '#4a3625' : '#412f20';
      c.fillRect(i * 16, 0, 15, 256);
    }
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = `rgba(${90 + Math.random() * 50},${66 + Math.random() * 34},${42 + Math.random() * 22},${0.05 + Math.random() * 0.08})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 3);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._ceilMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.88, metalness: 0 });
    return this._ceilMat;
  }

  /* ── 傢俱（依 game.js 的平面配置）────────────────────────────── */

  buildFurniture() {
    const p = this.plan;

    // 吧台
    const counter = makePropSafe('counter', { len: p.counter.len, h: 1.05, d: 0.62 }, { x: 0.62, y: 1.05, z: p.counter.len });
    place(counter, p.counter.x, this.floorY, p.counter.z, Math.PI / 2);
    this.root.add(shadowize(counter));
    aoBlob(this.root, p.counter.x, this.floorY + 0.012, p.counter.z, 0.55, p.counter.len / 2 + 0.35);

    // 廚房：不鏽鋼工作台、爐灶、水槽、冰箱、層架
    const k = p.kitchen;
    const kc = makePropSafe('kitchenCounter', { len: k.w * 0.55, h: 0.9, d: 0.65 }, { x: k.w * 0.55, y: 0.9, z: 0.65 });
    place(kc, k.x - k.w / 2 + 1.6, this.floorY, k.z + k.d / 2 - 0.4);
    this.root.add(shadowize(kc));

    const stove = makePropSafe('stove', { w: 1.4, d: 0.7, h: 0.92 }, { x: 1.4, y: 0.92, z: 0.7 });
    place(stove, k.x + k.w / 2 - 1.1, this.floorY, k.z + k.d / 2 - 0.4);
    this.root.add(shadowize(stove));

    const sink = makePropSafe('sink', { w: 0.9, d: 0.6, h: 0.9 }, { x: 0.9, y: 0.9, z: 0.6 });
    place(sink, k.x - k.w / 2 + 0.6, this.floorY, k.z + k.d / 2 - 0.4);
    this.root.add(shadowize(sink));

    const fridge = makePropSafe('fridge', { w: 0.72, h: 1.92, d: 0.72 }, { x: 0.72, y: 1.92, z: 0.72 });
    place(fridge, k.x + k.w / 2 - 0.5, this.floorY, k.z - k.d / 2 + 0.5);
    this.root.add(shadowize(fridge));

    const shelf = makePropSafe('shelf', { w: 1.7, h: 1.75, d: 0.36, bottles: 9 }, { x: 1.7, y: 1.75, z: 0.36 });
    place(shelf, k.x - k.w / 2 + 1.0, this.floorY, k.z - k.d / 2 + 0.35);
    this.root.add(shadowize(shelf));
    // 廚房設備接地陰影
    aoBlob(this.root, k.x - k.w / 2 + 1.6, this.floorY + 0.012, k.z + k.d / 2 - 0.4, 0.75, 0.45);
    aoBlob(this.root, k.x + k.w / 2 - 1.1, this.floorY + 0.012, k.z + k.d / 2 - 0.4, 0.78, 0.45);
    aoBlob(this.root, k.x - k.w / 2 + 0.6, this.floorY + 0.012, k.z + k.d / 2 - 0.4, 0.55, 0.42);
    aoBlob(this.root, k.x + k.w / 2 - 0.5, this.floorY + 0.012, k.z - k.d / 2 + 0.5, 0.5, 0.45);
    aoBlob(this.root, k.x - k.w / 2 + 1.0, this.floorY + 0.012, k.z - k.d / 2 + 0.35, 0.9, 0.4);

    // 出餐口平台
    const passTable = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.06, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.85, roughness: 0.3 })
    );
    passTable.position.set(p.pass.x, this.floorY + 0.9, p.pass.z);
    passTable.castShadow = true; passTable.receiveShadow = true;
    this.root.add(passTable);

    // 桌子＋椅子＋餐具
    for (const t of p.tables) {
      const y = t.style === 'chabudai' ? this.tatamiY : this.floorY;
      if (t.style === 'chabudai') {
        const table = makePropSafe('chabudai', { w: 1.25, d: 0.8, h: 0.34 }, { x: 1.25, y: 0.34, z: 0.8 });
        place(table, t.x, y, t.z, (Math.random() - 0.5) * 0.06);
        this.root.add(shadowize(table));
        aoBlob(this.root, t.x, y + 0.012, t.z, 0.92, 0.66);
        for (let i = 0; i < t.seats; i++) {
          const sp = t.seatPos[i];
          const za = makePropSafe('zabuton', { w: 0.56, d: 0.56 }, { x: 0.56, y: 0.09, z: 0.56 });
          place(za, sp.x, y, sp.z, sp.ry);
          this.root.add(shadowize(za));
          aoBlob(this.root, sp.x, y + 0.012, sp.z, 0.36);
        }
        const set = makePropSafe('tableSetting', { plates: t.seats }, { x: 0.7, y: 0.06, z: 0.7 });
        place(set, t.x, y + 0.34, t.z);
        this.root.add(shadowize(set));
      } else {
        const table = makePropSafe('table', { w: 1.15, d: 0.78, h: 0.72 }, { x: 1.15, y: 0.72, z: 0.78 });
        place(table, t.x, y, t.z, (Math.random() - 0.5) * 0.06);
        this.root.add(shadowize(table));
        aoBlob(this.root, t.x, y + 0.012, t.z, 0.9, 0.72);
        for (let i = 0; i < t.seats; i++) {
          const sp = t.seatPos[i];
          const ch = makePropSafe('chair', {}, { x: 0.46, y: 0.9, z: 0.46 });
          place(ch, sp.x, y, sp.z, sp.ry);
          this.root.add(shadowize(ch));
          aoBlob(this.root, sp.x, y + 0.012, sp.z, 0.4);
        }
        const set = makePropSafe('tableSetting', { plates: t.seats }, { x: 0.7, y: 0.06, z: 0.7 });
        place(set, t.x, y + 0.72, t.z);
        this.root.add(shadowize(set));
      }
      this.tableProps.push({ table: t, y });
    }

    // 座敷區的矮桌（榻榻米已在 buildRoom 鋪好）
    void this.tatamiY;
  }

  /* ── 裝潢 ───────────────────────────────────────────────────── */

  buildDecor() {
    const p = this.plan;
    const W = p.width, D = p.depth;

    // 吊掛燈籠（沿天花板橫樑）
    const lanternXs = [-4.6, 0.8, 3.4, 5.6];
    for (let i = 0; i < lanternXs.length; i++) {
      const x = lanternXs[i];
      const z = i % 2 ? 0.6 : -2.4;
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
      );
      cord.position.set(x, this.floorY + 2.85 - 0.25, z);
      this.root.add(cord);

      const chochin = makePropSafe('chochin', { r: 0.2, h: 0.36, text: i % 2 ? '酒' : '食' }, { x: 0.4, y: 0.36, z: 0.4 });
      place(chochin, x, this.floorY + 2.85 - 0.72, z);
      this.root.add(shadowize(chochin));
      this.lampPointers.push({ obj: chochin, kind: 'lantern' });
    }

    // 行燈（地板燈）
    for (const [x, z] of [[-6.0, 3.6], [6.1, -0.6]]) {
      const a = makePropSafe('andon', { h: 0.85 }, { x: 0.34, y: 0.85, z: 0.34 });
      place(a, x, this.floorY, z);
      this.root.add(shadowize(a));
      this.lampPointers.push({ obj: a, kind: 'andon' });
    }

    // 掛軸（北牆）
    for (const x of [-3.4, -0.6]) {
      const k = makePropSafe('kakemono', { w: 0.55, h: 1.7 }, { x: 0.55, y: 1.7, z: 0.04 });
      place(k, x, this.floorY + 1.65, -D / 2 + 0.09, 0);
      this.root.add(shadowize(k));
    }

    // 盆栽 / 插花 / 竹 / 招財貓 / 酒樽
    const decors = [
      ['bonsai', -6.05, -3.9, 0],
      ['bonsai', 6.05, 3.9, 0],
      ['ikebana', -6.05, 1.2, 0],
      ['bamboo', 6.15, -3.6, 0],
      ['manekiNeko', -5.5, -0.3, Math.PI * 0.35],
      ['sakeBarrel', -6.0, -2.2, 0],
      ['sakeBarrel', -6.0, -1.5, 0],
      ['plantPot', 6.05, 1.9, 0],
      ['plantPot', -2.2, 4.25, 0]
    ];
    for (const [id, x, z, ry] of decors) {
      const size = id === 'bamboo' ? { x: 0.6, y: 2.2, z: 0.6 }
        : id === 'sakeBarrel' ? { x: 0.64, y: 0.5, z: 0.64 }
        : id === 'plantPot' ? { x: 0.44, y: 0.7, z: 0.44 }
        : { x: 0.5, y: 0.8, z: 0.5 };
      const d = makePropSafe(id, {}, size);
      place(d, x, this.floorY, z, ry);
      this.root.add(shadowize(d));
      aoBlob(this.root, x, this.floorY + 0.012, z, Math.max(0.3, size.x * 0.78));
    }

    // レジ（收銀台）在吧台端
    const reg = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.3, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.42, metalness: 0.12 })
    );
    reg.position.set(p.counter.x + 0.1, this.floorY + 1.05 + 0.15, p.counter.z + p.counter.len / 2 - 0.3);
    reg.castShadow = true; reg.receiveShadow = true;
    this.root.add(reg);

    // 招牌暖簾旁的紅燈籠（門口）
    const doorLantern = makePropSafe('chochin', { r: 0.17, h: 0.3, text: '営業中' }, { x: 0.34, y: 0.3, z: 0.34 });
    place(doorLantern, p.entrance.x - 1.15, this.floorY + 1.55, D / 2 + 0.2);
    this.root.add(shadowize(doorLantern));
    this.lampPointers.push({ obj: doorLantern, kind: 'lantern' });

    void W;
  }

  /* ── 店外（街道、對面建築、自動販賣機、腳踏車）────────────────── */

  buildOutside() {
    const p = this.plan;
    const D = p.depth;

    // 人行道 + 馬路
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.94 });
    const walk = new THREE.Mesh(new THREE.BoxGeometry(26, 0.16, 3.4), walkMat);
    walk.position.set(0, -0.06, D / 2 + 1.7);
    walk.receiveShadow = true;
    this.root.add(walk);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x35363a, roughness: 0.88 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(26, 0.12, 7.5), roadMat);
    road.position.set(0, -0.1, D / 2 + 7.2);
    road.receiveShadow = true;
    this.root.add(road);

    // 馬路標線
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.8 });
    for (let i = -5; i <= 5; i++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.14), lineMat);
      dash.position.set(i * 2.6, 0.0, D / 2 + 7.2);
      this.root.add(dash);
    }

    // 對面建築（簡化街景，營造日本街區感）
    const bcolors = [0x6b6f78, 0x7d7a72, 0x5e626b, 0x8a8377, 0x6f7278];
    for (let i = 0; i < 7; i++) {
      const w = 3.2 + (i % 3) * 0.8;
      const h = 6 + ((i * 37) % 5) * 1.6;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 4),
        new THREE.MeshStandardMaterial({ color: bcolors[i % bcolors.length], roughness: 0.86 })
      );
      b.position.set(-14 + i * 4.7, h / 2 - 0.1, D / 2 + 13.5);
      b.castShadow = true; b.receiveShadow = true;
      this.root.add(b);
      // 窗（發光方塊）
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.7, h * 0.6),
        new THREE.MeshStandardMaterial({
          color: 0xffd9a0, emissive: 0xffbf70, emissiveIntensity: 0.35,
          roughness: 0.4, transparent: true, opacity: 0.9
        })
      );
      win.position.set(b.position.x, h * 0.52, D / 2 + 11.45);
      this.root.add(win);
      this.lampPointers.push({ obj: win, kind: 'window' });
    }

    // 自動販賣機（日本街角必備）
    const vm = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.1 })
    );
    body.position.y = 0.95; body.castShadow = true; body.receiveShadow = true;
    vm.add(body);
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 1.0),
      new THREE.MeshStandardMaterial({ color: 0xf3ece0, emissive: 0xfff0c0, emissiveIntensity: 0.5, roughness: 0.35 })
    );
    front.position.set(0, 1.25, 0.36);
    vm.add(front);
    place(vm, -7.4, 0.02, D / 2 + 1.9, Math.PI * 0.06);
    this.root.add(vm);
    this.lampPointers.push({ obj: front, kind: 'vending' });

    // 腳踏車（簡化：兩個輪＋車架）
    const bike = new THREE.Group();
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.92 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d4a5c, metalness: 0.7, roughness: 0.35 });
    for (const dx of [-0.52, 0.52]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 20), tyreMat);
      wheel.position.set(dx, 0.33, 0);
      wheel.castShadow = true;
      bike.add(wheel);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.05), frameMat);
    bar.position.set(0, 0.55, 0); bar.castShadow = true;
    bike.add(bar);
    const seatPost = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), frameMat);
    seatPost.position.set(-0.3, 0.7, 0); seatPost.castShadow = true;
    bike.add(seatPost);
    place(bike, 6.6, 0.02, D / 2 + 1.7, Math.PI * 0.12);
    this.root.add(bike);

    // 店外暖光（入口處的地面光暈，用一個低強度點光模擬招牌照明）
    const porch = new THREE.PointLight(0xffd0a0, 0, 7, 2);
    porch.position.set(p.entrance.x, 2.4, D / 2 + 0.6);
    this.root.add(porch);
    this.porchLight = porch;
  }

  /* ── 員工 ───────────────────────────────────────────────────── */

  buildStaff() {
    for (const s of this.plan.staffSpots) {
      let mesh = null;
      try {
        mesh = Chars.makeCharacter({ kind: s.role === 'chef' ? 'chef' : 'waiter', seed: 1000 + this.staffMeshes.length * 77 });
      } catch { mesh = null; }
      if (!mesh || !mesh.isObject3D) {
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.24, 1.0, 4, 10),
          new THREE.MeshStandardMaterial({ color: s.role === 'chef' ? 0xf0efe8 : 0x22262e, roughness: 0.7 })
        );
        mesh.position.y = 0.75;
      }
      place(mesh, s.x, this.floorY, s.z, s.ry || 0);
      shadowize(mesh);
      this.root.add(mesh);
      this.staffMeshes.push({ mesh, spot: s, seed: Math.floor(Math.random() * 1e6) });
    }
  }

  /* ── 客人同步 ───────────────────────────────────────────────── */

  syncGroups(state, dt) {
    const seen = new Set();
    for (const g of state.groups) {
      seen.add(g.id);
      let rec = this.groupMeshes.get(g.id);
      if (!rec) {
        rec = { meshes: [], kinds: [] };
        for (let i = 0; i < g.size; i++) {
          const seed = g.members[i]?.seed ?? (i * 977 + 13);
          let m = null;
          try { m = Chars.makeCharacter({ kind: g.kind, seed, height: 1.62 + (seed % 17) / 100 }); } catch { m = null; }
          if (!m || !m.isObject3D) {
            m = new THREE.Mesh(
              new THREE.CapsuleGeometry(0.2, 0.9, 4, 8),
              new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.8 })
            );
            m.position.y = 0.7;
          }
          shadowize(m);
          this.root.add(m);
          rec.meshes.push(m);
        }
        this.groupMeshes.set(g.id, rec);
      }
      // 位置與姿勢
      const pose = g.pose || 'stand';
      for (let i = 0; i < rec.meshes.length; i++) {
        const m = rec.meshes[i];
        const mem = g.members[i];
        if (!mem) { m.visible = false; continue; }
        m.visible = true;
        const y = (mem.seat >= 0 && (pose === 'sit' || pose === 'eat')) && this._onTatami(g, mem) ? this.tatamiY : this.floorY;
        m.position.set(mem.x, y, mem.z);
        m.rotation.y = mem.ry || 0;
        try { Chars.setPose(m, pose === 'eat' ? 'eat' : pose, this._clock + i * 0.3); } catch { /* 姿勢失敗就維持 */ }
      }
    }
    // 清理已離店的組
    for (const [id, rec] of this.groupMeshes) {
      if (seen.has(id)) continue;
      for (const m of rec.meshes) {
        this.root.remove(m);
        try { Chars.disposeCharacter?.(m); } catch { /* ignore */ }
      }
      this.groupMeshes.delete(id);
    }
    void dt;
  }

  _onTatami(g, mem) {
    const t = this.plan.tatami;
    return mem.x > t.x - t.w / 2 && mem.x < t.x + t.w / 2 && mem.z > t.z - t.d / 2 && mem.z < t.z + t.d / 2;
  }

  /* ── 每幀更新 ───────────────────────────────────────────────── */

  update(dt, state) {
    this._clock += dt;
    this.syncGroups(state, dt);

    // 員工：輕微待機動作（若 characters 支援）
    for (let i = 0; i < this.staffMeshes.length; i++) {
      const s = this.staffMeshes[i];
      try { Chars.setPose(s.mesh, s.spot.role === 'chef' ? 'stand' : 'wait', this._clock + i); } catch { /* ignore */ }
    }

    // 夜晚：燈籠與店外光
    const night = state.__night ?? false;
    const glow = night ? 1 : 0;
    this.porchLight.intensity = glow * 9;
    for (const p of this.lampPointers) {
      const emissiveBoost = p.kind === 'shoji' || p.kind === 'andon' || p.kind === 'lantern' || p.kind === 'vending' || p.kind === 'window';
      if (!emissiveBoost) continue;
      p.obj.traverse((o) => {
        if (o.isMesh && o.material && 'emissiveIntensity' in o.material) {
          o.material.emissiveIntensity = night ? 1.15 : 0.22;
        }
      });
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }
}

export default RestaurantView;
