// src/render/streetfx.js
// 《夢幻西餐廳》復刻 — 店外街景（騎樓／人行道／馬路／街具）高品質程序化繪製。
//
// 設計原則（與全檔一致的 1998 VGA 硬邊風格）：
//   ‧ 一律用 canvas 2D 的硬邊矩形／多邊形／掃描線；不用漸層、不用 alpha 漸變、
//     不用反鋸齒、不用陰影模糊。明暗靠「色票階」堆疊。
//   ‧ 座標一律由 iso.js 的 TILE_W / TILE_H / ORIGIN_* 推導，不寫死像素尺寸。
//     這裡只用「等角基向量」u = (TILE_W/2, TILE_H/2)、v = (-TILE_W/2, TILE_H/2)，
//     所以換解析度時街景會等比跟著放大。
//   ‧ 全部是靜態層 → 烤成一張離屏 canvas 後用 drawImage 貼上（每影格 1 次），
//     只有「夜晚路燈光池」是動態的（每次 drawImage 一張快取的網點圓）。
//
// 這個檔案不 import floor.js / sprites.js（避免循環依賴）；需要畫路燈光池時
// 由呼叫端把 sprites.js 的 drawLightPool 傳進來。

import { PALETTE, color, ditherPattern, DITHER } from './palette.js';
import {
  TILE_W, TILE_H, HALF_W, HALF_H, LOGICAL_W, LOGICAL_H, roomSilhouette,
} from './iso.js';

// ---------------------------------------------------------------------------
// 可調參數（本檔案自己的常數：不寫進 core/balance.js，避免與其他模組衝突）
// ---------------------------------------------------------------------------

/** 人行道外緣距房間外牆的格數（＝騎樓寬度）。 */
export const WALK_OUT = 2.5;
/** 路緣石（kerb）佔的格數。 */
export const KERB_W = 0.34;
/** 導盲磚（tactile paving）帶寬（格）。 */
export const TACTILE_W = 0.4;
/** 導盲磚外緣距房間外牆的格數。 */
export const TACTILE_AT = WALK_OUT - KERB_W - TACTILE_W - 0.05;
/** 人行道磚縫（每幾格一道）。 */
export const PAVE_JOINT_STEP = 0.5;
/** 柏油顆粒網點：用「先縮小再放大」做出柔和的骨材感（仍是硬邊色票）。 */
export const ASPHALT_MOTTLE = true;

const X8 = 8;
const Y8 = 4;

/** 以 iso 格數（u = x - y、s = x + y）取螢幕座標。 */
function pt(cx, cy, u, s) {
  return { x: cx + u * HALF_W, y: cy + s * HALF_H };
}

function hash32(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 決定性 0..1 亂數（同一 seed 永遠同一個街景）。 */
function rnd(seed) {
  return hash32(seed) / 4294967296;
}

function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return '#' + (((1 << 24)
    | (Math.round(A.r + (B.r - A.r) * k) << 16)
    | (Math.round(A.g + (B.g - A.g) * k) << 8)
    | Math.round(A.b + (B.b - A.b) * k)) >>> 0).toString(16).slice(1);
}

const HEXC = new Map();
function hex(v) {
  const s = color(v);
  const hit = HEXC.get(s);
  if (hit) return hit;
  let t = s.charCodeAt(0) === 35 ? s.slice(1) : '000000';
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  const n = parseInt(t.slice(0, 6), 16) || 0;
  const o = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  if (HEXC.size < 256) HEXC.set(s, o);
  return o;
}

// ---------------------------------------------------------------------------
// 繪圖小工具（全部整數、硬邊）
// ---------------------------------------------------------------------------

function fillPoly(ctx, pts, col) {
  if (!pts || pts.length < 3) return;
  ctx.fillStyle = color(col);
  ctx.beginPath();
  ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
  ctx.closePath();
  ctx.fill();
}

function strokePoly(ctx, pts, col, lw) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = color(col);
  ctx.lineWidth = Math.max(1, lw || 1);
  ctx.beginPath();
  ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
  ctx.stroke();
}

/** 多邊形路徑（不填不描，供 clip 用）。 */
function polyPath(ctx, pts, rectW, rectH) {
  ctx.beginPath();
  if (rectW) ctx.rect(0, 0, rectW, rectH);
  if (pts && pts.length >= 3) {
    ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
    ctx.closePath();
  }
}

// ---------------------------------------------------------------------------
// 主題（依 locations.js 已存在的欄位推導；該檔不可修改）
//   主要用 decorStyle / skyline，其次用 palette.accent（色相）與
//   rentPerDay / baseTraffic（貴的商圈 → 玻璃帷幕、明亮招牌；夜市 → 帆布棚、燈籠）。
// ---------------------------------------------------------------------------

const THEMES = {
  nightmarket: {
    asphalt: '#332f2a', asphalt2: '#3b3630', lane: '#f0e2a6', lane2: '#8f8a5e',
    walk: '#a49a89', walkJ: '#7f7768', walkHi: '#b3a998', kerb: '#c4bbaa', kerbLo: '#6e675a',
    tactile: '#c9a95a', gutter: '#241f1a', drain: '#6b6257',
    shopWall: ['#7a4a34', '#6b3f2c', '#8a5a3e'], awning: ['#c2452f', '#2f8f86', '#d99a2b', '#3a6ea5'],
    glass: '#2a3b52', sign: ['#ff9a2e', '#e8552e', '#ffe23c'], clutter: 'stall',
    propHue: 'red', vendor: '#d63a2c', fav: 'vending',
  },
  nightmarket2: {
    asphalt: '#2f2b29', asphalt2: '#383330', lane: '#f2e2ae', lane2: '#8a8158',
    walk: '#9e9288', walkJ: '#7a7168', walkHi: '#ada197', kerb: '#bdb0a0', kerbLo: '#685e52',
    tactile: '#c9a95a', gutter: '#221d1a', drain: '#685e53',
    shopWall: ['#6d3a4a', '#5c3240', '#7d4655'], awning: ['#e0457b', '#c62a86', '#ff9a2e', '#5a7cff'],
    glass: '#2b2a44', sign: ['#ff5aa8', '#c62a86', '#ffe23c'], clutter: 'stall',
    propHue: 'pink', vendor: '#c62a86', fav: 'vending',
  },
  harbor: {
    asphalt: '#363a3e', asphalt2: '#3e4347', lane: '#efeada', lane2: '#93917c',
    walk: '#a8adb0', walkJ: '#878c90', walkHi: '#b6bbbe', kerb: '#c9cfd2', kerbLo: '#6a7176',
    tactile: '#c4a95c', gutter: '#272c31', drain: '#6d7478',
    shopWall: ['#8a8f92', '#767c80', '#9aa0a3'], awning: ['#2f8fb5', '#1d7a74', '#b9c3c9', '#3a6ea5'],
    glass: '#28394a', sign: ['#2f8fb5', '#5ce8ff', '#bcbcb4'], clutter: 'crates',
    propHue: 'teal', vendor: '#2f8fb5', fav: 'vendfish',
  },
  office: {
    asphalt: '#3a3733', asphalt2: '#423f39', lane: '#efe6b8', lane2: '#96906c',
    walk: '#aaa59d', walkJ: '#89847b', walkHi: '#b9b4ab', kerb: '#cbc6bd', kerbLo: '#6d6860',
    tactile: '#c9a95a', gutter: '#2a2722', drain: '#767065',
    shopWall: ['#8b8474', '#77705f', '#9c9482'], awning: ['#c9a227', '#8a6338', '#c2a97a', '#3a6ea5'],
    glass: '#2d3a4c', sign: ['#c9a227', '#ffe23c', '#e6e6dc'], clutter: 'bikes',
    propHue: 'gray', vendor: '#c9a227', fav: 'coffee',
  },
  mall: {
    asphalt: '#3d3a34', asphalt2: '#45423b', lane: '#f4ebc9', lane2: '#9a9273',
    walk: '#bcae92', walkJ: '#9a8f79', walkHi: '#c9bba1', kerb: '#dbcdb1', kerbLo: '#83785f',
    tactile: '#c9a95a', gutter: '#2c2820', drain: '#7d7462',
    shopWall: ['#c0b48f', '#a89d7a', '#d2c6a2'], awning: ['#a8562f', '#d99a2b', '#e0d3b0', '#2f8f86'],
    glass: '#333f3a', sign: ['#ffd98a', '#ffe9c0', '#a8562f'], clutter: 'planters',
    propHue: 'org', vendor: '#a8562f', fav: 'vending',
  },
  fashion: {
    asphalt: '#34333c', asphalt2: '#3c3b45', lane: '#efe8c8', lane2: '#98937a',
    walk: '#b0acbb', walkJ: '#8f8b9a', walkHi: '#bfbbc9', kerb: '#d2cedd', kerbLo: '#726e80',
    tactile: '#c4a95c', gutter: '#25242c', drain: '#767284',
    shopWall: ['#6a6478', '#5b5668', '#7d7589'], awning: ['#00b3b0', '#ff5aa8', '#5a7cff', '#ffe23c'],
    glass: '#20293f', sign: ['#5ce8ff', '#ff5aa8', '#ffe23c'], clutter: 'bikes',
    propHue: 'cyan', vendor: '#00b3b0', fav: 'drink',
  },
  plain: {
    asphalt: '#37342f', asphalt2: '#3f3c36', lane: '#e8e0ba', lane2: '#8f8a6c',
    walk: '#a49c8e', walkJ: '#847d71', walkHi: '#b2aa9c', kerb: '#c5bdb0', kerbLo: '#6a6459',
    tactile: '#c9a95a', gutter: '#26221d', drain: '#6f675c',
    shopWall: ['#7d7260', '#6a6050', '#8e8371'], awning: ['#8a6338', '#2f8f86', '#c2a97a', '#c2452f'],
    glass: '#2c3746', sign: ['#ffe23c', '#e8552e', '#bcbcb4'], clutter: 'planters',
    propHue: 'gray', vendor: '#8a6338', fav: 'vending',
  },
};

