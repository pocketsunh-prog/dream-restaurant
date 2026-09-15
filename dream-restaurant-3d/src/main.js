// ============================================================================
// main.js — 啟動、主迴圈、輸入、日夜循環
// ============================================================================
import * as THREE from 'three';
import { createLighting } from './scene/lighting.js';
import { OrbitCam } from './scene/controls.js';
import { RestaurantView } from './scene/restaurant.js';
import {
  createGame, tick, settleDay, startNextDay, moveToLocation, setStars,
  clockText, money, OPEN_MINUTE, CLOSE_MINUTE, drainEvents, setBusinessHours, setSetting,
  allTables, TASK_KINDS, ROLE_LABEL, setRoleUniform, crowdInfo, setFloorCount, spawnGroup
} from './sim/game.js';
import { Hud, seatsOf } from './ui/hud.js';
import { locationById } from './data/locations.js';
import { dishById } from './data/dishes.js';
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
const restaurant = new RestaurantView(scene, game.plan, { location: locationById(game.locationId) });

/* ------------------------------------------------------------ 攝影機 */

const cam = new OrbitCam(camera, canvas);
const CENTER = new THREE.Vector3(0, 1.0, 0);

// floor: 0 = 全館, 1/2/3 = 指定樓層（目標 Y 會對應樓層高度）
const SHOTS = [
  { name: '全館',   az: 0.66, pol: 0.92, dist: 22, target: new THREE.Vector3(-0.1, 5, 0.0), floor: 0 },
  { name: '1F 全景', az: 0.66, pol: 0.96, dist: 16.4, target: new THREE.Vector3(-0.1, 0.8, 0.0), floor: 1 },
  { name: '1F 客席', az: 0.18, pol: 1.02, dist: 8.4, target: new THREE.Vector3(-1.6, 0.8, 0.2), floor: 1 },
  { name: '1F 厨房', az: 2.55, pol: 1.06, dist: 7.0, target: new THREE.Vector3(3.6, 1.0, -3.2), floor: 1 },
  { name: '2F 客席', az: 0.18, pol: 1.0, dist: 9.0, target: new THREE.Vector3(-1.6, 4.2, 0.2), floor: 2 },
  { name: '3F 客席', az: 0.18, pol: 1.0, dist: 9.0, target: new THREE.Vector3(-1.6, 7.6, 0.2), floor: 3 },
  // 爐前（料理人の手元）：實際位置由 focusCook() 依廚師所在位置更新
  { name: '爐前（調理）', az: 2.35, pol: 1.16, dist: 4.6, target: new THREE.Vector3(3.4, 1.2, -2.7), floor: 1 }
];
let shotIdx = 0;
let viewingFloor = 0;   // 0 = 看全館
cam.jumpTo(SHOTS[0]);

/** 目前鏡頭跟著哪位員工（null = 自由視角） */
let followingStaff = null;

function gotoShot(i) {
  followingStaff = null;
  shotIdx = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length;
  const s = SHOTS[shotIdx];
  cam.flyTo(s);
  hud?.toast(`カメラ：${s.name}`);
}

/** 員工所在的世界座標（含樓層高度） */
function staffWorld(s) {
  const fh = game.plan?.floorHeight || 3.4;
  return new THREE.Vector3(s.x ?? 0, (s.floor || 0) * fh + 1.15, s.z ?? 0);
}

/** 把鏡頭拉近某位員工，並持續跟著他（看料理人做菜用） */
function focusStaff(id, dist = 4.6, immediate = false) {
  const s = (game.staff || []).find((x) => x.id === id);
  if (!s) return false;
  followingStaff = s.id;
  shotIdx = SHOTS.length - 1;
  const shot = { target: staffWorld(s), pol: 1.16, dist };
  if (immediate) cam.jumpTo(shot); else cam.flyTo(shot);
  return true;
}

/**
 * 「調理を見る」：鏡頭跟著一位料理人（沒指定就找正在煮菜的那位）。
 * 廚師頭上會有標籤顯示菜名與進度，爐火與蒸氣也會跟著開。
 */
