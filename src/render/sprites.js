// src/render/sprites.js
// 《夢幻西餐廳》復刻 — 程序化像素圖（16-bit / 1998 VGA 風）。
//
// 全部圖像皆以 Canvas 2D 的 fillRect／多邊形掃描線即時繪製，無任何外部圖檔。
// 每個 sprite 首次使用時畫進離屏 canvas 並快取，之後熱路徑只有 ctx.drawImage()。
// 色數受限、硬邊、1px 深色描邊、明暗用 2 色網點堆疊（禁用漸層／柔邊陰影／反鋸齒）。
//
// 出口（docs/ARCHITECTURE.md §6）：
//   SPRITE_NAMES, drawSprite, drawPerson, drawFurniture, drawTile, drawSkyline, drawWeather
// 另附：drawBubble（心情氣泡）、drawWall、drawShadow、clearSpriteCache 等。

import {
  PALETTE, color, DITHER, ditherRect, ditherPattern, mixHex, shade, skyFor,
} from './palette.js';
import { TILE_W, TILE_H, HALF_W, HALF_H } from './iso.js';

/** 舊版 28×14 tile 的細節尺寸 → 新版 64×32 的等比換算（＝TILE_W / 28）。 */
export const ART_SCALE = TILE_W / 28;
export const PERSON_W = 32;
export const PERSON_H = 48;
export const PERSON_ANCHOR = PERSON_H; // 角色貼圖對齊：底邊 = 腳底

/** 舊版人物尺寸（16×24）→ 新版 32×48 的等比參考，供舊程式碼／文件對照。 */
export const PERSON_SCALE = PERSON_W / 16;

/** 主要牆面高度（px；＝舊版 22 隨 tile 等比放大 22 × 64/28 ≈ 50）。 */
export const WALL_H = Math.round(22 * ART_SCALE);
/** 近端（南／東）矮牆，避免遮住客人（原 19 → 等比放大）。 */
export const NEAR_WALL_H = Math.round(19 * ART_SCALE);

// ===========================================================================
// 0b. 光影效果開關（玩家回饋「pls remove light shadow」→ 陰影類預設全關、光池保留）
// ===========================================================================

/**
 * 繪圖層光影開關的預設值。全部由 `view.fx` 覆寫（缺鍵用這裡的預設）。
 * - pools        燈光光池／出餐口暖光／霓虹溢光／門口戶外光灑入
 * - shadows      人物與傢俱的接觸陰影
 * - ao           牆腳環境光遮蔽
 * - vignette     室內四角暗角
 * - outsideShade 店外鋪面的陰影帶（含 backdrop 上的大片暗色斜帶）
 * - shafts       晴天窗光光柱
 */
export const DEFAULT_FX = {
  pools: true,
  shadows: false,
  ao: false,
  vignette: false,
  outsideShade: false,
  shafts: false,
};

/** DEFAULT_FX 的鍵（resolveFx 只認這些）。 */
export const FX_KEYS = ['pools', 'shadows', 'ao', 'vignette', 'outsideShade', 'shafts'];

/**
 * 解析 `view.fx`：缺鍵／非布林一律回退成 DEFAULT_FX，永遠回傳完整物件。
 * @param {object} [fx]
 * @returns {{pools:boolean,shadows:boolean,ao:boolean,vignette:boolean,outsideShade:boolean,shafts:boolean}}
 */
export function resolveFx(fx) {
  const out = {
    pools: DEFAULT_FX.pools,
    shadows: DEFAULT_FX.shadows,
    ao: DEFAULT_FX.ao,
    vignette: DEFAULT_FX.vignette,
    outsideShade: DEFAULT_FX.outsideShade,
    shafts: DEFAULT_FX.shafts,
  };
  if (fx && typeof fx === 'object') {
    for (let i = 0; i < FX_KEYS.length; i++) {
      const k = FX_KEYS[i];
      if (typeof fx[k] === 'boolean') out[k] = fx[k];
    }
  }
  return out;
}

/** 兩個 fx 是否相同（快取用）。 */
export function sameFx(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < FX_KEYS.length; i++) if (a[FX_KEYS[i]] !== b[FX_KEYS[i]]) return false;
  return true;
}

// ===========================================================================
// 0. 離屏快取
// ===========================================================================

let canvasFactory = null;
let spriteCache = new Map();
const CACHE_MAX = 1400;

/** 可注入自訂 canvas 工廠（測試用）。 */
export function setCanvasFactory(fn) {
  canvasFactory = typeof fn === 'function' ? fn : null;
  spriteCache = new Map();
  tintCache.clear();
}

function newCanvas(w, h) {
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  let c = null;
  if (canvasFactory) c = canvasFactory(ww, hh);
  if (!c && typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    c = document.createElement('canvas');
  }
  if (!c) return null;
  try {
    c.width = ww;
    c.height = hh;
  } catch (e) {
    return null;
  }
  return c;
}

function ctx2d(cv) {
  if (!cv || typeof cv.getContext !== 'function') return null;
  try {
    return cv.getContext('2d');
  } catch (e) {
    return null;
  }
}

function evictOldest() {
  if (spriteCache.size <= CACHE_MAX) return;
  const it = spriteCache.keys();
  let n = spriteCache.size - CACHE_MAX;
  while (n-- > 0) {
    const k = it.next();
    if (k.done) break;
    spriteCache.delete(k.value);
  }
}

/**
 * 取得（必要時產生）快取 sprite；無 canvas 支援時回傳 null，
 * 呼叫端必須能退回「直接畫在主 ctx 上」。
 */
function cachedSprite(key, w, h, paint) {
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const cv = newCanvas(w, h);
  const c = ctx2d(cv);
  if (!c) return null;
  paint(c);
  try {
    cv.__spriteKey = key;
  } catch (e) {
    /* 忽略唯讀物件 */
  }
  spriteCache.set(key, cv);
  evictOldest();
  return cv;
}

/** 直接畫（不快取）到目標 ctx：無 DOM 環境的退路。 */
function drawUncached(ctx, w, h, anchorX, anchorY, paint) {
  ctx.save();
  ctx.translate(Math.round(anchorX), Math.round(anchorY));
  const c = ctx;
  paint(c);
  ctx.restore();
}

export function clearSpriteCache() {
  spriteCache.clear();
  tintCache.clear();
}

export function spriteCacheInfo() {
  return { size: spriteCache.size, max: CACHE_MAX };
}

const tintCache = new Map();

/** 以 source-atop 方式染色（幽靈傢俱／損壞提示），結果快取。 */
function tintedCanvas(src, tintHex, alpha = 0.55) {
  if (!src) return src;
  const key = (src.__spriteKey || src.width + 'x' + src.height) + '|' + tintHex + '|' + alpha;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const cv = newCanvas(src.width, src.height);
  const c = ctx2d(cv);
  if (!c) return src;
  c.drawImage(src, 0, 0);
  try {
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = tintHex;
    c.globalAlpha = alpha;
    c.fillRect(0, 0, src.width, src.height);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  } catch (e) {
    /* 忽略：不支援合成的環境就只是不染色 */
  }
  c.drawImage(src, 0, 0);
  if (tintCache.size > 200) tintCache.clear();
  tintCache.set(key, cv);
  return cv;
}

// ===========================================================================
// 1. 畫筆：硬邊矩形 / 掃描線多邊形 / 網點 / 點陣圖章
// ===========================================================================

/** 產生一個帶水平翻轉能力的畫筆（x 為未翻轉座標，W 為畫布寬）。 */
function mkPainter(c, W, flip) {
  let lastFill = null;
  const g = {
    c,
    W,
    flip: !!flip,
    /** 設定填色（只在變化時寫入，省下 fillStyle 來回設定）。 */
    set(col) {
      const v = color(col);
      if (v !== lastFill) {
        c.fillStyle = v;
        lastFill = v;
      }
    },
    /** 未翻轉的原始矩形。 */
    raw(x, y, w, h, col) {
      const ww = Math.round(w);
      const hh = Math.round(h);
      if (ww <= 0 || hh <= 0) return;
      g.set(col);
      c.fillRect(Math.round(x), Math.round(y), ww, hh);
    },
    /** 矩形（自動處理翻轉）。 */
    r(x, y, w, h, col) {
      const ww = Math.round(w);
      const hh = Math.round(h);
      if (ww <= 0 || hh <= 0) return;
      const xx = g.flip ? W - Math.round(x) - ww : Math.round(x);
      g.set(col);
      c.fillRect(xx, Math.round(y), ww, hh);
    },
    p(x, y, col) {
      g.r(x, y, 1, 1, col);
    },
    /** 1px 邊框。 */
    box(x, y, w, h, col) {
      g.r(x, y, w, 1, col);
      g.r(x, y + h - 1, w, 1, col);
      g.r(x, y, 1, h, col);
      g.r(x + w - 1, y, 1, h, col);
    },
    /** 2px 直線：沿線蓋 2×2 方塊（粗筆觸，不會留下只有對角鄰居的 1px 孤立點）。 */
    thick(x0, y0, x1, y1, col) {
      let ax = Math.round(x0);
      let ay = Math.round(y0);
      const bx = Math.round(x1);
      const by = Math.round(y1);
      const dx = Math.abs(bx - ax);
      const dy = Math.abs(by - ay);
      const sx = ax < bx ? 1 : -1;
      const sy = ay < by ? 1 : -1;
      let err = dx - dy;
      let guard = 4096;
      for (;;) {
        g.r(ax, ay, 2, 2, col);
        if ((ax === bx && ay === by) || guard-- <= 0) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          ax += sx;
        }
        if (e2 < dx) {
          err += dx;
          ay += sy;
        }
      }
    },
    /** Bresenham 直線（1px）。 */
    line(x0, y0, x1, y1, col) {
      let ax = Math.round(x0);
      let ay = Math.round(y0);
      const bx = Math.round(x1);
      const by = Math.round(y1);
      const dx = Math.abs(bx - ax);
      const dy = Math.abs(by - ay);
      const sx = ax < bx ? 1 : -1;
      const sy = ay < by ? 1 : -1;
      let err = dx - dy;
      let guard = 4096;
      for (;;) {
        g.p(ax, ay, col);
        if ((ax === bx && ay === by) || guard-- <= 0) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          ax += sx;
        }
        if (e2 < dx) {
          err += dx;
          ay += sy;
        }
      }
    },
    /** 掃描線填充多邊形（硬邊、無反鋸齒）。pts: [[x,y],...] */
    poly(pts, col) {
      if (!pts || pts.length < 3) return;
      const P = g.flip ? pts.map((q) => [W - q[0], q[1]]) : pts;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < P.length; i++) {
        if (P[i][1] < minY) minY = P[i][1];
        if (P[i][1] > maxY) maxY = P[i][1];
      }
      const y0 = Math.ceil(minY);
      const y1 = Math.floor(maxY);
      const xs = [];
      for (let y = y0; y <= y1; y++) {
        const sy = y + 0.5;
        xs.length = 0;
        for (let i = 0, n = P.length; i < n; i++) {
          const a = P[i];
          const b = P[(i + 1) % n];
          if ((sy >= a[1] && sy < b[1]) || (sy >= b[1] && sy < a[1])) {
            xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
          }
        }
        if (xs.length < 2) continue;
        xs.sort((m, n) => m - n);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = Math.round(xs[i]);
          const xb = Math.round(xs[i + 1]);
          if (xb > xa) g.raw(xa, y, xb - xa, 1, col);
        }
      }
    },
    /** 菱形逐列（cb(x, y, width, rowIndex, rowCount)）。 */
    rows(cx, topY, w, h, cb) {
      const n = Math.max(1, Math.round(h));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        let ww = Math.round((w * (1 - Math.abs(2 * t - 1))) / 2) * 2;
        if (ww < 2) ww = 2;
        let xx = Math.round(cx - ww / 2);
        if (g.flip) xx = W - xx - ww;
        cb(xx, Math.round(topY) + i, ww, i, n);
      }
    },
    /** 實心菱形（cx 為中心 x、topY 為菱形頂點 y）。 */
    dia(cx, topY, w, h, col) {
      g.rows(cx, topY, w, h, (x, y, ww) => g.raw(x, y, ww, 1, col));
    },
    /** 帶 1px 描邊的菱形。 */
    diaO(cx, topY, w, h, col, ocol) {
      g.dia(cx, topY, w + 2, h + 2, ocol);
      g.dia(cx, topY + 1, w, h, col);
    },
    /** 菱形網點（只畫遮罩為 1 的點，其餘保持透明）→ 硬邊影子。 */
    diaMask(cx, topY, w, h, col, pattern) {
      const p = typeof pattern === 'object' && pattern.length === 4 ? pattern : DITHER[pattern] || DITHER.block50;
      g.rows(cx, topY, w, h, (x, y, ww) => {
        const row = p[((y % 4) + 4) % 4];
        let run = 0;
        for (let i = 0; i < ww; i++) {
          const on = row.charCodeAt((((x + i) % 4) + 4) % 4) === 49;
          if (on) run++;
          else if (run) {
            g.raw(x + i - run, y, run, 1, col);
            run = 0;
          }
        }
        if (run) g.raw(x + ww - run, y, run, 1, col);
      });
    },
    /** 棋盤格菱形（磁磚地板用）。 */
    diaChecker(cx, topY, w, h, colA, colB, block) {
      const b = Math.max(2, Math.round(block || 4));
      g.rows(cx, topY, w, h, (x, y, ww) => {
        for (let i = 0; i < ww; i += b) {
          const seg = Math.min(b, ww - i);
          const cA = ((((x + i) / b) | 0) + ((y / b) | 0)) & 1;
          g.raw(x + i, y, seg, 1, cA ? colB : colA);
        }
      });
    },
    /** 等角橢圓（圓桌用），逐列掃描、硬邊。 */
    ell(cx, cy, rx, ry, col) {
      const RY = Math.max(1, Math.round(ry));
      const RX = Math.max(1, Math.round(rx));
      for (let dy = -RY; dy <= RY; dy++) {
        const t = 1 - (dy * dy) / (RY * RY + RY);
        const w = Math.round(RX * Math.sqrt(Math.max(0, t)));
        if (w <= 0) continue;
        g.r(Math.round(cx - w), Math.round(cy + dy), w * 2, 1, col);
      }
    },
    /** 矩形網點。 */
    dith(x, y, w, h, a, b, pattern) {
      const ww = Math.round(w);
      const hh = Math.round(h);
      if (ww <= 0 || hh <= 0) return;
      const xx = g.flip ? W - Math.round(x) - ww : Math.round(x);
      ditherRect(c, xx, Math.round(y), ww, hh, a, b, pattern);
      lastFill = null;
    },
    /** 點陣圖章：'.'=透明，其餘字元查 map 取色。 */
    stamp(x, y, rowsArr, map) {
      for (let r = 0; r < rowsArr.length; r++) {
        const row = rowsArr[r];
        for (let i = 0; i < row.length; i++) {
          const ch = row.charCodeAt(i);
          if (ch === 46 || ch === 32) continue;
          const col = map[row[i]];
          if (col) g.p(x + i, y + r, col);
        }
      }
    },
    /** 舊版像素尺寸 → 新版（28×14 基準 × ART_SCALE；ART_SCALE = TILE_W / 28）。 */
    u(v) {
      return Math.round(v * ART_SCALE);
    },
    /** 是否畫接觸陰影（由 drawPerson / drawFurniture 依 view.fx 設定）。 */
    shadows: true,
  };
  return g;
}

/** 等角立方體（底面菱形中心 (cx,gy)、上方 hgt px）。 */
function cuboid(g, cx, gy, bw, bh, hgt, top, left, right, ocol) {
  const hw = bw / 2;
  const hh = bh / 2;
  const Wb = [cx - hw, gy];
  const Sb = [cx, gy + hh];
  const Eb = [cx + hw, gy];
  const Wt = [cx - hw, gy - hgt];
  const St = [cx, gy + hh - hgt];
  const Et = [cx + hw, gy - hgt];
  const Nt = [cx, gy - hh - hgt];
  g.poly([Wb, Sb, St, Wt], left);
  g.poly([Sb, Eb, Et, St], right);
  g.poly([Nt, Et, St, Wt], top);
  if (ocol) {
    g.line(Wt[0], Wt[1], St[0], St[1], ocol);
    g.line(St[0], St[1], Et[0], Et[1], ocol);
    g.line(Nt[0], Nt[1], Et[0], Et[1], ocol);
    g.line(Wt[0], Wt[1], Nt[0], Nt[1], ocol);
    g.line(Wt[0], Wt[1], Wb[0], Wb[1], ocol);
    g.line(Wb[0], Wb[1], Sb[0], Sb[1], ocol);
    g.line(Sb[0], Sb[1], Eb[0], Eb[1], ocol);
    g.line(Eb[0], Eb[1], Et[0], Et[1], ocol);
  }
  return { Wb, Sb, Eb, Wt, St, Et, Nt };
}

/** 等角板（薄片，例如桌面、貨架層板）。 */
function slab(g, cx, gy, bw, bh, thick, top, edge, ocol) {
  cuboid(g, cx, gy, bw, bh, thick, top, edge, shade(edge, 'black', 0.2), ocol);
}

// ===========================================================================
// 2. 人物（16×24、4 方向、2 格走路、坐姿、心情氣泡）
// ===========================================================================

const HAIR_LIST = ['hair_blk', 'hair_brn', 'hair_mid', 'hair_org', 'hair_gry', 'hair_blk'];
const SKIN_LIST = ['skin_hi', 'skin', 'skin_md', 'skin_lo'];
const SHIRT_LIST = [
  'shirt_teal', 'shirt_blu', 'shirt_red', 'shirt_yel', 'shirt_grn', 'shirt_prp',
  'shirt_pnk', 'shirt_org', 'shirt_wht', 'shirt_gry', 'shirt_nvy', 'shirt_brn',
];
const PANTS_LIST = ['pants_drk', 'pants_brn', 'pants_blu', 'pants_gry'];
const HAT_LIST = [0, 1, 2, 3, 4, 5, 1, 3];

const HEXLIKE = /^#[0-9a-fA-F]{3,8}$/;

function quant(hex, list, fallback) {
  if (typeof hex === 'number') return list[((hex | 0) % list.length + list.length) % list.length];
  if (typeof hex !== 'string' || !HEXLIKE.test(hex)) return fallback;
  let best = fallback;
  let bestD = Infinity;
  const R = parseInt(hex.slice(1, 3), 16) || 0;
  const G = parseInt(hex.slice(3, 5), 16) || 0;
  const B = parseInt(hex.slice(5, 7), 16) || 0;
  for (let i = 0; i < list.length; i++) {
    const c = color(list[i]);
    if (!HEXLIKE.test(c)) continue;
    const dr = R - (parseInt(c.slice(1, 3), 16) || 0);
    const dg = G - (parseInt(c.slice(3, 5), 16) || 0);
    const db = B - (parseInt(c.slice(5, 7), 16) || 0);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = list[i];
    }
  }
  return best;
}

function normDir(dir) {
  if (typeof dir === 'string' && dir.length) {
    const c = dir[0].toUpperCase();
    if (c === 'N' || c === 'S' || c === 'E' || c === 'W') return c;
  }
  if (typeof dir === 'number') return ['S', 'E', 'N', 'W'][((dir | 0) % 4 + 4) % 4];
  return 'S';
}

function normHat(hat) {
  if (typeof hat === 'number') return HAT_LIST[((hat | 0) % HAT_LIST.length + HAT_LIST.length) % HAT_LIST.length];
  if (typeof hat === 'string' && hat) {
    const s = hat.toLowerCase();
    if (s === 'none' || s === '0' || s === 'no') return 0;
    if (s.includes('chef') || s.includes('toque')) return 2;
    if (s.includes('band') || s.includes('hachimaki')) return 3;
    if (s.includes('net')) return 4;
    if (s.includes('visor')) return 5;
    return 1;
  }
  return 0;
}

/** 把 appearance 量化到受限色票（讓快取鍵數量有界）。 */
export function quantizeAppearance(app) {
  const a = app && typeof app === 'object' ? app : {};
  const shirt = quant(a.shirt, SHIRT_LIST, 'shirt_teal');
  return {
    hair: quant(a.hair, HAIR_LIST, 'hair_blk'),
    skin: quant(a.skin, SKIN_LIST, 'skin'),
    shirt,
    pants: quant(a.pants, PANTS_LIST, 'pants_drk'),
    hat: normHat(a.hat),
    hatCol: quant(a.hatColor || a.cap, SHIRT_LIST, 'shirt_nvy'),
    shoe: quant(a.shoe, ['hair_blk', 'pants_brn', 'wood_dark'], 'hair_blk'),
    uniform: typeof a.uniform === 'string' ? a.uniform : null,
  };
}

/** 由 uid 產生決定性外觀（工作人員沒有 portrait 時的後備）。 */
export function appearanceFromSeed(seed, role) {
  let h = 2166136261;
  const s = String(seed == null ? 'x' : seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (n) => ((h >>> (n * 3)) & 255) / 255;
  const chef = role === 'chef';
  return {
    hair: HAIR_LIST[(u(0) * HAIR_LIST.length) | 0],
    skin: SKIN_LIST[(u(1) * SKIN_LIST.length) | 0],
    shirt: chef ? 'shirt_wht' : SHIRT_LIST[(u(2) * SHIRT_LIST.length) | 0],
    pants: PANTS_LIST[(u(3) * PANTS_LIST.length) | 0],
    hat: chef ? 2 : 1,
    uniform: chef ? 'chef' : 'waiter',
  };
}

// ===========================================================================
// 2b. 人物 24×36（原 16×24 的 1.5 倍畫布，但重新手繪，非放大）
//     姿勢：walk(4) / idle(2) / carry / eat / angry / seated
// ===========================================================================

const HAIR_STYLES = ['short', 'long', 'bun', 'bald', 'cap'];

/** 由 appearance 決定髮型（可用 appearance.style / appearance.hair2 覆寫）。 */
function hairStyle(app, hat) {
  if (typeof app.style === 'string' && HAIR_STYLES.indexOf(app.style) >= 0) return app.style;
  if (hat === 2 || hat === 1) return 'short';
  const h = typeof app.hair === 'string' ? app.hair : '';
  let s = 0;
  for (let i = 0; i < h.length; i++) s = (s * 31 + h.charCodeAt(i)) | 0;
  return HAIR_STYLES[Math.abs(s) % HAIR_STYLES.length];
}

/** 顧客類型附加配件（學生書包／上班族西裝／家庭／觀光客相機／評論家筆記／VIP）。 */
const CUSTOMER_KINDS = ['student', 'office', 'family', 'tourist', 'critic', 'vip'];

function normalKind(kind) {
  if (typeof kind !== 'string' || !kind) return null;
  const k = kind.toLowerCase();
  if (CUSTOMER_KINDS.indexOf(k) >= 0) return k;
  if (k.indexOf('stud') >= 0) return 'student';
  if (k.indexOf('office') >= 0 || k.indexOf('suit') >= 0) return 'office';
  if (k.indexOf('family') >= 0 || k.indexOf('kid') >= 0) return 'family';
  if (k.indexOf('tour') >= 0) return 'tourist';
  if (k.indexOf('crit') >= 0 || k.indexOf('review') >= 0) return 'critic';
  if (k.indexOf('vip') >= 0 || k.indexOf('rich') >= 0) return 'vip';
  return null;
}

/**
 * 繪製人物。pose: 'walk'|'idle'|'carry'|'eat'|'angry'|'seated'
 * 座標：24×36，腳底＝第 36 列（最後一列為影子）。
 */
/**
 * 人物繪製：32×48（原 24×36 的 4/3 倍畫布，重新手繪）。
 * 座標全部為整數（畫布 32×48，腳底＝第 48 列，最後 3 列為接觸陰影）。
 * pose: 'walk'|'idle'|'carry'|'eat'|'angry'|'seated'
 * 版面：頭髮 3–8／臉 8–18／下巴 18–19／脖子 20／肩 21／軀幹 21–34／腰帶 35／
 *       褲 36–38／腿 39–44／鞋 44–46／影子 46–47；寬度：頭 10、軀幹 14、手臂 3。
 */
function paintPerson(c, o) {
  const g = mkPainter(c, PERSON_W, o.flip);
  const dir = o.dir;
  const pose = o.pose || (o.seated ? 'seated' : 'walk');
  const seated = pose === 'seated' || pose === 'eat';
  const walk = pose === 'walk';
  const wf = walk ? (o.frame & 3) : 0;
  const bob = walk && (wf === 1 || wf === 3) ? -1 : 0;
  const breathe = pose === 'idle' && (o.frame & 1) ? -1 : 0;
  const off = seated ? 9 : 0; // 坐姿整體下移
  const stature = o.stature === -1 || o.stature === 1 ? o.stature : 0; // 家人身高差（±1px）
  const OL = 'furn_outline';

  const sk = o.skin;
  const skHi = shade(sk, 'white', 0.34);
  const skLo = shade(sk, 'skin_sh', 0.48);
  const ha = o.hair;
  const haHi = shade(ha, 'white', 0.26);
  const haLo = shade(ha, 'black', 0.32);
  const sh = o.uniform === 'chef' ? 'shirt_wht' : o.shirt;
  const shHi = shade(sh, 'white', 0.30);
  const shLo = shade(sh, 'black', 0.30);
  const pt = o.pants;
  const ptLo = shade(pt, 'black', 0.32);
  const so = o.shoe;
  const style = o.style;
  const kind = o.kind;
  const apron = o.uniform === 'waiter' ? 'teal_lo' : null;

  // ── 版面基準列 ──────────────────────────────────────────────────────
  const footRow = 44;
  const hipRow = 35;
  const shoulderRow = 21;
  const neckRow = 20;
  const faceTop = 8;
  const headTop = 3;
  const yS = stature; // 身高差：整個人往上 1px 或往下 1px

  // ── 接觸陰影（硬邊網點橢圓，與傢俱同方向、往右下偏 1px）─────────────
  if (!seated && o.shadows !== false) {
    g.ell(15, 46, 9, 2, 'shadow');
    g.ell(16, 46, 6, 1, 'shadow');
    g.r(10, 47, 10, 1, 'shadow');
  }

  // ── 腿／鞋 ──────────────────────────────────────────────────────────
  if (!seated) {
    const lx = 11 + (walk ? (wf === 0 ? -1 : wf === 2 ? 1 : 0) : 0);
    const rx = 17 + (walk ? (wf === 0 ? 1 : wf === 2 ? -1 : 0) : 0);
    const lLeg = 7 + (walk && wf === 1 ? -3 : walk && wf === 3 ? -4 : 0);
    const rLeg = 7 + (walk && wf === 3 ? -3 : walk && wf === 1 ? -4 : 0);
    g.r(lx, hipRow + 1 + bob + yS, 4, lLeg + bob, pt);
    g.r(rx, hipRow + 1 + bob + yS, 4, rLeg + bob, pt);
    g.r(lx, hipRow + 1 + bob + yS, 1, lLeg + bob, ptLo);
    g.r(rx, hipRow + 1 + bob + yS, 1, rLeg + bob, ptLo);
    // 褲管折線
    g.r(lx + 2, hipRow + 2 + yS, 1, lLeg - 1, shade(pt, 'black', 0.16));
    g.r(rx + 2, hipRow + 2 + yS, 1, rLeg - 1, shade(pt, 'black', 0.16));
    // 鞋（含鞋底暗線）
    const lsy = footRow - 1 + bob + yS + (walk && wf === 1 ? -1 : 0);
    const rsy = footRow - 1 + bob + yS + (walk && wf === 3 ? -1 : 0);
    g.r(lx - 2, lsy, 7, 4, OL);
    g.r(rx - 1, rsy, 7, 4, OL);
    g.r(lx - 1, lsy + 1, 6, 2, so);
    g.r(rx, rsy + 1, 6, 2, so);
    g.r(lx - 1, lsy + 3, 6, 1, shade(so, 'black', 0.45));
    g.r(rx, rsy + 3, 6, 1, shade(so, 'black', 0.45));
    g.r(lx, lsy + 1, 3, 1, shade(so, 'white', 0.25));
    g.r(rx + 1, rsy + 1, 3, 1, shade(so, 'white', 0.25));
  } else {
    // 坐姿：大腿往前延伸，看不到小腿
    g.r(7, hipRow - 1 + off + yS, 18, 5, pt);
    g.r(7, hipRow - 1 + off + yS, 18, 1, shade(pt, 'white', 0.16));
    g.r(7, hipRow + 3 + off + yS, 18, 1, ptLo);
    g.r(23, hipRow + off + yS, 4, 4, so);
    g.r(23, hipRow + off + yS, 4, 1, shade(so, 'white', 0.25));
  }

  // ── 腰帶（含皮帶頭）────────────────────────────────────────────────
  g.r(11, hipRow - 2 + off + bob + yS, 11, 2, shade(pt, 'black', 0.5));
  g.r(15, hipRow - 2 + off + bob + yS, 3, 2, 'metal_md');

  // ── 軀幹 ────────────────────────────────────────────────────────────
  const torsoTop = shoulderRow + bob + off + breathe + yS;
  const torsoBot = hipRow - 2 + off + bob + yS;
  const torH = torsoBot - torsoTop;
  g.r(9, torsoTop, 14, torH, sh);
  g.r(11, torsoTop + 1, 10, torH - 1, sh);
  g.r(9, torsoTop, 14, 1, mixHex(sh, '#ffffff', 0.5)); // 肩線高光
  g.r(9, torsoTop, 1, torH, shLo);
  g.r(22, torsoTop, 1, torH, shLo);
  g.r(15, torsoTop + 1, 2, torH - 2, mixHex(shHi, '#ffffff', 0.28)); // 門襟
  // 布料：白色網點打亮（人物必須從地板色調裡跳出來；地板在早晨／傍晚偏亮，
  // 所以衣料整體偏亮、再由深色袖側與輪廓收邊）
  g.dith(10, torsoTop + 2, 12, Math.max(2, torH - 3), mixHex(sh, '#ffffff', 0.55), 'clear', DITHER.block50);
  g.r(10, torsoTop + 2, 2, Math.max(2, torH - 3), mixHex(sh, '#ffffff', 0.25)); // 左肩受光
  g.r(20, torsoTop + 2, 2, Math.max(2, torH - 3), mixHex(sh, '#ffffff', 0.25)); // 右肩受光
  // 領口
  g.r(13, torsoTop, 6, 1, shLo);
  g.r(14, torsoTop + 1, 4, 2, skLo);
  if (o.uniform === 'chef') {
    g.r(13, torsoTop + 3, 6, torH - 4, 'shirt_wht');
    for (let i = 0; i < 3; i++) {
      g.r(13, torsoTop + 4 + i * 4, 2, 2, 'gray_30');
      g.r(17, torsoTop + 4 + i * 4, 2, 2, 'gray_30');
    }
    g.r(13, torsoTop, 6, 2, 'gray_70');
  } else if (apron) {
    g.r(10, torsoTop + 4, 12, torH - 4, apron);
    g.r(10, torsoTop + 4, 1, torH - 4, shade(apron, 'black', 0.35));
    g.r(12, torsoTop + 2, 8, 2, apron);
    g.r(14, torsoTop + 1, 4, 2, 'red_md'); // 領結
    g.r(15, torsoTop + 2, 2, 1, 'red_hi');
  } else if (kind === 'office' || kind === 'vip' || kind === 'critic') {
    g.r(9, torsoTop + 3, 4, torH - 3, shade(sh, 'black', 0.38));
    g.r(19, torsoTop + 3, 4, torH - 3, shade(sh, 'black', 0.38));
    g.r(15, torsoTop + 2, 2, 6, kind === 'vip' ? 'red_md' : 'shirt_nvy'); // 領帶
    g.r(15, torsoTop + 2, 2, 1, 'white');
    if (kind === 'vip') g.r(19, torsoTop + 5, 3, 2, 'lamp_md'); // 口袋巾
  } else if (kind === 'family') {
    g.r(10, torsoTop + 6, 12, 3, shade(sh, 'black', 0.18));
    g.r(12, torsoTop + 7, 8, 1, shade(sh, 'white', 0.2));
  } else if (kind === 'tourist') {
    g.r(9, torsoTop + 3, 3, torH - 5, 'shirt_org');
    g.r(20, torsoTop + 3, 3, torH - 5, 'shirt_org');
  }

  // ── 手臂 ────────────────────────────────────────────────────────────
  const armCol = o.uniform ? 'shirt_wht' : sh;
  const swing = walk ? [1, 0, -1, 0][wf] : 0;
  if (pose === 'carry') {
    // 端盤：托盤在胸前，盤子＋杯子看得出來，雙手扶著托盤兩側
    const ty = torsoTop + 11;
    g.r(5, torsoTop + 4, 4, 6, armCol);
    g.r(23, torsoTop + 4, 4, 6, armCol);
    g.r(4, torsoTop + 3, 1, 8, shLo);
    g.r(27, torsoTop + 3, 1, 8, shLo);
    g.r(8, ty, 16, 2, OL); // 托盤底
    g.r(9, ty - 1, 14, 1, 'metal');
    g.r(10, ty - 2, 12, 1, 'metal_hi');
    g.dia(13, ty - 8, 11, 6, OL); // 盤子
    g.dia(13, ty - 7, 9, 4, 'gray_90');
    g.r(11, ty - 7, 5, 1, 'white');
    g.r(19, ty - 8, 4, 6, OL); // 杯子
    g.r(19, ty - 7, 3, 5, 'shirt_wht');
    g.r(19, ty - 7, 3, 1, 'white');
    g.r(6, ty, 4, 4, sk); // 雙手扶盤
    g.r(22, ty, 4, 4, sk);
    g.r(6, ty + 3, 4, 1, OL);
    g.r(22, ty + 3, 4, 1, OL);
  } else if (pose === 'angry') {
    // 生氣：雙臂外張、握拳在腰側（不舉過頭）＋怒氣符號畫在頭側
    g.r(4, torsoTop + 4, 4, 9, armCol);
    g.r(24, torsoTop + 4, 4, 9, armCol);
    g.r(3, torsoTop + 12, 5, 5, sk);
    g.r(24, torsoTop + 12, 5, 5, sk);
    g.r(3, torsoTop + 16, 5, 1, OL);
    g.r(24, torsoTop + 16, 5, 1, OL);
    g.r(4, torsoTop + 3, 3, 1, shLo);
    g.r(25, torsoTop + 3, 3, 1, shLo);
  } else if (pose === 'eat') {
    g.r(6, torsoTop + 3 + swing, 3, torH - 4, armCol);
    g.r(23, torsoTop + 3 - swing, 3, torH - 4, armCol);
    g.r(19, torsoTop - 2, 3, 7, armCol); // 前臂抬到嘴邊
    g.r(17, torsoTop - 5, 5, 3, sk);
    g.r(21, torsoTop - 6, 2, 3, 'gray_70'); // 筷子／叉子
  } else {
    g.r(7, torsoTop + 2 + swing, 3, torH - 3, armCol);
    g.r(22, torsoTop + 2 - swing, 3, torH - 3, armCol);
    g.r(7, torsoTop + 2 + swing, 1, torH - 3, mixHex(armCol, '#ffffff', 0.4)); // 手臂外緣受光
    g.r(24, torsoTop + 2 - swing, 1, torH - 3, mixHex(armCol, '#ffffff', 0.4));
    g.r(6, torsoTop + 2 + swing, 1, torH - 3, shLo);
    g.r(25, torsoTop + 2 - swing, 1, torH - 3, shLo);
    // 袖口
    g.r(7, torsoTop + torH - 2 + swing, 3, 1, shHi);
    g.r(22, torsoTop + torH - 2 - swing, 3, 1, shHi);
    if (kind === 'critic') {
      g.r(5, torsoTop + torH - 1 + swing, 4, 4, sk);
      g.r(3, torsoTop + torH + 2 + swing, 5, 5, 'shirt_wht'); // 筆記本
      g.r(4, torsoTop + torH + 3 + swing, 3, 1, 'gray_30');
      g.r(6, torsoTop + torH + 7 + swing, 2, 6, 'white'); // 筆
    } else if (kind === 'tourist') {
      g.r(5, torsoTop + torH - 1 + swing, 4, 3, sk);
      g.r(23, torsoTop + torH - 1 - swing, 4, 3, sk);
      g.r(11, torsoTop + 7, 10, 6, OL); // 掛在胸前的相機
      g.r(12, torsoTop + 8, 8, 4, 'gray_30');
      g.r(13, torsoTop + 8, 3, 3, 'sky_hi');
      g.r(17, torsoTop + 9, 2, 1, 'white');
    } else {
      g.r(5, torsoTop + torH - 1 + swing, 4, 4, sk);
      g.r(23, torsoTop + torH - 1 - swing, 4, 4, sk);
      g.r(5, torsoTop + torH + 2 + swing, 4, 1, skLo);
      g.r(23, torsoTop + torH + 2 - swing, 4, 1, skLo);
    }
  }

  // ── 脖子 ────────────────────────────────────────────────────────────
  g.r(13, neckRow + bob + off + breathe + yS, 6, 2, skLo);
  g.r(14, neckRow + bob + off + breathe + yS, 4, 1, sk);

  // ── 頭 ──────────────────────────────────────────────────────────────
  const ft = faceTop + off + bob + breathe + yS;
  const ht = headTop + off + bob + breathe + yS;
  if (dir === 'E') {
    g.r(11, ft, 10, 8, sk);
    g.r(20, ft + 2, 3, 4, sk); // 鼻
    g.r(22, ft + 3, 1, 1, skLo);
    g.r(11, ft + 7, 8, 1, skLo); // 下顎陰影
  } else {
    g.r(11, ft, 10, 8, sk);
    g.r(12, ft + 8, 8, 1, skLo); // 下巴
    g.r(11, ft, 10, 1, skHi); // 額頭高光
    g.r(12, ft + 4, 1, 3, shade(sk, 'red_hi', 0.22)); // 臉頰陰影
    g.r(19, ft + 4, 1, 3, shade(sk, 'red_hi', 0.22));
  }

  // ── 髮型 ────────────────────────────────────────────────────────────
  if (style === 'bald') {
    g.r(11, ht + 1, 10, 2, skHi);
    if (dir !== 'N') g.r(10, ft + 2, 1, 4, ha);
    g.r(10, ht + 3, 1, 3, ha);
    g.r(21, ht + 3, 1, 3, ha);
  } else if (style === 'long') {
    if (dir === 'N') {
      g.r(10, ht, 12, 13, ha);
      g.r(10, ht, 12, 3, haHi);
      g.r(10, ht + 10, 12, 2, haLo);
    } else {
      g.r(10, ht, 12, 6, ha);
      g.r(9, ht + 3, 2, 11, ha);
      g.r(21, ht + 3, 2, 11, ha);
      g.r(10, ht, 12, 1, haHi);
      g.r(9, ht + 12, 2, 2, haLo);
      g.r(21, ht + 12, 2, 2, haLo);
      if (dir === 'E') g.r(9, ht + 2, 10, 4, ha);
    }
  } else if (style === 'bun') {
    g.r(11, ht, 10, 6, ha);
    g.r(10, ht + 2, 12, 4, ha);
    g.r(11, ht, 6, 2, haHi);
    g.dia(16, ht - 5, 9, 8, ha);
    g.p(15, ht - 3, haHi);
  } else if (style === 'cap') {
    g.r(10, ht, 12, 6, o.hatCol);
    g.r(10, ht, 12, 2, shade(o.hatCol, 'white', 0.32));
    g.r(10, ht + 5, 14, 2, shade(o.hatCol, 'black', 0.3));
    g.r(12, ht + 1, 8, 1, 'white');
  } else {
    g.r(11, ht, 10, 2, ha);
    g.r(10, ht + 1, 12, 5, ha);
    g.r(11, ht, 10, 1, haHi);
    if (dir === 'N') {
      g.r(10, ht + 1, 12, 10, ha);
      g.r(10, ht + 8, 12, 3, haLo);
      g.r(12, ht + 3, 8, 1, haHi);
    } else {
      g.r(10, ht + 1, 1, 8, ha);
      g.r(21, ht + 1, 1, 8, ha);
      g.r(10, ht + 1, 2, 8, haLo);
      if (dir === 'E') g.r(10, ht + 1, 3, 8, ha);
    }
  }

  // ── 五官 ────────────────────────────────────────────────────────────
  if (dir === 'S') {
    if (o.blink) {
      g.r(12, ft + 3, 4, 1, OL);
      g.r(16, ft + 3, 4, 1, OL);
    } else {
      g.r(12, ft + 3, 3, 3, 'white');
      g.r(17, ft + 3, 3, 3, 'white');
      g.r(13, ft + 3, 2, 3, OL);
      g.r(17, ft + 3, 2, 3, OL);
      g.p(14, ft + 3, 'white');
      g.p(18, ft + 3, 'white');
    }
    g.r(12, ft + 2, 3, 1, haLo); // 眉
    g.r(17, ft + 2, 3, 1, haLo);
    g.r(15, ft + 6, 2, 1, 'red_lo'); // 嘴
    g.r(14, ft + 7, 4, 1, shade(sk, 'red_hi', 0.3));
  } else if (dir === 'E') {
    g.r(17, ft + 3, 3, 3, 'white');
    g.r(18, ft + 3, 2, 3, OL);
    g.r(17, ft + 2, 3, 1, haLo);
    g.r(20, ft + 6, 2, 1, 'red_lo');
  } else if (dir === 'W') {
    g.r(12, ft + 3, 3, 3, 'white');
    g.r(12, ft + 3, 2, 3, OL);
    g.r(11, ft + 2, 3, 1, haLo);
    g.r(10, ft + 6, 2, 1, 'red_lo');
  }

  // ── 帽子 ────────────────────────────────────────────────────────────
  if (o.hat === 2) {
    g.r(9, ht - 7, 14, 5, 'shirt_wht'); // 廚師高帽
    g.r(10, ht - 10, 12, 3, 'white');
    g.r(9, ht - 7, 14, 1, 'white');
    g.r(9, ht - 2, 14, 1, 'gray_70');
    g.r(10, ht, 12, 1, 'gray_90');
  } else if (o.hat === 1) {
    g.r(10, ht - 1, 12, 3, o.hatCol);
    g.r(10, ht - 1, 12, 1, shade(o.hatCol, 'white', 0.3));
    g.r(dir === 'E' ? 20 : 10, ht + 2, dir === 'E' ? 8 : 14, 1, shade(o.hatCol, 'black', 0.3));
  } else if (o.hat === 3) {
    g.r(10, ht + 3, 12, 2, 'red');
    g.r(21, ht + 3, 3, 2, 'red');
    g.r(10, ht + 3, 12, 1, 'red_hi');
  } else if (o.hat === 5) {
    g.r(10, ht - 1, 12, 1, o.hatCol);
    g.r(20, ht + 4, 8, 1, shade(o.hatCol, 'black', 0.25));
  }

  // ── 生氣：臉部泛紅 + 頭側怒氣符號（眼睛必須保持看得見）─────────────────
  if (pose === 'angry') {
    // 兩頰網點泛紅（只蓋臉頰，不蓋眼睛）
    g.dith(11, ft + 5, 3, 3, 'red_hi', 'clear', DITHER.block50);
    g.dith(18, ft + 5, 3, 3, 'red_hi', 'clear', DITHER.block50);
    // 怒眉（內低外高）＋ < > 眼型
    g.r(12, ft + 1, 3, 1, OL);
    g.r(17, ft + 1, 3, 1, OL);
    g.r(12, ft + 2, 2, 1, OL);
    g.r(18, ft + 2, 2, 1, OL);
    g.r(12, ft + 3, 2, 2, 'white');
    g.r(18, ft + 3, 2, 2, 'white');
    g.r(12, ft + 3, 2, 1, OL);
    g.r(18, ft + 4, 2, 1, OL);
    g.r(13, ft + 4, 1, 1, OL);
    g.r(17, ft + 3, 1, 1, OL);
    // 張嘴生氣
    g.r(14, ft + 6, 4, 2, 'red_lo');
    g.r(15, ft + 6, 2, 1, OL);
    const ax = 25;
    const ay = ft - 2;
    g.r(ax, ay + 3, 7, 1, 'red');
    g.r(ax + 3, ay, 1, 7, 'red');
    g.p(ax, ay, 'red_hi');
    g.p(ax + 6, ay + 6, 'red_hi');
    g.p(ax, ay + 6, 'red_hi');
    g.p(ax + 6, ay, 'red_hi');
  }
}


/**
 * 畫一個人（腳底中心對齊 x, y）。
 * opts: {dir:'N'|'S'|'E'|'W', frame, pose:'walk'|'idle'|'carry'|'eat'|'angry'|'seated',
 *        seated (pose 的別名), appearance, mood, uniform, kind, blink, style, shadows}
 * 姿勢全部由既有欄位推導（floor.js 依 state / dir / seatedDir / frame / mood 決定），
 * 不需要新增任何 state 欄位。
 * `shadows: false` 會連貼圖裡的接觸陰影一起不畫（view.fx.shadows）。
 */
export function drawPerson(ctx, appearance, x, y, opts = {}) {
  if (!ctx) return null;
  const o = opts || {};
  const app = appearance || o.appearance || {};
  const q = quantizeAppearance(app);
  const dir0 = normDir(o.dir);
  const flip = dir0 === 'W';
  const dir = flip ? 'E' : dir0;
  const frame = Number.isFinite(Number(o.frame)) ? (Number(o.frame) | 0) : 0;
  const uniform = q.uniform || o.uniform || null;
  const kind = normalKind(o.kind);
  const style = hairStyle(app, q.hat);
  const pose = typeof o.pose === 'string' && POSES.indexOf(o.pose) >= 0
    ? o.pose
    : (o.seated ? 'seated' : 'walk');
  const blink = o.blink ? 1 : 0;
  // 家人身高差：-1 / 0 / +1 px（同一 sprite 快取需分開）
  const stature = o.stature === 1 ? 1 : o.stature === -1 ? -1 : 0;
  const shadows = o.shadows !== false;
  const key = `p4|${q.hair}|${q.skin}|${q.shirt}|${q.pants}|${q.hat}|${q.hatCol}|${q.shoe}|${style}|${dir}|${frame & 3}|${pose}|${uniform || ''}|${kind || ''}|${blink}|s${stature}|w${shadows ? 1 : 0}`;
  const paint = (c) => paintPerson(c, {
    dir, frame, pose, flip, hair: q.hair, skin: q.skin, shirt: q.shirt,
    pants: q.pants, hat: q.hat, hatCol: q.hatCol, shoe: q.shoe, uniform, kind, style, blink,
    mood: o.mood, stature, shadows,
  });
  const dx = Math.round(x - PERSON_W / 2);
  const dy = Math.round(y - PERSON_ANCHOR);
  const cv = cachedSprite(key, PERSON_W, PERSON_H, paint);
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, PERSON_W, PERSON_H, dx, dy, () => paint(ctx));
  const out = o.out || {};
  out.x = dx;
  out.y = dy;
  out.w = PERSON_W;
  out.h = PERSON_H;
  out.dir = dir0;
  out.pose = pose;
  return out;
}

