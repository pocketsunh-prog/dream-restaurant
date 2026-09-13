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

export const WALL_H = 33; // 主要牆面高度（px；＝舊版 22 的 1.5 倍）
export const NEAR_WALL_H = 14; // 近端（南／東）矮牆，避免遮住客人
/** 舊版 28×14 tile 的細節尺寸 → 新版 42×21 的整數換算（1.5 倍後四捨五入）。 */
export const ART_SCALE = TILE_W / 28;
export const PERSON_W = 24;
export const PERSON_H = 36;
export const PERSON_ANCHOR = PERSON_H; // 角色貼圖對齊：底邊 = 腳底

/** 舊版人物尺寸（16×24）→ 新版 24×36 的等比參考，供舊程式碼／文件對照。 */
export const PERSON_SCALE = PERSON_W / 16;

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
      const p = typeof pattern === 'object' && pattern.length === 4 ? pattern : DITHER[pattern] || DITHER.b50;
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
    /** 舊版像素尺寸 → 新版（28×14 → 42×21，1.5 倍四捨五入）。 */
    u(v) {
      return Math.round(v * ART_SCALE);
    },
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
function paintPerson(c, o) {
  const g = mkPainter(c, PERSON_W, o.flip);
  const dir = o.dir;
  const pose = o.pose || (o.seated ? 'seated' : 'walk');
  const seated = pose === 'seated' || pose === 'eat';
  const walk = pose === 'walk';
  const wf = walk ? (o.frame & 3) : 0;
  const bob = walk && (wf === 1 || wf === 3) ? -1 : 0;
  const breathe = pose === 'idle' && (o.frame & 1) ? -1 : 0;
  const off = seated ? 7 : 0; // 坐姿整體下移
  const OL = 'furn_outline';

  const sk = o.skin;
  const skHi = shade(sk, 'white', 0.34);
  const skLo = shade(sk, 'skin_sh', 0.5);
  const ha = o.hair;
  const haHi = shade(ha, 'white', 0.24);
  const haLo = shade(ha, 'black', 0.32);
  let sh = o.uniform === 'chef' ? 'shirt_wht' : o.shirt;
  const shHi = shade(sh, 'white', 0.28);
  const shLo = shade(sh, 'black', 0.3);
  const pt = o.pants;
  const ptLo = shade(pt, 'black', 0.32);
  const so = o.shoe;
  const style = o.style;
  const kind = o.kind;
  const apron = o.uniform === 'waiter' ? 'teal_lo' : null;

  // 基準線（未坐下時）
  const footRow = 33; // 鞋子底部結束列
  const hipRow = 24;
  const shoulderRow = 13;
  const neckRow = 12;
  const faceTop = 7;
  const headTop = 3;

  // ── 影子（硬邊網點橢圓；與傢俱同方向、往右下偏 1px）────────────────
  if (!seated) {
    g.ell(11, 34, 7, 2, 'shadow');
    g.ell(12, 34, 5, 1, 'shadow');
  }

  // ── 腿／鞋 ───────────────────────────────────────────────────────────
  const legSwing = walk ? [0, 1, 0, -1][wf] : 0;
  if (!seated) {
    const lx = 8 + (walk ? (wf === 0 ? -1 : wf === 2 ? 1 : 0) : 0) + bob * 0;
    const rx = 13 + (walk ? (wf === 0 ? 1 : wf === 2 ? -1 : 0) : 0);
    const lLeg = 5 + (walk && wf === 1 ? -2 : walk && wf === 3 ? -3 : 0);
    const rLeg = 5 + (walk && wf === 3 ? -2 : walk && wf === 1 ? -3 : 0);
    g.r(lx, hipRow + 1 + bob, 3, lLeg + bob, pt);
    g.r(rx, hipRow + 1 + bob, 3, rLeg + bob, pt);
    g.r(lx, hipRow + 1 + bob, 1, lLeg + bob, ptLo);
    g.r(rx, hipRow + 1 + bob, 1, rLeg + bob, ptLo);
    // 鞋
    g.r(lx - 1, footRow - 1 + bob + (walk ? (wf === 1 ? -1 : 0) : 0), 5, 3, OL);
    g.r(rx - 1, footRow - 1 + bob + (walk ? (wf === 3 ? -1 : 0) : 0), 5, 3, OL);
    g.r(lx, footRow + bob, 4, 2, so);
    g.r(rx, footRow + bob, 4, 2, so);
    g.r(lx, footRow + 1 + bob, 4, 1, shade(so, 'black', 0.4));
    g.r(rx, footRow + 1 + bob, 4, 1, shade(so, 'black', 0.4));
  } else {
    // 坐姿：大腿往前，看不到小腿
    g.r(5, hipRow - 1 + off, 14, 4, pt);
    g.r(5, hipRow - 1 + off, 14, 1, shade(pt, 'white', 0.15));
    g.r(5, hipRow + 2 + off, 14, 1, ptLo);
    g.r(18, hipRow + off, 3, 3, so);
  }

  // ── 腰帶 ─────────────────────────────────────────────────────────────
  g.r(7, hipRow - 2 + off + bob, 10, 1, shade(pt, 'black', 0.5));

  // ── 軀幹 ─────────────────────────────────────────────────────────────
  const torsoTop = shoulderRow + bob + off + breathe;
  const torsoBot = hipRow - 2 + off + bob;
  const torH = torsoBot - torsoTop;
  g.r(7, torsoTop, 10, torH, sh);
  g.r(6, torsoTop + 1, 12, torH - 2, sh);
  g.r(7, torsoTop, 10, 1, mixHex(sh, '#ffffff', 0.45)); // 肩線高光（讓人物從地板跳出來）
  g.r(7, torsoTop, 1, torH, shLo);
  g.r(16, torsoTop, 1, torH, shLo);
  g.r(11, torsoTop, 1, torH, mixHex(shHi, '#ffffff', 0.3)); // 門襟
  // 上方光源的雙色調網點（把人物從地板色調中拉出來）
  g.dith(7, torsoTop + 1, 10, Math.max(1, torH - 2), mixHex(sh, '#ffffff', 0.5), 'clear', DITHER.b25);
  // 領口
  g.r(9, torsoTop, 6, 1, shLo);
  g.r(10, torsoTop + 1, 4, 1, skLo);
  if (o.uniform === 'chef') {
    // 雙排扣廚師服
    g.r(9, torsoTop + 2, 6, torH - 3, 'shirt_wht');
    for (let i = 0; i < 3; i++) {
      g.p(10, torsoTop + 3 + i * 3, 'gray_30');
      g.p(14, torsoTop + 3 + i * 3, 'gray_30');
    }
    g.r(9, torsoTop, 6, 1, 'gray_70');
  } else if (apron) {
    // 服務生圍裙 + 領結
    g.r(8, torsoTop + 3, 8, torH - 3, apron);
    g.r(8, torsoTop + 3, 1, torH - 3, shade(apron, 'black', 0.35));
    g.r(10, torsoTop + 1, 4, 1, 'red_md');
    g.p(11, torsoTop + 2, 'red_hi');
  } else if (kind === 'office' || kind === 'vip' || kind === 'critic') {
    // 西裝外套 + 領帶
    g.r(7, torsoTop + 2, 3, torH - 2, shade(sh, 'black', 0.35));
    g.r(14, torsoTop + 2, 3, torH - 2, shade(sh, 'black', 0.35));
    g.r(11, torsoTop + 1, 2, 4, kind === 'vip' ? 'red_md' : 'shirt_nvy');
    if (kind === 'vip') g.r(14, torsoTop + 3, 2, 1, 'lamp_md'); // 口袋巾
  } else if (kind === 'family') {
    g.r(8, torsoTop + 4, 8, 2, shade(sh, 'black', 0.2));
  } else if (kind === 'tourist') {
    g.r(6, torsoTop + 2, 2, torH - 4, 'shirt_org'); // 相機背帶
    g.r(16, torsoTop + 2, 2, torH - 4, 'shirt_org');
  }

  // ── 手臂 ─────────────────────────────────────────────────────────────
  const armCol = o.uniform === 'chef' ? 'shirt_wht' : o.uniform === 'waiter' ? 'shirt_wht' : sh;
  const swing = walk ? [1, 0, -1, 0][wf] : 0;
  if (pose === 'carry') {
    // 端盤：托盤擺在胸前，盤子＋杯子看得出來，雙手扶著托盤兩側
    const ty = torsoTop + 8;
    g.r(4, torsoTop + 3, 3, 5, armCol); // 左前臂
    g.r(17, torsoTop + 3, 3, 5, armCol); // 右前臂
    g.r(3, torsoTop + 2, 1, 6, shLo);
    g.r(20, torsoTop + 2, 1, 6, shLo);
    // 托盤（金屬薄盤，不是木板）
    g.r(6, ty, 12, 1, OL);
    g.r(7, ty - 1, 10, 1, 'metal');
    g.r(8, ty - 2, 8, 1, 'metal_hi');
    // 盤子
    g.dia(10, ty - 6, 8, 4, OL);
    g.dia(10, ty - 5, 6, 2, 'gray_90');
    g.r(9, ty - 5, 4, 1, 'white');
    // 杯子
    g.r(14, ty - 6, 3, 4, OL);
    g.r(14, ty - 5, 2, 3, 'shirt_wht');
    g.r(14, ty - 5, 2, 1, 'white');
    // 雙手（扶著托盤兩側）
    g.r(5, ty - 1, 3, 3, sk);
    g.r(16, ty - 1, 3, 3, sk);
    g.r(5, ty + 1, 3, 1, OL);
    g.r(16, ty + 1, 3, 1, OL);
  } else if (pose === 'angry') {
    // 生氣：雙臂向兩側張開、握拳在腰側胸前高度（絕不舉過頭）
    g.r(2, torsoTop + 3, 4, 7, armCol);
    g.r(18, torsoTop + 3, 4, 7, armCol);
    g.r(1, torsoTop + 9, 4, 4, sk); // 左手拳
    g.r(19, torsoTop + 9, 4, 4, sk); // 右手拳
    g.r(1, torsoTop + 12, 4, 1, OL);
    g.r(19, torsoTop + 12, 4, 1, OL);
    g.r(2, torsoTop + 2, 2, 1, shLo);
    g.r(20, torsoTop + 2, 2, 1, shLo);
  } else if (pose === 'eat') {
    g.r(5, torsoTop + 2 + swing, 2, torH - 3, armCol);
    g.r(17, torsoTop + 2 - swing, 2, torH - 3, armCol);
    // 前臂抬到嘴邊
    g.r(14, torsoTop - 2, 2, 5, armCol);
    g.r(13, torsoTop - 4, 3, 2, sk);
    g.r(15, torsoTop - 5, 2, 2, 'gray_70'); // 筷子／叉子
  } else {
    g.r(5, torsoTop + 1 + swing, 2, torH - 2, armCol);
    g.r(17, torsoTop + 1 - swing, 2, torH - 2, armCol);
    g.r(4, torsoTop + 1 + swing, 1, torH - 2, shLo);
    g.r(19, torsoTop + 1 - swing, 1, torH - 2, shLo);
    // 手掌
    if (kind === 'critic') {
      g.r(4, torsoTop + torH - 1 + swing, 3, 3, sk);
      g.r(3, torsoTop + torH + 1 + swing, 3, 3, 'shirt_wht'); // 筆記本
      g.r(3, torsoTop + torH + 6 + swing, 3, 3, 'white');
    } else if (kind === 'tourist') {
      g.r(4, torsoTop + torH - 1 + swing, 3, 2, sk);
      g.r(17, torsoTop + torH - 1 - swing, 3, 2, sk);
      g.r(8, torsoTop + 6, 8, 4, OL); // 掛在胸前的相機
      g.r(9, torsoTop + 7, 6, 2, 'gray_30');
      g.r(10, torsoTop + 7, 2, 2, 'sky_hi');
    } else {
      g.r(4, torsoTop + torH - 1 + swing, 3, 3, sk);
      g.r(17, torsoTop + torH - 1 - swing, 3, 3, sk);
    }
  }

  // ── 脖子 ─────────────────────────────────────────────────────────────
  g.r(10, neckRow + bob + off + breathe, 4, 2, skLo);

  // ── 頭 ───────────────────────────────────────────────────────────────
  const ft = faceTop + off + bob + breathe;
  const ht = headTop + off + bob + breathe;
  if (dir === 'E') {
    g.r(8, ft, 8, 5, sk);
    g.r(15, ft + 1, 2, 3, sk); // 鼻
    g.r(16, ft + 2, 1, 1, skLo);
  } else {
    g.r(8, ft, 8, 5, sk);
    g.r(9, ft + 5, 6, 1, skLo); // 下巴
    g.r(8, ft, 8, 1, skHi); // 額頭
  }

  // 髮型
  if (style === 'bald') {
    g.r(8, ft - 1, 8, 1, skHi);
    if (dir !== 'N') g.r(7, ft + 2, 1, 2, ha);
  } else if (style === 'long') {
    if (dir === 'N') {
      g.r(7, ht, 10, 9, ha);
      g.r(7, ht, 10, 2, haHi);
    } else {
      g.r(7, ht, 10, 4, ha);
      g.r(6, ht + 2, 2, 8, ha);
      g.r(16, ht + 2, 2, 8, ha);
      g.r(7, ht, 10, 1, haHi);
      if (dir === 'E') g.r(6, ht + 1, 8, 3, ha);
    }
  } else if (style === 'bun') {
    g.r(8, ht, 8, 4, ha);
    g.r(7, ht + 1, 10, 3, ha);
    g.r(7, ht, 4, 2, haHi);
    if (dir === 'N') g.dia(12, ht - 4, 7, 6, ha);
    else if (dir === 'E') g.dia(6, ht - 3, 6, 6, ha);
    else g.dia(12, ht - 4, 7, 6, ha);
  } else if (style === 'cap') {
    g.r(7, ht, 10, 4, o.hatCol);
    g.r(7, ht, 10, 1, shade(o.hatCol, 'white', 0.3));
    g.r(7, ht + 3, 12, 1, shade(o.hatCol, 'black', 0.3));
  } else {
    g.r(8, ht, 8, 1, ha);
    g.r(7, ht + 1, 10, 3, ha);
    g.r(8, ht, 8, 1, haHi);
    if (dir === 'N') {
      g.r(7, ht + 1, 10, 6, ha);
      g.r(7, ht + 5, 10, 2, haLo);
    } else {
      g.r(7, ht + 1, 1, 5, ha);
      g.r(16, ht + 1, 1, 5, ha);
      if (dir === 'E') g.r(7, ht + 1, 2, 5, ha);
    }
  }

  // 五官
  if (dir === 'S') {
    if (o.blink) {
      g.r(9, ft + 2, 3, 1, OL);
      g.r(13, ft + 2, 3, 1, OL);
    } else {
      g.r(9, ft + 2, 2, 2, 'white');
      g.r(13, ft + 2, 2, 2, 'white');
      g.r(10, ft + 2, 1, 2, OL);
      g.r(13, ft + 2, 1, 2, OL);
    }
    g.r(9, ft + 1, 3, 1, haLo); // 眉
    g.r(13, ft + 1, 3, 1, haLo);
    g.r(11, ft + 4, 2, 1, 'red_lo'); // 嘴
  } else if (dir === 'E') {
    g.r(13, ft + 2, 2, 2, 'white');
    g.r(14, ft + 2, 1, 2, OL);
    g.r(13, ft + 1, 3, 1, haLo);
    g.r(15, ft + 4, 2, 1, 'red_lo');
  } else if (dir === 'W') {
    g.r(9, ft + 2, 2, 2, 'white');
    g.r(9, ft + 2, 1, 2, OL);
    g.r(8, ft + 1, 3, 1, haLo);
    g.r(7, ft + 4, 2, 1, 'red_lo');
  }

  // 帽子
  if (o.hat === 2) {
    // 廚師高帽
    g.r(6, ht - 6, 12, 4, 'shirt_wht');
    g.r(7, ht - 8, 10, 2, 'white');
    g.r(6, ht - 6, 12, 1, 'white');
    g.r(6, ht - 2, 12, 1, 'gray_70');
    g.r(7, ht, 10, 1, 'gray_90');
  } else if (o.hat === 1) {
    g.r(7, ht - 1, 10, 2, o.hatCol);
    g.r(7, ht - 1, 10, 1, shade(o.hatCol, 'white', 0.3));
    g.r(dir === 'E' ? 15 : 7, ht + 1, dir === 'E' ? 6 : 12, 1, shade(o.hatCol, 'black', 0.3));
  } else if (o.hat === 3) {
    g.r(7, ht + 2, 10, 1, 'red');
    g.r(16, ht + 2, 2, 1, 'red');
  } else if (o.hat === 5) {
    g.r(7, ht - 1, 10, 1, o.hatCol);
    g.r(15, ht + 3, 6, 1, shade(o.hatCol, 'black', 0.25));
  }

  // 生氣：臉部泛紅 + 頭側怒氣符號（血管十字）
  if (pose === 'angry') {
    g.dith(8, ft, 8, 6, 'red_hi', 'clear', DITHER.b37);
    g.r(9, ft + 1, 2, 1, OL);
    g.r(13, ft + 1, 2, 1, OL);
    // 怒氣符號：畫在頭部右側（不遮住臉、也不在頭頂最高的 6 列）
    const ax = 18;
    const ay = ft + 1;
    g.r(ax, ay + 2, 5, 1, 'red');
    g.r(ax + 2, ay, 1, 5, 'red');
    g.p(ax, ay, 'red_hi');
    g.p(ax + 4, ay + 4, 'red_hi');
    g.p(ax, ay + 4, 'red_hi');
    g.p(ax + 4, ay, 'red_hi');
  }
}


