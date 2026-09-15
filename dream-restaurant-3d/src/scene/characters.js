// ============================================================================
// characters.js — 程序化 3D 人物庫（夢幻西餐廳 3D）
//
//   * 只依賴 three 核心：無 addons、無外部資源、無網路、無圖檔
//     幾何全部程序化產生；表情用 32×26 的 CanvasTexture 點陣臉（模組內快取）
//   * 骨架（pivot 階層，靠旋轉做姿勢，不需 skinning）：
//       group
//        └ hips ── torso ── head
//                 ├ armL ─ elbowL ─ handL
//                 ├ armR ─ elbowR ─ handR
//                 ├ legL ─ kneeL ─ footL
//                 └ legR ─ kneeR ─ footR
//   * 身高：大人 1.55~1.85 m（約 7.5 頭身）、小孩 1.0~1.3 m
//   * 材質：MeshStandardMaterial / MeshPhysicalMaterial，模組層級快取 + 引用計數
//
//   用法：
//     const c = makeCharacter({ kind: 'office', seed: 12, height: 1.72 });
//     scene.add(c);
//     c.position.set(3, 0, -2);
//     setPose(c, 'sit', clock.elapsedTime);        // c.userData.seatHeight 可先指定
//     ...
//     disposeCharacter(c);                          // 釋放本角色擁有的 geometry/material
// ============================================================================
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   0. 小工具：PRNG、色彩、幾何快取
   ═══════════════════════════════════════════════════════════════════════════ */

// 自帶的 mulberry32：同一個 seed 永遠長出同一個人
function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(v) {
  if (typeof v === 'number' && isFinite(v)) return (v | 0) ^ 0x9e3779b9;
  const s = String(v == null ? 'dream-restaurant' : v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRand(seed) {
  const r = mulberry32(hashSeed(seed));
  return {
    f: r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))],
    chance: (p) => r() < p,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function hexLerp(a, b, t) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  ca.lerp(cb, clamp(t, 0, 1));
  return '#' + ca.getHexString();
}
const shade = (hex, amt) =>
  hexLerp(hex, amt >= 0 ? '#ffffff' : '#000000', Math.abs(amt));
// 給 canvas 用的半透明色（#rrggbb + alpha → rgba()）
function hexA(hex, a) {
  const c = new THREE.Color(hex);
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + clamp(a, 0, 1).toFixed(3) + ')';
}

