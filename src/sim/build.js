// ============================================================================
// build.js — 餐廳平面：格局產生、擺放合法性、桌椅與座位推導、裝潢分數
// 契約見 docs/ARCHITECTURE.md §3.5
// ============================================================================
import { furnitureById, furnitureByCategory } from '../data/furniture.js';
import { GRID_W, GRID_H } from '../core/balance.js';

export const TILE_TYPES = ['floor', 'wall', 'door', 'kitchen', 'pass', 'restroom', 'void'];

/** 各地點的格局差異（門的位置、廚房大小、隔間牆） */
const LAYOUT_VARIANTS = {
  zhongli_xinming: { doorX: 9, kitchen: { x0: 1, y0: 1, x1: 6, y1: 3 }, restroom: 'NE', partitions: [] },
  keelung_miaokou: { doorX: 11, kitchen: { x0: 1, y0: 1, x1: 7, y1: 3 }, restroom: 'NW', partitions: [] },
  taipei_nanyang: { doorX: 6, kitchen: { x0: 1, y0: 1, x1: 5, y1: 4 }, restroom: 'SE', partitions: [[13, 6], [13, 7], [13, 8]] },
  taichung_zhonghua: { doorX: 13, kitchen: { x0: 1, y0: 1, x1: 8, y1: 2 }, restroom: 'NE', partitions: [[10, 8], [10, 9]] },
  tainan_dongdi: { doorX: 8, kitchen: { x0: 1, y0: 1, x1: 6, y1: 4 }, restroom: 'SE', partitions: [] },
  kaohsiung_xinkujiang: { doorX: 14, kitchen: { x0: 1, y0: 1, x1: 7, y1: 3 }, restroom: 'NW', partitions: [[12, 4], [12, 5]] }
};

const DEFAULT_VARIANT = LAYOUT_VARIANTS.zhongli_xinming;

export function tileIndex(layout, x, y) {
  return y * layout.gridW + x;
}

export function inBounds(layout, x, y) {
  return x >= 0 && y >= 0 && x < layout.gridW && y < layout.gridH;
}

export function tileAt(layout, x, y) {
  if (!inBounds(layout, x, y)) return 'void';
  return layout.tiles[tileIndex(layout, x, y)] || 'void';
}

export function setTile(layout, x, y, type) {
  if (!inBounds(layout, x, y)) return false;
  layout.tiles[tileIndex(layout, x, y)] = type;
  return true;
}

/**
 * 產生某地點的預設格局。
 * 全部地點都是 20×13 等角網格；差異在於大門位置、廚房大小、廁所方位與隔間牆。
 */
export function defaultLayout(locationId) {
  const v = LAYOUT_VARIANTS[locationId] || DEFAULT_VARIANT;
  const gridW = GRID_W;
  const gridH = GRID_H;
  const tiles = new Array(gridW * gridH).fill('floor');
  const layout = {
    gridW, gridH, tiles,
    items: [],
    door: { x: v.doorX, y: gridH - 1 },
    outside: { x: v.doorX, y: gridH - 0.5 },
    kitchenTiles: [],
    passTiles: [],
    restroomTiles: [],
    sidewalk: { y: gridH - 0.5, x0: 1, x1: gridW - 2 }
  };

  const put = (x, y, t) => { if (inBounds(layout, x, y)) tiles[y * gridW + x] = t; };

  // 外牆
  for (let x = 0; x < gridW; x++) { put(x, 0, 'wall'); put(x, gridH - 1, 'wall'); }
  for (let y = 0; y < gridH; y++) { put(0, y, 'wall'); put(gridW - 1, y, 'wall'); }

  // 廚房（左上區塊）
  const k = v.kitchen;
  for (let y = k.y0; y <= k.y1; y++) {
    for (let x = k.x0; x <= k.x1; x++) {
      put(x, y, 'kitchen');
      layout.kitchenTiles.push({ x, y });
    }
  }
  // 出餐口（廚房下緣，服務生取餐處）
  // 刻意選在「桌子的間隔欄」上（x0+2 起每 3 格），避免佔用靠牆那排桌子的北側座位格。
  const passXs = [];
  for (let x = k.x0 + 2; x <= k.x1 - 1; x += 3) passXs.push(x);
  if (!passXs.length) passXs.push(k.x0);
  for (const px of passXs) {
    put(px, k.y1 + 1, 'pass');
    layout.passTiles.push({ x: px, y: k.y1 + 1 });
  }

  // 廁所
  const rw = 2; const rh = 2;
  let rx = gridW - 1 - rw; let ry = 1;
  if (v.restroom === 'NW') { rx = 1 + (k.x1 - k.x0) + 2; ry = 1; }
  if (v.restroom === 'NE') { rx = gridW - 1 - rw; ry = 1; }
  if (v.restroom === 'SE') { rx = gridW - 1 - rw; ry = gridH - 1 - rh; }
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (tileAt(layout, x, y) === 'floor') {
        put(x, y, 'restroom');
        layout.restroomTiles.push({ x, y });
      }
    }
  }
  layout.restroom = layout.restroomTiles[0] ? { ...layout.restroomTiles[0] } : null;

  // 隔間牆（增加動線難度）
  for (const [px, py] of v.partitions || []) {
    if (tileAt(layout, px, py) === 'floor') put(px, py, 'wall');
  }

  // 大門（南牆）
  put(layout.door.x, layout.door.y, 'door');

  recomputeReachability(layout);
  return layout;
}

