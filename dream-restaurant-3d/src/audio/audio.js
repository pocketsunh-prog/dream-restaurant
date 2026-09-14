// ============================================================================
// audio.js — 程序化音訊引擎（無任何外部音檔）
//   BGM：日本音階（陽音階／陰音階／都節）＋ 箏（koto）撥弦 ＋ 尺八氣息襯底 ＋ 太鼓脈動
//   SFX：開門鈴、點餐、上菜、用餐、結帳、生氣、結算、按鈕…全部即時合成
//   環境音：店內人聲、廚房爐火、雨聲（依遊戲狀態即時調整）
//
//   設計成可離線渲染（OfflineAudioContext），因此合成邏輯可以被自動測試驗證。
// ============================================================================

/* ---------------------------------------------------------------- 音階 */

/** 日本音階（半音間隔，根音為 0） */
export const SCALES = {
  yo:    [0, 2, 4, 7, 9],      // 陽音階：明るい
  in:    [0, 1, 5, 7, 8],      // 陰音階：物悲しい
  miyako:[0, 1, 5, 7, 8],      // 都節（同陰音階的另一種稱呼）
  minyo: [0, 2, 5, 7, 9],      // 民謡音階
  ryo:   [0, 2, 4, 7, 9]       // 呂音階
};

/** 各地點／時段選用的音階（讓不同立地有不同的情緒） */
export const LOCALE_SCALE = {
  traditional: 'miyako', luxury: 'in', onsen: 'miyako', market: 'minyo',
  downtown: 'yo', shopping: 'yo', entertainment: 'minyo', student: 'yo',
  tourist: 'yo', business: 'in', suburban: 'minyo', port: 'minyo'
};

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------ SFX 清單 */

export const SFX_NAMES = [
  'click', 'door', 'seat', 'order', 'serve', 'eat', 'pay', 'angry',
  'happy', 'settle', 'starup', 'error', 'clink', 'whoosh'
];

/* ------------------------------------------------------------ 工具 */

const NOISE_CACHE = new WeakMap();   // ctx → { [seconds]: AudioBuffer }

function noiseBuffer(ctx, seconds = 2) {
  let per = NOISE_CACHE.get(ctx);
  if (!per) { per = {}; NOISE_CACHE.set(ctx, per); }
  const key = String(seconds);
  if (per[key]) return per[key];
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;   // 略帶棕色噪音，較不刺耳
    d[i] = w * 0.7 + last * 3.2;
  }
  per[key] = buf;
  return buf;
}

function env(ctx, node, t, { a = 0.005, d = 0.12, s = 0.0, r = 0.12, peak = 1, sustain = 0 }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  if (sustain > 0) {
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * s), t + a + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + sustain);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  node.connect(g);
  void r;
  return g;
}

/* ------------------------------------------------------ 單一音效合成 */

/**
 * 把某個音效排進 ctx 的 dest（可用於 AudioContext 或 OfflineAudioContext）。
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {string} name
 * @param {number} t 起始時間（ctx 時間軸）
 * @param {object} [opts]
 */
