// src/render/iso.js
// 《夢幻西餐廳》復刻 — 等角座標換算。
//
// 本檔只做「座標數學」：不碰 canvas、不碰 DOM、不配置任何資源。
// 契約來源：docs/ARCHITECTURE.md §1 座標與幾何。
//
//   tileToScreen(x, y) => { px: ORIGIN_X + (x - y) * TILE_W / 2,
//                           py: ORIGIN_Y + (x + y) * TILE_H / 2 }
//   ORIGIN_X = LOGICAL_W / 2 - (GRID_W - GRID_H) * TILE_W / 4   // 置中
//   ORIGIN_Y = 192
//   screenToTile(px, py) => 上述反解，四捨五入。
//
// 解析度：邏輯畫布 1280×800，tile 56×28（＝640×400 / 28×14 的整數 2 倍，
// 也就是上一版 960×600 / 42×21 的 4/3 倍），因此所有「格」為單位的運算
// （足跡、排序、命中測試）完全等價，而 TILE_W/2 = 28、TILE_H/2 = 14 皆為整數，
// 使得整數格座標一律換算成整數像素（不會出現 .5 的半像素模糊）。

export const TILE_W = 56;
export const TILE_H = 28;

export const GRID_W = 20;
export const GRID_H = 13;

export const LOGICAL_W = 1280;
export const LOGICAL_H = 800;

/** 置中：640 - (20 - 13) * 56 / 4 = 542（整數）。 */
export const ORIGIN_X = Math.round(LOGICAL_W / 2 - ((GRID_W - GRID_H) * TILE_W) / 4);

/** 垂直取景：沿用舊版比例（96/400 → 192/800），房間略高於畫面中心。 */
export const ORIGIN_Y = Math.round((96 * LOGICAL_H) / 400);

/** 菱形 tile 的內接半徑（供命中測試／描邊使用）。 */
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 格座標（可為小數）→ 螢幕座標（該格菱形中心）。
 * @returns {{px:number, py:number}}
 */
export function tileToScreen(x, y, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const fx = num(x);
  const fy = num(y);
  return {
    px: num(originX) + (fx - fy) * HALF_W,
    py: num(originY) + (fx + fy) * HALF_H,
  };
}

