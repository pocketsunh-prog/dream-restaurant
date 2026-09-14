// ============================================================================
// main.js — 啟動、主迴圈、輸入、日夜循環
// ============================================================================
import * as THREE from 'three';
import { createLighting } from './scene/lighting.js';
import { OrbitCam } from './scene/controls.js';
import { RestaurantView } from './scene/restaurant.js';
import {
  createGame, tick, settleDay, startNextDay, moveToLocation, setStars,
  clockText, money, OPEN_MINUTE, CLOSE_MINUTE, drainEvents, setBusinessHours, setSetting
} from './sim/game.js';
import { Hud, seatsOf } from './ui/hud.js';
import { locationById } from './data/locations.js';
import { AudioEngine, LOCALE_SCALE, SFX_NAMES } from './audio/audio.js';
import { saveToSlot, loadFromSlot, autoSave } from './sim/save.js';

const params = new URLSearchParams(location.search);
const step = (t) => { const el = document.getElementById('loading-step'); if (el) el.textContent = t; };
// 測試用：?static=N → 只渲染 N 幀就停止 rAF（無頭截圖用）。此時必須保留 drawingBuffer，
// 否則迴圈停止後緩衝區被清空，截圖會是一片黑。
const STATIC_FRAMES = Math.max(0, Number(params.get('static') || 0));
const NEED_PRESERVE = STATIC_FRAMES > 0 || params.has('ss');
let audioTimer = 0;

/* ------------------------------------------------------------ 渲染器 */

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: NEED_PRESERVE
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ------------------------------------------------------------ 場景 */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 400);

step('光源と環境を準備中');
const lighting = createLighting(scene, renderer);

step('ゲーム状態を初期化中');
let game = createGame({
  locationId: params.get('loc') || 'tokyo_shibuya',
  seed: Number(params.get('seed') || 20240601)
});

step('店内を建築中');
const restaurant = new RestaurantView(scene, game.plan);

/* ------------------------------------------------------------ 攝影機 */

const cam = new OrbitCam(camera, canvas);
const CENTER = new THREE.Vector3(0, 1.0, 0);

const SHOTS = [
  { name: '全景',   az: 0.66, pol: 0.96, dist: 16.4, target: new THREE.Vector3(-0.1, 0.8, 0.0) },
  { name: '吧台',   az: -1.95, pol: 1.24, dist: 6.4, target: new THREE.Vector3(-5.2, 1.0, -0.3) },
  { name: '客席',   az: 0.18, pol: 1.02, dist: 8.4, target: new THREE.Vector3(-1.6, 0.8, 0.2) },
  { name: '厨房',   az: 2.55, pol: 1.06, dist: 7.0, target: new THREE.Vector3(3.6, 1.0, -3.2) },
  { name: '座敷',   az: -0.55, pol: 0.98, dist: 7.6, target: new THREE.Vector3(4.4, 0.7, 2.4) }
];
let shotIdx = 0;
cam.jumpTo(SHOTS[0]);

function gotoShot(i) {
  shotIdx = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length;
  const s = SHOTS[shotIdx];
  cam.flyTo(s);
  hud?.toast(`カメラ：${s.name}`);
}

/* ------------------------------------------------------------ HUD */