/**
 * 畫一個人（腳底中心對齊 x, y）。
 * opts: {dir:'N'|'S'|'E'|'W', frame, pose:'walk'|'idle'|'carry'|'eat'|'angry'|'seated',
 *        seated (pose 的別名), appearance, mood, uniform, kind, blink, style}
 * 姿勢全部由既有欄位推導（floor.js 依 state / dir / seatedDir / frame / mood 決定），
 * 不需要新增任何 state 欄位。
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
  const key = `p2|${q.hair}|${q.skin}|${q.shirt}|${q.pants}|${q.hat}|${q.hatCol}|${q.shoe}|${style}|${dir}|${frame & 3}|${pose}|${uniform || ''}|${kind || ''}|${blink}`;
  const paint = (c) => paintPerson(c, {
    dir, frame, pose, flip, hair: q.hair, skin: q.skin, shirt: q.shirt,
    pants: q.pants, hat: q.hat, hatCol: q.hatCol, shoe: q.shoe, uniform, kind, style, blink,
    mood: o.mood,
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
    wallHi: mixHex(wl, '#ffffff', 0.18),
    wall: wl,
    wallLo: mixHex(wl, '#000000', 0.22),
    wallSh: mixHex(wl, '#000000', 0.44),
    trim: mixHex(fl, '#000000', 0.34),
    trimHi: mixHex(fl, '#ffffff', 0.12),
    trimDark: mixHex(fl, '#000000', 0.56),
    accent: ac,
    accentHi: mixHex(ac, '#ffffff', 0.38),
    accentLo: mixHex(ac, '#000000', 0.32),
    tones: [mixHex(fl, '#000000', 0.10), mixHex(fl, '#000000', 0.36), mixHex(fl, '#000000', 0.24), fl, mixHex(fl, '#ffffff', 0.02)].slice(0, 4),
    seams: [seam, mixHex(fl, '#000000', 0.58), seam, mixHex(fl, '#000000', 0.32)],
  };
  if (TILE_PAL_CACHE.size > 32) TILE_PAL_CACHE.clear();
  TILE_PAL_CACHE.set(k, pal);
  return pal;
}

/** 取得調色盤快取鍵（未提供 → 'def'）。 */
export function tilePaletteKey(pal) {
  return pal && pal.key ? pal.key : 'def';
}

