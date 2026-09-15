// ============================================================================
// petarea.js — ペットスペース（ドッグラン）の見た目
//   柵・芝生・水碗・フードボウル・フープ・おもちゃ・看板を素の THREE 幾何で組む。
//   矩形（area）は sim/pets.js の petAreaOf() が決めたものをそのまま使うので、
//   シミュレーション側の座標と畫面がずれない。
// ============================================================================
import * as THREE from 'three';
import * as Props from './props.js';
import { petSpotIn, PET_AREA_W, PET_AREA_D, PET_GAP_E, PET_GAP_N } from '../sim/pets.js';

/** 歩道（店の外）の地面の高さ。restaurant.js::buildOutside の歩道メッシュ上面と同じ */
export const SIDEWALK_Y = 0.02;

/** 遊び場の中の決定論的な 1 點（ペットやボールを置くのに使う） */
export function petPlaySpot(area, seed = 1) {
  return petSpotIn(area, seed);
}

function normalizeArea(area) {
  const a = area || {};
  const w = Number.isFinite(a.w) ? a.w : PET_AREA_W;
  const d = Number.isFinite(a.d) ? a.d : PET_AREA_D;
  const cx = Number.isFinite(a.cx) ? a.cx : (Number.isFinite(a.x) ? a.x : 0);
  const cz = Number.isFinite(a.cz) ? a.cz : (Number.isFinite(a.z) ? a.z : 0);
  return { x: cx, z: cz, w, d, cx, cz };
}

/** 影を落とす／受ける設定を一括で（俯瞰なので兩方立てる） */
function shadowize(obj) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

/**
 * 転がすボール（1 個だけ）。遊んでいるペットがいない間は restaurant.js が隠す。
 * @returns {THREE.Mesh} userData.radius に半徑を入れてある
 */
export function buildPetBall(parent, area) {
  const a = normalizeArea(area);
  const r = 0.11;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(r, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8443a, roughness: 0.45, metalness: 0.05 })
  );
  const mark = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.005, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.32),
    new THREE.MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.5 })
  );
  ball.add(mark);
  ball.position.set(a.cx, SIDEWALK_Y + r, a.cz);
  ball.castShadow = true;
  ball.receiveShadow = true;
  ball.userData.radius = r;
  ball.visible = false;
  if (parent) parent.add(ball);
  return ball;
}

/**
 * ペットスペース（ドッグラン）を組み立てる。
 * @param {THREE.Object3D} parent 追加先（restaurant.js は this.root を渡す）
 * @param {{x:number,z:number,w:number,d:number,cx?:number,cz?:number}} area 矩形（中心＋尺寸）
 * @param {{y?:number, ao?:Function}} [opts] y = 地面の高さ、ao = 接觸陰影を敷くヘルパ
 * @returns {THREE.Group} userData.ball に転がすボール、userData.area に矩形
 */