const hud = new Hud(game, {
  onSpeed: (v) => { game.speed = v; game.paused = v === 0; game.settings.speed = v; },
  onHours: (open, close) => {
    const r = setBusinessHours(game, open, close);
    if (!r.ok) hud.toast(r.error, 'bad');
  },
  onVolume: (bus, v) => {
    audio.setVolume(bus, v);
    prefs[bus] = v;
    game.settings.audio[bus] = v;
    saveAudioPrefs(prefs);
  },
  onGraphics: (patch) => {
    Object.assign(game.settings.graphics, patch);
    applyGraphics();
  },
  onCamera: (patch) => {
    if (patch.fov) { camera.fov = patch.fov; camera.updateProjectionMatrix(); game.settings.fov = patch.fov; }
    if (patch.autoRotate !== undefined) game.settings.autoRotate = patch.autoRotate;
  },
  onSave: (slot) => saveToSlot(game, slot),
  onLoad: (slot) => {
    const r = loadFromSlot(slot);
    if (!r.ok) return r;
    adoptState(r.state);
    return { ok: true };
  },
  onCycleCamera: () => gotoShot(shotIdx + 1),
  onNextDay: () => {
    startNextDay(game);
    restaurant.plan = game.plan;
    rebuildPlan();
    hud.toast(`${game.day} 日目、開店！`, 'good');
  },
  onMoveLocation: (id) => {
    const res = moveToLocation(game, id);
    if (res.ok) {
      rebuildPlan();
      lighting.setTimeOfDay(game.minute / 60);
      audio.playSfx('whoosh');
    }
    return res;
  }
});

/** 搬到新地點：重建場景中的餐廳（保留光影與天空） */
function rebuildPlan() {
  restaurant.dispose();
  const next = new RestaurantView(scene, game.plan);
  // 讓新的 view 取代舊的（用屬性交換避免重新賦值 const）
  Object.assign(restaurant, {
    root: next.root,
    groupMeshes: next.groupMeshes,
    staffMeshes: next.staffMeshes,
    staffGroup: next.staffGroup,
    passDishes: next.passDishes,
    dirtyMarks: next.dirtyMarks,
    _passShown: -1,
    _dirtyShown: '',
    lampPointers: next.lampPointers,
    tableProps: next.tableProps,
    porchLight: next.porchLight,
    floorY: next.floorY,
    tatamiY: next.tatamiY,
    _clock: 0
  });
  // 用原型方法綁回新資料（restaurant 仍是原實例）
  hud.update();
}

/* ------------------------------------------------------------ 輸入 */

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '5') { gotoShot(Number(k) - 1); return; }
  if (k === ' ') { e.preventDefault(); const v = game.paused ? 1 : 0; game.speed = v; game.paused = v === 0; hud.update(); return; }
  if (k === 'l') hud.toggle('panel-locations');
  else if (k === 's') hud.toggle('panel-staff');
  else if (k === 'm') hud.toggle('panel-menu');
  else if (k === 'o') hud.toggle('panel-settings');
  else if (k === 'h') hud.toggle('panel-help');
  else if (k === 'c') gotoShot(shotIdx + 1);
  else if (k === 'f') { forceNight = !forceNight; }
  else if (k === 'a') {
    if (!audio.ctx) armAudio();
    else { const on = audio.toggle(); hud.toast(on ? '音を出します' : '音を止めました'); }
  }
  else if (k === 'escape') hud.closeAll();
});
let forceNight = false;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

/* ------------------------------------------------------------ 音訊 */

const AUDIO_STORE = 'dreamrestaurant3d.audio';
function loadAudioPrefs() {
  try { return JSON.parse(localStorage.getItem(AUDIO_STORE) || '{}') || {}; } catch { return {}; }
}
function saveAudioPrefs(v) {
  try { localStorage.setItem(AUDIO_STORE, JSON.stringify(v)); } catch { /* ignore */ }
}
const prefs = loadAudioPrefs();

const audio = new AudioEngine({
  volumes: {
    master: prefs.master ?? 0.75,
    music: prefs.music ?? 0.5,
    sfx: prefs.sfx ?? 0.8,
    ambience: prefs.ambience ?? 0.45
  },
  onstate: (st) => syncAudioUi(st)
});

function syncAudioUi(st) {
  const btn = document.getElementById('btn-audio');
  if (btn) {
    btn.textContent = st.enabled ? '🔊 音 ON' : '🔇 音 OFF';
    btn.classList.toggle('on', st.enabled);
  }
  const mv = document.getElementById('vol-music');
  const sv = document.getElementById('vol-sfx');
  if (mv && document.activeElement !== mv) mv.value = String(Math.round(st.volumes.music * 100));
  if (sv && document.activeElement !== sv) sv.value = String(Math.round(st.volumes.sfx * 100));
}