/* ------------------------------------------------------------ 佔用與通行 */

/** 取得覆蓋某格的可阻擋傢俱 */
export function blockingItemAt(layout, x, y) {
  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    const w = item.w || def?.w || 1;
    const h = item.h || def?.h || 1;
    if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) {
      if (def?.blocks) return item;
    }
  }
  return null;
}

export function itemAt(layout, x, y) {
  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    const w = item.w || def?.w || 1;
    const h = item.h || def?.h || 1;
    if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) return item;
  }
  return null;
}

export function isOccupied(layout, x, y, ignoreUid = null) {
  for (const item of layout.items) {
    if (ignoreUid && item.uid === ignoreUid) continue;
    const def = furnitureById(item.typeId);
    const w = item.w || def?.w || 1;
    const h = item.h || def?.h || 1;
    if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) return item;
  }
  return null;
}

export function isWalkableTile(layout, x, y) {
  const t = tileAt(layout, x, y);
  if (t !== 'floor' && t !== 'door' && t !== 'pass' && t !== 'restroom') return false;
  // 座位格（椅子）可通行；桌椅本身已在 blockingItemAt 判斷
  return !blockingItemAt(layout, x, y);
}

/** 從大門洪水填充，標記可達格（顧客動線） */
export function recomputeReachability(layout) {
  const total = layout.gridW * layout.gridH;
  const reach = new Uint8Array(total);
  const fromPass = new Uint8Array(total);
  const gx = layout.gridW; const gy = layout.gridH;
  const key = (x, y) => y * gx + x;

  const flood = (starts, out) => {
    const queue = [];
    for (const s of starts) {
      if (!s) continue;
      if (!isWalkableTile(layout, s.x, s.y)) {
        // 大門可能被堵住：改從鄰格出發
        const alt = [
          { x: s.x, y: s.y - 1 }, { x: s.x - 1, y: s.y }, { x: s.x + 1, y: s.y }, { x: s.x, y: s.y + 1 }
        ].find((p) => isWalkableTile(layout, p.x, p.y));
        if (!alt) continue;
        if (!out[key(alt.x, alt.y)]) { out[key(alt.x, alt.y)] = 1; queue.push(alt); }
        continue;
      }
      if (!out[key(s.x, s.y)]) { out[key(s.x, s.y)] = 1; queue.push(s); }
    }
    while (queue.length) {
      const { x, y } = queue.shift();
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue;
        const kk = key(nx, ny);
        if (out[kk]) continue;
        if (!isWalkableTile(layout, nx, ny)) continue;
        out[kk] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  };

  flood([layout.door], reach);
  flood(layout.passTiles.length ? layout.passTiles : [{ x: 1, y: 1 }], fromPass);
  layout.reach = reach;
  layout.reachFromPass = fromPass;
  return reach;
}

export function isReachable(layout, x, y, from = 'door') {
  const map = from === 'pass' ? layout.reachFromPass : layout.reach;
  if (!map) recomputeReachability(layout);
  const m = from === 'pass' ? layout.reachFromPass : layout.reach;
  if (!inBounds(layout, x, y)) return false;
  return !!m[y * layout.gridW + x];
}

/* ------------------------------------------------------------- 擺放合法性 */

/** 目前有多少個座位同時連通大門與出餐口（可用座位數） */
export function reachableSeatCount(layout) {
  let count = 0;
  for (const table of computeTables(layout)) {
    for (const s of table.seats) {
      if (s.reachDoor && s.reachPass) count += 1;
    }
  }
  return count;
}

/**
 * @returns {{ok:boolean, error?:string}}
 */
export function canPlace(layout, typeId, x, y, ignoreUid = null) {
  const def = furnitureById(typeId);
  if (!def) return { ok: false, error: '沒有這件傢俱' };
  const w = def.w || 1;
  const h = def.h || 1;
  if (x < 0 || y < 0 || x + w > layout.gridW || y + h > layout.gridH) {
    return { ok: false, error: '超出餐廳範圍' };
  }
  const wallMount = def.category === 'equipment';
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const tx = x + i; const ty = y + j;
      const t = tileAt(layout, tx, ty);
      if (wallMount) {
        if (t !== 'wall' && t !== 'floor') return { ok: false, error: '設備只能裝在牆面或空地上' };
      } else if (t !== 'floor') {
        return { ok: false, error: '只能擺在用餐區地板上' };
      }
      const occ = isOccupied(layout, tx, ty, ignoreUid);
      if (occ) return { ok: false, error: '這個位置已經有東西了' };
    }
  }
  // 會阻擋通行的傢俱不能破壞動線：擺上去之後「連通大門與出餐口的座位數」不得減少
  if (def.blocks) {
    const before = reachableSeatCount(layout);
    const fake = { uid: '__tmp__', typeId, x, y, w, h };
    layout.items.push(fake);
    recomputeReachability(layout);
    const after = reachableSeatCount(layout);
    layout.items.pop();
    recomputeReachability(layout);
    if (after < before) {
      return { ok: false, error: '這樣擺會擋住動線，客人進不來或服務生走不到出餐口' };
    }
    if (before === 0 && after === 0 && def.category === 'table') {
      return { ok: false, error: '這張桌子客人走不到，換個位置吧' };
    }
  }
  return { ok: true };
}

