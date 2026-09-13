// src/render/floor.js
// 《夢幻西餐廳》復刻 — 等角平面渲染器。
//
// 契約：docs/ARCHITECTURE.md §6 RENDER 契約。
// 繪製順序：
//   背景 → 窗外街景（在牆後面）→ 地板 → 牆面／門／出餐口 → 依 (x + y) 排序的
//   傢俱與人物（畫家演算法，人物與傢俱交錯）→ 天氣 → 網格 → 幽靈傢俱 →
//   滑鼠提示框 → 心情氣泡 → 除錯路徑。
//
// 本檔只讀 state，永不修改；所有欄位讀取皆為防禦式（缺欄位／型別錯誤都不會丟例外）。

import { PALETTE, color, ditherPattern, ditherRect, DITHER, todTint } from './palette.js';
import {
  TILE_W, TILE_H, GRID_W, GRID_H, LOGICAL_W, LOGICAL_H, ORIGIN_X, ORIGIN_Y, HALF_W, HALF_H,
  tileToScreen, screenToTile, screenToTileF, tileDepth, footprintCenter, footprintCorners,
  gridBounds, backWallRidge, skyPolygon, roomSilhouette, pointInFootprint, pointInDiamond, clampTile,
  timeOfDayFromMinute,
} from './iso.js';
import {
  WALL_H, NEAR_WALL_H, drawPerson, drawFurniture, drawTile, drawSkyline, drawWeather,
  drawBubble, bubbleKind, appearanceFromSeed, spriteCacheInfo,
  DEFAULT_TILE_PAL, makeTilePalette, resolveFurnitureArt,
  drawLightPool, drawGlow, drawSteam, drawContactShadow, drawPuddle, drawBreath, drawSplash, drawNeonSpill,
  drawStreetProp, drawWires, drawKitchenProp, drawAOOverlay,
} from './sprites.js';
import { getDish } from '../data/dishes.js';

export {
  TILE_W, TILE_H, GRID_W, GRID_H, ORIGIN_X, ORIGIN_Y, LOGICAL_W, LOGICAL_H,
  tileToScreen, screenToTile, tileDepth,
};

/** 會發光的傢俱美術 key（決定地板光池位置）。 */
const LAMP_ARTS = { lamp: 1, ceiling_lamp: 1, lantern_string: 1, neon_sign: 1, tv: 1 };
/** 緊鄰牆壁時要改成「壁掛」的美術 key（裝飾品躺在地上的 bug）。 */
const WALL_MOUNT_ARTS = {
  painting: 1, neon_sign: 1, lantern_string: 1, clock: 1, banner: 1, mirror: 1,
  menu_board: 1, tv: 1, infrared: 1, aircon: 1, cctv: 1, hand_dryer: 1, urinal: 1,
};
/** 坐姿／用餐姿勢對應的顧客狀態。 */
const SEATED_POSE_STATES = { SEATED: 'seated', ORDERING: 'seated', WAITING_FOOD: 'seated', PAYING: 'seated', EATING: 'eat' };
/** 端盤中的員工狀態關鍵字（沿用既有 state 欄位，不新增欄位）。 */
const CARRY_RE = /deliver|serve|carry|tray|buser|serving|food/i;

const EMPTY_LAYOUT = Object.freeze({
  gridW: GRID_W, gridH: GRID_H, tiles: [], items: [], entrances: [], passTiles: [], restroom: null,
});

/** 地點 → 窗外街景（對應 docs/ARCHITECTURE.md §2.3 locations[].skyline）。 */
export const LOCATION_SKYLINE = {
  zhongli_xinming: 'nightmarket',
  keelung_miaokou: 'harbor',
  taipei_nanyang: 'office',
  taichung_zhonghua: 'nightstreet',
  tainan_dongdi: 'mall',
  kaohsiung_xinkujiang: 'fashion',
};

/**
 * 地點配色後備表（對應 src/data/locations.js 的 palette）。
 * state/view 若直接帶了 palette 物件則以它為準；這裡只在天氣／地點資料沒傳進來時使用，
 * 確保換地點時地板與牆面顏色真的會跟著變。
 */
export const LOCATION_PALETTE = {
  zhongli_xinming: { sky: '#1b2340', wall: '#c9a26b', floor: '#8c6a44', accent: '#e8552e' },
  keelung_miaokou: { sky: '#243b52', wall: '#b9c3c9', floor: '#6f7d86', accent: '#2f8fb5' },
  taipei_nanyang: { sky: '#3a4658', wall: '#cfc7a8', floor: '#7d7460', accent: '#c9a227' },
  taichung_zhonghua: { sky: '#2b1f3a', wall: '#d2a35c', floor: '#8a6a46', accent: '#e0457b' },
  tainan_dongdi: { sky: '#3c4a3a', wall: '#e0d3b0', floor: '#9a8a6c', accent: '#a8562f' },
  kaohsiung_xinkujiang: { sky: '#22243c', wall: '#d8d2e0', floor: '#6d6a80', accent: '#00b3b0' },
};

/** 從 state / view 取出地點 palette（找不到回 null）。 */
export function paletteSpecOf(state, view) {
  const V = isObj(view) ? view : null;
  if (V) {
    if (isObj(V.palette)) return V.palette;
    if (isObj(V.locationPalette)) return V.locationPalette;
  }
  const S = isObj(state) ? state : null;
  if (S) {
    if (isObj(S.locationPalette)) return S.locationPalette;
    if (isObj(S.palette)) return S.palette;
    if (isObj(S.location) && isObj(S.location.palette)) return S.location.palette;
  }
  return null;
}

const PAL_MEMO = { id: '', spec: null, pal: null };

/**
 * 解析本場地要用的地板／牆面配色，回傳 sprites.js 的 tile palette
 * （含 key，供 sprite 快取分區）；沒有地點配色時回傳預設色階（完全不變色）。
 */
export function resolveTilePalette(state, view) {
  const spec = paletteSpecOf(state, view);
  const id = isObj(state) && typeof state.locationId === 'string' ? state.locationId : '';
  if (PAL_MEMO.spec === spec && PAL_MEMO.id === id && PAL_MEMO.pal) return PAL_MEMO.pal;
  const use = spec || LOCATION_PALETTE[id] || null;
  let pal = DEFAULT_TILE_PAL;
  if (use) {
    const key = spec
      ? `v:${id}:${use.floor || ''}:${use.wall || ''}:${use.accent || ''}`
      : `L:${id}`;
    pal = makeTilePalette(use, key);
  }
  PAL_MEMO.id = id;
  PAL_MEMO.spec = spec;
  PAL_MEMO.pal = pal;
  return pal;
}

/** 顧客被視為「坐著」的狀態（用坐姿 sprite）。 */
const SEATED_STATES = { SEATED: 1, ORDERING: 1, WAITING_FOOD: 1, EATING: 1, PAYING: 1, BUS: 0 };

const TILE_FLOOR_ART = { floor: 'floor', kitchen: 'kitchen', restroom: 'restroom', door: 'floor' };
const TILE_WALL_ART = { wall: 'wall', door: 'door', pass: 'pass' };

const BLACK_BG = 'black';

