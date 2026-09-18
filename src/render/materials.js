// ============================================================================
// materials.js — 和柄素材（ちよがみ風のパターン集）を床・壁の貼り材にする
//
//   assets/wagara-atlas.png は「柄の見本帳」で、格子状にたくさんの和柄が並んでいる。
//   この檔案はその 1 枚を読み込み、
//     1. 自動で格子を検出して 1 柄ずつ切り出す（切り出し時に外周の黒枠を落とす）
//     2. 等角（アイソメ）平面に貼るための CanvasPattern を作る
//   ところまでを担当する。実際に塗るのは floor.js（床のパス／壁のパス）。
//
//   為什麼要用 CanvasPattern：pattern.setTransform() で「柄の 1px が画面上でどれだけ
//   動くか」を指定できるので、床なら (32, 16) / (-32, 16) の等角基底、
//   壁なら横 (32, 16)・縦 (0, -1) の基底を渡せば、柄が面に沿って連続して流れる
//   （タイルごとに切り貼りしないので、柄の継ぎ目が出ない）。
//   基底は tile 尺寸に比例（iso.js の TILE_W / TILE_H から導出）させる：解析度を
//   上げても「1 柄が佔幾格」が変わらないので、柄の密度が同じに見える。
// ============================================================================

import { TILE_W, TILE_H } from './iso.js';

/**
 * 見本帳の URL。ページの場所（/tools/... など）に左右されないよう、
 * このモジュール自身の URL を基準に解決する（サブパス配信でも動く）。
 */
export const ATLAS_URL = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('../../assets/wagara-atlas.png', import.meta.url).href;
    }
  } catch { /* fall through */ }
  return 'assets/wagara-atlas.png';
})();

/** 分隔線とみなす明度（これ未満が 75% 以上続く行／列は「枠」） */
const GUTTER_LUMA = 46;
/** 切り出し時に外周から落とすピクセル数（柄の黒枠を消して継ぎ目を目立たなくする） */
const INSET = 3;
/** これより小さい断片は柄として採用しない（圖の端の半端な行を落とす） */
const MIN_CELL = 24;

/**
 * 等角平面の基底（pattern の 1px が畫面上で動く量）。
 * TILE_W / TILE_H に比例させる：地板の u は「tile の西→南の辺」＝(TILE_W/2, TILE_H/2)、
 * v は「西→北の辺」＝(−TILE_W/2, TILE_H/2)。壁は横 0.6 倍の緩い勾配、縦は固定。
 */
export const FLOOR_BASIS = { ux: TILE_W / 2, uy: TILE_H / 2, vx: -TILE_W / 2, vy: TILE_H / 2 };
export const WALL_L_BASIS = { ux: TILE_W * 0.3, uy: TILE_H * 0.3, vx: 0, vy: -0.42 };
export const WALL_R_BASIS = { ux: TILE_W * 0.3, uy: -TILE_H * 0.3, vx: 0, vy: -0.42 };

let atlas = null;              // { img, cells, cols, rows, cellW, cellH }
let state = 'idle';            // idle | loading | ready | failed
let lastError = '';            // 失敗した理由（UI／テストで表示する）
let diag = null;               // 検出結果の内訳（トラブルシュート用）
const listeners = [];
const cellCanvasCache = new Map();   // id -> canvas
const patternCache = new WeakMap();  // ctx -> Map(key -> CanvasPattern)

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w));
    cv.height = Math.max(1, Math.round(h));
    return cv;
  }
  return null;
}

/** 讀取狀態（測試與 UI 用） */
export function materialsStatus() {
  return { state, count: atlas ? atlas.cells.length : 0, url: ATLAS_URL, error: lastError, diag };
}
export function materialsReady() { return state === 'ready'; }

export function onMaterialsReady(cb) {
  if (typeof cb !== 'function') return;
  if (state === 'ready' || state === 'failed') { cb(materialCells()); return; }
  listeners.push(cb);
}

