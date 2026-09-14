// src/render/palette.js
// 《夢幻西餐廳》復刻 — 1998 年 VGA/16-bit 調色盤與網點（dither）工具。
//
// 美術方向（docs/GAME_PROMPT.md §5）：
//   ‧ 室內鎢絲燈的暖黃、木頭地板、米黃牆面、青綠／紅色招牌、夜市霓虹。
//   ‧ 色數受限、禁用漸層、禁用柔邊陰影、禁用反鋸齒；明暗一律用 2 色網點堆疊。
//
// 本檔不碰 DOM；只有 ditherPattern() 在瀏覽器會需要 canvas 做 pattern，
// 在無 DOM 環境（Node 測試）會自動降級成粗網點，不會丟例外。

// ---------------------------------------------------------------------------
// 色票
// ---------------------------------------------------------------------------

export const PALETTE = {
  // ── 最深／描邊 ────────────────────────────────────────────────
  black: '#0d0b10',
  outline: '#1c1216', // 角色與傢俱的 1px 描邊
  outline_warm: '#3a2418',
  outline_cool: '#16202e',

  // ── 灰階 ─────────────────────────────────────────────────────
  white: '#fbfbf4',
  gray_90: '#e6e6dc',
  gray_70: '#b8b8b0',
  gray_50: '#8a8a86',
  gray_30: '#5a5a58',
  gray_15: '#33333a',

  // ── 米黃牆面 ─────────────────────────────────────────────────
  wall_hi: '#f2e3c0',
  wall: '#dcc79a',
  wall_md: '#c2a97a',
  wall_lo: '#a08a5e',
  wall_sh: '#7b6844',

  // ── 木頭 ─────────────────────────────────────────────────────
  wood_hi: '#c69d66',
  wood: '#a87e4e',
  wood_md: '#8a6338',
  wood_lo: '#6b4926',
  wood_sh: '#4b3218',
  wood_dark: '#33210f',

  // ── 鎢絲燈暖光 ───────────────────────────────────────────────
  lamp_hi: '#fff3c4',
  lamp: '#ffd98a',
  lamp_md: '#f2b44e',
  lamp_lo: '#c9822a',
  lamp_sh: '#8a5218',
  lamp_glow: '#ffe9a8',

  // ── 青綠（招牌／服裝）────────────────────────────────────────
  teal_hi: '#7fe0d4',
  teal: '#2fa79c',
  teal_md: '#1d7a74',
  teal_lo: '#114f4d',

  // ── 紅（招牌／燈籠）──────────────────────────────────────────
  red_hi: '#ff8a6a',
  red: '#d63a2c',
  red_md: '#a8241c',
  red_lo: '#6e1410',

  // ── 霓虹 ─────────────────────────────────────────────────────
  neon_pink: '#ff5aa8',
  neon_mag: '#c62a86',
  neon_cyan: '#5ce8ff',
  neon_grn: '#5ce05a',
  neon_org: '#ff9a2e',
  neon_yel: '#ffe23c',
  neon_blu: '#5a7cff',

  // ── 天空 ─────────────────────────────────────────────────────
  sky_hi: '#a8d8ee',
  sky: '#6ba6cf',
  sky_md: '#3f6f9e',
  sky_lo: '#2a4a72',
  sky_night: '#101a34',
  dusk_org: '#ef8a4a',
  dusk_pnk: '#c95f7a',

  // ── 人物膚色 ─────────────────────────────────────────────────
  skin_hi: '#f7d6ae',
  skin: '#e8b98c',
  skin_md: '#c78f60',
  skin_lo: '#96603a',
  skin_sh: '#63391f',

  // ── 髮色 ─────────────────────────────────────────────────────
  hair_blk: '#1a1116',
  hair_brn: '#4a2c18',
  hair_mid: '#7a4a20',
  hair_org: '#a85a1e',
  hair_gry: '#cfcfc6',

  // ── 衣著 ─────────────────────────────────────────────────────
  shirt_wht: '#efefe6',
  shirt_blu: '#3a6ea5',
  shirt_nvy: '#1f3a5c',
  shirt_teal: '#2f8f86',
  shirt_red: '#c0392b',
  shirt_yel: '#e8c447',
  shirt_grn: '#3f8f4a',
  shirt_prp: '#7a4f9e',
  shirt_pnk: '#e07fa8',
  shirt_org: '#d8763a',
  shirt_gry: '#8a8f96',
  shirt_brn: '#6b4a2e',

  pants_drk: '#242a3a',
  pants_brn: '#4a3524',
  pants_blu: '#2c3f60',
  pants_gry: '#4e525c',

  // ── 金屬／設備 ───────────────────────────────────────────────
  metal_hi: '#d6dde1',
  metal: '#9aa4ac',
  metal_md: '#727c86',
  metal_lo: '#4c545c',
  metal_sh: '#2e343a',

  // ── 廁所／廚房磁磚 ───────────────────────────────────────────
  tile_hi: '#eef7f8',
  tile: '#cfe2e6',
  tile_md: '#a8c2c8',
  tile_lo: '#7d979e',
  tile_k_hi: '#cfd8d8',
  tile_k: '#a4b0b2',
  tile_k_lo: '#78858a',

  // ── 夜市 ─────────────────────────────────────────────────────
  lantern: '#ff8a3c',
  lantern_hi: '#ffc06a',
  lantern_lo: '#c2471c',

  // ── 自然 ─────────────────────────────────────────────────────
  leaf_hi: '#8fd05e',
  leaf: '#4e9138',
  leaf_lo: '#2f6428',
  pot_org: '#b06a3a',
  soil: '#4a3220',

  // ── 雜項 ─────────────────────────────────────────────────────
  water: '#3f8fb8',
  water_hi: '#7fc8dc',
  fire: '#ff7a2e',
  fire_hi: '#ffe08a',
  window_dk: '#1b2b46',
  grid_line: '#f7e9b0',
  ghost_ok: '#5ce05a',
  ghost_bad: '#ff4a3c',
  select: '#ffe23c',
  mood_good: '#ff8ac0',
  mood_bad: '#ff5a4a',
  debug_path: '#5ce8ff',
  debug_target: '#ff5aa8',
  hp_ok: '#5ce05a',
  hp_warn: '#ffe23c',
  hp_bad: '#ff4a3c',
  shadow: '#241a10',
  shadow_deep: '#150e07', // 牆腳 AO 專用的深墨色（比 shadow 更沉，少量像素就有足夠壓暗）
  dart: '#8a1a12',

  // ── 傢俱輪廓與桌面（提高與木地板的辨識度）────────────────────
  furn_outline: '#1b1208', // 傢俱一律 1px 深色描邊（遠比地板暗）
  top_dark: '#1b1006', // 深色木桌面（宴會大桌；遠比地板暗）
  cloth_cream: '#fffbef', // 淡米白桌布（提亮，讓桌面從壓暗後的地板上跳出來）
  cloth_white: '#fffef8', // 純白桌布
  cloth_hem: '#d6c69c', // 桌布滾邊（提亮，配合夜間桌面對地板的對比）
  cushion_red: '#a8241c', // 椅墊（深紅）
  cushion_teal: '#1d7a74', // 椅墊（深青）
  cushion_gry: '#5a5a58', // 椅墊（鐵椅）

  // ── 燈光／氛圍（時段網點、光池、蒸氣、水窪）──────────────────
  night_tint: '#101528', // 夜晚室內壓暗網點（低亮度、偏藍）
  dawn_tint: '#a8d8ee', // 早晨冷藍網點
  dusk_tint: '#ef8a4a', // 傍晚暖琥珀網點
  light_pool: '#ffd9a0', // 燈下光池（暖色，R 遠大於 B）
  light_pool_hi: '#ffe9c0', // 光池內圈
  glow_warm: '#ffc45c', // 燈泡光暈
  steam: '#c8c0b4', // 蒸氣（暖灰，不是白霧）
  puddle: '#3f5a6e',
  puddle_hi: '#8fc8e8',

  // ── 店外騎樓／柏油（比室內地板暗，但不可接近全黑）────────────
  pave: '#473d2e',
  pave_lo: '#332c22',
  pave_shade: '#1f1a13', // 店外陰影側的鋪面（實色；比 pave/pave_lo 都暗）
  pave_hi: '#665849',
  pave_curb: '#2a2419',
  pave_joint: '#231d14',
};

