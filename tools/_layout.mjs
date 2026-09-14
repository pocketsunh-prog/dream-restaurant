import fs from 'node:fs';
import { FURNITURE, furnitureById } from '../src/data/furniture.js';

/* ============================================================
 *  高級開局店面設計：最大桌、頂級裝潢、全套設備
 *  網格 20×13，格局依 defaultLayout（廚房左上、廁所右上）
 * ============================================================ */

function def(id) { const d = furnitureById(id); if (!d) throw new Error('no ' + id); return d; }

// 基本格局（覆蓋）
const tiles = [];
const GW = 20, GH = 13;
function setTile(x, y, t) { tiles[y * GW + x] = t; }

// 外牆
for (let x = 0; x < GW; x++) { setTile(x, 0, 'wall'); setTile(x, GH - 1, 'wall'); }
for (let y = 0; y < GH; y++) { setTile(0, y, 'wall'); setTile(GW - 1, y, 'wall'); }

// 廚房（左上 x1..7, y1..3）
for (let y = 1; y <= 3; y++) for (let x = 1; x <= 7; x++) setTile(x, y, 'kitchen');
// 出餐口
setTile(2, 4, 'pass'); setTile(4, 4, 'pass');

// 廁所（右上）
setTile(16, 1, 'restroom'); setTile(17, 1, 'restroom');

// 大門（南牆 x=9）
setTile(9, GH - 1, 'door');

// 剩餘皆為地板
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
  if (!tiles[y * GW + x]) setTile(x, y, 'floor');
}

const items = [];
function add(id, x, y) {
  const d = def(id);
  items.push({ uid: 'init_' + items.length, typeId: id, x, y, w: d.w || 1, h: d.h || 1, rot: 0, durability: 100, broken: false });
}

// ===== 廚房設備（頂級）=====
add('kitchen_stove', 1, 1);       // 快速爐灶 2×1
add('kitchen_worktable', 3, 1);   // 不鏽鋼料理台 2×1
add('kitchen_dishwasher', 5, 1);  // 洗碗機 1×1
// fridge 1×2
add('fridge', 6, 1);              // 商用冰箱

// ===== 設備（牆面）=====
add('ac_unit', 0, 4);             // 冷氣（牆）
add('ceiling_lamp', 10, 0);       // 吊燈（牆）
add('stereo', 15, 0);             // 音響（牆）
add('cctv', 19, 4);               // 監視器（牆）
add('infrared_sensor', 19, 5);    // 紅外線（牆）
add('fire_extinguisher', 0, 8);   // 滅火器（牆）
add('fire_system', 19, 8);        // 消防設備（牆）
add('security_host', 0, 9);       // 保全主機（牆）

// ===== 桌子（全部用最大的六人宴會桌）=====
const TABLE = 'table_6b';  // 六人宴able, decorScore 18
// 第一排（5 張大桌）
add(TABLE, 1, 5);
add(TABLE, 4, 5);
add(TABLE, 7, 5);
add(TABLE, 10, 5);
// 第二排（4 張大桌 + 吧台）
add(TABLE, 1, 8);
add(TABLE, 4, 8);
add(TABLE, 7, 8);
add(TABLE, 10, 8);

// ===== 吧台（頂級）=====
add('counter_bar', 14, 10);  // 時尚吧台 3×1

// ===== 廁所設備 =====
add('restroom_toilet', 16, 1);
add('restroom_sink', 17, 1);

// ===== 頂級裝潢 =====
add('fountain_small', 13, 5);   // 小型噴水池 2×2 decorScore 16
add('jukebox', 14, 7);          // 點唱機 decorScore 14
add('neon_sign', 0, 6);         // 霓虹招牌 decorScore 12（牆）
add('painting_landscape', 0, 2); // 山水國畫 decorScore 10（牆）
add('photo_wall', 19, 2);       // 名人簽名牆 decorScore 9（牆）
add('lantern_row', 13, 10);     // 大紅燈籠 decorScore 11（牆）

// ===== 驗證：每格不超出邊界、不重疊 =====
const occupied = new Set();
let ok = true;
for (const it of items) {
  const d = def(it.typeId);
  for (let i = 0; i < d.w; i++) for (let j = 0; j < d.h; j++) {
    const tx = it.x + i, ty = it.y + j;
    if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) { console.log('OUT', it.typeId, tx, ty); ok = false; }
    const key = tx + ',' + ty;
    if (occupied.has(key)) { console.log('OVERLAP', it.typeId, key); ok = false; }
    occupied.add(key);
  }
}

console.log('items:', items.length, 'valid:', ok);
if (!ok) process.exit(1);

// 輸出為 JS 陣列
const js = items.map((it) => `    { typeId: '${it.typeId}', x: ${it.x}, y: ${it.y} }`).join(',\n');
console.log('\n// === 貼到 src/core/state.js 的 premiumStarterItems ===\n');
console.log('const premiumStarterItems = [\n' + js + '\n  ];');