// ── tile／牆面幾何：全部由 TILE_W / TILE_H 推導（28×14 → 42×21 不需改公式）──
const TCX = TILE_W / 2; // 21
const THH = TILE_H / 2; // 10.5
const WALL_CW = TILE_W + 6; // 48（左右各留 3px 給描邊）
const WCX = WALL_CW / 2; // 24
const WALL_XL = WCX - TILE_W / 2; // 3  頂面西頂點
const WALL_XR = WCX + TILE_W / 2; // 45 頂面東頂點

function paintFloorTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  const pal = o.pal || DEFAULT_TILE_PAL;
  const v = ((o.variant | 0) % 4 + 4) % 4;
  const base = pal.tones[v];
  const seam = pal.seams[v];
  g.dia(cx, 0, W - 2, H - 2, base);
  // 木板接縫（沿等角方向的固定縫；寬版 tile 給 2–3 條）
  const us = o.variant & 1 ? [0.28, 0.62] : [0.45];
  for (let i = 0; i < us.length; i++) {
    const t = us[i];
    g.line(cx - TILE_W / 2 * t, THH * t, W - TILE_W / 2 * t, THH + THH * t, seam);
  }
  // 木紋（沿等角方向的細紋，新版有足夠像素畫 3 條）
  g.line(cx - g.u(7), g.u(2), cx - g.u(7), g.u(6), seam);
  g.line(cx + g.u(6), g.u(8), cx + g.u(6), g.u(12), seam);
  g.line(cx - g.u(3), g.u(4), cx - g.u(3), g.u(8), shade(base, 'black', 0.12));
  // 鎢絲燈由上而下的明暗（網點；燈光固定為暖黃）
  g.dith(2, H - 6, W - 4, 3, pal.trimDark, 'clear', DITHER.sparse);
  g.dith(4, 1, W - 8, 3, 'lamp_hi', 'clear', DITHER.sparse);
  // 邊界描邊
  g.line(1, THH, cx, H, seam);
  g.line(cx, H, W - 1, THH, seam);
  g.line(1, THH, cx, 0, seam);
  g.line(cx, 0, W - 1, THH, seam);
}

function paintKitchenTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  const blk = g.u(4);
  if (o.variant & 1) g.diaChecker(cx, 0, W - 2, H - 2, 'tile_k', 'tile_k_hi', blk);
  else g.diaChecker(cx, 0, W - 2, H - 2, 'tile_k', 'tile_k_lo', blk);
  // 排水孔 / 不鏽鋼格柵
  if (o.variant === 2) {
    g.dia(cx, THH - g.u(2), g.u(6), g.u(4), 'metal_sh');
    g.dith(cx - g.u(3), THH - g.u(2), g.u(7), g.u(4), 'metal_lo', 'clear', DITHER.sparse);
    for (let i = 0; i < 3; i++) g.r(cx - g.u(2) + i * g.u(2), THH - g.u(1), 1, g.u(3), 'metal_hi');
  }
  g.dith(2, H - 5, W - 4, 2, 'metal_sh', 'clear', DITHER.sparse);
  g.line(1, THH, cx, H, 'metal_sh');
  g.line(cx, H, W - 1, THH, 'metal_sh');
  g.line(1, THH, cx, 0, 'metal_lo');
  g.line(cx, 0, W - 1, THH, 'metal_lo');
}

function paintRestroomTile(c, o) {
  const W = TILE_W;
  const H = TILE_H;
  const g = mkPainter(c, W, false);
  const cx = TCX;
  g.diaChecker(cx, 0, W - 2, H - 2, 'tile', 'tile_hi', g.u(4));
  if (o.variant & 1) {
    g.dia(cx, THH - g.u(2), g.u(7), g.u(4), 'tile_lo');
    g.dith(cx - g.u(3), THH - g.u(2), g.u(7), g.u(4), 'metal_lo', 'clear', DITHER.b25);
  }
  g.dith(2, H - 5, W - 4, 2, 'tile_lo', 'clear', DITHER.sparse);
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
    g.dith(x0, y0 + 1, g.u(3), g.u(3), 'white', 'clear', DITHER.b50);
    g.dith(x0 + ww - g.u(3), y0 + wh - g.u(3), g.u(3), g.u(3), 'tile_hi', 'clear', DITHER.b37);
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
  // 側面
  g.poly([[WALL_XL, yMid], [cx, yBot], [cx, yBot + h], [WALL_XL, yMid + h]], left);
  g.poly([[cx, yBot], [WALL_XR, yMid], [WALL_XR, yMid + h], [cx, yBot + h]], right);
  // 踢腳／護牆板（跟著地點地板色走）
  const wain = Math.min(g.u(7), Math.max(g.u(3), Math.round(h * 0.34)));
  g.poly([[WALL_XL, yMid + h - wain], [cx, yBot + h - wain], [cx, yBot + h], [WALL_XL, yMid + h]], P.trim);
  g.poly([[cx, yBot + h - wain], [WALL_XR, yMid + h - wain], [WALL_XR, yMid + h], [cx, yBot + h]], P.trimDark);
  for (let i = 0; i < 4; i++) {
    const x = WALL_XL + g.u(3) + i * g.u(5);
    g.line(x, yMid + h - wain + 1, x, yBot + h - 1, P.trimDark);
  }
  g.line(WALL_XL, yBot + h - wain, cx, yBot + h - wain, P.trimDark);
  g.line(cx, yBot + h - wain, WALL_XR, yMid + h - wain, 'wood_dark');
  // 網點明暗（鎢絲燈由上方來）
  g.dith(WALL_XL + 1, yMid + 1, (cx - WALL_XL) - 1, Math.max(1, h - g.u(4)), 'lamp_hi', 'clear', DITHER.sparse);
  g.dith(cx + 2, yMid + 1, (WALL_XR - cx) - 2, Math.max(1, h - g.u(4)), P.wallSh, 'clear', DITHER.sparse);
  // 頂面
  g.dia(cx, 0, TILE_W - 2, TILE_H - 2, top);
  g.dith(WALL_XL + 2, 2, TILE_W - 6, 5, 'lamp_hi', 'clear', DITHER.sparse);
  g.dith(WALL_XL + 2, TILE_H - 8, TILE_W - 6, 5, P.wallSh, 'clear', DITHER.sparse);
  // 描邊
  g.line(WALL_XL, yMid, cx, yBot, 'outline');
  g.line(cx, yBot, WALL_XR, yMid, 'outline');
  g.line(WALL_XL, yMid + h, cx, yBot + h, 'outline');
  g.line(cx, yBot + h, WALL_XR, yMid + h, 'outline');
  g.line(WALL_XL, yMid, WALL_XL, yMid + h, 'outline');
  g.line(WALL_XR, yMid, WALL_XR, yMid + h, 'outline');
  g.line(WALL_XL, yMid, cx, 0, 'outline');
  g.line(cx, 0, WALL_XR, yMid, 'outline');
  // 壁燈（有開燈時牆面上一點暖光）
  if (opts.glow) {
    g.dith(WALL_XL + 2, yMid + g.u(4), g.u(4), g.u(3), 'lamp', 'clear', DITHER.sparse);
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
    top: o.top, left: o.left, right: o.right, pal: o.pal,
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
  g.dith(WALL_XL + 2, 3, TILE_W - 4, TILE_H - 2, 'lamp', 'clear', DITHER.b25);
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
  g.dith(4, 2, TILE_W - 2, 2, P.accentHi, 'clear', DITHER.sparse);
  for (let i = 0; i < 5; i++) g.r(6 + i * 7, 2, 5, 2, P.accent);
  // 「歡迎光臨」小燈籠
  const lx = WCX - g.u(4);
  g.r(lx, g.u(5), g.u(8), 1, 'outline');
  g.r(lx, g.u(6), g.u(8), g.u(6), lanternCol);
  g.r(lx + 1, g.u(6), g.u(6), g.u(6), lanternHi);
  g.r(lx, g.u(12), g.u(8), 1, 'lantern_lo');
  g.dith(lx - 2, g.u(14), g.u(12), g.u(4), 'lamp', 'clear', DITHER.b25);
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
  g.dith(WALL_XL + 4, openY + 1, TILE_W - 2, Math.round(oy2 * 1.4), 'lamp', 'lamp_lo', DITHER.checker);
  g.dith(WALL_XL + 6, openY + 2, TILE_W - 8, oy2, 'lamp_hi', 'lamp', DITHER.sparse);
  // 熱氣
  for (let i = 0; i < 3; i++) {
    const x = WALL_XL + g.u(5) + i * g.u(5);
    g.dith(x, openY + 1 + (o.frame & 1), 2, g.u(5) - (i & 1) * 2, 'lamp_hi', 'clear', DITHER.sparse);
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
    const key = `t|${kind}|${variant}|${frame}|${kind === 'floor' ? pk : 'def'}`;
    const cv = cachedSprite(key, TILE_W, TILE_H, (c) => {
      if (kind === 'kitchen') paintKitchenTile(c, { variant });
      else if (kind === 'restroom') paintRestroomTile(c, { variant });
      else paintFloorTile(c, { variant, pal });
    });
    const dx = Math.round(sx - TILE_W / 2);
    const dy = Math.round(sy - TILE_H / 2);
    if (cv) ctx.drawImage(cv, dx, dy);
    else {
      drawUncached(ctx, TILE_W, TILE_H, dx, dy, (c) => {
        if (kind === 'kitchen') paintKitchenTile(c, { variant });
        else if (kind === 'restroom') paintRestroomTile(c, { variant });
        else paintFloorTile(c, { variant, pal });
      });
    }
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
  const key = `w|${kind}|${h}|${variant}|${face}|${o.window ? 1 : 0}|${o.tod || 'night'}|${kframe}|${o.frost ? 1 : 0}|${pk}`;
  const paint = (c) => {
    if (kind === 'wall') paintWall(c, { h, variant, face, window: o.window, tod: o.tod, glow: o.glow, pal, frost: o.frost, frame: o.frame });
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

function artGeo(w, h, hgt, mount) {
  const bw = (w + h) * HALF_W;
  const bh = (w + h) * HALF_H;
  const W = Math.round(bw) + 8;
  const H = Math.round(bh) + Math.round(hgt) + Math.round(mount) + 8;
  return {
    W, H, cx: W / 2, gy: H - 4 - bh / 2, bw, bh, hgt, mount, w, h,
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

/** 桌面：米白桌布（亮）或深色木桌（暗）二選一，一律帶 1px 深色外框與 2px 板厚。 */
function paintTable(g, geo, o) {
  const round = !!o.round;
  const topFill = o.topFill || 'cloth_cream';
  const isCloth = topFill === 'cloth_cream' || topFill === 'cloth_white';
  const OL = 'furn_outline';
  const topEdge = o.topEdge || (isCloth ? shade(topFill, '#000000', 0.30) : mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.45));
  const hem = isCloth ? 'cloth_hem' : null;
  const legCol = o.legCol || (isCloth ? 'wood_lo' : 'wood_sh');
  baseShadow(g, geo, 0.98);

  const topCy = geo.gy - geo.hgt; // 桌面板中心
  const tw = geo.bw - 4;
  const th = geo.bh - 2;
  const topY = topCy - th / 2;
  const bw2 = geo.bw / 2;
  const bh2 = geo.bh / 2;

  // ── 四隻腳（等角＝垂直落下；先畫，桌面會蓋住頂端）──
  leg(g, geo.cx - bw2 + 3, topCy + 1, geo.gy + 1, legCol, OL);
  leg(g, geo.cx + bw2 - 5, topCy + 1, geo.gy + 1, legCol, OL);
  leg(g, geo.cx - 1, topY + 1, geo.gy - bh2 + 2, 'wood_sh', OL);
  leg(g, geo.cx, topY + th - 3, geo.gy + bh2 - 2, 'wood_sh', OL);

  // ── 桌板：1px 外框（上表面 + 板厚下緣各一圈）→ 桌裙 → 板厚側面 → 上表面 ──
  const skirt = isCloth ? shade(topFill, '#000000', 0.42) : mixHex(PALETTE.top_dark, '#000000', 0.5);
  if (round) {
    const rx = tw / 2;
    const ry = th / 2;
    // 桌裙（比桌面暗一階，形成「桌面＋桌裙」兩層）
    g.ell(geo.cx, topCy + g.u(5), rx + 1, ry + 1, OL);
    g.ell(geo.cx, topCy + g.u(4), rx, ry, skirt);
    // 右下側 1px 暗色桌緣／陰影帶（先畫，之後被桌面蓋住，只露出右下 1px）
    g.ell(geo.cx + 1, topCy + 1, rx + 1, ry + 1, shade(topEdge, '#000000', 0.25));
    g.ell(geo.cx, topCy + 2, rx + 1, ry + 1, OL);
    g.ell(geo.cx, topCy, rx + 1, ry + 1, OL);
    g.ell(geo.cx, topCy + 2, rx - 1, ry, topEdge);
    g.ell(geo.cx, topCy, rx - 1, ry, topFill);
    if (hem) {
      // 雙色調網點編織紋（不是平塗）：兩色交錯的 bayer 織紋 + 滾邊
      g.ell(geo.cx, topCy, rx - 2, ry - 1, hem);
      g.ell(geo.cx, topCy, rx - 3, ry - 2, topFill);
      g.dith(geo.cx - rx * 0.7, topCy - ry * 0.5, rx * 1.4, ry, mixHex(topFill, '#000000', 0.16), 'clear', DITHER.b25);
      g.dith(geo.cx - rx * 0.5, topCy - ry * 0.2, rx, Math.max(1, ry * 0.6), mixHex(topFill, '#ffffff', 0.30), 'clear', DITHER.b37);
    }
    g.dith(geo.cx - rx / 2, topCy - ry + 1, rx, Math.max(1, ry - 1), 'lamp_hi', 'clear', DITHER.sparse);
  } else {
    g.dia(geo.cx, topY - 1, tw + 2, th + 2, OL); // 上表面外框
    g.dia(geo.cx, topY + g.u(4), tw + 2, th + 2, OL); // 桌裙下緣外框
    g.dia(geo.cx, topY + g.u(3), tw, th, skirt); // 桌裙
    g.dia(geo.cx, topY + 1, tw + 2, th + 2, OL); // 板厚下緣外框
    g.dia(geo.cx, topY + 2, tw, th, topEdge); // 板厚側面
    g.dia(geo.cx, topY, tw, th, topFill); // 上表面
    if (hem) {
      g.dia(geo.cx, topY + 1, tw - 2, th - 2, hem); // 桌布滾邊
      g.dia(geo.cx, topY + 2, tw - 4, th - 4, topFill);
      // 雙色調網點編織紋
      g.dith(geo.cx - tw / 4, topY + 2, tw / 2, Math.max(2, th - 6), mixHex(topFill, '#000000', 0.16), 'clear', DITHER.b25);
      g.dith(geo.cx - tw / 6, topY + 3, tw / 3, Math.max(2, th - 8), mixHex(topFill, '#ffffff', 0.30), 'clear', DITHER.b37);
    } else {
      // 深色木桌的木紋（淡一階，但維持整體偏暗）
      g.line(geo.cx - tw / 4, topY + 2, geo.cx + tw / 4, topY + th / 2, mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.35));
      g.line(geo.cx - tw / 4 + 1, topY + 3, geo.cx + tw / 4 + 1, topY + th / 2 + 1, mixHex(PALETTE.top_dark, PALETTE.wood_md, 0.35));
    }
    // 右下側 1px 暗色桌緣
    g.line(geo.cx, topY + th + 1, geo.cx + tw / 2, topY + th / 2 + 1, shade(topEdge, '#000000', 0.3));
    g.dith(geo.cx - tw / 4, topY + 1, Math.max(2, tw / 2), 3, 'lamp_hi', 'clear', DITHER.sparse);
  }

  // ── 座位提示（餐具／坐位記號）：一律留在桌面內緣，不壓到 1px 外框 ──
  // 有人坐（o.occupied > 0）→ 盤 + 杯 + 調味罐；空桌 → 只有一副餐具
  const fac = o.facings && o.facings.length ? o.facings : ['N', 'S'];
  const busy = Math.max(0, Number(o.occupied) | 0);
  const plateHi = isCloth ? 'gray_70' : 'gray_50';
  const pw = g.u(5);
  const ph = g.u(3);
  for (let i = 0; i < fac.length; i++) {
    const d = fac[i];
    const seated = busy > 0;
    if (d === 'N') {
      g.dia(geo.cx, topY + 1, pw, ph, OL);
      g.dia(geo.cx, topY + 2, pw - 2, ph - 2, plateHi);
      if (seated) {
        g.r(geo.cx - g.u(5), topY + 2, 2, 2, 'teal_md');
        g.r(geo.cx + g.u(3), topY + 3, 2, g.u(3), 'shirt_wht'); // 杯
      } else {
        g.r(geo.cx - g.u(4), topY + 3, g.u(4), 1, 'gray_30'); // 筷子
      }
    } else if (d === 'S') {
      g.dia(geo.cx, topY + th - ph - g.u(2), pw, ph, OL);
      g.dia(geo.cx, topY + th - ph - g.u(1), pw - 2, ph - 2, plateHi);
      if (seated) {
        g.r(geo.cx + g.u(3), topY + th - ph - g.u(2), 2, 2, 'teal_md');
        g.r(geo.cx - g.u(5), topY + th - ph, 2, g.u(3), 'shirt_wht');
      } else {
        g.r(geo.cx, topY + th - ph - g.u(2), g.u(4), 1, 'gray_30');
      }
    } else if (d === 'W') {
      g.dia(geo.cx - g.u(7), topY + th / 2 - 2, pw, ph, OL);
      g.dia(geo.cx - g.u(7), topY + th / 2 - 1, pw - 2, ph - 2, plateHi);
      if (seated) {
        g.r(geo.cx - g.u(10), topY + th / 2 - 3, 2, 2, 'teal_md');
        g.r(geo.cx - g.u(9), topY + th / 2 + 1, 2, g.u(3), 'shirt_wht');
      } else {
        g.r(geo.cx - g.u(9), topY + th / 2, g.u(4), 1, 'gray_30');
      }
    } else {
      g.dia(geo.cx + g.u(7), topY + th / 2 - 2, pw, ph, OL);
      g.dia(geo.cx + g.u(7), topY + th / 2 - 1, pw - 2, ph - 2, plateHi);
      if (seated) {
        g.r(geo.cx + g.u(8), topY + th / 2 - 3, 2, 2, 'teal_md');
        g.r(geo.cx + g.u(7), topY + th / 2 + 1, 2, g.u(3), 'shirt_wht');
      } else {
        g.r(geo.cx + g.u(5), topY + th / 2, g.u(4), 1, 'gray_30');
      }
    }
  }
  // 桌上調味罐（有人坐時多一罐醬油）
  g.r(geo.cx - 1, topY + g.u(3), g.u(2), g.u(3), 'gray_90');
  g.r(geo.cx - 2, topY + g.u(2), g.u(4), 1, '#ffffff');
  g.r(geo.cx - 1, topY + g.u(6), g.u(2), 1, OL);
  if (busy > 0) {
    g.r(geo.cx + g.u(4), topY + g.u(3), g.u(2), g.u(4), 'red_md');
    g.r(geo.cx + g.u(4), topY + g.u(2), g.u(2), 1, 'red_hi');
  }
}

// ── 椅 ────────────────────────────────────────────────────────────────────
/** 椅子：深色木框 + 彩色椅墊 + 背向坐向的椅背，與地板和桌面都明顯不同色。 */
function paintChair(g, geo, o) {
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
  g.dith(4, geo.gy - bodyH + 2, geo.bw - 8, bodyH - 6, 'lamp_hi', 'clear', DITHER.sparse);
  // 檯面（大理石化：灰底 + 網點）
  g.dia(geo.cx, geo.gy - bodyH - (geo.bh - 6) / 2, geo.bw - 2, geo.bh - 6, 'outline');
  g.dia(geo.cx, geo.gy - bodyH + 1 - (geo.bh - 8) / 2, geo.bw - 4, geo.bh - 8, 'gray_90');
  g.dith(6, geo.gy - bodyH - 3, geo.bw - 12, geo.bh - 8, 'gray_30', 'clear', DITHER.sparse);
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
      g.dith(geo.cx + dx - 2, t + dy, 5, 3, 'fire', 'clear', DITHER.b50);
      g.r(geo.cx + dx - 1, t + dy + 1, 2, 1, 'fire_hi');
    }
  }
  // 湯鍋
  g.r(geo.cx - 8, t - 5, 7, 5, 'metal_lo');
  g.r(geo.cx - 7, t - 6, 5, 1, 'metal');
  g.dith(geo.cx - 7, t - 8, 5, 2, 'gray_90', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - 5, t - 3, 10, 4, 'water', 'clear', DITHER.b37);
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
    g.dith(6, t + 12, 10, 8, 'gray_30', 'clear', DITHER.b25);
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
  g.dith(geo.cx - 8, y + 1, 16, 3, 'gray_70', 'clear', DITHER.sparse);
}

function paintFryer(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt - 2, 'metal', 'metal', 'metal_md', 'outline');
  const t = geo.gy - geo.hgt + 2;
  g.dia(geo.cx, t - 2, geo.bw - 12, geo.bh - 6, 'lamp_sh');
  g.dith(geo.cx - 5, t - 2, 10, 4, 'lamp_md', 'clear', DITHER.checker);
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
  g.dith(geo.cx - 4, y - 2, 8, 2, 'tile_lo', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - 5, t + 1, 10, 3, 'water', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - 9, y + 1, 19, geo.hgt - 2, 'sky_hi', 'clear', DITHER.diag);
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
    g.dith(geo.cx - u(9) + i * u(5), y + geo.hgt, u(3), len, 'sky_hi', 'clear', DITHER.b37);
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
  g.dith(geo.cx - bw / 2 + 3, y + 3, bw - 6, geo.hgt - 4, 'gray_30', 'clear', DITHER.checker);
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
  g.dith(geo.cx - bw / 2 + 2, y - h + 2, u(3), h - 5, 'red_hi', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - u(12), y + geo.hgt - 2, u(25), 1, 'red_hi', 'clear', DITHER.checker);
  g.dith(geo.cx - u(10), y + geo.hgt - 1, u(21), 1, 'red_lo', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - u(9), ty + u(6), u(18), u(5) + flick, 'lamp', 'clear', DITHER.b37);
  g.dith(geo.cx - u(6), ty + u(10), u(12), u(4), 'lamp_glow', 'clear', DITHER.b25);
  g.dith(geo.cx - u(12), ty + u(8), u(24), u(3), 'lamp_hi', 'clear', DITHER.sparse);
}

function paintTrashBin(g, geo, o) {
  baseShadow(g, geo, 0.6);
  const y = geo.gy;
  g.r(geo.cx - 6, y - geo.hgt, 13, geo.hgt, 'outline');
  g.r(geo.cx - 5, y - geo.hgt + 1, 11, geo.hgt - 2, 'metal_md');
  g.dith(geo.cx - 4, y - geo.hgt + 2, 9, geo.hgt - 4, 'metal_hi', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - 6, y - geo.hgt + 2, 13, geo.hgt - 4, 'fire', 'clear', DITHER.checker);
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
  g.dith(geo.cx - w / 2 + 2, y + 2, w - 2, 4, 'neon_yel', 'clear', DITHER.sparse);
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
  g.dith(cx - geo.bw / 4, gy - 3, geo.bw / 2, 5, 'red_hi', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - w / 2 - 3, y, w + 6, geo.hgt + 2, c1, 'clear', DITHER.sparse);
  g.r(geo.cx - 1, y - 2, 2, 2, 'metal_lo');
}

function paintAquarium(g, geo, o) {
  baseShadow(g, geo, 0.8);
  const y = geo.gy;
  cuboid(g, geo.cx, y, geo.bw - 6, geo.bh - 4, 5, 'wood_hi', 'wood', 'wood_md', 'outline');
  const t = y - 4;
  g.r(geo.cx - 10, t - geo.hgt, 21, geo.hgt, 'outline');
  g.r(geo.cx - 9, t - geo.hgt + 1, 19, geo.hgt - 2, 'water');
  g.dith(geo.cx - 9, t - geo.hgt + 1, 19, geo.hgt - 2, 'water_hi', 'clear', DITHER.b37);
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
  g.dith(geo.cx - 9, t - 4, 19, 4, 'leaf_lo', 'clear', DITHER.sparse);
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
    g.dith(x + 2, y - geo.hgt + 4, pw - 4, geo.hgt - 12, 'lamp_hi', 'clear', DITHER.sparse);
  }
}