const HEX_CACHE = new Map();

/** 取的色票；未知名稱回傳洋紅（缺圖色），以利除錯。 */
export function color(name) {
  if (typeof name === 'string') {
    if (name.charCodeAt(0) === 35 /* # */) return name;
    const v = PALETTE[name];
    if (typeof v === 'string') return v;
    if (name.startsWith('rgb')) return name;
  }
  return '#ff00ff';
}

/** 色票名稱是否存在。 */
export function hasColor(name) {
  return typeof name === 'string' && (name.charCodeAt(0) === 35 || typeof PALETTE[name] === 'string');
}

// ---------------------------------------------------------------------------
// 顏色運算（只用於「挑選色票」與染色，不產生漸層）
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  let h = HEX_CACHE.get(hex);
  if (h) return h;
  let s = typeof hex === 'string' ? hex : '#000000';
  if (s.charCodeAt(0) === 35) s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  const v = Number.isFinite(n)
    ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    : { r: 0, g: 0, b: 0 };
  if (HEX_CACHE.size < 512) HEX_CACHE.set(hex, v);
  return v;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function toHex(r, g, b) {
  return '#' + ((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1);
}

/** 兩色線性混合，t = 0 → a，t = 1 → b。 */
export function mixHex(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const A = hexToRgb(color(a));
  const B = hexToRgb(color(b));
  return toHex(A.r + (B.r - A.r) * k, A.g + (B.g - A.g) * k, A.b + (B.b - A.b) * k);
}

/** 以 b 對 a 加亮／壓暗（同 mixHex，語意化）。 */
export function shade(a, b, t) {
  return mixHex(a, b, t);
}

/** 把任意顏色吸附到候選色票中最接近的一個（限制色數用）。 */
export function nearestColor(hex, list) {
  const src = hexToRgb(color(hex));
  let best = list && list.length ? list[0] : 'black';
  let bestD = Infinity;
  for (let i = 0; i < (list ? list.length : 0); i++) {
    const c = hexToRgb(color(list[i]));
    const dr = src.r - c.r;
    const dg = src.g - c.g;
    const db = src.b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = list[i];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 網點（ordered dither）
// ---------------------------------------------------------------------------

/** Bayer 4×4 門檻矩陣。 */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function bayerRows(level) {
  const rows = [];
  for (let y = 0; y < 4; y++) {
    let s = '';
    for (let x = 0; x < 4; x++) s += BAYER4[y][x] < level ? '1' : '0';
    rows.push(s);
  }
  return rows;
}

/**
 * 網點樣式：4 行 x 4 字元的 '0'/'1' 遮罩。
 * '1' 的位置畫前景色 a，其餘畫底色 b。
 */
export const DITHER = {
  solid: ['1111', '1111', '1111', '1111'],
  clear: ['0000', '0000', '0000', '0000'],
  checker: ['1010', '0101', '1010', '0101'], // 50% 棋盤
  b12: bayerRows(2),
  b25: bayerRows(4),
  b37: bayerRows(6),
  b50: bayerRows(8),
  b62: bayerRows(10),
  b75: bayerRows(12),
  b87: bayerRows(14),
  hline: ['1111', '0000', '1111', '0000'], // 橫條
  vline: ['1010', '1010', '1010', '1010'], // 直條
  diag: ['1100', '0110', '0011', '1001'], // 斜紋
  sparse: ['1000', '0000', '0010', '0000'], // 稀疏點
  dense: ['0111', '1111', '1101', '1111'], // 密集點
  // ── 大顆粒「塊狀」網點：同樣覆蓋率，但讀起來是色塊而不是細點 ──
  //（玩家反映 "there are many dot here" → 大面積改用這組，或直接改成實色）
  block12: ['1100', '0000', '0000', '0000'], // 12.5%（2×2 方塊）
  block25: ['1100', '1100', '0000', '0000'], // 25%（2×2 方塊）
  block50: ['1100', '1100', '0011', '0011'], // 50%（2×2 棋盤）
  line2h: ['1111', '1111', '0000', '0000'], // 50%（2px 橫線）
  line2v: ['1100', '1100', '1100', '1100'], // 50%（2px 直線）
};

const DITHER_LIST = Object.keys(DITHER);

function pickPattern(pattern) {
  if (pattern && typeof pattern === 'object' && pattern.length === 4) return pattern;
  return DITHER[pattern] || DITHER.b50;
}

/** 單點取樣：回傳 1 代表前景。 */
export function ditherMask(pattern, x, y) {
  const p = pickPattern(pattern);
  const row = p[((y | 0) % 4 + 4) % 4];
  return row.charCodeAt(((x | 0) % 4 + 4) % 4) === 49 ? 1 : 0;
}

/** 'clear' / null / undefined 代表「不畫底色」（保持透明）。 */
function isClear(c) {
  return c == null || c === 'clear' || c === 'transparent' || c === 'none';
}

/**
 * 精確網點矩形（逐點，適合小面積：牆面、傢俱陰影）。
 * 大面積請用 ditherPattern()。
 */
export function ditherRect(ctx, x, y, w, h, a, b, pattern) {
  const p = pickPattern(pattern);
  const clearB = isClear(b);
  const ca = color(a);
  const cb = clearB ? null : color(b);
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.round(w);
  const hh = Math.round(h);
  if (ww <= 0 || hh <= 0) return;
  if (ww * hh > 65536) return ditherPattern(ctx, x0, y0, ww, hh, a, b, pattern);
  let last = null;
  for (let yy = 0; yy < hh; yy++) {
    const row = p[((y0 + yy) % 4 + 4) % 4];
    // 把同一行切成等色段，降低 fillRect 次數
    let runStart = 0;
    let runColor = row.charCodeAt((x0 % 4 + 4) % 4) === 49 ? ca : cb;
    for (let xx = 1; xx <= ww; xx++) {
      const cc = xx === ww
        ? null
        : row.charCodeAt(((x0 + xx) % 4 + 4) % 4) === 49 ? ca : cb;
      if (cc !== runColor) {
        if (runColor && last !== runColor) {
          ctx.fillStyle = runColor;
          last = runColor;
        }
        if (runColor) ctx.fillRect(x0 + runStart, y0 + yy, xx - runStart, 1);
        runStart = xx;
        runColor = cc;
      }
    }
  }
}

/** 垂直網點條（欄寬 1px，常用於牆角陰影）。 */
export function ditherV(ctx, x, y, h, a, b, pattern) {
  ditherRect(ctx, x, y, 1, h, a, b, pattern);
}

/** 水平網點條。 */
export function ditherH(ctx, x, y, w, a, b, pattern) {
  ditherRect(ctx, x, y, w, 1, a, b, pattern);
}

let ditherCanvasFactory = null;
const ditherCanvasCache = new Map();
const patternCache = new Map();

/** 測試或非 DOM 環境可注入自己的 canvas 工廠。 */
export function setDitherCanvasFactory(fn) {
  ditherCanvasFactory = typeof fn === 'function' ? fn : null;
  ditherCanvasCache.clear();
  patternCache.clear();
}

function newCanvas(w, h) {
  if (ditherCanvasFactory) {
    const c = ditherCanvasFactory(w, h);
    if (c) return c;
  }
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    if (c) {
      c.width = w;
      c.height = h;
      return c;
    }
  }
  return null;
}

/** 產生（並快取）4×4 的網點素材 canvas；無 DOM 時回傳 null。 */
export function makeDitherCanvas(a, b, pattern) {
  const clearB = isClear(b);
  const key = color(a) + '|' + (clearB ? '@clear' : color(b)) + '|' + (typeof pattern === 'string' ? pattern : 'custom');
  const hit = ditherCanvasCache.get(key);
  if (hit !== undefined) return hit;
  const cv = newCanvas(4, 4);
  if (!cv) {
    ditherCanvasCache.set(key, null);
    return null;
  }
  const c2 = cv.getContext && cv.getContext('2d');
  if (!c2) {
    ditherCanvasCache.set(key, null);
    return null;
  }
  const p = pickPattern(pattern);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const on = p[y].charCodeAt(x) === 49;
      if (!on && clearB) continue; // 保持透明
      c2.fillStyle = on ? color(a) : color(b);
      c2.fillRect(x, y, 1, 1);
    }
  }
  ditherCanvasCache.set(key, cv);
  return cv;
}