function num(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function isObj(v) {
  return !!v && typeof v === 'object';
}

function arr(v) {
  return Array.isArray(v) ? v : null;
}

/** 依 store 狀態推導時段／天氣（缺欄位時給合理預設）。 */
export function weatherOf(state) {
  const S = isObj(state) ? state : {};
  const sim = isObj(S.sim) ? S.sim : null;
  const today = isObj(S.stats) && isObj(S.stats.today) ? S.stats.today : null;
  const w = S.weather || (sim && sim.weather) || (today && today.weather) || 'sunny';
  return typeof w === 'string' ? w : 'sunny';
}

export function skylineOf(state, view) {
  const V = isObj(view) ? view : {};
  if (typeof V.skyline === 'string') return V.skyline;
  const S = isObj(state) ? state : {};
  if (typeof S.skyline === 'string') return S.skyline;
  if (isObj(S.location) && typeof S.location.skyline === 'string') return S.location.skyline;
  return (S.locationId && LOCATION_SKYLINE[S.locationId]) || 'nightmarket';
}

function tileIndex(gw, x, y) {
  return y * gw + x;
}

function hashCode32(v) {
  let h = (v | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// 由 store 狀態推導顧客心情氣泡（sim 沒給 bubble 時的後備）。
const WAIT_STATES = { QUEUEING: 1, WAITING_FOOD: 1, ESCORTED: 1, ORDERING: 1 };
const LEAVE_STATES = { ANGRY_LEAVE: 1, LEAVING: 1 };

function moodBubble(c) {
  if (!isObj(c)) return null;
  if (typeof c.bubble === 'string' && c.bubble) return c.bubble;
  if (typeof c.bubbleKind === 'string' && c.bubbleKind) return c.bubbleKind;
  const st = typeof c.state === 'string' ? c.state : '';
  const mood = num(c.mood, 0);
  if (LEAVE_STATES[st] && mood < -10) return 'anger';
  if (mood <= -55) return 'rage';
  if (mood <= -25) return 'anger';
  if (mood <= -8) return 'sad';
  if (mood >= 55) return 'love';
  if (mood >= 25) return 'happy';
  if (WAIT_STATES[st] && num(c.waiting, 0) > 60) return 'wait';
  if (st === 'PAYING') return 'money';
  return null;
}

// ===========================================================================
// 主渲染器
// ===========================================================================

export class FloorRenderer {
  /**
   * @param {HTMLCanvasElement} canvas 邏輯尺寸 640×400 的畫布
   * @param {{tileW?:number, tileH?:number, originX?:number, originY?:number, width?:number, height?:number, wallHeight?:number}} [opts]
   */
  constructor(canvas, opts = {}) {
    const o = isObj(opts) ? opts : {};
    this.canvas = canvas || null;
    this.ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    this.tileW = num(o.tileW, TILE_W);
    this.tileH = num(o.tileH, TILE_H);
    this.originX = num(o.originX, ORIGIN_X);
    this.originY = num(o.originY, ORIGIN_Y);
    this.wallHeight = num(o.wallHeight, WALL_H);
    this.nearWallHeight = num(o.nearWallHeight, NEAR_WALL_H);
    this._optW = num(o.width, 0) || 0;
    this._optH = num(o.height, 0) || 0;
    this.w = this._optW || LOGICAL_W;
    this.h = this._optH || LOGICAL_H;

    this.layout = EMPTY_LAYOUT;
    this.gridW = GRID_W;
    this.gridH = GRID_H;
    this._layoutRef = null;
    this._sortedItems = [];
    this._itemSig = -1;
    this._backdrop = null;
    this._backdropKey = '';
    this._lastFrame = null;

    // 重用容器（避免每影格配置）
    this._list = [];
    this._pool = [];
    this._poolN = 0;
    this._people = [];
    this._peopleN = 0;
    this._bubbles = [];
    this._bubbleN = 0;
    this._hitItems = [];
    this._hitItemsN = 0;
    this._hitPeople = [];
    this._hitPeopleN = 0;
    this._itemRecs = [];
    this._peopleRecs = [];
    this._bubblePool = [];
    this._ghostHit = null;
    this._occupied = null;
    this._lampSig = '';
    this._lampList = [];
    this._motion = new Map();
    this._occ = null;
    this._occPool = null;
    this._equipBroken = null;
    this._tod = 'noon';
    this._tt = todTint('noon');
    this._tick = 0;
    this._weather = 'sunny';
  }

  // ── 幾何 ────────────────────────────────────────────────────────────────

  tileToScreen(x, y) {
    return tileToScreen(x, y, this.originX, this.originY);
  }

  screenToTile(px, py) {
    return screenToTile(px, py, this.originX, this.originY);
  }

  /** 螢幕座標 → 浮點格座標。 */
  screenToTileF(px, py) {
    return screenToTileF(px, py, this.originX, this.originY);
  }

  /** 腳印中心（螢幕座標）。 */
  footprintCenter(x, y, w, h) {
    return footprintCenter(x, y, w, h, this.originX, this.originY);
  }

  // ── 版面快取 ────────────────────────────────────────────────────────────

  /** 更新 tiles/items 快取（items 會依 x+y 預排序）。 */
  setLayout(layout) {
    this._layoutRef = layout || null;
    if (!isObj(layout)) {
      this.layout = EMPTY_LAYOUT;
      this.gridW = GRID_W;
      this.gridH = GRID_H;
      this._sortedItems = [];
      this._itemSig = -1;
      this._occupied = null;
      return this.layout;
    }
    const gw = Math.max(1, Math.round(num(layout.gridW, GRID_W)));
    const gh = Math.max(1, Math.round(num(layout.gridH, GRID_H)));
    const tiles = arr(layout.tiles) ? layout.tiles : [];
    const items = arr(layout.items) ? layout.items : [];
    this.gridW = gw;
    this.gridH = gh;
    this.layout = {
      gridW: gw,
      gridH: gh,
      tiles,
      items,
      entrances: arr(layout.entrances) || [],
      passTiles: arr(layout.passTiles) || [],
      restroom: isObj(layout.restroom) ? layout.restroom : null,
      raw: layout,
    };
    this._sortedItems = items.filter(isObj);
    this._itemSig = -1;
    this._occupied = null;
    this._items();
    this._backdrop = null;
    this._backdropKey = '';
    return this.layout;
  }

  /** 取得（必要時重建）排序後的 items；位置變動會自動重排並重建佔用圖。 */
  _items() {
    const list = this._sortedItems;
    let sig = list.length;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      sig = (sig * 31 + (num(it.x, 0) | 0) * 7 + (num(it.y, 0) | 0) * 13 + (it.uid ? String(it.uid).length : 0)) | 0;
    }
    if (sig !== this._itemSig) {
      this._itemSig = sig;
      list.sort(compareItems);
      this._rebuildOccupancy();
    }
    return list;
  }

  /** 傢俱佔用格（給建置模式網格／放置檢查用）。 */
  _rebuildOccupancy() {
    const gw = this.gridW;
    const gh = this.gridH;
    const occ = new Uint8Array(gw * gh);
    const list = this._sortedItems;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const w = Math.max(1, Math.round(num(it.w, 1)));
      const h = Math.max(1, Math.round(num(it.h, 1)));
      const x0 = Math.round(num(it.x, 0));
      const y0 = Math.round(num(it.y, 0));
      for (let y = y0; y < y0 + h; y++) {
        if (y < 0 || y >= gh) continue;
        for (let x = x0; x < x0 + w; x++) {
          if (x < 0 || x >= gw) continue;
          occ[y * gw + x] = 1;
        }
      }
    }
    this._occupied = occ;
  }

  // ── 尺寸 ────────────────────────────────────────────────────────────────

  _syncSize() {
    const c = this.canvas;
    const w = this._optW || (c && num(c.width, 0)) || LOGICAL_W;
    const h = this._optH || (c && num(c.height, 0)) || LOGICAL_H;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this._backdrop = null;
      this._backdropKey = '';
    }
  }

  // ── 主繪製 ──────────────────────────────────────────────────────────────

  /**
   * @param {object} state 遊戲狀態（唯讀）
   * @param {object} [view] {frame, hover:{x,y}, ghost:{typeId,x,y,valid,rot,w,h}, selectionUid,
   *                          showGrid, focusItemUid, debugPaths, hoverCustomerUid, tick,
   *                          timeOfDay, weather, skyline}
   */
  render(state, view) {
    const ctx = this.ctx;
    if (!ctx) return;
    const S = isObj(state) ? state : {};
    const V = isObj(view) ? view : {};
    this._syncSize();

    const layout = isObj(S.layout) ? S.layout : null;
    if (layout && layout !== this._layoutRef) this.setLayout(layout);
    const L = this.layout || EMPTY_LAYOUT;
    const gw = this.gridW;
    const gh = this.gridH;

    const frame = Math.round(num(V.frame, 0));
    const tick = num(V.tick, frame);
    // 繪製階段標記：測試用的 draw-call log 可以斷言「光池一定早於任何 item／人物」
    const mark = typeof ctx.__mark === 'function' ? ctx.__mark : null;
    const stage = (n) => { if (mark) mark(n); };
    const tod = typeof V.timeOfDay === 'string' ? V.timeOfDay : timeOfDayFromMinute(num(S.minute, 720));
    const weather = typeof V.weather === 'string' ? V.weather : weatherOf(S);
    const skyline = skylineOf(S, V);
    const pal = resolveTilePalette(S, V);
    const T = todTint(tod);
    this._pal = pal;
    this._tod = tod;
    this._tt = T;
    this._tick = tick;
    this._weather = weather;

    this._lastFrame = { gw, gh, frame, tod, weather, skyline, pal: pal.key };

    // 0) 背景 + 窗外街景（在牆後面）
    stage('backdrop');
    this._drawBackdrop(ctx, gw, gh, tod, skyline);
    // 0b) 雨天：騎樓水窪 + 漣漪
    if (weather === 'rain' || weather === 'storm') this._drawPavementPuddles(ctx, gw, gh, tick);
    // 1) 地板（依地點配色 + 污漬連動 + 周邊收邊帶）
    stage('floors');
    this._drawFloors(ctx, L, gw, gh, frame, pal, S);
    // 1b) 地板層燈光：光池 / 出餐口暖光 / 窗邊霓虹溢光（一律在牆與傢俱之前）
    stage('floorlights');
    this._drawFloorLights(ctx, L, gw, gh, tick, T, pal);
    stage('floorlights-end');
    // 1c) 牆腳環境光遮蔽（AO）
    stage('ao');
    this._drawWallAO(ctx, L, gw, gh);
    // 1d) 廚房固定道具（沒買設備也像廚房）
    this._drawKitchenProps(ctx, L, gw, gh, tick, S);
    // 2) 牆面／門／出餐口
    stage('walls');
    this._drawWalls(ctx, L, gw, gh, tod, frame, pal, weather);
    // 2b) 廚房蒸氣／爐火故障（在傢俱之前，才不會蓋住桌椅）
    this._drawKitchenLife(ctx, S, L, gw, gh, tick);
    // 3) 傢俱與人物（畫家演算法）
    stage('items');
    this._drawSorted(ctx, S, L, gw, gh, frame, pal);
    stage('items-end');
    // 4) 時段氛圍（網點裁切在房間剪影內）
    stage('ambience');
    this._drawAmbience(ctx, L, gw, gh, tick, tod, T, pal);
    // 4a) 室內氛圍：四角網點暗角 + 出餐口暖光 + 門口戶外光灑進來
    this._drawInteriorMood(ctx, L, gw, gh, tick, T, pal);
    // 4b) 冷天吐氣、熱浪地面霧氣
    this._drawWeatherScene(ctx, S, gw, gh, tick, weather);
    // 5) 天氣全畫面覆蓋
    if (weather && weather !== 'none') drawWeather(ctx, weather, this.w, this.h, tick);
    // 6) 網格
    if (V.showGrid) this._drawGrid(ctx, L, gw, gh);
    // 7) 幽靈傢俱
    if (isObj(V.ghost)) this._drawGhost(ctx, V.ghost, frame);
    // 8) 滑鼠提示框
    this._drawHover(ctx, V, frame);
    // 9) 心情氣泡
    this._drawBubbles(ctx, frame);
    // 10) 除錯路徑
    if (V.debugPaths) this._drawDebug(ctx, S, frame);
  }

  // ── 房間剪影（供氛圍裁切） ──────────────────────────────────────────────

  _roomPath(ctx, gw, gh) {
    const poly = roomSilhouette(gw, gh, this.wallHeight, this.originX, this.originY);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  /** 取得（並快取）版面中的發光傢俱清單。 */
  _lamps() {
    const items = this._items();
    const sig = items.length + ':' + this._itemSig;
    if (this._lampSig === sig) return this._lampList;
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = resolveFurnitureArt(it.typeId, { seats: num(it.seats, 0) });
      if (!LAMP_ARTS[key]) continue;
      const w = Math.max(1, Math.round(num(it.w, 1)));
      const h = Math.max(1, Math.round(num(it.h, 1)));
      const c = this.footprintCenter(num(it.x, 0), num(it.y, 0), w, h);
      out.push({ key, x: c.px, y: c.py, uid: it.uid });
    }
    this._lampSig = sig;
    this._lampList = out;
    return out;
  }

  // ── 地板光池 ────────────────────────────────────────────────────────────

  _drawFloorLights(ctx, L, gw, gh, tick, T, pal) {
    if (T.lamps <= 0 && T.neon <= 0) return;
    if (T.lamps > 0) {
      const lamps = this._lamps();
      for (let i = 0; i < lamps.length; i++) {
        const lp = lamps[i];
        if (lp.key === 'neon_sign') continue; // 霓虹是彩色溢光，另外畫
        const seed = hashCode32(i * 7 + 3) & 15;
        const under = lp.key === 'lantern_string' ? 6 : 2;
        drawLightPool(ctx, lp.x, lp.y + under, HALF_W * 1.4, HALF_H * 1.5, T.lamps, tick, { seed });
      }
      // 出餐口暖光池
      const pass = arr(L.passTiles);
      if (pass && pass.length) {
        for (let i = 0; i < pass.length; i++) {
          const p = pass[i];
          if (!isObj(p)) continue;
          const c = this.tileToScreen(num(p.x, 0), num(p.y, 0));
          drawLightPool(ctx, c.px, c.py + 3, HALF_W * 1.2, HALF_H * 1.4, T.lamps * 0.85, tick, { seed: 5 });
        }
      }
      // 門口暖光（迎賓）
      const ent = arr(L.entrances);
      if (ent && ent[0] && isObj(ent[0])) {
        const e0 = ent[0];
        const c = this.tileToScreen(num(e0.x, 0), num(e0.y, 0));
        drawLightPool(ctx, c.px, c.py + 4, HALF_W * 1.1, HALF_H * 1.2, T.lamps * 0.7, tick, { seed: 9 });
      }
    }
    // 夜晚：窗邊霓虹溢光（地點強調色）落在地板上，3 幀閃爍 + 偶發熄滅
    if (T.neon > 0) {
      const accent = pal.accent;
      for (let y = 1; y < Math.min(gh, 4); y++) {
        for (let x = 1; x < Math.min(gw, 4); x++) {
          // 只畫在「緊鄰窗牆的室內地板格」，牆面本身不畫
          if (!(x === 1 || y === 1)) continue;
          if (this.tileAt(x, y) !== 'floor') continue;
          const c = this.tileToScreen(x, y);
          const seed = (x * 3 + y * 5) & 7;
          drawNeonSpill(ctx, c.px, c.py + 2, HALF_W * 0.85, HALF_H * 1.0, accent, T.neon, tick, seed);
        }
      }
    }
  }

  // ── 氛圍（時段網點，裁切在房間剪影內） ─────────────────────────────────

  _drawAmbience(ctx, L, gw, gh, tick, tod, T, pal) {
    if (!T.layers.length) return;
    ctx.save();
    this._roomPath(ctx, gw, gh);
    ctx.clip();
    const poly = roomSilhouette(gw, gh, this.wallHeight, this.originX, this.originY);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      if (poly[i].x < minX) minX = poly[i].x;
      if (poly[i].x > maxX) maxX = poly[i].x;
      if (poly[i].y < minY) minY = poly[i].y;
      if (poly[i].y > maxY) maxY = poly[i].y;
    }
    for (let i = 0; i < T.layers.length; i++) {
      const ly = T.layers[i];
      ditherPattern(ctx, minX, minY, maxX - minX, maxY - minY, ly.c, 'clear', ly.p);
    }
    ctx.restore();
  }

  // ── 廚房動態 ────────────────────────────────────────────────────────────

  _drawKitchenLife(ctx, S, L, gw, gh, tick) {
    const sim = isObj(S.sim) ? S.sim : null;
    const kitchen = sim ? arr(sim.kitchen) : null;
    const busy = kitchen ? Math.min(1, kitchen.length / 3) : 0.4;
    const pass = arr(L.passTiles);
    if (pass) {
      for (let i = 0; i < pass.length; i++) {
        const p = pass[i];
        if (!isObj(p)) continue;
        const c = this.tileToScreen(num(p.x, 0), num(p.y, 0));
        drawSteam(ctx, c.px, c.py - 18, tick, 0.35 + busy * 0.65, 12);
      }
    }
    // 爐具故障：火星亂跳的「故障」指示
    const eq = sim && isObj(sim.equipBroken) ? sim.equipBroken : null;
    if (eq && eq.stove) {
      const items = this._items();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!/stove|range|cook/i.test(String(it.typeId))) continue;
        const w = Math.max(1, Math.round(num(it.w, 1)));
        const h = Math.max(1, Math.round(num(it.h, 1)));
        const c = this.footprintCenter(num(it.x, 0), num(it.y, 0), w, h);
        const ph = (tick >> 1) % 4;
        ctx.fillStyle = color(ph < 2 ? 'hp_warn' : 'hp_bad');
        ctx.fillRect(Math.round(c.px) - 3, Math.round(c.py) - 30 - ph, 6, 2);
        ctx.fillRect(Math.round(c.px) - 1, Math.round(c.py) - 36 - ph, 2, 6);
      }
    }
  }

  // ── 天氣相關場景元素 ────────────────────────────────────────────────────

  _drawPavementPuddles(ctx, gw, gh, tick) {
    const pad = 3;
    for (let i = 0; i < 7; i++) {
      const h1 = hashCode32(i * 17 + 5);
      const h2 = hashCode32(i * 29 + 11);
      const tx = -pad + (h1 % (gw + pad * 2));
      const ty = -pad + (h2 % (gh + pad * 2));
      if (tx > -1 && tx < gw && ty > -1 && ty < gh) continue; // 室內不畫水窪
      const c = this.tileToScreen(tx, ty);
      const rx = HALF_W * (0.5 + ((h1 >> 4) % 5) / 10);
      drawPuddle(ctx, c.px, c.py, rx, HALF_H * 0.55, tick, i * 3);
    }
  }

  _drawWeatherScene(ctx, S, gw, gh, tick, weather) {
    if (weather === 'heat') {
      // 熱浪：夜間只在地板層加一點暖霧（縮在房間中央，不蓋天空與街景）
      const tod = this._tod;
      if (tod === 'night' || tod === 'evening') {
        const c = this.footprintCenter(0, 0, gw, gh);
        drawLightPool(ctx, c.px, c.py + 10, HALF_W * 3.2, HALF_H * 2.4, 0.3, tick, { seed: 3 });
      }
      return;
    }
    if (weather !== 'cold') return;
    // 寒流：人物吐白煙
    for (let i = 0; i < this._hitPeopleN; i++) {
      const rec = this._hitPeople[i];
      if (!rec || !rec.ref) continue;
      const ref = rec.ref;
      const p = this.tileToScreen(num(ref.x, 0), num(ref.y, 0));
      drawBreath(ctx, p.px + 6, p.py - 28, tick, i * 4);
    }
  }

  // ── 背景 + 街景 ─────────────────────────────────────────────────────────

  _drawBackdrop(ctx, gw, gh, tod, skyline) {
    const key = `${this.w}x${this.h}|${gw}x${gh}|${this.wallHeight}|${tod}|${skyline}`;
    if (this._backdropKey !== key || !this._backdrop) {
      const cv = this._makeBackdrop(key, gw, gh, tod, skyline);
      this._backdrop = cv;
      this._backdropKey = cv ? key : '';
    }
    if (this._backdrop) {
      ctx.drawImage(this._backdrop, 0, 0);
      return;
    }
    // 無離屏 canvas 時的即時版本
    this._paintBackdrop(ctx, gw, gh, tod, skyline);
  }

  _makeBackdrop(key, gw, gh, tod, skyline) {
    const W = Math.max(8, Math.round(this.w));
    const H = Math.max(8, Math.round(this.h));
    let cv = null;
    try {
      if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
        cv = document.createElement('canvas');
      }
    } catch (e) {
      cv = null;
    }
    if (!cv) return null;
    cv.width = W;
    cv.height = H;
    const c = typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
    if (!c) return null;
    this._paintBackdrop(c, gw, gh, tod, skyline);
    try {
      cv.__spriteKey = 'bg|' + key;
    } catch (e) {
      /* 忽略 */
    }
    return cv;
  }

  _paintBackdrop(ctx, gw, gh, tod, skyline) {
    const W = this.w;
    const H = this.h;
    const ox = this.originX;
    const oy = this.originY;
    // 店外：暖色柏油／騎樓（刻意比室內地板暗，但遠離全黑，避免整個畫面糊掉）
    ctx.fillStyle = color('pave_lo');
    ctx.fillRect(0, 0, W, H);
    ditherPattern(ctx, 0, 0, W, H, 'pave', 'pave_lo', DITHER.b25);

    const pad = 3; // 店外留 3 格騎樓／柏油
    const pw = gw + pad * 2;
    const ph = gh + pad * 2;
    const stall = footprintCenter(-pad, -pad, pw, ph, ox, oy);
    const halfW = ((pw + ph) / 2) * HALF_W;
    const halfH = ((pw + ph) / 2) * HALF_H;
    // 騎樓本體：再亮一階 + 稀疏亮點，讀起來才像鋪面而不是黑洞
    this._ditherDiamond(ctx, stall.px, stall.py - halfH, halfW * 2, halfH * 2, 'pave', DITHER.b50);
    this._ditherDiamond(ctx, stall.px, stall.py - halfH, halfW * 2, halfH * 2, 'pave_hi', DITHER.b25);
    // 騎樓地磚接縫（等角方向的兩組線；比鋪面暗一階但不至於變黑）
    ctx.strokeStyle = color('pave_lo');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -pad; i <= gw + pad; i++) {
      const a = tileToScreen(i, -pad, ox, oy);
      const b = tileToScreen(i, gh + pad - 1, ox, oy);
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
    }
    for (let j = -pad; j <= gh + pad; j++) {
      const a = tileToScreen(-pad, j, ox, oy);
      const b = tileToScreen(gw + pad - 1, j, ox, oy);
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
    }
    ctx.stroke();
    // 建物落在地面的硬邊影子（網點，不用漸層）
    const sp = 1;
    const pws = gw + sp * 2;
    const phs = gh + sp * 2;
    const s2 = footprintCenter(-sp, -sp, pws, phs, ox, oy);
    this._ditherDiamond(ctx, s2.px, s2.py - ((pws + phs) / 2) * HALF_H + 5, ((pws + phs) / 2) * HALF_W * 2, ((pws + phs) / 2) * HALF_H * 2, 'shadow', DITHER.b50);
    // 路緣：外圈深色 + 上緣亮一階
    ctx.strokeStyle = color('pave_curb');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(stall.px), Math.round(stall.py - halfH));
    ctx.lineTo(Math.round(stall.px + halfW), Math.round(stall.py));
    ctx.lineTo(Math.round(stall.px), Math.round(stall.py + halfH));
    ctx.lineTo(Math.round(stall.px - halfW), Math.round(stall.py));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = color('pave_hi');
    ctx.beginPath();
    ctx.moveTo(Math.round(stall.px - halfW + 2), Math.round(stall.py + 1));
    ctx.lineTo(Math.round(stall.px), Math.round(stall.py - halfH + 2));
    ctx.lineTo(Math.round(stall.px + halfW - 2), Math.round(stall.py + 1));
    ctx.stroke();

    // 街景：只在後牆屋脊以上可見（用多邊形裁切）
    const ridge = backWallRidge(gw, gh, this.wallHeight, ox, oy);
    const x0 = Math.floor(ridge[0].x) - 4;
    const x1 = Math.ceil(ridge[2].x) + 4;
    const yBot = Math.ceil(Math.max(ridge[0].y, ridge[2].y)) + 16;
    const sw = Math.max(16, x1 - x0);
    const sh = Math.max(16, yBot);
    const poly = skyPolygon(gw, gh, this.wallHeight, ox, oy);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip();
    drawSkyline(ctx, skyline, x0, 0, sw, sh, tod, { horizon: Math.round(ridge[1].y) });
    ctx.restore();

    // 店外靜態街景道具（烤進 backdrop，每影格零成本）
    this._paintStreetProps(ctx, gw, gh, skyline, tod);
  }

  /**
   * 店外街景道具：依 skyline 種類擺放路燈、電線桿＋電線、機車／腳踏車、
   * 垃圾桶、水溝蓋、變電箱、盆栽。位置以固定表決定（決定性、不影響路人走道）。
   */
  _paintStreetProps(ctx, gw, gh, skyline, tod) {
    const kind = typeof skyline === 'string' ? skyline : 'nightmarket';
    const night = tod === 'night' || tod === 'evening';
    const put = (prop, tx, ty, opts) => {
      const p = this.tileToScreen(tx, ty);
      drawStreetProp(ctx, prop, p.px, p.py + 2, Object.assign({ glowing: night }, opts || {}));
      return p;
    };
    // 南側（畫面下方）騎樓：路燈整排 + 機車／腳踏車 + 垃圾桶
    const lampXs = [1, 6, 11, 16];
    const lampPts = [];
    for (let i = 0; i < lampXs.length; i++) lampPts.push(put('lamp', lampXs[i], gh + 2));
    // 電線桿（左右各兩根）＋電線
    const poleA = put('pole', -1, 3);
    const poleB = put('pole', -1, 9);
    const poleC = put('pole', gw + 1, 1);
    const poleD = put('pole', gw + 1, 7);
    drawWires(ctx, poleA.px + 2, poleA.py - 42, poleB.px + 2, poleB.py - 42, 5);
    drawWires(ctx, poleC.px + 2, poleC.py - 42, poleD.px + 2, poleD.py - 42, 5);
    // 停放載具（靠近門口，但不在走道上）
    put('scooter', 8, gh + 1, { bodyCol: 'teal_md' });
    put('scooter', 14, gh + 1, { bodyCol: 'red_md' });
    put('bike', 4, gh + 1);
    put('bike', 18, gh + 2);
    // 街道家具
    put('bin', 2, gh + 1);
    put('bin', 17, gh + 3);
    put('transformer', gw + 2, 10, { boxCol: kind === 'harbor' ? 'teal_lo' : 'leaf_lo' });
    put('pot', 0, gh + 2);
    put('pot', gw - 1, gh + 3);
    put('pot', gw + 2, 4);
    put('manhole', 7, gh + 2);
    put('manhole', 12, gh + 3);
    put('manhole', 5, 15);
    put('manhole', 15, 15);
  }

  // ── 地板 ────────────────────────────────────────────────────────────────

  _drawFloors(ctx, L, gw, gh, frame, pal, S) {
    const tiles = L.tiles;
    if (!tiles || !tiles.length) return;
    const sim = S && isObj(S.sim) ? S.sim : null;
    const dirt = sim && isObj(sim.dirt) ? sim.dirt : null;
    const floorDirt = dirt ? Math.min(3, Math.floor(num(dirt.floor, 0) / 26)) : 0;
    const rrDirt = dirt ? Math.min(3, Math.floor(num(dirt.restroom, 0) / 26)) : 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = tiles[tileIndex(gw, x, y)];
        if (typeof t !== 'string') continue;
        const art = TILE_FLOOR_ART[t];
        if (!art) continue; // wall / pass / void 交給牆面 pass
        const p = this.tileToScreen(x, y);
        // 4 種木紋變體 + 靠牆格用收邊帶
        const variant = (hashCode32(x * 73856093 ^ y * 19349663) >>> 3) & 7;
        const edge = this._touchesWall(x, y) ? 1 : 0;
        const d = t === 'restroom' ? rrDirt : floorDirt;
        drawTile(ctx, art, p.px, p.py, { variant, frame, pal, dirt: d, edge });
      }
    }
  }

  /** 該格是否緊鄰牆（用來畫踢腳／收邊帶）。 */
  _touchesWall(x, y) {
    return this.tileAt(x - 1, y) === 'wall' || this.tileAt(x + 1, y) === 'wall'
      || this.tileAt(x, y - 1) === 'wall' || this.tileAt(x, y + 1) === 'wall';
  }

  /**
   * 牆腳環境光遮蔽（AO）：沿著牆與地板的交界畫 2–3px 網點暗帶
   * （北／西側的內牆底面、南／東側矮牆的內緣），讓室內「有底」。
   */
  _drawWallAO(ctx, L, gw, gh) {
    const tiles = L.tiles;
    if (!tiles || !tiles.length) return;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = tiles[tileIndex(gw, x, y)];
        if (typeof t !== 'string' || t === 'wall' || t === 'void') continue;
        let edges = 0;
        if (this.tileAt(x, y - 1) === 'wall') edges |= 1;
        if (this.tileAt(x - 1, y) === 'wall') edges |= 2;
        if (this.tileAt(x, y + 1) === 'wall') edges |= 4;
        if (this.tileAt(x + 1, y) === 'wall') edges |= 8;
        if (!edges) continue;
        const p = this.tileToScreen(x, y);
        drawAOOverlay(ctx, p.px, p.py, edges);
      }
    }
  }

  /** 廚房固定道具：爐台＋抽油煙機＋掛架＋流理台＋冰箱＋工作檯＋菜單牌＋出餐口盤子。 */
  _drawKitchenProps(ctx, L, gw, gh, tick, S) {
    const tiles = L.tiles;
    if (!tiles || !tiles.length) return;
    let minX = 99;
    let maxX = -1;
    let minY = 99;
    let maxY = -1;
    let n = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (tiles[tileIndex(gw, x, y)] !== 'kitchen') continue;
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (n === 0) return;
    const sim = S && isObj(S.sim) ? S.sim : null;
    const kitchen = sim ? arr(sim.kitchen) : null;
    const cooking = !!(kitchen && kitchen.length);
    const eq = sim && isObj(sim.equipBroken) ? sim.equipBroken : null;
    const frame = (tick >> 2) & 3;
    // 工作流線：沿廚房最北一列擺爐台／流理台／工作檯
    const row = minY;
    const span = Math.max(1, maxX - minX + 1);
    const at = (t, dy) => {
      const p = this.tileToScreen(t, row);
      return { x: p.px, y: p.py + (dy || 0) };
    };
    const slots = [];
    for (let i = 0; i < Math.min(4, span); i++) slots.push(minX + Math.round((i * (span - 1)) / Math.max(1, Math.min(4, span) - 1)));
    const kinds = ['fridge', 'stove_run', 'sink_counter', 'prep'];
    for (let i = 0; i < slots.length; i++) {
      const k = kinds[i % kinds.length];
      const c = at(slots[i], 2);
      drawKitchenProp(ctx, k, c.x, c.y, { frame, cooking: cooking && k === 'stove_run' && !(eq && eq.stove) });
      if (k === 'stove_run') {
        drawKitchenProp(ctx, 'hood', c.x, c.y - 34, { frame });
        drawKitchenProp(ctx, 'rack', c.x, c.y - 52, { frame });
      }
    }
    // 菜單牌掛在廚房最北牆面
    const mb = at(Math.round((minX + maxX) / 2), 0);
    drawKitchenProp(ctx, 'menu_board', mb.x, mb.y - 46, { frame });
    // 出餐口旁堆疊的盤子
    const pass = arr(L.passTiles);
    if (pass) {
      for (let i = 0; i < pass.length; i++) {
        const p = pass[i];
        if (!isObj(p)) continue;
        const c = this.tileToScreen(num(p.x, 0), num(p.y, 0));
        drawKitchenProp(ctx, 'plate_stack', c.px + (i ? 14 : -14), c.py - 4, { frame });
      }
    }
  }

  /**
   * 室內氛圍：四角網點暗角 + 出餐口暖色提亮 + 門口戶外光灑進門內一格。
   * （光池本體沿用 _drawFloorLights，這裡只補氛圍層。）
   */
  _drawInteriorMood(ctx, L, gw, gh, tick, T, pal) {
    // 四角暗角（裁切在房間剪影內）
    ctx.save();
    this._roomPath(ctx, gw, gh);
    ctx.clip();
    const poly = roomSilhouette(gw, gh, this.wallHeight, this.originX, this.originY);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      if (poly[i].x < minX) minX = poly[i].x;
      if (poly[i].x > maxX) maxX = poly[i].x;
      if (poly[i].y < minY) minY = poly[i].y;
      if (poly[i].y > maxY) maxY = poly[i].y;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const band = Math.round(Math.min(w, h) * 0.22);
    // 上緣／下緣／左右緣（pattern 填色：1 次 fillRect／每條帶）
    ditherPattern(ctx, minX, minY, w, band, 'shadow', 'clear', DITHER.b12);
    ditherPattern(ctx, minX, maxY - band, w, band, 'shadow', 'clear', DITHER.b25);
    ditherPattern(ctx, minX, minY, band, h, 'shadow', 'clear', DITHER.b25);
    ditherPattern(ctx, maxX - band, minY, band, h, 'shadow', 'clear', DITHER.b12);
    ctx.restore();
    // 出餐口暖色提亮（沿用光池畫法，但畫在氛圍層，讓夜晚看得出熱源）
    if (T.lamps > 0.3) {
      const pass = arr(L.passTiles);
      if (pass) {
        for (let i = 0; i < pass.length; i++) {
          const p = pass[i];
          if (!isObj(p)) continue;
          const c = this.tileToScreen(num(p.x, 0), num(p.y, 0));
          drawLightPool(ctx, c.px, c.py + 6, HALF_W * 1.1, HALF_H * 1.3, T.lamps * 0.6, tick, { seed: 7 });
        }
      }
    }
    // 門口戶外光灑進門內一格（白天最明顯）
    const ent = arr(L.entrances);
    if (ent && ent[0] && isObj(ent[0])) {
      const e0 = ent[0];
      const c = this.tileToScreen(num(e0.x, 0), num(e0.y, 0));
      const strength = T.lamps > 0.5 ? 0.35 : 0.75;
      drawLightPool(ctx, c.px, c.py - HALF_H * 1.4, HALF_W * 1.25, HALF_H * 1.6, strength, tick, { seed: 11 });
    }
    void pal;
  }

  // ── 牆面 ────────────────────────────────────────────────────────────────

  _drawWalls(ctx, L, gw, gh, tod, frame, pal, weather) {
    const tiles = L.tiles;
    if (!tiles || !tiles.length) return;
    const frost = weather === 'cold';
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = tiles[tileIndex(gw, x, y)];
        const art = TILE_WALL_ART[t];
        if (!art) continue;
        const near = x === gw - 1 || y === gh - 1;
        const h = near ? this.nearWallHeight : this.wallHeight;
        const p = this.tileToScreen(x, y);
        let face = 'none';
        if (!near) {
          if (x === 0) face = 'R';
          else if (y === 0) face = 'L';
          else face = 'both';
        }
        const windowOn = !near && ((x === 0 && y % 3 === 1) || (y === 0 && x % 3 === 2));
        drawTile(ctx, art, p.px, p.py, {
          wallH: h, face, window: windowOn, tod, frame, pal, frost: windowOn && frost,
          variant: (x * 5 + y * 3) & 3,
          glow: tod === 'night' || tod === 'evening',
        });
      }
    }
  }

  // ── 傢俱 + 人物（畫家演算法） ───────────────────────────────────────────

  _entry() {
    let e = this._pool[this._poolN];
    if (!e) {
      e = {};
      this._pool[this._poolN] = e;
    }
    this._poolN++;
    return e;
  }

  _drawSorted(ctx, S, L, gw, gh, frame, pal) {
    this._poolN = 0;
    const items = this._items();
    // 佔用中的桌（state.sim.tables[].occupants）→ 桌上餐具
    const sim = isObj(S.sim) ? S.sim : null;
    this._equipBroken = sim && isObj(sim.equipBroken) ? sim.equipBroken : null;
    let occ = null;
    const tables = sim ? arr(sim.tables) : null;
    if (tables) {
      occ = this._occPool || (this._occPool = Object.create(null));
      for (const k in occ) delete occ[k];
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i];
        if (!isObj(t) || !t.itemUid) continue;
        const n = arr(t.occupants) ? t.occupants.length : 0;
        if (n > 0) occ[t.itemUid] = n;
      }
    }
    this._occ = occ;
    // 用餐中的客人：把他們點的菜對應到桌（itemUid → [category...]）
    const dishMap = Object.create(null);
    const customers = sim ? arr(sim.customers) : null;
    if (customers) {
      for (let i = 0; i < customers.length; i++) {
        const cu = customers[i];
        if (!isObj(cu) || !cu.tableUid) continue;
        const st = typeof cu.state === 'string' ? cu.state.toUpperCase() : '';
        if (st !== 'EATING' && st !== 'WAITING_FOOD') continue;
        const order = arr(cu.order);
        if (!order || !order.length) continue;
        const list = dishMap[cu.tableUid] || (dishMap[cu.tableUid] = []);
        for (let k = 0; k < order.length && list.length < 4; k++) {
          const entry = order[k];
          const id = isObj(entry) ? entry.dishId : entry;
          let cat = null;
          try {
            const def = getDish(id);
            cat = def && def.category ? def.category : null;
          } catch (e) {
            cat = null;
          }
          list.push(cat || 'side');
        }
      }
    }
    this._dishes = dishMap;
    const people = this._collectPeople(S, gw, gh, frame);
    const acc = pal ? pal.accent : null;

    this._hitItemsN = 0;
    this._hitPeopleN = 0;
    this._bubbleN = 0;

    // 合併兩個已排序序列（items 依 x+y，people 依 x+y）
    const ni = items.length;
    const np = people.length;
    let i = 0;
    let j = 0;
    while (i < ni && j < np) {
      const a = items[i];
      const b = people[j];
      const da = num(a && a.x, 0) + num(a && a.y, 0);
      const db = b.d;
      // 同深度時人物畫在傢俱之後（人疊在椅子上）
      if (da < db) {
        this._drawItem(ctx, a, i, frame, acc, S);
        i++;
      } else {
        this._drawPersonEntry(ctx, b, j, frame);
        j++;
      }
    }
    while (i < ni) {
      this._drawItem(ctx, items[i], i, frame, acc, S);
      i++;
    }
    while (j < np) {
      this._drawPersonEntry(ctx, people[j], j, frame);
      j++;
    }
  }

  /** 命中紀錄用的可重用容器。 */
  _rec(pool, idx) {
    let r = pool[idx];
    if (!r) {
      r = { item: null, ref: null, kind: 0, box: { x: 0, y: 0, w: 0, h: 0, art: '', cx: 0, gy: 0, dir: 'S' } };
      pool[idx] = r;
    }
    return r;
  }

  _drawItem(ctx, item, idx, frame, accent, S) {
    const w = Math.max(1, Math.round(num(item.w, 1)));
    const h = Math.max(1, Math.round(num(item.h, 1)));
    const c = this.footprintCenter(num(item.x, 0), num(item.y, 0), w, h);
    const rec = this._rec(this._itemRecs, idx);
    const eq = this._equipBroken;
    const isStove = /stove|range|cook/i.test(String(item.typeId));
    const key = resolveFurnitureArt(item.typeId, { seats: num(item.seats, 0) });
    // 緊鄰牆壁的壁掛類裝飾品 → 改畫在牆面上（不要再躺在地上）
    let wall = null;
    if (WALL_MOUNT_ARTS[key]) {
      if (this.tileAt(num(item.x, 0), num(item.y, 0) - 1) === 'wall') wall = 'N';
      else if (this.tileAt(num(item.x, 0) - 1, num(item.y, 0)) === 'wall') wall = 'W';
    }
    const dishes = this._dishes ? this._dishes[item.uid] : null;
    const box = drawFurniture(ctx, item.typeId, c.px, c.py, {
      w, h,
      // 椅子優先用 sim 算好的 rotAuto 面向桌子；玩家手動轉過的不會有 rotAuto
      rot: item.rotAuto != null ? item.rotAuto : item.rot,
      frame,
      broken: !!item.broken || (isStove && !!(eq && eq.stove)),
      seats: num(item.seats, 0),
      durability: num(item.durability, 100),
      occupied: this._occ ? (this._occ[item.uid] | 0) : 0,
      dishes,
      wall,
      accent,
      out: rec.box,
    });
    void S;
    if (box && this._hitItemsN < 512) {
      rec.item = item;
      this._hitItems[this._hitItemsN] = rec;
      this._hitItemsN++;
    }
  }

  _collectPeople(S, gw, gh, frame) {
    const out = this._people;
    let n = 0;
    const sim = isObj(S.sim) ? S.sim : null;
    const customers = sim ? arr(sim.customers) : null;
    if (customers) {
      for (let i = 0; i < customers.length; i++) {
        const c = customers[i];
        if (!isObj(c)) continue;
        const x = num(c.x, -1);
        const y = num(c.y, -1);
        if (x < -3 || y < -3 || x > gw + 4 || y > gh + 4) continue;
        const e = this._entry();
        e.kind = 1;
        e.d = x + y;
        e.t = 0;
        e.ref = c;
        e.x = x;
        e.y = y;
        e.frame = frame;
        out[n++] = e;
      }
    }
    const staff = arr(S.staff);
    if (staff) {
      for (let i = 0; i < staff.length; i++) {
        const s = staff[i];
        if (!isObj(s)) continue;
        const x = num(s.x, -1);
        const y = num(s.y, -1);
        if (x < -3 || y < -3 || x > gw + 4 || y > gh + 4) continue;
        const e = this._entry();
        e.kind = 2;
        e.d = x + y;
        e.t = 1;
        e.ref = s;
        e.x = x;
        e.y = y;
        e.frame = frame;
        out[n++] = e;
      }
    }
    const walkers = sim ? arr(sim.walkers) : null;
    if (walkers) {
      for (let i = 0; i < walkers.length; i++) {
        const k = walkers[i];
        if (!isObj(k)) continue;
        const x = num(k.x, -1);
        const y = num(k.y, -1);
        if (x < -6 || y < -6 || x > gw + 8 || y > gh + 8) continue;
        const e = this._entry();
        e.kind = 3;
        e.d = x + y;
        e.t = 2;
        e.ref = k;
        e.x = x;
        e.y = y;
        e.frame = frame;
        out[n++] = e;
      }
    }
    out.length = n;
    if (n > 1) out.sort(comparePeople);
    return out;
  }

  _brec(idx) {
    let r = this._bubblePool[idx];
    if (!r) {
      r = { kind: 'wait', x: 0, y: 0, f: 0 };
      this._bubblePool[idx] = r;
    }
    return r;
  }

  _drawPersonEntry(ctx, e, idx, frame) {
    const ref = e.ref;
    const p = this.tileToScreen(e.x, e.y);
    const kind = e.kind;
    const st = typeof ref.state === 'string' ? ref.state : '';
    const uidKey = String(ref.uid == null ? ref.staffId || idx : ref.uid);

    // 是否在移動（沿用上一幀位置推導，不修改 state）
    let prev = this._motion.get(uidKey);
    if (!prev) {
      prev = { x: e.x, y: e.y };
      this._motion.set(uidKey, prev);
    }
    const dxm = e.x - prev.x;
    const dym = e.y - prev.y;
    const moving = (dxm * dxm + dym * dym) > 0.0004;
    prev.x = e.x;
    prev.y = e.y;

    // 姿勢：全部由既有欄位推導（state / mood / dir / seatedDir / frame）
    const seatedPose = kind === 1 ? SEATED_POSE_STATES[st] : null;
    let pose;
    if (seatedPose === 'eat') pose = (frame & 1) ? 'eat' : 'seated';
    else if (seatedPose === 'seated') pose = 'seated';
    else if (kind === 2 && CARRY_RE.test(st)) pose = 'carry';
    else if (num(ref.mood, 0) < -20) pose = 'angry';
    else if (moving) pose = 'walk';
    else pose = 'idle';

    const seated = pose === 'seated' || pose === 'eat';
    const dirRaw = seated && ref.seatedDir ? ref.seatedDir : ref.dir;
    // 走路 4 格循環：由位置（會隨移動改變）＋模擬影格推導，站著的人不會抖動
    const walkFrame = moving ? (((Math.floor((e.x + e.y) * 2) + (frame | 0)) & 3) + 4) & 3 : 0;
    const entFrame = moving ? walkFrame : (frame & 1);
    const blink = pose === 'idle' && ((this._tick + hashCode32(uidKey.length * 7 + idx)) % 53) < 3;

    const app = kind === 2
      ? (isObj(ref.appearance) ? ref.appearance : appearanceFromSeed(ref.staffId || ref.uid, ref.role))
      : (isObj(ref.appearance) ? ref.appearance : appearanceFromSeed(ref.uid, ref.role));
    const fy = p.py + 2;
    const rec = this._rec(this._peopleRecs, idx);
    const box = drawPerson(ctx, app, p.px, fy, {
      dir: dirRaw,
      frame: entFrame,
      pose,
      blink,
      kind: kind === 1 ? ref.type : null,
      uniform: kind === 2 ? (ref.role === 'chef' ? 'chef' : 'waiter') : null,
      mood: num(ref.mood, 0) < -20 ? 'angry' : null,
      out: rec.box,
    });
    if (box && this._hitPeopleN < 512) {
      rec.box.x = box.x - 1;
      rec.box.y = box.y - 4;
      rec.box.w = box.w + 2;
      rec.box.h = box.h + 6;
      rec.ref = ref;
      rec.kind = kind;
      this._hitPeople[this._hitPeopleN] = rec;
      this._hitPeopleN++;
    }
    // 心情氣泡
    let bkind = null;
    if (kind === 1) bkind = moodBubble(ref);
    else if (kind === 2 && num(ref.fatigue, 0) > 80) bkind = 'zzz';
    else if (kind === 3) bkind = 'call';
    if (bkind && this._bubbleN < 128) {
      const b = this._brec(this._bubbleN);
      b.kind = bkind;
      b.x = p.px + 6;
      b.y = fy - 22;
      b.f = (num(ref.frame, frame) | 0) & 1;
      this._bubbles[this._bubbleN] = b;
      this._bubbleN++;
    }
  }

  _drawBubbles(ctx, frame) {
    for (let i = 0; i < this._bubbleN; i++) {
      const b = this._bubbles[i];
      drawBubble(ctx, b.kind, b.x, b.y, (b.f + (frame & 1)) & 1);
    }
  }

  // ── 網格 ────────────────────────────────────────────────────────────────

  _drawGrid(ctx, L, gw, gh) {
    const tiles = L.tiles;
    const occ = this._occupied;
    ctx.strokeStyle = color('lamp_lo');
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.27;
    ctx.beginPath();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = tileIndex(gw, x, y);
        if (occ && occ[i]) continue; // 有傢俱的格子不畫格線，避免切斷傢俱輪廓
        if (tiles && typeof tiles[i] === 'string' && tiles[i] === 'void') continue;
        const p = this.tileToScreen(x, y);
        ctx.moveTo(p.px, p.py - HALF_H);
        ctx.lineTo(p.px + HALF_W, p.py);
        ctx.lineTo(p.px, p.py + HALF_H);
        ctx.lineTo(p.px - HALF_W, p.py);
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── 幽靈傢俱 ────────────────────────────────────────────────────────────

  _drawGhost(ctx, ghost, frame) {
    const gx = Math.round(num(ghost.x, 0));
    const gy = Math.round(num(ghost.y, 0));
    const w = Math.max(1, Math.round(num(ghost.w, num(ghost.tw, 1))));
    const h = Math.max(1, Math.round(num(ghost.h, num(ghost.th, 1))));
    const valid = ghost.valid !== false && ghost.ok !== false;
    const c = this.footprintCenter(gx, gy, w, h);
    const corners = footprintCorners(gx, gy, w, h, this.originX, this.originY);
    const colA = valid ? 'ghost_ok' : 'ghost_bad';
    this._ditherDiamond(ctx, c.px, corners.n.y, Math.round((w + h) * HALF_W), Math.round((w + h) * HALF_H), colA, DITHER.b25);
    ctx.strokeStyle = color(colA);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(corners.n.x, corners.n.y);
    ctx.lineTo(corners.e.x, corners.e.y);
    ctx.lineTo(corners.s.x, corners.s.y);
    ctx.lineTo(corners.w.x, corners.w.y);
    ctx.closePath();
    ctx.stroke();
    if (ghost.typeId) {
      drawFurniture(ctx, ghost.typeId, c.px, c.py, {
        w, h, rot: ghost.rot, frame, ghost: true, valid, seats: num(ghost.seats, 0),
      });
    }
  }

  /** 菱形網點填色（只畫遮罩為 1 的像素，其餘透明）。 */
  _ditherDiamond(ctx, cx, topY, w, h, colName, pattern) {
    const p = typeof pattern === 'object' && pattern.length === 4 ? pattern : DITHER[pattern] || DITHER.b50;
    const n = Math.max(1, Math.round(h));
    const col = color(colName);
    let last = null;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      let ww = Math.round((w * (1 - Math.abs(2 * t - 1))) / 2) * 2;
      if (ww < 2) ww = 2;
      const x0 = Math.round(cx - ww / 2);
      const y = Math.round(topY) + i;
      const row = p[((y % 4) + 4) % 4];
      let run = 0;
      for (let k = 0; k < ww; k++) {
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
        ctx.fillRect(x0 + ww - run, y, run, 1);
      }
    }
  }

  // ── 滑鼠提示框 ──────────────────────────────────────────────────────────

  _diamondPath(ctx, cx, cy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  _drawHover(ctx, V, frame) {
    // 選取的傢俱
    if (V.selectionUid != null) this._outlineItem(ctx, V.selectionUid, 'select');
    if (V.focusItemUid != null) this._outlineItem(ctx, V.focusItemUid, 'lamp_hi');

    // 滑鼠所在格
    const hov = isObj(V.hover) ? V.hover : null;
    if (hov) {
      const hx = Math.round(num(hov.x, -1));
      const hy = Math.round(num(hov.y, -1));
      if (hx >= 0 && hy >= 0 && hx < this.gridW && hy < this.gridH) {
        const p = this.tileToScreen(hx, hy);
        ditherRect(ctx, Math.round(p.px - HALF_W), Math.round(p.py - HALF_H), this.tileW, this.tileH,
          'lamp_hi', 'clear', DITHER.sparse);
        ctx.strokeStyle = color('lamp_hi');
        ctx.lineWidth = 1;
        this._diamondPath(ctx, p.px, p.py, HALF_W, HALF_H);
        ctx.stroke();
      }
    }

    // 滑鼠指到的顧客
    const uid = V.hoverCustomerUid;
    if (uid != null) {
      for (let i = 0; i < this._hitPeopleN; i++) {
        const rec = this._hitPeople[i];
        if (rec.kind !== 1) continue;
        const ref = rec.ref;
        if (ref.uid !== uid && ref.id !== uid) continue;
        const p = this.tileToScreen(num(ref.x, 0), num(ref.y, 0));
        const pulse = (frame >> 3) & 1;
        ctx.strokeStyle = color('neon_yel');
        ctx.lineWidth = 1;
        this._diamondPath(ctx, p.px, p.py + 2, HALF_W - (pulse ? 2 : 0), HALF_H - (pulse ? 1 : 0));
        ctx.stroke();
        ctx.fillStyle = color('neon_yel');
        ctx.fillRect(Math.round(p.px - 3), Math.round(p.py - 28 - (pulse ? 1 : 0)), 7, 1);
        break;
      }
    }
  }

  _outlineItem(ctx, uid, colName) {
    const items = this._sortedItems;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.uid !== uid) continue;
      const w = Math.max(1, Math.round(num(it.w, 1)));
      const h = Math.max(1, Math.round(num(it.h, 1)));
      const corners = footprintCorners(num(it.x, 0), num(it.y, 0), w, h, this.originX, this.originY);
      ctx.strokeStyle = color(colName);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners.n.x, corners.n.y);
      ctx.lineTo(corners.e.x, corners.e.y);
      ctx.lineTo(corners.s.x, corners.s.y);
      ctx.lineTo(corners.w.x, corners.w.y);
      ctx.closePath();
      ctx.stroke();
      return;
    }
  }

  // ── 除錯 ────────────────────────────────────────────────────────────────

  _drawDebug(ctx, S, frame) {
    const sim = isObj(S.sim) ? S.sim : null;
    const lists = [];
    if (sim && arr(sim.customers)) lists.push(sim.customers);
    if (arr(S.staff)) lists.push(S.staff);
    ctx.strokeStyle = color('debug_path');
    ctx.fillStyle = color('debug_path');
    ctx.lineWidth = 1;
    for (let li = 0; li < lists.length; li++) {
      const list = lists[li];
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!isObj(o) || !arr(o.path) || !o.path.length) continue;
        ctx.beginPath();
        let first = true;
        for (let k = 0; k < o.path.length; k++) {
          const node = o.path[k];
          const nx = isObj(node) ? num(node.x, 0) : num(node, 0);
          const ny = isObj(node) ? num(node.y, 0) : num(node, 0);
          const p = this.tileToScreen(nx, ny);
          if (first) {
            ctx.moveTo(p.px, p.py);
            first = false;
          } else {
            ctx.lineTo(p.px, p.py);
          }
        }
        ctx.stroke();
        for (let k = 0; k < o.path.length; k++) {
          const node = o.path[k];
          const nx = isObj(node) ? num(node.x, 0) : num(node, 0);
          const ny = isObj(node) ? num(node.y, 0) : num(node, 0);
          const p = this.tileToScreen(nx, ny);
          ctx.fillStyle = color(k === o.path.length - 1 ? 'debug_target' : 'debug_path');
          ctx.fillRect(Math.round(p.px) - 1, Math.round(p.py) - 1, 2, 2);
        }
        const tgt = isObj(o.target) ? o.target : null;
        if (tgt) {
          const p = this.tileToScreen(num(tgt.x, 0), num(tgt.y, 0));
          ctx.fillStyle = color('debug_target');
          ctx.fillRect(Math.round(p.px) - 2, Math.round(p.py) - 2, 4, 4);
        }
      }
    }
    void frame;
  }

  // ── 命中測試 ────────────────────────────────────────────────────────────

  /** 螢幕座標 → 傢俱（找不到回 null）。 */
  hitTestItem(px, py) {
    const x = num(px, -1e9);
    const y = num(py, -1e9);
    for (let i = this._hitItemsN - 1; i >= 0; i--) {
      const rec = this._hitItems[i];
      if (!rec) continue;
      const b = rec.box;
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return rec.item;
    }
    // 後備：用格座標反查腳印
    const t = this.screenToTile(x, y);
    const items = this._sortedItems;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const w = Math.max(1, Math.round(num(it.w, 1)));
      const h = Math.max(1, Math.round(num(it.h, 1)));
      if (t.x >= it.x && t.x < num(it.x, 0) + w && t.y >= it.y && t.y < num(it.y, 0) + h) return it;
    }
    return null;
  }

  /** 螢幕座標 → 顧客（找不到回 null）。 */
  hitTestCustomer(px, py) {
    const x = num(px, -1e9);
    const y = num(py, -1e9);
    for (let i = this._hitPeopleN - 1; i >= 0; i--) {
      const rec = this._hitPeople[i];
      if (!rec || rec.kind !== 1) continue;
      const b = rec.box;
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return rec.ref;
    }
    return null;
  }

  /** 工作人員命中（額外便利函式，顧客以外的人）。 */
  hitTestStaff(px, py) {
    const x = num(px, -1e9);
    const y = num(py, -1e9);
    for (let i = this._hitPeopleN - 1; i >= 0; i--) {
      const rec = this._hitPeople[i];
      if (!rec || rec.kind !== 2) continue;
      const b = rec.box;
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return rec.ref;
    }
    return null;
  }

  /** 取得某格的傢俱（回傳第一件）。 */
  itemAtTile(tx, ty) {
    const items = this._sortedItems;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const w = Math.max(1, Math.round(num(it.w, 1)));
      const h = Math.max(1, Math.round(num(it.h, 1)));
      if (tx >= it.x && tx < num(it.x, 0) + w && ty >= it.y && ty < num(it.y, 0) + h) return it;
    }
    return null;
  }

  /** 取得某格的 tile 字串（缺資料回 'void'）。 */
  tileAt(tx, ty) {
    const L = this.layout;
    if (!L || !L.tiles || tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return 'void';
    const t = L.tiles[tileIndex(this.gridW, tx, ty)];
    return typeof t === 'string' ? t : 'void';
  }

  /** 快取統計（效能檢查用）。 */
  stats() {
    return { ...spriteCacheInfo(), backdrop: this._backdropKey, items: this._sortedItems.length };
  }
}

