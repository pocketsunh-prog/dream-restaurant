// ============================================================================
// main.js — 啟動、主迴圈、輸入、日夜循環
// ============================================================================
import * as THREE from 'three';
import { createLighting } from './scene/lighting.js';
import { OrbitCam } from './scene/controls.js';
import { RestaurantView } from './scene/restaurant.js';
import {
  createGame, tick, settleDay, startNextDay, moveToLocation, setStars,
  clockText, money, OPEN_MINUTE, CLOSE_MINUTE, drainEvents
} from './sim/game.js';
import { Hud, seatsOf } from './ui/hud.js';
import { locationById } from './data/locations.js';
import { AudioEngine, LOCALE_SCALE, SFX_NAMES } from './audio/audio.js';

const params = new URLSearchParams(location.search);
const step = (t) => { const el = document.getElementById('loading-step'); if (el) el.textContent = t; };
// 測試用：?static=N → 只渲染 N 幀就停止 rAF（無頭截圖用）。此時必須保留 drawingBuffer，
// 否則迴圈停止後緩衝區被清空，截圖會是一片黑。
const STATIC_FRAMES = Math.max(0, Number(params.get('static') || 0));
const NEED_PRESERVE = STATIC_FRAMES > 0 || params.has('ss');

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
const game = createGame({
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
  onSpeed: (v) => { game.speed = v; game.paused = v === 0; },
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
  else if (k === 'm') hud.toggle('panel-menu');
  else if (k === 'h') hud.toggle('panel-help');
  else if (k === 'c') gotoShot(shotIdx + 1);
  else if (k === 'f') { forceNight = !forceNight; }
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

/* 事件 → 音效對照（模擬層只丟事件，這裡決定要播什麼） */
const EVENT_SFX = {
  door: 'door', seat: 'seat', order: 'order', serve: 'serve',
  pay: 'pay', angry: 'angry'
};

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
      game.speed = 0;
      game.paused = true;
    }
  }

  // 光影：依遊戲內時間
  const hour = forceNight ? 22 : game.minute / 60;
  lighting.setWeather(game.weather);
  lighting.setTimeOfDay(hour);
  game.__night = hour < 6.4 || hour > 18.4;

  // 事件 → 音效（每幀清空）
  const evs = drainEvents(game);
  for (const ev of evs) {
    const name = EVENT_SFX[ev.type];
    if (!name) continue;
    if (name === 'angry') audio.playSfx('angry');
    else if (name === 'pay') audio.playSfx('pay');
    else audio.playSfx(name, { gain: 0.7 + Math.min(0.3, (ev.size || 1) * 0.05) });
  }

  // 環境音與音樂性格（依地點、時段、來客數）
  if (audio.enabled && (framesLeft === Infinity ? true : framesLeft % 12 === 0)) {
    const loc = locationById(game.locationId);
    const crowd = game.groups.length + game.queue.length * 0.6;
    const kitchen = state2 => 0;
    void kitchen;
    audio.setAmbience({
      crowd,
      kitchen: Math.min(3, game.plan.tables.filter((t) => t.occupied).length * 0.5),
      rain: (game.weather === 'rain' ? 1 : game.weather === 'snow' ? 0.35 : 0),
      night: !!game.__night
    });
    audio.setMusicMood({
      scale: LOCALE_SCALE[loc?.kind] || 'yo',
      bpm: game.__night ? 62 : (game.minute > 11 * 60 && game.minute < 14 * 60 ? 88 : 74),
      density: 0.4 + Math.min(0.5, crowd * 0.06)
    });
  }

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
  THREE, scene, camera, renderer, game, lighting, restaurant, cam, hud,
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
        game.speed = 0; game.paused = true;
        settled = true;
        break;
      }
    }
    if (!settled) { game.speed = prevSpeed; game.paused = prevPaused; }
    return this.info;
  },
  setHour(h) { forceNight = false; game.minuteFloat = h * 60; game.minute = game.minuteFloat; return this.info; },
  setStars(n) { setStars(game, n); hud.renderMenu(); return this.info; },
  openPanel(id) { hud.toggle(id); },
  locationName(id) { return locationById(id)?.name; }
};

/* ------------------------------------------------------------ 啟動 */

requestAnimationFrame(frame);

// 測試用參數
const ff = Number(params.get('ff') || 0);
if (ff > 0) window.DREAM3D.fastForward(ff);
if (params.get('hour')) window.DREAM3D.setHour(Number(params.get('hour')));
if (params.get('stars')) setStars(game, Number(params.get('stars')));
if (params.get('speed')) { game.speed = Number(params.get('speed')); game.paused = game.speed === 0; }
if (params.get('panel')) { try { hud.toggle('panel-' + params.get('panel')); } catch (e) { console.warn('panel open failed', e); } }
if (params.get('shot')) gotoShot(Number(params.get('shot')));

step('準備完了');
const loadingEl = document.getElementById('loading');
if (STATIC_FRAMES > 0 && loadingEl) loadingEl.style.transition = 'none';
setTimeout(() => loadingEl?.classList.add('done'), STATIC_FRAMES > 0 ? 0 : 260);
console.log('[DREAM3D] ready', JSON.stringify(window.DREAM3D.info));