/**
 * 大面積網點（天氣濾鏡、天空）。瀏覽器走 CanvasPattern（單次 fillRect）；
 * 無 canvas 環境降級為 4×4 粗網點，絕不丟例外。
 */
export function ditherPattern(ctx, x, y, w, h, a, b, pattern) {
  const ww = Math.round(w);
  const hh = Math.round(h);
  if (ww <= 0 || hh <= 0) return;
  const clearB = isClear(b);
  const cv = makeDitherCanvas(a, b, pattern);
  if (cv && typeof ctx.createPattern === 'function') {
    const key = color(a) + '|' + (clearB ? '@clear' : color(b)) + '|' + (typeof pattern === 'string' ? pattern : 'custom');
    let pat = patternCache.get(key);
    if (pat === undefined) {
      pat = ctx.createPattern(cv, 'repeat') || null;
      patternCache.set(key, pat);
    }
    if (pat) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = pat;
      ctx.fillRect(Math.round(x), Math.round(y), ww, hh);
      ctx.fillStyle = prev;
      return;
    }
  }
  ditherRectCoarse(ctx, x, y, ww, hh, a, b, pattern);
}

/** 降級路徑：以 4×4 為單位取多數色塊。 */
function ditherRectCoarse(ctx, x, y, w, h, a, b, pattern) {
  const p = pickPattern(pattern);
  const clearB = isClear(b);
  let ones = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (p[i].charCodeAt(j) === 49) ones++;
  if (ones === 16) {
    ctx.fillStyle = color(a);
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (ones === 0) {
    if (!clearB) {
      ctx.fillStyle = color(b);
      ctx.fillRect(x, y, w, h);
    }
    return;
  }
  const ca = color(a);
  const cb = clearB ? null : color(b);
  for (let yy = 0; yy < h; yy += 4) {
    for (let xx = 0; xx < w; xx += 4) {
      const on = p[(yy >> 2) & 3].charCodeAt((xx >> 2) & 3) === 49;
      const col = on ? ca : cb;
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x + xx, y + yy, Math.min(4, w - xx), Math.min(4, h - yy));
      }
    }
  }
}