/** 第一次使用者互動時才啟動音訊（瀏覽器自動播放政策） */
let audioArmed = false;
async function armAudio() {
  if (audioArmed) return;
  audioArmed = true;
  const ok = await audio.enable();
  applyAudioPrefs();
  if (ok) {
    hud?.toast('音を出します（BGM・効果音）', 'good');
    audio.playSfx('click');
  } else {
    hud?.toast('この環境では音を再生できません', 'bad');
  }
}
function applyAudioPrefs() {
  audio.setVolume('music', prefs.music ?? 0.5);
  audio.setVolume('sfx', prefs.sfx ?? 0.8);
  audio.setVolume('ambience', prefs.ambience ?? 0.45);
  audio.setVolume('master', prefs.master ?? 0.75);
}
addEventListener('pointerdown', armAudio, { once: false });
addEventListener('keydown', armAudio, { once: false });

/* 音量 UI */
function bindAudioUi() {
  document.getElementById('btn-audio')?.addEventListener('click', async () => {
    if (!audio.ctx) { await armAudio(); return; }
    const on = audio.toggle();
    hud.toast(on ? '音を出します' : '音を止めました');
    audio.playSfx(on ? 'click' : 'click');
  });
  const mv = document.getElementById('vol-music');
  mv?.addEventListener('input', () => {
    prefs.music = Number(mv.value) / 100;
    audio.setVolume('music', prefs.music);
    saveAudioPrefs(prefs);
  });
  const sv = document.getElementById('vol-sfx');
  sv?.addEventListener('input', () => {
    prefs.sfx = Number(sv.value) / 100;
    audio.setVolume('sfx', prefs.sfx);
    saveAudioPrefs(prefs);
  });
  sv?.addEventListener('change', () => audio.playSfx('clink'));
  syncAudioUi(audio.state());
}
bindAudioUi();

/* 事件 → 音效對照（模擬層只丟事件，這裡決定要播什麼） */
const EVENT_SFX = {
  door: 'door', seat: 'seat', order: 'order', serve: 'serve',
  pay: 'pay', angry: 'angry', cooked: 'clink', clean: 'whoosh',
  hired: 'happy', fired: 'error', equip: 'click', repair: 'clink'
};

/** 處理一筆模擬事件：播音效 + 需要時跳提示 */
function handleSimEvent(ev) {
  if (ev.type === 'event') {
    const kind = ev.kind || 'neutral';
    audio.playSfx(kind === 'positive' ? 'starup' : kind === 'negative' ? 'error' : 'click', { gain: 0.9 });
    if (ev.phase === 'start') hud.toast(ev.message || ev.name, kind === 'positive' ? 'good' : kind === 'negative' ? 'bad' : '');
    else hud.toast(ev.message || `${ev.name} が終わりました`, '');
    return;
  }
  const name = EVENT_SFX[ev.type];
  if (!name) return;
  if (name === 'happy' || name === 'error') { audio.playSfx(name); return; }
  audio.playSfx(name, { gain: 0.7 + Math.min(0.3, (ev.size || 1) * 0.05) });
}

/** 套用畫質設定（立即生效） */
let forceExposure = 1.0;
function applyGraphics() {
  const gr = game.settings?.graphics || {};
  const dpr = window.devicePixelRatio || 1;
  const pr = (gr.pixelRatio === 'auto' || gr.pixelRatio === undefined) ? Math.min(dpr, 2) : Number(gr.pixelRatio);
  renderer.setPixelRatio(Math.max(1, pr || 1));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = gr.shadows !== false;
  const size = gr.shadowQuality === 'low' ? 512 : gr.shadowQuality === 'medium' ? 1024 : 2048;
  const sun = lighting.sun;
  if (sun) {
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    sun.castShadow = gr.shadows !== false;
  }
  forceExposure = gr.exposure ?? 1.0;
}