/** 全部柄（{ id, label, col, row, w, h }） */
export function materialCells() {
  return atlas ? atlas.cells.slice() : [];
}

export function materialById(id) {
  if (!id || !atlas) return null;
  return atlas.cells.find((c) => c.id === id) || null;
}

/* ------------------------------------------------------------ 格子の検出 */

/** 連續した「暗い行／列」を 1 本の分隔線にまとめ、その中心を返す */
function separators(dark, n, need) {
  const out = [];
  let run = -1;
  for (let i = 0; i < n; i++) {
    if (dark[i] >= need) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      out.push(Math.round((run + i - 1) / 2));
      run = -1;
    }
  }
  if (run >= 0) out.push(Math.round((run + n - 1) / 2));
  return out;
}

/** 由分隔線切出每一格的範圍（前後各加一條邊界線） */
function spans(seps, total) {
  const cuts = [0].concat(seps.filter((s) => s > 0 && s < total), [total]);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a >= MIN_CELL) out.push([a, b]);
  }
  return out;
}

/** 掃描整張圖，找出柄的格子（失敗就退回等分格子） */
function detectCells(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const colDark = new Float32Array(W);
  const rowDark = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      const i = row + x * 4;
      const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (l < GUTTER_LUMA) { colDark[x]++; rowDark[y]++; }
    }
  }
  const colSep = separators(colDark, W, H * 0.72);
  const rowSep = separators(rowDark, H, W * 0.72);
  let xs = spans(colSep, W);
  let ys = spans(rowSep, H);
  if (xs.length < 2 || ys.length < 2) {
    // 自動検出に失敗 → 10 × 6 の等分グリッドにフォールバック
    xs = [];
    ys = [];
    for (let i = 0; i < 10; i++) xs.push([Math.round((i * W) / 10), Math.round(((i + 1) * W) / 10)]);
    for (let j = 0; j < 6; j++) ys.push([Math.round((j * H) / 6), Math.round(((j + 1) * H) / 6)]);
  }
  const cells = [];
  for (let r = 0; r < ys.length; r++) {
    for (let c = 0; c < xs.length; c++) {
      const x = xs[c][0] + INSET;
      const y = ys[r][0] + INSET;
      const w = xs[c][1] - xs[c][0] - INSET * 2;
      const h = ys[r][1] - ys[r][0] - INSET * 2;
      if (w < MIN_CELL || h < MIN_CELL) continue;
      cells.push({ id: `waga-${c}-${r}`, label: `柄 ${String(cells.length + 1).padStart(2, '0')}`, col: c, row: r, x, y, w, h });
    }
  }
  return { cells, cols: xs.length, rows: ys.length, cellW: xs[0] ? xs[0][1] - xs[0][0] : W / 10, cellH: ys[0] ? ys[0][1] - ys[0][0] : H / 6 };
}

/** 見本帳の読み込み完了時に呼ぶフック（main.js からスプライトキャッシュ破棄を登録） */
let onAtlasLoaded = null;
export function setAtlasLoadedHook(fn) { onAtlasLoaded = typeof fn === 'function' ? fn : null; }