/** 兩個調色盤色的網點名稱（給色票表／UI 用）。 */
export function ditherNames() {
  return DITHER_LIST.slice();
}

// ---------------------------------------------------------------------------
// 時段天空配色（街景用；皆為硬邊色帶 + 網點，不是漸層）
// ---------------------------------------------------------------------------

export const SKY_TOD = {
  morning: {
    top: '#6fa8d4', mid: '#a8cddf', low: '#f0cfa0', haze: '#ffe6bc',
    orb: '#fff2c0', far: '#8f9fb4', mid2: '#728196', near: '#525d72',
    window: '#ffe2a8', star: null, neon: 0.35,
  },
  noon: {
    top: '#5ba3dd', mid: '#93c8e8', low: '#cfe6f2', haze: '#eaf6fb',
    orb: '#fffce0', far: '#a8b4c0', mid2: '#8a97a6', near: '#66707e',
    window: '#e8e2c4', star: null, neon: 0.2,
  },
  evening: {
    top: '#3d4a80', mid: '#a05a7a', low: '#e8894a', haze: '#ffb070',
    orb: '#ffd070', far: '#6a5a78', mid2: '#4e4462', near: '#332c44',
    window: '#ffd070', star: '#fff0c0', neon: 0.8,
  },
  night: {
    top: '#0e1730', mid: '#16233f', low: '#26365c', haze: '#3a4a72',
    orb: '#f0f0d8', far: '#1b2438', mid2: '#141c2e', near: '#0d1220',
    window: '#ffcf70', star: '#e8f0ff', neon: 1,
  },
};

