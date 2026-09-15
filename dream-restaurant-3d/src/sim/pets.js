// ============================================================================
// pets.js — ペットスペース（ドッグラン）の模擬
//   ・店に座っている（＝食事中の）組のペットだけが遊びに行ける
//   ・ペットは自分で遊び場まで歩いて行き、しばらく遊んでから席へ戻る
//   呼び出し側（sim/game.js の tick）から tickPets(state, dtMin) を呼ぶこと。
//   ここは純資料（DOM なし・決定論的）。狀態全部寫在 group 上的純 JSON 欄位，
//   所以 sim/save.js 直接 JSON 化 state 時會一起被保存。
// ============================================================================

/** ドッグランの定員（同時に遊べるペット数。これ以上は遊びに行かない） */
export const PET_CAPACITY = 3;
/** 遊びに行ける＝店に座っている狀態（sim/game.js の group.state と同じ文字列） */
export const PET_SEATED_STATES = Object.freeze(['ordering', 'waitCook', 'waitServe', 'eating', 'waitPay']);
/** 遊び場にいる（＝マット以外の座標を使っている）狀態 */
export const PET_AWAY_STATES = Object.freeze(['toPlay', 'play', 'back']);
/** 遊び場（矩形）の既定尺寸（m）：幅 3.4 / 進深 1.5 */
export const PET_AREA_W = 3.4;
export const PET_AREA_D = 1.5;
/** 柵の出入口（scene/petarea.js も同じ値で柵を組む） */
export const PET_GAP_E = 1.0;   // 東側＝店の前に面した隙間（北半分。ペットはここを通る）
export const PET_GAP_N = 0.9;   // 北側＝店に面した隙間
/** 遊び場の中心 x（店の西側の歩道。入口動線 1.2±1.2 と候位レーンから離す） */
export const PET_AREA_X = -4.2;
/** 遊び場の中心 z：歩道の中心（outside.z）より少し南＝店の前の通行帶に被らない */
export const PET_AREA_Z_OFFSET = 2.4;
/** 歩く速さ（m / ゲーム分）。遊んでいるときは少し速い */
export const PET_WALK_SPEED = 1.4;
export const PET_PLAY_SPEED = 1.9;
/** 1 tick で面倒を見るペット組の上限（ペットが多い日の保險） */
export const PET_TICK_BUDGET = 32;
/** 1 回の tickPets で進める最大ゲーム分（タブ復帰の取りこぼしで一気に飛ばさない） */
const PET_MAX_DT = 5;
/** 歩きっぱなしにならないための上限（ゲーム分）。超えたら必ず席へ戻す */
const PET_WALK_TIMEOUT = 26;
/** 柵にめり込まないための余白（m） */
const PET_EDGE = 0.32;

const SEATED = new Set(PET_SEATED_STATES);
const AWAY = new Set(PET_AWAY_STATES);