/* ── 幾何快取（同參數共用一個 BufferGeometry；disposeCharacter 模組共用不釋放） ── */
const _geoCache = new Map();
function cachedGeo(key, factory) {
  let g = _geoCache.get(key);
  if (!g) {
    g = factory();
    g.userData.__cacheKey = key;
    _geoCache.set(key, g);
  }
  return g;
}
function createBox(w, h, d) {
  return cachedGeo('B' + w + '_' + h + '_' + d, () => new THREE.BoxGeometry(w, h, d));
}
function createSphere(r, wSeg = 10, hSeg = 7) {
  return cachedGeo('S' + r + '_' + wSeg + '_' + hSeg, () => new THREE.SphereGeometry(r, wSeg, hSeg));
}
// 局部球殼（頭髮／後腦勺用）；phiStart 可把缺口轉到後方
function createShell(r, thetaLength, phiStart, phiLength, wSeg, hSeg) {
  return cachedGeo(
    'H' + r + '_' + thetaLength + '_' + phiStart + '_' + phiLength + '_' + wSeg + '_' + hSeg,
    () => new THREE.SphereGeometry(r, wSeg, hSeg, phiStart, phiLength, 0, thetaLength)
  );
}
// 圓柱／圓錐台（可做四肢的收束感）
function createCyl(rt, rb, h, seg = 8, open = false) {
  return cachedGeo('C' + rt + '_' + rb + '_' + h + '_' + seg + '_' + (open ? 1 : 0),
    () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}
// 膠囊：length 是圓柱段長，總長 = length + 2r，頂端（+y）離原點 length/2 + r
function createCapsule(r, len, capSeg = 3, radial = 8) {
  return cachedGeo('K' + r + '_' + len + '_' + capSeg + '_' + radial,
    () => new THREE.CapsuleGeometry(r, len, capSeg, radial));
}
function createTorus(r, tube, rSeg = 8, tSeg = 12) {
  return cachedGeo('T' + r + '_' + tube + '_' + rSeg + '_' + tSeg, () => new THREE.TorusGeometry(r, tube, rSeg, tSeg));
}

/* ── 建立 mesh：一律投影陰影、可接收陰影 ── */
function mesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function pivot(x, y, z, parent) {
  const o = new THREE.Object3D();
  o.position.set(x || 0, y || 0, z || 0);
  if (parent) parent.add(o);
  return o;
}
// 四肢：從 pivot（關節）往下長的圓柱段，頂端剛好貼在關節上
function limbMesh(parent, geoTopOffset, geo, mat, sx, sz) {
  const m = mesh(geo, mat, 0, -geoTopOffset, 0, parent);
  m.scale.set(sx || 1, 1, sz || 1);
  return m;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. 材質快取（key = 顏色 + 參數）
   ═══════════════════════════════════════════════════════════════════════════ */
const _geomRef = new Map();   // geometry -> 建立次數（共用快取，最後一個使用者負責釋放）
const _matCache = new Map();  // key -> { mat, refs }
const _charTex = new Map();   // 臉部貼圖 key -> { key, tex, refs }
let _charId = 0;

function cachedMat(key, factory) {
  let e = _matCache.get(key);
  if (!e) {
    e = { _key: key, mat: factory(), refs: 0 };
    _matCache.set(key, e);
  }
  e.refs++;
  return e.mat;
}
function matRef(m) {
  for (const e of _matCache.values()) if (e.mat === m) return e;
  return null;
}
function stdMat(color, o) {
  const p = o || {};
  const rough = p.roughness == null ? 0.78 : p.roughness;
  const metal = p.metalness == null ? 0.0 : p.metalness;
  const flat = !!p.flat;
  const key = 'std|' + color + '|' + rough + '|' + metal + '|' + (flat ? 1 : 0);
  return cachedMat(key, () => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, flatShading: flat,
  }));
}
function physMat(color, o) {
  const p = o || {};
  const rough = p.roughness == null ? 0.5 : p.roughness;
  const metal = p.metalness == null ? 0.05 : p.metalness;
  const clear = p.clearcoat == null ? 0.25 : p.clearcoat;
  const sheen = p.sheen == null ? 0.0 : p.sheen;
  const key = 'phy|' + color + '|' + rough + '|' + metal + '|' + clear + '|' + sheen;
  return cachedMat(key, () => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal, clearcoat: clear,
      clearcoatRoughness: 0.35,
    });
    if (sheen > 0) { m.sheen = sheen; m.sheenColor = new THREE.Color('#ffffff'); }
    return m;
  });
}
function faceMatOf(tex) {
  const key = 'face|' + tex.uuid;
  return cachedMat(key, () => new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -1.0,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. 程序化臉部貼圖（CanvasTexture，僅在可建立 canvas 時）
   ═══════════════════════════════════════════════════════════════════════════ */
const FACE_W = 32;
const FACE_H = 26;
const FACE_ASPECT = FACE_W / FACE_H;
// 臉部貼圖的超取樣倍率：實際畫布是 128×104，畫完再縮回 32×26
// （刻意用「實際尺寸畫布 + 座標乘 SS」而不是 ctx.setTransform：後者在部分
//   無頭瀏覽器的 2D canvas 上會把 arc/ellipse/clip 畫歪）
const FACE_SS = 4;

function canUseCanvas() {
  return typeof document !== 'undefined' && !!document.createElement;
}

/* 臉部繪製小工具（全部以 32×26 的「臉座標」為單位；實作在 FACE_SS 倍解析度畫布上，最後縮回去）
   目的：同樣是程序產生、同樣是 32×26 的 CanvasTexture，但五官可以畫得柔軟、有層次。
   ─ eye()   ：縱長杏眼的動畫眼（上眼線／虹膜漸層／眼神光／上眼瞼陰影／下睫毛）
   ─ brow()  ：細而有角度的眉（角度由表情決定；老人較低較細）
   ─ mouth() ：閉嘴微笑／開口笑（牙齒）／生氣咬牙
   ─ blush() ：臉頰腮紅（放射狀漸層、極淡） */
function facePainter(f, palette) {
  const { skinLight, line, irisBase, lipCol } = palette;
  const SS = FACE_SS;
  const S = (v) => v * SS;
  const ink = (a) => hexA(line, a);

  const ellipse = (cx, cy, rx, ry, col) => {
    f.fillStyle = col;
    f.beginPath();
    f.ellipse(S(cx), S(cy), S(Math.max(rx, 0.04)), S(Math.max(ry, 0.04)), 0, 0, Math.PI * 2);
    f.fill();
  };
  const path = (col, pts, close) => {
    f.fillStyle = col;
    f.beginPath();
    f.moveTo(S(pts[0][0]), S(pts[0][1]));
    for (let i = 1; i < pts.length; i++) f.lineTo(S(pts[i][0]), S(pts[i][1]));
    if (close !== false) f.closePath();
    f.fill();
  };
  const curve = (pts) => {
    f.beginPath();
    f.moveTo(S(pts[0][0]), S(pts[0][1]));
    for (let i = 1; i + 2 < pts.length; i += 3) f.bezierCurveTo(S(pts[i][0]), S(pts[i][1]), S(pts[i + 1][0]), S(pts[i + 1][1]), S(pts[i + 2][0]), S(pts[i + 2][1]));
  };
  const stroke = (w, col, cap) => {
    f.lineWidth = S(w);
    f.strokeStyle = col;
    f.lineCap = cap || 'round';
    f.lineJoin = 'round';
    f.stroke();
  };
  const grad = (x0, y0, x1, y1) => f.createLinearGradient(S(x0), S(y0), S(x1), S(y1));

  // 虹膜：外圈較深 → 底部透光，兩層（上暗下亮）做出動畫眼睛的通透感
  function iris(cx, cy, top, bot, w, h) {
    const outline = () => {
      f.beginPath();
      f.ellipse(S(cx), S(cy), S(w * 0.5), S(h * 0.5), 0, 0, Math.PI * 2);
    };
    f.save();
    outline();
    f.clip();
    f.fillStyle = irisBase;
    f.fillRect(S(cx - w), S(cy - h), S(w * 2), S(h * 2));
    const g = grad(cx, top, cx, bot);
    g.addColorStop(0, hexA(irisBase, 0.55));
    g.addColorStop(0.52, hexA(irisBase, 0));
    g.addColorStop(1, 'rgba(255,255,255,0.60)');
    f.fillStyle = g;
    f.fillRect(S(cx - w), S(cy - h), S(w * 2), S(h * 2));
    f.restore();
    // 深色外圍（不要用純黑：用比虹膜更深的同色系）
    outline();
    stroke(0.26, hexLerp(irisBase, '#1a1420', 0.5));
    ellipse(cx, cy, w * 0.30, h * 0.31, hexA('#241c26', 0.26));   // 瞳孔（深紫褐，不是黑）
    ellipse(cx - w * 0.15, cy - h * 0.21, w * 0.17, h * 0.19, 'rgba(255,255,255,0.96)');  // 主眼神光
    ellipse(cx + w * 0.17, cy + h * 0.17, w * 0.085, h * 0.10, 'rgba(255,255,255,0.80)'); // 小亮點
  }

  // 單眼。side: +1 = 畫面左眼、-1 = 畫面右眼（內眼角／外眼角方向）
  function eye(cx, cy, w, h, side, o) {
    const opt = o || {};
    const rx = w * 0.5;
    const sharp = opt.sharp == null ? 0.2 : opt.sharp;
    const eyePath = () => {
      f.beginPath();
      f.moveTo(S(cx + side * rx * (1 - sharp * 0.35)), S(cy - h * 0.03));
      f.bezierCurveTo(S(cx + side * rx * 0.42), S(cy - h * 0.50), S(cx - side * rx * 0.30), S(cy - h * 0.52), S(cx - side * rx), S(cy - h * 0.26));
      f.bezierCurveTo(S(cx - side * rx * 0.50), S(cy + h * 0.26), S(cx + side * rx * 0.28), S(cy + h * 0.50), S(cx + side * rx), S(cy + h * 0.24));
      f.closePath();
    };
    f.save();
    eyePath();
    f.fillStyle = opt.sclera || '#fdf8f4';
    f.fill();
    f.clip();
    const ix = cx + side * w * 0.02;
    iris(ix, cy + h * 0.01, cy - h * 0.55, cy + h * 0.55, w * 0.62, h * 0.90);
    // 上眼瞼陰影：蓋在眼珠上方，眼睛才有深度
    const sh = grad(cx, cy - h * 0.52, cx, cy + h * 0.06);
    sh.addColorStop(0, hexA(line, 0.34));
    sh.addColorStop(1, hexA(line, 0));
    f.fillStyle = sh;
    f.fillRect(S(cx - w), S(cy - h), S(w * 2), S(h * 2));
    f.restore();
    // 上眼線（外眼角變細、內眼角收尖）
    eyePath();
    stroke(0.30, hexA(line, 0.95), 'round');
    flick(cx, cy, w, h, side);
    // 下眼線：很細、只落在中段
    f.beginPath();
    f.moveTo(S(cx + side * rx * 0.30), S(cy + h * 0.45));
    f.bezierCurveTo(S(cx - side * rx * 0.12), S(cy + h * 0.48), S(cx - side * rx * 0.40), S(cy + h * 0.38), S(cx - side * rx * 0.70), S(cy + h * 0.16));
    stroke(0.10, hexA(line, 0.15), 'round');
    // 女性化的下睫毛：外眼角一撮短短的
    if (opt.lashes) {
      f.beginPath();
      f.moveTo(S(cx + side * rx * 0.80), S(cy + h * 0.06));
      f.lineTo(S(cx + side * rx * 1.14), S(cy - h * 0.20));
      stroke(0.14, hexA(line, 0.45), 'round');
      f.beginPath();
      f.moveTo(S(cx + side * rx * 0.52), S(cy + h * 0.40));
      f.lineTo(S(cx + side * rx * 0.74), S(cy + h * 0.20));
      stroke(0.12, hexA(line, 0.35), 'round');
    }
  }

  // 外眼角那一撇睫毛（所有角色都有，短而柔）
  function flick(cx, cy, w, h, side) {
    f.beginPath();
    f.moveTo(S(cx + side * w * 0.42), S(cy - h * 0.22));
    f.lineTo(S(cx + side * w * 0.62), S(cy - h * 0.44));
    stroke(0.22, hexA(line, 0.88), 'round');
  }

  // 眉：pos = 眉尾（外側）比眉頭高的量（+ 上揚、- 下垂）；pos 為 null → 生氣眉（內低外高）
  function brow(cx, cy, w, tilt, col, pos) {
    const half = w * 0.5;
    const inner = cx - tilt * half;              // 靠近鼻子的那一端
    const outer = cx + tilt * half;
    const ix = inner, ox = outer;
    const iy = cy + (pos == null ? 0.30 : -pos * 0.5);
    const oy = cy + (pos == null ? -0.64 : pos * 0.5);
    const c1x = cx - tilt * w * 0.16, c1y = iy + (oy - iy) * 0.30 - 0.34;
    const c2x = cx + tilt * w * 0.20, c2y = oy + (iy - oy) * 0.25 - 0.26;
    const tip = w * 0.17;
    curve([[ix, iy], [c1x, c1y], [c2x, c2y], [ox - tilt * tip, oy]]);
    stroke(0.78, hexA(col, 1), 'round');
    curve([[ix + w * 0.04, iy - 0.06],
      [c1x + w * 0.03, c1y - 0.06], [c2x + w * 0.02, c2y - 0.06], [ox - tilt * tip * 1.1, oy - 0.03]]);
    stroke(0.34, hexA(col, 0.95), 'round');
  }

  // 嘴：mode = 'smile' 閉嘴微笑／'open' 開口笑／'grit' 生氣咬牙
  function mouth(mx, my, w, mode) {
    const half = w * 0.5;
    if (mode === 'open') {
      // 開口笑：上緣是唇線、下緣是圓弧（D 字），裡面露齒＋舌
      f.beginPath();
      f.moveTo(S(mx - half), S(my - 0.10));
      f.bezierCurveTo(S(mx - w * 0.52), S(my + 1.75), S(mx + w * 0.52), S(my + 1.75), S(mx + half), S(my - 0.10));
      f.closePath();
      f.fillStyle = '#4b2328';
      f.fill();
      stroke(0.26, hexA(line, 0.72), 'round');
      f.save();
      f.beginPath();
      f.moveTo(S(mx - half), S(my - 0.10));
      f.bezierCurveTo(S(mx - w * 0.52), S(my + 1.75), S(mx + w * 0.52), S(my + 1.75), S(mx + half), S(my - 0.10));
      f.closePath();
      f.clip();
      f.fillStyle = '#fdf8f2';
      f.fillRect(S(mx - w), S(my - 0.18), S(w * 2), S(0.92));
      ellipse(mx, my + w * 0.40, w * 0.20, w * 0.15, '#c9615f');   // 舌
      f.restore();
      ellipse(mx, my + w * 0.28, w * 0.20, w * 0.08, hexA('#5c2b30', 0.5));
    } else if (mode === 'grit') {
      // 生氣咬牙：深色嘴縫＋上排牙齒，下唇壓一條深色線
      path('#4a2429', [[mx - half * 0.95, my - 0.10], [mx + half * 0.95, my + 0.12],
        [mx + half * 0.95, my + 1.02], [mx - half * 0.95, my + 0.78]]);
      stroke(0.14, '#fdf8f4', 'butt');
      f.beginPath();
      f.moveTo(S(mx - half * 0.9), S(my + 0.46));
      f.bezierCurveTo(S(mx - w * 0.16), S(my + 0.66), S(mx + w * 0.16), S(my + 0.70), S(mx + half * 0.9), S(my + 0.50));
      stroke(0.22, hexA(line, 0.85), 'round');
      f.beginPath();
      f.moveTo(S(mx - half * 0.92), S(my + 1.12));
      f.bezierCurveTo(S(mx - w * 0.14), S(my + 1.52), S(mx + w * 0.16), S(my + 1.42), S(mx + half * 0.92), S(my + 0.86));
      stroke(0.36, hexLerp(lipCol, '#000000', 0.3), 'round');
    } else {
      // 閉嘴微笑：唇形＋唇線＋一點下唇亮面
      const dip = 0.30;
      f.beginPath();
      f.moveTo(S(mx - half), S(my));
      f.bezierCurveTo(S(mx - w * 0.28), S(my + dip), S(mx + w * 0.28), S(my + dip), S(mx + half), S(my));
      f.bezierCurveTo(S(mx + w * 0.24), S(my + dip + 1.15), S(mx - w * 0.24), S(my + dip + 1.15), S(mx - half), S(my));
      f.closePath();
      f.fillStyle = lipCol;
      f.fill();
      f.beginPath();
      f.moveTo(S(mx - half), S(my));
      f.bezierCurveTo(S(mx - w * 0.28), S(my + dip), S(mx + w * 0.28), S(my + dip), S(mx + half), S(my));
      stroke(0.28, hexA(hexLerp(lipCol, '#5c2b30', 0.38), 0.95), 'round');
      f.beginPath();
      f.moveTo(S(mx - w * 0.26), S(my + dip + 0.52));
      f.bezierCurveTo(S(mx - w * 0.09), S(my + dip + 0.95), S(mx + w * 0.09), S(my + dip + 0.95), S(mx + w * 0.26), S(my + dip + 0.52));
      stroke(0.16, hexA(hexLerp(lipCol, '#ffffff', 0.5), 0.5), 'round');
    }
  }

  function blush(cx, cy, rx, ry, a) {
    const k = a == null ? 1 : a;
    const g = f.createRadialGradient(S(cx), S(cy), 0, S(cx), S(cy), S(Math.max(rx, ry)));
    g.addColorStop(0, 'rgba(232,124,120,' + (0.30 * k).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(232,124,120,' + (0.13 * k).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(232,124,120,0)');
    f.fillStyle = g;
    f.beginPath();
    f.ellipse(S(cx), S(cy), S(rx), S(ry), 0, 0, Math.PI * 2);
    f.fill();
  }

  return { ellipse, path, curve, stroke, eye, brow, mouth, blush };
}

function buildFaceCanvas(kind, expression, look) {
  const SS = FACE_SS;                                // 超取樣倍率（臉座標 × SS = 實際畫布）
  const cv = document.createElement('canvas');
  cv.width = FACE_W * SS;                            // 實際畫布 128×104，最後縮回 32×26
  cv.height = FACE_H * SS;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const skin = look.skin || '#f6d9bf';
  const age = look.age || 0;
  const child = age < 0.18;
  const baby = age < 0.1;
  const old = age > 0.78;

  const angry = expression === 'angry';
  const happy = expression === 'happy';

  // 顏料：全部由 look 既有的欄位推導（膚色／髮色），沒給就退回合理預設
  const hairTone = look.hairTone || '#3a2a1e';
  const skinLight = hexLerp(skin, '#fff4e8', 0.06);  // 只提亮一點：臉是貼圖，本來就比素體亮
  const line = hexLerp(hexLerp(skin, '#4a2f28', 0.72), hairTone, 0.34);     // 線畫色（暖褐，不是純黑）
  const browCol = look.browCol || hexLerp(hairTone, '#000000', 0.1);
  const irisBase = hexLerp(hairTone, '#6f5a8c', 0.55);                      // 虹膜：深而不死黑
  const lipCol = old ? hexLerp(skin, '#a06a63', 0.44) : hexLerp(skin, '#c9605f', 0.46);
  const sclera = hexLerp('#ffffff', skin, 0.06);

  // 角色編號：只用來決定眉型／嘴角等「個性」，不會讓五官走位
  const keyStr = [skin, age.toFixed(2), hairTone, browCol, look.skirt ? 'f' : 'm', look.hair || ''].join('~');
  const rnd = makeRand('face:' + keyStr);
  const browTilt = rnd.range(0.88, 1.12);            // 眉的傾斜（>1 = 八字眉、<1 = 劍眉）
  const lipW = rnd.range(0.94, 1.06);
  const cheekT = rnd.range(0.9, 1.1);

  // 女性化的下睫毛：只依賴 look 已經有的欄位（裙裝／長髮），沒有就中性處理
  const hs = look.hair;
  const feminine = !!look.skirt || (look.skirt == null && (hs === 'long' || hs === 'ponytail'));

  const p = facePainter(ctx, { skinLight, line, irisBase, lipCol });

  const mx = FACE_W / 2;
  const ex = FACE_W * 0.252;                         // 眼中心（左右對稱）
  const ey = FACE_H * 0.405;                         // 眼睛位置：比舊版高一點，臉頰留白更好看
  const eyeW = (6.4 + (baby ? 0.9 : child ? 0.5 : 0) - age * 0.5) * (feminine ? 1.05 : 1);
  const eyeH = (7.6 + (baby ? 1.5 : child ? 0.9 : 0) - age * 0.9) * (feminine ? 1.04 : 1);

  // 0 × 0 → 以下全部用「臉座標 × SS」直接畫在 128×104 上（不用 ctx transform）
  const S = (v) => v * SS;
  ctx.clearRect(0, 0, cv.width, cv.height);

  // 1) 臉型：蜜桃形（上寬下窄）＋ 邊緣通透，貼在頭球上不會出現方形色塊
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(S(mx), S(FACE_H * 0.075));
  ctx.bezierCurveTo(S(FACE_W * 0.83), S(FACE_H * 0.095), S(FACE_W * 0.94), S(FACE_H * 0.42), S(FACE_W * 0.845), S(FACE_H * 0.625));
  ctx.bezierCurveTo(S(FACE_W * 0.76), S(FACE_H * 0.865), S(FACE_W * 0.63), S(FACE_H * 0.99), S(mx), S(FACE_H * 0.99));
  ctx.bezierCurveTo(S(FACE_W * 0.37), S(FACE_H * 0.99), S(FACE_W * 0.24), S(FACE_H * 0.865), S(FACE_W * 0.155), S(FACE_H * 0.625));
  ctx.bezierCurveTo(S(FACE_W * 0.06), S(FACE_H * 0.42), S(FACE_W * 0.17), S(FACE_H * 0.095), S(mx), S(FACE_H * 0.075));
  ctx.closePath();
  ctx.clip();

  // 底色：比素體膚色稍亮（臉是貼圖，沒有吃頭部的光照）
  ctx.fillStyle = skinLight;
  ctx.fillRect(0, 0, cv.width, cv.height);

  // 額頭亮部／下半臉暗部／下頜收暗
  let g = ctx.createLinearGradient(0, S(FACE_H * 0.06), 0, S(FACE_H * 0.62));
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, S(FACE_H * 0.7));
  g = ctx.createLinearGradient(0, S(FACE_H * 0.58), 0, S(FACE_H));
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(96,54,44,0.20)');
  ctx.fillStyle = g;
  ctx.fillRect(0, S(FACE_H * 0.5), cv.width, S(FACE_H * 0.5));
  g = ctx.createRadialGradient(S(mx), S(FACE_H * 0.86), 0, S(mx), S(FACE_H * 0.86), S(FACE_W * 0.55));
  g.addColorStop(0, 'rgba(150,90,70,0.13)');
  g.addColorStop(1, 'rgba(150,90,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, S(FACE_H * 0.4), cv.width, S(FACE_H * 0.6));

  // 2) 眼睛（先畫眼、再畫眉，眉毛不會被眼線壓到）
  p.eye(mx - ex, ey, eyeW, eyeH, +1, { lashes: feminine && !old, sclera });
  p.eye(mx + ex, ey, eyeW, eyeH, -1, { lashes: feminine && !old, sclera });

  // 3) 眉：neutral 平順、happy 抬高、angry 內低外高（八字壓下來）
  const by = ey - eyeH * 0.5 - (baby ? 1.55 : child ? 1.45 : 1.25) - (old ? -0.15 : 0);
  const browW = (5.4 + (child ? 0.4 : 0) - age * 0.35) * (feminine ? 0.95 : 1.05);
  if (angry) p.brow(mx - ex, by + 0.25, browW, browTilt, browCol, null);
  else if (happy) p.brow(mx - ex, by - 1.05, browW, browTilt * 1.05, browCol, 0.55);
  else p.brow(mx - ex, by, browW, browTilt, browCol, old ? 0.04 : 0.30);
  if (angry) p.brow(mx + ex, by + 0.25, browW, -browTilt, browCol, null);
  else if (happy) p.brow(mx + ex, by - 1.05, browW, -browTilt * 1.05, browCol, -0.55);
  else p.brow(mx + ex, by, browW, -browTilt, browCol, old ? -0.04 : -0.30);

  // 4) 鼻：只是一個小陰影＋一點高光
  p.ellipse(mx + 0.05, FACE_H * 0.575, 0.78, 0.55, hexA(line, 0.20));
  p.ellipse(mx - 0.02, FACE_H * 0.568, 0.26, 0.20, 'rgba(255,255,255,0.35)');
  p.ellipse(mx - 0.85, FACE_H * 0.592, 0.15, 0.11, hexA(line, 0.12));
  p.ellipse(mx + 0.95, FACE_H * 0.592, 0.15, 0.11, hexA(line, 0.12));

  // 5) 嘴
  const mouthY = FACE_H * 0.765;
  const mw = (child ? 5.6 : 6.2) * lipW;
  p.mouth(mx, mouthY, mw, angry ? 'grit' : happy ? 'open' : 'smile');

  // 6) 腮紅：極淡的放射漸層（年輕角色）
  if (age < 0.55) {
    const a = 0.5 + (0.55 - age) * 0.9;
    p.blush(mx - ex - 0.35, ey + FACE_H * 0.115, 2.5 * cheekT, 2.0, a);
    p.blush(mx + ex + 0.35, ey + FACE_H * 0.115, 2.5 * cheekT, 2.0, a);
  }
  // 年長者：法令紋／額紋／眼尾紋，淡淡幾筆
  if (old) {
    const wr = hexA(line, 0.15);
    p.curve([[mx - 3.4, FACE_H * 0.60], [mx - 2.4, FACE_H * 0.68], [mx - 1.9, FACE_H * 0.77]]);
    p.stroke(0.16, wr, 'round');
    p.curve([[mx + 3.4, FACE_H * 0.60], [mx + 2.4, FACE_H * 0.68], [mx + 1.9, FACE_H * 0.77]]);
    p.stroke(0.16, wr, 'round');
    p.curve([[mx - 2.6, FACE_H * 0.14], [mx - 1.2, FACE_H * 0.115], [mx + 0.2, FACE_H * 0.135]]);
    p.stroke(0.14, hexA(line, 0.11), 'round');
    p.curve([[mx - 1.0, FACE_H * 0.185], [mx + 0.4, FACE_H * 0.165], [mx + 1.8, FACE_H * 0.185]]);
    p.stroke(0.14, hexA(line, 0.10), 'round');
    p.curve([[mx - ex - 1.5, ey - 0.15], [mx - ex - 2.3, ey + 0.05], [mx - ex - 2.5, ey + 0.45]]);
    p.stroke(0.14, wr, 'round');
    p.curve([[mx + ex + 1.5, ey - 0.15], [mx + ex + 2.3, ey + 0.05], [mx + ex + 2.5, ey + 0.45]]);
    p.stroke(0.14, wr, 'round');
  }
  ctx.restore();

  // 7) 縮回 32×26（超取樣的細節都靠這一步的濾波平滑掉）
  return downscaleFace(cv);
}

// 把 SS 倍畫布縮回 FACE_W×FACE_H（透明像素要先清乾淨，不能留超取樣的方塊）
function downscaleFace(big) {
  const out = document.createElement('canvas');
  out.width = FACE_W;
  out.height = FACE_H;
  const c = out.getContext('2d');
  if (!c) return big;
  c.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
  c.clearRect(0, 0, FACE_W, FACE_H);
  c.drawImage(big, 0, 0, big.width, big.height, 0, 0, FACE_W, FACE_H);
  return out;
}

function faceTexture(faceKey, expression, look) {
  const key = faceKey + '|' + expression;
  let e = _charTex.get(key);
  if (!e) {
    const canvas = buildFaceCanvas('', expression, look);
    if (!canvas) return null;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // 臉是手繪感的柔邊五官，用線性放大（nearest 會讓 32×26 的貼圖變成黑塊）
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    e = { key, tex, refs: 0 };
    _charTex.set(key, e);
  }
  e.refs++;
  return e.tex;
}
function faceTexEntry(tex) {
  for (const e of _charTex.values()) if (e.tex === tex) return e;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. 角色資料表（色票、體型、配件）
   ═══════════════════════════════════════════════════════════════════════════ */
const SKIN_TONES = ['#f6d9bf', '#efc9a4', '#e3b48d', '#d3a279', '#c08a5f', '#f2d3ba'];

const HAIR_TONES = {
  black: '#1d1a18',
  brown: '#3a2a1e',
  dkbrown: '#2a1e16',
  grey: '#8e8a86',
  white: '#d5d1c9',
};

// 大人 1.55~1.85 m（約 7.5 頭身）；小孩 1.0~1.3 m
export const CUSTOMER_KINDS = [
  'office',   // 上班族：西裝 + 公事包
  'student',  // 學生：制服 + 後背包
  'tourist',  // 觀光客：便服 + 相機 + 背包
  'family',   // 家庭：大人或小孩
  'couple',   // 情侶：時髦便服
  'elder',    // 長者：開襟衫 + 拐杖
  'party',    // 聚餐團：喜氣便服
  'regular',  // 常連さん：休閒便服 + 開襟外套
  'solo',     // おひとり様：簡潔便服 + 手提包
  'business', // 接待：深色西裝 + 領帶 + 公事包
  'influencer', // SNS 投稿客：時髦穿搭 + 相機
  'chefguest', // 同業の料理人：白シャツ＋腰圍裙（休日の料理人）
  'club',     // 部活帰り：運動部ジャージ + 大背包
  'nightworker', // 夜勤明け：マスク + ジャケット
  'petlover',
  'actor',
  'celebrity',
  'tvcrew',
  'chef',     // 廚師：白袍 + 圍裙 + 廚師帽
  'waiter',   // 服務生：黑背心 + 白襯衫 + 圍裙
];

const OUT_FITS = {
  office: { shirt: ['#eef1f4', '#f5f6f8', '#dfe6ee', '#e8e2d4'], shirtStyle: 'button', bottom: ['#232a38', '#2c3140', '#3a3a44'] },
  student: { shirt: ['#ffffff', '#f2f5ff'], shirtStyle: 'button', bottom: ['#31384a', '#2a3040'] },
  tourist: { shirt: ['#e06a4c', '#3f7fb8', '#5aa17a', '#f0f0ef', '#e8c04a'], shirtStyle: 'tee', bottom: ['#4a5266', '#6b6250', '#3b4a5a'] },
  family: { shirt: ['#f2f0ec', '#7fb2d8', '#e8a0b4', '#86b98d'], shirtStyle: 'tee', bottom: ['#5b6472', '#8d7a63'] },
  couple: { shirt: ['#2b2b33', '#b0405a', '#f0e6da', '#5b6f9c'], shirtStyle: 'nice', bottom: ['#2b2b33', '#3c4459', '#8a7f70'] },
  elder: { shirt: ['#b9a98f', '#9aa7a0', '#c6bba6', '#8f8b84'], shirtStyle: 'cardigan', bottom: ['#4a4a4e', '#5c5346'] },
  party: { shirt: ['#d94f5c', '#f2c23a', '#3fa08a', '#e8783c'], shirtStyle: 'festive', bottom: ['#33333a', '#4a3b52'] },
  regular: { shirt: ['#6b7f6a', '#8a6a4a', '#4a5a72', '#a08a6a'], shirtStyle: 'cardigan', bottom: ['#4a4a4e', '#5c5346', '#3f4a56'] },
  solo: { shirt: ['#e8e4dc', '#5f7a8a', '#8a7f9a', '#c9b8a0'], shirtStyle: 'tee', bottom: ['#3f4550', '#5a5044'] },
  business: { shirt: ['#f2f4f7', '#e8ecf2'], shirtStyle: 'button', bottom: ['#1b2130', '#232838'] },
  influencer: { shirt: ['#f0d0e0', '#e8e0f0', '#f2e2c0', '#d8e8f0'], shirtStyle: 'nice', bottom: ['#33333f', '#4a4257', '#2f3a44'] },
  chefguest: { shirt: ['#f4f4f0', '#e8e4dc'], shirtStyle: 'chef', bottom: ['#2f3238', '#3b3f47'] },
  club: { shirt: ['#2f5f9a', '#c0392b', '#2f7d4f', '#e0a020'], shirtStyle: 'tee', bottom: ['#2a3040', '#33384a'] },
  nightworker: { shirt: ['#4a5266', '#6b6250', '#3b4a5a'], shirtStyle: 'cardigan', bottom: ['#2b2f38', '#3a3a44'] },
  petlover: { shirt: ['#7fb2d8', '#86b98d', '#e8c04a', '#e8a0b4'], shirtStyle: 'tee', bottom: ['#4a5266', '#6b6250'] },
  actor: { shirt: ['#22242c', '#3b3f4a', '#efece4'], shirtStyle: 'nice', bottom: ['#1e2028', '#2b2f3a'] },
  celebrity: { shirt: ['#e8578a', '#f2c23a', '#7a4a8a', '#39c0c0'], shirtStyle: 'festive', bottom: ['#2a2a34', '#4a4257'] },
  tvcrew: { shirt: ['#2f3a4a', '#3f4a5a', '#5a5f52'], shirtStyle: 'tee', bottom: ['#2b2f38', '#3a3a44'] },
  chef: { shirt: ['#f6f6f4'], shirtStyle: 'chef', bottom: ['#33363d', '#3b3f47'] },
  waiter: { shirt: ['#f4f4f2'], shirtStyle: 'waiter', bottom: ['#26282c'] },
};

const KIND_DEFS = {
  office: {
    role: 'customer', build: 'slim', adult: 1, hair: ['short', 'short', 'bob', 'bun'], age: [0.05, 0.45],
    bag: 'briefcase', bagP: 0.55, glasses: 0.3, mask: 0.06, umbrella: 0.12, scarf: 0.12, camera: 0,
  },
  student: {
    role: 'customer', build: 'slim', adult: 0.25, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0, 0.12],
    bag: 'backpack', bagP: 0.75, glasses: 0.22, mask: 0.14, umbrella: 0.1, scarf: 0.08, camera: 0,
  },
  tourist: {
    role: 'customer', build: 'average', adult: 1, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.1, 0.55],
    bag: 'backpack', bagP: 0.8, glasses: 0.35, mask: 0.06, umbrella: 0.25, scarf: 0.12, camera: 0.5,
  },
  family: {
    role: 'customer', build: 'average', adult: 0.5, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.05, 0.5],
    bag: 'none', bagP: 0, glasses: 0.15, mask: 0.1, umbrella: 0.12, scarf: 0.12, camera: 0.18,
  },
  couple: {
    role: 'customer', build: 'slim', adult: 1, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.05, 0.32],
    bag: 'handbag', bagP: 0.5, glasses: 0.16, mask: 0.05, umbrella: 0.1, scarf: 0.3, camera: 0.1,
  },
  elder: {
    role: 'customer', build: 'heavy', adult: 1, hair: ['old', 'short'], hairTone: ['grey', 'white'], age: [0.8, 1],
    bag: 'none', bagP: 0, glasses: 0.6, mask: 0.2, umbrella: 0.2, scarf: 0.35, camera: 0, cane: 1,
  },
  party: {
    role: 'customer', build: 'average', adult: 0.9, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.08, 0.5],
    bag: 'handbag', bagP: 0.35, glasses: 0.2, mask: 0.05, umbrella: 0.1, scarf: 0.15, camera: 0.15,
  },
  chef: {
    role: 'staff', build: 'average', adult: 1, hair: ['short', 'bun', 'bald'], age: [0.15, 0.5], fixed: true,
    bag: 'none', bagP: 0, glasses: 0.1, mask: 0.05, umbrella: 0, scarf: 0, camera: 0, hat: 'chef', apron: 'waist',
  },
  // ── 追加客層（8 種）──────────────────────────────────────────────
  regular: {
    role: 'customer', build: 'average', adult: 1, hair: ['short', 'bob', 'bun', 'ponytail'], age: [0.25, 0.72],
    bag: 'handbag', bagP: 0.4, glasses: 0.32, mask: 0.08, umbrella: 0.2, scarf: 0.25, camera: 0,
  },
  solo: {
    role: 'customer', build: 'slim', adult: 1, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.08, 0.45],
    bag: 'handbag', bagP: 0.5, glasses: 0.28, mask: 0.1, umbrella: 0.14, scarf: 0.1, camera: 0.2,
  },
  business: {
    role: 'customer', build: 'average', adult: 1, hair: ['short', 'short', 'bob'], age: [0.3, 0.68],
    bag: 'briefcase', bagP: 0.85, glasses: 0.25, mask: 0.04, umbrella: 0.3, scarf: 0.08, camera: 0,
  },
  influencer: {
    role: 'customer', build: 'slim', adult: 1, hair: ['long', 'bob', 'ponytail', 'bun'], age: [0.03, 0.26],
    bag: 'handbag', bagP: 0.8, glasses: 0.08, mask: 0.03, umbrella: 0.06, scarf: 0.18, camera: 0.9,
  },
  chefguest: {
    role: 'customer', build: 'average', adult: 1, hair: ['short', 'bun', 'bald'], age: [0.22, 0.62],
    bag: 'none', bagP: 0.05, glasses: 0.3, mask: 0.04, umbrella: 0.1, scarf: 0.1, camera: 0.15,
    apron: 'waist', towel: 1,
  },
  club: {
    role: 'customer', build: 'average', adult: 0.3, hair: ['short', 'bob', 'ponytail'], age: [0, 0.1],
    bag: 'backpack', bagP: 0.9, glasses: 0.14, mask: 0.08, umbrella: 0.12, scarf: 0.05, camera: 0,
  },
  nightworker: {
    role: 'customer', build: 'heavy', adult: 1, hair: ['short', 'bun'], age: [0.22, 0.6],
    bag: 'none', bagP: 0.25, glasses: 0.22, mask: 0.35, umbrella: 0.16, scarf: 0.15, camera: 0,
  },
  petlover: {
    role: 'customer', build: 'average', adult: 0.85, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.1, 0.55],
    bag: 'handbag', bagP: 0.6, glasses: 0.2, mask: 0.06, umbrella: 0.22, scarf: 0.12, camera: 0.25,
  },
  actor: {
    role: 'customer', build: 'slim', adult: 1, hair: ['short', 'bob', 'bun'], age: [0.08, 0.35],
    bag: 'handbag', bagP: 0.5, glasses: 0.95, mask: 0.25, umbrella: 0.05, scarf: 0.35, camera: 0.1,
  },
  celebrity: {
    role: 'customer', build: 'slim', adult: 1, hair: ['long', 'bob', 'ponytail', 'bun'], age: [0.05, 0.28],
    bag: 'handbag', bagP: 0.8, glasses: 0.9, mask: 0.3, umbrella: 0.05, scarf: 0.2, camera: 0.3,
  },
  tvcrew: {
    role: 'customer', build: 'average', adult: 1, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.12, 0.45],
    bag: 'backpack', bagP: 0.9, glasses: 0.35, mask: 0.06, umbrella: 0.15, scarf: 0.08, camera: 1,
  },
  waiter: {
    role: 'staff', build: 'slim', adult: 1, hair: ['short', 'bob', 'ponytail', 'bun'], age: [0.05, 0.3], fixed: true,
    bag: 'none', bagP: 0, glasses: 0.12, mask: 0.05, umbrella: 0, scarf: 0, camera: 0, vest: 1, apron: 'waist',
  },
};