/** 取得時段配色（未知時段回傳夜）。 */
export function skyFor(timeOfDay) {
  return SKY_TOD[timeOfDay] || SKY_TOD.night;
}

/** 天氣濾鏡主要色（給 floor.js / UI 參考）。 */
export const WEATHER_TINT = {
  sunny: { dark: 'lamp_md', light: 'lamp_hi' },
  cloudy: { dark: 'gray_30', light: 'gray_70' },
  rain: { dark: 'sky_lo', light: 'sky_md' },
  storm: { dark: 'outline_cool', light: 'sky_lo' },
  cold: { dark: 'sky_lo', light: 'sky_hi' },
  heat: { dark: 'lamp_sh', light: 'lamp_md' },
};

/**
 * 時段室內氛圍：以「網點圖層」壓在房間剪影上（不是漸層、不是 alpha 漸變）。
 * layers 依序疊加，pattern 的覆蓋率決定壓暗／提亮幅度；lamps/neon 決定燈光強度。
 */
export const TOD_TINT = {
  morning: { key: 'morning', label: '早晨（冷、微藍）', layers: [{ c: 'dawn_tint', p: 'b12' }], lamps: 0.3, neon: 0 },
  noon: { key: 'noon', label: '中午（中性）', layers: [], lamps: 0, neon: 0 },
  evening: { key: 'evening', label: '傍晚（暖琥珀、開始點燈）', layers: [{ c: 'dusk_tint', p: 'b12' }], lamps: 0.65, neon: 0.5 },
  night: { key: 'night', label: '夜晚（壓暗偏藍，靠燈光與霓虹）', layers: [{ c: 'night_tint', p: 'b25' }], lamps: 1, neon: 1 },
};

/** 取得時段氛圍（未知 → 中午＝完全不變色）。 */
export function todTint(timeOfDay) {
  return TOD_TINT[timeOfDay] || TOD_TINT.noon;
}

export default PALETTE;