const THEME_ALIAS = {
  nightstreet: 'nightmarket2', night_market: 'nightmarket', port: 'harbor', harbour: 'harbor',
  cram_school: 'office', department: 'mall', department_store: 'mall', downtown: 'fashion',
  xinkujiang: 'fashion', none: 'plain', hills: 'plain',
};

/**
 * 由 skyline / decorStyle 取得街道主題。
 * 兩者皆缺時用 palette.accent 的色相推一個主題（比 rent 更穩定，且仍是已存在的欄位）。
 */
export function streetTheme(skyline, decorStyle, palette) {
  const pick = (v) => {
    if (typeof v !== 'string' || !v) return null;
    const k = v.toLowerCase();
    const a = THEME_ALIAS[k] || k;
    return THEMES[a] ? a : null;
  };
  let key = pick(skyline) || pick(decorStyle);
  if (!key && palette && typeof palette.accent === 'string') {
    const { r, g, b } = hex(palette.accent);
    if (b > r && b > g) key = 'harbor';
    else if (g >= r && g > b) key = 'mall';
    else if (r > 150 && g < 110) key = 'nightmarket2';
    else key = 'nightmarket';
  }
  return THEMES[key || 'nightmarket'];
}

// ---------------------------------------------------------------------------
// 街具位置表（以 iso 格座標；u = x - y、s = x + y 由呼叫端換算）
//   side: 'W' = 畫面上半（人行道 u 負向那一側）、'S' = 畫面右側、'N' = 左上側
// ---------------------------------------------------------------------------

export const STREET_PROP_PLAN = [
  // 人行道中央（畫面左上側＝主要展示面）
  { kind: 'lamp', side: 'N', along: 0.15, off: -0.05, pool: true },
  { kind: 'lamp', side: 'N', along: 0.5, off: -0.05, pool: true },
  { kind: 'lamp', side: 'N', along: 0.84, off: -0.05, pool: true },
  { kind: 'vending', side: 'N', along: 0.27, off: -0.35 },
  { kind: 'signboard', side: 'N', along: 0.63, off: -0.3 },
  { kind: 'bench', side: 'N', along: 0.9, off: -0.4 },
  { kind: 'rack', side: 'N', along: 0.37, off: -0.15 },
  { kind: 'pot', side: 'N', along: 0.06, off: -0.35 },
  { kind: 'pot', side: 'N', along: 0.71, off: -0.15 },
  { kind: 'hydrant', side: 'N', along: 0.53, off: -0.5 },
  { kind: 'bike', side: 'N', along: 0.44, off: -0.75 },
  { kind: 'bin', side: 'N', along: 0.2, off: -0.7 },
  // 畫面右側人行道
  { kind: 'vending', side: 'S', along: 0.3, off: -0.3 },
  { kind: 'signboard', side: 'S', along: 0.56, off: -0.15 },
  { kind: 'pot', side: 'S', along: 0.72, off: -0.35 },
  { kind: 'planter', side: 'S', along: 0.16, off: -0.45 },
  { kind: 'traffic', side: 'S', along: 0.9, off: -0.45 },
  { kind: 'bike', side: 'S', along: 0.42, off: -0.7 },
  { kind: 'bollard', side: 'S', along: 0.65, off: -0.75 },
  // 馬路上（三角形路肩，較遠）
  { kind: 'cone', side: 'N', along: 0.2, off: -1.6, road: true },
  { kind: 'cone', side: 'N', along: 0.26, off: -1.75, road: true },
  { kind: 'drain', side: 'N', along: 0.45, off: 0.17 },
  { kind: 'drain', side: 'S', along: 0.66, off: 0.17 },
  { kind: 'manhole', side: 'N', along: 0.67, off: -0.5 },
  { kind: 'manhole', side: 'S', along: 0.42, off: -0.65 },
];

export const STREET_LAMP_STYLE = {
  nightmarket: { arm: 1, colour: 'lamp_hi' },
  nightmarket2: { arm: 1, colour: 'neon_pink' },
  harbor: { arm: 0, colour: 'neon_cyan' },
  office: { arm: 1, colour: 'lamp_hi' },
  mall: { arm: 0, colour: 'lamp_hi' },
  fashion: { arm: 1, colour: 'neon_cyan' },
  plain: { arm: 0, colour: 'lamp_hi' },
};

/** 把 STREET_PROP_PLAN 的一項換成格座標（u, s）。 */
function planAt(item, gw, gh) {
  const sWalk = WALK_OUT + 0.55; // 人行道中央
  if (item.side === 'N') {
    return { u: -gw + 1 + item.along * (gw + gh - 2), s: -sWalk + item.off };
  }
  return { u: gh - 1 - item.along * (gw + gh - 2), s: sWalk + item.off };
}

// ---------------------------------------------------------------------------
// 房間保護遮罩：把「房間（含外牆）」以外的區域挖出來
//   北／東側外牆 0.5 格、南／西側矮牆 1.5 格 → 只會蓋到店外，店內每個像素都不受影響
//   （weather-clip / night-crisp 兩個測試都靠這件事）。
// ---------------------------------------------------------------------------

/**
 * 房間保護遮罩：把「房間（含外牆）」以外的區域挖出來。
 * 以格座標：北／東側外牆外 0.5 格、南／西側矮牆外 1.5 格 → 只會蓋到店外，
 * 店內每個像素都不受影響（weather-clip / night-crisp 兩個測試都靠這件事）。
 */
/**
 * 房間保護遮罩（在 iso 的 (u,s) 座標＝x−y / x+y 上）。
 *
 * 店外的區域在 (u,s) 平面是「菱形的補集」，不是凸多邊形，所以不能用單一 4 邊形，
 * 而是「四個額外半平面 ∪ 起來」——用 even-odd 填色把四塊互相重疊的區域疊起來，
 * 重疊的地方被蓋兩次 → 剛好抵銷，結果正好等於菱形以外的區域。
 *
 * 半平面的內縮量：北／東側是外牆（房間輪廓已含牆面）→ 只外擴 0.25 格；
 * 南／西側是矮牆，外牆面已經外擴 0.5 格 → 外擴 0.25 格仍然完全在店外。
 * 因此店內「每一個像素」都不會被遮罩蓋到（weather-clip / night-crisp 靠這件事）。
 */
