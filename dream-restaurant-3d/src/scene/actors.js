// ============================================================================
// actors.js — スプライトシート式の登場人物（billboard スプライト）
//
//   3D 版の人物は characters.js が手続き的に生成するが、「Cherish」だけは
//   assets/cherish-walk.png（6 コマの歩行スプライト）を使った **billboard スプライト**
//   として描く（ペーパーマリオ／オクトパスの旅方式）。
//
//   やっていること：
//     1. シートを読み込み、背景のベタ色（rgb 110,116,134）をクロマキーで透明化
//     2. 列の「中身がある範囲」を自動検出して 6 コマに切り出す
//     3. 左右反転版も作る（カメラが回るので、進行方向とカメラの右方向から反転を決める）
//     4. THREE.Sprite を返し、歩行コマを差し替える API を提供する
//
//   影は sprite に焼き込まれていないので、呼び出し側（restaurant.js）が
//   aoBlob / 接觸陰影を足して接地させる。
// ============================================================================
import * as THREE from 'three';

/** シート定義（ファイル・背景色・実身長 m） */
export const SHEETS = {
  cherish: {
    id: 'cherish',
    file: 'cherish-walk.png',
    bg: [110, 116, 134],
    height: 1.66,        // 3D 空間での身長（他の客と揃える）
    shadowR: 0.42,       // 接地影の半径
  },
};

const KEY_LO = 26;       // この距離以下は完全に透明（背景）
const KEY_HI = 72;       // この距離以上は完全に不透明（縁のアンチエイリアスは中間）

const state = new Map(); // id -> { ready, error, frames:[Texture], mirror:[Texture], aspect }
let loading = null;

/** モジュール自身の位置を基準にした URL（サブパス配信でも動く） */
function assetUrl(file) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('../../assets/' + file, import.meta.url).href;
    }
  } catch { /* fall through */ }
  return 'assets/' + file;
}

export function sheetStatus(id) {
  const s = state.get(id);
  if (!s) return { id, state: 'unknown' };
  return { id, state: s.ready ? 'ready' : (s.error ? 'failed' : 'loading'), frames: s.frames ? s.frames.length : 0, error: s.error || '' };
}
export function sheetReady(id) {
  const s = state.get(id);
  return !!(s && s.ready && s.frames && s.frames.length);
}
/** いま何コマあるか（テスト用） */
export function sheetFrameCount(id) {
  const s = state.get(id);
  return s && s.frames ? s.frames.length : 0;
}

/** 全シートを読み込む（何度呼んでも 1 回だけ・Promise を返す） */
export function loadSheets() {
  if (loading || typeof Image === 'undefined') return loading;
  const jobs = Object.keys(SHEETS).map((id) => new Promise((resolve) => {
    const def = SHEETS[id];
    const rec = { ready: false, error: '', frames: null, mirror: null, aspect: 0.7 };
    state.set(id, rec);
    const img = new Image();
    img.onload = () => {
      try {
        const sliced = sliceSheet(img, def);
        if (!sliced.frames.length) throw new Error('コマを検出できませんでした');
        rec.frames = sliced.frames.map((cv) => makeTexture(cv));
        rec.mirror = sliced.frames.map((cv) => makeTexture(mirrorCanvas(cv)));
        rec.aspect = sliced.w / sliced.h;
        rec.ready = true;
      } catch (err) {
        rec.error = `${err && err.message ? err.message : err}`;
      }
      resolve(rec);
    };
    img.onerror = () => { rec.error = '畫像を読み込めませんでした'; resolve(rec); };
    // 同じオリジンの靜的ファイルなので crossOrigin は不要
    img.src = assetUrl(def.file);
  }));
  loading = Promise.all(jobs);
  return loading;
}

