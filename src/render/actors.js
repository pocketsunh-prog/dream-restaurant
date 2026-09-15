// ============================================================================
// actors.js — スプライトシート式の登場人物
//
//   assets/cherish-walk.png のような「横一列に並んだ歩行コマ」の畫像を読み込み、
//     1. 背景色（ベタ塗り）をクロマキーで透明にする
//     2. コマごとに切り出す（列の“中身がある範囲”を自動検出）
//     3. その場の足元座標に合わせて描く（歩行は 6 コマ循環、左右反転対応）
//   を担当する。手続き的に人物を描く sprites.js の drawPerson と差し替え可能で、
//   appearance.sheet に id を入れた顧客だけがこの見た目になる。
// ============================================================================

/** シート定義。bg は背景のベタ色（クロマキーで抜く色） */
export const ACTORS = {
  cherish: {
    id: 'cherish',
    name: 'Cherish',
    file: 'cherish-walk.png',
    bg: [110, 116, 134],
    /** 手続き的スプライト（32×48）に高さを合わせる倍率 */
    scale: 0.75,
    /** 座っているときに下へずらす量（px、拡大前） */
    seatDrop: 9,
  },
};

const state = new Map();     // id -> { frames:[canvas], w, h, ready, error }
let loadPromise = null;

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return cv;
}

/** モジュール自身の位置を基準にした URL（/tools/... からでも動く） */
function assetUrl(file) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('../../assets/' + file, import.meta.url).href;
    }
  } catch { /* fall through */ }
  return 'assets/' + file;
}

export function actorStatus(id) {
  const s = state.get(id);
  if (!s) return { id, state: 'unknown' };
  return { id, state: s.ready ? 'ready' : (s.error ? 'failed' : 'loading'), frames: s.frames ? s.frames.length : 0, error: s.error || '' };
}
export function actorReady(id) {
  const s = state.get(id);
  return !!(s && s.ready && s.frames && s.frames.length);
}
export function actorFrameCount(id) {
  const s = state.get(id);
  return s && s.frames ? s.frames.length : 0;
}

/** 全シートを読み込む（何度呼んでも 1 回だけ） */
export function loadActors() {
  if (loadPromise || typeof Image === 'undefined') return loadPromise;
  const jobs = Object.keys(ACTORS).map((id) => new Promise((resolve) => {
    const def = ACTORS[id];
    const rec = { frames: null, w: 0, h: 0, ready: false, error: '' };
    state.set(id, rec);
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth || img.width;
        const H = img.naturalHeight || img.height;
        const src = makeCanvas(W, H);
        if (!src) throw new Error('canvas を作れません');
        const sc = src.getContext('2d');
        sc.drawImage(img, 0, 0);
        const data = sc.getImageData(0, 0, W, H);
        const slices = sliceSheet(data, W, H, def);
        rec.frames = slices.frames;
        rec.w = slices.w;
        rec.h = slices.h;
        rec.ready = rec.frames.length > 0;
        if (!rec.ready) rec.error = 'コマを検出できませんでした';
      } catch (err) {
        rec.error = `解析エラー: ${err && err.message ? err.message : err}`;
      }
      resolve(rec);
    };
    img.onerror = () => {
      rec.error = '畫像を読み込めませんでした';
      resolve(rec);
    };
    img.src = assetUrl(def.file);
  }));
  loadPromise = Promise.all(jobs);
  return loadPromise;
}

/**
 * 1 枚のシートを背景クロマキー＋コマ分割する。
 * 背景色は四隅の色、コマ境界は「中身のある列」の連続區間から求める。
 */
function sliceSheet(imageData, W, H, def) {
  const d = imageData.data;
  const bg = def.bg || [d[0], d[1], d[2]];
  const dist = (i) => {
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const KEY_LO = 26;    // これ以下は完全に透明
  const KEY_HI = 72;    // これ以上は完全に不透明（間は縁のアンチエイリアスとして残す）

  // 中身のある列／行
  const colHas = new Uint8Array(W);
  const rowHas = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 16) continue;
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
    const cv = makeCanvas(boxW, boxH);
    if (!cv) break;
    const c = cv.getContext('2d');
    const out = c.createImageData(boxW, boxH);
    for (let y = 0; y < boxH; y++) {
      for (let x = 0; x < boxW; x++) {
        const sx = x0 + x;
        const sy = top + y;
        const o = (y * boxW + x) * 4;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) { out.data[o + 3] = 0; continue; }
        const i = (sy * W + sx) * 4;
        const srcA = d[i + 3];
        const dd = dist(i);
        let a2 = srcA;
        if (dd <= KEY_LO) a2 = 0;
        else if (dd < KEY_HI) a2 = Math.round(srcA * ((dd - KEY_LO) / (KEY_HI - KEY_LO)));
        out.data[o] = d[i];
        out.data[o + 1] = d[i + 1];
        out.data[o + 2] = d[i + 2];
        out.data[o + 3] = a2;
      }
    }
    c.putImageData(out, 0, 0);
    frames.push(cv);
  }
  return { frames, w: boxW, h: boxH, spans: spans.length };
}

/**
 * その場（足元座標）に 1 コマ描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} id シート id
 * @param {number} x 足元の中心 X（tileToScreen の px）
 * @param {number} y 足元の Y
 * @param {{pose?:string, phase?:number, dir?:string, seated?:boolean, out?:object}} opts
 */
export function drawActor(ctx, id, x, y, opts = {}) {
  const s = state.get(id);
  if (!ctx || !s || !s.ready) return null;
  const def = ACTORS[id] || { scale: 1, seatDrop: 0 };
  const o = opts || {};
  const n = s.frames.length;
  const pose = o.pose || 'walk';
  const phase = Number.isFinite(Number(o.phase)) ? Number(o.phase) : 0;
  let fi;
  if (pose === 'walk' || pose === 'carry') fi = ((phase % n) + n) % n;
  else if (pose === 'eat') fi = Math.min(1, n - 1);
  else fi = 0;
  const cv = s.frames[fi];
  const scale = def.scale || 1;
  const w = cv.width * scale;
  const h = cv.height * scale;
  const dx = Math.round(x - w / 2);
  // 足元合わせ（座っているときは少し下げる）
  const drop = o.seated ? (def.seatDrop || 0) * scale : 0;
  const dy = Math.round(y - h + drop);
  const flip = o.dir === 'W';
  ctx.save();
  if (flip) {
    ctx.translate(Math.round(x * 2), 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(cv, dx, dy, Math.round(w), Math.round(h));
  ctx.restore();
  const out = o.out || {};
  out.x = dx;
  out.y = dy;
  out.w = Math.round(w);
  out.h = Math.round(h);
  out.pose = pose;
  out.frame = fi;
  out.sheet = id;
  return out;
}

/** テスト用：読み込み状態を捨てる */
export function resetActors() {
  state.clear();
  loadPromise = null;
}

export default { ACTORS, loadActors, actorReady, actorStatus, actorFrameCount, drawActor, resetActors };