/**
 * 把目前裁剪區域限制成「房間以外」。
 *
 * 店外的區域在 iso 的 (u,s) 平面是菱形的補集，不是凸多邊形；這裡用
 * 「四次依序 clip」＝四個半平面的交集（intersect）來做，語意明確且不需要 even-odd：
 * 呼叫端必須先 ctx.save()，畫完街景後再 ctx.restore()。
 * 內縮量：北／東側外牆外 0.25 格、南／西側矮牆外 0.25 格（牆面本身已經外擴 0.5 格），
 * 因此店內每一個像素都不會被影響。
 */
export function clipOutsideShop(ctx, gw, gh, originX, originY, W, H) {
  const cx = originX + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = originY + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  // 內縮量 0.6 格：北／東側外牆的面本來就外擴 0.5 格、南／西側矮牆外擴 1.5 格，
  // 所以 0.6 仍然完全在店內之外（不會切到店內任何像素），但可以把牆體在畫面角落
  // 「差 1px 沒蓋到輪廓」的縫隙一起遮掉。
  const A = (gw - 1) / 2 + 1.0;
  const B = (gh - 1) / 2 + 1.0;
  // FAR 要大到足以覆蓋整個畫布：畫布的 u/s 範圍約 ±(W/2)/HALF_W
  const FAR = 12 + Math.max(num(W, LOGICAL_W) / HALF_W, num(H, LOGICAL_H) / HALF_H);
  const quad = (u0, s0, u1, s1) => {
    const a = pt(cx, cy, u0, s0);
    const b = pt(cx, cy, u1, s0);
    const c = pt(cx, cy, u1, s1);
    const d = pt(cx, cy, u0, s1);
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
    ctx.lineTo(Math.round(c.x), Math.round(c.y));
    ctx.lineTo(Math.round(d.x), Math.round(d.y));
    ctx.closePath();
    ctx.clip();
  };
  quad(A, -FAR, FAR, FAR);      // 東：u >= A
  quad(-FAR, -FAR, -A, FAR);    // 西：u <= -A
  quad(-FAR, B, FAR, FAR);      // 南：s >= B
  quad(-FAR, -FAR, FAR, -B);    // 北：s <= -B
}

/**
 * 同上，但以「路徑」形式加入（供需要自行 fill 的場合／測試比對用）。
 * 注意：這是四個重疊矩形的聯集，必須搭配 even-odd 或逐一 clip 才有正確語意。
 */
export function addShopMaskPath(ctx, gw, gh, originX, originY, W, H) {
  const cx = originX + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = originY + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  const A = (gw - 1) / 2 + 0.25;
  const B = (gh - 1) / 2 + 0.25;
  const FAR = 12 + Math.max(num(W, LOGICAL_W) / HALF_W, num(H, LOGICAL_H) / HALF_H);
  const quad = (u0, s0, u1, s1) => {
    const a = pt(cx, cy, u0, s0);
    const b = pt(cx, cy, u1, s0);
    const c = pt(cx, cy, u1, s1);
    const d = pt(cx, cy, u0, s1);
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
    ctx.lineTo(Math.round(c.x), Math.round(c.y));
    ctx.lineTo(Math.round(d.x), Math.round(d.y));
    ctx.closePath();
  };
  quad(A, -FAR, FAR, FAR);
  quad(-FAR, -FAR, -A, FAR);
  quad(-FAR, B, FAR, FAR);
  quad(-FAR, -FAR, FAR, -B);
}

function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** 四個外牆的半平面取樣（測試／除錯用）。 */
export function shopMaskPoly(gw, gh, originX, originY) {
  const cx = originX + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = originY + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  const A = (gw - 1) / 2 + 0.25;
  const B = (gh - 1) / 2 + 0.25;
  return [
    pt(cx, cy, A, -B), pt(cx, cy, A, B), pt(cx, cy, -A, B), pt(cx, cy, -A, -B),
  ];
}

// ---------------------------------------------------------------------------
// 1) 路面
// ---------------------------------------------------------------------------

/** 柏油骨材底紋：一張夠大的無縫貼圖（亂數散布的色階小塊），重複感低。 */
let asphaltTexCache = null;
function asphaltTexture(T) {
  const key = T.asphalt + T.asphalt2 + T.gutter;
  if (asphaltTexCache && asphaltTexCache.key === key) return asphaltTexCache.cv;
  const S = 512;
  const cv = makeCanvas(S, S);
  const c = cv && cv.getContext('2d');
  if (!c) return null;
  c.fillStyle = color(T.asphalt);
  c.fillRect(0, 0, S, S);
  const cols = [T.asphalt, T.asphalt, T.asphalt2, T.asphalt2,
    mix(T.asphalt, 'white', 0.08), mix(T.asphalt, 'black', 0.12), T.gutter];
  // 大塊色差（低頻）
  for (let i = 0; i < 90; i++) {
    const x = (rnd(i * 13 + 1) * S) | 0;
    const y = (rnd(i * 29 + 5) * S) | 0;
    const w = 10 + ((rnd(i * 7 + 3) * 40) | 0);
    const h = 6 + ((rnd(i * 11 + 9) * 26) | 0);
    c.fillStyle = color(cols[(rnd(i * 17) * cols.length) | 0]);
    c.fillRect(x, y, w, h);
    c.fillRect(x - S, y, w, h);
    c.fillRect(x, y - S, w, h);
    c.fillRect(x - S, y - S, w, h);
  }
  // 骨材粒（高頻 1–2px）
  for (let i = 0; i < S * S * 0.22; i++) {
    const x = (rnd(i * 3 + 101) * S) | 0;
    const y = (rnd(i * 5 + 202) * S) | 0;
    const v = rnd(i * 7 + 303);
    c.fillStyle = color(v > 0.78 ? mix(T.asphalt, 'white', 0.22)
      : v > 0.42 ? T.asphalt2 : mix(T.asphalt, 'black', 0.3));
    c.fillRect(x, y, v > 0.9 ? 2 : 1, 1);
  }
  // 車轍方向的細長磨痕（低對比、略透明）
  c.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    const x = (rnd(i * 19 + 71) * S) | 0;
    const y = (rnd(i * 23 + 83) * S) | 0;
    const len = 8 + ((rnd(i * 31 + 97) * 30) | 0);
    c.fillStyle = color(i % 2 ? T.asphalt2 : T.gutter);
    c.fillRect(x, y, len, 1);
  }
  c.globalAlpha = 1;
  asphaltTexCache = { key, cv };
  return cv;
}

function paintAsphalt(ctx, T, W, H, seed) {
  ctx.fillStyle = color(T.asphalt);
  ctx.fillRect(0, 0, W, H);
  // 修補面／色差塊：等比變暗或變亮（硬邊多邊形）
  for (let i = 0; i < 26; i++) {
    const rx = (rnd(seed + i * 17) * (W + 200)) - 100;
    const ry = (rnd(seed + i * 31 + 5) * (H + 160)) - 80;
    const rw = 60 + rnd(seed + i * 53 + 9) * 190;
    const rh = 26 + rnd(seed + i * 71 + 3) * 70;
    const dark = rnd(seed + i * 91) > 0.5;
    ctx.fillStyle = color(dark ? T.asphalt2 : mix(T.asphalt, 'black', 0.18));
    ctx.beginPath();
    ctx.moveTo(Math.round(rx + 6), Math.round(ry));
    ctx.lineTo(Math.round(rx + rw - 8), Math.round(ry));
    ctx.lineTo(Math.round(rx + rw), Math.round(ry + rh));
    ctx.lineTo(Math.round(rx), Math.round(ry + rh));
    ctx.closePath();
    ctx.fill();
    // 補丁邊緣的深色接縫
    ctx.fillStyle = color(T.gutter);
    ctx.fillRect(Math.round(rx + 4), Math.round(ry), Math.round(rw - 10), 1);
  }
  // 骨材貼圖：整張貼上去（單次 pattern 填色）
  const tex = asphaltTexture(T);
  if (tex && typeof ctx.createPattern === 'function') {
    let pat = null;
    try { pat = ctx.createPattern(tex, 'repeat'); } catch (e) { pat = null; }
    if (pat) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = prev;
    }
  }
  // 車轍痕（沿畫面水平方向的長條磨亮／磨黑帶）
  for (let i = 0; i < 10; i++) {
    const y = Math.round(rnd(seed + 500 + i * 13) * H);
    const h = 2 + ((rnd(seed + 600 + i * 17) * 4) | 0);
    ctx.fillStyle = color(i % 2 ? mix(T.asphalt, 'white', 0.06) : T.asphalt2);
    ctx.fillRect(0, y, W, h);
  }
  // 柏油橫向施工縫（每 3 格一道）
  ctx.strokeStyle = color(T.gutter);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -14; k <= 14; k += 3) {
    const s = k + 0.5;
    const a = pt(0, 0, -(gwAbs + 14), s);
    const b = pt(0, 0, gwAbs + 14, s);
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
  }
  ctx.stroke();
  // 裂縫（幾條折線）
  ctx.strokeStyle = color(T.gutter);
  for (let i = 0; i < 5; i++) {
    let x = rnd(seed + 100 + i * 13) * W;
    let y = rnd(seed + 200 + i * 17) * H;
    ctx.beginPath();
    ctx.moveTo(Math.round(x), Math.round(y));
    for (let k = 0; k < 7; k++) {
      x += 18 + rnd(seed + 300 + i * 7 + k) * 34;
      y += (rnd(seed + 400 + i * 11 + k) - 0.5) * 26;
      ctx.lineTo(Math.round(x), Math.round(y));
    }
    ctx.stroke();
  }
}