export const POSES = ['stand', 'walk', 'sit', 'eat', 'wait', 'angry', 'happy', 'carry', 'cook'];

/* ── 身高／體型 ── */
function resolveBody(kind, def, opts, rnd) {
  let child = false;
  if (opts.child != null) child = !!opts.child;
  else if (opts.childChance != null) child = rnd.chance(opts.childChance);
  else if (kind === 'family') child = rnd.chance(0.4);
  else if (!def.adult) child = false;
  else if (def.adult < 1) child = rnd.chance(1 - def.adult);

  const childRange = opts.childHeightRange || [1.0, 1.3];
  const adultRange = opts.adultHeightRange || [1.55, 1.85];
  let height;
  const want = Number(opts.height);
  if (isFinite(want) && want > 0) {
    height = want;
    child = height <= 1.4;
  } else {
    height = child ? rnd.range(childRange[0], childRange[1]) : rnd.range(adultRange[0], adultRange[1]);
  }
  // 硬性遵守合約範圍
  if (child) height = clamp(height, 1.0, 1.3);
  else height = clamp(height, 1.55, 1.85);

  const build = opts.build || def.build || 'average';
  const bf = build === 'slim' ? 0.92 : build === 'heavy' ? 1.22 : 1.0;
  const jitter = 1 + (rnd.f() - 0.5) * 0.07;

  // 以 1.72 m 為基準的人體比例（頭高 ≈ 身高/7.5、肩寬 ≈ 身高/4）
  const u = height / 1.72;
  const T = {
    headH: height / 7.5,
    headW: 0.207 * u * (0.95 + 0.1 * bf),
    // 肩寬 ≈ 身高 / 4（含手臂的整體輪廓；shoulderHalf 是肩線本身的半寬）
    shoulderHalf: 0.246 * u * bf * jitter,
    chestHalf: 0.168 * u * bf * jitter,
    waistHalf: 0.137 * u * bf * jitter,
    hipsHalf: 0.144 * u * bf * jitter,
    torsoDepth: 0.098 * u * bf,
    armR: 0.0505 * u * (0.9 + 0.16 * bf),
    legR: 0.0795 * u * (0.9 + 0.2 * bf),
    child,
  };
  return {
    height, child, build, u, T,
    age: opts.age != null ? Number(opts.age) : rnd.range(def.age[0], def.age[1]),
    skin: opts.skin || rnd.pick(SKIN_TONES),
  };
}