/** 人物可用姿勢（floor.js 與測試共用）。 */
export const POSES = ['walk', 'idle', 'carry', 'eat', 'angry', 'seated'];

// ===========================================================================
// 3. 心情氣泡
// ===========================================================================

const BUBBLE_ALIAS = {
  love: 'love', heart: 'love', like: 'love', happy: 'happy', smile: 'happy', good: 'happy',
  anger: 'anger', angry: 'anger', rage: 'rage', mad: 'anger', vein: 'anger',
  wait: 'wait', clock: 'wait', time: 'wait', patience: 'wait', hourglass: 'wait',
  money: 'money', coin: 'money', cash: 'money', tip: 'tip', bill: 'money', pay: 'money',
  sad: 'sad', cry: 'sad', bad: 'sad', disappoint: 'sad',
  question: 'question', order: 'question', ask: 'question', '?': 'question',
  star: 'star', vip: 'star', fame: 'star',
  dirty: 'dirty', fly: 'dirty', stink: 'dirty', clean: 'dirty',
  cold: 'cold', freeze: 'cold', hot: 'hot', heat: 'hot',
  hungry: 'hungry', food: 'hungry', eat: 'hungry',
  zzz: 'zzz', sleep: 'zzz', tired: 'zzz',
  call: 'call', waiter: 'call', service: 'call',
  lovebig: 'love',
};

/** 正規化氣泡種類（未知 → 'wait'）。 */
export function bubbleKind(kind) {
  if (typeof kind !== 'string' || !kind) return null;
  const k = kind.toLowerCase().replace(/[^a-z?]/g, '');
  if (!k) return null;
  return BUBBLE_ALIAS[k] || BUBBLE_ALIAS[kind] || 'wait';
}

const BUBBLE_ART = {
  love: { 3: ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000', '0000000'] },
  anger: { 3: ['0010000', '1010100', '0101000', '0010000', '0101000', '1010100', '0010000'] },
  wait: {
    3: ['0011100', '0111110', '1101011', '1100111', '1100011', '0111110', '0011100'],
  },
  money: { 3: ['0011100', '0111110', '1101101', '1101100', '1101100', '0111110', '0011100'] },
  sad: { 3: ['0011100', '0100010', '1000001', '1001001', '1000001', '0100010', '0011100'] },
};

function paintBubble(c, o) {
  const W = 20;
  const H = 20;
  const g = mkPainter(c, W, false);
  const bob = o.frame & 1;
  const top = bob ? 1 : 2;
  // 氣泡框：米黃 + 1px 描邊 + 左下尖角
  g.r(1, top, 17, 14, 'outline');
  g.r(2, top + 1, 15, 12, 'wall_hi');
  g.r(2, top + 1, 15, 1, 'white');
  g.r(2, top + 12, 15, 1, 'wall_md');
  g.r(2, top + 14, 2, 1, 'outline');
  g.r(3, top + 15, 2, 1, 'outline');
  g.r(4, top + 16, 1, 1, 'outline');
  const kind = o.kind;
  const icon = BUBBLE_ART[kind];
  const cxp = 10;
  const cyp = top + 7;
  if (icon) {
    const rows = icon[3];
    const map = {
      0: 'wall_hi',
      1: kind === 'love' ? 'mood_good'
        : kind === 'anger' ? 'mood_bad'
          : kind === 'money' ? 'lamp_md'
            : kind === 'sad' ? 'sky_md' : 'gray_50',
    };
    if (kind === 'love') {
      g.stamp(cxp - 5, cyp - 4, rows, { 1: 'outline' });
      g.stamp(cxp - 4, cyp - 3, rows, { 1: 'neon_pink' });
      g.r(cxp - 3, cyp - 2, 1, 1, 'red_hi');
    } else {
      g.stamp(cxp - 4, cyp - 3, rows, map);
    }
    if (kind === 'anger') {
      g.r(cxp - 1, cyp - 2, 2, 5, 'mood_bad');
      g.r(cxp - 4, cyp, 8, 2, 'mood_bad');
    }
    if (kind === 'money') {
      g.r(cxp - 2, cyp - 2, 4, 1, 'lamp_hi');
      g.r(cxp - 1, cyp - 1, 1, 3, 'lamp_sh');
      g.r(cxp, cyp - 1, 1, 3, 'lamp_sh');
    }
    if (kind === 'wait') {
      g.r(cxp - 1, cyp - 2, 1, 3, 'outline');
      g.r(cxp - 1, cyp, 2, 1, 'outline');
    }
    if (kind === 'sad') {
      g.r(cxp - 2, cyp - 1, 1, 1, 'outline');
      g.r(cxp + 1, cyp - 1, 1, 1, 'outline');
    }
  } else if (kind === 'rage') {
    g.r(cxp - 4, cyp - 3, 8, 7, 'mood_bad');
    g.r(cxp - 3, cyp - 2, 1, 1, 'outline');
    g.r(cxp + 2, cyp - 2, 1, 1, 'outline');
    g.r(cxp - 2, cyp + 2, 4, 1, 'outline');
  } else if (kind === 'happy') {
    g.r(cxp - 3, cyp - 2, 1, 1, 'outline');
    g.r(cxp + 2, cyp - 2, 1, 1, 'outline');
    g.r(cxp - 2, cyp + 1, 4, 1, 'outline');
    g.r(cxp - 3, cyp + 2, 1, 1, 'outline');
    g.r(cxp + 2, cyp + 2, 1, 1, 'outline');
  } else if (kind === 'question') {
    g.r(cxp - 2, cyp - 3, 5, 1, 'red_md' in PALETTE ? 'red_md' : 'red');
    g.r(cxp + 2, cyp - 2, 1, 2, 'red');
    g.r(cxp + 1, cyp, 1, 1, 'red');
    g.r(cxp, cyp + 1, 1, 1, 'red');
    g.r(cxp, cyp + 3, 1, 1, 'red');
  } else if (kind === 'star') {
    g.stamp(cxp - 4, cyp - 3, [
      '...1...', '..121..', '1112111', '.11211.', '..121..', '.11.11.', '.......',
    ], { 1: 'neon_yel', 2: 'lamp_hi' });
  } else if (kind === 'dirty') {
    g.r(cxp - 1, cyp - 3, 3, 6, 'hair_brn');
    g.r(cxp - 2, cyp - 1, 1, 4, 'hair_brn');
    g.r(cxp + 2, cyp - 1, 1, 4, 'hair_brn');
    g.r(cxp - 3, cyp - 4, 1, 2, 'gray_50');
    g.r(cxp + 3, cyp - 4, 1, 2, 'gray_50');
  } else if (kind === 'cold') {
    g.r(cxp - 3, cyp, 7, 1, 'sky_hi');
    g.r(cxp, cyp - 3, 1, 7, 'sky_hi');
    g.r(cxp - 2, cyp - 2, 1, 1, 'white');
    g.r(cxp + 2, cyp + 2, 1, 1, 'white');
  } else if (kind === 'hot') {
    g.dia(cxp, cyp - 3, 7, 7, 'lamp_md');
    g.r(cxp - 5, cyp, 2, 1, 'lamp_lo');
    g.r(cxp + 4, cyp, 2, 1, 'lamp_lo');
    g.r(cxp, cyp - 6, 1, 2, 'lamp_lo');
  } else if (kind === 'hungry') {
    g.r(cxp - 3, cyp - 1, 7, 2, 'gray_70');
    g.r(cxp - 2, cyp - 3, 5, 2, 'shirt_org');
    g.r(cxp - 4, cyp + 1, 9, 1, 'gray_50');
  } else if (kind === 'zzz') {
    g.r(cxp - 2, cyp - 3, 4, 1, 'shirt_nvy');
    g.r(cxp + 1, cyp - 2, 1, 1, 'shirt_nvy');
    g.r(cxp - 2, cyp - 1, 4, 1, 'shirt_nvy');
    g.r(cxp + 2, cyp + 1, 3, 1, 'shirt_blu');
    g.r(cxp + 3, cyp + 2, 1, 1, 'shirt_blu');
    g.r(cxp + 2, cyp + 3, 3, 1, 'shirt_blu');
  } else if (kind === 'call') {
    g.r(cxp - 1, cyp - 4, 3, 5, 'lamp_md');
    g.r(cxp - 1, cyp + 2, 3, 1, 'lamp_md');
    g.r(cxp - 4, cyp - 5, 9, 1, 'lamp_lo');
    g.r(cxp - 5, cyp - 3, 1, 3, 'lamp_lo');
    g.r(cxp + 5, cyp - 3, 1, 3, 'lamp_lo');
  } else if (kind === 'tip') {
    g.r(cxp - 4, cyp - 2, 9, 5, 'white');
    g.box(cxp - 4, cyp - 2, 9, 5, 'gray_50');
    g.line(cxp - 4, cyp - 2, cxp, cyp + 1, 'gray_50');
    g.line(cxp + 4, cyp - 2, cxp, cyp + 1, 'gray_50');
  }
}

/** 畫心情氣泡；x,y 為氣泡左下尖角位置。 */
export function drawBubble(ctx, kind, x, y, frame = 0) {
  if (!ctx) return null;
  const k = bubbleKind(kind) || 'wait';
  const f = (Number(frame) | 0) & 1;
  const key = `b|${k}|${f}`;
  const cv = cachedSprite(key, 20, 20, (c) => paintBubble(c, { kind: k, frame: f }));
  const dx = Math.round(x);
  const dy = Math.round(y - (f ? 18 : 17));
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, 20, 20, dx, dy, () => paintBubble(ctx, { kind: k, frame: f }));
  BUBBLE_BOX.x = dx;
  BUBBLE_BOX.y = dy;
  BUBBLE_BOX.w = 20;
  BUBBLE_BOX.h = 20;
  return BUBBLE_BOX;
}
const BUBBLE_BOX = { x: 0, y: 0, w: 20, h: 20 };

// ===========================================================================
// 3b. 人數徽章（候位／同桌人數；手繪 0–9 像素字，不使用 canvas 文字 API）
// ===========================================================================

/** 3×5 手繪數字（'1' 為亮點）。 */
export const BADGE_DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** 徽章尺寸：1 位數 9×9、2 位數 13×9（維持 1px 描邊與 1px 間距）。 */
export function partyBadgeSize(n) {
  const d = String(Math.max(0, Math.min(99, Math.round(Number(n) || 0)))).length;
  return { w: d <= 1 ? 9 : 13, h: 9, digits: d };
}

/**
 * 畫人數徽章（米色底＋1px 深框＋手繪數字＋朝下的 1px 尖角）。
 * x = 水平中心，y = 徽章底緣（尖角尖端）。回傳 {x,y,w,h}（左上角）。
 */
export function drawPartyBadge(ctx, n, x, y, opts = {}) {
  if (!ctx) return null;
  const count = Math.max(0, Math.min(99, Math.round(Number(n) || 0)));
  const sz = partyBadgeSize(count);
  const box = sz.w;
  const key = `pb|${count}`;
  const cv = cachedSprite(key, box, 12, (c) => {
    const g = mkPainter(c, box, false);
    // 尖角（朝下）
    g.r(3, 9, 3, 1, 'furn_outline');
    g.r(4, 10, 1, 1, 'furn_outline');
    g.p(4, 9, 'cloth_cream');
    // 米色底 + 1px 深框
    g.r(0, 0, box, 9, 'furn_outline');
    g.r(1, 1, box - 2, 7, 'cloth_cream');
    g.r(1, 1, box - 2, 1, 'cloth_white');
    g.r(1, 7, box - 2, 1, 'cloth_hem');
    // 手繪數字
    const s = String(count);
    for (let i = 0; i < s.length; i++) {
      const rows = BADGE_DIGITS[s.charCodeAt(i) - 48] || BADGE_DIGITS[0];
      g.stamp(2 + i * 4, 2, rows, { 1: 'top_dark' });
    }
  });
  const dx = Math.round(x - box / 2);
  const dy = Math.round(y - 11);
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, box, 12, dx, dy, () => {
    const g = mkPainter(ctx, box, false);
    g.r(0, 0, box, 9, 'furn_outline');
    g.r(1, 1, box - 2, 7, 'cloth_cream');
  });
  if (opts.out) {
    const o = opts.out;
    o.x = dx;
    o.y = dy;
    o.w = box;
    o.h = 12;
  }
  return { x: dx, y: dy, w: box, h: 12 };
}

// ===========================================================================
// 4. 地板／牆面／門／出餐口
// ===========================================================================

export const TILE_KEYS = ['floor', 'wall', 'door', 'kitchen', 'pass', 'restroom', 'void'];

const FLOOR_TONES = ['wood', 'wood_md', 'wood', 'wood_hi'];
const FLOOR_SEAM = ['wood_lo', 'wood_sh', 'wood_lo', 'wood_md'];

/**
 * 地板／牆面配色（可由地點 palette 覆寫）。
 * locations[].palette = {sky, wall, floor, accent} → 推導出整套 16-bit 色階，
 * 讓每個地點的地板與牆面明顯不同色，但仍然是硬邊、受限色數。
 */
export const DEFAULT_TILE_PAL = Object.freeze({
  key: 'def',
  floor: 'wood',
  floorHi: 'wood_hi',
  floorLo: 'wood_lo',
  floorDk: 'wood_md',
  floorSeam: 'wood_sh',
  wallHi: 'wall_hi',
  wall: 'wall',
  wallLo: 'wall_md',
  wallSh: 'wall_sh',
  trim: 'wood_md',
  trimHi: 'wood_hi',
  trimDark: 'wood_sh',
  accent: 'red',
  accentHi: 'red_hi',
  accentLo: 'red_md',
  tones: ['wood_md', 'wood_sh', 'wood_lo', 'wood_md'],
  seams: ['wood_lo', 'wood_sh', 'wood_lo', 'wood_md'],
});

const TILE_PAL_CACHE = new Map();

/**
 * 由地點 palette 推導地板／牆面色階（同名 key 會快取）。
 * @param {{sky?:string, wall?:string, floor?:string, accent?:string}} spec
 * @param {string} key 快取鍵（通常用 locationId）
 */
export function makeTilePalette(spec, key) {
  if (!spec || typeof spec !== 'object') return DEFAULT_TILE_PAL;
  const fl = typeof spec.floor === 'string' ? spec.floor : PALETTE.wood;
  const wl = typeof spec.wall === 'string' ? spec.wall : PALETTE.wall;
  const ac = typeof spec.accent === 'string' ? spec.accent : PALETTE.red;
  const k = String(key || `p:${fl}:${wl}:${ac}`);
  const hit = TILE_PAL_CACHE.get(k);
  if (hit) return hit;
  const fHi = mixHex(fl, '#ffffff', 0.22);
  const fDk = mixHex(fl, '#000000', 0.26);
  const seam = mixHex(fl, '#140d06', 0.46);
  const pal = {
    key: k,
    floor: fl,
    floorHi: fHi,
    floorLo: mixHex(fl, '#3b2510', 0.44),
    floorDk: fDk,
    floorSeam: seam,
    // 地板邊緣：基色暗 20%（1px 實色暗邊，不用網點）
    floorEdge: mixHex(fl, '#000000', 0.20),
    // 牆面：頂面（受光）基色 +12%、側面基色、右側（背光）基色 −18%、
    //       磚縫 1px 基色 −25%；全部是實色平塗
    wallHi: mixHex(wl, '#ffffff', 0.12),
    wall: wl,
    wallLo: mixHex(wl, '#000000', 0.18),
    wallSh: mixHex(wl, '#000000', 0.44),
    wallSeam: mixHex(wl, '#000000', 0.25),
    trim: mixHex(fl, '#000000', 0.34),
    trimHi: mixHex(fl, '#ffffff', 0.12),
    trimDark: mixHex(fl, '#000000', 0.56),
    accent: ac,
    accentHi: mixHex(ac, '#ffffff', 0.38),
    accentLo: mixHex(ac, '#000000', 0.32),
    // 地板基色：4 個變體都維持在「暗但不到黑」的區間（單格不會整片低於暗色門檻），
    // 這樣髒污連動的對比才能拉開（dirt 0 的暗色像素只來自木板接縫）
    tones: [mixHex(fl, '#000000', 0.20), mixHex(fl, '#000000', 0.32), mixHex(fl, '#000000', 0.26), mixHex(fl, '#000000', 0.14)],
    seams: [seam, mixHex(fl, '#000000', 0.62), seam, mixHex(fl, '#000000', 0.40)],
  };
  if (TILE_PAL_CACHE.size > 32) TILE_PAL_CACHE.clear();
  TILE_PAL_CACHE.set(k, pal);
  return pal;
}

/** 取得調色盤快取鍵（未提供 → 'def'）。 */
export function tilePaletteKey(pal) {
  return pal && pal.key ? pal.key : 'def';
}

// ── tile／牆面幾何：全部由 TILE_W / TILE_H 推導（改變 tile 尺寸不需改公式）──
const TCX = TILE_W / 2; // 21
const THH = TILE_H / 2; // 10.5
const WALL_CW = TILE_W + 6; // 48（左右各留 3px 給描邊）
const WCX = WALL_CW / 2; // 24
const WALL_XL = WCX - TILE_W / 2; // 3  頂面西頂點
const WALL_XR = WCX + TILE_W / 2; // 45 頂面東頂點

/** 2px 寬的等角實線（兩條相鄰 1px 線）；玩家反映細網點太雜 → 木紋一律用實線。 */
function isoLine2(g, x0, y0, x1, y1, col) {
  g.line(x0, y0, x1, y1, col);
  g.line(x0, y0 + 1, x1, y1 + 1, col);
}

function paintFloorTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  const pal = o.pal || DEFAULT_TILE_PAL;
  const v = ((o.variant | 0) % 8 + 8) % 8;
  const base = o.edge ? pal.tones[1] : pal.tones[v % 4];
  const seam = pal.seams[v % 4];
  const brush = shade(base, 'white', 0.14); // 淡色刷痕
  const grainDark = shade(base, 'black', 0.16);
  // noBase：地板已經由 floor.js 貼上和柄（pattern）→ 這一格只補接縫／髒污／明暗
  const noBase = !!o.noBase;
  if (!noBase) {
    g.dia(cx, 0, W - 2, H - 2, base);
    // 木板接縫（依變體換方向：橫向 / 縱向 / 斜向拼法）— 改成 2px 實線
    const grain = v % 4;
    const us = grain === 0 ? [0.45] : grain === 1 ? [0.28, 0.62] : grain === 2 ? [0.2, 0.5, 0.8] : [0.35];
    for (let i = 0; i < us.length; i++) {
      const t = us[i];
      if (grain === 3) g.thick(cx - g.u(9) + g.u(4) * i, g.u(2) + g.u(3) * i, cx + g.u(9) - g.u(4) * i, H - g.u(3) - g.u(3) * i, seam);
      else g.thick(cx - TILE_W / 2 * t, THH * t, W - TILE_W / 2 * t, THH + THH * t, seam);
    }
    // 木紋：2px 實色板條 + 2px 淡色刷痕（全部粗筆觸，不留 1px 細線把色塊切碎）
    g.thick(cx - g.u(7), g.u(2), cx - g.u(7), g.u(6), grainDark);
    g.thick(cx + g.u(6), g.u(8), cx + g.u(6), g.u(12), grainDark);
    g.thick(cx - g.u(4), g.u(4), cx - g.u(4), g.u(7), brush);
    // 磨損與刮痕（固定變體，不隨時間變）：實色短痕
    if (v >= 4) {
      g.thick(cx - g.u(5), g.u(9), cx + g.u(1), g.u(6), brush);
    }
  }
  // 收邊／踢腳帶（房間最外圈地板，比室內深一階）：實色 2px 帶
  if (o.edge) {
    g.line(1, THH, cx, H, pal.trimDark);
    g.line(2, THH, cx, H - 1, pal.trimDark);
    g.line(cx, H, W - 1, THH, pal.trimDark);
    g.line(cx, H - 1, W - 2, THH, pal.trimDark);
  }
  // 污漬（dirt 0..3 桶）：實色污塊 + 大顆粒塊狀污斑（不用細網點）
  const dirt = Math.max(0, Math.min(3, o.dirt | 0));
  if (dirt > 0) {
    const stain = mixHex(base, '#2a1c0e', 0.6);
    const stainLo = shade(stain, 'black', 0.3);
    // 大面積污斑：只鋪在自己的菱形內（不會溢出到隔壁格），越髒越接近整格污損
    if (dirt === 2) g.diaMask(cx, 0, W - 4, H - 4, stain, DITHER.block25);
    if (dirt >= 3) {
      g.dia(cx, 0, W - 4, H - 4, stain);
      g.diaMask(cx, 1, W - 8, H - 8, stainLo, DITHER.block25);
    }
    const count = dirt === 1 ? 4 : dirt === 2 ? 10 : 20;
    for (let i = 0; i < count; i++) {
      const px = cx - g.u(11) + ((v * 7 + i * 5) % g.u(22));
      const py = g.u(1) + ((v * 5 + i * 3) % g.u(15));
      const w2 = g.u(4) + (i % 3); // 5–7px 寬的污塊
      g.r(px, py, w2, g.u(2) + (i % 2) + 1, stain);
      if (dirt >= 2 && i % 2 === 0) g.r(px + 1, py + g.u(2), w2 - 1, g.u(1), stainLo);
    }
    // 鞋印（成對，實色）
    for (let i = 0; i < dirt + 1; i++) {
      const fx = cx - g.u(8) + i * g.u(6);
      const fy = g.u(6) + i * g.u(3);
      g.r(fx, fy, g.u(2), g.u(3), stain);
      g.r(fx + g.u(4), fy + g.u(2), g.u(2), g.u(3), stain);
      g.r(fx, fy, g.u(2), 1, 'wood_dark');
    }
  }
  // 鎢絲燈由上而下的明暗：上下各一道 2px 實色帶（不用網點，也不用 1px 細線）
  g.r(4, H - 6, W - 8, 2, shade(base, 'black', 0.12));
  g.r(6, 2, W - 12, 2, shade(base, 'white', 0.1));
  // 邊界描邊（2px 實色暗邊：基色暗 20%）——用 2px 才不會留下 1px 孤立尖角
  const edgeCol = pal.floorEdge || seam;
  g.thick(1, THH - 1, cx, H - 2, edgeCol);
  g.thick(cx, H - 2, W - 2, THH - 1, edgeCol);
  g.thick(1, THH, cx, 1, edgeCol);
  g.thick(cx, 1, W - 2, THH, edgeCol);
  g.r(cx - 1, 0, 2, 2, edgeCol);
  g.r(cx - 1, H - 2, 2, 2, edgeCol);
}

function paintKitchenTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  const blk = g.u(4);
  const patA = o.variant & 1 ? 'tile_k_hi' : 'tile_k_lo';
  g.dia(cx, 0, W - 2, H - 2, 'tile_k');
  // 棋盤只鋪中央矩形（用菱形鋪滿會被裁出 1px 碎片 = 雜點）
  const bw2 = Math.round(W * 0.28);
  const bh2 = Math.round(H * 0.28);
  for (let yy = -bh2; yy < bh2; yy += blk) {
    for (let xx = -bw2; xx < bw2; xx += blk) {
      if ((((xx / blk) | 0) + ((yy / blk) | 0)) & 1) continue;
      g.r(cx + xx, THH + yy, blk, blk, patA);
    }
  }
  // 排水孔 / 不鏽鋼格柵
  if (o.variant === 2) {
    g.dia(cx, THH - g.u(2), g.u(6), g.u(4), 'metal_sh');
    g.r(cx - g.u(3), THH - g.u(2), g.u(7), 2, 'metal_lo');
    for (let i = 0; i < 3; i++) g.r(cx - g.u(2) + i * g.u(2), THH - g.u(1), 1, g.u(3), 'metal_hi');
  }
  g.thick(1, THH - 1, cx, H - 2, 'metal_sh');
  g.thick(cx, H - 2, W - 2, THH - 1, 'metal_sh');
  g.thick(1, THH, cx, 1, 'metal_lo');
  g.thick(cx, 1, W - 2, THH, 'metal_lo');
  g.r(cx - 1, 0, 2, 2, 'metal_sh');
  g.r(cx - 1, H - 2, 2, 2, 'metal_sh');
}

function paintRestroomTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  const v = ((o.variant | 0) % 4 + 4) % 4;
  g.diaChecker(cx, 0, W - 2, H - 2, 'tile', 'tile_hi', g.u(4));
  // 地磚縫（十字縫）
  g.thick(1, THH - 1, cx, H - 2, 'tile_md');
  g.thick(cx, H - 2, W - 2, THH - 1, 'tile_md');
  g.thick(1, THH, cx, 1, 'tile_lo');
  g.thick(cx, 1, W - 2, THH, 'tile_lo');
  g.r(cx - 1, 0, 2, 2, 'tile_md');
  g.r(cx - 1, H - 2, 2, 2, 'tile_md');
  g.r(cx - g.u(5), g.u(3), 2, Math.max(2, H - g.u(6)), 'tile_md');
  g.r(cx + g.u(5), g.u(3), 2, Math.max(2, H - g.u(6)), 'tile_md');
  g.r(cx - g.u(8), THH, g.u(16), 2, 'tile_md');
  // 排水孔（每 4 格一個）
  if (v === 1) {
    g.dia(cx, THH - g.u(2), g.u(6), g.u(4), 'metal_sh');
    g.r(cx - g.u(3), THH - g.u(2), g.u(6), 2, 'metal_lo');
    for (let i = 0; i < 3; i++) g.r(cx - g.u(2) + i * g.u(2), THH - g.u(1), 1, g.u(3), 'metal_hi');
  }
  if (v === 2) {
    g.dia(cx, THH - g.u(2), g.u(7), g.u(4), 'tile_lo');
    g.r(cx - g.u(3), THH - g.u(2), g.u(7), 2, 'metal_lo');
  }
  // 廁所污漬（dirt 0..3 桶）：實色污塊
  const dirt = Math.max(0, Math.min(3, o.dirt | 0));
  if (dirt > 0) {
    const stain = mixHex('#a8c2c8', '#5a4a28', 0.6);
    for (let i = 0; i < dirt * 2; i++) {
      const px = cx - g.u(8) + ((v * 5 + i * 7) % g.u(16));
      const py = g.u(3) + ((v * 3 + i * 5) % g.u(13));
      g.r(px, py, g.u(3) + (i & 1), g.u(2), stain);
    }
  }
  g.dith(2, H - 5, W - 4, 2, 'tile_lo', 'clear', DITHER.block12);
  g.line(1, THH, cx, H, 'tile_lo');
  g.line(cx, H, W - 1, THH, 'tile_lo');
  g.line(1, THH, cx, 0, 'tile_md');
  g.line(cx, 0, W - 1, THH, 'tile_md');
}

// 牆面 canvas 尺寸：頂面 42×21 + 牆高 + 留白
function wallCanvasH(h) {
  return TILE_H + h + 6;
}

/**
 * 在牆面上挖一扇窗（face: 'L' 左斜頂面（+y 向）／'R' 右斜面（+x 向））。
 * frost=true 時在窗角結霜（寒流）。窗台寬度、窗框、霓虹都隨 tile 尺寸放大。
 */
function wallWindow(g, face, h, tod, glow, pal, frost, frame) {
  const P = pal || DEFAULT_TILE_PAL;
  const ww = g.u(7);
  const wh = g.u(9);
  const y0 = g.u(6);
  const neonOn = !(frame % 4 === 3); // 霓虹 3 亮 1 暗
  const x0 = face === 'L' ? WALL_XL + g.u(4) : WALL_XR - g.u(4) - ww;
  // 窗框
  g.r(x0 - 1, y0, ww + 2, wh + 2, 'wood_dark');
  g.r(x0, y0 + 1, ww, wh, 'window_dk');
  g.r(x0, y0 + 1, ww, g.u(4), tod === 'night' ? 'sky_night' : (tod === 'evening' ? 'dusk_org' : 'sky_md'));
  // 窗內小夜景
  const lit = glow ? 'lamp_hi' : 'lamp_md';
  g.r(x0 + 1, y0 + g.u(5), g.u(2), g.u(2), lit);
  g.r(x0 + ww - g.u(3), y0 + g.u(6), g.u(2), g.u(2), lit);
  if (neonOn) {
    g.r(x0 + g.u(4), y0 + g.u(6), 1, g.u(3), P.accent);
    g.r(x0 + g.u(5), y0 + g.u(2), 1, 1, P.accentHi);
  }
  // 窗格
  g.line(x0 + (ww >> 1), y0 + 1, x0 + (ww >> 1), y0 + wh, 'wood_dark');
  g.line(x0, y0 + wh >> 1, x0 + ww, y0 + (wh >> 1), 'wood_dark');
  // 窗台
  g.r(x0 - 1, y0 + wh + 1, ww + 2, 1, P.trimHi);
  // 寒流：窗角結霜
  if (frost) {
    g.dith(x0, y0 + 1, g.u(3), g.u(3), 'white', 'clear', DITHER.block50);
    g.dith(x0 + ww - g.u(3), y0 + wh - g.u(3), g.u(3), g.u(3), 'tile_hi', 'clear', DITHER.block25);
    g.r(x0 + 1, y0 + wh - 1, 2, 1, 'white');
  }
}

/** 牆體主繪製：頂面 + 兩個可見側面（+y 面＝左、+x 面＝右）。 */
function paintWallBody(g, h, opts) {
  const P = opts.pal || DEFAULT_TILE_PAL;
  const cx = WCX;
  const top = opts.top || P.wallHi;
  const left = opts.left || P.wall;
  const right = opts.right || P.wallLo;
  const yMid = THH;
  const yBot = TILE_H;
  // noBase：壁も floor.js が和柄（pattern）を貼る → 側面の平塗りと磚縫は描かない
  const noBase = !!opts.noBase;
  // 側面：扎實純色平塗（左面 = 基色、右面 = 基色 −18%），完全不用網點
  if (!noBase) {
    g.poly([[WALL_XL, yMid], [cx, yBot], [cx, yBot + h], [WALL_XL, yMid + h]], left);
    g.poly([[cx, yBot], [WALL_XR, yMid], [WALL_XR, yMid + h], [cx, yBot + h]], right);
    // 磚縫：1px 實色暗線（基色 −25%），沿等角方向切兩段
    const seamCol = P.wallSeam || shade(left, 'black', 0.25);
    const seamA = [WALL_XL, yMid + Math.round(h * 0.42)];
    const seamB = [cx, yBot + Math.round(h * 0.42)];
    const seamC = [WALL_XR, yMid + Math.round(h * 0.42)];
    g.thick(seamA[0], seamA[1], seamB[0], seamB[1], seamCol);
    g.thick(seamB[0], seamB[1], seamC[0], seamC[1], seamCol);
    const seamD = [WALL_XL, yMid + Math.round(h * 0.78)];
    const seamE = [cx, yBot + Math.round(h * 0.78)];
    const seamF = [WALL_XR, yMid + Math.round(h * 0.78)];
    if (seamD[1] < yMid + h - 3) g.thick(seamD[0], seamD[1], seamE[0], seamE[1], seamCol);
    if (seamE[1] < yBot + h - 3) g.thick(seamE[0], seamE[1], seamF[0], seamF[1], seamCol);
  }
  // 踢腳／護牆板（跟著地板色走）
  const wain = Math.min(g.u(7), Math.max(g.u(3), Math.round(h * 0.34)));
  g.poly([[WALL_XL, yMid + h - wain], [cx, yBot + h - wain], [cx, yBot + h], [WALL_XL, yMid + h]], P.trim);
  g.poly([[cx, yBot + h - wain], [WALL_XR, yMid + h - wain], [WALL_XR, yMid + h], [cx, yBot + h]], P.trimDark);
  // 斜邊的 1px 階梯用同色補掉（避免出現孤立點）
  for (let i = 0; i <= TILE_W; i += 2) {
    const t = i / TILE_W;
    const y1 = Math.round(yMid + h - wain + (yBot - yMid) * t);
    const y2 = Math.round(yMid + h - wain + (yBot - yMid) * (1 - t));
    g.r(Math.round(WALL_XL + (cx - WALL_XL) * t), y1 - 1, 3, 2, P.trim);
    g.r(Math.round(cx + (WALL_XR - cx) * t), y2 + 1, 3, 2, P.trimDark);
  }
  // 護牆板壓條：2px 實色（避免 1px 細線把實色塊切碎）
  for (let i = 0; i < 3; i++) {
    const x = WALL_XL + g.u(4) + i * g.u(7);
    g.r(x, yMid + h - wain + 1, 2, Math.max(1, yBot + h - 1 - (yMid + h - wain + 1)), P.trimDark);
  }
  g.thick(WALL_XL, yBot + h - wain, cx, yBot + h - wain, P.trimDark);
  g.thick(cx, yBot + h - wain, WALL_XR, yMid + h - wain, 'wood_dark');
  // 明暗：實色帶（上緣受光 = 基色 +12%、下緣壓暗 = 基色 −18%），不用網點
  g.thick(WALL_XL + 2, yMid + 3, cx, yBot + 3, shade(left, 'white', 0.12));
  g.thick(cx + 2, yBot + 2, WALL_XR - 3, yMid + 2, P.wallLo);
  // 垂直刷痕：每 4–6 格一道（由 seed 決定），2px 實色；其餘牆面保持乾淨純色
  const sd = ((opts.seed | 0) % 6 + 6) % 6;
  if (sd === 0 || sd === 3) {
    const bx = WALL_XL + 3 + (sd === 0 ? g.u(4) : g.u(11));
    g.r(bx, yMid + g.u(3), 2, Math.max(1, yBot + h - wain - (yMid + g.u(3))), shade(left, 'black', 0.12));
  } else if (sd === 1) {
    g.r(cx + g.u(6), yMid + g.u(4), 2, Math.max(1, yBot + h - wain - (yMid + g.u(4))), shade(right, 'black', 0.14));
  }
  // 頂面：整塊實色菱形（外框 2px 粗線畫在上面，不留 1px 縫）
  g.dia(cx, 0, TILE_W - 2, TILE_H - 2, top);
  g.r(WALL_XL + 4, 3, TILE_W - 10, 1, shade(top, 'white', 0.14));
  g.r(WALL_XL + 4, TILE_H - 6, TILE_W - 10, 1, P.wallSh);
  // 描邊：頂面用兩圈實色菱形（2px，無縫隙），側面用 2px 粗線
  g.thick(WALL_XL, THH - 1, cx, 0, 'outline');
  g.thick(cx, 0, WALL_XR - 1, THH - 1, 'outline');
  g.thick(WALL_XL, THH, cx, 1, 'outline');
  g.thick(cx, 1, WALL_XR - 1, THH, 'outline');
  g.r(cx - 1, 0, 2, 2, 'outline');
  g.thick(WALL_XL, yMid, cx, yBot, 'outline');
  g.thick(cx, yBot, WALL_XR, yMid, 'outline');
  g.thick(WALL_XL, yMid + h - 1, cx, yBot + h - 1, 'outline');
  g.thick(cx, yBot + h - 1, WALL_XR, yMid + h - 1, 'outline');
  g.thick(WALL_XL, yMid, WALL_XL, yMid + h - 1, 'outline');
  g.thick(WALL_XR - 1, yMid, WALL_XR - 1, yMid + h - 1, 'outline');
  g.thick(WALL_XL, yMid - 1, cx, 0, 'outline');
  g.thick(cx, 0, WALL_XR - 1, yMid - 1, 'outline');
  // 壁燈（有開燈時牆面上一點暖光）：實色小方塊
  if (opts.glow) {
    g.r(WALL_XL + 3, yMid + g.u(4), g.u(3), g.u(2), 'lamp');
  }
  // 窗
  if (opts.window) {
    if (opts.face === 'L') wallWindow(g, 'L', h, opts.tod, opts.glow, P, opts.frost, opts.frame || 0);
    else if (opts.face === 'R') wallWindow(g, 'R', h, opts.tod, opts.glow, P, opts.frost, opts.frame || 0);
    else {
      wallWindow(g, 'L', h, opts.tod, opts.glow, P, opts.frost, opts.frame || 0);
      wallWindow(g, 'R', h, opts.tod, opts.glow, P, opts.frost, opts.frame || 0);
    }
  }
}

function paintWall(c, o) {
  const g = mkPainter(c, WALL_CW, false);
  paintWallBody(g, o.h, {
    window: o.window, face: o.face, tod: o.tod, glow: o.glow, frost: o.frost, frame: o.frame,
    top: o.top, left: o.left, right: o.right, pal: o.pal, seed: o.seed, noBase: o.noBase,
  });
}

function paintDoor(c, o) {
  const g = mkPainter(c, WALL_CW, false);
  const P = o.pal || DEFAULT_TILE_PAL;
  const h = o.h;
  const lanternCol = mixHex(P.accent, '#ff8a3c', 0.55);
  const lanternHi = mixHex(P.accentHi, '#ffc06a', 0.5);
  const postW = g.u(3);
  // 門檻地板 + 暖光外洩
  g.dia(WCX, 0, TILE_W - 2, TILE_H - 2, P.trim);
  g.dith(WALL_XL + 2, 3, TILE_W - 4, TILE_H - 2, 'lamp', 'clear', DITHER.block25);
  // 門柱
  const post = (x0) => {
    g.poly([[x0, THH], [x0 + postW, THH + postW / 2], [x0 + postW, THH + postW / 2 + h], [x0, THH + h]], P.wall);
    g.poly([[x0 + postW, THH + postW / 2], [x0 + postW + 2, THH + postW / 2], [x0 + postW + 2, THH + postW / 2 + h], [x0 + postW, THH + postW / 2 + h]], P.wallLo);
    g.line(x0, THH, x0, THH + h, 'outline');
    g.line(x0 + postW + 2, THH + postW / 2, x0 + postW + 2, THH + postW / 2 + h, 'outline');
  };
  post(2);
  post(WALL_XR - 2 - postW - 2);
  // 門楣（地點強調色）+ 招牌
  g.r(2, 1, TILE_W + 2, g.u(3), P.accentLo);
  g.r(2, 1, TILE_W + 2, 1, P.accent);
  g.r(4, g.u(4), TILE_W - 2, 1, 'outline');
  g.dith(4, 2, TILE_W - 2, 2, P.accentHi, 'clear', DITHER.block12);
  for (let i = 0; i < 5; i++) g.r(6 + i * 7, 2, 5, 2, P.accent);
  // 「歡迎光臨」小燈籠
  const lx = WCX - g.u(4);
  g.r(lx, g.u(5), g.u(8), 1, 'outline');
  g.r(lx, g.u(6), g.u(8), g.u(6), lanternCol);
  g.r(lx + 1, g.u(6), g.u(6), g.u(6), lanternHi);
  g.r(lx, g.u(12), g.u(8), 1, 'lantern_lo');
  g.dith(lx - 2, g.u(14), g.u(12), g.u(4), 'lamp', 'clear', DITHER.block25);
}

function paintPass(c, o) {
  const g = mkPainter(c, WALL_CW, false);
  const P = o.pal || DEFAULT_TILE_PAL;
  const h = Math.max(g.u(8), Math.min(o.h, g.u(16))); // 檯面高度
  paintWallBody(g, h, { window: false, top: 'metal_hi', left: 'metal', right: 'metal_md', pal: P });
  // 出餐口開口：暖光 + 不鏽鋼托盤
  const openY = 2;
  const oy2 = THH + g.u(4);
  g.poly([[WALL_XL + 2, THH], [WCX, TILE_H], [WALL_XR - 2, THH], [WALL_XR - 2, openY], [WCX, openY + oy2 * 0.25], [WALL_XL + 2, openY]], 'outline');
  g.poly([[WALL_XL + 3, THH], [WCX, TILE_H - 0.5], [WALL_XR - 3, THH], [WALL_XR - 3, openY + 1], [WCX, openY + oy2 * 0.25 + 1], [WALL_XL + 3, openY + 1]], 'lamp_lo');
  g.dith(WALL_XL + 4, openY + 1, TILE_W - 2, Math.round(oy2 * 1.4), 'lamp', 'lamp_lo', DITHER.block50);
  g.dith(WALL_XL + 6, openY + 2, TILE_W - 8, oy2, 'lamp_hi', 'lamp', DITHER.block12);
  // 熱氣
  for (let i = 0; i < 3; i++) {
    const x = WALL_XL + g.u(5) + i * g.u(5);
    g.dith(x, openY + 1 + (o.frame & 1), 2, g.u(5) - (i & 1) * 2, 'lamp_hi', 'clear', DITHER.block12);
  }
  // 檯面 + 地點強調色標牌
  const shelfY = TILE_H - g.u(4);
  g.dia(WCX, shelfY, TILE_W - 4, TILE_H - 4, 'metal_hi');
  g.line(WALL_XL + 1, THH, WCX, TILE_H, 'metal_sh');
  g.line(WCX, TILE_H, WALL_XR - 1, THH, 'metal_sh');
  g.line(WALL_XL + 1, THH, WCX, 0, 'outline');
  g.line(WCX, 0, WALL_XR - 1, THH, 'outline');
  g.r(WALL_XL + g.u(3), shelfY + 1, g.u(6), 1, 'wood_hi'); // 托盤
  g.r(WALL_XL + g.u(4), shelfY, g.u(4), 1, 'wood');
  g.r(WCX + 1, shelfY + 1, g.u(7), 1, 'tile_hi');
  g.r(WCX + 2, shelfY, g.u(5), 1, 'tile');
  g.r(WCX + g.u(1), openY + 2, g.u(6), 1, P.accent);
  g.r(WCX + g.u(2), openY + 1, g.u(4), 1, P.accentHi);
  // 「出餐口」吊牌
  g.r(WCX - g.u(5), openY + 1, g.u(10), 1, 'gray_15');
  g.r(WCX - g.u(4), openY, g.u(8), 1, P.accentHi);
}

/**
 * 畫一個等角 tile。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} tile 'floor'|'wall'|'door'|'kitchen'|'pass'|'restroom'|'void'
 * @param {number} sx 菱形中心 x
 * @param {number} sy 菱形中心 y
 * @param {object} [opts] {variant, wallH, face:'L'|'R'|'both'|'none', window, tod, glow, frame}
 */
export function drawTile(ctx, tile, sx, sy, opts = {}) {
  if (!ctx) return null;
  const o = opts || {};
  const kind = TILE_KEYS.indexOf(tile) >= 0 ? tile : 'void';
  if (kind === 'void') return null;
  const variant = ((o.variant | 0) % 4 + 4) % 4;
  const frame = o.frame ? (o.frame & 1) : 0;
  const isWallLike = kind === 'wall' || kind === 'door' || kind === 'pass';
  const h = Math.max(6, Math.round(o.wallH == null ? WALL_H : o.wallH));
  const pal = o.pal || DEFAULT_TILE_PAL;
  const pk = tilePaletteKey(pal);

  if (!isWallLike) {
    const dirtB = Math.max(0, Math.min(3, o.dirt | 0));
    const edge = o.edge ? 1 : 0;
    const nb = o.noBase && kind === 'floor' ? 1 : 0;
    const key = `t|${kind}|${variant}|${frame}|${kind === 'floor' ? pk : 'def'}|d${kind === 'floor' || kind === 'restroom' ? dirtB : 0}|e${kind === 'floor' ? edge : 0}|nb${nb}`;
    const paint = (c) => {
      if (kind === 'kitchen') paintKitchenTile(c, { variant });
      else if (kind === 'restroom') paintRestroomTile(c, { variant, dirt: dirtB });
      else paintFloorTile(c, { variant, pal, dirt: dirtB, edge, noBase: !!nb });
    };
    const cv = cachedSprite(key, TILE_W, TILE_H, paint);
    const dx = Math.round(sx - TILE_W / 2);
    const dy = Math.round(sy - TILE_H / 2);
    if (cv) ctx.drawImage(cv, dx, dy);
    else drawUncached(ctx, TILE_W, TILE_H, dx, dy, paint);
    const out = o.out || TILE_BOX;
    out.x = dx;
    out.y = dy;
    out.w = TILE_W;
    out.h = TILE_H;
    return out;
  }

  const H = wallCanvasH(h);
  const face = o.face || 'both';
  // 只有會動的牆類（門／出餐口／霓虹窗）才把影格放進快取鍵，純牆面不做無謂重繪
  const kframe = kind === 'wall' ? (o.window ? (frame & 3) : 0) : (frame & 1);
  // 牆面刷痕用 seed 決定（每 4–6 格一道），因此 seed 也要進快取鍵
  const seed = kind === 'wall' ? (((o.seed | 0) % 6) + 6) % 6 : 0;
  const key = `w|${kind}|${h}|${variant}|${face}|${o.window ? 1 : 0}|${o.tod || 'night'}|${kframe}|${o.frost ? 1 : 0}|${pk}|s${seed}|nb${o.noBase && kind === 'wall' ? 1 : 0}`;
  const paint = (c) => {
    if (kind === 'wall') paintWall(c, { h, variant, face, window: o.window, tod: o.tod, glow: o.glow, pal, frost: o.frost, frame: o.frame, seed, noBase: o.noBase });
    else if (kind === 'door') paintDoor(c, { h, variant, frame, pal });
    else paintPass(c, { h, variant, frame, pal });
  };
  const cv = cachedSprite(key, WALL_CW, H, paint);
  const dx = Math.round(sx - WALL_CW / 2);
  const dy = Math.round(sy - (THH + h));
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, WALL_CW, H, dx, dy, paint);
  const out = o.out || TILE_BOX;
  out.x = dx;
  out.y = dy;
  out.w = WALL_CW;
  out.h = H;
  return out;
}
const TILE_BOX = { x: 0, y: 0, w: TILE_W, h: TILE_H };

/** 只畫牆（給 floor.js 的牆面 pass 使用）。 */
export function drawWall(ctx, sx, sy, height, opts = {}) {
  return drawTile(ctx, (opts && opts.kind) || 'wall', sx, sy, Object.assign({}, opts, { wallH: height }));
}

// ===========================================================================
// 5. 傢俱（依 typeId 程序化繪製，未知 id 有後備形狀）
// ===========================================================================

function clampDim(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > 4 ? 4 : n;
}

function artGeo(w, h, hgt, mount, pad) {
  const H0 = Number.isFinite(hgt) ? hgt : 24;
  const bw = (w + h) * HALF_W;
  const bh = (w + h) * HALF_H;
  const p = Math.max(0, Math.round(pad || 0));
  const W = Math.round(bw) + 8 + p * 2;
  const H = Math.round(bh) + Math.round(H0) + Math.round(mount || 0) + 8 + p * 2;
  return {
    W, H, cx: W / 2, gy: H - 4 - p - bh / 2, bw, bh, hgt: H0, mount, w, h,
  };
}

function rotToDir(rot) {
  if (typeof rot === 'string') return normDir(rot);
  return ['S', 'E', 'N', 'W'][(((rot | 0) % 4) + 4) % 4];
}

/**
 * 硬邊網點投影：兩層（外圈淡、內圈深）並向下偏 1–2px，
 * 讓桌椅從木地板上「浮」起來，但完全不使用漸層或柔邊。
 */
function baseShadow(g, geo, scale = 1) {
  if (g.shadows === false) return; // view.fx.shadows === false → 完全不畫
  const w = geo.bw * scale;
  const h = geo.bh * scale;
  g.diaMask(geo.cx, geo.gy - h / 2 + g.u(2), w + g.u(2), h + g.u(2), 'shadow', DITHER.b25);
  g.diaMask(geo.cx, geo.gy - h / 2 + g.u(1), Math.max(6, w - g.u(4)), Math.max(3, h - g.u(2)), 'shadow', DITHER.b50);
}

function leg(g, x, yTop, yBot, col, ol) {
  const h = Math.round(yBot) - Math.round(yTop);
  if (h <= 0) return;
  const lw = g.u(2);
  g.r(x, yTop, lw, h, col);
  if (ol) g.r(x, yTop, 1, h, ol);
}

/**
 * 桌上菜色：依 dish.category 決定盤型與顏色。
 * staple 大盤／side 小盤／soup 湯碗／drink 杯子／alcohol 酒瓶／dessert 甜點盤。
 */
function paintDish(g, cx, cy, category, seed) {
  const OL = 'furn_outline';
  const cat = typeof category === 'string' ? category : 'side';
  const s = Math.abs(seed | 0) % 3;
  if (cat === 'staple') {
    g.dia(cx, cy - g.u(4), g.u(13), g.u(7), OL);
    g.dia(cx, cy - g.u(3), g.u(11), g.u(5), 'gray_90');
    g.dia(cx, cy - g.u(2), g.u(7), g.u(3), ['shirt_org', 'red_md', 'lamp_md'][s]);
    g.p(cx - 1, cy - g.u(2), 'lamp_hi');
  } else if (cat === 'soup') {
    g.dia(cx, cy - g.u(4), g.u(9), g.u(6), OL);
    g.dia(cx, cy - g.u(3), g.u(7), g.u(4), 'tile_hi');
    g.dith(cx - g.u(3), cy - g.u(3), g.u(6), g.u(3), 'lamp_md', 'clear', DITHER.block25);
  } else if (cat === 'drink') {
    g.r(cx - g.u(2), cy - g.u(7), g.u(4), g.u(7), OL);
    g.r(cx - g.u(2) + 1, cy - g.u(6), Math.max(2, g.u(2)), g.u(5), ['shirt_org', 'teal_hi', 'lamp_md'][s]);
    g.r(cx - g.u(2), cy - g.u(8), g.u(4), 1, 'white');
  } else if (cat === 'alcohol') {
    g.r(cx - g.u(2), cy - g.u(9), g.u(4), g.u(9), OL);
    g.r(cx - g.u(2) + 1, cy - g.u(8), Math.max(2, g.u(2)), g.u(7), 'leaf_lo');
    g.r(cx - 1, cy - g.u(11), g.u(2), g.u(2), 'metal_lo');
    g.r(cx - 1, cy - g.u(5), g.u(2), g.u(3), 'white');
  } else if (cat === 'dessert') {
    g.dia(cx, cy - g.u(3), g.u(9), g.u(5), OL);
    g.dia(cx, cy - g.u(2), g.u(7), g.u(3), 'shirt_pnk');
    g.p(cx, cy - g.u(3), 'white');
  } else {
    g.dia(cx, cy - g.u(4), g.u(8), g.u(4), OL);
    g.dia(cx, cy - g.u(3), g.u(6), g.u(2), 'gray_70');
    g.r(cx - 1, cy - g.u(3), 2, 1, ['leaf_hi', 'lamp_md'][s]);
  }
}

/** 桌布織紋：以「實色條帶」表現（不用網點）——亮度差足以讀出布料，又不會變雜點。 */
function clothWeave(g, cx, cy, rx, ry, topFill) {
  const dark = mixHex(topFill, '#000000', 0.12);
  const light = mixHex(topFill, '#ffffff', 0.22);
  const step = Math.max(4, Math.round(ry / 3));
  for (let dy = -ry + 3; dy <= ry - 3; dy += step) {
    const t = 1 - (dy * dy) / (ry * ry + ry);
    const w = Math.round(rx * Math.sqrt(Math.max(0, t)));
    if (w <= 6) continue;
    g.r(Math.round(cx - w + 3), Math.round(cy + dy), w * 2 - 6, 2, dark);
    g.r(Math.round(cx - w + 4), Math.round(cy + dy + 2), w * 2 - 8, 1, light);
  }
}

/** 轉盤（宴會圓桌）：同心實色環 + 上緣高光 + 下緣暗邊，中心一顆實色旋鈕。 */
function lazySusan(g, cx, cy, r) {
  const OL = 'furn_outline';
  const ry = Math.max(3, Math.round(r * 0.5));
  g.ell(cx, cy, r, ry, OL);
  g.ell(cx, cy, r - 1, ry - 1, 'wood_md');
  g.ell(cx, cy - 1, r - 3, ry - 2, 'wood_hi');
  g.ell(cx, cy - 2, Math.max(3, r - 6), Math.max(2, ry - 3), 'wood');
  // 內圈（放菜的位置）
  g.ell(cx, cy - 2, Math.max(3, Math.round(r * 0.5)), Math.max(2, Math.round(ry * 0.5)), 'wood_md');
  // 高光／暗邊（實色弧線）
  for (let i = -r + 2; i <= r - 2; i++) {
    const t = 1 - (i * i) / ((r - 1) * (r - 1));
    const yy = Math.round(cy - 1 - Math.sqrt(Math.max(0, t)) * (ry - 1));
    if (i > -r + 3 && i < r - 3) g.p(Math.round(cx + i), yy, 'wood_hi');
  }
  g.r(cx - 1, cy - ry + 1, 3, 2, 'wood_sh');
  g.r(cx - 1, cy - 2, 3, 3, 'metal_md');
  g.p(cx - 1, cy - 2, 'metal_hi');
}

/** 一副餐具（實色）：盤子（1px 外框＋內圈）＋筷子或刀叉＋杯子＋紙巾。 */
function tableSetting(g, cx, cy, side, plateHi, darkTable) {
  const OL = 'furn_outline';
  const pw = g.u(6);
  const ph = g.u(3);
  // 紙巾
  g.r(cx - g.u(6), cy - g.u(2), g.u(4), g.u(2), darkTable ? 'wood_sh' : 'cloth_hem');
  g.r(cx - g.u(6), cy - g.u(2), g.u(4), 1, darkTable ? 'wood_lo' : 'cloth_cream');
  // 盤子：外框 1px + 盤面 + 內圈
  g.dia(cx, cy - ph, pw, ph, OL);
  g.dia(cx, cy - ph + 1, pw - 2, ph - 2, plateHi);
  g.dia(cx, cy - ph + 2, Math.max(3, pw - 6), Math.max(2, ph - 4), darkTable ? 'gray_30' : 'gray_70');
  // 筷子／刀叉（依座位方向擺在盤子旁）
  const chop = side === 'W' || side === 'E';
  if (chop) {
    g.r(cx - g.u(1), cy - g.u(1), g.u(8), 1, 'wood_dark');
    g.r(cx - g.u(1), cy, g.u(8), 1, 'wood_sh');
  } else {
    g.r(cx + g.u(5), cy - g.u(3), 1, g.u(5), 'gray_70');
    g.r(cx + g.u(6), cy - g.u(2), 1, g.u(3), 'gray_70');
  }
  // 杯子（深色木面桌不放亮杯：會把「深色桌面」的暗度吃掉，只留盤＋筷子＋紙巾）
  if (!darkTable) {
    g.r(cx + g.u(3), cy - g.u(6), g.u(3), g.u(4), OL);
    g.r(cx + g.u(3) + 1, cy - g.u(5), Math.max(1, g.u(3) - 2), g.u(3), 'gray_50');
    g.r(cx + g.u(3) + 1, cy - g.u(6), Math.max(1, g.u(3) - 2), 1, 'gray_90');
  }
}