let gwAbs = 20;

// ---------------------------------------------------------------------------
// 2) 人行道（騎樓）＋路緣石＋導盲磚
// ---------------------------------------------------------------------------

function bandPath(ctx, cx, cy, s0, s1, u0, u1) {
  ctx.beginPath();
  const a = pt(cx, cy, u0, s0);
  const b = pt(cx, cy, u1, s0);
  const c = pt(cx, cy, u1, s1);
  const d = pt(cx, cy, u0, s1);
  ctx.moveTo(Math.round(a.x), Math.round(a.y));
  ctx.lineTo(Math.round(b.x), Math.round(b.y));
  ctx.lineTo(Math.round(c.x), Math.round(c.y));
  ctx.lineTo(Math.round(d.x), Math.round(d.y));
  ctx.closePath();
}

/**
 * 騎樓（人行道）在 iso 的 (u,s) 平面上是一個「回」字形，由四條狹長矩形組成。
 * 每一條鋪面帶都只畫在自己那一側（用常數範圍界定），不會跨到對面。
 * @returns {Array<{side:number,outer:number,dir:number,lo:number,hi:number}>}
 *   side 0 北（畫面遠端）、1 南（畫面近端）、2 東（畫面右）、3 西（畫面左）
 *   outer = 外緣的 s／u 座標；dir = 往店內的方向（+1／−1）；
 *   lo..hi = 這一條邊在另一個軸（u 或 s）上的可見範圍
 */
function walkSides(gw, gh, inset) {
  const A = (gw - 1) / 2;
  const B = (gh - 1) / 2;
  const O = WALK_OUT;
  const pad = inset || 0;
  return [
    { side: 0, axis: 's', outer: -(B + O), dir: 1, lo: -(A + O) + pad, hi: A + O - pad },
    { side: 1, axis: 's', outer: B + O, dir: -1, lo: -(A + O) + pad, hi: A + O - pad },
    { side: 2, axis: 'u', outer: A + O, dir: -1, lo: -(B + O) + pad, hi: B + O - pad },
    { side: 3, axis: 'u', outer: -(A + O), dir: 1, lo: -(B + O) + pad, hi: B + O - pad },
  ];
}

/** 由一條邊的 (起, 迄) 內縮量算出實際矩形（往店內為正）。 */
function sideRect(R, a, b, loTrim, hiTrim) {
  const t0 = R.outer + R.dir * a;
  const t1 = R.outer + R.dir * b;
  const start = Math.min(t0, t1);
  const end = Math.max(t0, t1);
  const lo = R.lo + (loTrim || 0);
  const hi = R.hi - (hiTrim || 0);
  return R.axis === 's'
    ? { u0: lo, u1: hi, s0: start, s1: end }
    : { u0: start, u1: end, s0: lo, s1: hi };
}

/** 把四條邊的矩形加入目前路徑（供 clip 用）。 */
function sidesClip(ctx, cx, cy, sides) {
  for (let i = 0; i < sides.length; i++) {
    const R = sides[i];
    const r = sideRect(R, 0, WALK_OUT, 0, 0);
    const a = pt(cx, cy, r.u0, r.s0);
    const b = pt(cx, cy, r.u1, r.s0);
    const c = pt(cx, cy, r.u1, r.s1);
    const d = pt(cx, cy, r.u0, r.s1);
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
    ctx.lineTo(Math.round(c.x), Math.round(c.y));
    ctx.lineTo(Math.round(d.x), Math.round(d.y));
    ctx.closePath();
  }
}

function paintWalk(ctx, T, gw, gh, cx, cy, seed) {
  const A = (gw - 1) / 2;
  const B = (gh - 1) / 2;
  const S = walkSides(gw, gh, 0);
  const fill = (r, col) => {
    bandPath(ctx, cx, cy, r.s0, r.s1, r.u0, r.u1);
    ctx.fillStyle = color(col);
    ctx.fill();
  };
  const span = Math.max(gw, gh) + 3;
  const joint = (a, b, lo, hi) => ({ u0: a, u1: b, s0: lo, s1: hi });

  // ── 1) 鋪面本體 ──
  for (const R of S) fill(sideRect(R, 0, WALK_OUT, 0, 0), T.walk);
  // 中央行走帶（亮一階；外圈留下較暗的收邊帶）
  for (const R of S) fill(sideRect(R, 0.45, WALK_OUT - 0.25, 0.4, 0.4), T.walkHi);

  // ── 2) 鋪面磚縫（兩組互相垂直的等角線，交錯 0.5 格）──
  ctx.save();
  ctx.beginPath();
  sidesClip(ctx, cx, cy, S);
  ctx.clip();
  ctx.strokeStyle = color(T.walkJ);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = -span; c <= span; c += PAVE_JOINT_STEP) {
    const a = pt(cx, cy, -span, c - span);
    const b = pt(cx, cy, span, c + span);
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
    const c2 = c + PAVE_JOINT_STEP * 0.5;
    const e = pt(cx, cy, -span, c2 + span);
    const f = pt(cx, cy, span, c2 - span);
    ctx.moveTo(Math.round(e.x), Math.round(e.y));
    ctx.lineTo(Math.round(f.x), Math.round(f.y));
  }
  ctx.stroke();
  // 磚面髒污／色差（稀疏硬邊色塊）
  for (let i = 0; i < 150; i++) {
    const u = -(A + WALK_OUT) + rnd(seed + i * 19) * (A + WALK_OUT) * 2;
    const s = -(B + WALK_OUT) + rnd(seed + i * 23 + 3) * (B + WALK_OUT) * 2;
    const p = pt(cx, cy, u, s);
    const w = 2 + ((rnd(seed + i * 29 + 7) * 5) | 0);
    ctx.fillStyle = color(rnd(seed + i * 37) > 0.55 ? T.walkJ : T.walkHi);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), w, 2);
  }
  ctx.restore();
  void joint;

  // ── 3) 路緣石（外緣）＋排水溝：亮面 0.45 ／側面 0.5 ／溝 0.05 ──
  for (const R of S) {
    fill(sideRect(R, 0, KERB_W * 0.45, 0, 0), T.kerb);
    fill(sideRect(R, KERB_W * 0.45, KERB_W * 0.95, 0, 0), T.kerbLo);
    fill(sideRect(R, KERB_W * 0.95, KERB_W, 0, 0), T.gutter);
  }
  // 路緣石分塊縫（每 0.5 格一道）
  ctx.save();
  ctx.beginPath();
  sidesClip(ctx, cx, cy, S);
  ctx.clip();
  ctx.strokeStyle = color(T.gutter);
  ctx.beginPath();
  for (let c = -span; c <= span; c += 0.5) {
    const a = pt(cx, cy, -span, c - span);
    const b = pt(cx, cy, span, c + span);
    ctx.moveTo(Math.round(a.x), Math.round(a.y));
    ctx.lineTo(Math.round(b.x), Math.round(b.y));
  }
  ctx.stroke();
  ctx.restore();

  // ── 4) 導盲磚（內緣，黃色點狀）──
  const tOut = WALK_OUT - KERB_W - TACTILE_W - 0.06;
  const tIn = tOut + TACTILE_W;
  for (const R of S) {
    // 收邊（深色）→ 磚面 → 凸點
    fill(sideRect(R, tOut - 0.05, tIn + 0.05, 0, 0), mix(T.tactile, 'black', 0.45));
    fill(sideRect(R, tOut, tIn, 0, 0), T.tactile);
  }
  ctx.save();
  ctx.beginPath();
  sidesClip(ctx, cx, cy, S);
  ctx.clip();
  ctx.fillStyle = color(mix(T.tactile, 'black', 0.3));
  for (const R of S) {
    const mid = (tOut + tIn) / 2;
    for (let k = -60; k <= 60; k++) {
      const r = sideRect(R, mid - 0.1, mid + 0.1, 0, 0);
      const p = R.axis === 's'
        ? pt(cx, cy, r.u0 + k * 0.2 - 0.0, (r.s0 + r.s1) / 2)
        : pt(cx, cy, (r.u0 + r.u1) / 2, r.s0 + k * 0.2);
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 2);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3) 道路標線（車道線＝iso 常數；斑馬線、停止線、指向箭頭）
// ---------------------------------------------------------------------------