function focusCook(staffId, immediate = false) {
  const chefs = (game.staff || []).filter((s) => s.role === 'chef');
  if (!chefs.length) { hud?.toast('料理人がいません（従業員 → 招募）', 'bad'); return false; }
  const target = (staffId && chefs.find((s) => s.id === staffId))
    || chefs.find((s) => s.pose === 'cook')
    || chefs.find((s) => s.taskId)
    || chefs[0];
  focusStaff(target.id, 4.6, immediate);
  const task = target.taskId ? (game.tasks || []).find((t) => t.id === target.taskId) : null;
  const dish = task?.dishIds?.[0] ? dishById(task.dishIds[0]) : null;
  hud?.toast(dish ? `${target.name}：${dish.name} を調理中` : `${target.name} の様子を見ています`);
  return true;
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
  onFloor: (n) => {
    const res = setFloorCount(game, n);
    if (res.ok) {
      // 擴建後重建場景（adoptFrom 會把爐火／調理標籤／候位繩等一起換新）
      const fresh = new RestaurantView(scene, game.plan, { location: locationById(game.locationId) });
      restaurant.dispose();
      restaurant.adoptFrom(fresh);
      hud.renderShop && hud.renderShop();
      hud.update();
    }
    return res;
  },
  onUniform: (staffId, uniformId) => {
    const res = setStaffUniform(game, staffId, uniformId);
    if (res.ok) {
      // 重建該員工的 3D 模型（制服顏色不同）
      const sm = restaurant.staffMeshes.get(staffId);
      if (sm) { restaurant.staffGroup.remove(sm); restaurant.staffMeshes.delete(staffId); }
    }
    return res;
  },
  onRoleUniform: (role, uniformId) => {
    const res = setRoleUniform(game, role, uniformId);
    if (res.ok) {
      // 整個職種換制服 → 把這些員工的模型全部丟掉，下一帧重建
      for (const s of game.staff.filter((x) => x.role === role)) {
        const sm = restaurant.staffMeshes.get(s.id);
        if (sm) { restaurant.staffGroup.remove(sm); restaurant.staffMeshes.delete(s.id); }
      }
    }
    return res;
  },
  onSave: (slot) => saveToSlot(game, slot),
  onLoad: (slot) => {
    const r = loadFromSlot(slot);
    if (!r.ok) return r;
    adoptState(r.state);
    return { ok: true };
  },
  onCycleCamera: () => gotoShot(shotIdx + 1),
  onFocusCook: (staffId) => focusCook(staffId),
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
  const next = new RestaurantView(scene, game.plan, { location: locationById(game.locationId) });
  restaurant.adoptFrom(next);
  hud.update();
}

/* ------------------------------------------------------------ 輸入 */

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '7') { gotoShot(Number(k) - 1); return; }
  if (k === ' ') { e.preventDefault(); const v = game.paused ? 1 : 0; game.speed = v; game.paused = v === 0; hud.update(); return; }
  if (k === 'l') hud.toggle('panel-locations');
  else if (k === 's') hud.toggle('panel-staff');
  else if (k === 'm') hud.toggle('panel-menu');
  else if (k === 'r') { hud.toggle('panel-report'); hud.renderReport(); }
  else if (k === 't') { hud.toggle('panel-rank'); hud.renderRank(); }
  else if (k === 'e') { hud.toggle('panel-shop'); hud.renderShopPanel(); }
  else if (k === 'k') focusCook();
  else if (k === 'o') hud.toggle('panel-settings');
  else if (k === 'h') hud.toggle('panel-help');
  else if (k === 'c') gotoShot(shotIdx + 1);
  else if (k === 'f') { forceNight = !forceNight; }
  else if (k === 'a') {
    if (!audio.ctx) armAudio();
    else { const on = audio.toggle(); hud.toast(on ? '音を出します' : '音を止めました'); }
  }
  else if (k === 'escape') { followingStaff = null; hud.closeAll(); }
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

/* ── 點擊揀選：客人看訂單，員工看他在做什麼 ─────────────────────── */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const meshToGroup = new Map();