/** 桌面：米白桌布（亮）或深色木桌（暗）二選一，一律帶 2px 深色外框與實色材質。 */
function paintTable(g, geo, o) {
  const round = !!o.round;
  const topFill = o.topFill || 'cloth_cream';
  const isCloth = topFill === 'cloth_cream' || topFill === 'cloth_white';
  const OL = 'furn_outline';
  const topEdge = o.topEdge || (isCloth ? shade(topFill, '#000000', 0.20) : mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.45));
  const hem = isCloth ? 'cloth_hem' : null;
  const legCol = o.legCol || (isCloth ? 'wood_lo' : 'wood_sh');
  baseShadow(g, geo, 0.98);

  const topCy = geo.gy - geo.hgt; // 桌面板中心
  const tw = geo.bw - 4;
  const th = geo.bh - 2;
  const topY = topCy - th / 2;
  // 圓桌：桌面橢圓半徑上限 = 0.42 × footprint 寬（桌緣到格邊留 4–6px，椅子才看得見）
  const rx = round ? Math.min(tw / 2, Math.round(geo.bw * 0.32)) : tw / 2;
  const ry = round ? Math.min(th / 2, Math.round(rx / 2)) : th / 2;
  const bw2 = geo.bw / 2;
  const bh2 = geo.bh / 2;

  // ── 四隻腳（等角＝垂直落下；先畫，桌面會蓋住頂端）──
  leg(g, geo.cx - bw2 + 3, topCy + 1, geo.gy + 1, legCol, OL);
  leg(g, geo.cx + bw2 - 5, topCy + 1, geo.gy + 1, legCol, OL);
  leg(g, geo.cx - 1, topY + 1, geo.gy - bh2 + 2, 'wood_sh', OL);
  leg(g, geo.cx, topY + th - 3, geo.gy + bh2 - 2, 'wood_sh', OL);

  // ── 桌板：1px 外框（上表面 + 板厚下緣各一圈）→ 桌裙 → 板厚側面 → 上表面 ──
  const skirt = isCloth ? shade(topFill, '#000000', 0.22) : mixHex(PALETTE.top_dark, '#000000', 0.5);
  if (round) {
    // 桌裙（比桌面暗一階，形成「桌面＋桌裙」兩層）
    g.ell(geo.cx, topCy + g.u(5), rx + 2, ry + 2, OL);
    g.ell(geo.cx, topCy + g.u(5), rx + 1, ry + 1, skirt);
    // 右下側暗色桌緣／陰影帶（先畫，之後被桌面蓋住，只露出右下 2px）
    g.ell(geo.cx + 1, topCy + 1, rx + 1, ry + 1, shade(topEdge, '#000000', 0.25));
    // 桌面：2px 實色外框（描邊）→ 板厚側面 → 上表面
    g.ell(geo.cx, topCy + 2, rx + 1, ry + 1, OL);
    g.ell(geo.cx, topCy, rx + 1, ry + 1, OL);
    g.ell(geo.cx, topCy + 2, rx, ry, topEdge);
    g.ell(geo.cx, topCy, rx - 1, ry, topFill);
    g.ell(geo.cx, topCy, rx - 2, ry - 1, OL);
    g.ell(geo.cx, topCy, rx - 3, ry - 1, topFill);
    if (hem) {
      // 桌布滾邊（實色環）＋實色織紋條帶
      g.ell(geo.cx, topCy, rx - 2, ry - 1, hem);
      g.ell(geo.cx, topCy, rx - 4, ry - 2, topFill);
      clothWeave(g, geo.cx, topCy, rx - 5, ry - 3, topFill);
    }
    // 上緣高光（實色弧）＋下緣暗邊
    g.r(geo.cx - Math.round(rx * 0.5), topCy - ry + 1, Math.round(rx), 2, mixHex(topFill, '#ffffff', 0.30));
    g.r(geo.cx - Math.round(rx * 0.4), topCy + ry - 2, Math.round(rx * 0.8), 2, mixHex(topFill, '#000000', 0.16));
    // 宴會圓桌：加轉盤（六人桌看得懂是「合菜桌」）
    if (o.susan !== false && rx >= 34) lazySusan(g, geo.cx, topCy - 2, Math.max(9, Math.round(rx * 0.40)));
  } else {
    g.dia(geo.cx, topY - 2, tw + 4, th + 4, OL); // 上表面外框（2px）
    g.dia(geo.cx, topY + g.u(4), tw + 2, th + 2, OL); // 桌裙下緣外框
    g.dia(geo.cx, topY + g.u(3), tw, th, skirt); // 桌裙
    g.dia(geo.cx, topY + 1, tw + 2, th + 2, OL); // 板厚下緣外框
    g.dia(geo.cx, topY + 2, tw, th, topEdge); // 板厚側面
    g.dia(geo.cx, topY, tw, th, topFill); // 上表面
    g.dia(geo.cx, topY + 1, tw - 4, th - 2, OL); // 內側暗線（桌緣 2px）
    g.dia(geo.cx, topY + 2, tw - 6, th - 3, topFill);
    if (hem) {
      g.dia(geo.cx, topY + 1, tw - 2, th - 2, hem); // 桌布滾邊
      g.dia(geo.cx, topY + 2, tw - 4, th - 4, topFill);
      // 實色織紋條帶（2px 一組，等距；取代原本的網點編織）
      for (let i = -2; i <= 2; i++) {
        const y = Math.round(topY + th / 2 + i * g.u(4));
        g.r(geo.cx - Math.round(tw * 0.32), y, Math.round(tw * 0.64), 2, mixHex(topFill, '#000000', 0.12));
        g.r(geo.cx - Math.round(tw * 0.28), y + 2, Math.round(tw * 0.56), 1, mixHex(topFill, '#ffffff', 0.22));
      }
    } else {
      // 深色木桌的木紋（2px 實線）
      g.line(geo.cx - tw / 4, topY + 2, geo.cx + tw / 4, topY + th / 2, mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.35));
      g.line(geo.cx - tw / 4 + 1, topY + 3, geo.cx + tw / 4 + 1, topY + th / 2 + 1, mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.35));
    }
    // 右下側 2px 暗色桌緣
    g.line(geo.cx, topY + th + 1, geo.cx + tw / 2, topY + th / 2 + 1, shade(topEdge, '#000000', 0.3));
    g.line(geo.cx, topY + th + 2, geo.cx + tw / 2, topY + th / 2 + 2, shade(topEdge, '#000000', 0.3));
    // 上緣高光（實色帶）：桌布打亮、深色木桌只做木色光澤，維持「深色桌面」的暗度
    g.r(geo.cx - Math.round(tw * 0.3), topY + 2, Math.round(tw * 0.6), 2,
      isCloth ? mixHex(topFill, '#ffffff', 0.28) : mixHex(topFill, PALETTE.wood_md, 0.18));
  }

  // ── 餐具／坐位記號：一律留在桌面內緣，不壓到外框；全部是實色小物 ──
  // 有人坐（o.occupied > 0）→ 盤 + 杯 + 紙巾＋筷子／刀叉；空桌 → 一副餐具
  const fac = o.facings && o.facings.length ? o.facings : ['N', 'S'];
  const busy = Math.max(0, Number(o.occupied) | 0);
  const plateHi = isCloth ? 'gray_50' : 'gray_15';
  // 圓桌（宴會桌）：餐具沿桌緣均勻擺 6 副；方桌：依 facings 擺在四邊
  const seats = round && rx >= 34
    ? [
      { side: 'N', x: geo.cx, y: topCy - ry + g.u(3) },
      { side: 'S', x: geo.cx, y: topCy + ry - g.u(5) },
      { side: 'W', x: geo.cx - rx + g.u(4), y: topCy },
      { side: 'E', x: geo.cx + rx - g.u(4), y: topCy },
      { side: 'N', x: geo.cx - Math.round(rx * 0.55), y: topCy - Math.round(ry * 0.62) + g.u(1) },
      { side: 'S', x: geo.cx + Math.round(rx * 0.55), y: topCy + Math.round(ry * 0.62) - g.u(3) },
    ]
    : null;
  if (seats) {
    for (let i = 0; i < seats.length; i++) {
      const st2 = seats[i];
      tableSetting(g, Math.round(st2.x), Math.round(st2.y), st2.side, plateHi, !isCloth);
    }
  } else {
    for (let i = 0; i < fac.length; i++) {
      const d = fac[i];
      if (d === 'N') tableSetting(g, geo.cx, Math.round(topY + g.u(3)), 'N', plateHi, !isCloth);
      else if (d === 'S') tableSetting(g, geo.cx, Math.round(topY + th - g.u(4)), 'S', plateHi, !isCloth);
      else if (d === 'W') tableSetting(g, Math.round(geo.cx - tw * 0.28), Math.round(topY + th / 2), 'W', plateHi, !isCloth);
      else tableSetting(g, Math.round(geo.cx + tw * 0.28), Math.round(topY + th / 2), 'E', plateHi, !isCloth);
    }
  }
  // 桌上調味罐（有人坐時多一罐醬油）：實色
  g.r(geo.cx - g.u(6), topY + g.u(3), g.u(2), g.u(3), 'gray_90');
  g.r(geo.cx - g.u(7), topY + g.u(2), g.u(4), 1, '#ffffff');
  g.r(geo.cx - g.u(6), topY + g.u(6), g.u(2), 1, OL);
  if (busy > 0) {
    g.r(geo.cx + g.u(4), topY + g.u(3), g.u(2), g.u(4), 'red_md');
    g.r(geo.cx + g.u(4), topY + g.u(2), g.u(2), 1, 'red_hi');
  }
  // 客人實際點的菜（o.dishes = ['staple','soup',...]）：擺在轉盤上或桌面中央
  const dishes = o.dishes;
  if (dishes && dishes.length) {
    const n = Math.min(4, dishes.length);
    const cyDish = round && rx >= 40 ? topCy - 2 : topY + th / 2 - g.u(3);
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * g.u(8);
      paintDish(g, Math.round(geo.cx + dx), Math.round(cyDish + (i & 1 ? g.u(5) : 0)), dishes[i], i);
    }
  }
}

// ── 椅 ────────────────────────────────────────────────────────────────────
/** 椅子：深色木框 + 彩色椅墊 + 背向坐向的椅背，與地板和桌面都明顯不同色。 */
// ===========================================================================
// 椅子（木椅／鐵管椅／沙發椅；56×28 tile 下手繪細節）
// ===========================================================================

/** 座墊色票（variant 0 = 既有色；同型椅子只做同色系微調，不同型之間保持辨識度）。 */
const CHAIR_SEAT_VARIANTS = {
  wood: ['cushion_red', 'red', 'cushion_red', 'red'],
  iron: ['cushion_gry', 'gray_50', 'gray_70', 'cushion_gry'],
  soft: ['red', 'red_md', 'cushion_red', 'red_lo'],
};

/** 依 variant 取座墊色。 */
function seatVariant(kind, variant) {
  const list = CHAIR_SEAT_VARIANTS[kind] || CHAIR_SEAT_VARIANTS.wood;
  const v = ((variant | 0) % list.length + list.length) % list.length;
  return list[v];
}

/**
 * 斜削椅腳：上粗下細、側面暗一階、腳底加深色接地塊。
 * (x, yTop) 為腳的頂端左緣，yBot 為地面。
 */
function taperedLeg(g, x, yTop, yBot, col, o) {
  const h = Math.round(yBot) - Math.round(yTop);
  if (h <= 1) return;
  const wTop = g.u(2);
  const wBot = Math.max(2, wTop - g.u(1));
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const y0 = Math.round(yTop + (h * i) / steps);
    const y1 = Math.round(yTop + (h * (i + 1)) / steps);
    const w = Math.round(wTop + ((wBot - wTop) * i) / steps);
    const segH = Math.max(2, y1 - y0 + 1);
    g.r(x + Math.round((wTop - w) / 2), y0, w, segH, col);
    g.r(x + Math.round((wTop - w) / 2), y0, 2, segH, 'furn_outline');
    g.r(x + Math.round((wTop - w) / 2) + w - 2, y0, 2, segH, shade(col, 'black', 0.3));
  }
  // 腳底接地（深色）
  g.r(x, Math.round(yBot) - g.u(1), wBot + 1, Math.max(2, g.u(1)), shade(col, 'black', 0.62));
  if (o && o.cap) g.r(x, Math.round(yBot) - g.u(2), wBot + 1, 2, 'black');
}

/** 椅腳的 4 個等角位置（座面四角，往下就是地板上的落點）。 */
function chairLegSpots(geo, seatInset, seatLift) {
  const hw = geo.bw / 2 - seatInset;
  const hh = geo.bh / 2 - seatInset;
  const bx = geo.cx;
  const by = geo.gy - seatLift; // 座面底部的中心
  return [
    { x: bx - hw, y: by }, // W
    { x: bx, y: by + hh }, // S
    { x: bx + hw, y: by }, // E
    { x: bx, y: by - hh }, // N
  ];
}

/** 垂直圓管椅腳（等角：垂直線在螢幕上仍是垂直線）。 */
function tubeLeg(g, x, yTop, yBot, w, face, hi, lo, foot) {
  const h = Math.round(yBot) - Math.round(yTop);
  if (h <= 0) return;
  const x0 = Math.round(x - w / 2);
  g.r(x0, Math.round(yTop), w, h, 'furn_outline');
  g.r(x0, Math.round(yTop), Math.max(1, w - 1), h, face);
  g.r(x0, Math.round(yTop), 1, h, hi);
  if (w > 2) g.r(x0 + w - 1, Math.round(yTop), 1, h, lo);
  if (foot) g.r(x0, Math.round(yBot) - g.u(1) - 1, w, g.u(1) + 1, 'black');
}

/** 手繪半圓彎管（頂端弧）：厚 thick、上緣高光、下緣描邊，不做任何擦除。 */
function arcRail(g, cx, cy, halfW, thick, face, hi, ol) {
  for (let i = -halfW; i <= halfW; i++) {
    const t = i / Math.max(1, halfW);
    const dy = -Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * thick);
    const x = Math.round(cx + i);
    g.r(x, Math.round(cy + dy), 1, thick, face);
    g.p(x, Math.round(cy + dy), hi);
    g.p(x, Math.round(cy + dy) + thick, ol);
  }
}

/** 木椅：斜削腳＋木紋座面（倒角）＋3 橫板條 2 立柱椅背＋榫接點。 */
function paintChairWood(g, geo, o) {
  const d = o.dir || 'S';
  const OL = 'furn_outline';
  const varN = o.variant | 0;
  const frameCol = varN === 1 ? 'wood_sh' : 'wood_dark';
  const frameHi = 'wood_sh';
  const frameLo = 'wood_dark';
  const seatCol = seatVariant('wood', varN);
  baseShadow(g, geo, 0.7);

  const seatLift = g.u(5); // 座面離地
  const seatW = g.u(10);
  const seatH = g.u(6);
  const seatTop = geo.gy - seatLift - g.u(2);

  // ── 椅腳（斜削，四隻都在座面四角正下方）──
  const spots = chairLegSpots(geo, g.u(5), seatLift);
  const backLegs = d === 'S' ? [3, 0] : d === 'N' ? [2, 1] : d === 'E' ? [2, 3] : [1, 0];
  const frontLegs = d === 'S' ? [1, 2] : d === 'N' ? [0, 3] : d === 'E' ? [0, 1] : [2, 3];
  for (const i of backLegs) taperedLeg(g, Math.round(spots[i].x - g.u(1)), spots[i].y, spots[i].y + seatLift, frameLo, null);
  // 橫撐（左右各一根，從側面看得到）
  g.r(Math.round(geo.cx - seatW / 2 + g.u(2)), Math.round(geo.gy - g.u(1)), Math.round(seatW - g.u(4)), g.u(1), frameLo);
  for (const i of frontLegs) taperedLeg(g, Math.round(spots[i].x - g.u(1)), spots[i].y, spots[i].y + seatLift, frameCol, null);

  // ── 座面（等角薄板：1px 描邊＋頂面木紋＋倒角）──
  g.dia(geo.cx, seatTop, seatW + 2, seatH + 2, OL);
  g.r(geo.cx - 1, seatTop, 2, 2, OL);
  g.r(geo.cx - 1, seatTop + seatH, 2, 2, OL);
  g.dia(geo.cx, seatTop + 1, seatW, seatH, frameHi);
  g.dia(geo.cx, seatTop + 1 + g.u(1), seatW - g.u(3), seatH - g.u(1), frameCol);
  // 前緣厚度帶
  g.dia(geo.cx, seatTop + g.u(2), seatW, seatH - g.u(1), OL);
  g.dia(geo.cx, seatTop + g.u(2) + 1, seatW - g.u(1), seatH - g.u(2), frameCol);
  // 木紋（等角方向 2 條，隨 variant 位移）
  const grain = (varN & 1) ? 1 : 0;
  g.thick(geo.cx - seatW / 2 + g.u(2), seatTop + seatH / 2 + grain, geo.cx, seatTop + seatH - g.u(1) + grain, frameLo);
  g.thick(geo.cx, seatTop + g.u(1) + grain, geo.cx + seatW / 2 - g.u(2), seatTop + seatH / 2 + grain, frameLo);
  // 倒角：遠邊亮、近邊暗
  g.thick(geo.cx - seatW / 2, seatTop + seatH / 2 + 1, geo.cx, seatTop + 1, 'wood_hi');
  g.thick(geo.cx, seatTop + seatH + 1, geo.cx + seatW / 2, seatTop + seatH / 2 + 1, frameLo);
  // 椅墊（每一種 variant 都有墊子，只是顏色／織紋不同）
  g.dia(geo.cx, seatTop + 2, Math.max(6, seatW - g.u(1)), Math.max(4, seatH - 2), seatCol);
  g.r(geo.cx - 1, seatTop + g.u(1), 2, 2, seatCol);
  g.r(geo.cx - 1, seatTop + g.u(1) + seatH - g.u(3) - 2, 2, 2, seatCol);
  g.dith(geo.cx - seatW / 2 + g.u(4), seatTop + g.u(2), seatW - g.u(8), g.u(3), mixHex(seatCol, '#ffffff', 0.35), 'clear', DITHER.block25);
  g.dith(geo.cx - seatW / 2 + g.u(4), seatTop + g.u(2), seatW - g.u(8), g.u(3), shade(seatCol, 'black', 0.35), 'clear', varN & 1 ? DITHER.block12 : DITHER.block12);
  g.r(geo.cx - g.u(3), seatTop + g.u(1), g.u(2), 2, mixHex(seatCol, '#ffffff', 0.45));
  // 有人坐 → 坐墊中間壓出凹痕（不用擦除，直接蓋深色帶）
  if (o.seatOccupied) {
    g.r(geo.cx - g.u(3), seatTop + g.u(2), g.u(6), 1, shade(seatCol, 'black', 0.42));
    g.r(geo.cx - g.u(4), seatTop + g.u(3), g.u(8), 1, shade(seatCol, 'black', 0.28));
  }

  // ── 椅背：2 立柱 + 3 橫板條 + 圓角頂 ──
  const backH = g.u(8) + (varN === 2 ? 1 : 0);
  const postW = g.u(2);
  const gap = g.u(4);
  const bxc = geo.cx;
  const byBot = seatTop + g.u(1);
  const byTop = byBot - backH;
  const pxL = Math.round(bxc - gap - postW);
  const pxR = Math.round(bxc + gap);
  for (const px of [pxL, pxR]) {
    g.r(px, byTop + 1, postW, backH - 1, OL);
    g.r(px + 1, byTop + 2, postW - 2, backH - 3, frameCol);
    g.r(px + 1, byTop + 2, 1, backH - 3, frameHi);
    g.r(px + postW - 1, byTop + 2, 1, backH - 3, frameLo);
  }
  // 頂端圓角：最上面一列往內縮 1px（不用擦除）
  g.r(pxL + 1, byTop + 1, postW - 1, 1, OL);
  g.r(pxR, byTop + 1, postW - 1, 1, OL);
  // 3 根橫向板條（上／中／下），板條上下各 1px 亮暗
  const slatW = Math.round(gap * 2 + postW);
  for (let i = 0; i < 3; i++) {
    const sy = byTop + g.u(2) + Math.round((backH - g.u(5)) * (i / 2));
    g.r(pxL, sy, slatW, g.u(2), OL);
    g.r(pxL + 1, sy + 1, slatW - 2, Math.max(1, g.u(2) - 2), frameHi);
    g.r(pxL + 1, sy + g.u(2) - 1, slatW - 2, 1, frameLo);
    // 榫接：立柱與板條交接處的深色小點
    g.p(pxL + 1, sy + g.u(1), 'wood_sh');
    g.p(pxR + postW - 2, sy + g.u(1), 'wood_sh');
  }
  void d;
}

/** 鐵管椅：細圓管骨架（亮面＋暗面）、彎管靠背、繃緊布面、黑色腳墊。 */
function paintChairIron(g, geo, o) {
  const d = o.dir || 'S';
  const OL = 'furn_outline';
  const varN = o.variant | 0;
  const tube = 'metal';
  const tubeHi = 'metal_hi';
  const tubeLo = 'metal_lo';
  const fabric = seatVariant('iron', varN);
  baseShadow(g, geo, 0.6);

  const seatLift = g.u(8);
  const seatW = g.u(10);
  const seatH = g.u(6);
  const seatTop = geo.gy - seatLift - g.u(1);
  const tw = g.u(1) + 1; // 管徑（細管但至少 3px 才看得出高光／暗面）

  const spots = chairLegSpots(geo, g.u(3), seatLift);
  const backLegs = d === 'S' ? [3, 0] : d === 'N' ? [2, 1] : d === 'E' ? [2, 3] : [1, 0];
  const frontLegs = d === 'S' ? [1, 2] : d === 'N' ? [0, 3] : d === 'E' ? [0, 1] : [2, 3];
  for (const i of backLegs) tubeLeg(g, spots[i].x, spots[i].y, spots[i].y + seatLift, tw, shade(tube, 'black', 0.25), tube, tubeLo, true);
  // 座下橫撐（細管）
  g.r(Math.round(geo.cx - seatW / 2 + g.u(2)), Math.round(geo.gy - g.u(3)), Math.round(seatW - g.u(4)), 1, OL);
  g.r(Math.round(geo.cx - seatW / 2 + g.u(2)), Math.round(geo.gy - g.u(3)) + 1, Math.round(seatW - g.u(4)), 1, tubeLo);
  // 座面（繃布：網點織紋 + 深色邊框）
  g.dia(geo.cx, seatTop, seatW + 2, seatH + 2, OL);
  g.dia(geo.cx, seatTop + 1, seatW, seatH, fabric);
  g.dith(geo.cx - seatW / 2 + g.u(3), seatTop + g.u(2), seatW - g.u(6), seatH - g.u(4), shade(fabric, 'black', 0.3), 'clear', DITHER.block12);
  g.r(geo.cx - Math.round(seatW / 2) + g.u(4), seatTop + g.u(1), seatW - g.u(8), 1, mixHex(fabric, '#ffffff', 0.45));
  if (o.seatOccupied) {
    // 有人坐：繃布被壓出皺褶
    g.r(geo.cx - g.u(4), seatTop + g.u(2), g.u(8), 1, shade(fabric, 'black', 0.4));
    g.r(geo.cx - g.u(6), seatTop + g.u(3), g.u(12), 1, shade(fabric, 'black', 0.24));
  }
  for (const i of frontLegs) tubeLeg(g, spots[i].x, spots[i].y, spots[i].y + seatLift, tw, tube, tubeHi, tubeLo, true);

  // ── 彎管靠背：兩根立管向上，頂端一段半圓彎管 ──
  const backH = g.u(7) + (varN & 1);
  const postW = Math.max(2, g.u(1) + 1);
  const gap = g.u(7);
  const bxc = geo.cx;
  const byBot = seatTop + g.u(1);
  const railCy = byBot - backH;
  const pxL = Math.round(bxc - gap);
  const pxR = Math.round(bxc + gap - postW);
  for (const px of [pxL, pxR]) {
    const x0 = px;
    g.r(x0, railCy, postW, byBot - railCy, OL);
    g.r(x0, railCy, postW - 1, byBot - railCy, tube);
    g.r(x0, railCy, 1, byBot - railCy, tubeHi);
    if (postW > 2) g.r(x0 + postW - 1, railCy, 1, byBot - railCy, tubeLo);
  }
  arcRail(g, bxc, railCy, gap + Math.round(postW / 2), Math.max(2, g.u(2)), tube, tubeHi, OL);
  // 中間橫管
  const midY = Math.round(byBot - backH * 0.45);
  g.r(pxL, midY, pxR + postW - pxL, 1, OL);
  g.r(pxL, midY + 1, pxR + postW - pxL, Math.max(1, postW - 1), tube);
  g.r(pxL + 1, midY + 1, Math.max(1, pxR - pxL - 2), 1, tubeHi);
}

/** 沙發椅：厚坐墊（雙色調＋壓線縫線）＋扶手＋橫向壓紋椅背。 */
function paintChairSoft(g, geo, o) {
  const d = o.dir || 'S';
  const OL = 'furn_outline';
  const varN = o.variant | 0;
  // 沙發椅（layout 未使用）：繃布與木框都壓暗，和木地板保持亮度分離
  const fabric = mixHex(seatVariant('soft', varN), '#000000', 0.5);
  const fabHi = mixHex(fabric, '#ffffff', 0.22);
  const fabLo = shade(fabric, 'black', 0.4);
  const woodCol = 'wood_dark';
  baseShadow(g, geo, 0.8);

  const seatLift = g.u(4);
  void 0;
  const seatW = g.u(9);
  const seatH = g.u(5);
  const seatTop = geo.gy - seatLift - g.u(3);

  // 椅腳（短木腳）
  const spots = chairLegSpots(geo, g.u(5), seatLift);
  const backLegs = d === 'S' ? [3, 0] : d === 'N' ? [2, 1] : d === 'E' ? [2, 3] : [1, 0];
  const frontLegs = d === 'S' ? [1, 2] : d === 'N' ? [0, 3] : d === 'E' ? [0, 1] : [2, 3];
  for (const i of backLegs) taperedLeg(g, Math.round(spots[i].x - g.u(1)), spots[i].y, spots[i].y + seatLift, shade(woodCol, 'black', 0.2), null);
  for (const i of frontLegs) taperedLeg(g, Math.round(spots[i].x - g.u(1)), spots[i].y, spots[i].y + seatLift, woodCol, null);

  // ── 椅背軟墊（先畫，扶手才會壓在前面）──
  const backH = g.u(7) + (varN === 1 ? g.u(1) : 0);
  const bwid = Math.round(seatW - g.u(2));
  const bx = Math.round(geo.cx - bwid / 2);
  const byBot = seatTop + g.u(1);
  const byTop = byBot - backH;
  g.r(bx - 1, byTop, bwid + 2, backH + 2, OL);
  g.r(bx, byTop + 1, bwid, backH, fabric);
  g.r(bx + 1, byTop, bwid - 2, g.u(1) + 1, fabHi);
  g.r(bx, byTop + 1, 2, backH, fabHi);
  g.r(bx, byTop, bwid, 2, fabHi);
  g.r(bx + bwid - 2, byTop + 1, 2, backH, fabLo);
  g.r(bx, byBot, bwid, 2, fabLo);
  // 橫向壓紋（3 條）+ 鈕扣
  for (let i = 0; i < 3; i++) {
    const y = byTop + g.u(3) + i * g.u(3);
    g.r(bx + 1, y, bwid - 2, 2, fabLo);
    g.r(bx + 1, y + 2, bwid - 2, 2, shade(fabric, 'black', 0.16));
    if (i === 1) {
      g.p(bx + Math.round(bwid / 2) - 1, y + 1, shade(fabric, 'black', 0.6));
      g.p(bx + Math.round(bwid / 2), y + 1, shade(fabric, 'black', 0.6));
    }
  }

  // ── 座墊（厚：頂面亮、前緣中、底緣暗 + 壓線與縫線點）──
  g.dia(geo.cx, seatTop, seatW + 2, seatH + 2, OL);
  g.dia(geo.cx, seatTop + 1, seatW, seatH, fabHi);
  g.dia(geo.cx, seatTop + 1, seatW - g.u(2), seatH - g.u(1), fabric);
  g.dia(geo.cx, seatTop + g.u(3), seatW, seatH - g.u(1), OL);
  g.dia(geo.cx, seatTop + g.u(3) + 1, seatW - 1, seatH - g.u(2), fabLo);
  const stitchCol = shade(fabric, 'black', 0.5);
  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    const sx = geo.cx - seatW / 2 + seatW * t;
    const sy = seatTop + seatH / 2 + 1 + (i % 2 ? 1 : -1);
    g.p(Math.round(sx), Math.round(sy), stitchCol);
  }
  g.r(geo.cx - g.u(4), seatTop + g.u(2), g.u(8), 1, fabLo);
  if (o.seatOccupied) {
    // 有人坐：厚坐墊被壓沉（兩道凹痕）
    g.r(geo.cx - g.u(5), seatTop + g.u(2), g.u(10), 1, shade(fabric, 'black', 0.45));
    g.r(geo.cx - g.u(7), seatTop + g.u(3), g.u(14), 1, shade(fabric, 'black', 0.3));
  }

  // ── 扶手（左右各一，畫在最上層並突出椅背兩側才看得見）──
  const armW = g.u(2) + 1;
  const armTop = seatTop;
  const armH = g.u(4);
  for (const side of [-1, 1]) {
    const acx = Math.round(geo.cx + side * (seatW / 2 + g.u(1)));
    const x0 = acx - Math.round(armW / 2);
    g.r(x0, armTop - armH, armW, armH + g.u(3), OL);
    g.r(x0 + 1, armTop - armH + 1, armW - 2, armH + g.u(1), fabric);
    g.r(x0 + 1, armTop - armH + 1, armW - 2, 1, fabHi);
    g.r(x0 + 1, armTop - armH + 2, 1, armH + g.u(1) - 1, side < 0 ? fabHi : fabLo);
    g.r(x0 + 1, armTop + g.u(1), armW - 2, 1, fabLo);
    // 支撐柱（扶手前端往下接到地面）
    g.r(acx - 1, armTop + g.u(2), 2, seatLift - g.u(2), shade(woodCol, 'black', 0.35));
  }
  void d;
}

/** 舊版通用椅（凳子／長凳沿用）。 */
function paintChairSimple(g, geo, o) {
  const d = o.dir || 'S';
  const seatCol = o.seat || 'cushion_teal';
  const frameCol = o.frameCol || 'wood_sh';
  const frameHi = o.frameHi || 'wood_md';
  const OL = 'furn_outline';
  const seatY = geo.gy - 6; // 座面高度
  const bw2 = geo.bw / 2;
  const bh2 = geo.bh / 2;
  baseShadow(g, geo, 0.66);

  // ── 椅腳 ──
  if (o.stool) {
    leg(g, geo.cx - 6, seatY + 1, geo.gy + 1, frameCol, OL);
    leg(g, geo.cx + 4, seatY + 1, geo.gy + 1, frameCol, OL);
    leg(g, geo.cx, seatY + 1, geo.gy + bh2 - 2, frameCol, OL);
  } else {
    leg(g, geo.cx - bw2 + 3, seatY + 1, geo.gy + 1, frameCol, OL);
    leg(g, geo.cx + bw2 - 5, seatY + 1, geo.gy + 1, frameCol, OL);
    leg(g, geo.cx - 1, seatY, geo.gy - bh2 + 2, frameCol, OL);
    leg(g, geo.cx, seatY + 2, geo.gy + bh2 - 2, frameCol, OL);
  }

  // ── 座面（1px 描邊 + 椅墊）──
  g.dia(geo.cx, seatY - 3, geo.bw - 6, geo.bh - 4, OL);
  g.dia(geo.cx, seatY - 2, geo.bw - 8, geo.bh - 6, seatCol);
  g.dia(geo.cx, seatY - 1, geo.bw - 12, geo.bh - 8, mixHex(seatCol, '#ffffff', 0.16));
  g.r(geo.cx - 4, seatY - 1, 8, 1, OL);
  g.r(geo.cx - 2, seatY - 2, 4, 1, mixHex(seatCol, '#ffffff', 0.34));
  if (o.stool) return;

  // ── 椅背（背向坐向：坐南朝北的椅子，椅背在畫面北方）──
  const backH = 10;
  if (d === 'S' || d === 'N') {
    const bwid = geo.bw - 8;
    const bx = geo.cx - bwid / 2;
    const by = d === 'S' ? seatY - backH - 3 : seatY + 3;
    g.r(bx - 1, by - 1, bwid + 2, backH + 2, OL);
    g.r(bx, by, bwid, backH, frameCol);
    g.r(bx, by, bwid, 1, frameHi); // 上橫桿
    g.r(bx, by + backH - 1, bwid, 1, shade(frameCol, '#000000', 0.35));
    g.r(geo.cx - 3, by + 1, 2, backH - 2, frameHi); // 兩根豎條
    g.r(geo.cx + 2, by + 1, 2, backH - 2, frameHi);
    g.r(geo.cx - 1, by + 1, 1, backH - 2, shade(frameCol, '#000000', 0.3));
  } else {
    const px = d === 'W' ? geo.cx + 5 : geo.cx - 9;
    const py = seatY - backH + 2;
    g.r(px - 1, py - 1, 6, backH + 2, OL);
    g.r(px, py, 4, backH, frameCol);
    g.r(px, py, 4, 1, frameHi);
    g.r(px, py + backH - 1, 4, 1, shade(frameCol, '#000000', 0.35));
    g.r(px + 1, py + 2, 2, backH - 4, frameHi);
  }
}

// ── 櫃台 ──────────────────────────────────────────────────────────────────
function paintCounter(g, geo, o) {
  baseShadow(g, geo, 0.95);
  const bodyH = geo.hgt;
  cuboid(g, geo.cx, geo.gy, geo.bw - 4, geo.bh - 2, bodyH - 3, 'wood_hi', 'wood_md', 'wood_lo', 'outline');
  // 前板木紋
  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    const x = 6 + t * (geo.bw - 12);
    g.line(x, geo.gy - bodyH + 4, x, geo.gy - 1, 'wood_sh');
  }
  g.dith(4, geo.gy - bodyH + 2, geo.bw - 8, bodyH - 6, 'lamp_hi', 'clear', DITHER.block12);
  // 檯面（大理石化：灰底 + 網點）
  g.dia(geo.cx, geo.gy - bodyH - (geo.bh - 6) / 2, geo.bw - 2, geo.bh - 6, 'outline');
  g.dia(geo.cx, geo.gy - bodyH + 1 - (geo.bh - 8) / 2, geo.bw - 4, geo.bh - 8, 'gray_90');
  g.dith(6, geo.gy - bodyH - 3, geo.bw - 12, geo.bh - 8, 'gray_30', 'clear', DITHER.block12);
  if (o.cashier) {
    // 收銀機
    const rx = geo.cx + 2;
    const ry = geo.gy - bodyH - 2;
    g.r(rx - 5, ry - 9, 11, 8, 'outline');
    g.r(rx - 4, ry - 8, 9, 6, 'gray_50');
    g.r(rx - 3, ry - 7, 7, 2, 'gray_15');
    g.r(rx - 3, ry - 4, 7, 1, 'gray_70');
    g.r(rx + 3, ry - 4, 1, 2, 'hp_ok');
    g.r(rx - 2, ry - 11, 5, 2, 'white');
  }
  if (o.menu) {
    g.r(geo.cx - 9, geo.gy - bodyH - 12, 8, 7, 'outline');
    g.r(geo.cx - 8, geo.gy - bodyH - 11, 6, 5, 'gray_15');
    g.r(geo.cx - 7, geo.gy - bodyH - 10, 4, 1, 'white');
    g.r(geo.cx - 7, geo.gy - bodyH - 8, 3, 1, 'gray_70');
  }
  if (o.bar) {
    // 吧台酒瓶
    const bx = geo.cx - 6;
    const by = geo.gy - bodyH - 2;
    for (let i = 0; i < 4; i++) {
      const c = ['teal_md', 'red_md', 'lamp_md', 'leaf_lo'][i];
      g.r(bx + i * 3, by - 7, 2, 7, c);
      g.r(bx + i * 3, by - 9, 2, 2, 'wood_dark');
    }
    g.r(bx - 1, by - 12, 15, 2, 'wood_sh');
  }
}