export function synthSfx(ctx, dest, name, t = 0, opts = {}) {
  const rnd = opts.random || Math.random;
  const out = ctx.createGain();
  out.gain.value = opts.gain ?? 0.9;
  out.connect(dest);

  const noise = () => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 1.2);
    src.loop = true;
    return src;
  };

  switch (name) {
    case 'click': {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1180, t);
      o.frequency.exponentialRampToValueAtTime(620, t + 0.05);
      env(ctx, o, t, { a: 0.002, d: 0.05, peak: 0.18 }).connect(out);
      o.start(t); o.stop(t + 0.09);
      break;
    }
    case 'door': {   // 引き戸 + 門口鈴
      const s = noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.1;
      s.connect(bp);
      env(ctx, bp, t, { a: 0.004, d: 0.16, peak: 0.22 }).connect(out);
      s.start(t); s.stop(t + 0.28);
      for (const [f, dt] of [[1568, 0.02], [2093, 0.13]]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        env(ctx, o, t + dt, { a: 0.003, d: 0.5, peak: 0.14 }).connect(out);
        o.start(t + dt); o.stop(t + dt + 0.6);
      }
      break;
    }
    case 'seat': {
      const s = noise();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 800;
      s.connect(lp);
      env(ctx, lp, t, { a: 0.01, d: 0.22, peak: 0.12 }).connect(out);
      s.start(t); s.stop(t + 0.34);
      break;
    }
    case 'order': {   // メモを取る＋「はい」
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 740;
      env(ctx, o, t, { a: 0.004, d: 0.08, peak: 0.13 }).connect(out);
      o.start(t); o.stop(t + 0.12);
      const s = noise();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2600;
      s.connect(hp);
      env(ctx, hp, t + 0.06, { a: 0.004, d: 0.1, peak: 0.08 }).connect(out);
      s.start(t + 0.06); s.stop(t + 0.3);
      break;
    }
    case 'serve': {   // 丼を置く「コトッ」
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.09);
      env(ctx, o, t, { a: 0.002, d: 0.13, peak: 0.26 }).connect(out);
      o.start(t); o.stop(t + 0.2);
      const s = noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 2;
      s.connect(bp);
      env(ctx, bp, t, { a: 0.002, d: 0.05, peak: 0.09 }).connect(out);
      s.start(t); s.stop(t + 0.12);
      break;
    }
    case 'eat': {     // 食器が触れる軽い音
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f = 1200 + rnd() * 900;
        o.frequency.value = f;
        env(ctx, o, t + i * 0.09 + rnd() * 0.03, { a: 0.001, d: 0.06, peak: 0.05 }).connect(out);
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.1);
      }
      break;
    }
    case 'clink': {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 2400 + rnd() * 800;
      env(ctx, o, t, { a: 0.001, d: 0.18, peak: 0.1 }).connect(out);
      o.start(t); o.stop(t + 0.24);
      break;
    }
    case 'pay': {     // レジ＋小銭
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1320, t + 0.07);
      env(ctx, o, t, { a: 0.003, d: 0.17, peak: 0.12 }).connect(out);
      o.start(t); o.stop(t + 0.26);
      for (let i = 0; i < 5; i++) {
        const c = ctx.createOscillator();
        c.type = 'triangle';
        c.frequency.value = 3000 + rnd() * 2200;
        env(ctx, c, t + 0.1 + i * 0.045, { a: 0.001, d: 0.07, peak: 0.05 }).connect(out);
        c.start(t + 0.1 + i * 0.045); c.stop(t + 0.2 + i * 0.045);
      }
      break;
    }
    case 'angry': {   // 低い不満の唸り
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(96, t + 0.34);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 700;
      o.connect(lp);
      env(ctx, lp, t, { a: 0.02, d: 0.36, peak: 0.16 }).connect(out);
      o.start(t); o.stop(t + 0.46);
      break;
    }
    case 'happy': {   // 明るい三音
      [880, 1108, 1318].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        env(ctx, o, t + i * 0.07, { a: 0.004, d: 0.22, peak: 0.11 }).connect(out);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
      });
      break;
    }
    case 'settle': {  // 打烊の鈴（りん）
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        env(ctx, o, t + i * 0.16, { a: 0.005, d: 1.5, peak: 0.12 }).connect(out);
        o.start(t + i * 0.16); o.stop(t + i * 0.16 + 1.7);
      });
      break;
    }
    case 'starup': {
      [523.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'triangle'; o.frequency.value = f;
        env(ctx, o, t + i * 0.11, { a: 0.004, d: 0.7, peak: 0.13 }).connect(out);
        o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.85);
      });
      break;
    }
    case 'error': {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(320, t);
      o.frequency.setValueAtTime(210, t + 0.11);
      env(ctx, o, t, { a: 0.003, d: 0.22, peak: 0.13 }).connect(out);
      o.start(t); o.stop(t + 0.3);
      break;
    }
    case 'whoosh': {
      const s = noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
      s.connect(bp);
      env(ctx, bp, t, { a: 0.06, d: 0.34, peak: 0.1 }).connect(out);
      s.start(t); s.stop(t + 0.46);
      break;
    }
    default:
      return null;
  }
  return out;
}

/* ---------------------------------------------------------- 音樂合成 */

