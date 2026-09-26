// ============================================================================
// audio.js — WebAudio 程序化音效與 BGM（不載入任何外部檔案）
// ============================================================================

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let enabled = true;
let currentStyle = 'off';

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.22;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.5;
    sfxGain.connect(master);
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setEnabled(v) {
  enabled = !!v;
  if (master) master.gain.value = enabled ? 0.5 : 0;
}

export function isEnabled() { return enabled; }

function tone({ freq = 440, dur = 0.12, type = 'square', gain = 0.3, when = 0, slideTo = null, dest = null }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(dest || sfxGain || master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.15, gain = 0.2, when = 0, hp = 800 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter); filter.connect(g); g.connect(sfxGain || master);
  src.start(t0);
}

const SFX = {
  click: () => tone({ freq: 880, dur: 0.04, type: 'square', gain: 0.14 }),
  open: () => { tone({ freq: 620, dur: 0.07, type: 'square', gain: 0.16 }); tone({ freq: 930, dur: 0.07, type: 'square', gain: 0.12, when: 0.06 }); },
  close: () => { tone({ freq: 520, dur: 0.06, type: 'square', gain: 0.14 }); tone({ freq: 320, dur: 0.08, type: 'square', gain: 0.12, when: 0.05 }); },
  bell: () => { tone({ freq: 1320, dur: 0.5, type: 'triangle', gain: 0.24 }); tone({ freq: 1980, dur: 0.4, type: 'sine', gain: 0.12, when: 0.02 }); },
  cash: () => { noise({ dur: 0.12, gain: 0.16, hp: 2200 }); tone({ freq: 1568, dur: 0.1, type: 'triangle', gain: 0.2 }); tone({ freq: 2093, dur: 0.18, type: 'triangle', gain: 0.16, when: 0.07 }); },
  error: () => { tone({ freq: 220, dur: 0.18, type: 'sawtooth', gain: 0.2, slideTo: 120 }); },
  pour: () => noise({ dur: 0.22, gain: 0.12, hp: 1200 }),
  star: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.28, type: 'square', gain: 0.2, when: i * 0.12 }));
    tone({ freq: 1568, dur: 0.5, type: 'triangle', gain: 0.16, when: 0.5 });
  },
  settle: () => { tone({ freq: 784, dur: 0.16, type: 'square', gain: 0.2 }); tone({ freq: 1047, dur: 0.3, type: 'square', gain: 0.18, when: 0.14 }); },
  alarm: () => { for (let i = 0; i < 3; i++) tone({ freq: 740, dur: 0.12, type: 'square', gain: 0.2, when: i * 0.2 }); },
  door: () => { noise({ dur: 0.08, gain: 0.1, hp: 1500 }); tone({ freq: 1200, dur: 0.3, type: 'sine', gain: 0.14 }); },
  coin: () => { tone({ freq: 1760, dur: 0.06, type: 'square', gain: 0.16 }); tone({ freq: 2349, dur: 0.1, type: 'square', gain: 0.12, when: 0.05 }); }
};

export function sfx(name) {
  if (!enabled) return;
  initAudio();
  if (!ctx) return;
  const fn = SFX[name] || SFX.click;
  try { fn(); } catch { /* 忽略音效失敗 */ }
}

/* ------------------------------------------------------- 日語語音（TTS） */

const VOICE = {
  welcome: 'いらっしゃいませ',
  order: 'かしこまりました',
  cash: 'ありがとうございます',
  thanks: 'ごちそうさまでした'
};

/** 瀏覽器沒有日語語音（或不支援 speechSynthesis）時退回的程序化音效 */
const VOICE_FALLBACK = { welcome: 'bell', order: 'open', cash: 'cash', thanks: 'close' };

/** 同一種語音的最小間隔（毫秒）：客人多時才不會連珠炮 */
const VOICE_GAP = { welcome: 1800, order: 1500, cash: 1200, thanks: 1800 };

let voiceEnabled = true;
let jaVoice = null;
let voicesListened = false;
let speaking = 0;
const lastSaid = Object.create(null);

function synth() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  return window.speechSynthesis;
}

function pickJaVoice() {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices() || [];
  if (!voices.length) return null;
  return voices.find((v) => /^ja[-_]JP/i.test(v.lang))
    || voices.find((v) => /^ja/i.test(v.lang))
    || null;
}

/** 使用者首次互動時呼叫：語音清單一開始是空的，先載入並等 voiceschanged */
export function primeVoices() {
  const s = synth();
  if (!s) return;
  jaVoice = pickJaVoice();
  if (voicesListened) return;
  voicesListened = true;
  try {
    s.addEventListener('voiceschanged', () => { jaVoice = pickJaVoice(); });
  } catch { /* 舊瀏覽器無 addEventListener */ }
}