// ── 廚房設備 ──────────────────────────────────────────────────────────────
function paintStove(g, geo, o) {
  baseShadow(g, geo, 0.95);
  cuboid(g, geo.cx, geo.gy, geo.bw - 4, geo.bh - 2, geo.hgt - 4, 'metal_hi', 'metal', 'metal_md', 'outline');
  const t = geo.gy - geo.hgt + 2;
  // 四個爐口
  for (let i = 0; i < 4; i++) {
    const dx = (i & 1 ? 6 : -6);
    const dy = (i > 1 ? 3 : -2);
    g.dia(geo.cx + dx, t + dy, 7, 4, 'metal_sh');
    const on = ((o.frame | 0) + i) % 4 < 2;
    if (on) {
      g.dith(geo.cx + dx - 2, t + dy, 5, 3, 'fire', 'clear', DITHER.block50);
      g.r(geo.cx + dx - 1, t + dy + 1, 2, 1, 'fire_hi');
    }
  }
  // 湯鍋
  g.r(geo.cx - 8, t - 5, 7, 5, 'metal_lo');
  g.r(geo.cx - 7, t - 6, 5, 1, 'metal');
  g.dith(geo.cx - 7, t - 8, 5, 2, 'gray_90', 'clear', DITHER.block12);
  // 控制旋鈕
  g.r(3, geo.gy - geo.hgt + 8, 12, 1, 'metal_sh');
  for (let i = 0; i < 4; i++) g.r(5 + i * 3, geo.gy - geo.hgt + 6, 2, 2, 'gray_30');
  if (o.broken) {
    g.r(geo.cx + 2, t - 4, 1, 3, 'hp_bad');
    g.r(geo.cx + 4, t - 6, 1, 3, 'hp_warn');
  }
}

function paintPrepTable(g, geo, o) {
  baseShadow(g, geo, 0.9);
  slab(g, geo.cx, geo.gy - geo.hgt + 4, geo.bw - 6, geo.bh - 4, 3, 'metal_hi', 'metal', 'outline');
  leg(g, 5, geo.gy - geo.hgt + 6, geo.gy, 'metal_md');
  leg(g, geo.W - 7, geo.gy - geo.hgt + 6, geo.gy, 'metal_md');
  leg(g, geo.cx - 1, geo.gy - geo.hgt + geo.bh / 2, geo.gy + 4, 'metal_lo');
  // 砧板 + 菜刀
  g.r(geo.cx - 9, geo.gy - geo.hgt - 1, 9, 2, 'wood_hi');
  g.r(geo.cx - 9, geo.gy - geo.hgt - 1, 9, 1, 'wood');
  g.r(geo.cx + 1, geo.gy - geo.hgt - 4, 8, 2, 'metal_hi');
  g.r(geo.cx + 8, geo.gy - geo.hgt - 4, 3, 1, 'wood_dark');
  g.r(geo.cx - 2, geo.gy - geo.hgt - 3, 3, 2, 'red');
}

function paintSink(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt - 4, 'metal_hi', 'metal', 'metal_md', 'outline');
  const t = geo.gy - geo.hgt + 3;
  g.dia(geo.cx, t - 3, geo.bw - 12, geo.bh - 8, 'metal_sh');
  g.dith(geo.cx - 5, t - 3, 10, 4, 'water', 'clear', DITHER.block25);
  g.r(geo.cx - 2, t - 9, 2, 6, 'metal_hi'); // 水龍頭
  g.r(geo.cx - 2, t - 10, 5, 2, 'metal_hi');
  g.r(geo.cx + 1, t - 9, 1, 2, 'water_hi');
  if ((o.frame | 0) & 1) g.r(geo.cx + 1, t - 7, 1, 4, 'water_hi');
  // 排水管
  g.r(geo.cx + 6, geo.gy - 6, 2, 6, 'metal_lo');
}

function paintFridge(g, geo, o) {
  baseShadow(g, geo, 0.95);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt, 'metal_hi', 'metal_hi', 'metal', 'outline');
  const t = geo.gy - geo.hgt;
  // 門縫與把手
  g.r(4, t + 4, geo.W - 9, 1, 'metal_sh');
  g.r(4, t + Math.round(geo.hgt * 0.45), geo.W - 9, 1, 'metal_sh');
  g.r(geo.W - 9, t + 5, 2, 8, 'gray_90');
  g.r(geo.W - 9, t + Math.round(geo.hgt * 0.45) + 2, 2, 6, 'gray_90');
  // 磁鐵便條
  g.r(8, t + 7, 5, 5, 'white');
  g.r(9, t + 8, 3, 1, 'gray_30');
  g.r(9, t + 10, 3, 1, 'gray_30');
  g.r(18, t + 8, 4, 4, 'neon_yel');
  // 溫度指示燈
  g.r(geo.cx + 2, t + 2, 2, 2, ((o.frame | 0) & 1) ? 'hp_ok' : 'teal_md');
  if (o.broken) {
    g.r(geo.cx - 2, t + 10, 8, 1, 'hp_bad');
    g.dith(6, t + 12, 10, 8, 'gray_30', 'clear', DITHER.block25);
  }
}

function paintOven(g, geo, o) {
  baseShadow(g, geo, 0.95);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt, 'metal_md', 'metal_md', 'metal_lo', 'outline');
  const t = geo.gy - geo.hgt;
  g.r(6, t + 6, geo.W - 13, 8, 'metal_sh');
  g.r(8, t + 8, geo.W - 17, 5, ((o.frame | 0) & 1) ? 'lamp_md' : 'lamp_lo');
  g.r(4, t + 3, geo.W - 9, 2, 'metal_hi');
  g.r(geo.W / 2 - 6, t + 2, 12, 1, 'gray_90');
}

function paintHood(g, geo, o) {
  const y = geo.gy - geo.hgt - geo.mount;
  g.poly([[geo.cx - 10, y], [geo.cx, y + 5], [geo.cx + 10, y], [geo.cx + 7, y - 6], [geo.cx - 7, y - 6]], 'outline');
  g.poly([[geo.cx - 9, y - 1], [geo.cx, y + 4], [geo.cx + 9, y - 1], [geo.cx + 6, y - 5], [geo.cx - 6, y - 5]], 'metal_hi');
  g.r(geo.cx - 5, y - 12, 10, 7, 'metal_md');
  g.r(geo.cx - 4, y - 11, 8, 5, 'metal_lo');
  g.dith(geo.cx - 8, y + 1, 16, 3, 'gray_70', 'clear', DITHER.block12);
}

function paintFryer(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt - 2, 'metal', 'metal', 'metal_md', 'outline');
  const t = geo.gy - geo.hgt + 2;
  g.dia(geo.cx, t - 2, geo.bw - 12, geo.bh - 6, 'lamp_sh');
  g.dith(geo.cx - 5, t - 2, 10, 4, 'lamp_md', 'clear', DITHER.block50);
  g.r(geo.cx - 8, t - 8, 8, 6, 'metal_lo');
  g.r(geo.cx - 8, t - 9, 8, 1, 'metal_hi');
}

function paintDishwasher(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt - 3, 'metal_hi', 'metal', 'metal_md', 'outline');
  const t = geo.gy - geo.hgt + 1;
  g.r(5, t + 3, geo.W - 11, geo.hgt - 8, 'metal');
  g.r(6, t + 4, geo.W - 13, geo.hgt - 10, 'metal_hi');
  g.r(geo.W / 2 - 5, t + 5, 10, 1, 'gray_90');
  g.r(6, t + 2, geo.W - 13, 1, 'gray_30');
  if ((o.frame | 0) & 1) g.r(geo.W - 9, t + 3, 2, 2, 'hp_ok');
}

function paintRiceCooker(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy - geo.hgt;
  g.r(geo.cx - 7, y, 14, geo.hgt - 2, 'gray_90');
  g.r(geo.cx - 6, y + 1, 12, geo.hgt - 4, 'white');
  g.r(geo.cx - 8, y - 3, 16, 3, 'metal_hi');
  g.r(geo.cx - 6, y - 2, 4, 1, 'metal_sh');
  g.r(geo.cx + 3, y + 3, 3, 2, ((o.frame | 0) & 1) ? 'hp_ok' : 'gray_50');
  g.r(geo.cx - 7, y + geo.hgt - 3, 14, 1, 'metal_sh');
}

// ── 廁所 ──────────────────────────────────────────────────────────────────
function paintToilet(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy;
  const d = o.dir || 'S';
  const back = d === 'N' ? 3 : 0;
  // 水箱
  g.r(geo.cx - 6 + back, y - geo.hgt - 3, 12, 8, 'outline');
  g.r(geo.cx - 5 + back, y - geo.hgt - 2, 10, 6, 'tile_hi');
  g.r(geo.cx - 5 + back, y - geo.hgt - 2, 10, 1, 'white');
  g.r(geo.cx + 3 + back, y - geo.hgt, 2, 1, 'metal');
  // 座體
  g.r(geo.cx - 5, y - 8, 10, 6, 'white');
  g.dia(geo.cx, y - 4, 16, 8, 'outline');
  g.dia(geo.cx, y - 3, 13, 6, 'tile_hi');
  g.dith(geo.cx - 4, y - 2, 8, 2, 'tile_lo', 'clear', DITHER.block12);
  g.r(geo.cx - 3, y + 2, 6, 2, 'tile');
  g.r(geo.cx - 3, y + 4, 6, 1, 'outline');
  // 沖水鈕
  g.r(geo.cx + 6, y - geo.hgt, 2, 1, 'metal_hi');
}

function paintWashbasin(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy;
  const t = y - geo.hgt;
  g.r(geo.cx - 3, t + 4, 6, geo.hgt - 4, 'tile_md');
  g.r(geo.cx - 4, y - 3, 8, 3, 'tile_lo');
  g.dia(geo.cx, t - 2, 18, 9, 'outline');
  g.dia(geo.cx, t - 1, 16, 7, 'tile_hi');
  g.dith(geo.cx - 5, t + 1, 10, 3, 'water', 'clear', DITHER.block12);
  g.r(geo.cx - 1, t - 8, 2, 6, 'metal_hi');
  g.r(geo.cx - 1, t - 9, 6, 2, 'metal_hi');
  g.r(geo.cx + 3, t - 8, 1, 2, 'water_hi');
  if (((o.frame | 0) & 3) < 2) g.r(geo.cx + 3, t - 6, 1, 5, 'water_hi');
  g.r(geo.cx + 7, t + 1, 3, 4, 'gray_70');
}

function paintUrinal(g, geo, o) {
  const y = geo.gy - geo.mount;
  g.r(geo.cx - 5, y - 14, 11, 15, 'outline');
  g.r(geo.cx - 4, y - 13, 9, 13, 'tile_hi');
  g.dia(geo.cx, y - 8, 7, 6, 'tile_md');
  g.r(geo.cx - 2, y - 16, 5, 3, 'metal');
  g.r(geo.cx - 1, y - 18, 3, 2, 'metal_hi');
}

function paintDryer(g, geo, o) {
  const y = geo.gy - geo.mount;
  g.r(geo.cx - 5, y - 8, 11, 8, 'outline');
  g.r(geo.cx - 4, y - 7, 9, 6, 'gray_90');
  g.r(geo.cx - 3, y - 5, 7, 3, 'gray_50');
  g.r(geo.cx - 1, y - 10, 3, 2, 'metal');
}

function paintMirror(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  g.r(geo.cx - 10, y, 21, geo.hgt, 'wood_dark');
  g.r(geo.cx - 9, y + 1, 19, geo.hgt - 2, 'sky_lo');
  g.dith(geo.cx - 9, y + 1, 19, geo.hgt - 2, 'sky_hi', 'clear', DITHER.block50);
  g.line(geo.cx - 8, y + geo.hgt - 2, geo.cx + 8, y + 2, 'white');
}

// ── 設備 ──────────────────────────────────────────────────────────────────
function paintCCTV(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  const bw = u(11);
  const bh = u(7);
  // 支架
  g.r(geo.cx - 1, y + geo.hgt, 2, geo.mount, 'metal_lo');
  g.r(geo.cx - u(3), y + geo.hgt - 1, u(6), 2, 'metal_sh');
  // 機身
  g.r(geo.cx - bw / 2, y, bw, bh, 'outline');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, bh - 2, 'gray_15');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, 1, 'gray_30');
  // 鏡頭 + 紅外線環
  const lx = geo.cx + u(1);
  const ly = y + Math.floor(bh / 2);
  g.r(lx - u(3), ly - u(3), u(6), u(6), 'metal_sh');
  g.r(lx - u(2), ly - u(2), u(4), u(4), 'gray_15');
  g.r(lx - 1, ly - 1, 2, 2, 'sky_hi');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (((o.frame | 0) & 3) * 0.2);
    g.p(Math.round(lx + Math.cos(a) * u(3.4)), Math.round(ly + Math.sin(a) * u(3.4)), ((o.frame | 0) & 2) ? 'red_hi' : 'red_lo');
  }
  // 紅色 LED（閃爍）+ 型號銘牌
  g.r(geo.cx - bw / 2 + 1, y + 1, 2, 1, ((o.frame | 0) & 1) ? 'hp_bad' : 'red_lo');
  g.r(geo.cx - bw / 2 + 4, y + bh - 3, u(4), 1, 'gray_30');
}

function paintAircon(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  const bw = u(23);
  g.r(geo.cx - bw / 2, y, bw, geo.hgt, 'outline');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, geo.hgt - 2, 'gray_90');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, 1, 'white');
  // 出風口百葉
  const lv = Math.max(1, g.u(1));
  for (let i = 0; i < 4; i++) {
    g.r(geo.cx - bw / 2 + 2, y + u(3) + i * lv * 2, bw - 4, lv, 'gray_50');
    g.r(geo.cx - bw / 2 + 2, y + u(3) + i * lv * 2 + lv, bw - 4, 1, 'gray_70');
  }
  // 指示燈 + 品牌條
  g.r(geo.cx + u(5), y + geo.hgt - 3, u(5), 1, ((o.frame | 0) & 1) ? 'hp_ok' : 'teal_md');
  g.r(geo.cx - bw / 2 + 2, y + geo.hgt - 3, u(9), 1, 'gray_70');
  // 出風（動畫氣流）
  const ph = (o.frame | 0) & 3;
  for (let i = 0; i < 4; i++) {
    const len = u(4) + ((i + ph) % 3) * u(3);
    g.dith(geo.cx - u(9) + i * u(5), y + geo.hgt, u(3), len, 'sky_hi', 'clear', DITHER.block25);
  }
}

function paintSpeaker(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  const bw = u(15);
  g.r(geo.cx - bw / 2, y, bw, geo.hgt + 2, 'outline');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, geo.hgt, 'wood_dark');
  g.r(geo.cx - bw / 2 + 2, y + 2, bw - 4, geo.hgt - 2, 'wood_sh');
  // 喇叭網格 + 單體
  g.dith(geo.cx - bw / 2 + 3, y + 3, bw - 6, geo.hgt - 4, 'gray_30', 'clear', DITHER.block50);
  g.dia(geo.cx, y + u(4), u(9), u(7), 'gray_15');
  g.dia(geo.cx, y + u(5), u(6), u(5), 'gray_30');
  g.r(geo.cx - bw / 2 + 2, y + geo.hgt - 3, bw - 4, 1, 'wood_hi');
  // 發光面板（點唱機感）+ 音符
  const lit = ((o.frame | 0) & 3) !== 3;
  const nx = geo.cx + u(7);
  for (let i = 0; i < 4; i++) g.r(nx, y + 2 + i * 3, 2, 2, lit ? ['neon_cyan', 'neon_pink', 'neon_yel', 'neon_grn'][i] : 'gray_30');
  const ny = y - 3 - (((o.frame | 0) & 1) ? 1 : 0);
  g.r(geo.cx + bw / 2 + 2, ny, 1, 4, 'white');
  g.r(geo.cx + bw / 2, ny + 3, 3, 2, 'white');
  g.r(geo.cx + bw / 2 + 4, ny - 1, 1, 3, 'neon_cyan');
  g.r(geo.cx + bw / 2 + 3, ny - 1, 2, 1, 'neon_cyan');
}

function paintExtinguisher(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount;
  const bw = u(11);
  const h = geo.hgt;
  // 掛架
  g.r(geo.cx - bw / 2, y, bw, 2, 'metal_sh');
  // 瓶身
  g.r(geo.cx - bw / 2, y - h, bw, h, 'outline');
  g.r(geo.cx - bw / 2 + 1, y - h + 1, bw - 2, h - 3, 'red');
  g.dith(geo.cx - bw / 2 + 2, y - h + 2, u(3), h - 5, 'red_hi', 'clear', DITHER.block12);
  g.r(geo.cx + bw / 2 - 3, y - h + 2, 1, h - 5, 'red_lo');
  // 壓力錶
  g.r(geo.cx + 1, y - h + u(3), u(4), u(4), 'gray_15');
  g.r(geo.cx + 2, y - h + u(3) + 1, u(2), u(2), ((o.frame | 0) & 2) ? 'hp_ok' : 'hp_warn');
  // 標籤 + 消防字樣
  g.r(geo.cx - bw / 2 + 1, y - u(8), bw - 2, u(4), 'white');
  g.r(geo.cx - bw / 2 + 2, y - u(7), u(3), 1, 'gray_30');
  g.r(geo.cx + 1, y - u(7), u(3), 1, 'hp_bad');
  // 噴嘴 + 軟管 + 提把
  g.r(geo.cx - 1, y - h - u(3), u(3), u(3), 'gray_15');
  g.r(geo.cx - u(4), y - h - u(5), u(6), 2, 'metal');
  g.r(geo.cx + u(2), y - h - u(2), u(5), 1, 'gray_15');
  g.r(geo.cx + u(6), y - h + u(1), 1, u(4), 'gray_15');
  g.r(geo.cx + u(4), y - h + u(4), u(3), 1, 'gray_15');
}

function paintSecurityHost(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  const bw = u(17);
  g.r(geo.cx - bw / 2, y, bw, geo.hgt + 2, 'outline');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, geo.hgt, 'gray_50');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, 1, 'gray_70');
  // 螢幕
  g.r(geo.cx - u(6), y + 2, u(13), u(4), 'gray_15');
  for (let i = 0; i < 4; i++) {
    const on = (((o.frame | 0) >> (i & 1)) & 1) === 0;
    g.r(geo.cx - u(5) + i * u(3), y + u(3), u(2), u(2), on ? ['hp_ok', 'teal_hi', 'hp_warn', 'neon_grn'][i] : 'gray_30');
  }
  // 按鍵盤
  for (let i = 0; i < 6; i++) {
    g.r(geo.cx - u(5) + (i % 3) * u(4), y + u(7) + ((i / 3) | 0) * u(3), u(3), u(2), 'gray_30');
    g.r(geo.cx - u(5) + (i % 3) * u(4), y + u(7) + ((i / 3) | 0) * u(3), u(3), 1, 'gray_70');
  }
  g.r(geo.cx - u(5), y + geo.hgt, u(11), 2, 'metal_sh');
}

function paintInfrared(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  const bw = u(13);
  g.r(geo.cx - bw / 2, y, bw, geo.hgt, 'outline');
  g.r(geo.cx - bw / 2 + 1, y + 1, bw - 2, geo.hgt - 2, 'gray_90');
  g.r(geo.cx - u(3), y + 2, u(3), u(2), 'red');
  g.r(geo.cx + u(2), y + 2, u(3), u(2), 'gray_30');
  // 紅外線光束
  g.dith(geo.cx - u(12), y + geo.hgt - 2, u(25), 1, 'red_hi', 'clear', DITHER.block50);
  g.dith(geo.cx - u(10), y + geo.hgt - 1, u(21), 1, 'red_lo', 'clear', DITHER.block12);
}

/**
 * 天花板燈：由上方垂下的燈線 + 燈罩 + 燈泡（夜晚會亮）。
 * 擺在牆邊時 mount 會再被壁掛抬升邏輯加上去，讀起來就是吊在天花板下。
 */
function paintCeilingLamp(g, geo, o) {
  const u = g.u;
  const y = geo.gy - geo.mount - geo.hgt;
  // 燈線
  g.r(geo.cx - 1, y - u(26), 2, u(26), 'gray_30');
  g.r(geo.cx - 1, y - u(26), 1, u(26), 'gray_50');
  g.dia(geo.cx, y - u(28), u(9), u(5), 'metal_sh');
  // 燈罩
  g.poly([[geo.cx - u(11), y + geo.hgt], [geo.cx + u(11), y + geo.hgt], [geo.cx + u(6), y], [geo.cx - u(6), y]], 'outline');
  g.poly([[geo.cx - u(9), y + geo.hgt - 1], [geo.cx + u(9), y + geo.hgt - 1], [geo.cx + u(5), y + 1], [geo.cx - u(5), y + 1]], 'lamp_md');
  g.poly([[geo.cx - u(7), y + geo.hgt - 2], [geo.cx + u(7), y + geo.hgt - 2], [geo.cx + u(4), y + 2], [geo.cx - u(4), y + 2]], 'lamp_hi');
  g.r(geo.cx - u(11), y + geo.hgt - 1, u(22), 1, 'wood_sh');
  // 燈泡 + 光
  const on = ((o.frame | 0) & 3) !== 3;
  g.r(geo.cx - 1, y + geo.hgt - u(5), 3, u(4), on ? 'lamp_hi' : 'gray_70');
  if (on) {
    g.dith(geo.cx - u(10), y + geo.hgt, u(20), u(8), 'lamp', 'clear', DITHER.block25);
    g.dith(geo.cx - u(7), y + geo.hgt + u(6), u(14), u(6), 'lamp_glow', 'clear', DITHER.block25);
  }
}

function paintLamp(g, geo, o) {
  const u = g.u;
  baseShadow(g, geo, 0.5);
  const y = geo.gy;
  g.dia(geo.cx, y - u(3), u(12), u(5), 'metal_sh');
  g.dia(geo.cx, y - u(2), u(8), u(3), 'metal_lo');
  g.r(geo.cx - 1, y - geo.hgt, 2, geo.hgt - u(3), 'metal_md');
  const ty = y - geo.hgt;
  // 燈罩（梯形）+ 內面
  g.poly([[geo.cx - u(8), ty + u(6)], [geo.cx + u(8), ty + u(6)], [geo.cx + u(5), ty - u(3)], [geo.cx - u(5), ty - u(3)]], 'outline');
  g.poly([[geo.cx - u(7), ty + u(5)], [geo.cx + u(7), ty + u(5)], [geo.cx + u(4), ty - u(2)], [geo.cx - u(4), ty - u(2)]], 'lamp_md');
  g.poly([[geo.cx - u(6), ty + u(4)], [geo.cx + u(6), ty + u(4)], [geo.cx + u(3), ty - u(1)], [geo.cx - u(3), ty - u(1)]], 'lamp_hi');
  g.r(geo.cx - u(7), ty + u(5), u(14), 1, 'wood_sh');
  // 燈泡 + 光芒
  const flick = ((o.frame | 0) & 3) === 3 ? 1 : 0;
  g.r(geo.cx - 1, ty + u(3), 2, 2, flick ? 'lamp_md' : 'lamp_hi');
  g.dith(geo.cx - u(9), ty + u(6), u(18), u(5) + flick, 'lamp', 'clear', DITHER.block25);
  g.dith(geo.cx - u(6), ty + u(10), u(12), u(4), 'lamp_glow', 'clear', DITHER.block25);
  g.dith(geo.cx - u(12), ty + u(8), u(24), u(3), 'lamp_hi', 'clear', DITHER.block12);
}

function paintTrashBin(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy;
  g.r(geo.cx - 6, y - geo.hgt, 13, geo.hgt, 'outline');
  g.r(geo.cx - 5, y - geo.hgt + 1, 11, geo.hgt - 2, 'metal_md');
  g.dith(geo.cx - 4, y - geo.hgt + 2, 9, geo.hgt - 4, 'metal_hi', 'clear', DITHER.block12);
  g.r(geo.cx - 7, y - geo.hgt - 2, 15, 3, 'metal_lo');
  g.r(geo.cx - 6, y - geo.hgt - 1, 13, 1, 'metal_hi');
  g.r(geo.cx - 1, y - geo.hgt - 4, 4, 2, 'gray_50');
  // 滿出來的垃圾
  g.r(geo.cx - 2, y - geo.hgt - 5, 3, 3, 'orange' in PALETTE ? 'orange' : 'shirt_org');
}

function paintHeater(g, geo, o) {
  baseShadow(g, geo, 0.8);
  const y = geo.gy;
  g.r(geo.cx - 8, y - geo.hgt, 17, geo.hgt, 'outline');
  g.r(geo.cx - 7, y - geo.hgt + 1, 15, geo.hgt - 2, 'gray_50');
  g.dith(geo.cx - 6, y - geo.hgt + 2, 13, geo.hgt - 4, 'fire', 'clear', DITHER.block50);
  g.r(geo.cx - 6, y - geo.hgt + 2, 13, 1, 'gray_70');
  g.r(geo.cx - 2, y - 3, 4, 2, 'gray_15');
}

// ── 裝潢 ──────────────────────────────────────────────────────────────────
function paintPlant(g, geo, o) {
  baseShadow(g, geo, 0.5);
  const y = geo.gy;
  g.poly([[geo.cx - 7, y], [geo.cx + 7, y], [geo.cx + 5, y - 8], [geo.cx - 5, y - 8]], 'outline');
  g.poly([[geo.cx - 6, y - 1], [geo.cx + 6, y - 1], [geo.cx + 4, y - 7], [geo.cx - 4, y - 7]], 'pot_org');
  g.r(geo.cx - 7, y - 9, 15, 2, 'pot_org');
  g.r(geo.cx - 6, y - 9, 13, 1, 'wood_hi');
  // 葉子
  const top = y - geo.hgt;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const len = 8 + (i % 3) * 3;
    const ex = geo.cx + Math.round(Math.cos(a) * 7);
    const ey = top + 8 + Math.round(Math.sin(a) * 4);
    g.line(geo.cx, y - 10, ex, ey - len / 2, i & 1 ? 'leaf' : 'leaf_lo');
    g.r(ex - 1, ey - len / 2, 3, 3, 'leaf_hi');
  }
  g.r(geo.cx - 2, top + 2, 4, geo.hgt - 10, 'leaf');
  g.r(geo.cx - 1, top + 2, 2, 3, 'leaf_hi');
}

function paintPainting(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  const w = 22;
  g.r(geo.cx - w / 2, y, w + 2, geo.hgt + 2, 'outline');
  g.r(geo.cx - w / 2 + 1, y + 1, w, geo.hgt, 'wood_dark');
  g.r(geo.cx - w / 2 + 2, y + 2, w - 2, geo.hgt - 2, 'sky_md');
  // 風景
  g.r(geo.cx - w / 2 + 2, y + 2, w - 2, 3, 'dusk_org');
  g.dith(geo.cx - w / 2 + 2, y + 2, w - 2, 4, 'neon_yel', 'clear', DITHER.block12);
  g.poly([
    [geo.cx - w / 2 + 2, y + geo.hgt], [geo.cx - 4, y + 4],
    [geo.cx + 2, y + geo.hgt],
  ], 'gray_30');
  g.poly([
    [geo.cx - 2, y + geo.hgt], [geo.cx + 5, y + 5], [geo.cx + w / 2, y + geo.hgt],
  ], 'gray_15');
  g.r(geo.cx - w / 2 + 2, y + geo.hgt - 2, w - 2, 2, 'leaf_lo');
  g.r(geo.cx + 3, y - 1, 1, 1, 'metal');
}

function paintRug(g, geo, o) {
  const cx = geo.cx;
  const gy = geo.gy;
  g.dia(cx, gy - geo.bh / 2, geo.bw - 2, geo.bh - 1, 'outline');
  g.dia(cx, gy - geo.bh / 2 + 1, geo.bw - 4, geo.bh - 3, o.rugCol || 'red_md');
  g.dia(cx, gy - geo.bh / 2 + 2, geo.bw - 10, geo.bh - 7, 'red_lo');
  g.dia(cx, gy - geo.bh / 2 + 3, geo.bw - 14, geo.bh - 9, 'lamp_md');
  g.dith(cx - geo.bw / 4, gy - 3, geo.bw / 2, 5, 'red_hi', 'clear', DITHER.block12);
  // 流蘇
  for (let i = 0; i < 5; i++) {
    g.r(cx - geo.bw / 2 + 3 + i * 5, gy + 1, 2, 1, 'lamp_lo');
    g.r(cx - geo.bw / 2 + 5 + i * 5, gy - geo.bh + 1, 2, 1, 'lamp_lo');
  }
}

function paintNeonSign(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  const acc = typeof o.accent === 'string' ? o.accent : 'neon_cyan';
  const accHi = mixHex(acc, '#ffffff', 0.42);
  const accLo = mixHex(acc, '#000000', 0.55);
  const w = 26;
  g.r(geo.cx - w / 2, y, w, geo.hgt, 'outline');
  g.r(geo.cx - w / 2 + 1, y + 1, w - 2, geo.hgt - 2, 'gray_15');
  const on = ((o.frame | 0) & 3) !== 3;
  const c1 = on ? acc : accLo;
  const c2 = on ? accHi : 'red_lo';
  g.r(geo.cx - w / 2 + 3, y + 3, w - 6, 2, c1);
  g.r(geo.cx - w / 2 + 3, y + 7, 8, 2, c2);
  g.r(geo.cx + 3, y + 7, 6, 2, 'neon_yel');
  g.dith(geo.cx - w / 2 - 3, y, w + 6, geo.hgt + 2, c1, 'clear', DITHER.block12);
  g.r(geo.cx - 1, y - 2, 2, 2, 'metal_lo');
}

function paintAquarium(g, geo, o) {
  baseShadow(g, geo, 0.8);
  const y = geo.gy;
  cuboid(g, geo.cx, y, geo.bw - 6, geo.bh - 4, 5, 'wood_hi', 'wood', 'wood_md', 'outline');
  const t = y - 4;
  g.r(geo.cx - 10, t - geo.hgt, 21, geo.hgt, 'outline');
  g.r(geo.cx - 9, t - geo.hgt + 1, 19, geo.hgt - 2, 'water');
  g.dith(geo.cx - 9, t - geo.hgt + 1, 19, geo.hgt - 2, 'water_hi', 'clear', DITHER.block25);
  // 魚
  const ph = (o.frame | 0) & 3;
  for (let i = 0; i < 3; i++) {
    const fx = geo.cx - 6 + ((i * 6 + ph * 2) % 16);
    const fy = t - geo.hgt + 3 + i * 3;
    g.r(fx, fy, 4, 2, i & 1 ? 'lamp_md' : 'red_hi');
    g.r(fx + 4, fy - 1, 2, 4, i & 1 ? 'lamp_lo' : 'red');
    g.r(fx + 1, fy, 1, 1, 'outline');
  }
  g.r(geo.cx - 9, t - geo.hgt + 1, 19, 1, 'white');
  g.dith(geo.cx - 9, t - 4, 19, 4, 'leaf_lo', 'clear', DITHER.block12);
  g.r(geo.cx - 11, t - geo.hgt - 3, 23, 3, 'wood_sh');
  g.r(geo.cx - 10, t - geo.hgt - 3, 21, 1, 'lamp_hi');
}

function paintPartition(g, geo, o) {
  baseShadow(g, geo, 0.8);
  const y = geo.gy;
  const n = 3;
  const pw = Math.max(8, Math.round(geo.bw / n) + 2);
  for (let i = 0; i < n; i++) {
    const x = geo.cx - (n * pw) / 2 + i * pw;
    g.r(x, y - geo.hgt, pw, geo.hgt, 'outline');
    g.r(x + 1, y - geo.hgt + 1, pw - 2, geo.hgt - 2, i & 1 ? 'wall_hi' : 'wall');
    g.r(x + 1, y - geo.hgt + 1, pw - 2, 1, 'wood_hi');
    g.r(x + 1, y - 6, pw - 2, 5, 'wood_md');
    g.dith(x + 2, y - geo.hgt + 4, pw - 4, geo.hgt - 12, 'lamp_hi', 'clear', DITHER.block12);
  }
}

function paintMenuBoard(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  g.r(geo.cx - 11, y, 23, geo.hgt, 'wood_dark');
  g.r(geo.cx - 10, y + 1, 21, geo.hgt - 2, 'gray_15');
  g.dith(geo.cx - 10, y + 1, 21, geo.hgt - 2, 'gray_30', 'clear', DITHER.block12);
  // 粉筆字（標題用場地強調色）
  const acc = typeof o.accent === 'string' ? o.accent : 'neon_yel';
  for (let i = 0; i < 5; i++) {
    g.r(geo.cx - 8, y + 3 + i * 3, 6 + (i % 3) * 3, 1, i === 0 ? acc : 'white');
    g.r(geo.cx + 6, y + 3 + i * 3, 3, 1, 'gray_70');
  }
  g.r(geo.cx - 1, y + geo.hgt, 2, geo.mount, 'wood_sh');
}

function paintTV(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  g.r(geo.cx - 10, y, 21, geo.hgt + 2, 'outline');
  g.r(geo.cx - 9, y + 1, 19, geo.hgt, 'gray_30');
  g.r(geo.cx - 8, y + 2, 15, geo.hgt - 3, 'window_dk');
  const ph = (o.frame | 0) & 3;
  g.dith(geo.cx - 8, y + 2, 15, 5, ph & 1 ? 'teal' : 'shirt_prp', 'clear', DITHER.block50);
  g.r(geo.cx - 6, y + 7, 10, 1, 'white');
  g.r(geo.cx + 8, y + 3, 2, 2, 'gray_70');
  g.r(geo.cx + 8, y + 6, 2, 2, 'gray_70');
  g.r(geo.cx - 4, y + geo.hgt + 2, 9, 2, 'gray_15');
}