/** 載入見本帳（重複呼叫只會載入一次） */
export function loadAtlas(url = ATLAS_URL) {
  if (state === 'loading' || state === 'ready') return;
  if (typeof Image === 'undefined') { state = 'failed'; return; }
  state = 'loading';
  const img = new Image();
  // 同じオリジンの靜的ファイルなので crossOrigin は付けない
  // （付けるとサーバーが CORS ヘッダを返さない場合に読み込み自体が失敗する）
  img.onload = () => {
    try {
      const cv = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
      if (!cv) { state = 'failed'; return; }
      const c = cv.getContext('2d');
      c.drawImage(img, 0, 0);
      const grid = detectCells(c, cv.width, cv.height);
      diag = {
        w: cv.width, h: cv.height, cols: grid.cols, rows: grid.rows,
        cellW: Math.round(grid.cellW), cellH: Math.round(grid.cellH), cells: grid.cells.length
      };
      if (!grid.cells.length) { lastError = '格子を検出できませんでした'; state = 'failed'; return; }
      atlas = Object.assign({ img }, grid);
      state = 'ready';
    } catch (err) {
      console.warn('[materials] 見本帳の解析に失敗', err);
      lastError = `解析エラー: ${err && err.message ? err.message : err}`;
      state = 'failed';
    }
    const cbs = listeners.splice(0, listeners.length);
    for (const cb of cbs) { try { cb(materialCells()); } catch { /* ignore */ } }
    // すでにスプライトがキャッシュされている可能性があるので、描き直させる
    if (typeof onAtlasLoaded === 'function') onAtlasLoaded();
  };
  img.onerror = (e) => {
    lastError = '畫像を読み込めませんでした（404 / パス違い / CORS）';
    state = 'failed';
    void e;
    const cbs = listeners.splice(0, listeners.length);
    for (const cb of cbs) { try { cb([]); } catch { /* ignore */ } }
  };
  img.src = url;
}

/* ------------------------------------------------------------ 柄の切り出し */

/** 見本帳そのものの Image（UI の swatch 用） */
export function atlasImage() {
  return atlas ? atlas.img : null;
}

/** 1 柄ぶんの canvas（外周の黒枠を落としてある） */
export function cellCanvas(id) {
  if (!atlas || !id) return null;
  const hit = cellCanvasCache.get(id);
  if (hit) return hit;
  const cell = materialById(id);
  if (!cell) return null;
  const cv = makeCanvas(cell.w, cell.h);
  if (!cv) return null;
  const c = cv.getContext('2d');
  c.drawImage(atlas.img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
  cellCanvasCache.set(id, cv);
  return cv;
}

/**
 * 面に貼るための CanvasPattern。
 * @param {CanvasRenderingContext2D} ctx 塗る先のコンテキスト（pattern は ctx ごとに作る）
 * @param {string} id 柄の id
 * @param {{ux:number,uy:number,vx:number,vy:number}} basis pattern の 1px が動く畫面上的な量
 */
export function projectedPattern(ctx, id, basis) {
  if (!ctx || !atlas || !id) return null;
  const b = basis || FLOOR_BASIS;
  const key = `${id}|${b.ux},${b.uy},${b.vx},${b.vy}`;
  let per = patternCache.get(ctx);
  if (!per) { per = new Map(); patternCache.set(ctx, per); }
  const hit = per.get(key);
  if (hit) return hit;
  const cv = cellCanvas(id);
  if (!cv) return null;
  let pat = null;
  try { pat = ctx.createPattern(cv, 'repeat'); } catch { pat = null; }
  if (!pat) return null;
  // 等角基底へ變形（未対応の環境ではそのまま等倍で貼る）
  if (typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
    try { pat.setTransform(new DOMMatrix([b.ux, b.uy, b.vx, b.vy, 0, 0])); } catch { /* 等倍のまま */ }
  }
  per.set(key, pat);
  return pat;
}

/** 設定から「今この場で使う柄」を取り出す（未設定なら null） */
export function materialsOf(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    floor: typeof s.floorMat === 'string' && s.floorMat ? s.floorMat : null,
    wall: typeof s.wallMat === 'string' && s.wallMat ? s.wallMat : null
  };
}

/** 見本帳を読み込み直す（テスト用） */
export function resetMaterials() {
  atlas = null;
  state = 'idle';
  cellCanvasCache.clear();
}

export default {
  ATLAS_URL, FLOOR_BASIS, WALL_L_BASIS, WALL_R_BASIS,
  loadAtlas, materialsReady, materialsStatus, onMaterialsReady, setAtlasLoadedHook,
  materialCells, materialById, atlasImage, cellCanvas, projectedPattern, materialsOf, resetMaterials
};
