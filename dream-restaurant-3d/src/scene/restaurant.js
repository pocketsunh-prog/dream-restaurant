// ============================================================================
// restaurant.js — 日式餐廳場景組裝（房間、裝潢、傢俱、客人、員工）
//   所有道具來自 props.js；若某個道具不存在會自動退回佔位幾何，不會整場爆掉。
// ============================================================================
import * as THREE from 'three';
import * as Props from './props.js';
import * as Chars from './characters.js';
import { uniformById } from '../data/uniforms.js';
import { dishById } from '../data/dishes.js';
import { allTables, crowdInfo } from '../sim/game.js';
import { sheetReady, makeSheetCharacter, setSheetFrame } from './actors.js';
import { petAreaOf, petIsAway } from '../sim/pets.js';
import { buildPetArea, SIDEWALK_Y } from './petarea.js';

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
  constructor(scene, plan, opts = {}) {
    this.scene = scene;
    this.plan = plan;
    this.location = opts.location || null;
    this.theme = this.location?.theme || null;
    const th = this.theme || {};
    this._wallColor = th.wall || '#e6dccb';
    this._wallAccent = th.wallAccent || '#c0b098';
    this._floorColor = th.floor || '#8c6a44';
    this._floorAlt = this._shade(this._floorColor, -16);
    this._accent = th.accent || '#c0392b';
    this._light = th.light || '#fff4e2';
    this._style = th.style || 'modern';
    this.root = new THREE.Group();
    this.root.name = 'restaurant';
    scene.add(this.root);

    this.FH = plan?.floorHeight || 3.4;   // 每層樓高（人物要站在自己那一層）

    this.groupMeshes = new Map();   // groupId -> [meshes]
    this.staffMeshes = new Map();   // staffId -> mesh（buildStaff 會重建）
    this.lampPointers = [];         // 需要隨夜晚開關的發光體
    this.tableProps = [];
    this._tmp = new THREE.Vector3();
    this._clock = 0;
    this.cookFx = null;             // 爐火／蒸氣
    this.cookLabels = [];           // 調理中的浮動標籤
    this.sidewalkY = SIDEWALK_Y;    // 店外（人行道）的地面高度；店內用 floorY
    this.petArea = null;            // ペットスペース（ドッグラン）の矩形
    this.petAreaGroup = null;       // その見た目（buildPetSpace で作る）
    this.petAreaBall = null;        // 遊んでいるペットのそばを転がるボール

    this.buildRoom();
    this.buildFurniture();
    this.buildDecor();
    this.buildOutside();
    this.buildStaff();
    this.buildStairs();
  }

  /**
   * 接手另一個 view 的成果（搬遷／擴建／讀檔時重建場景用）。
   * 之前 main.js 是用 Object.assign 手寫欄位，常常漏掉新加的成員
   * （厨房的爐火、調理標籤、候位繩…），這裡一次複製全部，避免漏掉。
   */
  adoptFrom(next) {
    if (!next) return this;
    for (const k of Object.keys(next)) {
      if (k === 'scene' || k === '_tmp') continue;
      this[k] = next[k];
    }
    return this;
  }

  /* ── 樓梯（連通各樓層）────────────────────────────────────────── */

  buildStairs() {
    const p = this.plan;
    if (!p || p.floorCount <= 1) return;
    const grp = new THREE.Group();
    grp.name = 'stairs';
    const stairMat = new THREE.MeshStandardMaterial({ color: this._shade(this._wallAccent, 10), roughness: 0.8 });
    const sx = p.stairs.x, sz = p.stairs.z;
    const step = 0.32, w = 1.0, depth = 1.4;
    const stepsPerFloor = Math.ceil(p.floorHeight / 0.16);
    for (let f = 0; f < p.floorCount - 1; f++) {
      const yBase = f * p.floorHeight;
      // 往上的樓梯段（從 (sx, sz) 往上走到 (sx+depth, sz)）
      for (let i = 0; i < stepsPerFloor; i++) {
        const t = i / stepsPerFloor;
        const y = yBase + t * p.floorHeight;
        const x = sx + t * depth;
        const tread = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, step * 1.2), stairMat);
        tread.position.set(x, y + 0.03, sz);
        tread.castShadow = true; tread.receiveShadow = true;
        grp.add(tread);
        const riser = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.04), stairMat);
        riser.position.set(x, y + 0.08, sz + step * 0.6);
        grp.add(riser);
      }
      // 平台
      const landing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.08, 1.0), stairMat);
      landing.position.set(sx + depth * 0.5, yBase + p.floorHeight, sz);
      landing.castShadow = true; landing.receiveShadow = true;
      grp.add(landing);
    }
    this.root.add(grp);
  }

  /* ── 房間本體 ───────────────────────────────────────────────── */

  buildRoom() {
    const p = this.plan;
    const W = p.width, D = p.depth, H = 2.85;
    const FH = p.floorHeight || 3.4;
    const floors = p.floorCount || 1;

    // 為每一樓層建立一個子群組（偏移在 Y）
    this.floorGroups = [];
    for (let f = 0; f < floors; f++) {
      const fg = new THREE.Group();
      fg.name = 'floor' + f;
      fg.position.y = f * FH;
      this.root.add(fg);
      this.floorGroups.push(fg);
    }

    for (let f = 0; f < floors; f++) {
      const fg = this.floorGroups[f];
      const isGround = f === 0;

      // 地板（每層都有）
      const floor = makePropSafe('woodFloor', { w: W + 0.9, h: D + 0.9 }, { x: W + 0.9, y: 0.1, z: D + 0.9 });
      floor.position.set(0, 0, 0);
      const floorCol = new THREE.Color(this._floorColor);
      floor.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.copy(floorCol); } });
      fg.add(shadowize(floor));

      // 榻榻米區（僅一樓）
      if (isGround) {
        const tat = p.tatami;
        const tatamiGroup = new THREE.Group();
        const cols = Math.floor(tat.w / 0.9);
        const rows = Math.floor(tat.d / 1.8);
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const mat = makePropSafe('tatami', { w: 0.88, h: 1.78 }, { x: 0.88, y: 0.06, z: 1.78 });
            mat.position.set(tat.x - tat.w / 2 + 0.45 + i * 0.9, 0.06, tat.z - tat.d / 2 + 0.9 + j * 1.8);
            mat.rotation.y = ((i + j) % 2) ? Math.PI / 2 : 0;
            tatamiGroup.add(shadowize(mat));
          }
        }
        this.tatamiY = 0.12;
        this._tatamiGroup = tatamiGroup;
        fg.add(tatamiGroup);
      }

      // 牆與天花板（每層都有）
      this.buildShell(W, D, H, fg, f);

      // 柱子與樑（每層都有）
      this.buildPillarsBeams(W, D, H, fg, f, isGround);

      // 障子、暖簾、看板、霓虹、緣側（僅一樓）
      if (isGround) {
        const shojiXs = [-W / 2 + 0.6, -W / 2 + 1.75, W / 2 - 1.75, W / 2 - 0.6];
        for (const x of shojiXs) {
          const s = makePropSafe('shoji', { w: 1.1, h: 1.95, lit: true }, { x: 1.1, y: 1.95, z: 0.08 });
          s.position.set(x, 0, -D / 2 + 0.14);
          fg.add(shadowize(s));
          this.lampPointers.push({ obj: s, kind: 'shoji' });
        }
        const e = this.plan.entrance;
        const noren = makePropSafe('noren', { w: 1.9, h: 0.62, text: '食堂', color: '#1d3b5c' }, { x: 1.9, y: 0.62, z: 0.06 });
        noren.position.set(e.x, 1.86, D / 2 - 0.02);
        noren.rotation.y = Math.PI;
        fg.add(shadowize(noren));
        const sign = makePropSafe('signboard', { w: 1.7, h: 0.5, text: '夢幻食堂' }, { x: 1.7, y: 0.5, z: 0.1 });
        sign.position.set(e.x, 2.62, D / 2 + 0.12);
        sign.rotation.y = Math.PI;
        fg.add(shadowize(sign));
        const neon = makePropSafe('neonSign', { w: 0.7, h: 2.0, text: '居酒屋' }, { x: 0.7, y: 2.0, z: 0.12 });
        neon.position.set(W / 2 - 0.16, 1.5, 1.2);
        neon.rotation.y = -Math.PI / 2;
        fg.add(shadowize(neon));
        this.lampPointers.push({ obj: neon, kind: 'neon' });
        // 緣側
        const tat = this.plan.tatami;
        const eng = makePropSafe('engawa', { len: 4.2, w: 0.7 }, { x: 4.2, y: 0.18, z: 0.7 });
        eng.position.set(tat.x, 0.08, tat.z - tat.d / 2 - 0.35);
        fg.add(shadowize(eng));

        // 一樓的「店內設施」：吧台、調理場（厨房）、出餐口、洗手間
        this._buildGroundFixtures(fg);
      }

      // 吊燈、行燈（每層）
        this.buildLightingFixtures(fg, f, isGround);

      // 桌子＋椅子＋餐具（各樓層）
      this._buildTablesForFloor(fg, p.floorPlans[f]?.tables || [], f);
    }

    this.floorY = 0.1;
  }

  /* ── 一樓設施：吧台、調理場（厨房）、出餐口、洗手間 ─────────────
     調理場做成「開放式厨房」：客人與玩家都看得到廚師站在爐前做菜。 */
  _buildGroundFixtures(fg) {
    const p = this.plan;
    const K = p.kitchen || { x: 3.6, z: -4.0, w: 5.6, d: 1.9 };

    // 吧台（沿西牆，長邊朝南北）
    const bar = makePropSafe('counter', { len: 3.4, h: 1.05, d: 0.6 }, { x: 0.6, y: 1.05, z: 3.4 });
    bar.position.set(p.counter.x, 0, p.counter.z);
    bar.rotation.y = Math.PI / 2;
    fg.add(shadowize(bar));
    aoBlob(fg, p.counter.x, 0.011, p.counter.z, 0.9, 2.0, 0.9);
    for (let i = 0; i < 4; i++) {
      const stool = makePropSafe('chair', { seatH: 0.62 }, { x: 0.4, y: 0.75, z: 0.4 });
      stool.position.set(p.counter.x + 0.72, 0, p.counter.z - 1.2 + i * 0.8);
      stool.rotation.y = -Math.PI / 2;
      stool.scale.setScalar(0.92);
      fg.add(shadowize(stool));
    }

    // 廚房工作檯沿北牆：洗い場 → 作業台 → 冷蔵庫
    const zWall = -p.depth / 2 + 0.62;
    const sink = makePropSafe('sink', { w: 1.1, h: 0.9, d: 0.62 }, { x: 1.1, y: 0.9, z: 0.62 });
    sink.position.set(K.x - K.w / 2 + 0.75, 0, zWall);
    fg.add(shadowize(sink));
    const kc = makePropSafe('kitchenCounter', { len: 2.0, h: 0.9, d: 0.65 }, { x: 2.0, y: 0.9, z: 0.65 });
    kc.position.set(K.x - 0.5, 0, zWall);
    fg.add(shadowize(kc));
    const fridge = makePropSafe('fridge', { w: 0.9, h: 1.8, d: 0.7 }, { x: 0.9, y: 1.8, z: 0.7 });
    fridge.position.set(K.x + 1.5, 0, zWall + 0.02);
    fg.add(shadowize(fridge));
    const shelf = makePropSafe('shelf', { w: 2.0, h: 0.95, d: 0.3, bottles: 6 }, { x: 2.0, y: 0.95, z: 0.3 });
    shelf.position.set(K.x - 0.6, 1.5, -p.depth / 2 + 0.26);
    fg.add(shadowize(shelf));

    // 爐台（廚師的工作位置）＋爐火／蒸氣（syncCooking 會依實際狀況開關）
    const stove = makePropSafe('stove', { w: 1.5, h: 0.86, d: 0.8 }, { x: 1.5, y: 0.86, z: 0.8 });
    stove.position.set(p.stove.x, 0, p.stove.z);
    stove.rotation.y = Math.PI;   // 面向南邊（廚師站的那一側）
    fg.add(shadowize(stove));
    aoBlob(fg, p.stove.x, 0.011, p.stove.z + 0.3, 1.0, 0.7, 0.85);

    this.cookFx = new THREE.Group();
    this.cookFx.name = 'cookFx';
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff8a2b, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const panMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.42, metalness: 0.55 });
    const steamMat = new THREE.MeshBasicMaterial({
      color: 0xf6f4ef, transparent: true, opacity: 0.0, depthWrite: false
    });
    this.burners = [];
    for (let i = 0; i < 2; i++) {
      const bx = p.stove.x - 0.36 + i * 0.72;
      const bz = p.stove.z + 0.12;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 10, 1, true), flameMat.clone());
      flame.position.set(bx, 0.9, bz);
      flame.rotation.x = Math.PI;
      this.cookFx.add(flame);
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.09, 14), panMat);
      pan.position.set(bx, 0.95, bz);
      pan.castShadow = true;
      this.cookFx.add(pan);
      const steam = [];
      for (let s = 0; s < 5; s++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), steamMat.clone());
        puff.position.set(bx + (s - 2) * 0.05, 1.06, bz);
        puff.scale.setScalar(0.6 + s * 0.06);
        this.cookFx.add(puff);
        steam.push(puff);
      }
      // 爐火的光暈（開火時整間厨房會亮起來）
      const glow = new THREE.PointLight(0xff9b3d, 0, 3.2, 2);
      glow.position.set(bx, 1.1, bz);
      this.cookFx.add(glow);
      this.burners.push({ flame, steam, glow, bx, bz, phase: i * 1.7 });
    }
    fg.add(this.cookFx);

    // 出餐口（カウンター）：菜會放在這裡等服務生來端
    const pass = makePropSafe('counter', { len: 1.9, h: 0.94, d: 0.55 }, { x: 1.9, y: 0.94, z: 0.55 });
    pass.position.set(p.pass.x, 0, p.pass.z);
    fg.add(shadowize(pass));
    aoBlob(fg, p.pass.x, 0.011, p.pass.z, 1.2, 0.6, 0.85);
    const passLamp = new THREE.PointLight(0xffe6c0, 6, 4.5, 2);
    passLamp.position.set(p.pass.x, 2.3, p.pass.z);
    fg.add(passLamp);
    this.passLight = passLamp;

    // 廚房口的暖簾（寫「調理場」），讓厨房一眼看得出來
    const kNor = makePropSafe('noren', { w: 1.6, h: 0.5, text: '調理場', color: '#2b2b30' }, { x: 1.6, y: 0.5, z: 0.06 });
    kNor.position.set(p.stove.x, 2.35, p.stove.z + 0.55);
    fg.add(shadowize(kNor));

    // 洗手間（西側角落）：門簾＋洗手台＋看板
    const r = p.restroom;
    const wcDoor = makePropSafe('noren', { w: 1.1, h: 0.55, text: 'お手洗い', color: '#2f4858' }, { x: 1.1, y: 0.55, z: 0.06 });
    wcDoor.position.set(r.x, 1.9, -p.depth / 2 + 0.16);
    fg.add(shadowize(wcDoor));
    const wcSink = makePropSafe('sink', { w: 0.8, h: 0.85, d: 0.5 }, { x: 0.8, y: 0.85, z: 0.5 });
    wcSink.position.set(r.x + 0.95, 0, -p.depth / 2 + 0.5);
    fg.add(shadowize(wcSink));
    const wcSign = makePropSafe('signboard', { w: 0.7, h: 0.34, text: 'WC' }, { x: 0.7, y: 0.34, z: 0.08 });
    wcSign.position.set(r.x, 2.6, -p.depth / 2 + 0.14);
    fg.add(shadowize(wcSign));
    this.restroomSpot = { x: r.x, z: r.z };

    // 調理中の浮動標籤（誰在煮什麼、煮到幾成）
    this.cookLabels = [];
    for (let i = 0; i < 4; i++) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 96;
      const tex = new THREE.CanvasTexture(cv);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1.5, 0.56, 1);
      sp.visible = false;
      sp.renderOrder = 20;
      sp.userData = { cv, tex, key: '' };
      this.root.add(sp);
      this.cookLabels.push(sp);
    }
  }

  /* ── 桌子＋椅子＋餐具（各樓層）────────────────────────────────── */

  _buildTablesForFloor(fg, tables, floorIdx) {
    this.tableById = this.tableById || new Map();
    for (const t of tables) {
      this.tableById.set(t.id, t);
      const baseY = (floorIdx === 0 && t.style === 'chabudai') ? this.tatamiY : 0;
      if (t.style === 'chabudai' && floorIdx === 0) {
        const table = makePropSafe('chabudai', { w: 1.25, d: 0.8, h: 0.34 }, { x: 1.25, y: 0.34, z: 0.8 });
        table.position.set(t.x, baseY, t.z);
        fg.add(shadowize(table));
        for (let i = 0; i < t.seats; i++) {
          const sp = t.seatPos[i];
          const za = makePropSafe('zabuton', { w: 0.56, d: 0.56 }, { x: 0.56, y: 0.09, z: 0.56 });
          za.position.set(sp.x, baseY, sp.z);
          za.rotation.y = sp.ry;
          fg.add(shadowize(za));
        }
        const set = makePropSafe('tableSetting', { plates: t.seats }, { x: 0.7, y: 0.06, z: 0.7 });
        set.position.set(t.x, baseY + 0.34, t.z);
        fg.add(shadowize(set));
      } else {
        const table = makePropSafe('table', { w: 1.15, d: 0.78, h: 0.72 }, { x: 1.15, y: 0.72, z: 0.78 });
        table.position.set(t.x, baseY, t.z);
        fg.add(shadowize(table));
        aoBlob(fg, t.x, baseY + 0.012, t.z, 0.95, 0.72, 0.7);
        for (let i = 0; i < t.seats; i++) {
          const sp = t.seatPos[i];
          const ch = makePropSafe('chair', {}, { x: 0.46, y: 0.9, z: 0.46 });
          ch.position.set(sp.x, baseY, sp.z);
          // 椅背在 -Z、椅面朝 +Z：坐的人面向桌心，所以椅子要轉 180°
          // （以前直接沿用客人的面向，結果每張椅子都側著桌子，看起來亂七八糟）
          ch.rotation.y = sp.ry + Math.PI;
          fg.add(shadowize(ch));
          // 座墊：整排椅子的顏色一致，視覺上就整齊
          const cushion = new THREE.Mesh(
            new THREE.BoxGeometry(0.37, 0.04, 0.36),
            this._cushionMaterial(floorIdx)
          );
          cushion.position.set(sp.x, baseY + 0.465, sp.z);
          cushion.rotation.y = sp.ry + Math.PI;
          cushion.castShadow = true;
          cushion.receiveShadow = true;
          fg.add(cushion);
        }
        const set = makePropSafe('tableSetting', { plates: t.seats }, { x: 0.7, y: 0.06, z: 0.7 });
        set.position.set(t.x, baseY + 0.72, t.z);
        fg.add(shadowize(set));
      }
      // ペット同伴席：桌子旁鋪寵物墊、放水碗與飼料碗、立一個小牌子
      if (t.petOk) this._buildPetSpot(fg, t, baseY);
      this.tableProps.push({ table: t, y: baseY });
    }
  }

  /** 寵物席的擺設（墊子＋水碗＋看板），並記下寵物要待的位置 */
  _buildPetSpot(fg, t, baseY) {
    this.petSpots = this.petSpots || [];
    const matCol = new THREE.Color(this._accent).lerp(new THREE.Color('#2f6b5f'), 0.6);
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.025, 0.62),
      new THREE.MeshStandardMaterial({ color: matCol, roughness: 0.95 })
    );
    // 墊子放在桌子南側（走道邊），寵物就趴在那裡
    const mz = t.z + 0.95;
    mat.position.set(t.x, baseY + 0.013, mz);
    mat.receiveShadow = true;
    fg.add(mat);
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.4, metalness: 0.25 });
    for (const [dx, col] of [[-0.26, 0x6fa8dc], [0.04, 0xc9b48a]]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.07, 12), bowlMat);
      bowl.position.set(t.x + dx, baseY + 0.05, mz + 0.08);
      bowl.castShadow = true;
      fg.add(bowl);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.086, 0.086, 0.012, 12),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.1 })
      );
      water.position.set(t.x + dx, baseY + 0.082, mz + 0.08);
      fg.add(water);
    }
    // 「ペット可」立牌
    const sign = makePropSafe('signboard', { w: 0.34, h: 0.18, text: 'ペット可' }, { x: 0.34, y: 0.18, z: 0.05 });
    sign.position.set(t.x + 0.62, baseY + 0.74, t.z - 0.02);
    sign.rotation.y = Math.PI * 0.5;
    sign.scale.setScalar(0.75);
    fg.add(shadowize(sign));
    this.petSpots.push({ tableId: t.id, x: t.x, z: mz, y: baseY });
  }

  _cushionMaterial(floorIdx) {
    this._cushionMats = this._cushionMats || {};
    const key = 'f' + floorIdx;
    if (this._cushionMats[key]) return this._cushionMats[key];
    const col = new THREE.Color(this._accent).lerp(new THREE.Color('#2b3a55'), 0.55);
    this._cushionMats[key] = new THREE.MeshStandardMaterial({ color: col, roughness: 0.92, metalness: 0 });
    return this._cushionMats[key];
  }

  buildPillarsBeams(W, D, H, fg, f, isGround) {
    const pillarAt = [
      [-W / 2 + 0.5, -D / 2 + 0.5], [W / 2 - 0.5, -D / 2 + 0.5],
      [-W / 2 + 0.5, D / 2 - 0.5], [W / 2 - 0.5, D / 2 - 0.5],
      [-W / 2 + 0.5, 0], [W / 2 - 0.5, 0]
    ];
    for (const [x, z] of pillarAt) {
      const pil = makePropSafe('pillar', { h: H }, { x: 0.18, y: H, z: 0.18 });
      pil.position.set(x, 0, z);
      fg.add(shadowize(pil));
    }
    for (const z of [-D / 2 + 1.2, D / 2 - 1.2]) {
      const beam = makePropSafe('beam', { len: W }, { x: W, y: 0.16, z: 0.18 });
      // 樑沿著 X 橫跨整個房間（makeBeam 本來就是長軸在 X，不可以再轉 90°，
      // 不然 13.2 m 的樑會沿著只有 9.6 m 的進深方向穿出牆外）
      beam.position.set(0, H - 0.2, z);
      fg.add(shadowize(beam));
    }
    void f; void isGround;
  }

  _buildRailing(fg, W, D) {
    const railMat = new THREE.MeshStandardMaterial({ color: this._shade(this._wallAccent, 18), roughness: 0.6, metalness: 0.3 });
    const h = 0.9, post = 0.04;
    const addRailing = (x1, z1, x2, z2, horizontal) => {
      const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
      const segs = Math.max(2, Math.round(len / 1.2));
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const px = horizontal ? x1 + (x2 - x1) * t : x1;
        const pz = horizontal ? z1 : z1 + (z2 - z1) * t;
        const p = new THREE.Mesh(new THREE.BoxGeometry(post, h, post), railMat);
        p.position.set(px, h / 2, pz);
        p.castShadow = true;
        fg.add(p);
      }
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(horizontal ? len : post, 0.04, horizontal ? post : len), railMat);
      bar.position.set(horizontal ? (x1 + x2) / 2 : x1, h * 0.7, horizontal ? z1 : (z1 + z2) / 2);
      fg.add(bar);
    };
    addRailing(-W / 2 + 0.1, -D / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.1, true);
    addRailing(W / 2 - 0.1, -D / 2 + 0.1, W / 2 - 0.1, D / 2 - 0.1, false);
    addRailing(-W / 2 + 0.1, D / 2 - 0.1, W / 2 - 0.1, D / 2 - 0.1, true);
  }

  _buildFloorLighting(fg, f, isGround) {
    void f; void isGround;
    const lampXs = [-3.4, 0.8, 3.4];
    for (let i = 0; i < lampXs.length; i++) {
      const x = lampXs[i];
      const z = i % 2 ? 0.6 : -2.4;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
      cord.position.set(x, 2.6, z);
      fg.add(cord);
      const chochin = makePropSafe('chochin', { r: 0.2, h: 0.36, text: i % 2 ? '酒' : '食' }, { x: 0.4, y: 0.36, z: 0.4 });
      chochin.position.set(x, 2.1, z);
      fg.add(shadowize(chochin));
      this.lampPointers.push({ obj: chochin, kind: 'lantern' });
    }
  }
  buildLightingFixtures(fg, f, isGround) {
    this._buildFloorLighting(fg, f, isGround);
  }

  /* 牆面／天花板（單面朝內）＋ 牆裙、樑下壓條 */
  buildShell(W, D, H, fg) {
    const plaster = this._plasterMaterial();
    const wood = this._woodMaterial();

    const wallPlane = (w, h, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plaster);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      return m;
    };
    const wainscot = (w, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.05), wood);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      return m;
    };

    const zN = -D / 2 + 0.01, zS = D / 2 - 0.01;
    const xW = -W / 2 + 0.01, xE = W / 2 - 0.01;
    const e = this.plan.entrance;

    fg.add(wallPlane(W, H, 0, H / 2, zN, 0));
    fg.add(wainscot(W, 0, 0.525, zN + 0.012, 0));
    fg.add(wallPlane(D, H, xW, H / 2, 0, Math.PI / 2));
    fg.add(wainscot(D, xW + 0.012, 0.525, 0, Math.PI / 2));
    fg.add(wallPlane(D, H, xE, H / 2, 0, -Math.PI / 2));
    fg.add(wainscot(D, xE - 0.012, 0.525, 0, -Math.PI / 2));
    const doorW = 1.9;
    const segW = (W - doorW) / 2;
    for (const sx of [e.x - doorW / 2 - segW / 2, e.x + doorW / 2 + segW / 2]) {
      fg.add(wallPlane(segW, H, sx, H / 2, zS, Math.PI));
      fg.add(wainscot(segW, sx, 0.525, zS - 0.012, Math.PI));
    }
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(doorW, H - 2.2), plaster);
    lintel.position.set(e.x, 2.2 + (H - 2.2) / 2, zS);
    lintel.rotation.y = Math.PI;
    lintel.receiveShadow = true;
    fg.add(lintel);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this._ceilingMaterial());
    ceil.position.set(0, H, 0);
    ceil.rotation.x = Math.PI / 2;
    ceil.receiveShadow = true;
    fg.add(ceil);

    const roofBlocker = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.5, D + 0.5),
      new THREE.MeshBasicMaterial({ colorWrite: false })
    );
    roofBlocker.position.set(0, H + 0.06, 0);
    roofBlocker.rotation.x = Math.PI / 2;
    roofBlocker.castShadow = true;
    roofBlocker.receiveShadow = false;
    fg.add(roofBlocker);
  }

  _shade(hex, amt) {
    const c = hex.replace('#', '');
    let r = parseInt(c.slice(0, 2), 16) + amt;
    let g = parseInt(c.slice(2, 4), 16) + amt;
    let b = parseInt(c.slice(4, 6), 16) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  _plasterMaterial() {
    if (this._plasterMat) return this._plasterMat;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = this._wallColor;
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
    c.fillStyle = this._wallAccent;
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
    c.fillStyle = this._shade(this._wallColor, -22);
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

  /* ── 傢俱（已整合至多樓層 buildRoom）────────────────────────── */

  buildFurniture() { /* 已整合至 buildRoom */ }

  /* ── 裝潢（已整合至多樓層 buildRoom）────────────────────────── */

  buildDecor() { /* 已整合至 buildRoom */ }

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

    // 候位動線：門口沿著人行道排隊（客人真的會站在這裡排）
    this.buildQueueLane();
    // 街上的東西：街燈、斑馬線、巴士站、行人穿越標誌
    this.buildStreetProps();
    // 門口的「にぎわい看板」：即時顯示店內人數與候位名單
    this.buildNoticeBoard();
    // ペットスペース（ドッグラン）：歩道の西側。ペット同伴のペットが遊びに行く場所
    this.buildPetSpace();

    // 街道的兩端（客人從這裡走過來、也從這裡走回去）
    const st = p.street || { ax: -12.4, az: D / 2 + 1.6, bx: 12.4, bz: D / 2 + 1.6 };
    for (const [x, z] of [[st.ax, st.az], [st.bx, st.bz]]) {
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false })
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x, 0.012, z);
      this.root.add(mark);
    }
  }

  /* ── 門口的「にぎわい看板」（即時顯示店內人數與候位名單）──────── */

  buildNoticeBoard() {
    const p = this.plan;
    const D = p.depth;
    const grp = new THREE.Group();
    grp.name = 'noticeBoard';

    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.78 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1a16, roughness: 0.6 });
    const post = new THREE.MeshStandardMaterial({ color: 0x3b3a3c, metalness: 0.5, roughness: 0.45 });

    // 看板本體：木框 + 自發光面板（夜晚也看得清楚）
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 384;
    const tex = new THREE.CanvasTexture(cv);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const board = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.86, 0.06), wood);
    frame.castShadow = true;
    board.add(frame);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.74),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    panel.position.z = 0.033;
    board.add(panel);
    // 小小的屋簷（日本街頭看板的樣子）
    const eave = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.05, 0.24), dark);
    eave.position.set(0, 0.47, 0.06);
    eave.castShadow = true;
    board.add(eave);

    board.position.set(0, 1.62, 0);
    grp.add(board);

    // 兩根腳柱
    for (const x of [-0.42, 0.42]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 1.24, 10), post);
      leg.position.set(x, 0.62, 0);
      leg.castShadow = true;
      grp.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 12), post);
      foot.position.set(x, 0.025, 0);
      grp.add(foot);
    }
    grp.position.set(p.entrance.x + 2.55, 0, D / 2 + 0.72);
    grp.rotation.y = -0.14;
    this.root.add(grp);
    aoBlob(this.root, p.entrance.x + 2.55, 0.006, D / 2 + 0.72, 0.95, 0.42, 0.5);

    this.noticeBoard = { group: grp, canvas: cv, texture: tex, key: '' };
    this._noticeKey = '';
  }

  /** 更新看板內容（內容沒變就不重畫） */
  syncNoticeBoard(state, info) {
    const nb = this.noticeBoard;
    if (!nb || !info) return;
    const list = (info.waitingList || []).slice(0, 5);
    const key = [
      info.insideGuests, info.seats, info.seatsFree, info.todayGuests,
      info.waiting, info.maxQueueWait, info.petInside, info.petToday,
      list.map((w) => `${w.size}/${w.waitMin}/${w.pet ? 'p' : ''}`).join('|'),
      state?.phase || ''
    ].join(',');
    if (key === this._noticeKey) return;
    this._noticeKey = key;
    nb.key = key;

    const c = nb.canvas.getContext('2d');
    const W = nb.canvas.width, H = nb.canvas.height;
    // 底：深色電光板
    c.fillStyle = '#15161a';
    c.fillRect(0, 0, W, H);
    const grd = c.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(255,255,255,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = grd;
    c.fillRect(0, 0, W, H);

    // 標題
    c.fillStyle = '#ffd479';
    c.font = 'bold 34px system-ui, sans-serif';
    c.fillText('本日のにぎわい', 22, 48);
    c.fillStyle = 'rgba(255,212,121,0.35)';
    c.fillRect(22, 62, W - 44, 3);

    // 店內人數（大字）
    const full = info.seatsFree <= 0;
    c.fillStyle = full ? '#ff8a7a' : '#9ff0a8';
    c.font = 'bold 40px system-ui, sans-serif';
    c.fillText(full ? '満席' : '空席あり', 22, 112);
    c.fillStyle = '#f2ede2';
    c.font = 'bold 30px system-ui, sans-serif';
    c.fillText(`店内 ${info.insideGuests} 名`, 210, 112);
    c.fillStyle = '#c9c2b4';
    c.font = '24px system-ui, sans-serif';
    c.fillText(`（${info.seats} 席 / 空き ${info.seatsFree}）`, 210, 142);

    // 本日の来客
    c.fillStyle = '#e8dfd0';
    c.font = '26px system-ui, sans-serif';
    c.fillText(`本日の来客 ${info.todayGuests} 名`, 24, 178);

    // 候位
    if (info.waiting > 0) {
      c.fillStyle = '#ffb26b';
      c.font = 'bold 28px system-ui, sans-serif';
      c.fillText(`行列 ${info.waiting} 組・待ち ${info.maxQueueWait} 分`, 24, 214);
    } else {
      c.fillStyle = '#9ff0a8';
      c.font = 'bold 28px system-ui, sans-serif';
      c.fillText('行列なし（すぐご案内できます）', 24, 214);
    }

    // 候位名單
    c.fillStyle = 'rgba(255,255,255,0.14)';
    c.fillRect(20, 232, W - 40, 2);
    c.font = '23px system-ui, sans-serif';
    if (!list.length) {
      c.fillStyle = '#8f8a80';
      c.fillText('ただいまお待ちのお客様はおりません', 24, 268);
    } else {
      list.forEach((w, i) => {
        const y = 268 + i * 30;
        c.fillStyle = '#cfe6ff';
        c.fillText(`${i + 1}.`, 24, y);
        c.fillStyle = '#f2ede2';
        c.fillText(`${w.size} 名様`, 58, y);
        c.fillStyle = w.waitMin > 20 ? '#ff9a8a' : '#b9b2a4';
        c.fillText(`待ち ${w.waitMin} 分`, 190, y);
        if (w.pet) {
          c.fillStyle = '#ffd479';
          c.fillText('🐾', 330, y);
        }
        c.fillStyle = '#8f8a80';
        c.fillText(w.kindJp || '', 372, y);
      });
    }
    // 寵物席資訊
    if (info.petOkTables > 0) {
      c.fillStyle = '#9fd0ff';
      c.font = '20px system-ui, sans-serif';
      c.fillText(`ペット同伴席 ${info.petOkTables} 卓（店内 ${info.petInside} 組・本日 ${info.petToday} 組）`, 24, H - 16);
    }
    nb.texture.needsUpdate = true;
  }

  /* ── ペットスペース（ドッグラン）─────────────────────────────
     歩道の西側（入口動線と候位レーンを避けた位置）に低い柵で囲った遊び場を作る。
     矩形は模擬側（sim/pets.js の petAreaOf）が平面圖から決めるので、
     ここは同じ値を受け取って建てるだけ＝畫面とシミュレーションがずれない。
     ペットが遊びに行くかどうかは sim/pets.js の tickPets が決める。 */
  buildPetSpace() {
    this.petArea = petAreaOf({ plan: this.plan });
    this.petAreaGroup = buildPetArea(this.root, this.petArea, { y: this.sidewalkY, ao: aoBlob });
    this.petAreaBall = this.petAreaGroup.userData.ball || null;
    if (this.petAreaBall) this.petAreaBall.visible = false;   // 遊んでいるペットがいる間だけ出す
    return this.petAreaGroup;
  }

  /* ── 候位繩（支柱＋繩子）：把排隊的隊伍框在人行道上 */
  /** 候位繩（支柱＋繩子）：把排隊的隊伍框在人行道上 */
  buildQueueLane() {
    const q = this.plan.queue || { x: 2.6, z: this.plan.depth / 2 + 2.3, step: 1.15 };
    const grp = new THREE.Group();
    grp.name = 'queueLane';
    const postMat = new THREE.MeshStandardMaterial({ color: 0xc9ae74, metalness: 0.6, roughness: 0.34 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.3, roughness: 0.7 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8c2f2f, roughness: 0.85 });
    const len = q.step * 4;
    const z = q.z - 0.85;
    for (let i = 0; i <= 4; i++) {
      const x = q.x - 0.6 + (len / 4) * i;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 14), baseMat);
      base.position.set(x, 0.02, z);
      base.receiveShadow = true;
      grp.add(base);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.92, 10), postMat);
      post.position.set(x, 0.46, z);
      post.castShadow = true;
      grp.add(post);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), postMat);
      knob.position.set(x, 0.94, z);
      grp.add(knob);
      if (i > 0) {
        const px = q.x - 0.6 + (len / 4) * (i - 1);
        const seg = (x - px) / 8;
        for (let s = 0; s < 8; s++) {
          const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, Math.hypot(seg, 0.001) * 1.05, 6), ropeMat);
          rope.position.set(px + seg * (s + 0.5), 0.78 - Math.sin((s + 0.5) / 8 * Math.PI) * 0.1, z);
          rope.rotation.z = Math.PI / 2;
          grp.add(rope);
        }
      }
    }
    // 「行列」看板
    const sign = makePropSafe('signboard', { w: 0.9, h: 0.4, text: '行列' }, { x: 0.9, y: 0.4, z: 0.08 });
    sign.position.set(q.x - 0.6, 1.15, z - 0.12);
    grp.add(shadowize(sign));
    this.root.add(grp);
    this.queueLane = grp;
    aoBlob(grp, q.x + len / 2 - 0.6, 0.005, z, len / 2 + 0.4, 0.4, 0.5);
  }

  /** 街道感：街燈、斑馬線、巴士站牌、自動販賣機旁的長椅 */
  buildStreetProps() {
    const D = this.plan.depth;
    const grp = new THREE.Group();
    grp.name = 'streetProps';
    const metal = new THREE.MeshStandardMaterial({ color: 0x63666c, metalness: 0.55, roughness: 0.5 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xf5e9cf, emissive: 0xffe6b0, emissiveIntensity: 0.35, roughness: 0.4 });

    for (const x of [-9.5, 9.5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.6, 10), metal);
      pole.position.set(x, 2.3, D / 2 + 3.0);
      pole.castShadow = true;
      grp.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), metal);
      arm.position.set(x + (x < 0 ? 0.42 : -0.42), 4.5, D / 2 + 3.0);
      grp.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.34), lampMat);
      head.position.set(x + (x < 0 ? 0.8 : -0.8), 4.42, D / 2 + 3.0);
      grp.add(head);
      const pl = new THREE.PointLight(0xffd9a0, 0, 9, 2);
      pl.position.set(x + (x < 0 ? 0.8 : -0.8), 4.2, D / 2 + 3.0);
      grp.add(pl);
      this.lampPointers.push({ obj: head, kind: 'streetlamp' });
      this.lampPointers.push({ obj: pl, kind: 'streetlampPoint' });
    }

    // 斑馬線（在店門正前方）
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe4e0d4, roughness: 0.85 });
    for (let i = -3; i <= 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 7.2), stripe);
      s.position.set(i * 1.15, 0.0, D / 2 + 7.2);
      grp.add(s);
    }

    // 巴士站牌
    const stop = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), metal);
    sp.position.y = 1.3; sp.castShadow = true;
    stop.add(sp);
    const board = makePropSafe('signboard', { w: 0.7, h: 0.42, text: 'バス' }, { x: 0.7, y: 0.42, z: 0.07 });
    board.position.set(0, 2.2, 0.05);
    stop.add(shadowize(board));
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }));
    bench.position.set(0.9, 0.44, 0); bench.castShadow = true; bench.receiveShadow = true;
    stop.add(bench);
    for (const bx of [0.25, 1.55]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.34), metal);
      leg.position.set(bx, 0.22, 0);
      stop.add(leg);
    }
    place(stop, 10.6, 0.02, D / 2 + 2.0, -Math.PI * 0.06);
    grp.add(stop);
    aoBlob(grp, 11.5, 0.005, D / 2 + 2.0, 1.3, 0.5, 0.5);

    this.root.add(grp);
    this.streetProps = grp;
  }

  /* ── 員工（依 state.staff 動態建立／移除）───────────────────── */

  buildStaff() {
    this.staffMeshes = new Map();   // staffId -> mesh
    this.staffGroup = new THREE.Group();
    this.staffGroup.name = 'staff';
    this.root.add(this.staffGroup);
    // 出餐口的菜盤
    this.passDishes = new THREE.Group();
    this.passDishes.name = 'passDishes';
    this.root.add(this.passDishes);
    this._passShown = -1;
    // 髒桌標記
    this.dirtyMarks = new THREE.Group();
    this.dirtyMarks.name = 'dirtyMarks';
    this.root.add(this.dirtyMarks);
    this._dirtyShown = '';
  }

  /** 毎幀依 state.staff 同步：新增／移除人物，更新位置與姿勢 */
  syncStaff(state) {
    if (!this.staffGroup) return;
    const seen = new Set();
    const staff = Array.isArray(state.staff) ? state.staff : [];
    for (const s of staff) {
      seen.add(s.id);
      let mesh = this.staffMeshes.get(s.id);
      if (!mesh) {
        const kind = s.role === 'chef' ? 'chef' : 'waiter';
        // 用制服顏色注入人物外觀
        const uniform = uniformById(s.uniformId);
        const opts = Chars.uniformToOpts(uniform);
        try {
          mesh = Chars.makeCharacter({
            kind,
            seed: (s.appearance?.seed ?? 1234) + s.hiredDay * 31,
            height: s.appearance?.height ?? 1.68,
            gender: s.gender === 'f' ? 'female' : 'male',
            ...opts
          });
        } catch { mesh = null; }
        if (!mesh || !mesh.isObject3D) {
          mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.24, 1.0, 4, 10),
            new THREE.MeshStandardMaterial({ color: s.role === 'chef' ? 0xf0efe8 : 0x22262e, roughness: 0.7 })
          );
          mesh.position.y = 0.75;
        }
        shadowize(mesh);
        this.staffGroup.add(mesh);
        this.staffMeshes.set(s.id, mesh);
      }
      mesh.position.set(s.x ?? 0, (s.floor || 0) * this.FH + this.floorY, s.z ?? 0);
      mesh.rotation.y = s.dir ?? 0;
      const pose = s.pose || 'stand';
      const p = pose === 'walk' ? 'walk'
        : pose === 'cook' ? 'cook'
          : (s.carry > 0 && pose !== 'walk') ? 'carry'
            : (pose === 'wait' ? 'wait' : 'stand');
      try { Chars.setPose(mesh, p, this._clock + (s.appearance?.seed ?? 0) % 7); } catch { /* ignore */ }
    }
    for (const [id, mesh] of this.staffMeshes) {
      if (seen.has(id)) continue;
      this.staffGroup.remove(mesh);
      try { Chars.disposeCharacter?.(mesh); } catch { /* ignore */ }
      this.staffMeshes.delete(id);
    }
  }

  /** 出餐口上的菜（有幾組在等就放幾盤） */
  syncPass(state) {
    if (!this.passDishes) return;
    const n = Array.isArray(state.pass) ? state.pass.reduce((a, p) => a + Math.max(1, (p.dishes || []).length), 0) : 0;
    const shown = Math.min(6, n);
    if (shown === this._passShown) return;
    this._passShown = shown;
    while (this.passDishes.children.length) {
      const c = this.passDishes.children.pop();
      c.geometry?.dispose?.();
    }
    const p = this.plan.pass;
    for (let i = 0; i < shown; i++) {
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.08, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2b2b30 : 0xd8cfc0, roughness: 0.4, metalness: 0.05 })
      );
      bowl.position.set(p.x - 0.4 + (i % 3) * 0.4, this.floorY + 0.98, p.z - 0.1 + Math.floor(i / 3) * 0.24);
      bowl.castShadow = true;
      this.passDishes.add(bowl);
    }
  }

  /** 髒桌標記（碗盤堆） */
  syncDirtyTables(state) {
    if (!this.dirtyMarks) return;
    const dirty = (state.plan?.tables || []).filter((t) => t.dirty > 0).map((t) => t.id).join(',');
    if (dirty === this._dirtyShown) return;
    this._dirtyShown = dirty;
    while (this.dirtyMarks.children.length) {
      const c = this.dirtyMarks.children.pop();
      c.geometry?.dispose?.();
    }
    for (const t of allTables(state.plan)) {
      if (!(t.dirty > 0)) continue;
      const y = t.style === 'chabudai' ? this.tatamiY : this.floorY;
      for (let i = 0; i < 3; i++) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.1, 0.03, 10),
          new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.5 })
        );
        plate.position.set(t.x + (i - 1) * 0.18, y + (t.style === 'chabudai' ? 0.38 : 0.76) + i * 0.028, t.z + (i % 2 ? 0.1 : -0.1));
        plate.rotation.y = i * 0.6;
        plate.castShadow = true;
        this.dirtyMarks.add(plate);
      }
    }
  }

  /* ── 客人同步 ───────────────────────────────────────────────── */

  syncGroups(state, dt) {
    const seen = new Set();
    for (const g of state.groups) {
      seen.add(g.id);
      let rec = this.groupMeshes.get(g.id);
      if (!rec) {
        rec = { meshes: [], pets: [], shadows: [], sheet: null };
        // スプライトシートで描く客層（Cherish）：billboard スプライトを使う
        const useSheet = !!(g.sheet && sheetReady(g.sheet));
        rec.sheet = useSheet ? g.sheet : null;
        for (let i = 0; i < g.size; i++) {
          const seed = g.members[i]?.seed ?? (i * 977 + 13);
          let m = null;
          if (useSheet) {
            m = makeSheetCharacter(g.sheet);
          } else {
            try { m = Chars.makeCharacter({ kind: g.kind, seed, height: 1.62 + (seed % 17) / 100 }); } catch { m = null; }
          }
          if (!m || !m.isObject3D) {
            m = new THREE.Mesh(
              new THREE.CapsuleGeometry(0.2, 0.9, 4, 8),
              new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.8 })
            );
            m.position.y = 0.7;
          }
          if (useSheet) {
            // billboard は光を受けないので、接地影だけ別に敷く
            m.userData.kind = g.kind;
          } else {
            shadowize(m);
          }
          this.root.add(m);
          rec.meshes.push(m);
        }
        // 這組客人有寵物（約 12% 的組有一隻）
        if (g.pet) {
          try {
            const pet = Chars.makePet(g.pet, g.petSeed || 1);
            this.root.add(pet);
            rec.pets.push(pet);
          } catch { /* ignore */ }
        }
        this.groupMeshes.set(g.id, rec);
      }
      // 位置與姿勢（客人站在自己用餐的那一層）
      const pose = g.pose || 'stand';
      const gy = (g.floor || 0) * this.FH;
      const tbl = g.tableId ? (this.tableById || new Map()).get(g.tableId) : null;
      const floorSeat = !!(tbl && tbl.style === 'chabudai' && (tbl.floor || 0) === 0);
      for (let i = 0; i < rec.meshes.length; i++) {
        const m = rec.meshes[i];
        const mem = g.members[i];
        if (!mem) { m.visible = false; continue; }
        m.visible = true;
        const onTatami = (mem.seat >= 0 && (pose === 'sit' || pose === 'eat')) && this._onTatami(g, mem);
        const y = gy + ((mem.seat >= 0 && (pose === 'sit' || pose === 'eat')) && onTatami ? this.tatamiY : this.floorY);
        m.position.set(mem.x, y, mem.z);
        // ── billboard（Cherish）：6 コマ歩行をカメラ基準で回し、進行方向で左右反転 ──
        if (m.userData.isSheetActor) {
          this._updateSheetActor(m, mem, pose, y, i);
          continue;
        }
        // 榻榻米上的矮桌是「盤坐」：座高只有坐墊那麼高，不然人會飄在半空中
        m.userData.seatHeight = (floorSeat && onTatami) ? 0.09 : 0.45;
        m.rotation.y = mem.ry || 0;
        try { Chars.setPose(m, pose === 'eat' ? 'eat' : pose, this._clock + i * 0.3); } catch { /* 姿勢失敗就維持 */ }
      }
      // 寵物跟著這組移動；ペット同伴席なら桌邊的墊子上，
      // 遊びに行っている間（toPlay／play／back）だけはペットスペースの座標を使う
      if (rec.pets.length && g.members[0]) {
        const lead = g.members[0];
        const spot = (g.petTable && (g.state === 'ordering' || g.state === 'waitCook'
          || g.state === 'waitServe' || g.state === 'eating' || g.state === 'waitPay'))
          ? (this.petSpots || []).find((s) => s.tableId === g.tableId) : null;
        const away = petIsAway(g);
        // 店の外（歩道）かどうかは z で判定：奧行の半分より南は歩道
        const outside = away && g.petZ > this.plan.depth / 2;
        for (let i = 0; i < rec.pets.length; i++) {
          const pet = rec.pets[i];
          if (away) {
            const baseY = outside ? this.sidewalkY : gy + this.floorY;
            // 遊んでいる間は小さく跳ねる（走り回って見えるように）
            const hop = g.petState === 'play' ? Math.abs(Math.sin(this._clock * 6 + i * 1.3)) * 0.12 : 0;
            pet.position.set(g.petX + (i - 0.5) * 0.3, baseY + hop, g.petZ);
            pet.rotation.y = this._petYaw(pet, Number.isFinite(g.petDir) ? g.petDir : 0);
          } else if (spot) {
            pet.position.set(spot.x + (i - 0.5) * 0.4, gy + this.floorY + spot.y + 0.01, spot.z);
            pet.rotation.y = Math.PI;                     // 面向桌子
          } else {
            pet.position.set(lead.x + 0.55, gy + this.floorY, lead.z + 0.35);
            pet.rotation.y = (lead.ry || 0) + Math.PI * 0.5;
          }
          pet.visible = g.state !== 'gone';
        }
      }
    }
    // 清理已離店的組
    for (const [id, rec] of this.groupMeshes) {
      if (seen.has(id)) continue;
      for (const m of rec.meshes) {
        this.root.remove(m);
        // billboard の接地影は root 直下にあるので一緒に片付ける
        const sh = m.userData && m.userData.shadow;
        if (sh) {
          this.root.remove(sh);
          sh.geometry?.dispose?.();
        }
        try { Chars.disposeCharacter?.(m); } catch { /* ignore */ }
      }
      for (const p of (rec.pets || [])) this.root.remove(p);
      this.groupMeshes.delete(id);
    }
    void dt;
  }

  _onTatami(g, mem) {
    const t = this.plan.tatami;
    return mem.x > t.x - t.w / 2 && mem.x < t.x + t.w / 2 && mem.z > t.z - t.d / 2 && mem.z < t.z + t.d / 2;
  }

  /** ペットの向き：進行方向へゆっくり回す（±π をまたぐ時に逆回りしない） */
  _petYaw(pet, dir) {
    let d = (dir - pet.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return pet.rotation.y + d * 0.25;
  }

  /**
   * ペットスペースの動き：遊んでいるペットがいれば、そのそばでボールを転がす。
   * 動きは時計（this._clock）だけから決まるので、同じフレームなら同じ絵になる。
   */
  syncPetArea(state) {
    const ball = this.petAreaBall;
    if (!ball) return;
    let host = null;
    for (const g of (state.groups || [])) {
      if (g.pet && g.petState === 'play' && Number.isFinite(g.petX) && Number.isFinite(g.petZ)) { host = g; break; }
    }
    if (!host) { ball.visible = false; return; }     // 遊んでいるペットがいなければ隠す
    const a = this.petArea;
    const t = this._clock;
    const r = a ? Math.min(a.w, a.d) * 0.3 : 0.4;
    let x = host.petX - Math.cos(t * 1.6) * r;
    let z = host.petZ + Math.sin(t * 1.6) * r;
    if (a) {                                          // ボールが柵の外へ転がらないように挾む
      x = Math.max(a.cx - a.w / 2 + 0.25, Math.min(a.cx + a.w / 2 - 0.25, x));
      z = Math.max(a.cz - a.d / 2 + 0.25, Math.min(a.cz + a.d / 2 - 0.25, z));
    }
    ball.visible = true;
    ball.position.set(x, this.sidewalkY + (ball.userData.radius || 0.11), z);
    ball.rotation.z = -t * 3.2;
  }

  /**
   * billboard スプライト（Cherish）の 1 フレーム更新。
   *   ・歩行：6 コマを位置＋時計から回す（同じ場所で止まらない）
   *   ・待機／着席：1 コマ目。着席は少し下げて座って見せる
   *   ・左右反転：進行方向とカメラの右方向の內積で決める（カメラが回っても自然）
   *   ・接地影：スプライトには影が無いので AO を敷く
   */
  _updateSheetActor(sp, mem, pose, baseY, idx) {
    const walking = pose === 'walk' || pose === 'carry';
    const seated = pose === 'sit' || pose === 'eat';
    const phase = Math.floor((mem.x + mem.z) * 3) + Math.floor(this._clock * 7) + idx;
    const frame = walking ? (phase % 6) : (seated ? 1 : 0);
    const ry = mem.ry || 0;
    // 進行方向（+Z が正面）とカメラの右方向から左右反転を決める
    let mirror = false;
    const cam = this.camera;
    if (cam) {
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const rx = cam.matrixWorld.elements[0];
      const rz = cam.matrixWorld.elements[2];
      mirror = (fx * rx + fz * rz) < 0;
    }
    setSheetFrame(sp, frame, mirror);
    const drop = seated ? 0.28 : 0;                 // 座っているときは少し沈める
    sp.position.set(mem.x, baseY - drop, mem.z);
    if (!sp.userData.shadow) {
      const sh = aoBlob(this.root, mem.x, baseY + 0.012, mem.z, 0.42, 0.24, 0.85);
      sh.userData.owner = sp;
      sp.userData.shadow = sh;
    } else {
      sp.userData.shadow.position.set(mem.x, baseY + 0.012, mem.z);
    }
  }

  /* ── 調理場的動態：爐火、蒸氣、調理中の標籤 ───────────────────── */

  /** 誰在煮什麼 → 寫進 label 的 canvas（內容沒變就不重畫） */
  _paintCookLabel(sprite, chef, idx) {
    const ud = sprite.userData;
    const first = chef.dishes[0];
    const key = `${chef.name}|${chef.phase}|${Math.round(chef.progress * 20)}|${(chef.dishes || []).map((d) => d.id).join(',')}`;
    if (ud.key === key) return;
    ud.key = key;
    const c = ud.cv.getContext('2d');
    const W = ud.cv.width, H = ud.cv.height;
    c.clearRect(0, 0, W, H);
    // 圓角底板
    const r = 16;
    c.fillStyle = 'rgba(18,16,14,0.82)';
    c.beginPath();
    c.moveTo(r, 2); c.lineTo(W - r, 2); c.quadraticCurveTo(W - 2, 2, W - 2, 2 + r);
    c.lineTo(W - 2, H - r - 8); c.quadraticCurveTo(W - 2, H - 8, W - r - 2, H - 8);
    c.lineTo(r, H - 8); c.quadraticCurveTo(2, H - 8, 2, H - r - 8); c.lineTo(2, 2 + r);
    c.quadraticCurveTo(2, 2, r, 2); c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,196,120,0.85)';
    c.lineWidth = 2; c.stroke();
    // 標題：料理人的名字
    c.fillStyle = '#ffd79a';
    c.font = 'bold 22px system-ui, sans-serif';
    c.fillText(`🍳 ${chef.name}`, 12, 30);
    // 菜名（沒有就寫等待中）
    c.fillStyle = '#f4efe6';
    c.font = 'bold 24px system-ui, sans-serif';
    const txt = first ? `${first.name}` : (chef.phase === 'walk' ? '爐へ移動中…' : '待機中');
    c.fillText(txt.length > 11 ? txt.slice(0, 11) + '…' : txt, 12, 60);
    if (first?.nameZh) {
      c.fillStyle = '#bdb4a4';
      c.font = '18px system-ui, sans-serif';
      c.fillText(first.nameZh, 160, 60);
    }
    // 進度條
    const bw = W - 24, bx = 12, by = H - 22;
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(bx, by, bw, 9);
    const pct = Math.max(0, Math.min(1, chef.progress));
    const g2 = c.createLinearGradient(bx, 0, bx + bw, 0);
    g2.addColorStop(0, '#ffb347'); g2.addColorStop(1, '#ffe08a');
    c.fillStyle = g2;
    c.fillRect(bx, by, bw * pct, 9);
    if (chef.dishes.length > 1) {
      c.fillStyle = '#e8d9bf';
      c.font = 'bold 17px system-ui, sans-serif';
      c.fillText(`他にも ${chef.dishes.length - 1} 品`, W - 108, 30);
    }
    ud.tex.needsUpdate = true;
    void idx;
  }

  /** 依 state 更新爐火／蒸氣／調理標籤；順便讓出餐口的燈亮一點 */
  syncCooking(state) {
    if (!this.cookFx) return;
    const chefs = (state.staff || []).filter((s) => s.role === 'chef' && s.pose === 'cook');
    const active = chefs.length;
    this._cookActive = active;
    const t = this._clock;

    for (let i = 0; i < this.burners.length; i++) {
      const b = this.burners[i];
      const on = i < active;                      // 一台爐子對一位廚師
      const flick = 0.72 + 0.28 * Math.sin(t * 9 + b.phase) + 0.12 * Math.sin(t * 23 + b.phase * 2);
      const target = on ? Math.max(0, flick) : 0;
      b.flame.material.opacity += (Math.min(1, target) - b.flame.material.opacity) * Math.min(1, 0.2);
      b.flame.scale.set(on ? 0.9 + 0.25 * flick : 0.01, on ? 0.85 + 0.5 * flick : 0.01, on ? 0.9 + 0.25 * flick : 0.01);
      b.glow.intensity += ((on ? 5.5 * flick : 0) - b.glow.intensity) * Math.min(1, 0.2);
      for (let s = 0; s < b.steam.length; s++) {
        const puff = b.steam[s];
        const speed = 0.34 + s * 0.05;
        const u = ((t * speed + s * 0.21 + b.phase * 0.1) % 1);
        puff.position.y = 1.02 + u * 0.95;
        puff.position.x = b.bx + Math.sin(u * 6 + s) * 0.1;
        puff.position.z = b.bz + Math.cos(u * 5 + s) * 0.07;
        const sc = (0.5 + u * 0.9) * (on ? 1 : 0.2);
        puff.scale.setScalar(sc);
        puff.material.opacity = on ? 0.26 * (1 - u) * (0.6 + 0.4 * Math.sin(t * 3 + s)) : 0;
      }
    }

    // 出餐口的燈：有菜在等就亮一點
    if (this.passLight) {
      const ready = (state.pass || []).length;
      this.passLight.intensity += ((ready ? 9 + Math.min(3, ready) : 5) - this.passLight.intensity) * 0.08;
    }

    // 每位正在料理的廚師頭上飄一個標籤
    const info = chefs.map((s) => {
      const task = s.taskId ? (state.tasks || []).find((k) => k.id === s.taskId) : null;
      const isCook = !!task && task.type === 'cook';
      const total = isCook ? (task.work || 0) : 0;
      return {
        name: s.name,
        floor: s.floor || 0,
        x: s.x ?? 0,
        z: s.z ?? 0,
        phase: isCook ? task.phase : 'idle',
        dishes: isCook ? (task.dishIds || []).map((id) => {
          const d = this._dishName(id);
          return d;
        }) : [],
        progress: isCook && total > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, task.workLeft) / total)) : 0
      };
    });
    for (let i = 0; i < this.cookLabels.length; i++) {
      const sp = this.cookLabels[i];
      const chef = info[i];
      if (!chef) { sp.visible = false; continue; }
      sp.visible = true;
      sp.position.set(chef.x, (chef.floor || 0) * this.FH + this.floorY + 2.15, chef.z);
      this._paintCookLabel(sp, chef, i);
    }
  }

  /** dishId → 菜名（標籤用；找不到就退回 id） */
  _dishName(id) {
    const d = dishById(id);
    return { id, name: d?.name || id, nameZh: d?.nameZh || '' };
  }

  /* ── 每幀更新 ───────────────────────────────────────────────── */

  update(dt, state, camera) {
    this._clock += dt;
    if (camera) this.camera = camera;
    if (state.menu) this._menuRef = state.menu;
    this.syncGroups(state, dt);
    this.syncPetArea(state);
    this.syncStaff(state);
    this.syncPass(state);
    this.syncDirtyTables(state);
    this.syncCooking(state);
    this.syncNoticeBoard(state, crowdInfo(state));

    // 夜晚：燈籠與店外光
    const night = state.__night ?? false;
    const glow = night ? 1 : 0;
    if (this.porchLight) this.porchLight.intensity = glow * 9;
    for (const p of this.lampPointers) {
      if (p.kind === 'streetlampPoint' && p.obj.isPointLight) {
        p.obj.intensity += (glow * 7 - p.obj.intensity) * 0.08;
        continue;
      }
      const emissiveBoost = p.kind === 'shoji' || p.kind === 'andon' || p.kind === 'lantern'
        || p.kind === 'vending' || p.kind === 'window' || p.kind === 'streetlamp' || p.kind === 'neon';
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