/** 換成另一份遊戲狀態（讀取存檔用）：重建場景並重新綁定 HUD */
function adoptState(next) {
  game = next;
  hud.game = next;
  restaurant.dispose();
  const fresh = new RestaurantView(scene, game.plan);
  Object.assign(restaurant, {
    root: fresh.root,
    groupMeshes: fresh.groupMeshes,
    staffMeshes: fresh.staffMeshes,
    staffGroup: fresh.staffGroup,
    passDishes: fresh.passDishes,
    dirtyMarks: fresh.dirtyMarks,
    lampPointers: fresh.lampPointers,
    tableProps: fresh.tableProps,
    porchLight: fresh.porchLight,
    floorY: fresh.floorY,
    tatamiY: fresh.tatamiY,
    shell: fresh.shell,
    _clock: 0,
    _passShown: -1,
    _dirtyShown: ''
  });
  applyGraphics();
  camera.fov = game.settings?.fov ?? 46;
  camera.updateProjectionMatrix();
  lighting.setWeather(game.weather);
  lighting.setTimeOfDay(game.minute / 60);
  audio.setMusicMood({ scale: LOCALE_SCALE[locationById(game.locationId)?.kind] || 'yo' });
  gotoShot(0);
  hud.update();
  return game;
}

/* ------------------------------------------------------------ 主迴圈 */

let last = performance.now();
let acc = 0;
const MAX_STEP = 0.08;          // 單一畫面最多推進 0.08 秒（避免分頁切回暴衝）
let framesLeft = STATIC_FRAMES > 0 ? STATIC_FRAMES : Infinity;