function paintBanner(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  const base = typeof o.accent === 'string' ? mixHex(o.accent, '#c0392b', 0.35) : 'red';
  const w = Math.min(geo.bw + 4, 34);
  g.r(geo.cx - w / 2, y, w, geo.hgt, base);
  g.r(geo.cx - w / 2, y, w, 1, mixHex(base, '#ffffff', 0.35));
  g.r(geo.cx - w / 2, y + geo.hgt - 1, w, 1, mixHex(base, '#000000', 0.3));
  g.r(geo.cx - w / 2 + 3, y + 3, w - 6, 2, 'lamp_hi');
  g.r(geo.cx - w / 2 + 3, y + 7, w - 10, 2, 'lamp_hi');
  for (let i = 0; i < 4; i++) g.r(geo.cx - w / 2 + 4 + i * 3, y + geo.hgt, 1, 3, mixHex(base, '#000000', 0.35));
}

function paintClock(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  g.dia(geo.cx, y, 17, 9, 'outline');
  g.dia(geo.cx, y + 1, 15, 8, 'wall_hi');
  const hand = (o.frame | 0) & 3;
  g.r(geo.cx, y + 3, 1, 3, 'gray_15');
  g.r(geo.cx, y + 4, hand < 2 ? 3 : -3, 1, 'gray_15');
  g.r(geo.cx - 1, y + 1, 2, 1, 'gray_30');
}

function paintVase(g, geo, o) {
  baseShadow(g, geo, 0.4);
  const y = geo.gy;
  g.poly([[geo.cx - 4, y - geo.hgt], [geo.cx + 4, y - geo.hgt], [geo.cx + 6, y - 4], [geo.cx - 6, y - 4]], 'outline');
  g.poly([[geo.cx - 3, y - geo.hgt + 1], [geo.cx + 3, y - geo.hgt + 1], [geo.cx + 5, y - 5], [geo.cx - 5, y - 5]], 'teal_hi');
  g.r(geo.cx - 6, y - 5, 13, 3, 'teal_md');
  g.r(geo.cx - 6, y - 3, 13, 2, 'teal_lo');
  const top = y - geo.hgt;
  for (let i = 0; i < 3; i++) {
    g.line(geo.cx, top, geo.cx - 4 + i * 4, top - 6 - i, 'leaf_lo');
    g.r(geo.cx - 5 + i * 4, top - 8 - i, 3, 2, i === 1 ? 'neon_pink' : 'neon_yel');
  }
}

function paintCoatRack(g, geo, o) {
  baseShadow(g, geo, 0.4);
  const y = geo.gy;
  g.dia(geo.cx, y - 4, 12, 5, 'metal_sh');
  g.r(geo.cx - 1, y - geo.hgt, 2, geo.hgt - 4, 'wood_sh');
  const top = y - geo.hgt;
  g.r(geo.cx - 8, top, 17, 2, 'wood_sh');
  g.r(geo.cx - 9, top, 3, 2, 'wood_dark');
  g.r(geo.cx + 7, top, 3, 2, 'wood_dark');
  // 掛著的外套
  g.r(geo.cx - 7, top + 2, 7, 12, 'shirt_nvy');
  g.r(geo.cx - 6, top + 2, 5, 1, 'shirt_gry');
  g.r(geo.cx + 3, top + 2, 5, 9, 'teal_md');
}

function paintVending(g, geo, o) {
  baseShadow(g, geo, 0.9);
  const y = geo.gy;
  cuboid(g, geo.cx, y, geo.bw - 6, geo.bh - 4, geo.hgt, 'gray_70', 'shirt_red', 'red_md', 'outline');
  const t = y - geo.hgt;
  g.r(6, t + 3, geo.W - 12, geo.hgt - 12, 'window_dk');
  for (let i = 0; i < 6; i++) {
    g.r(8 + (i % 3) * 5, t + 5 + ((i / 3) | 0) * 5, 3, 4, ['shirt_yel', 'teal_hi', 'white', 'lamp_md', 'neon_pink', 'leaf_hi'][i]);
  }
  g.r(7, y - 10, geo.W - 14, 6, 'gray_30');
  g.r(9, y - 9, 5, 2, ((o.frame | 0) & 1) ? 'hp_ok' : 'leaf_lo');
  g.r(geo.W - 14, y - 9, 4, 4, 'gray_15');
}

function paintWaterCooler(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy;
  cuboid(g, geo.cx, y, geo.bw - 8, geo.bh - 6, 14, 'gray_90', 'gray_70', 'gray_50', 'outline');
  const t = y - 14;
  g.r(geo.cx - 5, t - 8, 11, 9, 'outline');
  g.r(geo.cx - 4, t - 7, 9, 7, 'water_hi');
  g.dith(geo.cx - 4, t - 7, 9, 7, 'water', 'clear', DITHER.block25);
  g.r(geo.cx - 2, t, 5, 3, 'gray_30');
  g.r(geo.cx - 1, t + 1, 1, 6, 'water_hi');
  g.r(geo.cx + 2, t + 1, 1, 4, 'red_hi');
}

function paintShelf(g, geo, o) {
  baseShadow(g, geo, 0.9);
  const y = geo.gy;
  const h = geo.hgt;
  const bw = geo.bw - 6;
  for (let i = 0; i < 3; i++) {
    const sy = y - 4 - i * Math.round((h - 4) / 3);
    slab(g, geo.cx, sy + 3, bw, geo.bh - 4, 2, 'wood_hi', 'wood_md', 'outline');
  }
  g.r(geo.cx - bw / 2, y - h, 2, h, 'wood_dark');
  g.r(geo.cx + bw / 2 - 2, y - h, 2, h, 'wood_sh');
  // 貨品
  for (let i = 0; i < 3; i++) {
    const sy = y - 6 - (i + 1) * Math.round((h - 4) / 3) + 2;
    for (let j = 0; j < 3; j++) {
      g.r(geo.cx - bw / 2 + 3 + j * 5, sy - 4, 4, 4, ['lamp_md', 'teal_hi', 'red_hi', 'leaf_hi', 'white', 'neon_yel'][(i * 3 + j) % 6]);
    }
  }
}

function paintSofa(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 4, geo.bh - 2, 6, 'shirt_red', 'red_md', 'red_lo', 'outline');
  const t = geo.gy - 6;
  g.r(geo.cx - geo.bw / 2 + 3, t - 6, geo.bw - 6, 7, 'red');
  g.r(geo.cx - geo.bw / 2 + 3, t - 6, geo.bw - 6, 1, 'red_hi');
  g.r(geo.cx - geo.bw / 2 + 2, t - 3, 3, 5, 'red_md');
  g.r(geo.cx + geo.bw / 2 - 5, t - 3, 3, 5, 'red_md');
  g.dith(geo.cx - geo.bw / 4, t - 5, geo.bw / 2, 4, 'red_hi', 'clear', DITHER.block12);
}

function paintPodium(g, geo, o) {
  baseShadow(g, geo, 0.8);
  cuboid(g, geo.cx, geo.gy, geo.bw - 10, geo.bh - 6, geo.hgt, 'wood_hi', 'wood', 'wood_md', 'outline');
  const t = geo.gy - geo.hgt;
  g.r(geo.cx - 5, t - 9, 11, 9, 'wall_hi');
  g.r(geo.cx - 5, t - 9, 11, 1, 'white');
  g.r(geo.cx - 4, t - 7, 9, 1, 'gray_30');
  g.r(geo.cx - 4, t - 5, 6, 1, 'gray_30');
  g.box(geo.cx - 5, t - 9, 11, 9, 'outline');
}

function paintLanternString(g, geo, o) {
  const y = geo.gy - geo.mount;
  const acc = typeof o.accent === 'string' ? o.accent : 'lantern';
  const body = mixHex(acc, '#ff8a3c', 0.45);
  const bodyHi = mixHex(acc, '#ffc06a', 0.6);
  const n = 3 + (geo.w - 1);
  for (let i = 0; i < n; i++) {
    const x = geo.cx - ((n - 1) * 9) / 2 + i * 9;
    const dy = Math.round(Math.sin(i * 1.1) * 2);
    g.line(x - 4, y - 6 + dy, x + 5, y - 6 + dy, 'outline');
    g.r(x - 3, y - 4 + dy, 7, 8, body);
    g.r(x - 2, y - 4 + dy, 5, 8, bodyHi);
    g.r(x - 3, y + 4 + dy, 7, 1, 'lantern_lo');
    g.r(x - 2, y - 6 + dy, 5, 2, 'red_lo');
    g.dith(x - 6, y + 4 + dy, 13, 5, 'lamp', 'clear', DITHER.block25);
  }
}

/** 未知 typeId 的後備形狀：灰箱 + 問號。 */
function paintFountain(g, geo, o) {
  baseShadow(g, geo, 0.95);
  const y = geo.gy;
  const bw = geo.bw - 6;
  const bh = geo.bh - 4;
  // 石造基座 + 水盤
  cuboid(g, geo.cx, y, bw, bh, 5, 'gray_90', 'gray_70', 'gray_50', 'outline');
  const t = y - 5;
  g.dia(geo.cx, t - bh / 2 - 4, bw - 2, bh - 2, 'metal_sh');
  g.dia(geo.cx, t - bh / 2 - 3, bw - 4, bh - 4, 'water');
  g.dith(geo.cx - bw / 4, t - 4, bw / 2, Math.max(2, bh / 2 - 2), 'water_hi', 'clear', DITHER.block25);
  // 中央石柱與水柱
  g.r(geo.cx - 2, t - 12, 4, 8, 'gray_70');
  g.r(geo.cx - 1, t - 12, 2, 8, 'gray_90');
  const ph = (o.frame | 0) & 3;
  g.r(geo.cx - 1, t - 16 + (ph & 1), 2, 5 - (ph & 1), 'water_hi');
  g.p(geo.cx - 3, t - 13 + ((ph + 1) & 1), 'water_hi');
  g.p(geo.cx + 2, t - 12 + ((ph + 2) & 1), 'water_hi');
  g.p(geo.cx, t - 17 + (ph & 1), 'white');
  g.dith(geo.cx - 8, t - 3, 16, 4, 'water_hi', 'clear', DITHER.block12);
}

function paintUnknown(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt, 'gray_70', 'gray_50', 'gray_30', 'outline');
  const t = geo.gy - geo.hgt;
  g.dith(geo.cx - 6, t + 2, 12, geo.hgt - 4, 'gray_90', 'clear', DITHER.block12);
  g.r(geo.cx - 1, t + 3, 3, 1, 'gray_15');
  g.r(geo.cx + 1, t + 4, 1, 2, 'gray_15');
  g.r(geo.cx, t + 6, 1, 1, 'gray_15');
  g.r(geo.cx, t + 8, 1, 1, 'gray_15');
}

/**
 * 傢俱美術表：key → {hgt 高度, mount 離地高度, dirs 是否分方向, anim 是否動畫, paint}
 */
const FURNITURE_ART = {
  // 桌（6+）：二人桌明顯小一號；桌面一律「亮桌布」或「深木桌」以和木地板拉開對比
  table_2a: { hgt: 24, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S'] }) },
  table_2b: { hgt: 24, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_cream', facings: ['N', 'S'] }) },
  table_4a: { hgt: 24, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S', 'E', 'W'] }) },
  table_4b: { hgt: 24, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_white', facings: ['N', 'S', 'E', 'W'] }) },
  // 六人宴會桌：桌椅一體繪製（pad 讓貼圖容得下桌緣外側的 6 張椅子）
  table_6a: {
    hgt: 24, takesOccupancy: true,
    paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'top_dark', facings: ['N', 'S', 'E', 'W'] }),
  },
  table_6b: {
    hgt: 24, takesOccupancy: true,
    paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_white', facings: ['N', 'S', 'E', 'W'] }),
  },
  table_long: { hgt: 24, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S', 'E', 'W'] }) },

  // 椅（3）＋沙發／長凳：三種椅子各自手繪（木椅斜削腳＋板條背、鐵管椅彎管＋繃布、
  // 沙發椅厚坐墊＋扶手），座墊顏色依 variant（座標 hash）微調，背向坐向
  chair_wood: { hgt: 26, dirs: true, seatVariants: true, paint: paintChairWood },
  chair_iron: { hgt: 32, dirs: true, seatVariants: true, paint: paintChairIron },
  chair_soft: { hgt: 30, dirs: true, seatVariants: true, paint: paintChairSoft },
  chair_stool: { hgt: 15, paint: (g, geo, o) => paintChairSimple(g, geo, { ...o, stool: true, seat: 'teal', frameCol: 'wood', frameHi: 'wood_hi' }) },
  chair_bench: { hgt: 21, paint: (g, geo, o) => paintChairSimple(g, geo, { ...o, stool: true, seat: 'wood_hi', frameCol: 'wood_md', frameHi: 'wood_hi' }) },
  sofa: { hgt: 29, paint: paintSofa },

  // 櫃台（2）＋帶位台
  counter: { hgt: 29, paint: paintCounter },
  cashier_counter: { hgt: 32, paint: (g, geo, o) => paintCounter(g, geo, { ...o, cashier: true }) },
  bar_counter: { hgt: 35, paint: (g, geo, o) => paintCounter(g, geo, { ...o, bar: true, menu: true }) },
  host_podium: { hgt: 27, paint: paintPodium },

  // 廚房（3+）
  stove: { hgt: 32, anim: true, paint: paintStove },
  prep_table: { hgt: 28, paint: paintPrepTable },
  sink: { hgt: 28, anim: true, paint: paintSink },
  fridge: { hgt: 52, anim: true, paint: paintFridge },
  freezer: { hgt: 40, paint: (g, geo, o) => paintFridge(g, geo, { ...o, freezer: true }) },
  oven: { hgt: 32, anim: true, paint: paintOven },
  hood: { hgt: 16, mount: 32, paint: paintHood },
  fryer: { hgt: 28, anim: true, paint: paintFryer },
  dishwasher: { hgt: 29, anim: true, paint: paintDishwasher },
  rice_cooker: { hgt: 20, anim: true, paint: paintRiceCooker },

  // 廁所（2+）
  toilet: { hgt: 24, dirs: true, paint: paintToilet },
  washbasin: { hgt: 28, anim: true, paint: paintWashbasin },
  urinal: { hgt: 24, mount: 16, paint: paintUrinal },
  hand_dryer: { hgt: 12, mount: 24, paint: paintDryer },
  mirror: { hgt: 20, mount: 29, paint: paintMirror },

  // 設備（8）
  cctv: { hgt: 13, mount: 32, anim: true, paint: paintCCTV },
  aircon: { hgt: 19, mount: 28, anim: true, paint: paintAircon },
  speaker: { hgt: 20, mount: 24, anim: true, paint: paintSpeaker },
  extinguisher: { hgt: 29, mount: 8, paint: paintExtinguisher },
  security_host: { hgt: 21, mount: 24, anim: true, paint: paintSecurityHost },
  infrared: { hgt: 11, mount: 28, paint: paintInfrared },
  lamp: { hgt: 52, anim: true, paint: paintLamp },
  ceiling_lamp: { hgt: 21, mount: 56, anim: true, paint: paintCeilingLamp },
  trash_bin: { hgt: 21, paint: paintTrashBin },
  heater: { hgt: 24, anim: true, paint: paintHeater },

  // 裝潢（10+）
  plant: { hgt: 35, paint: paintPlant },
  painting: { hgt: 24, mount: 28, paint: paintPainting },
  rug: { hgt: 0, paint: paintRug },
  neon_sign: { hgt: 24, mount: 29, anim: true, accent: true, paint: paintNeonSign },
  aquarium: { hgt: 29, anim: true, paint: paintAquarium },
  partition: { hgt: 40, paint: paintPartition },
  menu_board: { hgt: 40, mount: 8, accent: true, paint: paintMenuBoard },
  tv: { hgt: 24, mount: 20, anim: true, paint: paintTV },
  banner: { hgt: 24, mount: 36, accent: true, paint: paintBanner },
  clock: { hgt: 16, mount: 32, anim: true, paint: paintClock },
  vase: { hgt: 20, paint: paintVase },
  coat_rack: { hgt: 52, paint: paintCoatRack },
  vending_machine: { hgt: 52, anim: true, paint: paintVending },
  water_cooler: { hgt: 44, paint: paintWaterCooler },
  shelf: { hgt: 40, paint: paintShelf },
  lantern_string: { hgt: 28, mount: 36, accent: true, paint: paintLanternString },
  fountain: { hgt: 32, anim: true, paint: paintFountain },

  unknown: { hgt: 28, paint: paintUnknown },
};

/**
 * 傢俱美術的高度值（hgt／mount）是「以 42×21 tile 為基準」的像素數，
 * 所以解析度改變時要跟著 tile 等比放大（64/42 ≈ 1.524），
 * 否則桌子會相對地板變得扁平、壁掛裝飾會貼在牆腳。
 * 這裡在表建好之後統一套用一次，個別項目不需要各自改數字。
 */
const FURNITURE_ART_SCALE = TILE_W / 42;
for (const key of Object.keys(FURNITURE_ART)) {
  const art = FURNITURE_ART[key];
  if (Number.isFinite(art.hgt)) art.hgt = Math.round(art.hgt * FURNITURE_ART_SCALE);
  if (Number.isFinite(art.mount)) art.mount = Math.round(art.mount * FURNITURE_ART_SCALE);
  if (Number.isFinite(art.pad)) art.pad = Math.round(art.pad * FURNITURE_ART_SCALE);
}

// typeId 關鍵字 → 美術 key（順序即優先序；越特定越前面）
const ART_HINTS = [
  ['aircon', 'aircon'], ['air_con', 'aircon'], ['air_condition', 'aircon'], ['conditioner', 'aircon'],
  ['ac_unit', 'aircon'], ['acunit', 'aircon'], ['split_ac', 'aircon'],
  ['cashier', 'cashier_counter'], ['register', 'cashier_counter'],
  ['counter_bar', 'bar_counter'], ['bar_counter', 'bar_counter'], ['bar', 'bar_counter'],
  ['counter', 'counter'],
  ['host', 'host_podium'], ['podium', 'host_podium'], ['reception', 'host_podium'],
  ['stove', 'stove'], ['range', 'stove'], ['burner', 'stove'], ['oven', 'oven'], ['fryer', 'fryer'],
  ['prep', 'prep_table'], ['worktable', 'prep_table'], ['cutting', 'prep_table'], ['board', 'prep_table'],
  ['sink', 'sink'], ['fridge', 'fridge'], ['refrigerator', 'fridge'], ['freezer', 'freezer'],
  ['hood', 'hood'], ['dishwasher', 'dishwasher'], ['rice', 'rice_cooker'],
  ['toilet', 'toilet'], ['wc', 'toilet'], ['washbasin', 'washbasin'], ['basin', 'washbasin'],
  ['urinal', 'urinal'], ['dryer', 'hand_dryer'], ['mirror', 'mirror'],
  ['fountain', 'fountain'],
  ['photo_wall', 'painting'], ['photo', 'painting'],
  ['cctv', 'cctv'], ['camera', 'cctv'], ['monitor', 'cctv'], ['surveil', 'cctv'],
  ['infrared', 'infrared'], ['sensor', 'infrared'],
  ['fire_system', 'security_host'], ['sprinkler', 'security_host'],
  ['security', 'security_host'], ['alarm', 'security_host'],
  ['extinguish', 'extinguisher'], ['fire', 'extinguisher'],
  ['speaker', 'speaker'], ['stereo', 'speaker'], ['audio', 'speaker'], ['jukebox', 'speaker'],
  ['lamp', 'lamp'], ['light', 'lamp'], ['lantern', 'lantern_string'], ['chandelier', 'lamp'],
  ['trash', 'trash_bin'], ['bin', 'trash_bin'], ['garbage', 'trash_bin'],
  ['heater', 'heater'], ['warmer', 'heater'],
  ['plant', 'plant'], ['pot', 'plant'], ['flower', 'plant'],
  ['paint', 'painting'], ['picture', 'painting'], ['art', 'painting'], ['frame', 'painting'],
  ['rug', 'rug'], ['carpet', 'rug'], ['mat', 'rug'],
  ['neon', 'neon_sign'], ['sign', 'neon_sign'], ['board', 'neon_sign'], ['signage', 'neon_sign'],
  ['aquarium', 'aquarium'], ['fish', 'aquarium'], ['tank', 'aquarium'],
  ['partition', 'partition'], ['screen', 'partition'], ['divider', 'partition'],
  ['menu', 'menu_board'], ['chalk', 'menu_board'], ['blackboard', 'menu_board'],
  ['tv', 'tv'], ['television', 'tv'], ['banner', 'banner'], ['flag', 'banner'],
  ['clock', 'clock'], ['vase', 'vase'], ['coat', 'coat_rack'], ['rack', 'coat_rack'],
  ['vending', 'vending_machine'], ['water_cooler', 'water_cooler'], ['cooler', 'water_cooler'],
  ['shelf', 'shelf'], ['cabinet', 'shelf'],
  ['chair_sofa', 'chair_soft'], ['sofa', 'sofa'],
  ['bench', 'chair_bench'], ['stool', 'chair_stool'], ['chair', 'chair_wood'], ['seat', 'chair_wood'],
  ['table', 'table_4a'], ['desk', 'table_4a'],
];

/** 由 typeId 解析出美術 key；未知者依關鍵字歸類，最後退回 'unknown'。 */
export function resolveFurnitureArt(typeId, opts = {}) {
  if (typeof typeId === 'string' && FURNITURE_ART[typeId]) return typeId;
  const id = typeof typeId === 'string' ? typeId.toLowerCase() : '';
  if (id) {
    for (let i = 0; i < ART_HINTS.length; i++) {
      if (id.indexOf(ART_HINTS[i][0]) >= 0) {
        let key = ART_HINTS[i][1];
        // 桌子依 seats 猜大小
        if (key === 'table_4a' && opts && opts.seats) {
          const s = opts.seats | 0;
          key = s <= 2 ? 'table_2a' : s >= 6 ? 'table_6a' : 'table_4a';
        }
        return key;
      }
    }
  }
  return 'unknown';
}

/**
 * 畫一件傢俱。x,y 為腳印菱形中心（螢幕座標）。
 * opts: {w,h（佔用格數）, rot, frame, broken, ghost, valid, seats}
 */
/** 椅子「往桌子方向推／往外拉」的等角軸向位移向量。 */
const PULL_VEC = { N: [1, -1], S: [-1, 1], E: [1, 1], W: [-1, -1] };

export function drawFurniture(ctx, typeId, x, y, opts = {}) {
  if (!ctx) return null;
  const o = opts || {};
  const gw = clampDim(o.w);
  const gh = clampDim(o.h);
  const key = resolveFurnitureArt(typeId, o);
  const art = FURNITURE_ART[key] || FURNITURE_ART.unknown;
  // 壁掛：緊鄰牆壁的裝飾品改畫在牆面上（整張圖往上抬，中心落在牆面區域）
  const wall = typeof o.wall === 'string' && o.wall ? o.wall : null;
  const lift = wall ? Math.round(WALL_H * 0.72) : 0;
  const geo = artGeo(gw, gh, art.hgt, (art.mount || 0) + lift, art.pad || 0);
  const dir = art.dirs ? rotToDir(o.rot) : 'S';
  const frame = art.anim ? ((Number(o.frame) | 0) & 3) : 0;
  // 接觸陰影（view.fx.shadows）
  const shadows = o.shadows !== false;
  // 座墊／木紋變化：只有宣告 seatVariants 的美術吃這個鍵（0..3，僅 4 種快取）
  const variant = art.seatVariants ? (((Number(o.variant) | 0) % 4) + 4) % 4 : 0;
  // 空椅收進桌下／有人往外拉：整張貼圖沿等角軸向位移（貼圖本身可共用）
  const seatPull = Number(o.seatPull);
  let pullX = 0;
  let pullY = 0;
  if (art.dirs && Number.isFinite(seatPull) && seatPull !== 0) {
    const fv = PULL_VEC[dir] || [0, 0];
    const k = Math.max(-60, Math.min(60, seatPull)) / 100;
    pullX = Math.round(fv[0] * HALF_W * k);
    pullY = Math.round(fv[1] * HALF_H * k);
  }
  // 只有用到場地強調色的傢俱才把 accent 放進快取鍵（避免快取爆量）
  const acc = typeof o.accent === 'string' ? o.accent : null;
  const accKey = art.accent && acc ? `|${acc}` : '';
  const occKey = art.takesOccupancy ? (Number(o.occupied) | 0) : 0;
  const dishKey = art.takesOccupancy && o.dishes && o.dishes.length ? '|' + o.dishes.join('') : '';
  // 椅子：有人坐（坐墊壓痕）也要分開快取
  const seatKey2 = art.seatVariants && o.seatOccupied ? '|c1' : '';
  const cacheKey = `f|${key}|${gw}x${gh}|${dir}|${frame}|${o.broken ? 'b' : ''}|${o.rugCol || ''}${accKey}|${occKey}${dishKey}|${wall || ''}|v${variant}${seatKey2}|w${shadows ? 1 : 0}`;
  const paint = (c) => {
    const g = mkPainter(c, geo.W, false);
    g.shadows = shadows;
    art.paint(g, geo, { ...o, dir, frame, variant, shadows, seatOccupied: !!o.seatOccupied });
    if (o.broken) {
      // 損壞：紅色叉叉 + 警示
      const bx = geo.cx;
      const by = geo.gy - geo.hgt - 4;
      g.line(bx - 5, by - 5, bx + 5, by + 5, 'hp_bad');
      g.line(bx + 5, by - 5, bx - 5, by + 5, 'hp_bad');
      g.r(bx - 6, by - 8, 13, 2, 'hp_warn');
      g.r(bx - 7, by - 8, 2, 2, 'gray_15');
      g.r(bx + 5, by - 8, 2, 2, 'gray_15');
    }
  };
  const dx = Math.round(x - geo.cx) + pullX;
  const dy = Math.round(y - geo.gy) + pullY;
  let cv = cachedSprite(cacheKey, geo.W, geo.H, paint);
  if (cv && o.ghost) {
    const tint = PALETTE[o.valid === false ? 'ghost_bad' : 'ghost_ok'];
    cv = tintedCanvas(cv, tint, o.valid === false ? 0.5 : 0.4);
  }
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, geo.W, geo.H, dx, dy, paint);
  const out = o.out || {};
  out.art = key;
  out.x = dx;
  out.y = dy;
  out.w = geo.W;
  out.h = geo.H;
  out.cx = Math.round(x) + pullX;
  out.gy = Math.round(y) + pullY;
  out.dir = dir;
  out.variant = variant;
  out.pulled = pullX !== 0 || pullY !== 0;
  return out;
}

// ===========================================================================
// 6. 街景（窗外城市／夜市，依時段變色）
// ===========================================================================

export const SKYLINE_KINDS = [
  'nightmarket', 'harbor', 'office', 'nightmarket2', 'nightstreet', 'mall', 'fashion', 'plain',
];

/** 別名（data 層可能使用不同字串，例如 locations[].skyline 的 'nightstreet'）。 */
const SKYLINE_ALIAS = {
  nightstreet: 'nightmarket2',
  night_market: 'nightmarket',
  nightmarket1: 'nightmarket',
  port: 'harbor',
  harbour: 'harbor',
  cram_school: 'office',
  department: 'mall',
  department_store: 'mall',
  downtown: 'fashion',
  xinkujiang: 'fashion',
  none: 'plain',
  hills: 'plain',
};

/** 正規化街景種類（未知 → nightmarket）。 */
export function skylineKind(kind) {
  if (typeof kind === 'string' && kind) {
    const k = kind.toLowerCase();
    if (SKYLINE_ALIAS[k]) return SKYLINE_ALIAS[k];
    if (SKYLINE_KINDS.indexOf(k) >= 0) return k;
  }
  return 'nightmarket';
}

function hash1(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function skyBands(g, W, horizon, S, tod) {
  const stops = [S.top, S.mid, S.low, S.haze];
  for (let y = 0; y < horizon; y++) {
    const t = y / Math.max(1, horizon);
    const i = t < 0.36 ? 0 : t < 0.64 ? 1 : t < 0.88 ? 2 : 3;
    g.r(0, y, W, 1, stops[i]);
    if (i < 3 && y === Math.round((i + 1) * 0.3 * horizon)) g.dith(0, y - 1, W, 2, stops[i + 1], stops[i], DITHER.hline);
  }
  if (tod === 'night' || tod === 'evening') {
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(hash1(i * 3 + 11) * W);
      const y = Math.floor(hash1(i * 5 + 7) * horizon * 0.7);
      g.p(x, y, i % 7 === 0 ? 'white' : S.star || 'gray_70');
    }
  }
  // 星體
  const ox = Math.floor(W * 0.78);
  const oy = Math.max(4, Math.floor(horizon * 0.2));
  if (tod === 'night') {
    g.dia(ox, oy, 9, 9, S.orb);
    g.dia(ox + 2, oy + 1, 7, 7, S.top);
    g.dith(ox - 8, oy - 4, 24, 16, S.orb, 'clear', DITHER.sparse);
  } else {
    g.dia(ox, oy, 11, 11, S.orb);
    g.dith(ox - 8, oy - 6, 27, 22, S.orb, 'clear', DITHER.b37);
    g.line(ox - 8, oy + 5, ox + 8, oy + 5, S.haze);
  }
  // 雲（硬邊塊）
  for (let i = 0; i < 5; i++) {
    const cx = Math.floor(hash1(i * 13 + 3) * W);
    const cy = 4 + Math.floor(hash1(i * 17 + 5) * horizon * 0.45);
    const cw = 18 + Math.floor(hash1(i * 19 + 9) * 26);
    g.r(cx, cy, cw, 3, shade(S.haze, 'white', 0.35));
    g.r(cx + 3, cy - 2, cw - 10, 2, shade(S.haze, 'white', 0.5));
  }
}

function skyBuildingRow(g, W, horizon, seed, o) {
  let x = -8;
  let i = 0;
  while (x < W + 8 && i < 60) {
    const r1 = hash1(seed + i * 7);
    const r2 = hash1(seed + i * 13 + 1);
    const r3 = hash1(seed + i * 29 + 2);
    const bw = o.minW + Math.floor(r1 * (o.maxW - o.minW));
    const bh = o.minH + Math.floor(r2 * (o.maxH - o.minH));
    const topY = horizon - bh;
    g.r(x, topY, bw, bh, o.base);
    g.r(x + bw - Math.max(2, Math.round(bw * 0.22)), topY, Math.max(2, Math.round(bw * 0.22)), bh, shade(o.base, 'black', 0.28));
    g.r(x, topY, bw, 1, o.roof || shade(o.base, 'white', 0.18));
    if (r3 > 0.55 && o.tanks !== false) {
      g.r(x + 3, topY - 4, 6, 4, shade(o.base, 'black', 0.12));
      g.r(x + 5, topY - 7, 1, 3, shade(o.base, 'gray_30' === o.base ? 'black' : 'gray_30', 0.3));
    }
    if (r3 > 0.8) {
      g.r(x + bw - 6, topY - 8, 1, 8, 'gray_15');
      g.r(x + bw - 8, topY - 8, 5, 1, 'gray_15');
    }
    if (o.windows) {
      for (let wy = topY + 3; wy < horizon - 2; wy += 4) {
        for (let wx = x + 2; wx < x + bw - 3; wx += 4) {
          const lit = hash1((wx * 31 + wy * 17 + seed) | 0);
          if (lit > o.litThreshold) {
            g.r(wx, wy, 2, 2, o.windowCol);
            if (o.windowGlow) g.dith(wx - 1, wy - 1, 4, 4, o.windowCol, 'clear', DITHER.sparse);
          } else if (lit > 0.24) {
            g.r(wx, wy, 2, 2, shade(o.base, 'black', 0.45));
          }
        }
      }
    }
    // 縱向招牌
    if (o.signboards && r1 > 0.5) {
      const sx = x + bw - 5;
      const sh = Math.min(bh - 4, 24);
      const col = [o.signCol || 'red', 'teal', 'neon_pink', 'neon_org'][i % 4];
      g.r(sx, topY + 2, 5, sh, col);
      g.r(sx, topY + 2, 5, 1, shade(col, 'white', 0.4));
      for (let k = 0; k < Math.floor(sh / 4); k++) g.r(sx + 1, topY + 4 + k * 4, 3, 2, shade(col, 'white', 0.6));
    }
    x += bw + 1 + Math.floor(r2 * 3);
    i++;
  }
}

function skyGroundLayer(g, W, h, horizon, S, o) {
  // 天際線以下的屋頂層（多半被牆擋住，但近處三角形窗區會露出）
  g.r(0, horizon, W, h - horizon, shade(S.near, 'black', 0.25));
  let y = horizon + 4;
  let i = 0;
  while (y < h && i < 40) {
    const r1 = hash1(900 + i * 7);
    const bw = 20 + Math.floor(r1 * 40);
    let x = -10 + Math.floor(hash1(910 + i * 11) * 30);
    while (x < W) {
      g.r(x, y, bw, 5, i & 1 ? shade(S.near, 'black', 0.1) : shade(S.near, 'black', 0.35));
      g.r(x + 3, y + 1, 3, 1, o.lightEvery && hash1((x * 7 + y * 13) | 0) > 0.7 ? S.window : shade(S.near, 'black', 0.5));
      x += bw + 4;
    }
    y += 7;
    i++;
  }
}

function paintSkyline(c, W, H, o) {
  const g = mkPainter(c, W, false);
  const S = skyFor(o.tod);
  const kind = o.kind;
  const horizon = o.horizon;
  skyBands(g, W, horizon, S, o.tod);
  const neonOn = S.neon >= 0.5;

  if (kind === 'nightmarket' || kind === 'nightmarket2') {
    const far = kind === 'nightmarket2' ? shade(S.far, 'shirt_prp', 0.2) : S.far;
    skyBuildingRow(g, W, horizon, 17, {
      minW: 12, maxW: 30, minH: 18, maxH: 40, base: far,
      windows: true, litThreshold: 0.55, windowCol: neonOn ? S.window : shade(S.far, 'black', 0.3),
      signboards: kind === 'nightmarket2',
    });
    skyBuildingRow(g, W, horizon, 53, {
      minW: 16, maxW: 34, minH: 12, maxH: 26, base: S.mid2,
      windows: true, litThreshold: 0.45, windowCol: S.window, signboards: kind === 'nightmarket2',
      signCol: 'neon_pink',
    });
    // 夜市攤位遮雨棚
    let x = -6;
    for (let i = 0; i < 14 && x < W; i++) {
      const bw = 26 + Math.floor(hash1(i * 5 + 2) * 16);
      const col = ['red', 'teal', 'neon_org', 'shirt_yel'][i % 4];
      g.r(x, horizon - 6, bw, 6, col);
      g.r(x, horizon - 6, bw, 1, shade(col, 'white', 0.45));
      for (let k = 0; k < bw; k += 4) g.r(x + k, horizon - 5, 2, 4, shade(col, 'black', 0.3));
      g.r(x + 2, horizon - 1, 2, 2, 'wood_sh');
      g.r(x + bw - 4, horizon - 1, 2, 2, 'wood_sh');
      x += bw + 3;
    }
    // 燈籠串
    for (let i = 0; i < 12; i++) {
      const lx = 8 + i * Math.max(14, Math.floor(W / 12));
      const ly = 6 + Math.round(Math.sin(i * 0.9) * 3);
      g.r(lx - 2, ly, 5, 6, 'lantern');
      g.r(lx - 1, ly, 3, 6, 'lantern_hi');
      g.r(lx - 2, ly + 6, 5, 1, 'lantern_lo');
      g.dith(lx - 5, ly + 5, 11, 4, 'lamp', 'clear', DITHER.b25);
      g.r(lx, ly - 1, 1, 1, 'outline');
    }
  } else if (kind === 'harbor') {
    skyBands2Sea(g, W, horizon, S);
    skyBuildingRow(g, W, horizon - 10, 91, {
      minW: 14, maxW: 26, minH: 16, maxH: 34, base: S.far, windows: true,
      litThreshold: 0.6, windowCol: S.window,
    });
    // 貨櫃堆
    let x = 4;
    for (let i = 0; i < 16 && x < W - 10; i++) {
      const col = ['red', 'teal', 'shirt_blu', 'lamp_md', 'leaf_lo'][i % 5];
      const stacks = 1 + Math.floor(hash1(i * 3 + 5) * 3);
      for (let k = 0; k < stacks; k++) {
        g.r(x, horizon - 5 - k * 5, 12, 5, col);
        g.r(x, horizon - 5 - k * 5, 12, 1, shade(col, 'white', 0.35));
        g.r(x + 2, horizon - 4 - k * 5, 8, 3, shade(col, 'black', 0.25));
      }
      x += 14;
    }
    // 橋式起重機
    for (let i = 0; i < 3; i++) {
      const cx0 = 30 + i * Math.floor(W / 3.4);
      g.r(cx0, horizon - 46, 2, 46, 'lamp_md');
      g.r(cx0 - 1, horizon - 48, 4, 2, 'lamp_md');
      g.r(cx0 - 6, horizon - 40, 20, 2, 'lamp_md');
      g.line(cx0 + 14, horizon - 40, cx0 + 14, horizon - 22, 'lamp_lo');
      g.line(cx0, horizon - 38, cx0 + 13, horizon - 40, 'lamp_lo');
      g.r(cx0 + 2, horizon - 38, 1, 4, 'gray_15');
      g.r(cx0 - 2, horizon - 30, 6, 6, 'shirt_blu');
      g.r(cx0 - 1, horizon - 24, 4, 2, 'gray_15');
    }
    // 船與燈塔
    g.r(W * 0.5, horizon - 8, 46, 8, 'gray_15');
    g.r(W * 0.5 + 4, horizon - 14, 12, 6, 'gray_30');
    g.r(W * 0.5 + 24, horizon - 12, 4, 4, 'red_md');
    const lx = W - 18;
    g.r(lx, horizon - 30, 7, 30, 'gray_70');
    g.r(lx - 1, horizon - 32, 9, 3, 'red');
    g.dith(lx - 6, horizon - 34, 19, 5, 'neon_yel', 'clear', DITHER.sparse);
  } else if (kind === 'office') {
    skyBuildingRow(g, W, horizon, 131, {
      minW: 16, maxW: 32, minH: 30, maxH: 54, base: S.far, windows: true,
      litThreshold: 0.42, windowCol: S.window,
    });
    skyBuildingRow(g, W, horizon, 199, {
      minW: 12, maxW: 24, minH: 18, maxH: 34, base: S.mid2, windows: true,
      litThreshold: 0.5, windowCol: shade(S.window, 'white', 0.2), signboards: true, signCol: 'neon_cyan',
    });
    // 補習街招牌（發光方塊）
    for (let i = 0; i < 7; i++) {
      const bx = 10 + i * Math.floor(W / 7);
      const by = horizon - 26 - (i % 3) * 6;
      g.r(bx, by, 24, 9, neonOn ? 'lamp_md' : 'gray_50');
      g.r(bx, by, 24, 1, 'lamp_hi');
      g.r(bx + 2, by + 2, 20, 2, neonOn ? 'white' : 'gray_70');
      g.r(bx + 2, by + 5, 12, 2, neonOn ? 'neon_yel' : 'gray_70');
      g.dith(bx - 3, by - 3, 30, 15, 'lamp', 'clear', DITHER.sparse);
    }
    // 人行天橋
    g.r(0, horizon - 12, W, 3, 'gray_30');
    g.r(0, horizon - 13, W, 1, 'gray_50');
    for (let x = 8; x < W; x += 34) g.r(x, horizon - 9, 2, 9, 'gray_30');
  } else if (kind === 'mall') {
    skyBuildingRow(g, W, horizon, 233, {
      minW: 18, maxW: 36, minH: 22, maxH: 44, base: S.far, windows: true,
      litThreshold: 0.55, windowCol: S.window,
    });
    // 百貨公司立面
    const fx = Math.floor(W * 0.18);
    const fw = Math.floor(W * 0.6);
    g.r(fx, horizon - 40, fw, 40, 'gray_30');
    g.r(fx, horizon - 42, fw, 2, 'gray_50');
    for (let i = 0; i < 5; i++) {
      g.r(fx + 2, horizon - 37 + i * 7, fw - 4, 4, neonOn ? 'lamp_md' : 'window_dk');
      g.dith(fx + 2, horizon - 37 + i * 7, fw - 4, 4, 'lamp_hi', 'clear', DITHER.b25);
      g.r(fx + 2, horizon - 38 + i * 7, fw - 4, 1, 'gray_15');
    }
    g.r(fx + 4, horizon - 20, 10, 20, 'window_dk');
    // 大招牌
    g.r(fx + fw / 2 - 26, horizon - 52, 52, 12, neonOn ? 'neon_mag' : 'gray_50');
    g.r(fx + fw / 2 - 26, horizon - 52, 52, 1, 'neon_pink');
    g.r(fx + fw / 2 - 22, horizon - 49, 44, 3, 'white');
    g.r(fx + fw / 2 - 18, horizon - 45, 36, 3, 'neon_yel');
    g.dith(fx + fw / 2 - 32, horizon - 58, 64, 22, 'neon_pink', 'clear', DITHER.sparse);
    // 廣場與路燈
    for (let i = 0; i < 6; i++) {
      const px = 6 + i * Math.floor(W / 6);
      g.r(px, horizon - 10, 1, 10, 'gray_15');
      g.r(px - 2, horizon - 12, 5, 2, neonOn ? 'lamp_hi' : 'gray_50');
    }
  } else if (kind === 'fashion') {
    skyBuildingRow(g, W, horizon, 307, {
      minW: 14, maxW: 30, minH: 24, maxH: 46, base: shade(S.far, 'neon_mag', 0.15), windows: true,
      litThreshold: 0.4, windowCol: S.window,
    });
    // 大型看板（時尚廣告）
    for (let i = 0; i < 4; i++) {
      const bx = 12 + i * Math.floor(W / 4.2);
      const by = horizon - 40 + (i % 2) * 8;
      g.r(bx, by, 30, 20, 'gray_15');
      g.r(bx + 1, by + 1, 28, 18, ['neon_pink', 'neon_cyan', 'shirt_prp', 'lamp_md'][i]);
      g.dith(bx + 2, by + 2, 26, 16, ['shirt_pnk', 'white', 'neon_mag', 'lamp_hi'][i], 'clear', DITHER.checker);
      g.r(bx + 2, by + 16, 26, 2, 'gray_15');
      g.r(bx, by - 3, 30, 3, 'gray_30');
      g.dith(bx - 4, by - 6, 38, 30, ['neon_pink', 'neon_cyan'][i & 1], 'clear', DITHER.sparse);
    }
    // 霓虹拱門
    for (let i = 0; i < 3; i++) {
      const ax = 20 + i * Math.floor(W / 3.2);
      g.line(ax, horizon, ax + 6, horizon - 22, 'neon_cyan');
      g.line(ax + 12, horizon, ax + 6, horizon - 22, 'neon_pink');
      g.line(ax, horizon, ax + 12, horizon, 'neon_yel');
    }
    // 路樹
    for (let i = 0; i < 5; i++) {
      const tx = 10 + i * Math.floor(W / 5);
      g.r(tx, horizon - 12, 1, 12, 'wood_sh');
      g.dia(tx - 4, horizon - 22, 10, 10, 'leaf_lo');
      g.dia(tx - 3, horizon - 21, 8, 8, 'leaf');
      g.r(tx - 3, horizon - 19, 3, 2, 'leaf_hi');
    }
  } else {
    // plain：遠山 + 低矮房舍
    skyBands(g, W, horizon, S, o.tod);
    g.poly([[0, horizon], [W * 0.2, horizon - 24], [W * 0.42, horizon], [W * 0.62, horizon - 18], [W * 0.85, horizon], [W, horizon - 12], [W, horizon], [0, horizon]], shade(S.far, 'black', 0.1));
    g.dith(0, horizon - 22, W, 22, S.mid2, 'clear', DITHER.diag);
    skyBuildingRow(g, W, horizon, 401, {
      minW: 12, maxW: 22, minH: 8, maxH: 16, base: S.mid2, windows: true,
      litThreshold: 0.5, windowCol: S.window, tanks: false,
    });
  }

  skyGroundLayer(g, W, H, horizon, S, { lightEvery: true });
  // 地平線亮帶
  g.r(0, horizon - 1, W, 1, shade(S.haze, 'white', 0.3));
}

function skyBands2Sea(g, W, horizon, S) {
  // 海面（網點堆疊）
  g.r(0, horizon - 12, W, 12, shade(S.low, 'sky_md', 0.4));
  for (let y = horizon - 12; y < horizon; y += 2) {
    g.dith(0, y, W, 1, 'water_hi', 'clear', DITHER.hline);
  }
}

/**
 * 窗外街景。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind nightmarket|harbor|office|nightmarket2|mall|fashion|plain
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {string} timeOfDay morning|noon|evening|night
 * @param {object} [opts] {horizon, scroll}
 */
export function drawSkyline(ctx, kind, x, y, w, h, timeOfDay, opts = {}) {
  if (!ctx) return null;
  const k = skylineKind(kind);
  const tod = ['morning', 'noon', 'evening', 'night'].indexOf(timeOfDay) >= 0 ? timeOfDay : 'night';
  const W = Math.max(8, Math.round(w));
  const H = Math.max(8, Math.round(h));
  const horizon = Math.max(6, Math.min(H - 2, Math.round(opts.horizon == null ? H * 0.55 : opts.horizon)));
  const key = `s|${k}|${W}x${H}|${horizon}|${tod}`;
  const paint = (c) => paintSkyline(c, W, H, { kind: k, tod, horizon });
  const cv = cachedSprite(key, W, H, paint);
  if (cv) ctx.drawImage(cv, Math.round(x), Math.round(y));
  else drawUncached(ctx, W, H, Math.round(x), Math.round(y), paint);
  return { x: Math.round(x), y: Math.round(y), w: W, h: H };
}

// ===========================================================================
// 7. 天氣濾鏡
// ===========================================================================

export const WEATHER_KINDS = ['sunny', 'cloudy', 'rain', 'storm', 'cold', 'heat'];

function vignette(ctx, w, h, dark, light, maxBand) {
  // 只壓「左右緣與下緣」：天空／街景帶（上半部）永遠不受影響
  const bands = [[6, DITHER.block12], [5, DITHER.block25], [5, DITHER.block25]];
  let y = h;
  for (let i = 0; i < bands.length; i++) {
    const bh = bands[i][0];
    if (y - bh < h * 0.5) break;
    ditherPattern(ctx, 0, y - bh, w, bh, dark, light, bands[i][1]);
    y -= bh;
  }
  const cols = [[6, DITHER.block12], [5, DITHER.block25]];
  let x = 0;
  for (let i = 0; i < cols.length; i++) {
    ditherPattern(ctx, x, 0, cols[i][0], h, dark, light, cols[i][1]);
    ditherPattern(ctx, w - x - cols[i][0], 0, cols[i][0], h, dark, light, cols[i][1]);
    x += cols[i][0];
  }
  void maxBand;
}

/**
 * 晴天的窗光光柱（兩道從畫面上方斜射下來的光束）。
 * 玩家回饋覺得這兩道光會干擾閱讀店內配置，所以預設關閉；
 * 想開回來把這裡改成 true 即可（其餘晴天效果如浮塵不受影響）。
 */
export const SUN_SHAFTS = false;

/**
 * 全畫面天氣覆蓋層（畫在最上層）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} weather sunny|cloudy|rain|storm|cold|heat
 * @param {number} w @param {number} h 邏輯尺寸
 * @param {number} tick 影格計數（60fps）
 * @param {{shafts?: boolean, excludePoly?: Array<{x:number,y:number}>}} [opts]
 *        shafts     可覆寫光柱開關
 *        excludePoly 要「挖掉」的多邊形（房間剪影）：給了就用 even-odd clip 讓天氣效果
 *                    只落在店外，店內完全不受影響。沒給＝照舊全畫面（向後相容）。
 */
export function drawWeather(ctx, weather, w, h, tick, opts) {
  if (!ctx) return;
  const o = opts || {};
  const poly = Array.isArray(o.excludePoly) ? o.excludePoly : null;
  if (poly && poly.length >= 3) {
    // 外框矩形 ＋ 內挖房間多邊形（even-odd）→ 店內不畫任何天氣像素。
    // 多邊形先往外撐開 4px：房間輪廓的最外側像素剛好壓在多邊形邊界上，
    // 點在多邊形內外的判定（測試用的 ray casting）與 canvas 的 even-odd 填色
    // 在那 1px 上可能不一致，撐開後就不會再沿著輪廓留下一條天氣痕跡。
    const grown = expandPoly(poly, 4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.round(w), Math.round(h));
    ctx.moveTo(Math.round(grown[0].x), Math.round(grown[0].y));
    for (let i = 1; i < grown.length; i++) ctx.lineTo(Math.round(grown[i].x), Math.round(grown[i].y));
    ctx.closePath();
    try {
      ctx.clip('evenodd');
    } catch (e) {
      ctx.restore();
      return; // 環境不支援 even-odd clip → 寧可不畫，也不要蓋住店內
    }
    drawWeatherBody(ctx, weather, w, h, tick, o);
    ctx.restore();
    return;
  }
  drawWeatherBody(ctx, weather, w, h, tick, o);
}

/** 把多邊形沿「中心 → 頂點」方向外推 pad 像素（回傳新陣列）。 */
function expandPoly(pts, pad) {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
  cx /= pts.length;
  cy /= pts.length;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - cx;
    const dy = pts[i].y - cy;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: pts[i].x + (dx / len) * pad, y: pts[i].y + (dy / len) * pad });
  }
  return out;
}