/** 自動找一個合法位置（設備優先用牆面） */
export function findAutoPlace(layout, typeId) {
  const def = furnitureById(typeId);
  if (!def) return null;
  const wallsFirst = def.category === 'equipment';
  const order = [];
  for (let y = 1; y < layout.gridH - 1; y++) {
    for (let x = 1; x < layout.gridW - 1; x++) order.push({ x, y });
  }
  if (wallsFirst) {
    order.sort((a, b) => {
      const wa = tileAt(layout, a.x, a.y) === 'wall' ? 0 : 1;
      const wb = tileAt(layout, b.x, b.y) === 'wall' ? 0 : 1;
      return wa - wb;
    });
  }
  for (const p of order) {
    if (canPlace(layout, typeId, p.x, p.y).ok) return p;
  }
  return null;
}

/* --------------------------------------------------------- 桌椅與座位推導 */

const SIDE_DIRS = [
  { dx: 0, dy: -1, facing: 'S' },
  { dx: 0, dy: 1, facing: 'N' },
  { dx: -1, dy: 0, facing: 'E' },
  { dx: 1, dy: 0, facing: 'W' }
];

/**
 * 由 layout.items 推導桌子與座位。
 * 座位＝桌子四周可通行的地板格；每張相鄰的椅子可額外增加座位（上限 +2）。
 */
