// ============================================================================
// pathfind.js — 四方向 A*，附快取。網格只有 260 格，用簡單的二元堆就夠快。
// ============================================================================
import { isWalkableTile } from './build.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1; const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

const cache = new Map();
const CACHE_LIMIT = 4000;

export function clearPathCache() {
  cache.clear();
}

/**
 * @returns {Array<{x:number,y:number}>|null} 不含起點、含終點的路徑
 */
export function findPath(layout, from, to) {
  if (!layout || !from || !to) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const rev = layout.rev || 0;
  const key = `${rev}|${from.x},${from.y}>${to.x},${to.y}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit ? hit.map((p) => ({ x: p.x, y: p.y })) : null;

  const result = astar(layout, from, to);
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result ? result.map((p) => ({ x: p.x, y: p.y })) : null;
}

function astar(layout, from, to) {
  const gx = layout.gridW;
  if (!isWalkableTile(layout, to.x, to.y)) {
    // 目標不可通行：嘗試站到旁邊
    const alt = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      .map(([dx, dy]) => ({ x: to.x + dx, y: to.y + dy }))
      .filter((p) => isWalkableTile(layout, p.x, p.y));
    if (!alt.length) return null;
    to = alt[0];
    if (from.x === to.x && from.y === to.y) return [];
  }
  if (!isWalkableTile(layout, from.x, from.y)) return null;

  const h = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const open = new MinHeap();
  const gScore = new Map();
  const came = new Map();
  const startKey = from.y * gx + from.x;
  gScore.set(startKey, 0);
  open.push({ x: from.x, y: from.y, k: startKey, f: h(from.x, from.y) });
  const goalKey = to.y * gx + to.x;
  const closed = new Set();
  let guard = 0;

  while (open.size) {
    if (++guard > 6000) break;
    const cur = open.pop();
    if (closed.has(cur.k)) continue;
    closed.add(cur.k);
    if (cur.k === goalKey) {
      const path = [];
      let k = cur.k;
      while (k !== startKey) {
        path.push({ x: k % gx, y: Math.floor(k / gx) });
        k = came.get(k);
        if (k === undefined) return null;
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx; const ny = cur.y + dy;
      if (!isWalkableTile(layout, nx, ny)) continue;
      const nk = ny * gx + nx;
      if (closed.has(nk)) continue;
      const tentative = (gScore.get(cur.k) ?? Infinity) + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative);
        came.set(nk, cur.k);
        open.push({ x: nx, y: ny, k: nk, f: tentative + h(nx, ny) });
      }
    }
  }
  return null;
}

/** 用於除錯／繪製：兩格之間的直線距離（等角） */
export function tileDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 沿路徑前進，回傳新的 {x,y,dir}；arrived 表示是否抵達終點 */
export function advanceAlong(path, index, x, y, step, dirOf) {
  let idx = index;
  let px = x; let py = y;
  let remain = step;
  let dir = undefined;
  while (remain > 0 && idx < path.length) {
    const node = path[idx];
    const dx = node.x - px;
    const dy = node.y - py;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= remain) {
      if (dist > 0) dir = dirOf(node.x - px, node.y - py);
      px = node.x; py = node.y;
      remain -= dist;
      idx++;
    } else {
      dir = dirOf(dx, dy);
      px += Math.sign(dx) * remain;
      py += Math.sign(dy) * remain;
      remain = 0;
    }
  }
  return { x: px, y: py, index: idx, arrived: idx >= path.length, dir };
}

export function dirFromDelta(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  if (dy !== 0) return dy > 0 ? 'S' : 'N';
  return 'S';
}
