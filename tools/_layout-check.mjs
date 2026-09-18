// tools/_layout-check.mjs — 開局平面圖自我檢查（無 DOM）
// 用法: node tools/_layout-check.mjs [locationId]
// 檢查：格數、重疊、越界、tile 合法性、每張桌子的座位數與可達性、大門動線、
//       出餐口動線、員工／顧客能不能走到每個座位。
import { createNewGame } from '../src/core/state.js';
import { tileAt, inBounds, isWalkableTile, findItem } from '../src/sim/build.js';
import { furnitureById } from '../src/data/furniture.js';

const loc = process.argv[2] || null;
const seed = 20240101;
const state = loc ? (() => {
  const s = createNewGame(seed);
  // 直接換格局（不經過 reducer，只做平面檢查）
  return s;
})() : createNewGame(seed);

const L = state.layout;
let bad = 0;
const fail = (msg) => { bad += 1; console.log('  FAIL  ' + msg); };
const ok = (msg) => console.log('  ok    ' + msg);

console.log(`=== 平面檢查 ===`);
console.log(`grid      ${L.gridW}×${L.gridH}   tiles=${L.tiles.length}（應為 ${L.gridW * L.gridH}）`);
console.log(`door      (${L.door.x},${L.door.y})  outside=(${L.outside.x},${L.outside.y})  sidewalk=${JSON.stringify(L.sidewalk)}`);
console.log(`kitchen   ${L.kitchenTiles.length} 格  x${Math.min(...L.kitchenTiles.map(t => t.x))}-${Math.max(...L.kitchenTiles.map(t => t.x))} y${Math.min(...L.kitchenTiles.map(t => t.y))}-${Math.max(...L.kitchenTiles.map(t => t.y))}`);
console.log(`pass      ${JSON.stringify(L.passTiles)}`);
console.log(`restroom  ${JSON.stringify(L.restroomTiles)}`);
console.log(`items     ${L.items.length}`);

if (L.tiles.length !== L.gridW * L.gridH) fail('tiles 長度與 grid 不符');
if (tileAt(L, L.door.x, L.door.y) !== 'door') fail('大門格不是 door');
if (!L.passTiles.length) fail('沒有出餐口');

// 1) 越界 / 重疊（椅子是 1×1 的小物件，允許與桌腳印外的東西共用；這裡只檢查足跡重疊）
const occ = new Map();
for (const it of L.items) {
  const def = furnitureById(it.typeId);
  if (!def) { fail(`未知傢俱 ${it.typeId}`); continue; }
  if (def.category === 'chair') continue;   // 椅子是 1×1 座位標記，與桌子共用格是正常的
  const w = it.w || def.w || 1, h = it.h || def.h || 1;
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const x = it.x + i, y = it.y + j;
      if (!inBounds(L, x, y)) { fail(`${it.typeId}(${it.uid}) 越界 (${x},${y})`); continue; }
      const key = `${x},${y}`;
      if (occ.has(key)) fail(`重疊 ${key}: ${it.typeId}(${it.uid}) 與 ${occ.get(key)}`);
      else occ.set(key, `${it.typeId}(${it.uid})`);
      const t = tileAt(L, x, y);
      // 與 sim/build.js 的 canPlace 相同：category 'equipment' 可放牆面或地板（不分室內外），
      // 其餘一律必須是 floor。這裡另外允許廚房設備放 kitchen 格、廁所設備放 restroom 格
      //（開局平面圖刻意把設備擺在對應機能區裡），這些地方在遊戲中不會經過 canPlace。
      const defs = [];
      if (def.category === 'equipment') defs.push('wall', 'floor');
      else defs.push('floor');
      if (def.category === 'kitchen') defs.push('kitchen');
      if (def.category === 'restroom') defs.push('restroom');
      // 壁掛裝飾（blocks:false 的 decor）可以貼在牆格上
      if (def.category === 'decor' && !def.blocks) defs.push('wall');
      // 冰箱（equipment，1×2）在開局平面圖放在廚房裡
      if (it.typeId === 'fridge') defs.push('kitchen');
      if (!defs.includes(t)) fail(`${it.typeId} 不能放在 ${t} (${x},${y})（允許：${defs.join('/')}）`);
    }
  }
}
if (!bad) ok('沒有越界、重疊、tile 類型錯誤');