export function computeTables(layout) {
  const tables = [];
  const claimed = new Set();

  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    if (!def || def.category !== 'table') continue;
    const w = item.w || def.w || 1;
    const h = item.h || def.h || 1;
    const seats = [];

    // 自動配來的椅子就是座位（每張椅子對應一個座位）
    const chairDefs = (item.chairUids || []).map((uid) => layout.items.find((c) => c.uid === uid)).filter(Boolean);
    for (const chair of chairDefs) {
      const key = chair.x + ',' + chair.y;
      if (claimed.has(key)) continue;
      if (!isWalkableTileSimple(layout, chair.x, chair.y)) continue;
      // 面向桌子中心
      const cx = item.x + w / 2, cy = item.y + h / 2;
      const dx = chair.x - cx, dy = chair.y - cy;
      const facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
      claimed.add(key);
      seats.push({ x: chair.x, y: chair.y, facing, chair: true, key });
    }

    // 空位補齊：周圍可通行的地板格（桌子沒配滿椅子時的備位）
    if (seats.length < (def.seats || 2)) {
      const SIDE = [[0, -1, 'S'], [0, 1, 'N'], [-1, 0, 'E'], [1, 0, 'W']];
      for (const [ddx, ddy, f] of SIDE) {
        for (let i = 0; i < w && seats.length < (def.seats || 2); i++) {
          for (let j = 0; j < h && seats.length < (def.seats || 2); j++) {
            const tx = item.x + i + ddx;
            const ty = item.y + j + ddy;
            const key = tx + ',' + ty;
            if (claimed.has(key)) continue;
            if (!isWalkableTileSimple(layout, tx, ty)) continue;
            claimed.add(key);
            seats.push({ x: tx, y: ty, facing: f, chair: false, key });
          }
        }
      }
    }

    const maxSeats = Math.min(def.seats || 2, seats.length);
    const finalSeats = seats.slice(0, maxSeats).map((c) => {
      claimed.add(c.key);
      const reachDoor = isReachable(layout, c.x, c.y, 'door');
      const reachPass = isReachable(layout, c.x, c.y, 'pass');
      return { x: c.x, y: c.y, facing: c.facing, chair: c.chair, reachDoor, reachPass };
    });

    tables.push({
      uid: item.uid,
      itemUid: item.uid,
      x: item.x,
      y: item.y,
      w, h,
      name: def.name,
      seats: finalSeats,
      usable: finalSeats.length > 0 && finalSeats.some((s) => s.reachDoor && s.reachPass),
      serviceTile: finalSeats.find((s) => s.reachPass) || finalSeats[0] || null,
      occupants: [],
      state: 'clean',
      dirtySince: null,
      waiterUid: null
    });
  }
  return tables;
}

/** 檢查一格是否為可通行的地板（模組層級，供 canPlace 等使用） */
function isWalkableTileSimple(layout, x, y) {
  if (x < 0 || y < 0 || x >= layout.gridW || y >= layout.gridH) return false;
  const t = layout.tiles[y * layout.gridW + x];
  if (t !== 'floor') return false;
  return !blockingItemAt(layout, x, y);
}

/** 裝潢分數（風格相符加成） */
export function decorScore(layout, location) {
  let total = 0;
  let matched = 0;
  let count = 0;
  const style = location?.decorStyle;
  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    if (!def) continue;
    const base = def.decorScore || 0;
    let mul = 1;
    if (style && def.style) {
      if (def.style === style) { mul = 1.35; matched++; }
      else if (def.style === 'plain') mul = 1;
      else mul = 0.8;
    }
    const wear = item.durability === undefined ? 1 : 0.6 + 0.4 * (Math.max(0, item.durability) / 100);
    total += base * mul * wear;
    count++;
  }
  const avg = count ? total / count : 0;
  return { total: Math.round(total), avg: Math.round(avg), matched, count };
}

export function seatCount(tables) {
  return tables.reduce((sum, t) => sum + (t.usable ? t.seats.length : 0), 0);
}

export function totalSeatCount(tables) {
  return tables.reduce((sum, t) => sum + t.seats.length, 0);
}

export function layoutValue(layout) {
  let v = 0;
  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    v += def?.price || 0;
  }
  return v;
}

export function countBroken(layout) {
  return layout.items.filter((i) => i.broken).length;
}

export function repairableItems(layout) {
  return layout.items.filter((i) => (i.durability ?? 100) < 60 || i.broken);
}

export function findItem(layout, uid) {
  return layout.items.find((i) => i.uid === uid) || null;
}

/** 旋轉值 → 面向（與 render/sprites.js 的 rotToDir 一致） */
const ROT_OF_DIR = { S: 0, E: 1, N: 2, W: 3 };

/**
 * 椅子自動轉向：面向相鄰的桌子（椅背朝外才自然）。
 * 玩家手動旋轉過的椅子（rotManual）不覆蓋。
 * 繪圖層請優先讀 `item.rotAuto ?? item.rot`。
 */