/** 使い回しの作業用物件（tick ごとの allocation を避ける） */
const _anchor = { x: 0, z: 0 };
const _door = { x: 1.2, insideZ: 4.7, outsideZ: 6.5 };
const _gap = { x: 0, z: 0 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 決定論的な 0..1 ハッシュ（Math.random は使わない） */
function hash01(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** state.rng() があれば使う（無い場合も決定論を崩さない） */
function rndOf(state) {
  return typeof state?.rng === 'function' ? state.rng() : 0.5;
}
const rndRange = (state, a, b) => a + (b - a) * rndOf(state);

/* ------------------------------------------------------------ 遊び場の矩形 */

/**
 * ペットスペース（ドッグラン）の矩形。
 * 平面圖（state.plan）から導出：店の西側の歩道の上、入口動線と候位レーンを避けた位置。
 * @param {object} state 遊戲狀態（state.plan を読むだけ）
 * @returns {{x:number,z:number,w:number,d:number,cx:number,cz:number}} x/z 為中心（cx/cz 同值）
 */
export function petAreaOf(state) {
  const plan = state?.plan || {};
  const depth = num(plan.depth, 9.6);
  const width = num(plan.width, 13.2);
  const outsideZ = num(plan.outside?.z, depth / 2 + 1.7);
  // 歩道（buildOutside：26 × 3.4、中心 outside.z）からはみ出さないように挟む
  const walkHalf = 1.7;
  const w = Math.min(PET_AREA_W, Math.max(1.6, width - 2.0));
  const d = Math.min(PET_AREA_D, walkHalf * 2 - 0.4);
  const cx = clamp(PET_AREA_X, -width / 2 + 0.4 + w / 2, width / 2 - 0.4 - w / 2);
  const cz = clamp(depth / 2 + PET_AREA_Z_OFFSET,
    outsideZ - walkHalf + 0.2 + d / 2, outsideZ + walkHalf - 0.2 - d / 2);
  return { x: cx, z: cz, w, d, cx, cz };
}

/** 矩形の中にいるか（margin だけ內側で判定） */
export function petAreaContains(area, x, z, margin = 0) {
  if (!area || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.abs(x - area.cx) <= area.w / 2 - margin && Math.abs(z - area.cz) <= area.d / 2 - margin;
}

/** 遊び場の中の決定論的な 1 点（柵にぶつからない余白を取る） */
export function petSpotIn(area, seed = 1) {
  const a = area || { cx: 0, cz: 0, w: PET_AREA_W, d: PET_AREA_D };
  const w = Math.max(0.3, a.w - PET_EDGE * 2);
  const d = Math.max(0.3, a.d - PET_EDGE * 2);
  return {
    x: a.cx + (hash01(seed, 1.7) - 0.5) * w,
    z: a.cz + (hash01(seed, 9.3) - 0.5) * d
  };
}

/** 今の場所の近くの 1 点（遊んでいるときの小さな跳ね回り先）。必ず場內に收める */
export function petSpotNear(area, x, z, radius, seed = 1) {
  const a = area || { cx: 0, cz: 0, w: PET_AREA_W, d: PET_AREA_D };
  const hw = Math.max(0.1, a.w / 2 - PET_EDGE);
  const hd = Math.max(0.1, a.d / 2 - PET_EDGE);
  return {
    x: clamp(x + (hash01(seed, 3.1) - 0.5) * 2 * radius, a.cx - hw, a.cx + hw),
    z: clamp(z + (hash01(seed, 5.9) - 0.5) * 2 * radius, a.cz - hd, a.cz + hd)
  };
}

/** ペットが今マット以外（＝遊び場側）の座標を使っているか */
export function petIsAway(g) {
  return !!g && AWAY.has(g.petState) && Number.isFinite(g.petX) && Number.isFinite(g.petZ);
}

/* ------------------------------------------------------------ 內部工具 */

/** 平面圖からペットのテーブルを探す（戻る先の基準點） */
function tableOf(plan, g) {
  const list = plan?.floorPlans?.[g.floor || 0]?.tables;
  if (!Array.isArray(list)) return null;
  for (const t of list) if (t?.id === g.tableId) return t;
  return null;
}

/**
 * ペットが今いる場所（店內）の近似座標。
 * ペット同伴席ならテーブル、それ以外は先頭の客の橫。全部無ければ入口。
 */
function petAnchor(g, plan) {
  const t = g.petTable ? tableOf(plan, g) : null;
  if (t && Number.isFinite(t.x)) { _anchor.x = t.x; _anchor.z = t.z + 0.6; return _anchor; }
  const lead = g.members?.[0];
  if (lead && Number.isFinite(lead.x) && Number.isFinite(lead.z)) {
    _anchor.x = lead.x + 0.55; _anchor.z = lead.z + 0.35; return _anchor;
  }
  _anchor.x = num(plan?.entrance?.x, 1.2);
  _anchor.z = num(plan?.entrance?.z, 0);
  return _anchor;
}

/** 入口（暖簾の下）と歩道の基準點 */
function doorPoints(plan, depth) {
  _door.x = num(plan?.entrance?.x, 1.2);
  _door.insideZ = num(plan?.entrance?.z, depth / 2 - 0.1);
  _door.outsideZ = num(plan?.outside?.z, depth / 2 + 1.7);
  return _door;
}

/**
 * 柵の出入口（東側の隙間）の中の 1 點。z は隙間の幅に收める。
 * ペットはここを通って出入りするので、柵を突き抜けない。
 */
function gapPoint(area, z) {
  const z0 = area.cz - area.d / 2;
  _gap.x = area.cx + area.w / 2;
  _gap.z = clamp(num(z, area.cz), z0 + 0.2, z0 + PET_GAP_E - 0.2);
  return _gap;
}

/** その點の近くにいるか（柵の出入口をくぐる判定に使う） */
function atPoint(g, x, z, r) {
  return Math.abs(g.petX - x) <= r && Math.abs(g.petZ - z) <= r;
}

/** 目標へ向かって歩く。著いたら true（sim/game.js の moveToward と同じ規則） */
function stepPet(g, tx, tz, dtMin, speed) {
  const dx = tx - g.petX, dz = tz - g.petZ;
  const dist = Math.hypot(dx, dz);
  g.petDir = Math.atan2(dx, dz);
  if (dist < 0.06) return true;
  const step = Math.min(dist, speed * dtMin);
  g.petX += (dx / dist) * step;
  g.petZ += (dz / dist) * step;
  return false;
}

/** 席のマットへ戻す（狀態と座標をまとめて初期化） */
function toMat(state, g) {
  g.petState = 'mat';
  g.petX = null;
  g.petZ = null;
  g.petLeg = 0;
  g.petTimer = rndRange(state, 4, 10);
}

/** 柵の出入口へ向かう足（petLeg）を最初に戻す */
function startLeg(g, toPlay) {
  g.petState = toPlay ? 'toPlay' : 'back';
  g.petLeg = 0;
  g.petTimer = 0;
}

/* ------------------------------------------------------------ 毎 tick の更新 */

/**
 * ペットの行動を進める。
 *   mat（席のマット）→ toPlay（遊び場へ歩く）→ play（跳ね回る）→ back（席へ戻る）→ mat
 * 座っていない組のペットは必ず 'back' に切り替えて、外に置き去りにしない。
 * @param {object} state 遊戲狀態（state.groups を見る）
 * @param {number} dtMin 進めるゲーム分
 */
export function tickPets(state, dtMin = 1) {
  const groups = state?.groups;
  if (!Array.isArray(groups) || !groups.length) return;
  let dt = num(dtMin, 0);
  if (dt <= 0) return;
  if (dt > PET_MAX_DT) dt = PET_MAX_DT;

  const plan = state.plan || {};
  const depth = num(plan.depth, 9.6);
  const area = petAreaOf(state);
  const door = doorPoints(plan, depth);

  // 定員の判定：遊んでいる／今から向かうペットを數える
  let playing = 0, heading = 0;
  for (const g of groups) {
    if (!g?.pet) continue;
    if (g.petState === 'play') playing++;
    else if (g.petState === 'toPlay') heading++;
  }

  let budget = PET_TICK_BUDGET;
  for (const g of groups) {
    if (!g?.pet) continue;
    if (budget-- <= 0) break;                 // ペットが多い日はここで打ち切る
    if (g.state === 'gone') continue;

    // 延遲初始化（預設：桌邊的墊子上）
    if (typeof g.petState !== 'string') {
      g.petState = 'mat';
      g.petX = null;
      g.petZ = null;
      g.petDir = 0;
      g.petLeg = 0;
      g.petTimer = rndRange(state, 4, 10);    // 4〜10 分後に遊びに行く
      g.petAnimSeed = Math.floor(rndOf(state) * 9973);
      g.petHopT = 0;
    }
    if (typeof g.petAnimSeed !== 'number') g.petAnimSeed = Math.floor(rndOf(state) * 9973);
    if (typeof g.petTimer !== 'number') g.petTimer = rndRange(state, 4, 10);
    if (typeof g.petLeg !== 'number') g.petLeg = 0;

    const seated = SEATED.has(g.state);
    // 座っていない（帶位中・退店中…）なら、外にいるペットは必ず戻す
    if (!seated && (g.petState === 'toPlay' || g.petState === 'play')) {
      if (g.petState === 'play') playing--; else heading--;
      startLeg(g, false);
    }

    switch (g.petState) {
      case 'toPlay': {
        // 店の中 →（扉をくぐる）→ 歩道 →（柵の出入口）→ 遊び場の 1 點
        if (g.petZ <= depth / 2) {
          // まず入口の真ん前まで x を合わせる（壁を突き抜けないように）
          if (Math.abs(g.petX - door.x) > 0.35) stepPet(g, door.x, door.insideZ, dt, PET_WALK_SPEED);
          else stepPet(g, door.x, door.outsideZ, dt, PET_WALK_SPEED);
        } else {
          const gap = gapPoint(area, g.petSpotZ ?? area.cz);
          if (g.petLeg === 0) {
            // まず柵の出入口の前に立つ（ここを外すと柵を突き抜けてしまう）
            const gx = gap.x + 0.4;
            if (atPoint(g, gx, gap.z, 0.25)) g.petLeg = 1;
            else stepPet(g, gx, gap.z, dt, PET_WALK_SPEED);
          }
          if (g.petLeg === 1
            && stepPet(g, g.petSpotX ?? area.cx, g.petSpotZ ?? area.cz, dt, PET_WALK_SPEED)) {
            g.petState = 'play';
            g.petTimer = rndRange(state, 6, 14);   // 6〜14 分遊ぶ
            g.petHopT = 0;
            heading--; playing++;
            break;
          }
        }
        g.petTimer += dt;                          // 歩きっぱなしの保險
        if (g.petTimer > PET_WALK_TIMEOUT) { startLeg(g, false); heading--; }
        break;
      }

      case 'play': {
        g.petTimer -= dt;
        g.petHopT -= dt;
        if (g.petHopT <= 0) {
          // 約 1 分ごとに小さな目標を作り直す（その場で跳ね續けない）
          const spot = petSpotNear(area, g.petX, g.petZ, Math.min(0.9, area.w * 0.3),
            (g.petAnimSeed || 1) + Math.floor(state.minute || 0));
          g.petSpotX = spot.x;
          g.petSpotZ = spot.z;
          g.petHopT = 0.7 + rndOf(state) * 0.9;
        }
        stepPet(g, g.petSpotX ?? area.cx, g.petSpotZ ?? area.cz, dt, PET_PLAY_SPEED);
        if (g.petTimer <= 0) { startLeg(g, false); playing--; }
        break;
      }

      case 'back': {
        if (petAreaContains(area, g.petX, g.petZ)) {
          // 遊び場の中：柵の出入口（東側の隙間）の前まで寄ってから外へ出る
          const gap = gapPoint(area, g.petZ);
          if (g.petLeg === 0) {
            const gx = gap.x - 0.3;                // 柵のすぐ內側
            if (atPoint(g, gx, gap.z, 0.25)) g.petLeg = 1;
            else stepPet(g, gx, gap.z, dt, PET_WALK_SPEED);
          }
          if (g.petLeg === 1) stepPet(g, gap.x + 0.4, gap.z, dt, PET_WALK_SPEED);
        } else if (g.petZ > depth / 2) {
          // 歩道：入口の前に回り込んでから扉をくぐる
          if (Math.abs(g.petX - door.x) > 0.35) stepPet(g, door.x, door.outsideZ, dt, PET_WALK_SPEED);
          else stepPet(g, door.x, door.insideZ, dt, PET_WALK_SPEED);
        } else {
          const a = petAnchor(g, plan);
          if (stepPet(g, a.x, a.z, dt, PET_WALK_SPEED)) { toMat(state, g); break; }
        }
        g.petTimer += dt;
        if (g.petTimer > PET_WALK_TIMEOUT) toMat(state, g);   // 戻れないままにしない
        break;
      }

      default: {                                 // 'mat'：席のマットで待つ
        if (!seated) break;                      // 座っていない間は遊びに行かない
        g.petTimer -= dt;
        if (g.petTimer > 0) break;
        if (playing + heading >= PET_CAPACITY) {  // 満員：少し待ってまた試す
          g.petTimer = 1;
          break;
        }
        // 出発：遊び場の好きな場所を目標にして、今いる席から歩き出す
        const spot = petSpotIn(area, (g.petAnimSeed || 1) + Math.floor(state.minute || 0));
        g.petSpotX = spot.x;
        g.petSpotZ = spot.z;
        const a = petAnchor(g, plan);
        g.petX = a.x;
        g.petZ = a.z;
        g.petDir = Math.PI;
        g.petHopT = 0;
        startLeg(g, true);
        heading++;
        break;
      }
    }
  }
}

/* ------------------------------------------------------------ 摘要（HUD／測試） */

/** ペットスペースの要約：遊んでいる／歩いている／マットの數、定員と矩形 */
export function petSummary(state) {
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  let pets = 0, playing = 0, walking = 0, mat = 0;
  for (const g of groups) {
    if (!g?.pet) continue;
    pets++;
    const s = typeof g.petState === 'string' ? g.petState : 'mat';
    if (s === 'play') playing++;
    else if (s === 'toPlay' || s === 'back') walking++;
    else mat++;
  }
  return { pets, playing, walking, mat, capacity: PET_CAPACITY, area: petAreaOf(state) };
}

export default {
  petAreaOf, tickPets, petSummary, petAreaContains, petSpotIn, petSpotNear, petIsAway, PET_CAPACITY
};