function makeTexture(cv) {
  const t = new THREE.CanvasTexture(cv);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function mirrorCanvas(cv) {
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = cv.height;
  const c = out.getContext('2d');
  c.translate(cv.width, 0);
  c.scale(-1, 1);
  c.drawImage(cv, 0, 0);
  return out;
}

/** 1 枚のシートを背景クロマキー＋コマ分割して canvas の配列にする */
function sliceSheet(img, def) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sc = src.getContext('2d');
  sc.drawImage(img, 0, 0);
  const data = sc.getImageData(0, 0, W, H).data;
  const bg = def.bg || [data[0], data[1], data[2]];
  const dist = (i) => {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const colHas = new Uint8Array(W);
  const rowHas = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 16) continue;
      if (dist(i) > KEY_LO) { colHas[x] = 1; rowHas[y] = 1; }
    }
  }
  const spans = [];
  let run = -1;
  for (let x = 0; x < W; x++) {
    if (colHas[x]) { if (run < 0) run = x; }
    else if (run >= 0) { if (x - run >= 6) spans.push([run, x - 1]); run = -1; }
  }
  if (run >= 0 && W - run >= 6) spans.push([run, W - 1]);
  if (!spans.length) return { frames: [], w: 0, h: 0 };

  let top = H, bot = -1;
  for (let y = 0; y < H; y++) if (rowHas[y]) { if (y < top) top = y; if (y > bot) bot = y; }
  const maxW = spans.reduce((a, s) => Math.max(a, s[1] - s[0] + 1), 0);
  const boxW = maxW + 4;
  const boxH = Math.max(1, bot - top + 1);

  const frames = [];
  for (const [a, b] of spans) {
    const cx = Math.round((a + b) / 2);
    const x0 = cx - Math.round(boxW / 2);
    const cv = document.createElement('canvas');
    cv.width = boxW; cv.height = boxH;
    const c = cv.getContext('2d');
    const out = c.createImageData(boxW, boxH);
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        const sx = x0 + x, sy = top + y;
        const o = (y * boxW + x) * 4;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) { out.data[o + 3] = 0; continue; }
        const i = (sy * W + sx) * 4;
        const dd = dist(i);
        let alpha = data[i + 3];
        if (dd <= KEY_LO) alpha = 0;
        else if (dd < KEY_HI) alpha = Math.round(alpha * ((dd - KEY_LO) / (KEY_HI - KEY_LO)));
        out.data[o] = data[i];
        out.data[o + 1] = data[i + 1];
        out.data[o + 2] = data[i + 2];
        out.data[o + 3] = alpha;
      }
    }
    c.putImageData(out, 0, 0);
    frames.push(cv);
  }
  return { frames, w: boxW, h: boxH };
}

/* ------------------------------------------------------------ 3D 側 API */

/**
 * billboard スプライトを作る。
 * @param {string} id シート id（'cherish'）
 * @returns {THREE.Sprite|null}
 */
export function makeSheetCharacter(id) {
  const s = state.get(id);
  if (!s || !s.ready) return null;
  const def = SHEETS[id] || {};
  const h = def.height || 1.66;
  const w = h * (s.aspect || 0.7);
  const mat = new THREE.SpriteMaterial({
    map: s.frames[0],
    transparent: true,
    alphaTest: 0.35,
    depthWrite: true,
    toneMapped: false,     // 手描きスプライトの色をそのまま出す
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(w, h, 1);
  sp.center.set(0.5, 0);          // 足元が原点（y がそのまま床の高さになる）
  sp.userData.sheet = id;
  sp.userData.frame = 0;
  sp.userData.mirror = false;
  sp.userData.baseW = w;
  sp.userData.baseH = h;
  sp.userData.isSheetActor = true;
  sp.castShadow = false;
  sp.receiveShadow = false;
  return sp;
}

/**
 * コマと向きを差し替える。
 * @param {THREE.Sprite} sp makeSheetCharacter の產物
 * @param {number} frame 0..5（歩行コマ）
 * @param {boolean} mirror 左右反転（カメラが回っても自然に見えるように）
 */
export function setSheetFrame(sp, frame, mirror) {
  const s = state.get(sp?.userData?.sheet);
  if (!s || !s.ready) return false;
  const n = s.frames.length;
  const f = ((Math.round(frame) % n) + n) % n;
  const mir = !!mirror;
  if (sp.userData.frame === f && sp.userData.mirror === mir) return false;
  sp.userData.frame = f;
  sp.userData.mirror = mir;
  sp.material.map = mir ? s.mirror[f] : s.frames[f];
  sp.material.needsUpdate = true;
  return true;
}

/** テスト用：読み込み状態を捨てる */
export function resetSheets() {
  state.clear();
  loading = null;
}

export default {
  SHEETS, loadSheets, sheetReady, sheetStatus, sheetFrameCount,
  makeSheetCharacter, setSheetFrame, resetSheets,
};