/** tileToScreen 的反解，但不四捨五入（回傳浮點格座標）。 */
export function screenToTileF(px, py, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const a = (num(px) - num(originX)) / HALF_W; // x - y
  const b = (num(py) - num(originY)) / HALF_H; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * 螢幕座標 → 格座標（四捨五入為整數）。
 * 保證 screenToTile(tileToScreen(x, y)) 對所有整數格完全相等。
 * @returns {{x:number, y:number}}
 */
export function screenToTile(px, py, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const f = screenToTileF(px, py, originX, originY);
  return { x: Math.round(f.x), y: Math.round(f.y) };
}

/** 畫家演算法深度鍵：x + y 越大越靠鏡頭。 */
export function tileDepth(x, y) {
  return num(x) + num(y);
}

/** 菱形四頂點（N/E/S/W），以格中心為基準。 */
export function tileCorners(x, y, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const { px, py } = tileToScreen(x, y, originX, originY);
  return {
    n: { x: px, y: py - HALF_H },
    e: { x: px + HALF_W, y: py },
    s: { x: px, y: py + HALF_H },
    w: { x: px - HALF_W, y: py },
  };
}

/**
 * 一個 w×h 格的腳印（footprint）在螢幕上的中心點。
 * w/h 為佔用格數（>=1）。中心 = 腳印菱形中心（不是起點格中心）。
 */
export function footprintCenter(x, y, w = 1, h = 1, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const cx = num(x) + (Math.max(1, num(w)) - 1) / 2;
  const cy = num(y) + (Math.max(1, num(h)) - 1) / 2;
  return tileToScreen(cx, cy, originX, originY);
}

/** 腳印菱形的四頂點（螢幕座標）。 */
export function footprintCorners(x, y, w = 1, h = 1, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const gw = Math.max(1, num(w));
  const gh = Math.max(1, num(h));
  const c = footprintCenter(x, y, gw, gh, originX, originY);
  const spanW = ((gw + gh) / 2) * HALF_W;
  const spanH = ((gw + gh) / 2) * HALF_H;
  return {
    n: { x: c.px, y: c.py - spanH },
    e: { x: c.px + spanW, y: c.py },
    s: { x: c.px, y: c.py + spanH },
    w: { x: c.px - spanW, y: c.py },
  };
}

/** 點是否落在以 (cx,cy) 為中心的菱形內（半寬 hw、半高 hh）。 */
export function pointInDiamond(px, py, cx, cy, hw = HALF_W, hh = HALF_H) {
  const dx = Math.abs(num(px) - num(cx)) / (hw || 1);
  const dy = Math.abs(num(py) - num(cy)) / (hh || 1);
  return dx + dy <= 1;
}

/** 點是否落在某格的菱形內。 */
export function pointInTile(px, py, x, y, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const { px: cx, py: cy } = tileToScreen(x, y, originX, originY);
  return pointInDiamond(px, py, cx, cy, HALF_W, HALF_H);
}

/** 點是否落在 w×h 腳印菱形內（家具命中測試後備路徑）。 */
export function pointInFootprint(px, py, x, y, w = 1, h = 1, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const gw = Math.max(1, num(w));
  const gh = Math.max(1, num(h));
  const c = footprintCenter(x, y, gw, gh, originX, originY);
  return pointInDiamond(px, py, c.px, c.py, ((gw + gh) / 2) * HALF_W, ((gw + gh) / 2) * HALF_H);
}

/** 整張網格投影後的螢幕邊界。 */
export function gridBounds(gw = GRID_W, gh = GRID_H, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const w = Math.max(1, num(gw));
  const h = Math.max(1, num(gh));
  const n = tileToScreen(0, 0, originX, originY);
  const e = tileToScreen(w - 1, 0, originX, originY);
  const s = tileToScreen(w - 1, h - 1, originX, originY);
  const wv = tileToScreen(0, h - 1, originX, originY);
  return {
    left: wv.px - HALF_W,
    right: e.px + HALF_W,
    top: n.py - HALF_H,
    bottom: s.py + HALF_H,
  };
}

/**
 * 後牆牆頂所形成的 Λ 形天際線（天空／街景可見區的下緣）。
 * 回傳由左至右的折線點：左角 → 屋脊 → 右角。
 */
export function backWallRidge(gw = GRID_W, gh = GRID_H, wallH = 22, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const w = Math.max(1, num(gw));
  const h = Math.max(1, num(gh));
  const ox = num(originX);
  const oy = num(originY);
  return [
    { x: ox - h * HALF_W, y: oy + (h - 1) * HALF_H - num(wallH) },
    { x: ox, y: oy - HALF_H - num(wallH) },
    { x: ox + w * HALF_W, y: oy + (w - 1) * HALF_H - num(wallH) },
  ];
}

/** 天空／街景可見多邊形（供 ctx.clip 使用）：屋脊以上、整條畫布寬。 */
export function skyPolygon(gw = GRID_W, gh = GRID_H, wallH = 22, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const r = backWallRidge(gw, gh, wallH, originX, originY);
  const pad = 6;
  return [
    { x: r[0].x - pad, y: r[0].y },
    { x: r[1].x, y: r[1].y },
    { x: r[2].x + pad, y: r[2].y },
    { x: r[2].x + pad, y: -pad },
    { x: r[0].x - pad, y: -pad },
  ];
}

/**
 * 房間剪影（地板菱形 ∪ 牆面）6 邊形，供燈光／時段網點裁切使用。
 * 由左角（牆頂）→ 屋脊 → 右角（牆頂）→ 地板東角 → 地板南角 → 地板西角。
 */
export function roomSilhouette(gw = GRID_W, gh = GRID_H, wallH = 22, originX = ORIGIN_X, originY = ORIGIN_Y) {
  const r = backWallRidge(gw, gh, wallH, originX, originY);
  const w0 = Math.max(1, num(gw));
  const h0 = Math.max(1, num(gh));
  const e = tileToScreen(w0 - 1, 0, originX, originY);
  const s = tileToScreen(w0 - 1, h0 - 1, originX, originY);
  const wv = tileToScreen(0, h0 - 1, originX, originY);
  return [
    { x: r[0].x, y: r[0].y },
    { x: r[1].x, y: r[1].y },
    { x: r[2].x, y: r[2].y },
    { x: e.px + HALF_W, y: e.py },
    { x: s.px, y: s.py + HALF_H },
    { x: wv.px - HALF_W, y: wv.py },
  ];
}

/** 夾在網格內（回傳新物件，不變更輸入）。 */
export function clampTile(x, y, gw = GRID_W, gh = GRID_H) {
  const cx = Math.min(Math.max(0, Math.round(num(x))), Math.max(0, num(gw) - 1));
  const cy = Math.min(Math.max(0, Math.round(num(y))), Math.max(0, num(gh) - 1));
  return { x: cx, y: cy };
}

/** 曼哈頓格距（服務生負責桌數等模擬用不到，但 UI 提示常用）。 */
export function tileDistance(ax, ay, bx, by) {
  return Math.abs(num(ax) - num(bx)) + Math.abs(num(ay) - num(by));
}

/** 以 0..1 的步進在兩格之間取點（畫路徑用）。 */
export function lerpTile(ax, ay, bx, by, t) {
  const k = Math.min(1, Math.max(0, num(t)));
  return { x: num(ax) + (num(bx) - num(ax)) * k, y: num(ay) + (num(by) - num(ay)) * k };
}

/** 由遊戲分鐘推導時段（供街景配色）。 */
export function timeOfDayFromMinute(minute) {
  const m = num(minute);
  if (m < 9 * 60) return 'morning';
  if (m < 15 * 60) return 'noon';
  if (m < 19 * 60) return 'evening';
  return 'night';
}