/** 箏（koto）撥弦：三角波＋泛音，快速衰減 */
function kotoNote(ctx, dest, freq, t, dur, gain = 0.16) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);

  for (const [mult, amp, type] of [[1, 1, 'triangle'], [2, 0.28, 'sine'], [3.01, 0.12, 'sine']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

/** 尺八風氣息長音（成本考量：不用 a-rate 顫音調變，改用兩個略微失諧的振盪器） */
function shakuhachi(ctx, dest, freq, t, dur, gain = 0.07) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1800;
  lp.connect(g); g.connect(dest);

  // 兩支略微失諧的正弦 → 自然的小幅度搖曳，且不需要 a-rate 調變
  for (const [mult, amp] of [[1, 1], [1.004, 0.5]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 息遣い（噪音）：共用快取的噪音緩衝
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, 1.5);
  s.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq * 2.2; bp.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(gain * 0.35, t + dur * 0.4);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bp); bp.connect(ng); ng.connect(dest);
  s.start(t); s.stop(t + dur + 0.02);
}

/** 太鼓（低頻有音高的鼓） */
function taiko(ctx, dest, t, gain = 0.22) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(52, t + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + 0.5);

  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(gain * 0.4, t + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  s.connect(lp); lp.connect(ng); ng.connect(dest);
  s.start(t); s.stop(t + 0.3);
}

/**
 * 產生一小段音樂（offline 或 online 皆可）。
 * 這是 BGM 的核心：以音階隨機漫步產生旋律，加上襯底與太鼓。
 * @returns {number} 下一個建議排程時間
 */
export function scheduleMusic(ctx, dest, startTime, seconds, opts = {}) {
  const scaleName = SCALES[opts.scale] ? opts.scale : 'yo';
  const scale = SCALES[scaleName];
  const root = opts.root ?? 57;                  // A3
  const bpm = opts.bpm ?? 72;
  const density = opts.density ?? 0.55;          // 0..1 越高音越密
  const night = !!opts.night;
  const rnd = opts.random || Math.random;

  const beat = 60 / bpm;
  let t = startTime;
  let deg = 0;
  const end = startTime + seconds;

  // 太鼓：每小節第 1 拍
  for (let b = 0; t + b * beat * 4 < end; b++) {
    const tt = startTime + b * beat * 4;
    if (tt >= end) break;
    taiko(ctx, dest, tt, night ? 0.12 : 0.18);
    if (night && rnd() < 0.4) taiko(ctx, dest, tt + beat * 2.5, 0.08);
  }

  // 旋律：箏
  while (t < end) {
    const step = beat * (rnd() < 0.45 ? 0.5 : 1) * (1 + (1 - density));
    deg += Math.floor(rnd() * 5) - 2;
    deg = Math.max(-4, Math.min(9, deg));
    const octave = Math.floor(deg / scale.length);
    const idx = ((deg % scale.length) + scale.length) % scale.length;
    const midi = root + scale[idx] + octave * 12;
    const dur = step * (1.4 + rnd() * 1.6);
    kotoNote(ctx, dest, midiToFreq(midi), t, dur, 0.13 + rnd() * 0.05);
    // 偶爾加一個五度或八度裝飾
    if (rnd() < 0.22) {
      kotoNote(ctx, dest, midiToFreq(midi + 7), t + step * 0.5, dur * 0.6, 0.07);
    }
    t += step;
  }

  // 襯底：尺八長音（每 4 小節換一次）
  for (let i = 0; t0(i) < end; i++) {
    const tt = t0(i);
    if (tt >= end) break;
    const deg2 = [0, 2, 4, 1, 3][i % 5];
    const midi = root - 12 + scale[deg2 % scale.length];
    shakuhachi(ctx, dest, midiToFreq(midi), tt, beat * 4 * 1.1, 0.05);
  }
  function t0(i) { return startTime + i * beat * 4; }

  return t;
}

/* ---------------------------------------------------------- 環境音 */

export function makeAmbience(ctx, dest) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 4);
  noise.loop = true;

  // 人聲（低頻帶噪音）
  const crowdBp = ctx.createBiquadFilter();
  crowdBp.type = 'bandpass'; crowdBp.frequency.value = 520; crowdBp.Q.value = 0.6;
  const crowdGain = ctx.createGain(); crowdGain.gain.value = 0.0;
  noise.connect(crowdBp); crowdBp.connect(crowdGain); crowdGain.connect(dest);

  // 廚房（中高頻噪音）
  const kitHp = ctx.createBiquadFilter();
  kitHp.type = 'highpass'; kitHp.frequency.value = 1800;
  const kitGain = ctx.createGain(); kitGain.gain.value = 0.0;
  noise.connect(kitHp); kitHp.connect(kitGain); kitGain.connect(dest);

  // 雨（寬頻噪音，高通）
  const rainHp = ctx.createBiquadFilter();
  rainHp.type = 'highpass'; rainHp.frequency.value = 900;
  const rainGain = ctx.createGain(); rainGain.gain.value = 0.0;
  noise.connect(rainHp); rainHp.connect(rainGain); rainGain.connect(dest);

  // 緩慢起伏的人聲 LFO
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.006;
  lfo.connect(lfoGain); lfoGain.connect(crowdGain.gain);
  lfo.start();

  noise.start();

  return { noise, crowdGain, kitGain, rainGain };
}