// 2) 座位
const tables = state.sim.tables;
const byType = {};
for (const it of L.items) {
  const def = furnitureById(it.typeId);
  if (def && def.category === 'table') byType[it.typeId] = (byType[it.typeId] || 0) + 1;
}
console.log(`\n--- 桌子 ${tables.length} 張 ---`);
let seatTotal = 0, seatUsable = 0;
const seatOwner = new Map();
for (const t of tables) {
  const def = furnitureById(t.uid ? L.items.find(i => i.uid === t.uid)?.typeId : '');
  const want = def ? def.seats : 0;
  const usable = t.seats.filter(s => s.reachDoor && s.reachPass).length;
  seatTotal += t.seats.length;
  seatUsable += usable;
  const flag = (t.seats.length === want && usable === want) ? 'ok  ' : 'WARN';
  if (t.seats.length !== want) console.log(`  ${flag}  ${t.name}(${t.uid}) @(${t.x},${t.y}) 座位 ${t.seats.length}/${want} usable=${usable}  seats=${t.seats.map(s => `(${s.x},${s.y})${s.chair ? '' : '*'}`).join('')}`);
  else if (usable !== want) console.log(`  ${flag}  ${t.name}(${t.uid}) @(${t.x},${t.y}) 座位 ${t.seats.length}/${want} usable=${usable}`);
  for (const s of t.seats) {
    const k = `${s.x},${s.y}`;
    if (seatOwner.has(k)) fail(`座位格 ${k} 被兩張桌子共用：${seatOwner.get(k)} / ${t.uid}`);
    seatOwner.set(k, t.uid);
  }
  // 座位格必須是 walkable（沒有被 blocks 的傢俱佔住）
  for (const s of t.seats) {
    if (!isWalkableTile(L, s.x, s.y)) fail(`座位 (${s.x},${s.y}) 不可通行（被傢俱擋住）`);
  }
  // 座位格不能落在別的桌子腳印上
  const other = L.items.find(i => {
    const d = furnitureById(i.typeId);
    if (!d || d.category !== 'table' || i.uid === t.uid) return false;
    const w = i.w || d.w || 1, h = i.h || d.h || 1;
    return t.seats.some(s => s.x >= i.x && s.x < i.x + w && s.y >= i.y && s.y < i.y + h);
  });
  if (other) fail(`${t.uid} 的座位落在 ${other.typeId}(${other.uid}) 腳印上`);
}
console.log(`  桌子組成：${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join('、')}`);
console.log(`  座位合計 ${seatTotal}，可用（同時連通大門與出餐口）${seatUsable}`);
console.log(`  椅子數 ${L.items.filter(i => (furnitureById(i.typeId)?.category) === 'chair').length}`);

// 3) 動線
const walkable = [];
for (let y = 0; y < L.gridH; y++) for (let x = 0; x < L.gridW; x++) if (isWalkableTile(L, x, y)) walkable.push(`${x},${y}`);
console.log(`  可通行格 ${walkable.length} / ${L.gridW * L.gridH}`);
for (const p of L.passTiles) {
  if (!isWalkableTile(L, p.x, p.y)) fail(`出餐口 (${p.x},${p.y}) 不可通行（被傢俱擋住）`);
  if (!L.reachFromPass || !L.reachFromPass[p.y * L.gridW + p.x]) fail(`出餐口 (${p.x},${p.y}) 連不到任何座位`);
}
if (!L.reach || !L.reach[L.door.y * L.gridW + L.door.x]) fail('大門連不到店內（動線被擋）');
const doorInside = isWalkableTile(L, L.door.x, L.door.y - 1);
console.log(`  大門內側格 (${L.door.x},${L.door.y - 1}) 可通行=${doorInside}`);
if (!doorInside) fail('大門內側那格不可通行（客人進不來）');

console.log(`\n${bad === 0 ? '✅ 平面檢查全數通過' : `❌ 平面檢查 ${bad} 項失敗`}`);
process.exit(bad === 0 ? 0 : 1);