function drawWeatherBody(ctx, weather, w, h, tick, o) {
  if (!ctx) return;
  const kind = WEATHER_KINDS.indexOf(weather) >= 0 ? weather : 'sunny';
  const W = Math.round(w);
  const H = Math.round(h);
  const t = Number(tick) || 0;
  const opts = o || {};
  if (kind === 'sunny') {
    // 光柱（預設關閉，見 SUN_SHAFTS；玩家反映會干擾閱讀店內配置）
    const shafts = (opts && opts.shafts !== undefined) ? opts.shafts : SUN_SHAFTS;
    if (shafts) {
      for (let s = 0; s < 2; s++) {
        const x0 = Math.round(W * (0.14 + s * 0.34));
        const wdt = 14 + s * 5;
        for (let y = 0; y < H * 0.78; y += 3) {
          const x = x0 + Math.round(y * 0.42);
          if (x > W) break;
          ditherPattern(ctx, x, y, Math.min(wdt, W - x), 3, 'lamp_md', 'clear', s & 1 ? DITHER.block12 : DITHER.block12);
        }
      }
    }
    // 浮塵（已移除：玩家反映光點干擾閱讀）
    return;
  }
  if (kind === 'cloudy') {
    ditherPattern(ctx, 0, 0, W, H, 'gray_30', 'clear', DITHER.block12);
    for (let i = 0; i < 3; i++) {
      const y = ((i * 62 + t * 0.12) % (H + 80)) - 40;
      ditherPattern(ctx, 0, y, W, 34, 'gray_15', 'clear', DITHER.block50);
      ctx.fillStyle = color('gray_70');
      ctx.fillRect(0, Math.round(y + 34), W, 2);
      ctx.fillRect(0, Math.round(y - 2), W, 2);
    }
    return;
  }
  if (kind === 'rain' || kind === 'storm') {
    const storm = kind === 'storm';
    // ── 1) 全畫面冷色調（雨天的低對比天光）──
    ditherPattern(ctx, 0, 0, W, H, storm ? 'outline_cool' : 'sky_lo', 'clear', storm ? DITHER.block25 : DITHER.block12);
    // ── 2) 雨絲：長度／亮度／斜率都有變化（決定性亂數；起始時間錯開＝畫面立刻佈滿雨）──
    const wind = rainWind(t, storm);
    const drops = storm ? 300 : 180;
    for (let i = 0; i < drops; i++) {
      const h1 = hash1(i * 7 + 1);
      const h2 = hash1(i * 13 + 5);
      const h3 = hash1(i * 29 + 11);
      const speed = storm ? 15 + h3 * 13 : 9 + h3 * 9;
      const len = Math.round((storm ? 14 : 8) + h3 * (storm ? 20 : 12));
      const period = H + len * 2 + 60;
      const T = t + i * 11.7;
      const x0 = h1 * (W + 220) - 110;
      const y = (((h2 * period + T * speed) % period) + period) % period - len - 20;
      const x = x0 + ((y * wind * 0.35) % 40);
      const br = h3 > 0.82 ? 2 : 1;
      ctx.fillStyle = color(storm ? (h3 > 0.5 ? 'white' : 'sky_hi') : (h3 > 0.55 ? 'sky_hi' : 'steel_hi'));
      const dx = wind * len * 1.6;
      for (let k = 0; k < len; k += 2) {
        const px = Math.round(x + dx * (k / len));
        const py = Math.round(y + k);
        ctx.fillRect(px, py, br, 2);
      }
      // 雨滴頭（略亮的一點，讓雨絲有方向感）
      if (br > 1) ctx.fillRect(Math.round(x + dx), Math.round(y + len), 2, 2);
    }
    // ── 3) 濺起的小水花（貼近地面，週期短、位置固定）──
    const splashN = storm ? 48 : 26;
    for (let i = 0; i < splashN; i++) {
      const h1 = hash1(i * 31 + 3);
      const h2 = hash1(i * 17 + 9);
      const ph = (t * (storm ? 0.11 : 0.075) + h2) % 1;
      if (ph > 0.42) continue;
      const x = h1 * W;
      const y = H * (0.34 + h2 * 0.6);
      const rr = Math.round(2 + ph * 9);
      ctx.fillStyle = color('puddle_hi');
      ctx.fillRect(Math.round(x) - rr, Math.round(y), rr * 2, 1);
      if (rr > 3) {
        ctx.fillRect(Math.round(x) - rr, Math.round(y) - 1, 1, 1);
        ctx.fillRect(Math.round(x) + rr - 1, Math.round(y) - 1, 1, 1);
      }
    }
    // ── 4) 累積的水窪（地面上的水膜；數量隨雨勢）──
    const puddles = storm ? 15 : 9;
    for (let i = 0; i < puddles; i++) {
      const h1 = hash1(i * 53 + 7);
      const h2 = hash1(i * 41 + 13);
      const x = h1 * W;
      const y = H * (0.38 + h2 * 0.56);
      const rw = Math.round((storm ? 26 : 16) + h1 * (storm ? 40 : 26));
      const rh = Math.max(4, Math.round(rw * 0.34));
      const key = `wpud|${rw}x${rh}|${storm ? 1 : 0}`;
      const cw = rw * 2 + 6;
      const chh = rh * 2 + 6;
      const cv = cachedSprite(key, cw, chh, (c) => {
        ditherEllipse(c, cw / 2, chh / 2, rw, rh, 'puddle', DITHER.b50);
        ditherEllipse(c, cw / 2, chh / 2, rw * 0.72, rh * 0.7, 'sky_lo', DITHER.b25);
        ditherEllipse(c, cw / 2, chh / 2, rw * 0.3, rh * 0.3, 'puddle_hi', DITHER.b12);
      });
      if (cv) ctx.drawImage(cv, Math.round(x - cw / 2), Math.round(y - chh / 2));
    }
    // ── 5) 雷雨：閃電 + 打在街上的補光（每 ~3 秒一次）──
    if (storm) {
      const cyc = t % 190;
      if (cyc < 12) {
        const bolt = boltGeometry(Math.floor(t / 190), W, H);
        const flash = cyc < 3 ? 'white' : cyc < 6 ? 'sky_hi' : 'sky_lo';
        ditherPattern(ctx, 0, 0, W, H, flash, 'clear', cyc < 3 ? DITHER.block50 : DITHER.block25);
        ctx.fillStyle = color('white');
        for (let i = 0; i < bolt.pts.length - 1; i++) {
          const a = bolt.pts[i];
          const b = bolt.pts[i + 1];
          const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 2));
          for (let k = 0; k <= n; k++) {
            const px = Math.round(a.x + ((b.x - a.x) * k) / n);
            const py = Math.round(a.y + ((b.y - a.y) * k) / n);
            ctx.fillRect(px, py, 2, 2);
          }
        }
        const tip = bolt.pts[bolt.pts.length - 1];
        ditherEllipse(ctx, tip.x, tip.y, 26, 12, 'sky_hi', DITHER.b37);
      }
    }
    return;
  }
  if (kind === 'cold') {
    // 寒流／下雪：冷藍暗角 ＋ 下雪時的全畫面薄雪紗 ＋ 飄雪 ＋ 地面結霜斜紋
    vignette(ctx, W, H, 'sky_lo', 'clear', 24);
    ditherPattern(ctx, 0, 0, W, H, 'white', 'clear', DITHER.block12);
    ditherPattern(ctx, 0, H * 0.55, W, H * 0.45, 'tile_hi', 'clear', DITHER.block12);
    // 飄雪：起始時間錯開（畫面從第一格就佈滿雪，而不是全部從頂端一起掉）
    const wind = 0.55 + 0.4 * Math.sin(t * 0.008);
    for (let i = 0; i < 240; i++) {
      const h1 = hash1(i * 11 + 2);
      const h2 = hash1(i * 23 + 7);
      const h3 = hash1(i * 37 + 13);
      const T = t + i * 7.31;
      const period = H + 40;
      const y = (((h2 * period + T * (1.1 + h3 * 2.2)) % period) + period) % period - 20;
      const sway = Math.sin(T * 0.02 + h3 * 6.283) * (6 + h3 * 16);
      const x = h1 * (W + 40) - 20 + sway + y * wind * 0.25;
      if (x < -6 || x > W + 6) continue;
      const big = h3 > 0.86;
      ctx.fillStyle = color(h3 > 0.7 ? 'white' : 'tile_hi');
      ctx.fillRect(Math.round(x), Math.round(y), big ? 2 : 1, big ? 2 : 1);
      if (big) ctx.fillRect(Math.round(x) + 1, Math.round(y) + 1, 1, 1);
    }
    // 結霜／積雪的斜紋帶（地面）
    for (let i = 0; i < 5; i++) {
      const x = ((i * 197 + t * 0.4) % (W + 120)) - 60;
      ditherPattern(ctx, x, H * 0.7, 60, H * 0.3, 'tile_hi', 'clear', DITHER.block25);
    }
    return;
  }
  // heat：暖色暗角 ＋ 地面熱氣帶（持續扭動）
  vignette(ctx, W, H, 'lamp_sh', 'clear', 24);
  ditherPattern(ctx, 0, 0, W, H, 'lamp_md', 'clear', DITHER.block12);
  for (let i = 0; i < 7; i++) {
    const base = H * (0.45 + i * 0.075);
    const amp = 4 + (i % 3) * 3;
    const xo = Math.sin(t * 0.03 + i) * 26;
    for (let k = 0; k < 3; k++) {
      const y = Math.round(base + Math.sin(t * 0.05 + i * 1.7 + k) * amp);
      const w = Math.round(W * (0.32 + 0.2 * ((i + k) % 3)));
      const x = Math.round(((i * 211 + k * 97 + xo) % (W + 200)) - 100);
      ditherPattern(ctx, x, y, w, 3, 'lamp_hi', 'clear', DITHER.sparse);
    }
  }
}

/** 雨的風速／斜率（storm 時風更強；隨時間正弦擺動）。 */
function rainWind(t, storm) {
  const base = storm ? 0.42 : 0.24;
  return base * (0.8 + 0.45 * Math.sin(t * 0.013) + 0.15 * Math.sin(t * 0.037));
}

/** 閃電鋸齒幾何（依 seed 決定形狀；同一道閃電在整個生命週期內不變）。 */
function boltGeometry(seed, W, H) {
  const pts = [];
  let x = W * (0.18 + hash1(seed * 13 + 1) * 0.64);
  let y = -6;
  const endY = H * (0.2 + hash1(seed * 7 + 3) * 0.3);
  const steps = 11;
  for (let i = 0; i <= steps; i++) {
    pts.push({ x, y });
    y += (endY + 6) / steps;
    x += (hash1(seed * 31 + i * 17 + 5) - 0.5) * 34;
  }
  return { pts };
}

// ===========================================================================
// 7. 燈光與氛圍（全部為硬邊網點；不使用漸層、alpha 漸變或模糊）
// ===========================================================================

/** 網點橢圓（只畫遮罩為 1 的點，其餘透明）→ 硬邊的「光暈」。 */
function ditherEllipse(ctx, cx, cy, rx, ry, colName, pattern) {
  const p = typeof pattern === 'object' && pattern.length === 4 ? pattern : DITHER[pattern] || DITHER.b50;
  const col = color(colName);
  const RY = Math.max(1, Math.round(ry));
  const RX = Math.max(1, Math.round(rx));
  let last = null;
  for (let dy = -RY; dy <= RY; dy++) {
    const t = 1 - (dy * dy) / (RY * RY + RY);
    const w = Math.round(RX * Math.sqrt(Math.max(0, t)));
    if (w <= 0) continue;
    const y = Math.round(cy) + dy;
    const row = p[((y % 4) + 4) % 4];
    const x0 = Math.round(cx - w);
    let run = 0;
    for (let k = 0; k < w * 2; k++) {
      const on = row.charCodeAt((((x0 + k) % 4) + 4) % 4) === 49;
      if (on) run++;
      else if (run) {
        if (last !== col) {
          ctx.fillStyle = col;
          last = col;
        }
        ctx.fillRect(x0 + k - run, y, run, 1);
        run = 0;
      }
    }
    if (run) {
      if (last !== col) {
        ctx.fillStyle = col;
        last = col;
      }
      ctx.fillRect(x0 + 2 * w - run, y, run, 1);
    }
  }
}

/**
 * 地板光池：三層同心 ordered dither（b12 外 / b25 中 / b50 內），**只用暖色**，
 * 沒有硬邊輪廓，木紋與地磚紋路會從網點縫隙透出來。
 * 整體在離屏 canvas 產生後以 drawImage 貼上（1 次呼叫／每個光池）。
 * @param {number} strength 0..1
 */
export function drawLightPool(ctx, cx, cy, rx, ry, strength = 1, tick = 0, opts = {}) {
  if (!ctx || strength <= 0 || rx < 3 || ry < 2) return;
  const o = opts || {};
  const flick = ((tick >> 2) + (o.seed | 0)) % 23 === 0 ? 0.65 : 1;
  const s = Math.max(0.15, Math.min(1, strength)) * flick;
  const level = s > 0.75 ? 3 : s > 0.45 ? 2 : 1; // 只有 3 種強度 → 快取很小
  const w = Math.ceil(rx * 2) + 6;
  const h = Math.ceil(ry * 2) + 6;
  const key = `pool|${Math.round(rx)}x${Math.round(ry)}|${level}`;
  const cv = cachedSprite(key, w, h, (c) => {
    const mx = w / 2;
    const my = h / 2;
    // 暖色由外而內疊三層；不用任何輪廓線
    ditherEllipse(c, mx, my, rx * 1.15, ry * 1.15, 'lamp_md', DITHER.b12);
    ditherEllipse(c, mx, my, rx * 0.82, ry * 0.82, 'light_pool', DITHER.b25);
    if (level >= 2) ditherEllipse(c, mx, my, rx * 0.5, ry * 0.5, 'light_pool_hi', DITHER.b50);
    if (level >= 3) ditherEllipse(c, mx, my, rx * 0.26, ry * 0.26, 'light_pool_hi', DITHER.solid);
  });
  const dx = Math.round(cx - w / 2);
  const dy = Math.round(cy - h / 2);
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, w, h, dx, dy, (c) => {
    ditherEllipse(c, w / 2, h / 2, rx * 1.15, ry * 1.15, 'lamp_md', DITHER.b12);
    ditherEllipse(c, w / 2, h / 2, rx * 0.82, ry * 0.82, 'light_pool', DITHER.b25);
  });
}

/** 燈泡本體 + 光暈（暖色；畫在燈具自己的位置，不做大面積白霧）。 */
export function drawGlow(ctx, cx, cy, r = 4, strength = 1, tick = 0, colName = 'light_pool_hi') {
  if (!ctx || strength <= 0) return false;
  const phase = ((tick >> 2) % 23 === 0) ? 0.7 : 1;
  const s = strength * phase;
  const w = Math.ceil(r * 5) + 4;
  const h = Math.ceil(r * 5) + 4;
  const key = `glow|${Math.round(r)}|${s > 0.75 ? 2 : 1}`;
  const cv = cachedSprite(key, w, h, (c) => {
    ditherEllipse(c, w / 2, h / 2, r * 1.6, r * 1.6, 'lamp_md', DITHER.b12);
    ditherEllipse(c, w / 2, h / 2, r * 0.9, r * 0.9, colName, DITHER.b25);
    if (s > 0.75) ditherEllipse(c, w / 2, h / 2, r * 0.45, r * 0.45, 'lamp_hi', DITHER.solid);
  });
  const dx = Math.round(cx - w / 2);
  const dy = Math.round(cy - h / 2);
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, w, h, dx, dy, (c) => ditherEllipse(c, w / 2, h / 2, r * 0.9, r * 0.9, colName, DITHER.b25));
  return true;
}

/** 霓虹溢光（夜晚由窗戶灑到地板；含 3 幀閃爍與偶發熄滅）。快取成 sprite。 */
export function drawNeonSpill(ctx, cx, cy, rx, ry, colName, strength = 1, tick = 0, seed = 0) {
  if (!ctx || strength <= 0) return;
  const phase = (tick + (seed | 0)) % 4; // 3 亮 1 暗
  if (phase === 3) return;
  const s = phase === 0 ? 2 : 1;
  const c = typeof colName === 'string' ? colName : 'neon_cyan';
  const w = Math.ceil(rx * 2) + 4;
  const h = Math.ceil(ry * 2) + 4;
  const key = `spill|${c}|${Math.round(rx)}x${Math.round(ry)}|${s}`;
  const cv = cachedSprite(key, w, h, (k) => {
    ditherEllipse(k, w / 2, h / 2, rx, ry, c, DITHER.sparse);
    if (s > 1) ditherEllipse(k, w / 2, h / 2, rx * 0.7, ry * 0.7, c, DITHER.b25);
  });
  const dx = Math.round(cx - w / 2);
  const dy = Math.round(cy - h / 2);
  if (cv) ctx.drawImage(cv, dx, dy);
}

/**
 * 廚房蒸氣：小而稀的暖灰細絲（不是白霧），只出現在出餐口正上方。
 * 全部走離屏快取 → 每個影格只有幾次 drawImage。
 */
export function drawSteam(ctx, cx, cy, tick = 0, intensity = 1, spread = 6) {
  if (!ctx || intensity <= 0) return;
  const n = Math.max(1, Math.min(3, Math.round(intensity * 3)));
  for (let i = 0; i < n; i++) {
    const period = 24 + i * 6;
    const phase = ((tick + i * 9) % period) / period;
    const key = `steam|${i}|${Math.round(phase * 5)}`;
    const w = 10 + i * 2;
    const h = 14;
    const cv = cachedSprite(key, w, h, (c) => {
      // 由下往上的細絲：稀疏暖灰網點
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const dx = Math.round(Math.sin((phase + t * 0.5) * 3.0) * 2);
        const y = Math.round(h - 2 - t * (h - 4));
        ditherEllipse(c, w / 2 + dx, y, 2 - t, 1.2, t > 0.6 ? 'gray_70' : 'steam', DITHER.sparse);
      }
    });
    const dx = Math.round(cx - w / 2 + Math.sin((phase + i) * 2.3) * spread);
    const dy = Math.round(cy - h - phase * 10);
    if (cv) ctx.drawImage(cv, dx, dy);
  }
}

/** 人物／物件的接觸陰影（橢圓網點，與傢俱同方向；快取 sprite）。 */
export function drawContactShadow(ctx, cx, cy, w = 14, h = 5) {
  if (!ctx) return;
  const cw = Math.ceil(w) + 6;
  const chh = Math.ceil(h) + 6;
  const key = `csh|${Math.round(w)}x${Math.round(h)}`;
  const cv = cachedSprite(key, cw, chh, (k) => {
    ditherEllipse(k, cw / 2 + 1, chh / 2, w * 0.5, h * 0.5, 'shadow', DITHER.b25);
    ditherEllipse(k, cw / 2 + 1, chh / 2, w * 0.34, h * 0.36, 'shadow', DITHER.b50);
  });
  if (cv) ctx.drawImage(cv, Math.round(cx - cw / 2), Math.round(cy - chh / 2));
}

// ── 店外街景道具（靜態；烤進 backdrop，每影格零成本）────────────────────────
export const STREET_PROP_KINDS = [
  'lamp', 'pole', 'scooter', 'bike', 'bin', 'manhole', 'transformer', 'pot',
  // ── 街景加強版（streetfx.js 使用；全部仍是硬邊色票的程序化美術）──
  'vending', 'vendfish', 'coffee', 'drink', 'signboard', 'bench', 'rack',
  'hydrant', 'planter', 'traffic', 'cone', 'bollard',
];

/**
 * 畫一個店外道具（底部中心對齊 x,y）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind lamp|pole|scooter|bike|bin|manhole|transformer|pot
 */