function paintRoadMarks(ctx, T, gw, gh, cx, cy) {
  const A = (gw - 1) / 2;
  const B = (gh - 1) / 2;
  const OU = A + WALK_OUT;
  const OS = B + WALK_OUT;
  // 路面在 (u,s) 平面的可見範圍：由 iso.js 的 tile 常數與畫布尺寸反推，
  // 而不是寫死像素（見 bandEnds()）。
  const end = bandEnds(gw, gh, cx, cy);
  // 四條路的車道中心（都取在「這條路在畫面上看得到的範圍」中間）
  const roads = [
    { axis: 's', at: -Math.min(26, end.sNeg - 2), from: -(A + OU), to: A + OU },
    { axis: 's', at: Math.min(16.5, end.sPos - 3.5), from: -(A + OU), to: A + OU },
    { axis: 'u', at: -(OU + 2.5), from: Math.max(-OS, end.sNeg + 5), to: Math.min(OS, end.sPos - 8) },
    { axis: 'u', at: OU + 2.5, from: Math.max(-OS, end.sNeg + 5), to: Math.min(OS, end.sPos - 8) },
  ];
  const at = (road, t, off) => (road.axis === 's'
    ? pt(cx, cy, t, road.at + (off || 0))
    : pt(cx, cy, road.at + (off || 0), t));
  for (const road of roads) {
    for (let t = road.from; t < road.to; t += 1.7) {
      const a = at(road, t, 0);
      const b = at(road, t + 1.05, 0);
      if (a.y < -20 || a.y > LOGICAL_H + 20) continue;
      ctx.fillStyle = color(T.lane);
      ctx.fillRect(Math.round(a.x), Math.round(a.y), Math.max(3, Math.abs(Math.round(b.x - a.x))), 2);
      ctx.fillStyle = color(T.lane2);
      ctx.fillRect(Math.round(a.x), Math.round(a.y) + 2, Math.max(3, Math.abs(Math.round(b.x - a.x))), 1);
    }
    // 路邊白線（貼著排水溝那一側）
    const o = road.at > 0 ? 1 : -1;
    strokePoly(ctx, [at(road, road.from, o * 0.25), at(road, road.to, o * 0.25)], T.lane2, 1);
  }
  // 車道指向箭頭（南北向各兩支，指向店門）
  for (const [au, sTip, sTail] of [
    [A * 0.35, 14.6, 16.4], [-A * 0.35, 14.6, 16.4],
    [A * 0.35, -16.4, -14.6], [-A * 0.35, -16.4, -14.6],
  ]) {
    fillPoly(ctx, [pt(cx, cy, au, sTip), pt(cx, cy, au - 0.55, sTail), pt(cx, cy, au + 0.55, sTail)], '#ded8c0');
    fillPoly(ctx, [
      pt(cx, cy, au - 0.16, sTip + (sTip > 0 ? -0.2 : 0.2)), pt(cx, cy, au + 0.16, sTip + (sTip > 0 ? -0.2 : 0.2)),
      pt(cx, cy, au + 0.16, sTail), pt(cx, cy, au - 0.16, sTail),
    ], '#ded8c0');
  }
  // 斑馬線 ＋ 停止線：放在店門口那一側的馬路（畫面近端），
  // 位置取在路面上還看得到、又不會被畫面下緣切掉的範圍。
  const z0 = Math.min(19.5, end.sPos - 5.5);
  const z1 = z0 + 3.4;
  for (let i = -8; i <= 8; i++) {
    const u = i * 0.62;
    fillPoly(ctx, [
      pt(cx, cy, u, z0), pt(cx, cy, u + 0.34, z0),
      pt(cx, cy, u + 0.34, z1), pt(cx, cy, u, z1),
    ], i % 2 ? '#d8d2ba' : '#ebe5d0');
  }
  const su = -8 * 0.62 - 1.1;
  fillPoly(ctx, [
    pt(cx, cy, su, z0 - 0.5), pt(cx, cy, su + 0.36, z0 - 0.5),
    pt(cx, cy, su + 0.36, z1 + 0.5), pt(cx, cy, su, z1 + 0.5),
  ], '#d8d2ba');
  void gh;
}

/**
 * 由 tile 常數與畫布尺寸反推「每條路在 (u,s) 平面上的可見端點」。
 * 畫面角落的極限：max(|u|,|s|) 無法超過 12 + max(W/2, H/2) / HALF_*，
 * 因為超出畫面就沒有像素可以畫了。
 */
function bandEnds(gw, gh, cx, cy) {
  const maxS = Math.max((LOGICAL_H - cy) / HALF_H, cy / HALF_H);
  const maxU = Math.max((LOGICAL_W - cx) / HALF_W, cx / HALF_W);
  const lim = Math.min(maxS, maxU) + 10;
  void gw; void gh;
  return { sNeg: -lim, sPos: Math.min(maxS, lim) };
}
/** 排水溝蓋（柵欄式，貼地菱形）。 */
function paintGrate(ctx, x, y, T) {
  const rx = HALF_W * 0.5;
  const ry = HALF_H * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - ry));
  ctx.lineTo(Math.round(x + rx), Math.round(y));
  ctx.lineTo(Math.round(x), Math.round(y + ry));
  ctx.lineTo(Math.round(x - rx), Math.round(y));
  ctx.closePath();
  ctx.fillStyle = color(T.gutter);
  ctx.fill();
  ctx.clip();
  for (let i = -3; i <= 3; i++) {
    ctx.fillStyle = color(T.drain);
    ctx.fillRect(Math.round(x + i * 4), Math.round(y - ry - 1), 2, Math.round(ry * 2 + 2));
  }
  ctx.restore();
  strokePoly(ctx, [
    { x, y: y + ry }, { x: x + rx, y }, { x, y: y - ry }, { x: x - rx, y },
  ], mix(T.gutter, 'black', 0.4), 1);
}

// ---------------------------------------------------------------------------
// 4) 對街建築（房間後方，只露出上方一條）＋ 鄰居店面（畫面左右／前方）
// ---------------------------------------------------------------------------