function frame(now) {
  // 首幀的 rAF 時間戳可能早於模組載入時的 performance.now()，會得到負的 dt，
  // 讓阻尼反向把相機推走 → 一定要夾在 0 以上。
  const dtRaw = Math.max(0, Math.min(MAX_STEP, (now - last) / 1000));
  last = now;

  // 遊戲時間：1 秒 = 1 遊戲分鐘（依速度倍率）
  if (game.phase === 'open' || game.phase === 'closing') {
    const dtMin = dtRaw * (game.speed || 0) * 1.0;
    if (dtMin > 0) tick(game, dtMin);
    if (game.phase === 'settle') {
      const report = settleDay(game);
      hud.showSettle(report);
      const asr = autoSave(game);
      if (asr.ok) hud.toast('オートセーブしました', 'good');
      audio.playSfx('settle');
      if (report.net > 0) setTimeout(() => audio.playSfx('starup'), 700);
      game.speed = 0;
      game.paused = true;
    }
  }

  // 光影：依遊戲內時間
  const hour = forceNight ? 22 : game.minute / 60;
  lighting.setWeather(game.weather);
  lighting.setTimeOfDay(hour);
  renderer.toneMappingExposure = (forceExposure || 1) * (game.__night ? 1.18 : 1.0);
  game.__night = hour < 6.4 || hour > 18.4;

  // 事件 → 音效／提示（每幀清空）
  const evs = drainEvents(game);
  for (const ev of evs) handleSimEvent(ev);

  // 環境音與音樂性格（依地點、時段、來客數）——每 0.5 秒更新一次即可
  audioTimer += dtRaw;
  if (audio.enabled && audioTimer > 0.5) {
    audioTimer = 0;
    const loc = locationById(game.locationId);
    const crowd = game.groups.length + game.queue.length * 0.6;
    const busyTables = game.plan.tables.filter((t) => t.occupied).length;
    audio.setAmbience({
      crowd,
      kitchen: Math.min(3, busyTables * 0.5),
      rain: (game.weather === 'rain' ? 1 : game.weather === 'snow' ? 0.35 : 0),
      night: !!game.__night
    });
    audio.setMusicMood({
      scale: LOCALE_SCALE[loc?.kind] || 'yo',
      bpm: game.__night ? 62 : (game.minute > 11 * 60 && game.minute < 14 * 60 ? 88 : 74),
      density: 0.4 + Math.min(0.5, crowd * 0.06)
    });
  }

  if (game.settings?.autoRotate) cam.orbit(-14 * dtRaw, 0);
  restaurant.update(dtRaw, game);
  cam.update(dtRaw);
  hud.update();

  renderer.render(scene, camera);
  framesLeft -= 1;
  if (params.get('debug') && framesLeft === STATIC_FRAMES - 1) {
    let vis = 0, meshes = 0;
    scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.visible) vis++; } });
    const dbg = document.createElement('pre');
    dbg.id = 'dbg';
    dbg.style.cssText = 'position:fixed;left:8px;bottom:96px;z-index:99;background:rgba(0,0,0,.75);color:#8ef0a0;font:11px monospace;padding:8px;max-width:520px;white-space:pre-wrap';
    dbg.textContent = JSON.stringify({
      canvas: { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight },
      inner: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      camera: camera.position.toArray().map((v) => +v.toFixed(2)),
      target: cam.target.toArray().map((v) => +v.toFixed(2)),
      goal: cam._targetGoal.toArray().map((v) => +v.toFixed(2)),
      az: +cam.az.toFixed(3), pol: +cam.pol.toFixed(3), dist: +cam.dist.toFixed(2),
      panCalls: cam.panCalls || 0, orbitCalls: cam.orbitCalls || 0,
      shotTarget: SHOTS[shotIdx].target.toArray().map((v) => +v.toFixed(2)),
      shots: SHOTS[shotIdx].name,
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      meshes, vis,
      lights: scene.children.filter((o) => o.isLight).length,
      rig: scene.children.length,
      audio: audio.state(),
      info: window.DREAM3D?.info
    }, null, 1);
    document.body.appendChild(dbg);
    document.title = 'DBG calls=' + renderer.info.render.calls + ' tris=' + renderer.info.render.triangles;
  }
  if (framesLeft > 0) requestAnimationFrame(frame);
  else {
    // 靜態模式：把最後一張畫面轉成 <img> 疊上去。
    // 無頭瀏覽器在 rAF 停止後合成器可能拿不到 WebGL 內容，轉圖後截圖一定成功。
    if (STATIC_FRAMES > 0) {
      try {
        const url = canvas.toDataURL('image/png');
        const img = new Image();
        img.src = url;
        img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill;z-index:1';
        canvas.style.visibility = 'hidden';
        document.body.insertBefore(img, document.body.firstChild);
      } catch (err) { console.warn('static snapshot failed', err); }
    }
    console.log('[DREAM3D] static render done', JSON.stringify(window.DREAM3D?.info));
  }
}

/* ------------------------------------------------------------ 測試掛鉤 */

window.DREAM3D = {
  THREE, scene, camera, renderer, game, lighting, restaurant, cam, hud, audio,
  gotoShot,
  get info() {
    return {
      location: game.locationId,
      day: game.day,
      minute: Math.round(game.minute),
      clock: clockText(game.minute),
      cash: game.cash,
      stars: game.stars,
      guests: game.today.guests,
      groups: game.groups.length,
      queued: game.queue.length,
      seats: seatsOf(game),
      tables: game.plan.tables.length,
      phase: game.phase,
      weather: game.weather,
      hour: Math.round((game.minute / 60) * 10) / 10,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles
    };
  },
  /** 快轉 N 遊戲分鐘（測試用）。遇到打烊結算就停下來並顯示結算畫面。 */
  fastForward(minutes = 60) {
    const prevSpeed = game.speed;
    const prevPaused = game.paused;
    game.speed = 1; game.paused = false;
    let settled = false;
    for (let i = 0; i < minutes; i++) {
      if (game.phase !== 'open' && game.phase !== 'closing') break;
      tick(game, 1);
      if (game.phase === 'settle') {
        const report = settleDay(game);
        hud.showSettle(report);
        const asr = autoSave(game);
        if (asr.ok) hud.toast('オートセーブしました', 'good');
        game.speed = 0; game.paused = true;
        settled = true;
        break;
      }
    }
    if (!settled) { game.speed = prevSpeed; game.paused = prevPaused; }
    return this.info;
  },
  setHour(h) { forceNight = false; game.minuteFloat = h * 60; game.minute = game.minuteFloat; return this.info; },
  save(slot = '1') { return saveToSlot(game, slot); },
  load(slot = '1') { const r = loadFromSlot(slot); if (r.ok) adoptState(r.state); return r.ok ? { ok: true, info: this.info } : r; },
  autoSave() { return autoSave(game); },
  setSetting(path, value) { return setSetting(game, path, value); },
  applyGraphics,
  setStars(n) { setStars(game, n); hud.renderMenu(); return this.info; },
  openPanel(id) { hud.toggle(id); },
  locationName(id) { return locationById(id)?.name; }
};

