// ============================================================================
// attract.js — 店門口路人與拉客
// 考據：原作可以點擊門邊的路人，會增加進店的客人數。
// ============================================================================
import { LURE_PER_CLICK, LURE_MAX, LURE_HALF_LIFE_MIN, GRID_H } from '../core/balance.js';
import { clamp } from './economy.js';

const WALKER_TYPES = ['student', 'office', 'family', 'tourist'];

export function spawnWalkers(state, rng, count = 6) {
  const lane = state.layout.sidewalk || { y: GRID_H - 0.5, x0: 0, x1: state.layout.gridW - 1 };
  while (state.sim.walkers.length < count) {
    const dir = rng.chance(0.5) ? 1 : -1;
    state.sim.walkers.push({
      uid: `w${state.day}_${state.sim.walkers.length}_${Math.floor(rng.next() * 9999)}`,
      x: dir > 0 ? lane.x0 : lane.x1,
      y: lane.y,
      dir: dir > 0 ? 'E' : 'W',
      dx: dir,
      speed: rng.range(0.35, 0.9),
      frame: 0,
      type: rng.pick(WALKER_TYPES),
      appearance: randomAppearance(rng),
      life: rng.range(60, 240)
    });
  }
}

export function updateWalkers(state, dtMin, rng) {
  const lane = state.layout.sidewalk || { y: GRID_H - 0.5, x0: 0, x1: state.layout.gridW - 1 };
  const remaining = [];
  for (const w of state.sim.walkers) {
    w.x += w.dx * w.speed * dtMin;
    w.life -= dtMin;
    w.frame = (w.frame + dtMin * 0.6) % 2;
    if (w.x < lane.x0 || w.x > lane.x1 || w.life <= 0) {
      // 出場後重新從另一端進場
      if (state.sim.walkers.length <= 2) {
        w.dx *= -1;
        w.dir = w.dx > 0 ? 'E' : 'W';
        w.x = w.dx > 0 ? lane.x0 : lane.x1;
        w.life = rng.range(60, 240);
        remaining.push(w);
      }
      continue;
    }
    remaining.push(w);
  }
  state.sim.walkers = remaining;
  if (state.sim.walkers.length < 4) spawnWalkers(state, rng, 6);
}

/** 拉客加成：每次點擊 +0.5%，上限 +30%，半衰期 20 分鐘 */
export function lureMultiplier(state) {
  return 1 + clamp(state.sim.lureBoost || 0, 0, LURE_MAX);
}

export function decayLure(state, dtMin) {
  if (!state.sim.lureBoost) return;
  const k = Math.pow(0.5, dtMin / LURE_HALF_LIFE_MIN);
  state.sim.lureBoost *= k;
  if (state.sim.lureBoost < 0.0005) state.sim.lureBoost = 0;
}

export function clickLure(state, rng, walkerUid = null) {
  state.sim.lureBoost = clamp((state.sim.lureBoost || 0) + LURE_PER_CLICK, 0, LURE_MAX);
  state.sim.lureClicks = (state.sim.lureClicks || 0) + 1;
  let converted = false;
  if (walkerUid) {
    const idx = state.sim.walkers.findIndex((w) => w.uid === walkerUid);
    if (idx >= 0) {
      state.sim.walkers.splice(idx, 1);
      converted = true;
    }
  }
  return { converted, boost: state.sim.lureBoost };
}

export function randomAppearance(rng) {
  const hairs = ['#2b1b12', '#4a2c14', '#7a4a1e', '#111111', '#5a5a5a', '#3a2418', '#8a5a2a'];
  const skins = ['#f0c9a0', '#e8b98a', '#d9a878', '#c08a5a', '#f6d7b4'];
  const shirts = ['#3a6ea5', '#b03030', '#2f7d4f', '#d9a520', '#7a4a8a', '#3f3f3f', '#d97a3a', '#4aa5a5', '#e8e0d0'];
  return {
    hair: rng.pick(hairs),
    skin: rng.pick(skins),
    shirt: rng.pick(shirts),
    hat: rng.chance(0.12) ? rng.int(1, 3) : 0
  };
}