canvas.addEventListener('click', (e) => {
  if (!game) return;
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  // 先看有沒有點到員工（廚師／服務生），再找客人
  const staffMeshes = [];
  for (const [sid, m] of restaurant.staffMeshes) { staffMeshes.push(m); meshToGroup.set(m, 'staff:' + sid); }
  const staffHit = raycaster.intersectObjects(staffMeshes, true);
  if (staffHit.length) {
    let obj = staffHit[0].object;
    while (obj && !obj.userData?.kind) obj = obj.parent;
    const sid = obj ? [...restaurant.staffMeshes.entries()].find(([, m]) => m === obj)?.[0] : null;
    const st = sid ? (game.staff || []).find((s) => s.id === sid) : null;
    if (st) {
      focusStaff(st.id, st.role === 'chef' ? 4.4 : 5.2);
      const task = st.taskId ? (game.tasks || []).find((t) => t.id === st.taskId) : null;
      const dish = task?.dishIds?.[0] ? dishById(task.dishIds[0]) : null;
      const taskJp = task ? (TASK_KINDS[task.type]?.jp || task.type) : '待機中';
      hud.toast(`${st.name}（${ROLE_LABEL[st.role] || st.role}）：${taskJp}${dish ? '・' + dish.name : ''}`);
      return;
    }
  }

  if (!game.groups.length) return;
  const meshes = [];
  for (const [gid, rec] of restaurant.groupMeshes) {
    for (const m of (rec.meshes || [])) { meshes.push(m); meshToGroup.set(m, gid); }
  }
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length) {
    let obj = hits[0].object;
    let gid = meshToGroup.get(obj);
    while (gid === undefined && obj) { obj = obj.parent; gid = meshToGroup.get(obj); }
    const g = gid ? game.groups.find((x) => x.id === gid) : null;
    if (g) { hud.toggle('panel-customer'); hud.renderCustomerDetail(g); }
  }
});