/* ── 配色 ── */
function resolveLook(kind, def, opts, rnd, body) {
  const fit = OUT_FITS[kind] || OUT_FITS.office;
  const skin = body.skin;
  const age = body.age;

  // 頭髮
  let style = opts.hair || rnd.pick(def.hair);
  if (body.child) {
    style = opts.hair || rnd.pick(['short', 'bob', 'ponytail', 'bun']);
  }
  let hairToneName = opts.hairTone || (def.hairTone ? rnd.pick(def.hairTone)
    : (age > 0.78 ? rnd.pick(['grey', 'white', 'black'])
      : rnd.pick(['black', 'black', 'black', 'dkbrown', 'brown'])));
  if (age > 0.78 && !opts.hairTone) hairToneName = rnd.pick(['grey', 'white']);
  const hairMain = HAIR_TONES[hairToneName] || HAIR_TONES.black;

  // 服裝
  const shirt = opts.shirtColor || opts.color || rnd.pick(fit.shirt);
  const bottom = opts.bottomColor || rnd.pick(fit.bottom);
  const shoeP = def.role === 'staff'
    ? ['#1c1c1f']
    : (kind === 'student' ? ['#3a2a22', '#26282c'] : ['#2b2b30', '#3a3229', '#4a3a2c', '#1f2024']);

  const darkish = hexLerp(shirt, '#000000', 0.55);
  const look = {
    skin, skinDark: hexLerp(skin, '#7a4a2e', 0.22), age,
    hair: style, hairTone: hairMain, browCol: hexLerp(hairMain, '#000000', 0.1),
    shirt, shirtStyle: fit.shirtStyle,
    shirtDetail: hexLerp(shirt, '#000000', 0.32),
    sleeve: shirt,           // 袖子顏色（外套類會蓋掉）
    collar: '#f7f7f4',
    bottom,
    shoe: rnd.pick(shoeP),
    sole: '#e9e6df',
    belt: '#232326',
    accent: rnd.pick(['#b03a48', '#2f5f8a', '#c98a2b', '#3f7d5c', '#7a4a8c']),
    outer: null,             // 外套／開襟衫顏色
    accessory: rnd.pick(['#2f4f7a', '#7a3f5a', '#3f6b5a', '#8a6a3a', '#54545e']),
    bag: null,
    hasGlasses: opts.glasses != null ? !!opts.glasses : rnd.chance(def.glasses || 0),
    hasMask: opts.mask != null ? !!opts.mask : rnd.chance(def.mask || 0),
    hasScarf: opts.scarf != null ? !!opts.scarf : rnd.chance(def.scarf || 0),
    hasUmbrella: opts.umbrella != null ? !!opts.umbrella : rnd.chance(def.umbrella || 0),
    hasCamera: opts.camera != null ? !!opts.camera : rnd.chance(def.camera || 0),
    hasCane: !!def.cane,
    hat: def.hat || null,
    apron: def.apron || null,
    vest: !!def.vest,
    skirt: false,
  };

  // 角色別細節
  if (kind === 'office') {
    look.outer = rnd.pick(['#22262f', '#2f3543', '#3a3f4a', '#4a4438']);
    look.sleeve = look.outer;
    look.bottom = opts.bottomColor || rnd.pick(['#232a38', '#2c3140', '#3a3a44']);
    look.tie = rnd.pick(['#8c2b3a', '#2f4f7a', '#3f3f4a', '#5a6b3f']);
    look.collar = '#f7f7f4';
  } else if (kind === 'student') {
    look.outer = opts.outerColor || rnd.pick(['#1f2a44', '#33323c', '#2b3a2f']);
    look.sleeve = look.outer;
    look.tie = rnd.pick(['#a83a4a', '#2f5f8a', '#c9a02b']);
    look.skirt = rnd.chance(0.6);
    if (look.skirt) look.bottom = opts.bottomColor || rnd.pick(['#2b3145', '#3a3a48', '#4a3a44']);
  } else if (kind === 'waiter') {
    look.shirt = '#f4f4f2';
    look.vest = true;
    look.outer = '#1d1f24';
    look.collar = '#ffffff';
    look.bottom = '#26282c';
  } else if (kind === 'chef') {
    look.shirt = '#f6f6f4';
    look.bottom = opts.bottomColor || rnd.pick(['#33363d', '#3b3f47']);
  } else if (kind === 'elder') {
    look.outer = opts.outerColor || rnd.pick(['#8f9b93', '#a8977c', '#7d8791', '#9a8f9c']);
    look.sleeve = look.outer;
    look.hasScarf = opts.scarf != null ? !!opts.scarf : rnd.chance(0.45);
  } else if (kind === 'couple') {
    if (rnd.chance(0.45)) { look.outer = rnd.pick(['#2b2b33', '#8a5a4a', '#3f4a63']); look.sleeve = look.outer; }
  } else if (kind === 'party') {
    if (rnd.chance(0.35)) { look.outer = rnd.pick(['#33333a', '#5a2f3a']); look.sleeve = look.outer; }
  } else if (kind === 'business') {
    // 接待：しっかりしたスーツ＋必ずネクタイ
    look.outer = opts.outerColor || rnd.pick(['#1b2130', '#232838', '#2b2f3a']);
    look.sleeve = look.outer;
    look.tie = rnd.pick(['#8a2b3a', '#22304a', '#3a3a44']);
    look.collar = '#f7f7f4';
  } else if (kind === 'regular') {
    // 常連さん：開襟外套をよく着ている
    if (rnd.chance(0.55)) { look.outer = rnd.pick(['#6b7f6a', '#8a6a4a', '#4a5a72']); look.sleeve = look.outer; }
  } else if (kind === 'influencer') {
    look.outer = opts.outerColor || rnd.pick(['#e8d0dc', '#d8e0f0', '#f0e0b8']);
    look.sleeve = look.outer;
  } else if (kind === 'club') {
    // 部活帰り：ジャージ上下
    look.outer = opts.outerColor || rnd.pick(['#2f5f9a', '#c0392b', '#2f7d4f', '#e0a020']);
    look.sleeve = look.outer;
    look.bottom = opts.bottomColor || look.outer;
  } else if (kind === 'nightworker') {
    if (rnd.chance(0.5)) { look.outer = rnd.pick(['#3b4a5a', '#4a5266']); look.sleeve = look.outer; }
  } else if (kind === 'petlover') {
    if (rnd.chance(0.4)) { look.outer = rnd.pick(['#7fb2d8', '#86b98d', '#c9a86a']); look.sleeve = look.outer; }
  }

  // 配件（背包／手提包／公事包）
  const wantBag = opts.bag;
  if (wantBag && wantBag !== 'none') look.bag = wantBag;
  else if (!wantBag && rnd.chance(def.bagP || 0)) look.bag = def.bag;
  if (body.child && look.bag === 'briefcase') look.bag = 'backpack';

  // 脖子上的東西只能有一個（領帶／圍巾／相機背帶），也讓 mesh 數收在預算內
  if (look.hasCamera) look.hasScarf = false;
  if (look.tie) look.hasScarf = false;
  if (look.hasGlasses) look.hasCamera = false;   // 眼鏡客不再掛相機

  return look;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. 建立角色
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 建立一個可擺姿勢的人物。
 * @param {object} [opts]
 * @param {string} [opts.kind]   CUSTOMER_KINDS 之一（預設 'office'）
 * @param {number|string} [opts.seed]  決定所有隨機外觀（同 seed → 同一個人）
 * @param {number} [opts.height] 目標身高（公尺，夾在合約範圍內）
 * @param {'customer'|'staff'} [opts.role]
 * @param {boolean} [opts.child] 強制小孩體型
 * @returns {THREE.Group} group.userData.parts = { hips, torso, head, armL, armR, legL, legR }
 */
export function makeCharacter(opts = {}) {
  const kind = CUSTOMER_KINDS.indexOf(opts.kind) >= 0 ? opts.kind : 'office';
  const def = KIND_DEFS[kind];
  const seed = opts.seed != null ? opts.seed : (Math.random() * 0xffffffff) >>> 0;
  const rnd = makeRand(seed);

  const body = resolveBody(kind, def, opts, rnd);
  const look = resolveLook(kind, def, opts, rnd, body);
  const T = body.T;
  let s = body.u;                   // 全模型縮放（以 1.72 m 為 1.0，稍後依實際高度校正）

  // 鞋（腳長 ≈ 身高 × 0.15）
  const SHOE_H = 0.062;                                    // 鞋身高度
  const SHOE_LEN = 0.255 * (body.child ? 0.92 : 1);
  const shoeDown = SHOE_H * 0.5 + 0.008;                   // 腳踝 → 鞋底
  const ANKLE_Y = shoeDown;                                // 站姿時踝關節的高度：鞋底剛好落地

  // 以「1.72 m 基準」建模，最後統一縮放（因此 pivot 內都是模型單位）
  const J = {
    hipY: 0.950,
    chestY: 1.130,
    shoulderY: 1.330,
    shoulderX: 0.195,
    elbowY: 1.060,
    wristY: 0.815,
    hipX: 0.086,
    kneeY: 0.497,
    ankleY: ANKLE_Y,
  };

  /* ── 材質（全部走快取） ── */
  const mSkin = stdMat(look.skin, { roughness: 0.86 });
  const mHair = stdMat(look.hairTone, { roughness: 0.62, flat: look.hair === 'bun' ? false : true });
  const mBottom = stdMat(look.bottom, { roughness: 0.84 });
  const mShoe = physMat(look.shoe, { roughness: 0.42, clearcoat: 0.35 });
  const mSole = stdMat(look.sole, { roughness: 0.8 });
  const mShirt = physMat(look.shirt, { roughness: 0.74 });
  const mSleeve = look.sleeve === look.shirt ? mShirt : stdMat(look.sleeve, { roughness: 0.78 });
  const mOuter = look.outer ? stdMat(look.outer, { roughness: 0.7 }) : null;
  const mCollar = stdMat(look.collar, { roughness: 0.74 });
  const mDetail = stdMat(look.shirtDetail, { roughness: 0.72 });
  const mAccent = stdMat(look.accent, { roughness: 0.6 });
  const mBelt = stdMat(look.belt, { roughness: 0.55 });

  const ownedMats = [];
  const seen = new Set();
  const track = (m) => { if (m && !seen.has(m)) { seen.add(m); ownedMats.push(m); } };

  let faceTex = null;
  let faceMat = null;

  /* ── 骨架 ── */
  const group = new THREE.Group();
  group.name = 'character:' + kind;

  const hips = pivot(0, J.hipY, 0, group);
  const torso = pivot(0, J.chestY - J.hipY, 0, hips);
  const armL = pivot(J.shoulderX, J.shoulderY - J.chestY, 0, torso);
  const armR = pivot(-J.shoulderX, J.shoulderY - J.chestY, 0, torso);
  const legL = pivot(J.hipX, 0, 0, hips);
  const legR = pivot(-J.hipX, 0, 0, hips);

  const elbowL = pivot(0, J.elbowY - J.shoulderY, 0, armL);
  const elbowR = pivot(0, J.elbowY - J.shoulderY, 0, armR);
  const handL = pivot(0, J.wristY - J.elbowY, 0, elbowL);
  const handR = pivot(0, J.wristY - J.elbowY, 0, elbowR);

  const kneeL = pivot(0, J.kneeY - J.hipY, 0, legL);
  const kneeR = pivot(0, J.kneeY - J.hipY, 0, legR);
  const footL = pivot(0, J.ankleY - J.kneeY, 0, kneeL);
  const footR = pivot(0, J.ankleY - J.kneeY, 0, kneeR);

  hips.rotation.order = 'XYZ';
  torso.rotation.order = 'XYZ';

  const parts = { hips, torso, head: null, armL, armR, legL, legR };

  /* ── 軀幹 ── */
  const torsoLen = J.shoulderY - J.hipY;
  const torsoMesh = limbMesh(
    torso, torsoLen / 2,
    createCyl(T.chestHalf, T.hipsHalf * 0.96, torsoLen, 14, true),
    mShirt, 1, T.torsoDepth / T.chestHalf
  );
  torsoMesh.position.set(0, (J.shoulderY + J.hipY) / 2 - J.chestY, 0);

  // 肩膀／上胸：膠囊把肩線撐出來（肩寬 ≈ 身高/4）
  const shoulderMesh = limbMesh(
    torso, T.shoulderHalf * 0.55,
    createCapsule(T.shoulderHalf * 0.50, T.shoulderHalf * 1.05, 3, 12),
    mShirt, 1, 0.72
  );
  shoulderMesh.position.set(0, J.shoulderY - J.chestY - T.shoulderHalf * 0.5, 0);

  // 衣領（有外套時由外套的領線負責，省一個 mesh）
  if (!look.outer) {
    const collar = mesh(
      createTorus(T.shoulderHalf * 1.02, T.shoulderHalf * 0.95, 4, 14),
      mCollar, 0, J.shoulderY - J.chestY + 0.012, 0, torso
    );
    collar.rotation.x = -Math.PI / 2;
    collar.scale.set(1, 0.95, 0.62);
  }

  // 腰帶（有外套時會被外套蓋住；裙子／制服不繫皮帶）
  if (!look.skirt && !look.outer) {
    const belt = mesh(
      createCyl(T.hipsHalf * 1.03, T.hipsHalf * 1.03, 0.03, 12, true),
      mBelt, 0, -0.005, 0, hips
    );
    belt.scale.set(1, 1, T.torsoDepth / T.hipsHalf);
  }

  /* ── 頭 ── */
  const head = pivot(0, J.shoulderY + 0.045 - J.chestY, 0, torso);   // 頸根
  parts.head = head;
  const headW = T.headW;
  const headHH = T.headH * 0.5;                                      // 頭半高
  const headCY = headHH + 0.055;                                     // 頭球中心（頸根上方）

  const neck = limbMesh(head, 0.035, createCyl(0.046, 0.054, 0.075, 10, true), mSkin, 1.05, 0.95);
  neck.position.set(0, 0.005, 0);

  const headMesh = mesh(createSphere(1, 14, 11), mSkin, 0, headCY, 0, head);
  headMesh.scale.set(headW / 2, headHH, headW * 0.94 / 2);
  const jaw = mesh(createSphere(1, 10, 8), mSkin, 0, headCY - headHH * 0.62, headW * 0.03, head);
  jaw.scale.set(headW * 0.40, headHH * 0.36, headW * 0.40);

  /* 臉：CanvasTexture 貼在頭前方的平面上 */
  // key 加上髮型／裙裝：眉型與下睫毛會跟著這兩個欄位變（快取仍然是 per (key, 表情)）
  const faceKey = [look.skin, look.age.toFixed(2), look.hairTone, look.browCol,
    look.hair || '', look.skirt ? 'f' : 'm'].join('~');
  faceTex = canUseCanvas() ? faceTexture(faceKey, 'neutral', look) : null;
  const faceW = headW * 0.98;
  const faceH = faceW / FACE_ASPECT;
  const faceZ = headW * 0.455;
  let faceMesh = null;
  if (faceTex) {
    faceMat = faceMatOf(faceTex);
    track(faceMat);
    faceMesh = mesh(createBox(faceW, faceH, 1), faceMat, 0, headCY + headHH * 0.01, faceZ, head);
    faceMesh.scale.z = 0.006;
    faceMesh.rotation.x = -0.07;
  }

  // 五官在頭部座標中的位置（配件對位用）
  const faceCenterY = headCY + headHH * 0.01;
  const markY = (frac) => faceCenterY + (frac - 0.5) * faceH;
  const MARKS = {
    eyeY: markY(0.50), browY: markY(0.75), mouthY: markY(0.13),
    eyeX: faceW * 0.25, faceZ, faceW, faceH,
  };

  /* ── 頭髮 ── */
  const fx = [];
  const hs = look.hair;
  const hairR = headW / 2;
  if (hs === 'short') {
    const cap = mesh(createShell(1, 1.86, Math.PI * 0.5, Math.PI, 14, 10), mHair, 0, headCY + 0.006, 0, head);
    cap.scale.set(hairR * 1.11, headHH * 1.09, hairR * 1.11);
    cap.rotation.x = -0.06;
    const back = mesh(createSphere(1, 10, 8), mHair, 0, headCY - 0.012, -headW * 0.10, head);
    back.scale.set(hairR * 0.99, headHH * 0.86, hairR * 1.0);
    const fr = mesh(createShell(1, 0.46, 0, Math.PI * 2, 12, 4), mHair, 0, markY(0.70), faceZ * 0.93, head);
    fr.scale.set(hairR * 1.07, headHH * 0.6, hairR * 1.02);
    fr.rotation.x = 0.14;
  } else if (hs === 'bob') {
    const cap = mesh(createShell(1, 2.22, 0, Math.PI * 2, 14, 11), mHair, 0, headCY + 0.004, 0, head);
    cap.scale.set(hairR * 1.16, headHH * 1.22, hairR * 1.14);
    cap.rotation.x = -0.05;
    const fr2 = mesh(createShell(1, 0.42, 0, Math.PI * 2, 12, 4), mHair, 0, markY(0.70), faceZ * 0.94, head);
    fr2.scale.set(hairR * 1.09, headHH * 0.55, hairR * 1.04);
    fr2.rotation.x = 0.12;
  } else if (hs === 'ponytail' || hs === 'bun') {
    const cap = mesh(createShell(1, 1.98, Math.PI * 0.42, Math.PI * 1.16, 14, 10), mHair, 0, headCY + 0.005, 0, head);
    cap.scale.set(hairR * 1.10, headHH * 1.10, hairR * 1.10);
    const back = mesh(createSphere(1, 10, 8), mHair, 0, headCY - 0.014, -headW * 0.12, head);
    back.scale.set(hairR * 0.96, headHH * 0.9, hairR * 0.96);
    const fr3 = mesh(createShell(1, 0.42, 0, Math.PI * 2, 12, 4), mHair, 0, markY(0.72), faceZ * 0.94, head);
    fr3.scale.set(hairR * 1.08, headHH * 0.55, hairR * 1.03);
    fr3.rotation.x = 0.12;
    if (hs === 'ponytail') {
      const tail = mesh(createCyl(0.013, 0.036, 0.30, 7, false), mHair, 0, -0.16, -hairR * 0.86, head);
      tail.rotation.x = -0.34;
      tail.userData.fx = 'tail';
      fx.push(tail);
    } else {
      const bun = mesh(createSphere(1, 10, 8), mHair, 0, headCY + headHH * 0.82, -headW * 0.16, head);
      bun.scale.set(hairR * 0.5, hairR * 0.42, hairR * 0.5);
      bun.userData.fx = 'bun';
      fx.push(bun);
    }
  } else if (hs === 'bald' || hs === 'old') {
    const side = mesh(createShell(1, 1.62, Math.PI * 0.42, Math.PI * 1.16, 12, 9), mHair, 0, headCY - 0.006, -headW * 0.02, head);
    side.scale.set(hairR * 1.04, headHH * 1.03, hairR * 1.04);
    side.rotation.x = -0.05;
    if (hs === 'old') {
      const ring = mesh(createShell(1, 0.42, Math.PI * 0.42, Math.PI * 1.16, 12, 4), mHair, 0, markY(0.30), 0, head);
      ring.scale.set(hairR * 1.02, headHH * 0.5, hairR * 1.02);
    }
  }

  /* ── 手臂（袖／上臂 + 前臂 + 手） ── */
  const upperLen = J.shoulderY - J.elbowY;
  const lowerLen = J.elbowY - J.wristY;
  const buildArm = (piv, el, hand) => {
    // 上臂（含袖）：從肩關節往下長
    limbMesh(piv, T.armR * 0.55,
      createCapsule(T.armR * 1.12, upperLen - T.armR * 1.1, 3, 9), mSleeve);
    // 前臂：從肘關節往下長
    limbMesh(el, T.armR * 0.55,
      createCapsule(T.armR * 0.95, lowerLen - T.armR * 1.1, 3, 9),
      look.outer ? mShirt : mSkin);
    // 袖口（手腕處）
    const cuff = mesh(createCyl(T.armR * 0.94, T.armR * 0.86, 0.028, 9, true), mSleeve, 0, 0, 0, el);
    cuff.position.set(0, -lowerLen + 0.012, 0);
    // 手
    const handM = mesh(createSphere(1, 8, 6), mSkin, 0, -0.028, 0.004, hand);
    handM.scale.set(0.034, 0.058, 0.028);
  };
  const rig = {
    armL, armR, legL, legR, elbowL, elbowR, handL, handR, kneeL, kneeR, footL, footR,
  };
  buildArm(armL, elbowL, handL);
  buildArm(armR, elbowR, handR);

  /* ── 腿（褲／裙 + 小腿 + 鞋） ── */
  if (look.skirt) {
    const skirt = limbMesh(hips, 0.06, createCyl(T.waistHalf * 1.06, T.waistHalf * 1.9, 0.30, 14, true), mBottom, 1, T.torsoDepth / T.waistHalf);
    skirt.position.set(0, J.hipY - 0.09, 0);
  }
  // 鞋（腳長 ≈ 身高 × 0.15；鞋底貼在 y = 地面）
  const buildLeg = (hipPiv, kneePiv, footPiv) => {
    if (!look.skirt) {
      limbMesh(hipPiv, T.legR * 0.42,
        createCapsule(T.legR * 0.93, (J.hipY - J.kneeY) - T.legR * 0.84, 3, 9), mBottom);
    } else {
      limbMesh(hipPiv, T.legR * 0.42,
        createCapsule(T.legR * 0.62, (J.hipY - J.kneeY) - T.legR * 0.84, 3, 8), mSkin);
    }
    limbMesh(kneePiv, T.legR * 0.34,
      createCapsule(T.legR * 0.74, (J.kneeY - J.ankleY) - T.legR * 0.68, 3, 9),
      look.skirt ? mSkin : mBottom);
    // 鞋：以腳踝為軸，鞋底離地 0
    mesh(createBox(0.098, SHOE_H, SHOE_LEN), mShoe,
      0, -shoeDown + SHOE_H * 0.5, SHOE_LEN * 0.20, footPiv);
    mesh(createBox(0.101, 0.014, SHOE_LEN * 1.04), mSole,
      0, -shoeDown + 0.007, SHOE_LEN * 0.20, footPiv);
    return footPiv;
  };
  buildLeg(legL, kneeL, footL);
  buildLeg(legR, kneeR, footR);

  /* ── 服裝配件 ── */
  if (look.outer) {   // 外套／開襟衫／背心
    const jkt = limbMesh(torso, torsoLen / 2,
      createCyl(T.chestHalf * 1.07, T.hipsHalf * 1.04, torsoLen * 0.74, 12, true), mOuter, 1, T.torsoDepth / T.chestHalf * 1.06);
    jkt.position.set(0, (J.shoulderY + J.hipY) / 2 - J.chestY - 0.03, 0);
    // 前襟／翻領
    for (const sx of [-1, 1]) {
      const lapel = mesh(createBox(T.chestHalf * 0.62, torsoLen * 0.34, 0.014),
        mOuter, sx * T.chestHalf * 0.44, J.shoulderY - J.chestY - torsoLen * 0.22, T.torsoDepth * 0.92, torso);
      lapel.rotation.z = sx * 0.16;
    }
    if (look.vest) {   // 背心：露出白襯衫
      const v = mesh(createBox(T.chestHalf * 0.7, torsoLen * 0.5, 0.02),
        mShirt, 0, J.shoulderY - J.chestY - torsoLen * 0.3, T.torsoDepth * 0.95, torso);
    }
  } else if (look.shirtStyle === 'button' || look.shirtStyle === 'waiter' || look.shirtStyle === 'chef') {
    const placket = mesh(createBox(0.020, torsoLen * 0.78, 0.012),
      mDetail, 0, J.shoulderY - J.chestY - torsoLen * 0.46, T.torsoDepth * 0.98, torso);
  }
  if (look.tie) {
    const tie = mesh(createBox(0.036, 0.20, 0.016), stdMat(look.tie, { roughness: 0.55 }),
      0, J.shoulderY - J.chestY - 0.135, T.torsoDepth * 1.0, torso);
    tie.rotation.x = 0.03;
    mesh(createBox(0.030, 0.030, 0.018), stdMat(look.tie, { roughness: 0.55 }),
      0, J.shoulderY - J.chestY - 0.026, T.torsoDepth * 1.0, torso);
  }
  if (look.apron === 'waist') {
    const ap = mesh(createBox(T.hipsHalf * 1.5, torsoLen * 0.62, 0.016), stdMat('#f2efe6', { roughness: 0.8 }),
      0, J.shoulderY - J.chestY - torsoLen * 0.56, T.torsoDepth * 1.0, torso);
    ap.scale.set(1, 1, 1);
    mesh(createBox(T.hipsHalf * 0.9, 0.05, 0.018), stdMat('#dcd6c6', { roughness: 0.8 }),
      0, J.shoulderY - J.chestY - torsoLen * 0.25, T.torsoDepth * 1.02, torso);
  }
  if (look.hat === 'chef') {
    const band = mesh(createCyl(headW * 0.62, headW * 0.60, 0.055, 12, true), stdMat('#f4f4f2', { roughness: 0.8 }),
      0, headCY + headHH * 0.86, 0, head);
    const puff = mesh(createSphere(1, 12, 9), stdMat('#f7f7f5', { roughness: 0.85 }),
      0, headCY + headHH * 1.42, 0, head);
    puff.scale.set(headW * 0.56, headW * 0.44, headW * 0.56);
  }
  if (look.hasGlasses) {
    // 鏡框：只用一片細長的 torus 橫跨兩眼，遠看就是一付眼鏡（省 mesh）
    const fmat = stdMat('#2b2b30', { roughness: 0.4, metalness: 0.25 });
    const frame = mesh(createTorus(1, 0.0055, 6, 18), fmat,
      0, MARKS.eyeY, MARKS.faceZ + 0.012, head);
    // 兩眼各一個鏡框（扁橢圓），一眼一個
    frame.scale.set(MARKS.faceW * 0.155, MARKS.faceH * 0.135, 1);
    frame.position.x = -MARKS.faceW * 0.245;
    frame.rotation.z = 0.02;
    const frame2 = mesh(createTorus(1, 0.0055, 6, 18), fmat,
      MARKS.faceW * 0.245, MARKS.eyeY, MARKS.faceZ + 0.012, head);
    frame2.scale.set(MARKS.faceW * 0.155, MARKS.faceH * 0.135, 1);
    frame2.rotation.z = -0.02;
  }
  if (look.hasMask) {
    const mask = mesh(createSphere(1, 10, 8), stdMat('#f0f1f3', { roughness: 0.86 }),
      0, MARKS.mouthY + 0.006, MARKS.faceZ + 0.012, head);
    mask.scale.set(headW * 0.45, headHH * 0.42, 0.020);
    mask.userData.feature = 'mask';
  }
  if (look.hasScarf) {
    const mScarf = stdMat(look.accent, { roughness: 0.9 });
    const sc = mesh(createTorus(0.062, 0.028, 6, 14), mScarf,
      0, J.shoulderY - J.chestY + 0.028, 0, torso);
    sc.rotation.x = Math.PI / 2;
    sc.scale.set(1.02, 0.9, 0.72);
    mesh(createBox(0.055, 0.13, 0.018), mScarf,
      0.03, J.shoulderY - J.chestY - 0.06, T.torsoDepth * 0.95, torso);
  }
  if (look.hasCamera) {
    mesh(createBox(0.085, 0.058, 0.038),
      stdMat('#26262b', { roughness: 0.5, metalness: 0.2 }),
      0, J.shoulderY - J.chestY - 0.095, T.torsoDepth * 1.05, torso);
    const lens = mesh(createCyl(0.020, 0.024, 0.030, 10, false),
      stdMat('#3b3f47', { roughness: 0.35, metalness: 0.4 }),
      0, J.shoulderY - J.chestY - 0.095, T.torsoDepth * 1.05 + 0.03, torso);
    lens.rotation.x = Math.PI / 2;
    const strap = mesh(createTorus(0.075, 0.005, 4, 14), stdMat('#4a3a2c', { roughness: 0.85 }),
      0, J.shoulderY - J.chestY + 0.03, 0, torso);
    strap.rotation.x = Math.PI / 2.1;
    strap.scale.set(1, 1, 1.4);
  }
  if (look.bag === 'backpack') {
    mesh(createBox(0.20, 0.30, 0.095), stdMat(look.accessory, { roughness: 0.85 }),
      0, J.shoulderY - J.chestY - 0.15, -T.torsoDepth * 1.0 - 0.05, torso);
    // 觀光客的背包是主要特徵，補一條肩帶；其他角色只留包體
    if (kind === 'tourist') {
      const strap = mesh(createBox(0.058, 0.30, 0.018), stdMat(look.accessory, { roughness: 0.85 }),
        0, J.shoulderY - J.chestY - 0.10, T.torsoDepth * 0.72, torso);
      strap.rotation.x = 0.12;
    }
  } else if (look.bag === 'briefcase') {
    const bc = mesh(createBox(0.13, 0.19, 0.055), stdMat('#2a2119', { roughness: 0.55, metalness: 0.1 }),
      0.045, J.wristY - 0.14, 0.012, handR);
    bc.userData.feature = 'bag';
    mesh(createTorus(0.026, 0.006, 4, 10), stdMat('#1c1712', { roughness: 0.5 }),
      0, J.wristY - 0.043, 0.012, handR).rotation.z = Math.PI / 2;
  } else if (look.bag === 'handbag') {
    const hb = mesh(createBox(0.16, 0.13, 0.06), stdMat(look.accessory, { roughness: 0.8 }),
      0.055, J.wristY - 0.11, 0.01, handR);
    mesh(createBox(0.05, 0.06, 0.008), stdMat('#2f2a26', { roughness: 0.7 }),
      0.055, J.wristY - 0.028, 0.01, handR);
  }
  if (look.hasCane) {
    const mCane = stdMat('#5a4331', { roughness: 0.55 });
    mesh(createCyl(0.009, 0.011, 0.72, 8, false), mCane,
      0.05, J.wristY - 0.46, 0.03, handR);
    mesh(createTorus(0.026, 0.010, 5, 10), mCane,
      0.05, J.wristY - 0.10, 0.03, handR).rotation.y = Math.PI / 2;
  }
  if (look.hasUmbrella) {
    // 收起的傘：握在右手前臂旁，傘尖剛好離地
    const pole = 0.45;
    const foreLen = J.elbowY - J.wristY;
    const topY = -foreLen + 0.02;
    const mUmb = stdMat('#2f3543', { roughness: 0.5 });
    const um = mesh(createCyl(0.010, 0.008, pole, 8, false), mUmb,
      0.082, topY - pole * 0.5, 0.02, elbowR);
    um.rotation.x = 0.06;
    um.userData.feature = 'umbrella';
    mesh(createSphere(1, 8, 6), mUmb,
      0.082, topY - pole + 0.005, 0.06, elbowR).scale.set(0.014, 0.016, 0.014);
  }
  // 托盤（服務生 carry 姿勢用，平常隱藏）
  const tray = mesh(createCyl(0.16, 0.155, 0.014, 14, false), stdMat('#c9a86a', { roughness: 0.45, metalness: 0.15 }),
    0, -0.075, 0.13, handL);
  tray.visible = false;
  tray.userData.feature = 'tray';

  /* ── 蒐集 mesh、統計 ── */
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      meshes.push(o);
      track(o.material);
      const g = o.geometry;
      _geomRef.set(g, (_geomRef.get(g) || 0) + 1);
    }
  });

  /* ── 姿勢系統 ── */
  const neutral = {
    hipX: 0, hipY: 0, hipZ: 0, hipYaw: 0, hipRoll: 0,
    torsoBend: -0.012, torsoTwist: 0, torsoRoll: 0,
    headBend: 0, headYaw: 0, headRoll: 0,
    legL: { thigh: 0, shin: 0, foot: 0, splay: 0.06 },
    legR: { thigh: 0, shin: 0, foot: 0, splay: 0.06 },
    armL: { swing: 0.03, out: 0.075, bend: 0.10, across: 0 },
    armR: { swing: 0.03, out: 0.075, bend: 0.10, across: 0 },
  };
  const POSE_DEFS = getPoseDefs();
  // 姿勢一律以「乾淨的中性站姿」為基準，避免前一輪的結果被當成基準而累加
  const baseState = cloneState(neutral);
  const motion = {
    init: false, name: 'stand', prevName: 'stand', tPrev: 0,
    cur: cloneState(neutral), from: cloneState(neutral), target: cloneState(neutral),
    blend: { t: 0, dur: 0.25 }, seated: false,
  };

  group.userData.kind = kind;
  group.userData.role = def.role;
  group.userData.seed = seed;
  group.userData.id = ++_charId;
  group.userData.height = body.height;
  group.userData.isChild = body.child;
  group.userData.parts = parts;
  group.userData.rig = rig;
  group.userData.fx = fx;
  group.userData.joints = J;
  group.userData.shoeDown = shoeDown;
  group.userData.legReach = (J.hipY - J.kneeY) + (J.kneeY - J.ankleY) + shoeDown;
  group.userData.marks = MARKS;
  group.userData.look = look;
  group.userData.meshCount = meshes.length;
  group.userData.meshes = meshes;
  group.userData.materials = ownedMats;
  group.userData.motion = motion;
  group.userData.baseState = baseState;
  group.userData.faceMarks = MARKS;
  group.userData.facePlane = faceMesh;
  group.userData.faceTextureKey = faceKey;
  group.userData.faceExpression = 'neutral';
  group.userData._faceTex = faceTex;
  group.userData._poseName = 'stand';
  group.userData.poseTime = 0;
  group.userData.poses = POSES;

  /* ── 縮放：先歸一化成 1 m 高，再放大到目標身高 ──
     量測排除手上垂到地面以下的傘／拐杖與托盤 */
  const bodyMeshes = meshes.filter((m) => {
    const f = m.userData.feature;
    return f !== 'umbrella' && f !== 'bag' && f !== 'tray';
  });
  const spanY = () => {
    const box = new THREE.Box3();
    for (const m of bodyMeshes) box.expandByObject(m);
    return { h: box.max.y - box.min.y, min: box.min.y };
  };

  // 先擺好站姿再量，量到的才是實際身高
  group.scale.setScalar(1);
  group.position.y = 0;
  applyPose(group, 'stand', 0);
  group.updateMatrixWorld(true);

  let sp = spanY();
  group.scale.setScalar(sp.h > 0.2 ? 1 / sp.h : 1);      // 歸一化：站姿高度 = 1 m
  group.updateMatrixWorld(true);
  sp = spanY();
  group.scale.multiplyScalar(body.height / sp.h);        // 再放大到目標身高
  group.updateMatrixWorld(true);
  sp = spanY();
  group.position.y = -sp.min;                            // 鞋底站在 y = 0

  group.userData.modelScale = group.scale.y;
  group.userData.height = body.height;

  applyPose(group, 'stand', 0);
  return group;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. 姿勢：狀態 → 骨架
   ═══════════════════════════════════════════════════════════════════════════ */