function paintMenuBoard(g, geo, o) {
  const y = geo.gy - geo.mount - geo.hgt;
  g.r(geo.cx - 11, y, 23, geo.hgt, 'wood_dark');
  g.r(geo.cx - 10, y + 1, 21, geo.hgt - 2, 'gray_15');
  g.dith(geo.cx - 10, y + 1, 21, geo.hgt - 2, 'gray_30', 'clear', DITHER.sparse);
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
  g.dith(geo.cx - 8, y + 2, 15, 5, ph & 1 ? 'teal' : 'shirt_prp', 'clear', DITHER.checker);
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
  g.dith(geo.cx - 4, t - 7, 9, 7, 'water', 'clear', DITHER.b25);
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
  g.dith(geo.cx - geo.bw / 4, t - 5, geo.bw / 2, 4, 'red_hi', 'clear', DITHER.sparse);
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
    g.dith(x - 6, y + 4 + dy, 13, 5, 'lamp', 'clear', DITHER.b25);
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
  g.dith(geo.cx - bw / 4, t - 4, bw / 2, Math.max(2, bh / 2 - 2), 'water_hi', 'clear', DITHER.b37);
  // 中央石柱與水柱
  g.r(geo.cx - 2, t - 12, 4, 8, 'gray_70');
  g.r(geo.cx - 1, t - 12, 2, 8, 'gray_90');
  const ph = (o.frame | 0) & 3;
  g.r(geo.cx - 1, t - 16 + (ph & 1), 2, 5 - (ph & 1), 'water_hi');
  g.p(geo.cx - 3, t - 13 + ((ph + 1) & 1), 'water_hi');
  g.p(geo.cx + 2, t - 12 + ((ph + 2) & 1), 'water_hi');
  g.p(geo.cx, t - 17 + (ph & 1), 'white');
  g.dith(geo.cx - 8, t - 3, 16, 4, 'water_hi', 'clear', DITHER.sparse);
}