export function setVoiceEnabled(v) {
  voiceEnabled = !!v;
  if (!voiceEnabled) {
    speaking = 0;
    try { synth()?.cancel(); } catch { /* ignore */ }
  }
}

export function isVoiceEnabled() { return voiceEnabled; }

/** 播一句日語；沒有日語語音／不支援 TTS 時退回對應的程序化音效 */
export function speakVoice(event) {
  if (!enabled || !voiceEnabled) return;
  const text = VOICE[event];
  if (!text) return;
  const now = Date.now();
  const last = lastSaid[event] || 0;
  if (now - last < (VOICE_GAP[event] || 1600)) return;
  lastSaid[event] = now;
  const s = synth();
  if (!jaVoice) jaVoice = pickJaVoice();
  if (!s || !jaVoice) {
    // 沒有日語語音：退回程序化音效（一樣吃上面的節流，避免連珠炮）
    sfx(VOICE_FALLBACK[event] || 'click');
    return;
  }
  if (speaking >= 2) return;
  speaking += 1;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = jaVoice;
    u.lang = jaVoice.lang || 'ja-JP';
    u.rate = 1.05;
    const done = () => { speaking = Math.max(0, speaking - 1); };
    u.onend = done;
    u.onerror = done;
    s.speak(u);
  } catch {
    speaking = Math.max(0, speaking - 1);
    sfx(VOICE_FALLBACK[event] || 'click');
  }
}

/* ------------------------------------------------------------------- BGM */

const SCALES = {
  lazy: { tempo: 104, notes: [0, 3, 5, 7, 10, 12, 10, 7, 5, 3], base: 262, wave: 'triangle', bass: [0, -5, -7, -5] },
  tropical: { tempo: 120, notes: [0, 4, 7, 12, 7, 4, 2, 7], base: 294, wave: 'square', bass: [0, 5, 7, 5] },
  classic1: { tempo: 88, notes: [0, 2, 4, 7, 9, 7, 4, 2], base: 233, wave: 'sine', bass: [0, -3, -5, -7] },
  classic2: { tempo: 76, notes: [0, 4, 7, 11, 12, 11, 7, 4], base: 196, wave: 'sine', bass: [0, -4, -7, -5] },
  pop: { tempo: 132, notes: [0, 4, 7, 9, 12, 9, 7, 4], base: 330, wave: 'square', bass: [0, 5, 9, 7] },
  off: null
};

let musicTimer = null;
let step = 0;

function semitone(base, semi) {
  return base * Math.pow(2, semi / 12);
}

function musicTick() {
  if (!ctx || !enabled || !SCALES[currentStyle]) return;
  const conf = SCALES[currentStyle];
  const beat = 60 / conf.tempo / 2;
  const note = conf.notes[step % conf.notes.length];
  const bassNote = conf.bass[Math.floor(step / 4) % conf.bass.length];
  tone({ freq: semitone(conf.base, note), dur: beat * 0.85, type: conf.wave, gain: 0.12, dest: musicGain });
  if (step % 4 === 0) {
    tone({ freq: semitone(conf.base / 2, bassNote), dur: beat * 3, type: 'triangle', gain: 0.14, dest: musicGain });
  }
  if (step % 8 === 4) noise({ dur: 0.05, gain: 0.04, hp: 4000 });
  step += 1;
}

export function setMusic(style) {
  currentStyle = SCALES[style] ? style : 'off';
  initAudio();
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  // 瀏覽器自動播放政策：AudioContext 還沒被使用者手勢喚醒前先不要排音符，
  // 否則恢復播放時會一次爆出所有積欠的音。
  if (!ctx || currentStyle === 'off' || ctx.state !== 'running') return;
  const conf = SCALES[currentStyle];
  const interval = (60 / conf.tempo / 2) * 1000;
  step = 0;
  musicTimer = setInterval(musicTick, interval);
}

/** 使用者第一次互動後呼叫，補啟動 BGM */
export function resumeMusic() {
  if (currentStyle === 'off') return;
  if (musicTimer) return;
  setMusic(currentStyle);
}

export function getMusic() { return currentStyle; }

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  currentStyle = 'off';
}

export const audio = {
  initAudio, sfx, setMusic, resumeMusic, stopMusic, setEnabled, isEnabled, getMusic,
  speakVoice, setVoiceEnabled, isVoiceEnabled, primeVoices
};
export default audio;