/* ------------------------------------------------------------ 啟動 */

applyGraphics();
camera.fov = game.settings?.fov ?? 46;
camera.updateProjectionMatrix();
game.speed = game.settings?.speed ?? 1;
game.paused = game.speed === 0;
requestAnimationFrame(frame);

// 測試用參數
const ff = Number(params.get('ff') || 0);
if (ff > 0) window.DREAM3D.fastForward(ff);
if (params.get('hour')) window.DREAM3D.setHour(Number(params.get('hour')));
if (params.get('stars')) setStars(game, Number(params.get('stars')));
if (params.get('speed')) { game.speed = Number(params.get('speed')); game.paused = game.speed === 0; }
if (params.get('panel')) { try { hud.toggle('panel-' + params.get('panel')); } catch (e) { console.warn('panel open failed', e); } }
// ?stafftab=roster|hire|shop → 員工面板直接開在指定分頁（測試用）
if (params.get('stafftab')) {
  try {
    hud._staffTab = params.get('stafftab');
    document.querySelectorAll('#staff-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === hud._staffTab));
    hud.renderStaff();
  } catch (e) { console.warn('stafftab failed', e); }
}
// ?loadslot=auto|1..5 → 啟動時直接讀取該槽位（測試用，會走完整 adoptState 重建流程）
if (params.get('loadslot')) {
  try {
    const r = loadFromSlot(params.get('loadslot'));
    if (r.ok) { adoptState(r.state); console.log('[DREAM3D] loaded slot', params.get('loadslot'), JSON.stringify(window.DREAM3D?.info)); }
    else console.warn('[DREAM3D] load failed', r.error);
  } catch (e) { console.warn('loadslot failed', e); }
}
// ?stab=config|saves → 設定面板直接開在指定分頁（測試用）
if (params.get('stab')) {
  try {
    hud._settingsTab = params.get('stab');
    document.querySelectorAll('#settings-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.stab === hud._settingsTab));
    hud.renderSettings();
  } catch (e) { console.warn('stab failed', e); }
}
if (params.get('shot')) gotoShot(Number(params.get('shot')));
// ?audio=1 → 啟動時就直接開啟音訊（測試用；正常情況要等使用者手勢）
if (params.get('audio') === '1') {
  armAudio().then(() => {
    if (audio.enabled) {
      audio.setMusicMood({ scale: 'yo' });
      // 立刻丟幾個音效，讓無頭測試能觀察到真的在發聲
      setTimeout(() => { for (const n of ['click', 'door', 'seat', 'serve', 'pay']) audio.playSfx(n, { gain: 1 }); }, 300);
    }
  });
}

step('準備完了');
const loadingEl = document.getElementById('loading');
if (STATIC_FRAMES > 0 && loadingEl) loadingEl.style.transition = 'none';
setTimeout(() => loadingEl?.classList.add('done'), STATIC_FRAMES > 0 ? 0 : 260);
console.log('[DREAM3D] ready', JSON.stringify(window.DREAM3D.info));