function cloneState(s) {
  return {
    hipX: s.hipX, hipY: s.hipY, hipZ: s.hipZ, hipYaw: s.hipYaw, hipRoll: s.hipRoll,
    torsoBend: s.torsoBend, torsoTwist: s.torsoTwist, torsoRoll: s.torsoRoll,
    headBend: s.headBend, headYaw: s.headYaw, headRoll: s.headRoll,
    legL: { ...s.legL }, legR: { ...s.legR },
    armL: { ...s.armL }, armR: { ...s.armR },
  };
}
// 髖關節 → 鞋底的垂直距離（模型單位）
// 角度定義（模型面向 +Z）：
//   thigh = 大腿與鉛直線的夾角（負 = 往身前抬）
//   shin  = 膝關節彎曲量（相對大腿；正 = 屈膝）
//   foot  = 踝關節轉動量（相對小腿）
function legDrop(l, J, shoeDown) {
  const a1 = l.thigh;
  const a2 = l.thigh + l.shin;
  const a3 = a2 + l.foot;
  return (J.hipY - J.kneeY) * Math.cos(a1)
    + (J.kneeY - J.ankleY) * Math.cos(a2)
    + shoeDown * Math.cos(a3);
}
// 讓腳底最貼近地面的髖高位移（hipY 是相對站姿髖高的位移，站姿為 0）
function hipYFor(h, J, shoeDown) {
  const a = legDrop(h.legL, J, shoeDown);
  const b = legDrop(h.legR, J, shoeDown);
  return -(a > b ? a : b);
}
function hipZFor(h, J) {
  const zL = (J.hipY - J.kneeY) * Math.sin(h.legL.thigh);
  const zR = (J.hipY - J.kneeY) * Math.sin(h.legR.thigh);
  return -0.5 * (zL + zR) - 0.05;
}