export function orientChairs(layout) {
  const tableAt = (x, y) => layout.items.some((it) => {
    const d = furnitureById(it.typeId);
    if (d?.category !== 'table') return false;
    const w = it.w || d.w || 1;
    const h = it.h || d.h || 1;
    return x >= it.x && x < it.x + w && y >= it.y && y < it.y + h;
  });
  const NEIGHBOURS = [
    { dx: 0, dy: -1, dir: 'N' },
    { dx: 0, dy: 1, dir: 'S' },
    { dx: -1, dy: 0, dir: 'W' },
    { dx: 1, dy: 0, dir: 'E' }
  ];
  for (const item of layout.items) {
    const def = furnitureById(item.typeId);
    if (def?.category !== 'chair' || item.rotManual) { delete item.rotAuto; continue; }
    const hit = NEIGHBOURS.find((n) => tableAt(item.x + n.dx, item.y + n.dy));
    if (hit) item.rotAuto = ROT_OF_DIR[hit.dir];
    else delete item.rotAuto;
  }
}

/** 重建 state.sim.tables（保留既有桌子的執行期狀態） */
export function rebuildTables(state) {
  const layout = state.layout;
  recomputeReachability(layout);
  orientChairs(layout);
  const next = computeTables(layout);
  const prev = new Map((state.sim?.tables || []).map((t) => [t.uid, t]));
  for (const t of next) {
    const old = prev.get(t.uid);
    if (old) {
      t.occupants = old.occupants || [];
      t.state = old.state || 'clean';
      t.dirtySince = old.dirtySince ?? null;
      t.waiterUid = old.waiterUid ?? null;
      t.pendingOrders = old.pendingOrders || [];
      t.cleanProgress = old.cleanProgress || 0;
    }
    t.pendingOrders = t.pendingOrders || [];
  }
  state.sim.tables = next;
  state.layout.reach = layout.reach;
  state.layout.reachFromPass = layout.reachFromPass;
  return next;
}


/** 桌子周圍可通行的地板格（用來自動配椅子） */
export function tableNeighborSpots(layout, item) {
  const def = furnitureById(item.typeId);
  const w = item.w || def?.w || 1;
  const h = item.h || def?.h || 1;
  const spots = [];
  const SIDE_DIRS = [
    { dx: 0, dy: -1, facing: 'S' },
    { dx: 0, dy: 1, facing: 'N' },
    { dx: -1, dy: 0, facing: 'E' },
    { dx: 1, dy: 0, facing: 'W' }
  ];
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < layout.gridW && y < layout.gridH;
  const isFloor = (x, y) => {
    if (!inBounds(x, y)) return false;
    const t = layout.tiles[y * layout.gridW + x];
    if (t !== 'floor') return false;
    for (const it of layout.items) {
      if (it.uid === item.uid) continue;
      const d = furnitureById(it.typeId);
      const iw = it.w || d?.w || 1;
      const ih = it.h || d?.h || 1;
      if (x >= it.x && x < it.x + iw && y >= it.y && y < it.y + ih) return false;
    }
    return true;
  };
  const seen = new Set();
  for (const side of SIDE_DIRS) {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const tx = item.x + i + side.dx;
        const ty = item.y + j + side.dy;
        const key = tx + ',' + ty;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isFloor(tx, ty)) spots.push({ x: tx, y: ty, facing: side.facing });
      }
    }
  }
  return spots;
}

/** 為一張桌子自動產生椅子（回傳新建的椅子 uid 陣列） */
export function autoPlaceChairs(state, tableItem, nextUid) {
  const def = furnitureById(tableItem.typeId);
  const maxSeats = def?.seats || 2;
  const spots = tableNeighborSpots(state.layout, tableItem);
  const count = Math.min(maxSeats, spots.length);
  // 注意：這裡必須用 furnitureByCategory（build.js 沒有 import FURNITURE 本體，
  // 先前用 typeof FURNITURE 判斷會靜默取不到椅子 → 開局完全沒有椅子）
  const chairDef = furnitureByCategory('chair')[0] || null;
  if (!chairDef || count <= 0) return [];
  const chairId = tableItem.chairTypeId || chairDef.id;
  const uids = [];
  for (let i = 0; i < count; i++) {
    const spot = spots[i];
    const uid = nextUid(state);
    state.layout.items.push({
      uid, typeId: chairId,
      x: spot.x, y: spot.y,
      w: 1, h: 1, rot: 0,
      durability: 100, broken: false,
      autoChair: true, chairFor: tableItem.uid
    });
    uids.push(uid);
  }
  return uids;
}

/** 取得或建立餐廳內可站立的最近格（給員工／顧客用） */
export function nearestWalkable(layout, x, y, maxRadius = 6) {
  if (isWalkableTile(layout, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx; const ny = y + dy;
        if (isWalkableTile(layout, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}