/* ---------------------------------------------------------- 引擎 */

export class AudioEngine {
  constructor(opts = {}) {
    this.ctx = null;
    this.enabled = false;
    this.buses = {};
    this.volumes = { master: 0.75, music: 0.55, sfx: 0.8, ambience: 0.5 };
    this.music = null;
    this.ambience = null;
    this._musicTimer = null;
    this._nextMusicTime = 0;
    this._musicOpts = { scale: 'yo', root: 57, bpm: 72, density: 0.55, night: false };
    this._sfxLast = new Map();
    this._voices = 0;
    this.onstate = opts.onstate || null;
    Object.assign(this.volumes, opts.volumes || {});
  }

  get ready() { return !!(this.ctx && this.ctx.state === 'running'); }

  /** 必須在使用者手勢中呼叫（瀏覽器自動播放政策） */
  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      const master = ctx.createGain(); master.gain.value = this.volumes.master;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 3.2;
      comp.attack.value = 0.004; comp.release.value = 0.22;
      master.connect(comp); comp.connect(ctx.destination);
      this.buses = {
        master, comp,
        music: ctx.createGain(),
        sfx: ctx.createGain(),
        ambience: ctx.createGain()
      };
      this.buses.music.gain.value = this.volumes.music;
      this.buses.sfx.gain.value = this.volumes.sfx;
      this.buses.ambience.gain.value = this.volumes.ambience;
      this.buses.music.connect(master);
      this.buses.sfx.connect(master);
      this.buses.ambience.connect(master);
      this.ambience = makeAmbience(ctx, this.buses.ambience);
      this.buses.ambience.gain.value = this.volumes.ambience;
    }
    try { await this.ctx.resume(); } catch { /* 忽略 */ }
    this.enabled = this.ctx.state === 'running';
    if (this.enabled) this.startMusic();
    this.onstate?.(this.state());
    return this.enabled;
  }

  disable() {
    this.stopMusic();
    const ctx = this.ctx;
    if (ctx) { try { ctx.suspend(); } catch { /* ignore */ } }
    this.enabled = false;
    this.onstate?.(this.state());
  }

  toggle() { return this.enabled ? (this.disable(), false) : (this.enable(), true); }

  setVolume(bus, v) {
    const val = Math.max(0, Math.min(1, Number(v) || 0));
    this.volumes[bus] = val;
    if (this.buses[bus]) this.buses[bus].gain.value = val;
    else if (bus === 'master' && this.buses.master) this.buses.master.gain.value = val;
    this.onstate?.(this.state());
    return val;
  }

  playSfx(name, opts = {}) {
    if (!this.enabled || !this.ctx) return null;
    // 同一個音效 40ms 內不重複，避免大量顧客同時觸發造成破音
    const now = this.ctx.currentTime;
    const last = this._sfxLast.get(name) || -1;
    if (now - last < 0.04) return null;
    this._sfxLast.set(name, now);
    this._voices++;
    setTimeout(() => { this._voices = Math.max(0, this._voices - 1); }, 1500);
    return synthSfx(this.ctx, this.buses.sfx, name, now + 0.001, opts);
  }

  /** 依遊戲狀態調整環境音 */
  setAmbience({ crowd = 0, kitchen = 0, rain = 0, night = false } = {}) {
    if (!this.ambience || !this.ctx) return;
    const t = this.ctx.currentTime;
    const ramp = (param, v) => {
      try { param.setTargetAtTime(v, t, 0.8); } catch { param.value = v; }
    };
    ramp(this.ambience.crowdGain.gain, Math.min(0.09, crowd * 0.012));
    ramp(this.ambience.kitGain.gain, Math.min(0.05, kitchen * 0.014));
    ramp(this.ambience.rainGain.gain, Math.min(0.07, rain * 0.07));
    this._musicOpts.night = night;
  }

  /** 設定音樂性格（隨地點／時段改變） */
  setMusicMood({ scale, bpm, density, root } = {}) {
    if (scale && SCALES[scale]) this._musicOpts.scale = scale;
    if (bpm) this._musicOpts.bpm = Math.max(46, Math.min(120, bpm));
    if (density !== undefined) this._musicOpts.density = Math.max(0.15, Math.min(1, density));
    if (root) this._musicOpts.root = root;
  }

  startMusic() {
    if (!this.enabled || this._musicTimer) return;
    const ctx = this.ctx;
    this._nextMusicTime = ctx.currentTime + 0.12;
    const pump = () => {
      if (!this.enabled) return;
      const ahead = 1.6;
      while (this._nextMusicTime < ctx.currentTime + ahead) {
        this._nextMusicTime = scheduleMusic(ctx, this.buses.music, this._nextMusicTime, 4.2, {
          ...this._musicOpts, random: Math.random
        });
      }
    };
    pump();
    this._musicTimer = setInterval(pump, 900);
    this.onstate?.(this.state());
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    this.onstate?.(this.state());
  }

  state() {
    return {
      available: typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext),
      enabled: this.enabled,
      contextState: this.ctx ? this.ctx.state : 'none',
      musicPlaying: !!this._musicTimer,
      voices: this._voices,
      volumes: { ...this.volumes }
    };
  }
}