// 姿勢表：手臂／軀幹為「相對中性站姿」的加項；腿為絕對角度
//   torsoBend 負值 = 前傾（往 +Z 方向彎）、正值 = 後仰
//   legL/legR.thigh 負值 = 大腿往前抬；shin 正值 = 屈膝
let _POSE_DEFS = null;
function getPoseDefs() {
  if (_POSE_DEFS) return _POSE_DEFS;
  const base = { swing: 0, out: 0, bend: 0, across: 0 };
  _POSE_DEFS = {
    stand: { torsoBend: 0, armL: { ...base }, armR: { ...base }, seated: false },
    wait: { torsoBend: -0.008, headYaw: 0.04, armL: { out: 0.02, bend: 0.03 }, armR: { out: 0.02, bend: 0.03 }, seated: false },
    walk: { torsoBend: -0.033, seated: false },
    angry: {
      torsoBend: -0.08, headBend: 0.06, headYaw: 0.03,
      armL: { swing: -0.30, out: -0.98, bend: -1.35, across: 0.32 },
      armR: { swing: -0.28, out: 0.98, bend: -1.50, across: -0.32 },
      legL: { thigh: 0.03, shin: 0.07, splay: 0.07 },
      legR: { thigh: -0.03, shin: 0.07, splay: 0.07 },
      seated: false,
    },
    happy: {
      torsoBend: 0.03,
      armL: { swing: -0.22, out: 0.40, bend: -0.80, across: -0.15 },
      armR: { swing: -0.22, out: -0.40, bend: -0.80, across: 0.15 },
      legL: { thigh: -0.05, splay: 0.06 }, legR: { thigh: 0.03, splay: 0.06 },
      seated: false,
    },
    sit: {
      torsoBend: -0.07,
      armL: { swing: -0.18, out: 0.10, bend: -0.60 },
      armR: { swing: -0.18, out: -0.10, bend: -0.60 },
      legL: { thigh: -1.35, shin: 1.42, splay: 0.12 },
      legR: { thigh: -1.35, shin: 1.42, splay: 0.12 },
      seated: true,
    },
    eat: {
      torsoBend: -0.11, headBend: 0.12,
      armL: { swing: -0.24, out: 0.16, bend: -0.62 },
      armR: { swing: -0.50, out: -0.26, bend: -1.00 },  // 由 updateEat 週期性覆寫
      legL: { thigh: -1.35, shin: 1.42, splay: 0.12 },
      legR: { thigh: -1.35, shin: 1.42, splay: 0.12 },
      seated: true,
    },
    carry: {
      torsoBend: -0.04,
      armL: { swing: -0.34, out: 0.14, bend: -1.18 },
      armR: { swing: -0.26, out: -0.12, bend: -0.95 },
      legL: { splay: 0.07 }, legR: { splay: 0.07 },
      seated: false,
    },
    // 站在爐前調理：身體前傾看鍋、雙手在鍋上（updateCook 會加攪拌動作）
    cook: {
      torsoBend: -0.16, headBend: 0.24, torsoTwist: 0.04,
      legL: { splay: 0.09 }, legR: { splay: 0.09 },
      armL: { swing: -0.86, out: 0.26, bend: -1.15 },
      armR: { swing: -0.92, out: -0.22, bend: -1.28 },
      seated: false,
    },
  };
  return _POSE_DEFS;
}