export function drawStreetProp(ctx, kind, x, y, opts = {}) {
  if (!ctx) return;
  const o = opts || {};
  const g = mkPainter(ctx, 0, false);
  const bx = Math.round(x);
  const by = Math.round(y);
  const k = STREET_PROP_KINDS.indexOf(kind) >= 0 ? kind : 'bin';
  const frame = (o.frame | 0) & 3;
  if (k === 'lamp') {
    // 路燈：桿 + 彎臂 + 燈罩；夜晚在地面留一小圈暖光
    g.r(bx - 2, by - 34, 3, 34, 'gray_30');
    g.r(bx - 2, by - 34, 1, 34, 'gray_50');
    g.r(bx - 5, by - 1, 9, 3, 'gray_15');
    g.r(bx - 5, by - 3, 9, 2, 'gray_30');
    g.r(bx + 1, by - 36, 8, 2, 'gray_30');
    g.r(bx + 7, by - 40, 2, 5, 'gray_30');
    g.poly([[bx + 3, by - 40], [bx + 14, by - 40], [bx + 12, by - 34], [bx + 5, by - 34]], 'gray_15');
    g.poly([[bx + 4, by - 39], [bx + 13, by - 39], [bx + 11, by - 35], [bx + 6, by - 35]], 'metal_hi');
    if (o.glowing) {
      g.r(bx + 7, by - 36, 4, 2, 'lamp_hi');
      ditherEllipse(ctx, bx + 9, by - 37, 7, 5, 'light_pool', DITHER.b25);
      ditherEllipse(ctx, bx + 9, by, 14, 5, 'lamp_md', DITHER.b12);
      ditherEllipse(ctx, bx + 9, by, 9, 3, 'light_pool', DITHER.b25);
    } else {
      g.r(bx + 7, by - 36, 4, 2, 'gray_70');
    }
  } else if (k === 'pole') {
    // 電線桿 + 橫擔 + 絕緣礙子
    g.r(bx - 2, by - 46, 4, 46, 'wood_sh');
    g.r(bx - 2, by - 46, 1, 46, 'wood_lo');
    g.r(bx - 7, by - 42, 14, 2, 'wood_dark');
    g.r(bx - 5, by - 38, 10, 2, 'wood_dark');
    for (let i = 0; i < 3; i++) {
      g.r(bx - 6 + i * 5, by - 45, 2, 3, 'gray_70');
      g.r(bx - 4 + i * 4, by - 41, 2, 3, 'gray_70');
    }
    g.r(bx - 3, by - 1, 6, 3, 'gray_15');
  } else if (k === 'scooter') {
    // 停放機車（側面）
    g.r(bx - 9, by - 7, 5, 5, 'gray_15');
    g.r(bx + 5, by - 7, 5, 5, 'gray_15');
    g.r(bx - 8, by - 6, 3, 3, 'metal_sh');
    g.r(bx + 6, by - 6, 3, 3, 'metal_sh');
    g.r(bx - 7, by - 14, 15, 7, o.bodyCol || 'teal_md');
    g.r(bx - 7, by - 14, 15, 1, shade(o.bodyCol || 'teal_md', 'white', 0.3));
    g.r(bx - 5, by - 11, 11, 3, shade(o.bodyCol || 'teal_md', 'black', 0.25));
    g.r(bx + 6, by - 19, 4, 6, 'gray_30'); // 龍頭
    g.r(bx + 9, by - 21, 4, 2, 'gray_15');
    g.r(bx - 9, by - 22, 5, 8, 'gray_15'); // 後箱
    g.r(bx - 8, by - 21, 3, 1, 'red_hi');
    g.r(bx - 3, by - 16, 8, 2, 'wood_dark'); // 坐墊
    g.r(bx - 7, by - 8, 18, 1, 'gray_15');
  } else if (k === 'bike') {
    // 腳踏車
    const wo = 7;
    g.ditherEllipse ? null : null;
    ditherEllipse(ctx, bx - wo, by - 5, 4, 4, 'gray_70', DITHER.b25);
    ditherEllipse(ctx, bx + wo, by - 5, 4, 4, 'gray_70', DITHER.b25);
    g.r(bx - wo - 4, by - 6, 8, 1, 'gray_30');
    g.r(bx + wo - 4, by - 6, 8, 1, 'gray_30');
    g.r(bx - 6, by - 14, 12, 1, 'gray_50');
    g.r(bx - 4, by - 14, 1, 8, 'gray_50');
    g.r(bx + 5, by - 18, 1, 8, 'gray_50');
    g.r(bx + 5, by - 19, 5, 1, 'gray_30');
    g.r(bx - 8, by - 16, 5, 2, 'wood_dark');
  } else if (k === 'bin') {
    // 路邊垃圾桶
    g.r(bx - 6, by - 12, 12, 12, 'gray_15');
    g.r(bx - 5, by - 11, 10, 10, 'gray_30');
    g.dith(bx - 4, by - 10, 8, 8, 'gray_50', 'clear', DITHER.sparse);
    g.r(bx - 7, by - 14, 14, 3, 'gray_50');
    g.r(bx - 7, by - 14, 14, 1, 'gray_70');
    g.r(bx - 3, by - 16, 6, 2, 'gray_30');
    g.r(bx - 6, by - 1, 12, 2, 'gray_15');
  } else if (k === 'manhole') {
    // 水溝蓋／人孔蓋（貼在地面）
    ditherEllipse(ctx, bx, by, 9, 5, 'metal_sh', DITHER.solid);
    ditherEllipse(ctx, bx, by, 8, 4.4, 'metal_lo', DITHER.solid);
    for (let i = 0; i < 3; i++) {
      g.r(bx - 6 + i, by - 2 + i, 12 - i * 2, 1, 'metal_hi');
      g.r(bx - 5 + i, by + 1 - i, 10 - i * 2, 1, 'metal_sh');
    }
  } else if (k === 'transformer') {
    // 變電箱
    g.r(bx - 8, by - 20, 16, 20, 'gray_15');
    g.r(bx - 7, by - 19, 14, 18, o.boxCol || 'leaf_lo');
    g.dith(bx - 6, by - 18, 12, 16, 'leaf_hi', 'clear', DITHER.sparse);
    for (let i = 0; i < 4; i++) g.r(bx - 6, by - 17 + i * 4, 12, 1, shade(o.boxCol || 'leaf_lo', 'black', 0.35));
    g.r(bx - 2, by - 16, 4, 4, 'gray_70');
    g.r(bx - 1, by - 15, 2, 2, 'hp_warn');
    g.r(bx - 8, by - 1, 16, 2, 'gray_15');
  } else if (k === 'vending' || k === 'vendfish' || k === 'coffee' || k === 'drink') {
    // 自動販賣機／飲料機（依主題換門面顏色與商品排）
    const th = o.theme || null;
    const body = (th && th.vendor) || 'red_md';
    const glass = (th && th.glass) || 'window_dk';
    const face = {
      vending: [['red', 'lamp_hi'], ['shirt_blu', 'neon_yel'], ['teal', 'white']],
      vendfish: [['teal', 'water_hi'], ['shirt_blu', 'tile_hi'], ['gray_50', 'white']],
      coffee: [['wood_dark', 'lamp_hi'], ['shirt_brn', 'lamp_md'], ['gray_30', 'cloth_cream']],
      drink: [['neon_cyan', 'white'], ['neon_pink', 'lamp_hi'], ['shirt_prp', 'neon_yel']],
    }[k];
    // 機身
    g.r(bx - 19, by - 44, 38, 44, 'outline');
    g.r(bx - 18, by - 43, 36, 42, body);
    g.r(bx - 18, by - 43, 36, 2, shade(body, 'white', 0.35));
    g.r(bx - 18, by - 3, 36, 2, shade(body, 'black', 0.4));
    // 玻璃展示窗
    g.r(bx - 15, by - 40, 30, 24, 'outline');
    g.r(bx - 14, by - 39, 28, 22, glass);
    g.dith(bx - 14, by - 39, 28, 22, 'white', 'clear', DITHER.sparse);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const cc = face[(i * 3 + j) % face.length];
        g.r(bx - 12 + j * 9, by - 36 + i * 7, 7, 5, cc[0]);
        g.r(bx - 12 + j * 9, by - 36 + i * 7, 7, 1, cc[1]);
        g.r(bx - 12 + j * 9, by - 32 + i * 7, 7, 1, shade(cc[0], 'black', 0.4));
      }
    }
    // 出貨口 + 按鈕排 + 投幣孔
    g.r(bx - 12, by - 13, 24, 6, 'gray_15');
    g.r(bx - 11, by - 12, 22, 4, 'gray_30');
    g.r(bx + 10, by - 39, 5, 18, shade(body, 'black', 0.25));
    for (let i = 0; i < 4; i++) g.r(bx + 11, by - 38 + i * 4, 3, 2, i === 1 ? 'hp_ok' : 'gray_70');
    if (o.glowing) {
      g.dith(bx - 16, by - 42, 32, 26, 'lamp_hi', 'clear', DITHER.block12);
      ditherEllipse(ctx, bx, by - 26, 22, 16, 'lamp_md', DITHER.b12);
    }
    g.r(bx - 20, by - 1, 40, 2, 'gray_15');
  } else if (k === 'signboard') {
    // 立式菜單招牌（A 字板）
    g.r(bx - 13, by - 34, 3, 34, 'wood_dark');
    g.r(bx + 10, by - 34, 3, 34, 'wood_sh');
    g.poly([[bx - 15, by - 34], [bx + 15, by - 34], [bx + 12, by - 52], [bx - 12, by - 52]], 'outline');
    g.poly([[bx - 14, by - 35], [bx + 14, by - 35], [bx + 11, by - 51], [bx - 11, by - 51]], 'wood_hi');
    // 板面：標題 + 手寫菜單線
    g.r(bx - 10, by - 49, 20, 3, 'red');
    for (let i = 0; i < 4; i++) g.r(bx - 9, by - 44 + i * 3, 18 - (i % 2) * 5, 1, 'wood_dark');
    g.r(bx - 10, by - 34, 20, 1, 'wood_sh');
    if (o.theme && o.theme.tactile) g.r(bx - 10, by - 33, 20, 1, o.theme.tactile);
  } else if (k === 'bench') {
    // 候位長椅（木條椅面 + 鐵腳）
    g.r(bx - 20, by - 2, 5, 4, 'gray_15');
    g.r(bx + 15, by - 2, 5, 4, 'gray_15');
    g.r(bx - 22, by - 12, 44, 2, 'wood_md');
    for (let i = 0; i < 4; i++) g.r(bx - 20, by - 10 + i * 2, 40, 1, i & 1 ? 'wood_hi' : 'wood');
    g.r(bx - 22, by - 8, 44, 2, 'wood_sh');
    g.r(bx - 20, by - 24, 3, 14, 'gray_30');
    g.r(bx + 17, by - 24, 3, 14, 'gray_30');
    for (let i = 0; i < 2; i++) g.r(bx - 21, by - 22 + i * 6, 42, 2, i & 1 ? 'wood_hi' : 'wood_md');
    g.dith(bx - 22, by + 1, 44, 3, 'pave_shade', 'clear', DITHER.block25);
  } else if (k === 'rack') {
    // 自行車停放架（U 形鋼管 x3）
    g.r(bx - 20, by - 1, 40, 2, 'pave_shade');
    for (let i = 0; i < 3; i++) {
      const x = bx - 14 + i * 14;
      g.r(x - 2, by - 22, 2, 22, 'metal_md');
      g.r(x + 4, by - 22, 2, 22, 'metal_sh');
      g.r(x - 2, by - 24, 8, 2, 'metal_hi');
    }
    g.r(bx - 12, by - 30, 1, 6, 'gray_50');
  } else if (k === 'hydrant') {
    // 消防栓
    g.r(bx - 5, by - 3, 10, 3, 'gray_15');
    g.r(bx - 4, by - 18, 8, 15, 'red_md');
    g.r(bx - 4, by - 18, 2, 15, 'red');
    g.r(bx - 6, by - 24, 12, 7, 'red');
    g.r(bx - 6, by - 24, 12, 2, 'red_hi');
    g.r(bx - 7, by - 13, 14, 3, 'red_lo');
    g.r(bx - 3, by - 28, 6, 4, 'red');
    g.r(bx - 2, by - 29, 4, 2, 'red_hi');
  } else if (k === 'planter') {
    // 大型花台（水泥框 + 灌木）
    g.poly([[bx - 22, by], [bx + 22, by], [bx + 18, by - 12], [bx - 18, by - 12]], 'outline');
    g.poly([[bx - 20, by - 1], [bx + 20, by - 1], [bx + 17, by - 11], [bx - 17, by - 11]], 'gray_50');
    g.poly([[bx - 16, by - 12], [bx + 16, by - 12], [bx + 14, by - 14], [bx - 14, by - 14]], 'gray_30');
    for (let i = 0; i < 7; i++) {
      const px = bx - 15 + i * 5;
      const hh = 8 + ((i * 7) % 5);
      g.r(px, by - 14 - hh, 4, hh, i & 1 ? 'leaf_lo' : 'leaf');
      g.r(px, by - 14 - hh, 4, 2, 'leaf_hi');
    }
    const mid = o.theme && o.theme.awning ? o.theme.awning[0] : 'red';
    g.r(bx - 6, by - 22, 12, 4, mid);
    g.r(bx - 4, by - 25, 8, 3, shade(mid, 'white', 0.4));
  } else if (k === 'traffic') {
    // 紅綠燈
    g.r(bx - 3, by, 6, 4, 'gray_15');
    g.r(bx - 2, by - 46, 4, 46, 'gray_30');
    g.r(bx - 2, by - 46, 1, 46, 'gray_50');
    g.r(bx - 5, by - 62, 11, 18, 'outline');
    g.r(bx - 4, by - 61, 9, 16, 'gray_15');
    const lit = ((o.seed | 0) % 3);
    g.r(bx - 3, by - 60, 7, 4, lit === 0 ? 'red' : 'red_lo');
    g.r(bx - 3, by - 55, 7, 4, lit === 1 ? 'neon_yel' : 'lamp_sh');
    g.r(bx - 3, by - 50, 7, 4, lit === 2 ? 'hp_ok' : 'leaf_lo');
    if (o.glowing) ditherEllipse(ctx, bx, by - 57, 9, 9, lit === 0 ? 'red_hi' : lit === 1 ? 'lamp_hi' : 'leaf_hi', DITHER.b12);
  } else if (k === 'cone') {
    // 三角錐
    g.poly([[bx - 8, by], [bx + 8, by], [bx + 3, by - 16], [bx - 3, by - 16]], 'outline');
    g.poly([[bx - 7, by - 1], [bx + 7, by - 1], [bx + 3, by - 15], [bx - 3, by - 15]], 'neon_org');
    g.r(bx - 5, by - 6, 10, 3, 'white');
    g.r(bx - 9, by - 2, 18, 3, 'neon_org');
    g.r(bx - 9, by - 2, 18, 1, 'lamp_hi');
  } else if (k === 'bollard') {
    // 車阻柱
    g.r(bx - 4, by - 26, 8, 26, 'gray_30');
    g.r(bx - 4, by - 26, 2, 26, 'gray_50');
    g.r(bx - 5, by - 28, 10, 3, 'gray_70');
    g.r(bx - 4, by - 18, 8, 3, 'white');
    g.r(bx - 6, by - 2, 12, 3, 'gray_15');
  } else {
    // 盆栽
    g.poly([[bx - 5, by], [bx + 5, by], [bx + 4, by - 8], [bx - 4, by - 8]], 'outline');
    g.poly([[bx - 4, by - 1], [bx + 4, by - 1], [bx + 3, by - 7], [bx - 3, by - 7]], 'pot_org');
    g.r(bx - 5, by - 9, 11, 2, 'pot_org');
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI + (i / 4) * Math.PI;
      g.line(bx, by - 9, bx + Math.round(Math.cos(a) * 6), by - 13 + Math.round(Math.sin(a) * 4), 'leaf_lo');
      g.r(bx + Math.round(Math.cos(a) * 6) - 1, by - 14 + Math.round(Math.sin(a) * 4), 3, 3, i & 1 ? 'leaf' : 'leaf_hi');
    }
    g.r(bx - 2, by - 16, 5, 4, 'leaf');
    g.r(bx - 1, by - 17, 3, 2, 'leaf_hi');
  }
  void frame;
}

/** 兩個電線桿之間的電線（1px 折線，帶一點下垂）。 */
export function drawWires(ctx, ax, ay, bx, by, sag = 6) {
  if (!ctx) return;
  const col = color('gray_15');
  ctx.fillStyle = col;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t + Math.sin(Math.PI * t) * sag);
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x, y + 3, 1, 1);
  }
}

/** 雨天水窪：窪面 + 微光 + 週期性漣漪環（決定性；快取 sprite）。 */
export function drawPuddle(ctx, cx, cy, rx, ry, tick = 0, seed = 0) {
  if (!ctx || rx < 2 || ry < 1) return;
  const rp = (tick + seed) % 16;
  const ring = rp < 8 ? 1 + ((rp / 4) | 0) : 0;
  const w = Math.ceil(rx * 2) + 8;
  const h = Math.ceil(ry * 2) + 8;
  const key = `pud|${Math.round(rx)}x${Math.round(ry)}|${ring}|${(tick + seed) % 12}`;
  const cv = cachedSprite(key, w, h, (k) => {
    ditherEllipse(k, w / 2, h / 2, rx, ry, 'puddle', DITHER.b50);
    ditherEllipse(k, w / 2, h / 2, rx * 0.8, ry * 0.8, 'sky_lo', DITHER.b25);
    const col = color('puddle_hi');
    k.fillStyle = col;
    const n = Math.max(1, Math.round(rx / 6));
    for (let i = 0; i < n; i++) {
      k.fillRect(Math.round(w / 2 - rx * 0.4 + i * 3), Math.round(h / 2 - ry * 0.2 + i * 2), Math.max(2, Math.round(rx * 0.3)), 1);
    }
    if (ring) ditherEllipse(k, w / 2, h / 2, ring * 2, ring, 'puddle_hi', DITHER.sparse);
  });
  const dx = Math.round(cx - w / 2);
  const dy = Math.round(cy - h / 2);
  if (cv) ctx.drawImage(cv, dx, dy);
}

/** 雨滴濺起的水花環（畫在地面）。 */
export function drawSplash(ctx, cx, cy, t) {
  if (!ctx) return;
  const col = color('puddle_hi');
  ctx.fillStyle = col;
  const k = (t % 3) | 0;
  ctx.fillRect(Math.round(cx) - 1 - k, Math.round(cy), 2 + k * 2, 1);
  if (k < 2) {
    ctx.fillRect(Math.round(cx) - 2 - k, Math.round(cy) - 1, 1, 1);
    ctx.fillRect(Math.round(cx) + 1 + k, Math.round(cy) - 1, 1, 1);
  }
}

/** 冷天的吐氣白煙（人物前方）。 */
export function drawBreath(ctx, cx, cy, tick = 0, seed = 0) {
  if (!ctx) return;
  const period = 18;
  const t = ((tick + seed) % period) / period;
  if (t > 0.6) return;
  const y = cy - Math.round(t * 8);
  const x = cx + 2 + Math.round(t * 6);
  ditherEllipse(ctx, x, y, 2 + t * 3, 1.5 + t * 2, 'white', DITHER.sparse);
}

// ===========================================================================
// 7c. 廚房內部固定道具（玩家沒買設備時，廚房也要像廚房）
// ===========================================================================

export const KITCHEN_PROP_KINDS = ['stove_run', 'hood', 'rack', 'sink_counter', 'fridge', 'plate_stack', 'menu_board', 'prep'];

const PROP_SIZE = {
  stove_run: [78, 62], hood: [66, 52], rack: [58, 42], sink_counter: [50, 42],
  fridge: [38, 54], plate_stack: [42, 28], menu_board: [40, 42], prep: [46, 34],
};

/**
 * 畫一個廚房固定道具（底部中心對齊 x,y）。整張道具快取成 sprite（1 次 drawImage）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind stove_run|hood|rack|sink_counter|fridge|plate_stack|menu_board|prep
 */
export function drawKitchenProp(ctx, kind, x, y, opts = {}) {
  if (!ctx) return;
  const o = opts || {};
  const k = KITCHEN_PROP_KINDS.indexOf(kind) >= 0 ? kind : 'prep';
  const fr = (o.frame | 0) & 3;
  const sz = PROP_SIZE[k] || PROP_SIZE.prep;
  const w = sz[0];
  const h = sz[1];
  const key = `kp|${k}|${fr}|${o.cooking ? 1 : 0}`;
  const cv = cachedSprite(key, w, h, (c) => {
    const g = mkPainter(c, w, false);
    const bx = w / 2;
    const by = h - 2;
    paintKitchenPropBody(g, k, bx, by, o, fr);
  });
  const dx = Math.round(x - w / 2);
  const dy = Math.round(y - (h - 2));
  if (cv) ctx.drawImage(cv, dx, dy);
  else drawUncached(ctx, w, h, dx, dy, (c) => {
    const g = mkPainter(c, w, false);
    paintKitchenPropBody(g, k, w / 2, h - 2, o, fr);
  });
}

function paintKitchenPropBody(g, k, bx, by, o, fr) {
  const u = (v) => Math.round(v * 1.5);
  if (k === 'stove_run') {
    // 不鏽鋼爐台：檯面 + 兩個爐口 + 鍋子 + 火焰
    g.r(bx - u(22), by - u(15), u(44), u(15), 'outline');
    g.r(bx - u(21), by - u(14), u(42), u(13), 'metal');
    g.r(bx - u(21), by - u(14), u(42), u(2), 'metal_hi');
    g.r(bx - u(21), by - u(6), u(42), u(1), 'metal_sh');
    for (let i = 0; i < 2; i++) {
      const cx2 = bx - u(11) + i * u(22);
      g.dia(cx2, by - u(17), u(14), u(8), 'metal_hi');
      g.dia(cx2, by - u(16), u(11), u(6), 'metal_sh');
      // 鍋子
      g.r(cx2 - u(5), by - u(26), u(10), u(9), 'outline');
      g.r(cx2 - u(4), by - u(25), u(8), u(7), 'metal_lo');
      g.r(cx2 - u(4), by - u(25), u(8), u(1), 'metal_hi');
      g.r(cx2 + u(5), by - u(24), u(4), u(2), 'metal_sh');
      if (o.cooking) {
        g.dith(cx2 - u(4), by - u(24), u(8), u(3), 'fire', 'clear', fr & 1 ? DITHER.block50 : DITHER.block25);
        g.r(cx2 - 1, by - u(24), 2, 2, 'fire_hi');
        g.dith(cx2 - u(3), by - u(30) - fr, u(6), u(4), 'steam', 'clear', DITHER.block12);
      }
    }
    // 抽屜與把手
    for (let i = 0; i < 3; i++) g.r(bx - u(20) + i * u(14), by - u(5), u(12), u(4), 'metal_md');
    for (let i = 0; i < 3; i++) g.r(bx - u(17) + i * u(14), by - u(4), u(6), 1, 'gray_90');
  } else if (k === 'hood') {
    // 抽油煙機罩
    g.poly([[bx - u(26), by], [bx + u(26), by], [bx + u(16), by - u(16)], [bx - u(16), by - u(16)]], 'outline');
    g.poly([[bx - u(24), by - 2], [bx + u(24), by - 2], [bx + u(14), by - u(15)], [bx - u(14), by - u(15)]], 'metal_hi');
    g.poly([[bx - u(20), by - 3], [bx + u(20), by - 3], [bx + u(12), by - u(14)], [bx - u(12), by - u(14)]], 'metal');
    g.r(bx - u(6), by - u(30), u(12), u(15), 'metal_md');
    g.r(bx - u(5), by - u(29), u(10), u(13), 'metal_sh');
    g.dith(bx - u(22), by - 1, u(44), u(2), 'gray_70', 'clear', DITHER.block12);
  } else if (k === 'rack') {
    // 掛桿 + 鍋具／刀具
    g.r(bx - u(20), by - u(22), u(40), 2, 'metal_sh');
    const pans = ['metal_lo', 'wood_dark', 'metal_md', 'wood_sh'];
    for (let i = 0; i < 4; i++) {
      const px = bx - u(15) + i * u(10);
      g.r(px, by - u(20), 1, u(4), 'metal_sh');
      g.dia(px - u(4), by - u(16), u(9), u(7), 'outline');
      g.dia(px - u(4), by - u(15), u(7), u(5), pans[i]);
      g.r(px + u(5), by - u(14), u(4), 1, 'metal_sh');
    }
    g.r(bx - u(20), by - u(8), u(12), u(3), 'gray_30');
    for (let i = 0; i < 3; i++) g.r(bx - u(19) + i * u(4), by - u(7), 2, u(5), 'metal_hi');
  } else if (k === 'sink_counter') {
    // 流理台 + 水槽 + 水龍頭
    g.r(bx - u(18), by - u(16), u(36), u(16), 'outline');
    g.r(bx - u(17), by - u(15), u(34), u(14), 'metal');
    g.r(bx - u(17), by - u(15), u(34), u(2), 'metal_hi');
    g.dia(bx - u(4), by - u(14), u(18), u(8), 'outline');
    g.dia(bx - u(4), by - u(13), u(15), u(6), 'metal_sh');
    g.dith(bx - u(9), by - u(12), u(11), u(4), 'water', 'clear', DITHER.block25);
    g.r(bx + u(2), by - u(24), 3, u(9), 'metal_hi');
    g.r(bx + u(2), by - u(26), u(8), 3, 'metal_hi');
    g.r(bx + u(9), by - u(25), 1, u(3), 'water_hi');
    g.r(bx - u(16), by - u(4), u(32), u(4), 'metal_md');
    for (let i = 0; i < 2; i++) g.r(bx - u(13) + i * u(16), by - u(3), u(8), 1, 'gray_90');
  } else if (k === 'fridge') {
    // 冰箱（不鏽鋼雙門）
    g.r(bx - u(13), by - u(40), u(26), u(40), 'outline');
    g.r(bx - u(12), by - u(39), u(24), u(38), 'metal_hi');
    g.r(bx - u(12), by - u(39), u(24), 1, 'white');
    g.r(bx - u(12), by - u(26), u(24), 1, 'metal_sh');
    g.r(bx + u(8), by - u(37), 2, u(9), 'gray_90');
    g.r(bx + u(8), by - u(24), 2, u(10), 'gray_90');
    g.r(bx - u(9), by - u(34), u(6), u(6), 'white');
    g.r(bx - u(8), by - u(33), u(4), 1, 'gray_30');
    g.r(bx - u(4), by - u(20), u(5), u(5), 'neon_yel');
    g.r(bx - u(12), by - u(2), u(24), 2, 'metal_sh');
  } else if (k === 'plate_stack') {
    // 出餐口旁堆疊的盤子
    for (let i = 0; i < 5; i++) {
      g.dia(bx, by - u(2) - i * 3, u(14) - i, u(7), 'outline');
      g.dia(bx, by - 1 - i * 3, u(12) - i, u(5), i & 1 ? 'gray_90' : 'tile_hi');
    }
    g.dia(bx + u(10), by - u(2), u(10), u(5), 'outline');
    g.dia(bx + u(10), by - 1, u(8), u(3), 'gray_70');
  } else if (k === 'menu_board') {
    // 牆上菜單牌
    g.r(bx - u(14), by - u(24), u(28), u(20), 'wood_dark');
    g.r(bx - u(13), by - u(23), u(26), u(18), 'gray_15');
    g.dith(bx - u(13), by - u(23), u(26), u(18), 'gray_30', 'clear', DITHER.block12);
    for (let i = 0; i < 5; i++) {
      g.r(bx - u(11), by - u(21) + i * u(3), u(12) + (i % 3) * u(3), 1, i === 0 ? 'neon_yel' : 'white');
      g.r(bx + u(6), by - u(21) + i * u(3), u(4), 1, 'gray_70');
    }
    g.r(bx - u(14), by - u(4), u(28), 2, 'wood_sh');
  } else {
    // prep：工作檯 + 砧板 + 刀具
    g.r(bx - u(16), by - u(14), u(32), u(14), 'outline');
    g.r(bx - u(15), by - u(13), u(30), u(12), 'metal');
    g.r(bx - u(15), by - u(13), u(30), 2, 'metal_hi');
    g.r(bx - u(10), by - u(15), u(14), 2, 'wood_hi');
    g.r(bx - u(10), by - u(15), u(14), 1, 'wood');
    g.r(bx + u(6), by - u(17), u(8), 2, 'metal_hi');
    g.r(bx + u(13), by - u(17), u(3), 1, 'wood_dark');
    g.r(bx - u(6), by - u(4), u(12), u(4), 'metal_md');
  }
}

/**
 * 牆腳環境光遮蔽覆蓋片：整格淡淡壓暗 ＋ 貼牆那幾排較密的暗帶（快取成 sprite，1 次 drawImage）。
 * 全部只用 `shadow` 一種墨色（不留淺色內線）→ fx.ao = false 時是「完全沒有痕跡」。
 * 密度：整格 b50、貼牆側 3 排實色暗邊 ＋ 1 排 b75；玩家反映細點太雜，但壓暗幅度必須足夠
 * （貼牆地板格要暗 ≥ 5），所以用較深的墨色 `shadow_deep` ＋ 保持這個密度而不是降到 b12。
 * @param {number} edges bit0=N bit1=W bit2=S bit3=E
 */
export function drawAOOverlay(ctx, cx, cy, edges) {
  if (!ctx || !edges) return;
  const AO_INK = 'shadow_deep';
  const w = TILE_W + 2;
  const h = TILE_H + 2;
  const key = `ao|${edges & 15}`;
  const cv = cachedSprite(key, w, h, (c) => {
    const g = mkPainter(c, w, false);
    const mx = w / 2;
    const my = h / 2;
    g.diaMask(mx, 1, TILE_W - 2, TILE_H - 2, AO_INK, DITHER.block50);
    // 貼牆那一側：整條邊往內側連畫 4 排實色暗線（第 4 排減半密度做漸層），
    // 這是 AO 的主要壓暗來源 —— 實色暗線比堆細網點乾淨，也保證貼牆格暗 ≥ 5。
    const band = (x0, y0, x1, y1, toward) => {
      for (let i = 0; i < 4; i++) {
        // 往格子內側縮 5px 起畫：牆面貼圖會蓋掉最外側約 6px，畫在那裡等於白畫
        const off = toward * (i + 5);
        if (i < 3) {
          g.line(x0, y0 + off, x1, y1 + off, AO_INK);
        } else {
          // 最內側一排用 b50 斷點收尾（避免暗帶邊緣太硬）
          const steps = Math.max(2, Math.round(Math.abs(x1 - x0) / 2));
          for (let k = 0; k < steps; k += 2) {
            const t = k / steps;
            const nx = Math.round(x0 + (x1 - x0) * t);
            const ny = Math.round(y0 + (y1 - y0) * t);
            g.p(nx, ny + off, AO_INK);
          }
        }
      }
    };
    if (edges & 1) band(mx - TILE_W / 2, my, mx, my - TILE_H / 2, 1);
    if (edges & 2) band(mx, my - TILE_H / 2, mx + TILE_W / 2, my, 1);
    if (edges & 4) band(mx - TILE_W / 2, my, mx, my + TILE_H / 2, -1);
    if (edges & 8) band(mx, my + TILE_H / 2, mx + TILE_W / 2, my, -1);
  });
  if (cv) ctx.drawImage(cv, Math.round(cx - w / 2), Math.round(cy - h / 2));
}

// ===========================================================================
// 8. 通用 sprite 派送 + 名稱表
// ===========================================================================

const BUBBLE_NAMES = ['love', 'anger', 'rage', 'wait', 'money', 'sad', 'happy', 'question',
  'star', 'dirty', 'cold', 'hot', 'hungry', 'zzz', 'call', 'tip'];

/**
 * 依名稱畫 sprite（給 UI／預覽用）。opts 同 drawPerson/drawFurniture。
 * name 可為：傢俱 art key、'tile_xxx'、'bubble_xxx'、'person'、'skyline_xxx'、'weather_xxx'。
 */
export function drawSprite(ctx, name, x, y, opts = {}) {
  if (!ctx || typeof name !== 'string') return null;
  const o = opts || {};
  if (name.indexOf('bubble_') === 0) return drawBubble(ctx, name.slice(7), x, y, o.frame);
  if (name.indexOf('tile_') === 0) return drawTile(ctx, name.slice(5), x, y, o);
  if (name === 'person') return drawPerson(ctx, o.appearance || {}, x, y, o);
  if (name.indexOf('person_') === 0) {
    const pose = name.slice(7);
    return drawPerson(ctx, o.appearance || {}, x, y, Object.assign({}, o, { pose: POSES.indexOf(pose) >= 0 ? pose : 'walk' }));
  }
  if (name.indexOf('skyline_') === 0) {
    return drawSkyline(ctx, name.slice(8), x - 40, y - 30, o.w || 80, o.h || 60, o.timeOfDay || 'night', o);
  }
  if (name.indexOf('weather_') === 0) return null;
  if (FURNITURE_ART[name]) return drawFurniture(ctx, name, x, y, o);
  if (TILE_KEYS.indexOf(name) >= 0) return drawTile(ctx, name, x, y, o);
  return drawFurniture(ctx, name, x, y, o);
}

/** 所有可繪製 sprite 名稱（傢俱美術 + tile + 氣泡 + 人物姿勢 + 街景 + 天氣）。 */
export const SPRITE_NAMES = [
  ...Object.keys(FURNITURE_ART),
  ...TILE_KEYS.filter((t) => t !== 'void').map((t) => 'tile_' + t),
  ...TILE_KEYS,
  ...BUBBLE_NAMES.map((b) => 'bubble_' + b),
  ...BUBBLE_NAMES,
  'person',
  ...POSES.map((p) => 'person_' + p),
  ...SKYLINE_KINDS.map((k) => 'skyline_' + k),
  ...WEATHER_KINDS.map((k) => 'weather_' + k),
  'light_pool',
  'contact_shadow',
  'steam',
  'puddle',
];

/** 傢俱美術 key 一覽（供裝潢面板圖示用）。 */
export const FURNITURE_ART_KEYS = Object.keys(FURNITURE_ART);

export function drawShadow(ctx, cx, cy, w, h) {
  if (!ctx) return;
  ditherRect(ctx, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h), 'shadow', 'clear', DITHER.block50);
}