// 玩家一動鏡頭就放開跟拍
canvas.addEventListener('pointerdown', () => { followingStaff = null; });
canvas.addEventListener('wheel', () => { followingStaff = null; }, { passive: true });

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
  const prev = restaurant;
  const fresh = new RestaurantView(scene, game.plan, { location: locationById(game.locationId) });
  prev.dispose();
  restaurant.adoptFrom(fresh);
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
    const busyTables = allTables(game.plan).filter((t) => t.occupied).length;
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
  // 跟拍員工（看料理人做菜）：鏡頭目標持續貼著他
  if (followingStaff) {
    const s = (game.staff || []).find((x) => x.id === followingStaff);
    if (s) cam.flyTo({ target: staffWorld(s) });
    else followingStaff = null;
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
      tables: allTables(game.plan).length,
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
  /** 測試／展示用：馬上叫幾組帶寵物的客人來（看ペット同伴席的運作） */
  spawnPet(n = 2) {
    let made = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 400; k++) {
        const g = spawnGroup(game, locationById(game.locationId));
        if (g.pet) { game.groups.push(g); made++; break; }
      }
    }
    return { ok: made > 0, made };
  },
  focusCook(staffId, immediate = false) { return focusCook(staffId, immediate); },
  focusStaff(id, dist) { return focusStaff(id, dist, true); },
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
// ?pets=2 → 開場先叫 2 組帶寵物的客人（展示／截圖用），可搭配 ?ff= 讓他們入座
if (params.get('pets')) {
  window.DREAM3D.spawnPet(Math.max(1, Number(params.get('pets')) || 2));
  if (!ff) window.DREAM3D.fastForward(40);
}
// ?shoptab=expand|uniform → 開場直接開店舗面板的指定分頁（測試用）
if (params.get('shoptab')) {
  try {
    hud._shopTab = params.get('shoptab');
    hud.toggle('panel-shop');
    hud.renderShopPanel();
  } catch (e) { console.warn('shoptab failed', e); }
}
if (params.get('shot')) gotoShot(Number(params.get('shot')));
// ?cam=az,pol,dist,tx,ty,tz → 直接指定機位（驗證用）
if (params.get('cam')) {
  const n = params.get('cam').split(',').map(Number);
  if (n.length >= 3 && n.every((v) => Number.isFinite(v))) {
    followingStaff = null;
    cam.jumpTo({
      az: n[0], pol: n[1], dist: n[2],
      target: new THREE.Vector3(n[3] ?? 0, n[4] ?? 1, n[5] ?? 0)
    });
  }
}
// ?probe=x,z,r → 列出 (x,z) 半徑 r 內的所有 mesh（找不到怪東西時用的除錯工具）
if (params.get('probe')) {
  const [px, pz, pr = 2] = params.get('probe').split(',').map(Number);
  const box = new THREE.Box3();
  const rows = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    if (Math.hypot(cx - px, cz - pz) > pr) return;
    const size = box.getSize(new THREE.Vector3());
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    rows.push(`${o.name || o.type} mat=${m?.name || ''} col=#${m?.color ? m.color.getHexString() : '----'}`
      + ` pos=${cx.toFixed(2)},${((box.min.y + box.max.y) / 2).toFixed(2)},${cz.toFixed(2)}`
      + ` size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`
      + ` parent=${o.parent?.name || ''}`);
  });
  rows.sort();
  const pre = document.createElement('pre');
  pre.id = 'probe';
  pre.style.cssText = 'position:fixed;left:6px;top:6px;z-index:999;background:#000d;color:#9f9;font:11px monospace;padding:8px;max-width:96vw;max-height:90vh;overflow:auto;white-space:pre-wrap';
  pre.textContent = `${rows.length} meshes near ${px},${pz}\n` + rows.join('\n');
  document.body.appendChild(pre);
}
// ?cook=1 → 開場先快轉一段時間，再把鏡頭對到正在做菜的料理人（驗證用；立即到位方便截圖）
if (params.get('cook') === '1') {
  const mins = Number(params.get('ff') || 180);
  if (!ff) window.DREAM3D.fastForward(mins);
  window.DREAM3D.focusCook(null, true);
}
// ?uitest=1 → 把所有面板渲染一遍並把結果寫進 <pre id="uitest">（無頭驗證用）
if (params.get('uitest') === '1') {
  const rep = [];
  const host = (id) => document.getElementById(id);
  const probe = (name, fn) => {
    try {
      fn();
      rep.push(`OK   ${name}`);
    } catch (err) {
      rep.push(`FAIL ${name} :: ${err?.message || err}`);
    }
  };
  const textOf = (id) => (host(id)?.textContent || '');
  probe('panel-rank(local)', () => { hud.toggle('panel-rank'); hud._rankTab = 'local'; hud.renderRank(); });
  probe('panel-rank(global)', () => { hud._rankTab = 'global'; hud.renderRank(); });
  probe('panel-shop(expand)', () => { hud.toggle('panel-shop'); hud._shopTab = 'expand'; hud.renderShopPanel(); });
  probe('panel-shop(uniform)', () => { hud._shopTab = 'uniform'; hud.renderShopPanel(); });
  probe('panel-report', () => { hud.toggle('panel-report'); hud.renderReport(); });
  probe('panel-staff(roster)', () => { hud._staffTab = 'roster'; hud.toggle('panel-staff'); hud.renderStaff(); });
  probe('panel-staff(hire)', () => { hud._staffTab = 'hire'; hud.renderStaff(); });
  probe('panel-staff(shop)', () => { hud._staffTab = 'shop'; hud.renderStaff(); });
  probe('panel-settings', () => { hud.toggle('panel-settings'); hud.renderSettings(); });
  probe('panel-locations', () => { hud.toggle('panel-locations'); hud.renderLocations(); });
  probe('panel-menu', () => { hud.toggle('panel-menu'); hud.renderMenu(); });
  probe('panel-customer', () => {
    const g = (game.groups || [])[0];
    if (!g) throw new Error('沒有客人（先用 ?ff= 快轉）');
    hud.toggle('panel-customer'); hud.renderCustomerDetail(g);
  });
  hud.toggle('panel-rank'); hud._rankTab = 'global'; hud.renderRank();
  const rankText = textOf('rank-body');
  rep.push(`CHECK rank 全地点 rows=${(rankText.match(/自店/g) || []).length} hasPotential=${/平均日商/.test(rankText)}`);
  hud._rankTab = 'local'; hud.renderRank();
  const localText = textOf('rank-body');
  rep.push(`CHECK rank この店 hasRecord=${/店史/.test(localText)} hasDishes=${/料理ランキング/.test(localText)} hasStaff=${/料理人ランキング/.test(localText) && /ホールランキング/.test(localText)}`);
  hud.toggle('panel-report'); hud.renderReport();
  const repText = textOf('report-body');
  rep.push(`CHECK report hasKitchen=${/調理場/.test(repText)} hasPass=${/出餐口/.test(repText)} hasTop=${/今日点単ランキング/.test(repText)}`);
  if (host('customer-detail')?.innerHTML) rep.push('CHECK customer detail rendered');
  // 店舗面板：實際按下「増築 2F」與「全員に適用」，確認真的生效
  probe('shop: expand 2F', () => {
    hud.toggle('panel-shop'); hud._shopTab = 'expand'; hud.renderShopPanel();
    const btn = document.querySelector('#shop-expand [data-floor="2"]');
    if (!btn) throw new Error('找不到増築按鈕（可能已經 2 階以上）');
    const errs = [];
    const onErr = (e) => errs.push(e.message || String(e.reason || e));
    addEventListener('error', onErr);
    addEventListener('unhandledrejection', onErr);
    btn.click();
    removeEventListener('error', onErr);
    removeEventListener('unhandledrejection', onErr);
    if (errs.length) throw new Error('クリックで例外：' + errs.join(' / '));
    if ((game.plan.floorCount || 1) < 2) throw new Error(`點擊後樓層沒變（cash=${Math.round(game.cash)} disabled=${btn.disabled}）`);
  });
  probe('shop: role uniform', () => {
    hud._shopTab = 'uniform'; hud.renderShopPanel();
    const b = document.querySelector('#shop-uniform [data-role-uniform^="chef:"]');
    if (!b) throw new Error('找不到料理人制服按鈕');
    b.click();
    const want = b.dataset.roleUniform.split(':')[1];
    if (!game.staff.filter((s) => s.role === 'chef').every((s) => s.uniformId === want)) throw new Error('制服沒有全部套用');
  });
  rep.push(`CHECK shop floors=${game.plan.floorCount} floorGroups=${(restaurant.floorGroups || []).length} cookFx=${!!restaurant.cookFx} chefUniform=${game.staff.find((s) => s.role === 'chef')?.uniformId}`);
  hud.closeAll();
  // 場景與模擬是否一致（客人／員工有沒有真的畫出來）：先手動跑一幀讓場景建出人物、也讓看板畫一次
  restaurant.update(0.016, game);
  const ci = crowdInfo(game);
  rep.push(`CHECK crowd inside=${ci.insideGuests} seats=${ci.seats} free=${ci.seatsFree} waiting=${ci.waiting} list=${ci.waitingList.length} petOk=${ci.petOkTables} noticeKey=${restaurant._noticeKey ? 'set' : 'empty'}`);
  rep.push(`CHECK petGroupsToday=${ci.petToday} petSpots=${(restaurant.petSpots || []).length} petTableGroup=${(game.groups || []).filter((g) => g.petTable).length}`);
  let visibleGuests = 0, meshCount = 0;
  for (const [, rec] of restaurant.groupMeshes) {
    for (const m of rec.meshes) { meshCount++; if (m.visible) visibleGuests++; }
  }
  const seated = (game.groups || []).filter((g) => g.state === 'eating' || g.state === 'waitServe' || g.state === 'waitCook' || g.state === 'ordering').length;
  rep.push(`CHECK scene groups=${restaurant.groupMeshes.size}/${(game.groups || []).length} meshes=${meshCount} visibleGuests=${visibleGuests} seatedGroups=${seated}`);
  rep.push(`CHECK scene staffMeshes=${restaurant.staffMeshes.size}/${(game.staff || []).length} poseSet=${(game.staff || []).map((s) => s.pose).join('/')}`);
  const sample = (game.groups || []).slice(0, 3).map((g) => {
    const rec = restaurant.groupMeshes.get(g.id);
    const m = rec?.meshes?.[0];
    return `${g.id}:${g.state}:f${g.floor}:${g.pose}:mesh=${m ? m.position.toArray().map((v) => v.toFixed(1)).join(',') : 'none'}`;
  });
  rep.push('CHECK sample ' + (sample.join(' | ') || 'none'));
  hud.closeAll();
  const pre = document.createElement('pre');
  pre.id = 'uitest';
  pre.style.cssText = 'position:fixed;left:6px;top:6px;z-index:999;background:#000c;color:#9f9;font:11px monospace;padding:8px;max-width:96vw;white-space:pre-wrap';
  pre.textContent = rep.join('\n');
  document.body.appendChild(pre);
  document.title = rep.some((r) => r.startsWith('FAIL')) ? 'UITEST-FAIL' : 'UITEST-OK';
}
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