const _STATE_KEYS = ['hipX', 'hipY', 'hipZ', 'hipYaw', 'hipRoll',
  'torsoBend', 'torsoTwist', 'torsoRoll', 'headBend', 'headYaw', 'headRoll'];

// 由中性站姿 + 姿勢加項算出目標狀態（中性值本身就是站姿）
function resolveTarget(def, neutral, seated, J) {
  const t = {
    hipX: neutral.hipX, hipY: neutral.hipY, hipZ: neutral.hipZ,
    hipYaw: 0, hipRoll: 0,
    torsoBend: 0, torsoTwist: 0, torsoRoll: 0,
    headBend: 0, headYaw: 0, headRoll: 0,
    legL: { ...neutral.legL }, legR: { ...neutral.legR },
    armL: { ...neutral.armL }, armR: { ...neutral.armR },
  };
  if (!def) return t;
  for (const k of _STATE_KEYS) {
    if (def[k] !== undefined) t[k] = neutral[k] + def[k];
  }
  for (const side of ['legL', 'legR', 'armL', 'armR']) {
    const d = def[side];
    if (!d) continue;
    for (const k in d) t[side][k] = neutral[side][k] + d[k];
  }
  // 腿的角度是絕對值（不繼承中性站姿）
  t.legL.thigh = def.legL && def.legL.thigh !== undefined ? def.legL.thigh : 0;
  t.legR.thigh = def.legR && def.legR.thigh !== undefined ? def.legR.thigh : 0;
  t.legL.shin = def.legL && def.legL.shin !== undefined ? def.legL.shin : 0;
  t.legR.shin = def.legR && def.legR.shin !== undefined ? def.legR.shin : 0;
  t.legL.foot = def.legL && def.legL.foot !== undefined ? def.legL.foot : 0;
  t.legR.foot = def.legR && def.legR.foot !== undefined ? def.legR.foot : 0;
  t.seated = !!seated;
  if (seated && J) t.hipZ = hipZFor(t, J);
  return t;
}

function lerpState(a, b, t, out) {
  for (const k of ['hipX', 'hipY', 'hipZ', 'hipYaw', 'hipRoll', 'torsoBend', 'torsoTwist', 'torsoRoll', 'headBend', 'headYaw', 'headRoll']) {
    out[k] = lerp(a[k], b[k], t);
  }
  for (const side of ['legL', 'legR', 'armL', 'armR']) {
    for (const k of Object.keys(out[side])) out[side][k] = lerp(a[side][k], b[side][k], t);
  }
  return out;
}

/* ── 姿勢動作 ── */
function updateWalk(g, ph, st, amp) {
  const A = (amp == null ? 1 : amp) * 0.52;
  const thighL = A * Math.sin(ph);
  const thighR = -thighL;
  const bendL = 0.12 + 0.60 * (0.5 - 0.5 * Math.cos(ph));
  const bendR = 0.12 + 0.60 * (0.5 - 0.5 * Math.cos(ph + Math.PI));
  st.legL.thigh = thighL;
  st.legR.thigh = thighR;
  st.legL.shin = bendL;
  st.legR.shin = bendR;
  st.legL.foot = -(thighL + bendL) - 0.05;
  st.legR.foot = -(thighR + bendR) - 0.05;
  // 上半身：反向擺手 + 軀幹扭轉 + 側傾
  st.armL.swing = -0.40 * Math.sin(ph);
  st.armR.swing = 0.40 * Math.sin(ph);
  st.armL.bend = -0.22 - 0.24 * (0.5 - 0.5 * Math.cos(ph));
  st.armR.bend = -0.22 - 0.24 * (0.5 - 0.5 * Math.cos(ph + Math.PI));
  st.torsoTwist = 0.075 * Math.sin(ph);
  st.hipYaw = -0.085 * Math.sin(ph);
  st.torsoBend = -0.045;
  st.headBend = 0.02 * Math.sin(2 * ph) + 0.01;
  st.headYaw = -0.05 * Math.sin(ph);
  st.torsoRoll = 0.02 * Math.sin(2 * ph);
  // 側向擺動（重心轉移）
  const J = g.userData.joints;
  st.hipX = 0.014 * Math.sin(ph) * (g.userData.isChild ? 1.3 : 1);
  // 髖部起伏：由「踩在地上那條腿（伸最長的那條）」決定。
  // legDrop 是該姿勢下髖→鞋底的垂直距離；站姿時等於 FEET，相差多少髖就升降多少。
  // 因此踩地那隻腳的鞋底剛好留在地面，另一條腿自然抬高。
  const rest = g.userData.legReach || 0.95;
  const shoe = g.userData.shoeDown || 0.039;
  const dR = legDrop(st.legR, J, shoe);
  const dL = legDrop(st.legL, J, shoe);
  st.hipY = (dR > dL ? dR : dL) - rest;
}

// 座姿：椅面（hipY 由座高決定）或地板／座墊（盤坐）
function updateSit(g, st, seatH, shoeDown) {
  const J = g.userData.joints;
  const s = g.scale.y || 1;
  const thighLen = J.hipY - J.kneeY;     // 髖 → 膝
  const shinLen = J.kneeY - J.ankleY;    // 膝 → 踝
  const floor = seatH < 0.25;

  st.legL.splay = floor ? 0.5 : 0.13;
  st.legR.splay = st.legL.splay;

  if (floor) {
    // 座墊：臀部落在座墊高度，雙腿往前伸、鞋底貼地
    st.hipY = (seatH + 0.075) / s - J.hipY;
    const abs = -1.45;                    // 大腿幾乎水平、微往下
    st.legL.thigh = abs; st.legR.thigh = abs;
    const yKnee = J.hipY + st.hipY - thighLen * Math.cos(abs);
    let cf = (yKnee - shoeDown) / shinLen;
    if (cf < -1) cf = -1; else if (cf > 1) cf = 1;
    const shinF = Math.acos(cf) - abs;
    st.legL.shin = shinF; st.legR.shin = shinF;
    st.legL.foot = -(abs + shinF); st.legR.foot = st.legL.foot;
    st.hipZ = 0;
    return;
  }

  // 一般座椅：大腿放平、髖降到座面高，膝角用閉式解讓鞋底剛好落地
  //   膝高   yKnee = yHip - thighLen·cos(θt)
  //   踝高   yAnkle = yKnee - shinLen·cos(θt + θs)，θs 為小腿「相對大腿」的角度
  const abs = -1.40;                      // 大腿與鉛直線的夾角（放平）
  const yHip = seatH / s;
  const yKnee = yHip - thighLen * Math.cos(abs);
  let c = (yKnee - shoeDown) / shinLen;
  if (c < -1) c = -1; else if (c > 1) c = 1;
  const shin = Math.acos(c) - abs;        // 相對角度
  st.legL.thigh = abs; st.legR.thigh = abs;
  st.legL.shin = shin; st.legR.shin = shin;
  st.legL.foot = -(abs + shin);           // 鞋底保持水平
  st.legR.foot = st.legL.foot;
  st.hipY = yHip - J.hipY;
  st.hipZ = hipZFor(st, J);
}

function updateWait(g, t, st) {
  const ph = t * 1.35;
  const s1 = Math.sin(ph);
  const s2 = Math.sin(ph * 0.5 + 1.1);
  st.hipX += 0.013 * s1;
  st.hipZ += 0.006 * s2;
  st.torsoRoll += 0.035 * s1;
  st.torsoTwist += 0.05 * s2;
  st.torsoBend += 0.012 * Math.sin(ph * 0.8);
  st.headRoll += 0.045 * Math.sin(ph * 0.7);
  st.headYaw += 0.17 * Math.sin(ph * 0.31 + 0.7);
  st.headBend += 0.022 * Math.sin(ph * 0.53);
  st.armL.swing += 0.05 * s1; st.armR.swing += -0.05 * s1;
  st.armL.out += 0.022 * Math.sin(ph * 0.9); st.armR.out += -0.022 * Math.sin(ph * 0.9);
  st.legL.thigh += 0.015 * s1; st.legR.thigh += -0.015 * s1;
}

function updateHappy(g, t, st) {
  const ph = t * 4.4;
  const b = Math.abs(Math.sin(ph));
  st.hipY += 0.020 * b;
  st.torsoTwist += 0.06 * Math.sin(ph * 0.5);
  st.headRoll += 0.07 * Math.sin(ph * 0.5 + 0.4);
  st.armL.swing += -0.13 * b; st.armR.swing += -0.13 * b;
  st.armL.out += 0.06 * b; st.armR.out += -0.06 * b;
  st.armL.bend += -0.10 * b; st.armR.bend += -0.10 * b;
  st.legL.shin += 0.05 * b; st.legR.shin += 0.05 * b;
}

