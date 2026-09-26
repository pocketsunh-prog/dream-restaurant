import fs from 'node:fs';

const p = process.argv[2];
const L = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const idxOf = (prefix) => {
  const i = L.findIndex((l) => l.startsWith(prefix));
  if (i < 0) throw new Error('not found: ' + prefix);
  return i;
};
const idxOfExact = (pred) => {
  const i = L.findIndex(pred);
  if (i < 0) throw new Error('not found by predicate');
  return i;
};

// 三個被編碼弄壞的註解列
const firstComment = idxOfExact((l) => l.startsWith('/* -') && l.includes('模'));
L[firstComment] = '/* --------------------------------------------------------------- 狀態模型 */';

const secondComment = idxOfExact((l) => l.startsWith('/* -') && l.includes('建'));
L[secondComment] = '/* --------------------------------------------------------------- 建立狀態 */';

const rebuild = idxOf('val REBUILD_ITEMS = listOf(');
L[rebuild - 1] = '/** 開局傢俱（自動重建範本） */';

// 蛋包飯兩列（缺右引號）
const starter = idxOf('    val starterDishes = mutableListOf<Dish>()');
L[starter + 2] = '    if (starterDishes.none { it.name.contains("蛋包飯") }) {';
L[starter + 3] = '        com.dreamrestaurant.data.DISHES.firstOrNull { it.name.contains("蛋包飯") }';

fs.writeFileSync(p, L.join('\r\n'), 'utf8');
console.log('repaired', { firstComment, secondComment, rebuild, starter });