function paintUnknown(g, geo, o) {
  baseShadow(g, geo, 0.9);
  cuboid(g, geo.cx, geo.gy, geo.bw - 6, geo.bh - 4, geo.hgt, 'gray_70', 'gray_50', 'gray_30', 'outline');
  const t = geo.gy - geo.hgt;
  g.dith(geo.cx - 6, t + 2, 12, geo.hgt - 4, 'gray_90', 'clear', DITHER.sparse);
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
  table_2a: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S'] }) },
  table_2b: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_cream', facings: ['N', 'S'] }) },
  table_4a: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S', 'E', 'W'] }) },
  table_4b: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_white', facings: ['N', 'S', 'E', 'W'] }) },
  table_6a: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'top_dark', facings: ['N', 'S', 'E', 'W'] }) },
  table_6b: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, round: true, topFill: 'cloth_white', facings: ['N', 'S', 'E', 'W'] }) },
  table_long: { hgt: 18, takesOccupancy: true, paint: (g, geo, o) => paintTable(g, geo, { ...o, topFill: 'cloth_cream', facings: ['N', 'S', 'E', 'W'] }) },

  // 椅（3）＋沙發／長凳：淺色木框 + 彩色椅墊（與地板、桌面都拉開色調），背向坐向
  chair_wood: { hgt: 14, dirs: true, paint: (g, geo, o) => paintChair(g, geo, { ...o, seat: 'teal', frameCol: 'wood', frameHi: 'wood_hi' }) },
  chair_iron: { hgt: 21, dirs: true, paint: (g, geo, o) => paintChair(g, geo, { ...o, seat: 'cushion_gry', frameCol: 'metal', frameHi: 'metal_hi' }) },
  chair_stool: { hgt: 11, paint: (g, geo, o) => paintChair(g, geo, { ...o, stool: true, seat: 'teal', frameCol: 'wood', frameHi: 'wood_hi' }) },
  chair_bench: { hgt: 16, paint: (g, geo, o) => paintChair(g, geo, { ...o, stool: true, seat: 'wood_hi', frameCol: 'wood_md', frameHi: 'wood_hi' }) },
  chair_soft: { hgt: 15, dirs: true, paint: (g, geo, o) => paintChair(g, geo, { ...o, seat: 'red', frameCol: 'wood', frameHi: 'wood_hi' }) },
  sofa: { hgt: 22, paint: paintSofa },

  // 櫃台（2）＋帶位台
  counter: { hgt: 22, paint: paintCounter },
  cashier_counter: { hgt: 24, paint: (g, geo, o) => paintCounter(g, geo, { ...o, cashier: true }) },
  bar_counter: { hgt: 26, paint: (g, geo, o) => paintCounter(g, geo, { ...o, bar: true, menu: true }) },
  host_podium: { hgt: 20, paint: paintPodium },

  // 廚房（3+）
  stove: { hgt: 24, anim: true, paint: paintStove },
  prep_table: { hgt: 21, paint: paintPrepTable },
  sink: { hgt: 21, anim: true, paint: paintSink },
  fridge: { hgt: 39, anim: true, paint: paintFridge },
  freezer: { hgt: 30, paint: (g, geo, o) => paintFridge(g, geo, { ...o, freezer: true }) },
  oven: { hgt: 24, anim: true, paint: paintOven },
  hood: { hgt: 12, mount: 24, paint: paintHood },
  fryer: { hgt: 21, anim: true, paint: paintFryer },
  dishwasher: { hgt: 22, anim: true, paint: paintDishwasher },
  rice_cooker: { hgt: 15, anim: true, paint: paintRiceCooker },

  // 廁所（2+）
  toilet: { hgt: 18, dirs: true, paint: paintToilet },
  washbasin: { hgt: 21, anim: true, paint: paintWashbasin },
  urinal: { hgt: 18, mount: 12, paint: paintUrinal },
  hand_dryer: { hgt: 9, mount: 18, paint: paintDryer },
  mirror: { hgt: 15, mount: 22, paint: paintMirror },

  // 設備（8）
  cctv: { hgt: 10, mount: 24, anim: true, paint: paintCCTV },
  aircon: { hgt: 14, mount: 21, anim: true, paint: paintAircon },
  speaker: { hgt: 15, mount: 18, anim: true, paint: paintSpeaker },
  extinguisher: { hgt: 22, mount: 6, paint: paintExtinguisher },
  security_host: { hgt: 16, mount: 18, anim: true, paint: paintSecurityHost },
  infrared: { hgt: 8, mount: 21, paint: paintInfrared },
  lamp: { hgt: 39, anim: true, paint: paintLamp },
  trash_bin: { hgt: 16, paint: paintTrashBin },
  heater: { hgt: 18, anim: true, paint: paintHeater },

  // 裝潢（10+）
  plant: { hgt: 26, paint: paintPlant },
  painting: { hgt: 18, mount: 21, paint: paintPainting },
  rug: { hgt: 0, paint: paintRug },
  neon_sign: { hgt: 18, mount: 22, anim: true, accent: true, paint: paintNeonSign },
  aquarium: { hgt: 22, anim: true, paint: paintAquarium },
  partition: { hgt: 30, paint: paintPartition },
  menu_board: { hgt: 30, mount: 6, accent: true, paint: paintMenuBoard },
  tv: { hgt: 18, mount: 15, anim: true, paint: paintTV },
  banner: { hgt: 18, mount: 27, accent: true, paint: paintBanner },
  clock: { hgt: 12, mount: 24, anim: true, paint: paintClock },
  vase: { hgt: 15, paint: paintVase },
  coat_rack: { hgt: 39, paint: paintCoatRack },
  vending_machine: { hgt: 39, anim: true, paint: paintVending },
  water_cooler: { hgt: 33, paint: paintWaterCooler },
  shelf: { hgt: 30, paint: paintShelf },
  lantern_string: { hgt: 21, mount: 27, accent: true, paint: paintLanternString },
  fountain: { hgt: 24, anim: true, paint: paintFountain },

  unknown: { hgt: 21, paint: paintUnknown },
};

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
export function drawFurniture(ctx, typeId, x, y, opts = {}) {
  if (!ctx) return null;
  const o = opts || {};
  const gw = clampDim(o.w);
  const gh = clampDim(o.h);
  const key = resolveFurnitureArt(typeId, o);
  const art = FURNITURE_ART[key] || FURNITURE_ART.unknown;
  const geo = artGeo(gw, gh, art.hgt, art.mount || 0);
  const dir = art.dirs ? rotToDir(o.rot) : 'S';
  const frame = art.anim ? ((Number(o.frame) | 0) & 3) : 0;
  // 只有用到場地強調色的傢俱才把 accent 放進快取鍵（避免快取爆量）
  const acc = typeof o.accent === 'string' ? o.accent : null;
  const accKey = art.accent && acc ? `|${acc}` : '';
  const occKey = art.takesOccupancy ? (Number(o.occupied) | 0) : 0;
  const cacheKey = `f|${key}|${gw}x${gh}|${dir}|${frame}|${o.broken ? 'b' : ''}|${o.rugCol || ''}${accKey}|${occKey}`;
  const paint = (c) => {
    const g = mkPainter(c, geo.W, false);
    art.paint(g, geo, { ...o, dir, frame });
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
  const dx = Math.round(x - geo.cx);
  const dy = Math.round(y - geo.gy);
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
  out.cx = Math.round(x);
  out.gy = Math.round(y);
  out.dir = dir;
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
  const bands = [[0, 0, w, 6, DITHER.b12], [0, 6, w, 5, DITHER.b25], [0, 11, w, 5, DITHER.b37], [0, 16, w, 6, DITHER.b50]];
  for (let i = 0; i < bands.length; i++) {
    if (bands[i][3] > maxBand) break;
    ditherPattern(ctx, bands[i][0], bands[i][1], bands[i][2], bands[i][3], dark, light, bands[i][4]);
    ditherPattern(ctx, bands[i][0], h - bands[i][1] - bands[i][3], bands[i][2], bands[i][3], dark, light, bands[i][4]);
  }
  const cols = [[0, 0, 6, h, DITHER.b12], [6, 0, 5, h, DITHER.b25], [11, 0, 5, h, DITHER.b37], [16, 0, 6, h, DITHER.b50]];
  for (let i = 0; i < cols.length; i++) {
    ditherPattern(ctx, cols[i][0], cols[i][1], cols[i][2], cols[i][3], dark, light, cols[i][4]);
    ditherPattern(ctx, w - cols[i][0] - cols[i][2], cols[i][1], cols[i][2], cols[i][3], dark, light, cols[i][4]);
  }
}

/**
 * 全畫面天氣覆蓋層（畫在最上層）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} weather sunny|cloudy|rain|storm|cold|heat
 * @param {number} w @param {number} h 邏輯尺寸
 * @param {number} tick 影格計數（60fps）
 */
export function drawWeather(ctx, weather, w, h, tick) {
  if (!ctx) return;
  const kind = WEATHER_KINDS.indexOf(weather) >= 0 ? weather : 'sunny';
  const W = Math.round(w);
  const H = Math.round(h);
  const t = Number(tick) || 0;
  if (kind === 'sunny') {
    // 光柱（硬邊網點斜帶，收斂在畫面上半部，避免壓過室內）
    for (let s = 0; s < 2; s++) {
      const x0 = Math.round(W * (0.14 + s * 0.34));
      const wdt = 14 + s * 5;
      for (let y = 0; y < H * 0.78; y += 3) {
        const x = x0 + Math.round(y * 0.42);
        if (x > W) break;
        ditherPattern(ctx, x, y, Math.min(wdt, W - x), 3, 'lamp_md', 'clear', s & 1 ? DITHER.sparse : DITHER.b12);
      }
    }
    // 浮塵
    for (let i = 0; i < 18; i++) {
      const x = (hash1(i * 7 + 1) * W + t * 0.35 * (1 + (i % 3))) % W;
      const y = (hash1(i * 11 + 5) * H + t * 0.2) % H;
      ctx.fillStyle = color(i & 1 ? 'lamp_hi' : 'white');
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    return;
  }
  if (kind === 'cloudy') {
    ditherPattern(ctx, 0, 0, W, H, 'gray_30', 'clear', DITHER.b12);
    for (let i = 0; i < 4; i++) {
      const y = ((i * 46 + t * 0.12) % (H + 60)) - 30;
      ditherPattern(ctx, 0, y, W, 26, 'gray_15', 'clear', DITHER.b25);
      ditherPattern(ctx, 0, y + 26, W, 10, 'gray_70', 'clear', DITHER.b12);
    }
    return;
  }
  if (kind === 'rain' || kind === 'storm') {
    const storm = kind === 'storm';
    ditherPattern(ctx, 0, 0, W, H, storm ? 'outline_cool' : 'sky_lo', 'clear', storm ? DITHER.b37 : DITHER.b25);
    const n = storm ? 340 : 190;
    const light = storm ? 'sky_hi' : 'sky_md';
    const dark = storm ? 'sky' : 'sky_lo';
    for (let i = 0; i < n; i++) {
      const sp = (storm ? 620 : 380) + hash1(i * 3 + 1) * 420;
      const bx = hash1(i * 5 + 2) * (W + 140) - 70;
      const len = storm ? 9 : 6;
      const y = ((hash1(i * 7 + 3) * (H + 70) + t * sp * 0.016) % (H + 70)) - 35;
      const x = bx + y * 0.22;
      ctx.fillStyle = color(i % 3 === 0 ? light : dark);
      ctx.fillRect(Math.round(x), Math.round(y), 1, len);
      ctx.fillRect(Math.round(x + 1), Math.round(y + len - 2), 1, len - 2);
    }
    // 地面水花
    for (let i = 0; i < (storm ? 60 : 34); i++) {
      const sx = (hash1(i * 13 + 4) * W + t * 0.6) % W;
      const sy = H - 4 - hash1(i * 17 + 6) * 26;
      const phase = (t * 0.25 + i) % 3 | 0;
      ctx.fillStyle = color(phase === 0 ? 'sky_hi' : 'sky_md');
      ctx.fillRect(Math.round(sx) - phase, Math.round(sy), 2 + phase * 2, 1);
    }
    if (storm && t % 190 < 3) {
      ditherPattern(ctx, 0, 0, W, H, 'white', 'sky_hi', DITHER.b62);
    }
    return;
  }
  if (kind === 'cold') {
    vignette(ctx, W, H, 'sky_lo', 'clear', 24);
    ditherPattern(ctx, 0, 0, W, H, 'sky_hi', 'clear', DITHER.sparse);
    for (let i = 0; i < 46; i++) {
      const x = (hash1(i * 9 + 2) * W + Math.sin(t * 0.01 + i) * 8) % W;
      const y = (hash1(i * 15 + 8) * H + t * 0.22) % H;
      ctx.fillStyle = color(i % 4 === 0 ? 'white' : 'sky_hi');
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    return;
  }
  // heat
  vignette(ctx, W, H, 'lamp_sh', 'clear', 24);
  ditherPattern(ctx, 0, 0, W, H, 'lamp_md', 'clear', DITHER.sparse);
  for (let b = 0; b < 9; b++) {
    const y = Math.round((b * H) / 9 + Math.sin(t * 0.09 + b * 1.3) * 2);
    ditherRect(ctx, 0, y, W, 2, 'lamp_hi', 'clear', DITHER.hline);
    ditherRect(ctx, 0, y + 3, W, 1, 'lamp_sh', 'clear', DITHER.sparse);
  }
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
export const STREET_PROP_KINDS = ['lamp', 'pole', 'scooter', 'bike', 'bin', 'manhole', 'transformer', 'pot'];

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
  ditherRect(ctx, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h), 'shadow', 'clear', DITHER.b50);
}