function updateAngry(g, t, st) {
  st.torsoBend += 0.012 * Math.sin(t * 7.5);
  st.headRoll += 0.022 * Math.sin(t * 5.5);
  st.hipY += 0.004 * Math.sin(t * 7.5);
}

function updateEat(g, t, st, seated) {
  if (!seated) {
    st.armR.swing = -0.55;
    st.armR.bend = -1.10;
    st.armR.out = -0.10;
    return;
  }
  // 右手週期性地把食物送到嘴邊（reach: 0 = 在盤子上、1 = 到嘴邊）
  const cyc = (t * 0.62) % 1;
  const reach = 0.5 - 0.5 * Math.cos(cyc * Math.PI * 2);
  st.armR.swing = -1.02 + 0.40 * reach;
  st.armR.bend = -1.50 - 1.10 * reach;
  st.armR.out = -0.34;
  st.armL.swing = -0.30;
  st.armL.bend = -0.95;
  st.armL.out = 0.24;
  st.headBend += 0.06 * reach;
  st.torsoBend += 0.02 * reach;
}

// 調理：站在爐前，右手拿勺子攪拌（小圓周運動）、左手扶鍋，身體微微前後
function updateCook(g, t, st) {
  const ph = t * 2.2 + (g.userData.id % 5) * 0.7;
  st.armR.swing = -0.92 + 0.16 * Math.sin(ph);
  st.armR.out = -0.22 + 0.10 * Math.cos(ph);
  st.armR.bend = -1.28 + 0.15 * Math.sin(ph + 0.6);
  st.armR.across = 0.11 * Math.cos(ph);
  st.armL.swing = -0.86 + 0.09 * Math.sin(ph * 0.7 + 1.2);
  st.armL.out = 0.26 + 0.05 * Math.cos(ph * 0.7);
  st.armL.bend = -1.15 + 0.08 * Math.sin(ph * 0.5);
  st.torsoBend += -0.05 + 0.025 * Math.sin(ph);
  st.torsoTwist += 0.055 * Math.sin(ph * 0.5);
  st.headBend += 0.22 + 0.035 * Math.sin(ph * 0.9);
  st.headYaw += 0.05 * Math.sin(ph * 0.35);
}

function updateFace(g, name) {
  const ud = g.userData;
  if (!ud._faceTex || !canUseCanvas()) return;
  const expr = name === 'angry' ? 'angry' : name === 'happy' ? 'happy' : 'neutral';
  if (ud.faceExpression === expr) return;
  // 建立／取用該表情的貼圖，換掉臉部平面的材質
  const tex = faceTexture(ud.faceTextureKey, expr, ud.look);
  if (!tex) return;
  const m = faceMatOf(tex);
  if (ud.facePlane) ud.facePlane.material = m;
  if (ud.materials && ud.materials.indexOf(m) < 0) ud.materials.push(m);
  ud.faceExpression = expr;
  ud._faceTex = tex;
}

// 配件依姿勢 show/hide
function updateAccessories(g, name) {
  const ud = g.userData;
  const seated = name === 'sit' || name === 'eat';
  const hasMask = !!ud.look.hasMask;
  for (const m of ud.meshes) {
    if (m.userData.feature === 'mask') m.visible = hasMask && !seated && name !== 'eat';
    else if (m.userData.feature === 'tray') m.visible = name === 'carry';
  }
}

function applyPose(g, name, t) {
  const ud = g.userData;
  if (!ud || !ud.motion) return 0;
  const mo = ud.motion;
  const J = ud.joints;
  const neutral = ud.baseState;
  const defs = getPoseDefs();
  const def = defs[name] || defs.stand;
  const seated = !!(def && def.seated) || name === 'sit' || name === 'eat';
  const seatH = seated
    ? (ud.seatHeight != null ? Number(ud.seatHeight) : 0.45)
    : 0;

  if (!mo.init) {
    mo.init = true;
    mo.name = name; mo.prevName = name; mo.tPrev = t;
    const init = resolveTarget(def, neutral, seated, J);
    if (seated) updateSit(g, init, seatH, ud.shoeDown || 0.039);
    mo.target = init;
    mo.from = cloneState(init);
    mo.cur = cloneState(init);
  }
  if (name !== mo.name) {
    // 以「當下姿態」為起點做混合；走路循環切快一點，避免腳步打結
    mo.from = cloneState(mo.cur);
    mo.prevName = mo.name;
    mo.name = name;
    mo.blend.t = 0;
    mo.blend.dur = (name === 'walk' || mo.prevName === 'walk') ? 0.22 : 0.3;
  }

  ud.poseTime = t;
  ud._poseName = name;
  ud.seated = seated;

  // 目標姿勢（以乾淨的中性站姿為底，不會逐幀漂移）
  mo.target = resolveTarget(def, neutral, seated, J);

  // 混合進度只跟「姿勢切換」有關，與呼叫頻率無關 → 同樣的 t 得到同樣的結果
  mo.blend.t = (t <= mo.tPrev) ? 1 : Math.min(mo.blend.t + (t - mo.tPrev) / mo.blend.dur, 1);
  mo.tPrev = t;
  lerpState(mo.from, mo.target, smoothstep(0, 1, mo.blend.t), mo.cur);

  // 週期性動作直接覆寫（不做補間）
  const ph = t * 5.0 + (ud.id % 7) * 0.9;
  if (name === 'walk') updateWalk(g, ph, mo.cur, 1);
  else if (name === 'wait') updateWait(g, t, mo.cur);
  else if (name === 'happy') updateHappy(g, t, mo.cur);
  else if (name === 'angry') updateAngry(g, t, mo.cur);
  else if (name === 'eat') updateEat(g, t, mo.cur, seated);
  else if (name === 'cook') updateCook(g, t, mo.cur);

  if (seated) {
    updateSit(g, mo.cur, seatH, ud.shoeDown || 0.039);
  } else if (name !== 'walk') {
    mo.cur.hipY = 0;    // 站姿：雙腳踩地、無位移
    mo.cur.hipZ = 0;
  }

  const st = mo.cur;
  const parts = ud.parts;
  const rig = ud.rig;

  // ── 寫入骨架 ──
  parts.hips.position.set(st.hipX, J.hipY + st.hipY, st.hipZ);
  parts.hips.rotation.set(0, st.hipYaw, st.hipRoll);
  parts.torso.rotation.set(st.torsoBend, st.torsoTwist, st.torsoRoll);
  parts.head.rotation.set(st.headBend, st.headYaw, st.headRoll);

  const writeArm = (piv, elb, hand, d) => {
    piv.rotation.set(d.swing, 0, d.out);
    elb.rotation.x = d.bend;
    elb.rotation.z = d.across || 0;
    hand.rotation.z = -(d.across || 0) * 0.45;
  };
  if (rig) {
    writeArm(parts.armL, rig.elbowL, rig.handL, st.armL);
    writeArm(parts.armR, rig.elbowR, rig.handR, st.armR);
    writeLeg(parts.legL, rig.kneeL, rig.footL, st.legL);
    writeLeg(parts.legR, rig.kneeR, rig.footR, st.legR);
  } else {
    writeLeg(parts.legL, null, null, st.legL);
    writeLeg(parts.legR, null, null, st.legR);
  }

  updateFace(g, name);
  updateAccessories(g, name);
  swayLocks(g, st, t);

  return st.hipY;
}

function writeLeg(hipPiv, kneePiv, footPiv, d) {
  hipPiv.rotation.set(d.thigh, 0, d.splay || 0);
  if (kneePiv) kneePiv.rotation.x = d.shin;
  if (footPiv) footPiv.rotation.x = d.foot;
}

// 走路時頭髮／小配件的晃動
function swayLocks(g, st, t) {
  const ud = g.userData;
  if (!ud.fx || !ud.fx.length) return;
  for (let i = 0; i < ud.fx.length; i++) {
    const m = ud.fx[i];
    const tag = m.userData.fx;
    if (tag === 'tail') m.rotation.x = -0.34 + 0.10 * Math.sin(t * 5.2 + i);
    else if (tag === 'bun') m.rotation.z = 0.05 * Math.sin(t * 4.4 + i);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. 對外 API
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 設定姿勢。
 * @param {THREE.Group} group makeCharacter 的產物
 * @param {string} poseName 'stand'|'walk'|'sit'|'eat'|'wait'|'angry'|'happy'|'carry'
 * @param {number} [t] 經過的秒數（clock.elapsedTime）；週期性動作的相位來源
 * @returns {number} 目前的髖部垂直位移（walk 時即為身體起伏量，單位：公尺）
 */
export function setPose(group, poseName, t) {
  if (!group || !group.userData || !group.userData.motion) return 0;
  const name = getPoseDefs()[poseName] ? poseName : 'stand';
  const time = (typeof t === 'number' && isFinite(t)) ? t : group.userData.poseTime || 0;
  const d = applyPose(group, name, time);
  return d * (group.scale.y || 1);
}

/** 釋放這個角色擁有的 geometry / material / texture（共用快取會依引用計數處理） */
export function disposeCharacter(group) {
  if (!group) return;
  const ud = group.userData || {};
  const geos = new Set();

  group.traverse((o) => {
    if (o.isMesh) {
      geos.add(o.geometry);
      const m = o.material;
      if (m) {
        const e = matRef(m);
        if (e) {
          e.refs--;
          if (e.refs <= 0) {
            if (e.mat.map && e.mat.map.isCanvasTexture) {
              const te = faceTexEntry(e.mat.map);
              if (te) {
                te.refs--;
                if (te.refs <= 0) { te.tex.dispose(); _charTex.delete(te._key); }
              }
            }
            e.mat.dispose();
            _matCache.delete(e._key);
          }
        }
      }
    }
  });

  // 只釋放「只屬於這個角色」的幾何（快取共用的留著）
  for (const g of geos) {
    const n = _geomRef.get(g);
    if (n === undefined) { if (g && g.dispose) g.dispose(); continue; }
    const left = n - 1;
    if (left <= 0) {
      _geomRef.delete(g);
      if (g.userData && g.userData.__cacheKey) _geoCache.delete(g.userData.__cacheKey);
      g.dispose();
    } else {
      _geomRef.set(g, left);
    }
  }

  // 從圖上移除
  if (group.parent) group.parent.remove(group);
  while (group.children.length) group.remove(group.children[0]);
  group.userData.meshes = [];
}

/** 回報本模組支援的角色種類／姿勢／身高範圍 */
export function characterInfo() {
  return {
    kinds: CUSTOMER_KINDS.slice(),
    poses: POSES.slice(),
    heightRange: [1.0, 1.85],
    adultHeightRange: [1.55, 1.85],
    childHeightRange: [1.0, 1.3],
    roles: ['customer', 'staff'],
  };
}

/**
 * 把制服資料轉成 makeCharacter 的選項（直接注入 shirtColor / bottomColor / color）。
 * @param {{shirt?:string,pants?:string,vest?:string,accent?:string,hat?:string}} uniform
 */
export function uniformToOpts(uniform) {
  if (!uniform) return {};
  return {
    shirtColor: uniform.shirt || uniform.color,
    bottomColor: uniform.pants,
    vestColor: uniform.vest,
    accent: uniform.accent,
    hatColor: uniform.hat
  };
}

/** 為顧客加寵物回呼：回傳一個掛在 group 底下的寵物群組（無寵物回 null） */
export function makePet(kind, seed = 1) {
  const g = new THREE.Group();
  g.name = 'pet';
  const col = kind === 'dog' ? 0xc9a26b : kind === 'cat' ? 0x8a8078 : kind === 'rabbit' ? 0xe8e0d8 : 0xc9a26b;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
  if (kind === 'dog' || kind === 'cat') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.18, 4, 8), mat);
    body.position.y = 0.13; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat);
    head.position.set(0, 0.16, 0.13); head.castShadow = true; g.add(head);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
    nose.position.set(0, 0.15, 0.2); g.add(nose);
    for (const dz of [-0.05, 0.05]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 4), mat);
      ear.position.set(dz, 0.22, 0.1); g.add(ear);
    }
    if (kind === 'cat') {
      for (const sx of [-0.04, 0.04]) {
        const whisker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        whisker.position.set(sx * 2, 0.145, 0.18); g.add(whisker);
      }
    } else {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.08, 3, 5), mat);
      tail.position.set(0, 0.16, -0.16); tail.rotation.x = -0.9; g.add(tail);
    }
  } else if (kind === 'rabbit') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat);
    body.scale.set(1, 0.9, 1.1); body.position.y = 0.1; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
    head.position.set(0, 0.16, 0.06); head.castShadow = true; g.add(head);
    for (const sx of [-0.02, 0.02]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.07, 3, 5), mat);
      ear.position.set(sx, 0.24, 0.04); g.add(ear);
    }
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4a8ac0, roughness: 0.7 }));
    body.position.y = 0.18; body.castShadow = true; g.add(body);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshStandardMaterial({ color: 0x2a5a8a }));
    wing.position.set(0.04, 0.18, 0); wing.scale.set(1.3, 0.4, 1); g.add(wing);
  }
  g.scale.setScalar(0.7 + (seed % 5) * 0.04);
  return g;
}

export default {
  makeCharacter, setPose, disposeCharacter, characterInfo, uniformToOpts, makePet, CUSTOMER_KINDS
};