function paintFacade(ctx, x, y, w, h, T, seed, opts) {
  const o = opts || {};
  const wall = T.shopWall[(rnd(seed) * T.shopWall.length) | 0];
  const dark = mix(wall, 'black', 0.35);
  ctx.fillStyle = color(dark);
  ctx.fillRect(Math.round(x - 2), Math.round(y - h), Math.round(w + 4), Math.round(h + 2));
  ctx.fillStyle = color(wall);
  ctx.fillRect(Math.round(x), Math.round(y - h), Math.round(w), Math.round(h));
  ctx.fillStyle = color(mix(wall, 'white', 0.22));
  ctx.fillRect(Math.round(x), Math.round(y - h), Math.round(w), 2);
  // 樓層分界
  const floors = Math.max(1, Math.round(h / 22));
  for (let f = 1; f < floors; f++) {
    const fy = Math.round(y - (h * f) / floors);
    ctx.fillStyle = color(dark);
    ctx.fillRect(Math.round(x), fy, Math.round(w), 2);
    // 窗戶
    const cols = Math.max(1, Math.floor(w / 16));
    for (let cix = 0; cix < cols; cix++) {
      const wx = Math.round(x + 4 + cix * (w / cols));
      const ww = Math.max(4, Math.round(w / cols) - 8);
      const lit = rnd(seed + f * 31 + cix * 7);
      ctx.fillStyle = color(o.night ? (lit > 0.35 ? T.sign[0] : T.glass) : T.glass);
      ctx.fillRect(wx, fy + 4, ww, 10);
      ctx.fillStyle = color(mix(wall, 'white', 0.3));
      ctx.fillRect(wx, fy + 4, ww, 1);
    }
  }
  if (o.awning) {
    const ah = 7;
    const ay = Math.round(y - h * 0.42);
    const col = T.awning[(rnd(seed + 3) * T.awning.length) | 0];
    ctx.fillStyle = color(col);
    ctx.fillRect(Math.round(x - 3), ay, Math.round(w + 6), ah);
    ctx.fillStyle = color(mix(col, 'black', 0.3));
    for (let sx = -3; sx < w + 6; sx += 6) ctx.fillRect(Math.round(x + sx), ay, 3, ah);
    ctx.fillStyle = color(mix(col, 'white', 0.35));
    ctx.fillRect(Math.round(x - 3), ay, Math.round(w + 6), 1);
  }
  if (o.sign) {
    const sw = Math.min(w - 6, 34);
    const sy = Math.round(y - h * 0.62);
    const col = T.sign[(rnd(seed + 11) * T.sign.length) | 0];
    ctx.fillStyle = color(dark);
    ctx.fillRect(Math.round(x + 3), sy, sw, 12);
    ctx.fillStyle = color(o.night ? col : mix(col, 'gray_30', 0.4));
    ctx.fillRect(Math.round(x + 4), sy + 1, sw - 2, 10);
    ctx.fillStyle = color(o.night ? 'white' : 'gray_70');
    for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x + 7), sy + 3 + i * 3, sw - 10 - i * 4, 2);
  }
}

/** 對街（房間後方）的整排建築：只會出現在屋脊以上。 */
export function paintFarRow(ctx, opts) {
  const { gw, gh, tod, theme, originX, originY } = opts;
  const T = theme;
  const night = tod === 'night' || tod === 'evening';
  const ridge = opts.ridge || null;
  if (!ridge) return;
  const horizon = Math.round(ridge[1].y) + 30;
  const x0 = Math.round(ridge[0].x) - 60;
  const x1 = Math.round(ridge[2].x) + 60;
  let x = x0;
  let i = 0;
  while (x < x1 && i < 40) {
    const w = 44 + rnd(i * 13 + 3) * 66;
    const h = 26 + rnd(i * 17 + 5) * 74;
    paintFacade(ctx, x, horizon, w, h, T, 900 + i * 29, {
      night,
      awning: rnd(i * 7) > 0.45,
      sign: rnd(i * 11) > 0.35,
    });
    x += w + 2 + rnd(i * 19) * 5;
    i++;
  }
  void gw; void gh; void originX; void originY;
}

/**
 * 對街店面：沿著「北側（畫面遠端）」與「東側（畫面右）」人行道外緣再往外的街廓，
 * 只露出屋頂與招牌（下半被騎樓與路面遮住）。
 *
 * 刻意不放南側／西側：那兩側是店門口與主要展示面（路燈、招牌、腳踏車、植栽都擺在那裡），
 * 放大樓會把整個騎樓蓋掉。座標一律用「相對房間中心的 iso 偏移 (u, s)」推導。
 */
export function paintNearRow(ctx, opts) {
  const { gw, gh, tod, theme, originX, originY } = opts;
  const T = theme;
  const night = tod === 'night' || tod === 'evening';
  const cx = originX + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = originY + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  const A = (gw - 1) / 2;
  const B = (gh - 1) / 2;
  const o = WALK_OUT + 0.6; // 建築面退到人行道外緣之外
  const strips = [
    { axis: 's', at: -(B + o), from: -(A + o), to: A + o, n: 4, hMin: 16, hMax: 30 },
    { axis: 'u', at: A + o, from: -(B + o), to: B + o, n: 3, hMin: 14, hMax: 26 },
  ];
  for (let si = 0; si < strips.length; si++) {
    const st = strips[si];
    for (let k = 0; k < st.n; k++) {
      const t0 = st.from + ((st.to - st.from) * k) / st.n;
      const t1 = st.from + ((st.to - st.from) * (k + 0.9)) / st.n;
      const p0 = st.axis === 's' ? pt(cx, cy, t0, st.at) : pt(cx, cy, st.at, t0);
      const p1 = st.axis === 's' ? pt(cx, cy, t1, st.at) : pt(cx, cy, st.at, t1);
      const baseY = (p0.y + p1.y) / 2;
      const h = st.hMin + rnd(si * 31 + k * 17) * (st.hMax - st.hMin);
      const w = Math.abs(p1.x - p0.x) + 10;
      paintFacade(ctx, Math.min(p0.x, p1.x) - 5, baseY, w, h, T, 500 + si * 71 + k * 23, {
        night,
        awning: true,
        sign: rnd(k * 5 + si) > 0.25,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 5) 主入口：烤出整張街景圖層
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document && document.createElement) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w));
      cv.height = Math.max(1, Math.round(h));
      return cv;
    }
  } catch (e) { /* 非 DOM 環境 */ }
  return null;
}

/**
 * 烤出店外街景（柏油路＋標線＋騎樓鋪面＋路緣石＋導盲磚＋排水溝蓋＋街具＋接觸陰影）。
 * 座標全部由 iso.js 推導；房間所在的區域會被 even-odd 遮罩挖掉。
 *
 * @param {object} o
 * @param {number} o.w @param {number} o.h 邏輯畫布尺寸
 * @param {number} o.gw @param {number} o.gh 格數
 * @param {number} o.originX @param {number} o.originY
 * @param {string} o.tod morning|noon|evening|night
 * @param {object} o.theme streetTheme() 的結果
 * @param {function} [o.drawProp] (ctx, kind, x, y, opts) → 由 sprites.js 提供；未給則不畫街具
 * @param {function} [o.drawWires] (ctx, ax, ay, bx, by, sag)
 * @param {Array} [o.ridge] backWallRidge() 的結果（對街建築的天際線）
 * @param {string} [o.skyline]
 * @param {function} [o.drawSkyline] sprites.js 的 drawSkyline
 * @returns {{canvas:HTMLCanvasElement|null, lamps:Array}}
 */