export function buildPetArea(parent, area, opts = {}) {
  const a = normalizeArea(area);
  const y = Number.isFinite(opts.y) ? opts.y : SIDEWALK_Y;
  const ao = typeof opts.ao === 'function' ? opts.ao : null;
  const grp = new THREE.Group();
  grp.name = 'petArea';
  grp.userData.area = a;

  const hw = a.w / 2, hd = a.d / 2;
  const x0 = a.cx - hw, x1 = a.cx + hw;
  const z0 = a.cz - hd, z1 = a.cz + hd;

  const grass = new THREE.MeshStandardMaterial({ color: 0x6d8c53, roughness: 0.96 });
  const sand = new THREE.MeshStandardMaterial({ color: 0xa89573, roughness: 0.98 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6b45, roughness: 0.78 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb08c5c, roughness: 0.68 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x7d828a, metalness: 0.55, roughness: 0.45 });
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.4, metalness: 0.2 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x6fb6d8, roughness: 0.2, metalness: 0.05 });
  const foodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.9 });
  const toyMat = new THREE.MeshStandardMaterial({ color: 0xe0c48a, roughness: 0.6 });

  /* 1) 地面：芝生（表面を歩道と同じ高さに合わせる）＋中央の砂地 */
  const surf = new THREE.Mesh(new THREE.BoxGeometry(a.w, 0.06, a.d), grass);
  surf.position.set(a.cx, y - 0.03, a.cz);
  surf.receiveShadow = true;
  grp.add(surf);
  const patch = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, a.w - 0.7), 0.02, Math.max(0.4, a.d - 0.5)), sand);
  patch.position.set(a.cx, y - 0.006, a.cz);
  patch.receiveShadow = true;
  grp.add(patch);

  /* 2) 柵（支柱＋横棒 2 段）。東側＝店の前から入る隙間、北側＝店に面した隙間 */
  const posts = [];
  const postGeo = new THREE.BoxGeometry(0.07, 0.46, 0.07);
  const addPost = (x, z) => {
    posts.push([x, z]);
    const m = new THREE.Mesh(postGeo, woodMat);
    m.position.set(x, y + 0.23, z);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
  };
  const addRailX = (xa, xb, z) => {
    const len = Math.abs(xb - xa);
    if (len < 0.15) return;
    for (const ry of [0.2, 0.38]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.035), railMat);
      m.position.set((xa + xb) / 2, y + ry, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    }
  };
  const addRailZ = (za, zb, x) => {
    const len = Math.abs(zb - za);
    if (len < 0.15) return;
    for (const ry of [0.2, 0.38]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, len), railMat);
      m.position.set(x, y + ry, (za + zb) / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    }
  };
  // 北側（店に面する）：中央を出入口として開ける
  const gapN = Math.min(PET_GAP_N, a.w - 0.6);
  addPost(x0, z0);
  addPost(a.cx - gapN / 2, z0);
  addPost(a.cx + gapN / 2, z0);
  addPost(x1, z0);
  addRailX(x0, a.cx - gapN / 2, z0);
  addRailX(a.cx + gapN / 2, x1, z0);
  // 南側（街に面する）：全部ふさぐ
  addPost(x0, z1);
  addPost(a.cx, z1);
  addPost(x1, z1);
  addRailX(x0, x1, z1);
  // 西側：全部ふさぐ
  addPost(x0, a.cz);
  addRailZ(z0, z1, x0);
  // 東側：北半分をペットの出入口にする（sim/pets.js も同じ値でここを通る）
  const gapE = Math.min(PET_GAP_E, a.d - 0.4);
  addPost(x1, z0 + gapE);
  addRailZ(z0 + gapE, z1, x1);

  /* 3) 水碗とフードボウル（西側の隅） */
  const bowlX = x0 + 0.42, bowlZ = z1 - 0.38;
  for (const [dx, mat, fillMat, top] of [[-0.14, bowlMat, waterMat, 0.008], [0.14, bowlMat, foodMat, 0.02]]) {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.075, 14), mat);
    bowl.position.set(bowlX + dx, y + 0.038, bowlZ);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    grp.add(bowl);
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.02, 14), fillMat);
    fill.position.set(bowlX + dx, y + 0.07 + top, bowlZ);
    grp.add(fill);
  }

  /* 4) フープ（くぐって遊ぶ輪）：走る向き（X）に直角に立てる */
  const hoop = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45, metalness: 0.15 }));
  ring.position.y = 0.5;
  ring.castShadow = true;
  hoop.add(ring);
  for (const sx of [-0.19, 0.19]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.34, 0.045), metal);
    leg.position.set(sx, 0.24, 0);
    leg.castShadow = true;
    hoop.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.24), metal);
    foot.position.set(sx, 0.06, 0);
    foot.receiveShadow = true;
    hoop.add(foot);
  }
  hoop.position.set(x1 - 0.5, y, a.cz + hd * 0.1);
  hoop.rotation.y = Math.PI / 2;
  grp.add(hoop);

  /* 5) おもちゃ：骨ガムと輪（転がすボールは別に 1 個） */
  const bone = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), toyMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.y = 0.035;
  shaft.castShadow = true;
  bone.add(shaft);
  for (const sx of [-0.1, 0.1]) {
    for (const sz of [-0.03, 0.03]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), toyMat);
      knob.position.set(sx, 0.035, sz);
      knob.castShadow = true;
      bone.add(knob);
    }
  }
  bone.position.set(a.cx + 0.7, y, z1 - 0.34);
  bone.rotation.y = 0.5;
  grp.add(bone);

  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.03, 8, 14),
    new THREE.MeshStandardMaterial({ color: 0x4a6b8a, roughness: 0.7 }));
  tyre.rotation.x = -Math.PI / 2;
  tyre.position.set(x0 + 0.5, y + 0.03, z0 + 0.42);
  tyre.castShadow = true;
  grp.add(tyre);

  const ball = buildPetBall(grp, a);

  /* 6) 看板（既存の signboard 道具）：北西の隅に立てる */
  const sx = x0 + 0.32, sz = z0 + 0.26;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 1.15, 10), woodMat);
  post.position.set(sx, y + 0.575, sz);
  post.castShadow = true;
  post.receiveShadow = true;
  grp.add(post);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), woodMat);
  bracket.position.set(sx, y + 1.1, sz + 0.12);
  bracket.castShadow = true;
  grp.add(bracket);
  let sign = null;
  try {
    if (typeof Props.makeSignboard === 'function') sign = Props.makeSignboard({ w: 0.7, h: 0.34, text: 'ペットスペース' });
  } catch { sign = null; }
  if (!sign || !sign.isObject3D) {
    // 道具が無いときの代用（素の板）
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.34, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 }));
    board.position.y = 0.17;
    sign = new THREE.Group();
    sign.add(board);
  }
  sign.position.set(sx, y + 0.55, sz);
  sign.rotation.y = -0.42;
  sign.scale.setScalar(0.92);
  shadowize(sign);
  grp.add(sign);

  /* 7) 接觸陰影（俯瞰でも接地感が出る） */
  if (ao) {
    ao(grp, a.cx, y + 0.004, a.cz, a.w * 0.5, a.d * 0.52, 0.5);
    ao(grp, sx, y + 0.006, sz, 0.26, 0.16, 0.7);
    for (const [px, pz] of posts) ao(grp, px, y + 0.006, pz, 0.11, 0.11, 0.6);
  }

  grp.userData.ball = ball;
  if (parent) parent.add(grp);
  return grp;
}

export default { buildPetArea, buildPetBall, petPlaySpot, SIDEWALK_Y };