const EMPTY_PEOPLE = [];

function compareItems(a, b) {
  const da = num(a.x, 0) + num(a.y, 0);
  const db = num(b.x, 0) + num(b.y, 0);
  if (da !== db) return da - db;
  const ia = String(a.uid == null ? '' : a.uid);
  const ib = String(b.uid == null ? '' : b.uid);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function comparePeople(a, b) {
  if (a.d !== b.d) return a.d - b.d;
  if (a.t !== b.t) return a.t - b.t;
  return 0;
}

// ===========================================================================
// 小地圖
// ===========================================================================

/**
 * 畫餐廳小地圖（俯瞰方陣，不做等角）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {number} w @param {number} h
 */
export function renderMinimap(ctx, state, w, h) {
  if (!ctx) return;
  const S = isObj(state) ? state : {};
  const L = isObj(S.layout) ? S.layout : null;
  const gw = Math.max(1, Math.round(num(L && L.gridW, GRID_W)));
  const gh = Math.max(1, Math.round(num(L && L.gridH, GRID_H)));
  const W = Math.max(8, Math.round(num(w, 120)));
  const H = Math.max(8, Math.round(num(h, 90)));
  const cell = Math.max(2, Math.floor(Math.min((W - 4) / gw, (H - 4) / gh)));
  const ox = Math.round((W - cell * gw) / 2);
  const oy = Math.round((H - cell * gh) / 2);

  ctx.fillStyle = color('black');
  ctx.fillRect(0, 0, W, H);
  ditherRect(ctx, 1, 1, W - 2, H - 2, 'outline_warm', 'black', DITHER.sparse);

  const tiles = L && arr(L.tiles) ? L.tiles : [];
  const pal = resolveTilePalette(S, null);
  const COLS = {
    floor: pal.floor,
    kitchen: 'tile_k',
    restroom: 'tile',
    pass: 'lamp',
    door: pal.accent,
    wall: pal.wallSh,
    void: null,
  };
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const t = tiles.length ? tiles[y * gw + x] : 'floor';
      const col = COLS[typeof t === 'string' ? t : 'floor'];
      if (!col) continue;
      ctx.fillStyle = color(col);
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
  // 邊框
  ctx.strokeStyle = color('gray_15');
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 0.5, oy - 0.5, cell * gw + 1, cell * gh + 1);

  // 傢俱
  const items = L && arr(L.items) ? L.items : [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isObj(it)) continue;
    const iw = Math.max(1, Math.round(num(it.w, 1)));
    const ih = Math.max(1, Math.round(num(it.h, 1)));
    ctx.fillStyle = color(it.broken ? 'hp_bad' : 'outline');
    ctx.fillRect(ox + num(it.x, 0) * cell, oy + num(it.y, 0) * cell, iw * cell, ih * cell);
    ctx.fillStyle = color(it.broken ? 'hp_warn' : 'gray_70');
    ctx.fillRect(ox + num(it.x, 0) * cell + 1, oy + num(it.y, 0) * cell + 1, Math.max(1, iw * cell - 2), Math.max(1, ih * cell - 2));
  }

  const sim = isObj(S.sim) ? S.sim : null;
  const customers = sim && arr(sim.customers) ? sim.customers : EMPTY_PEOPLE;
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if (!isObj(c)) continue;
    ctx.fillStyle = color(num(c.mood, 0) < -20 ? 'hp_bad' : 'white');
    ctx.fillRect(ox + Math.round(num(c.x, 0)) * cell, oy + Math.round(num(c.y, 0)) * cell, 2, 2);
  }
  const staff = arr(S.staff) ? S.staff : EMPTY_PEOPLE;
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    if (!isObj(s)) continue;
    ctx.fillStyle = color(s.role === 'chef' ? 'lamp_md' : 'teal_hi');
    ctx.fillRect(ox + Math.round(num(s.x, 0)) * cell + 1, oy + Math.round(num(s.y, 0)) * cell, 2, 2);
  }
  const walkers = sim && arr(sim.walkers) ? sim.walkers : EMPTY_PEOPLE;
  for (let i = 0; i < walkers.length; i++) {
    const k = walkers[i];
    if (!isObj(k)) continue;
    ctx.fillStyle = color('neon_pink');
    ctx.fillRect(ox + Math.round(num(k.x, 0)) * cell, oy + Math.round(num(k.y, 0)) * cell, 1, 1);
  }
}

/** 給 UI 的預設 view 物件。 */
export function defaultView(extra) {
  return Object.assign({
    frame: 0, hover: null, ghost: null, selectionUid: null, focusItemUid: null,
    showGrid: false, debugPaths: false, hoverCustomerUid: null,
  }, isObj(extra) ? extra : {});
}

export default FloorRenderer;