export function bakeStreet(o) {
  const W = Math.max(8, Math.round(o.w));
  const H = Math.max(8, Math.round(o.h));
  const gw = Math.max(1, Math.round(o.gw));
  const gh = Math.max(1, Math.round(o.gh));
  const cx = o.originX + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = o.originY + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  const T = o.theme || THEMES.nightmarket;
  const tod = o.tod || 'noon';
  const night = tod === 'night' || tod === 'evening';
  const seed = 20240101;
  const cv = makeCanvas(W, H);
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx) return { canvas: null, lamps: [] };
  gwAbs = Math.max(gw, gh);

  // 1) 天空（會被街景與建築蓋住的部分先填底色，避免任何透明縫）
  ctx.fillStyle = color(night ? 'sky_night' : 'sky_lo');
  ctx.fillRect(0, 0, W, H);

  // 2) 柏油路（整張畫布）
  paintAsphalt(ctx, T, W, H, seed);
  // 3) 人行道／路緣石／導盲磚
  paintWalk(ctx, T, gw, gh, cx, cy, seed);
  // 4) 標線與排水溝蓋
  paintRoadMarks(ctx, T, gw, gh, cx, cy);
  // 5) 對街建築（房間後方，只露上方一條）
  if (o.ridge) paintFarRow(ctx, { gw, gh, tod, theme: T, originX: o.originX, originY: o.originY, ridge: o.ridge });

  // 6) 天空／天際線（裁在屋脊以上）
  if (typeof o.drawSkyline === 'function' && o.ridge) {
    const pad = 6;
    const x0 = Math.floor(o.ridge[0].x) - pad - 8;
    const x1 = Math.ceil(o.ridge[2].x) + pad + 8;
    const yBot = Math.ceil(Math.max(o.ridge[0].y, o.ridge[2].y)) + 16;
    const sw = Math.max(16, x1 - x0);
    const sh = Math.max(16, yBot);
    const poly = [
      { x: x0, y: Math.round(o.ridge[0].y) },
      { x: Math.round(o.ridge[1].x), y: Math.round(o.ridge[1].y) },
      { x: x1, y: Math.round(o.ridge[2].y) },
      { x: x1, y: -pad },
      { x: x0, y: -pad },
    ];
    ctx.save();
    polyPath(ctx, poly);
    ctx.clip();
    o.drawSkyline(ctx, o.skyline || 'nightmarket', x0, 0, sw, sh, tod, {
      horizon: Math.round(o.ridge[1].y),
    });
    ctx.restore();
  }

  // 7) 鄰居店面（會落在房間輪廓上，靠遮罩裁掉）
  paintNearRow(ctx, { gw, gh, tod, theme: T, originX: o.originX, originY: o.originY });

  // 8) 街具＋電線桿＋接觸陰影（畫在獨立圖層，再用遮罩貼回 → 絕不覆蓋店內）
  const propLayer = makeCanvas(W, H);
  const pc = propLayer && propLayer.getContext ? propLayer.getContext('2d') : null;
  const lamps = [];
  if (pc) {
    const drawProp = typeof o.drawProp === 'function' ? o.drawProp : null;
    const poles = [];
    for (let i = 0; i < STREET_PROP_PLAN.length; i++) {
      const item = STREET_PROP_PLAN[i];
      const g = planAt(item, gw, gh);
      const p = pt(cx, cy, g.u, g.s);
      if (p.x < -80 || p.x > W + 80 || p.y < -120 || p.y > H + 80) continue;
      if (item.kind === 'lamp') lamps.push({ x: p.x, y: p.y + 2, seed: i });
      if (item.kind === 'pole') poles.push(p);
      if (!drawProp) continue;
      if (item.road) {
        // 馬路上的三角錐：矮、只畫在路面
        drawProp(pc, 'cone', p.x, p.y, { theme: T, seed: i });
        continue;
      }
      if (item.kind === 'drain') { paintGrate(pc, p.x, p.y, T); continue; }
      if (item.kind === 'manhole') {
        drawProp(pc, 'manhole', p.x, p.y, { theme: T, seed: i });
        continue;
      }
      // 接觸陰影（軟性 AO：稀疏網點橢圓，貼在街具底部）
      contactShadow(pc, p.x, p.y + 1, item.kind === 'vending' || item.kind === 'planter' ? 26 : 18,
        item.kind === 'vending' || item.kind === 'planter' ? 8 : 6);
      drawProp(pc, item.kind, p.x, p.y + 2, {
        theme: T, glowing: night, seed: i, streetside: true,
      });
    }
    // 電線桿：固定放在人行道外緣的兩個對角
    if (drawProp) {
      const poleA = pt(cx, cy, -(A + WALK_OUT - 0.3), -(B + WALK_OUT - 0.3));
      const poleB = pt(cx, cy, A + WALK_OUT - 0.3, B + WALK_OUT - 0.3);
      drawProp(pc, 'pole', poleA.x, poleA.y, { theme: T });
      drawProp(pc, 'pole', poleB.x, poleB.y, { theme: T });
      if (typeof o.drawWires === 'function') {
        o.drawWires(pc, poleA.x + 2, poleA.y - 44, poleB.x + 2, poleB.y - 44, 70);
        o.drawWires(pc, poleA.x + 2, poleA.y - 40, poleB.x + 2, poleB.y - 40, 74);
      }
    }
  }

  // 遮罩：只留下店外（四個半平面依序 clip）
  if (propLayer) {
    ctx.save();
    clipOutsideShop(ctx, gw, gh, o.originX, o.originY, W, H);
    ctx.drawImage(propLayer, 0, 0);
    ctx.restore();
  }

  try { cv.__spriteKey = 'street|' + W + 'x' + H + '|' + gw + 'x' + gh + '|' + tod; } catch (e) { /* 唯讀物件 */ }
  return { canvas: cv, lamps };
}

/** 接觸陰影（硬邊網點橢圓，與家具的接觸陰影同風格）。 */
function contactShadow(ctx, cx, cy, w, h) {
  const key = 'stsh|' + Math.round(w) + 'x' + Math.round(h);
  let cv = shadowCache.get(key);
  if (!cv) {
    const cw = Math.ceil(w) + 6;
    const chh = Math.ceil(h) + 6;
    cv = makeCanvas(cw, chh);
    const c = cv && cv.getContext('2d');
    if (c) {
      ditherPattern(c, cw / 2 - w / 2, chh / 2 - h / 2, w, h, 'pave_shade', 'clear', DITHER.block25);
      ditherPattern(c, cw / 2 - w * 0.3, chh / 2 - h * 0.3, w * 0.6, h * 0.6, 'shadow_deep', 'clear', DITHER.block50);
    }
    if (cv) shadowCache.set(key, cv);
  }
  if (cv) ctx.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(cy - cv.height / 2));
}

const shadowCache = new Map();

/**
 * 夜晚路燈光池（動態層：每盞燈 2 次 drawImage，燈數固定 3 盞）。
 * 只有夜晚／傍晚才呼叫。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number}>} lamps bakeStreet() 回傳的燈位
 * @param {function} drawLightPool sprites.js 的 drawLightPool
 * @param {function} drawGlow sprites.js 的 drawGlow
 */
export function drawStreetLampPools(ctx, lamps, tick, tod, drawLightPool, drawGlow, theme, gw, gh, originX, originY) {
  if (!ctx || !lamps || !lamps.length) return;
  const night = tod === 'night';
  const strength = night ? 0.95 : 0.55;
  const col = (theme && STREET_LAMP_STYLE[themeKey(theme)]) || null;
  const clipped = gw && gh && originX !== undefined && originX !== null;
  if (clipped) {
    ctx.save();
    clipOutsideShop(ctx, gw, gh, originX, originY, LOGICAL_W, LOGICAL_H);
  }
  for (let i = 0; i < lamps.length; i++) {
    const L = lamps[i];
    if (typeof drawLightPool === 'function') {
      drawLightPool(ctx, L.x, L.y, HALF_W * 2.0, HALF_H * 2.2, strength, tick, { seed: 40 + i * 5 });
    }
    if (typeof drawGlow === 'function') {
      drawGlow(ctx, L.x, L.y - 38, 5, night ? 1 : 0.6, tick, col ? col.colour : 'light_pool_hi');
    }
  }
  if (clipped) ctx.restore();
}

/**
 * 店外地面上的天氣痕跡（動態層）：積雪／沙塵堆積在騎樓靠牆與路緣的邊角，
 * 雨水讓路面反光加深，熱浪讓柏油冒白氣。全部畫在店外（用同一組裁切），
 * 每影格只有幾次 fillRect／drawImage。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} weather sunny|cloudy|rain|storm|cold|heat
 * @param {number} tick 影格計數
 * @param {{gw:number,gh:number,originX:number,originY:number,accum?:number,wallHeight?:number}} o
 *   accum 0..1 累積程度（呼叫端可依時間累積；預設用 tick 推導）
 *   wallHeight 房間牆高（影響「房間輪廓」裁切；一定要跟 floor.js 用的一致）
 */
