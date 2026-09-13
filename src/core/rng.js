// 決定性亂數（mulberry32）。狀態可序列化，讓存檔與模擬完全可重現。
// 契約見 docs/ARCHITECTURE.md

/**
 * @param {number} seed
 * @returns {{
 *   next(): number, int(a:number,b:number): number, pick<T>(a:T[]):T,
 *   chance(p:number): boolean, shuffle<T>(a:T[]):T[], weighted<T>(a:{v:T,w:number}[]):T,
 *   range(a:number,b:number): number, getState(): number, setState(s:number): void,
 *   fork(): any, seed: number
 * }}
 */
export function makeRng(seed) {
  let s = (Math.floor(seed) >>> 0) || 1;

  const rng = {
    seed: s,
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** 含頭含尾的整數 */
    int(a, b) {
      if (b === undefined) { b = a; a = 0; }
      if (b < a) { const t = a; a = b; b = t; }
      return a + Math.floor(rng.next() * (b - a + 1));
    },
    /** 浮點區間 */
    range(a, b) {
      return a + rng.next() * (b - a);
    },
    pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(rng.next() * arr.length)];
    },
    chance(p) {
      return rng.next() < p;
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    },
    /** weighted([{v:'a',w:2},{v:'b',w:1}]) */
    weighted(list) {
      let total = 0;
      for (const it of list) total += Math.max(0, it.w || 0);
      if (total <= 0) return list.length ? list[0].v : undefined;
      let roll = rng.next() * total;
      for (const it of list) {
        roll -= Math.max(0, it.w || 0);
        if (roll <= 0) return it.v;
      }
      return list[list.length - 1].v;
    },
    getState() { return s >>> 0; },
    setState(v) { s = (Math.floor(v) >>> 0) || 1; },
    fork() { return makeRng(rng.getState()); }
  };

  return rng;
}

/**
 * 以 state.rng 執行 fn(rng)，結束後把新狀態寫回 state.rng。
 * 模擬層一律用這個函式取亂數，確保「同 seed 同結果」。
 */
export function withRng(state, fn) {
  const rng = makeRng(state.seed || 1);
  rng.setState(state.rng || 1);
  try {
    return fn(rng);
  } finally {
    state.rng = rng.getState();
  }
}

/** 產生新的 seed */
export function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}