/* ------------------------------------------------- 離線渲染（測試用） */

/**
 * 通用離線渲染：把 setup(ctx, dest) 排好的東西渲染成一個 Float32Array。
 * 一次渲染可以排很多東西（例如把 14 個音效排在不同時間點），
 * 這樣就不會一直建立 OfflineAudioContext（瀏覽器對 context 數量有上限）。
 */
export async function renderRaw(seconds, setup, sampleRate = 44100) {
  const OAC = (typeof window !== 'undefined') && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return null;
  const ctx = new OAC(1, Math.ceil(sampleRate * seconds), sampleRate);
  const dest = ctx.createGain();
  dest.gain.value = 1;
  dest.connect(ctx.destination);
  setup(ctx, dest);
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  try { await ctx.close(); } catch { /* ignore */ }
  return { data, sampleRate };
}

/** 取出某段時間窗的統計值（給測試用） */
export function windowStats(data, sampleRate, from, to) {
  const a = Math.max(0, Math.floor(from * sampleRate));
  const b = Math.min(data.length, Math.ceil(to * sampleRate));
  let peak = 0, sum = 0, nonZero = 0, clipped = 0;
  for (let i = a; i < b; i++) {
    const v = data[i];
    const av = Math.abs(v);
    if (av > peak) peak = av;
    sum += v * v;
    if (av > 0.0005) nonZero++;
    if (av > 0.999) clipped++;
  }
  const n = Math.max(1, b - a);
  return {
    peak: +peak.toFixed(4),
    rms: +Math.sqrt(sum / n).toFixed(4),
    nonZeroRatio: +(nonZero / n).toFixed(4),
    clipped,
    silent: peak < 0.005
  };
}

/**
 * 用 OfflineAudioContext 渲染一段聲音，回傳統計值。
 * 這是「音訊真的會發出聲音」的可驗證證據（不需要使用者手勢）。
 * @param {'music'|string} kind 'music' 或 SFX 名稱
 * @param {number} seconds
 */
export async function renderOffline(kind, seconds = 1.2, opts = {}) {
  const raw = await renderRaw(seconds, (ctx, dest) => {
    if (kind === 'music') scheduleMusic(ctx, dest, 0, seconds, opts);
    else synthSfx(ctx, dest, kind, 0.01, opts);
  });
  if (!raw) return { ok: false, error: 'no OfflineAudioContext' };
  return { ok: true, kind, seconds, ...windowStats(raw.data, raw.sampleRate, 0, seconds) };
}

export default AudioEngine;