export function drawGroundWeather(ctx, weather, tick, o) {
  if (!ctx || !o) return;
  const gw = Math.round(num(o.gw, 0));
  const gh = Math.round(num(o.gh, 0));
  if (gw < 2 || gh < 2) return;
  const wallH = num(o.wallHeight, 22);
  const cx = num(o.originX, 0) + ((gw - 1) / 2 - (gh - 1) / 2) * HALF_W;
  const cy = num(o.originY, 0) + ((gw - 1) / 2 + (gh - 1) / 2) * HALF_H;
  const A = (gw - 1) / 2;
  const B = (gh - 1) / 2;
  const S = walkSides(gw, gh, 0);
  const t = num(tick, 0);
  const grow = Math.min(1, 0.25 + (num(o.accum, 0) || Math.min(1, t / 3600)) * 0.9);
  const frozen = weather === 'cold';
  const wet = weather === 'rain' || weather === 'storm';
  const dusty = weather === 'heat';
  if (!frozen && !wet && !dusty) return;
  ctx.save();
  clipOutsideShop(ctx, gw, gh, num(o.originX, 0), num(o.originY, 0), LOGICAL_W, LOGICAL_H);

  if (frozen) {
    // 積雪：牆腳、路緣、以及路面上的雪堆（數量隨累積程度成長）
    for (const R of S) {
      // 牆腳積雪（貼著房間外牆）
      const base = sideRect(R, 0, 0.5 + grow * 0.75, 0, 0);
      ctx.fillStyle = color('tile_hi');
      bandPath(ctx, cx, cy, base.s0, base.s1, base.u0, base.u1);
      ctx.fill();
      // 路緣積雪（內側較厚、外側融掉一半）
      const kerbIn = sideRect(R, WALK_OUT - KERB_W - 0.35, WALK_OUT - KERB_W + 0.35, 0, 0);
      ctx.fillStyle = color('white');
      bandPath(ctx, cx, cy, kerbIn.s0, kerbIn.s1, kerbIn.u0, kerbIn.u1);
      ctx.fill();
      // 騎樓中央被踩過 → 只剩薄薄一層灰白
      const trodden = sideRect(R, 1.1, WALK_OUT - 1.1, 0.7, 0.7);
      ctx.fillStyle = color('gray_90');
      bandPath(ctx, cx, cy, trodden.s0, trodden.s1, trodden.u0, trodden.u1);
      ctx.fill();
    }
    // 雪堆（沿騎樓與路面邊緣散落的堆積）
    for (let i = 0; i < 26; i++) {
      const R = S[i % S.length];
      const t01 = rnd(i * 37 + 5);
      const off = 0.3 + rnd(i * 11) * (WALK_OUT - 0.6);
      const u = R.axis === 's' ? R.lo + (R.hi - R.lo) * t01 : R.outer + R.dir * off;
      const s = R.axis === 's' ? R.outer + R.dir * off : R.lo + (R.hi - R.lo) * t01;
      ringPt(cx, cy, u, s, (p) => {
        const w = Math.round((5 + rnd(i * 7) * 9) * grow) + 2;
        const h = Math.max(2, Math.round(w * 0.42));
        ctx.fillStyle = color(i % 3 ? 'white' : 'gray_90');
        ctx.fillRect(Math.round(p.x), Math.round(p.y), w, h);
        ctx.fillStyle = color('tile_hi');
        ctx.fillRect(Math.round(p.x), Math.round(p.y) + h, w, 1);
      });
    }
  } else if (wet) {
    // 雨水：路面與騎樓的濕潤反光、以及路緣積水
    const storm = weather === 'storm';
    for (const R of S) {
      const sheen = sideRect(R, 0.5, WALK_OUT - 0.6, 0.6, 0.6);
      ctx.fillStyle = color('sky_lo');
      bandPath(ctx, cx, cy, sheen.s0, sheen.s1, sheen.u0, sheen.u1);
      ctx.fill();
      const film = sideRect(R, WALK_OUT - 1.5, WALK_OUT - 0.3, 0.25, 0.25);
      ctx.fillStyle = color('puddle');
      bandPath(ctx, cx, cy, film.s0, film.s1, film.u0, film.u1);
      ctx.fill();
      // 沿路緣的高光水膜（雨水沿著排水溝流）
      const glint = sideRect(R, WALK_OUT - 0.9, WALK_OUT - 0.55, 0.3, 0.3);
      ctx.fillStyle = color('puddle_hi');
      bandPath(ctx, cx, cy, glint.s0, glint.s1, glint.u0, glint.u1);
      ctx.fill();
    }
    // 車道上的長條反光（貼著車道方向）
    for (const lane of [15.6, -16.2]) {
      for (let k = 0; k < 9; k++) {
        const u = -A - 4 + ((A * 2 + 8) * k) / 9 + (rnd(k * 13 + 3) * 2 - 1);
        const p = pt(cx, cy, u, lane + (rnd(k * 7) > 0.5 ? 0.9 : -0.9));
        const w = Math.round(20 + rnd(k * 5) * 34);
        ctx.fillStyle = color(storm ? 'sky_lo' : 'sky_md');
        ctx.fillRect(Math.round(p.x), Math.round(p.y), w, 2);
      }
    }
  } else if (dusty) {
    // 熱浪：柏油上的白熱霧帶（沿車道方向緩慢流動）。
    // 這裡再夾一層「房間輪廓以外」的裁切：霧帶很寬，沒有這一層就會滲進店內
    // （weather-clip-test 的 heat 檢查要求店內相異像素 0）。
    ctx.save();
    polyClipExcludeRoom(ctx, gw, gh, num(o.originX, 0), num(o.originY, 0), wallH);
    for (let k = 0; k < 14; k++) {
      const u = -A - 3 + ((A * 2 + 6) * k) / 14;
      const lane = (k % 2 ? 15.4 : -16.4) + Math.sin(t * 0.02 + k) * 0.8;
      const p = pt(cx, cy, u, lane);
      const w = Math.round(26 + rnd(k * 9) * 30);
      ctx.fillStyle = color(k % 3 ? 'lamp_md' : 'lamp_hi');
      ctx.fillRect(Math.round(p.x), Math.round(p.y), w, 1);
      ctx.fillRect(Math.round(p.x) + 4, Math.round(p.y) + 2, Math.max(4, w - 8), 1);
    }
    // 騎樓邊緣的熱氣（貼著地面，短促閃動）
    for (const R of S) {
      const band = sideRect(R, WALK_OUT - 1.0, WALK_OUT - 0.4, 0.4, 0.4);
      const a = pt(cx, cy, band.u0, band.s0);
      const b = pt(cx, cy, band.u1, band.s1);
      const shim = Math.round(Math.sin(t * 0.06 + R.side) * 2);
      ctx.fillStyle = color('lamp_hi');
      ctx.fillRect(Math.round(Math.min(a.x, b.x)), Math.round((a.y + b.y) / 2) + shim,
        Math.max(4, Math.abs(Math.round(b.x - a.x))), 1);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** 夾在房間輪廓以外（even-odd；不支援時等於不裁切，仍受 clipOutsideShop 保護）。 */
function polyClipExcludeRoom(ctx, gw, gh, originX, originY, wallH) {
  const poly = roomSilhouette(gw, gh, num(wallH, 22), originX, originY);
  ctx.beginPath();
  ctx.rect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.moveTo(Math.round(poly[0].x), Math.round(poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(Math.round(poly[i].x), Math.round(poly[i].y));
  ctx.closePath();
  try {
    ctx.clip('evenodd');
  } catch (e) {
    /* 不支援 even-odd → 保持原狀（外層 clipOutsideShop 仍然有效） */
  }
}

function themeKey(theme) {
  const keys = Object.keys(THEMES);
  for (let i = 0; i < keys.length; i++) if (THEMES[keys[i]] === theme) return keys[i];
  return 'nightmarket';
}

/** 在 (u,s) 座標上取一點並套用回呼（座標超出畫布時仍然計算，呼叫端自行處理）。 */
function ringPt(cx, cy, u, s, cb) {
  cb(pt(cx, cy, u, s));
}

export { THEMES as STREET_THEMES };
export default { bakeStreet, shopMaskPoly, streetTheme, STREET_PROP_PLAN, drawStreetLampPools };
