// ============================================================================
// lighting.js — 場景光影：天空穹頂、太陽／月亮、環境反射、室內燈籠
//   高畫質重點：ACES 色調映射 + PBR 環境反射 + 柔和陰影 + 色溫隨時間變化
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* 各時段的太陽高度／顏色／強度（hour 為 0-24 浮點） */
const SUN_KEYS = [
  { h: 0,  col: 0x2a3b6b, int: 0.06, amb: 0x1a2138, ambInt: 0.22, fog: 0x0b0f1c },
  { h: 5,  col: 0x4a5a8c, int: 0.12, amb: 0x2b3350, ambInt: 0.34, fog: 0x1b2138 },
  { h: 6.5, col: 0xff9a5c, int: 0.85, amb: 0x53466a, ambInt: 0.62, fog: 0x6b5560 },
  { h: 8,  col: 0xffd9a8, int: 1.85, amb: 0x8ea6c8, ambInt: 0.85, fog: 0x9fb2c4 },
  { h: 12, col: 0xfff4e2, int: 2.65, amb: 0xb8cfe8, ambInt: 1.0, fog: 0xc3d4e2 },
  { h: 16, col: 0xffe6c0, int: 2.25, amb: 0xa8bcd6, ambInt: 0.92, fog: 0xb8c6d4 },
  { h: 18, col: 0xff9d5a, int: 1.25, amb: 0x7a6a86, ambInt: 0.7, fog: 0x8a7080 },
  { h: 19.5, col: 0x8a6ea8, int: 0.42, amb: 0x42405e, ambInt: 0.5, fog: 0x3b3a52 },
  { h: 21, col: 0x3b4a7a, int: 0.14, amb: 0x252c48, ambInt: 0.3, fog: 0x141a2c },
  { h: 24, col: 0x2a3b6b, int: 0.06, amb: 0x1a2138, ambInt: 0.22, fog: 0x0b0f1c }
];

const WEATHER_LIGHT = {
  sunny:  { sun: 1.0,  amb: 1.0,  fog: 0.0009, sat: 1.0 },
  cloudy: { sun: 0.55, amb: 1.15, fog: 0.0022, sat: 0.9 },
  rain:   { sun: 0.32, amb: 1.0,  fog: 0.0042, sat: 0.72 },
  snow:   { sun: 0.42, amb: 1.3,  fog: 0.0055, sat: 0.82 }
};

/* 天空關鍵色（依時刻內插）：top 天頂、bot 地平、hor 地平暖光、haze 霧感強度 */
const SKY_KEYS = [
  { h: 0,    top: 0x050912, bot: 0x0c1526, hor: 0x16233c, haze: 0.30 },
  { h: 4.5,  top: 0x121c3a, bot: 0x2e2c4a, hor: 0x5c4652, haze: 0.42 },
  { h: 6.5,  top: 0x2f4a86, bot: 0x9a6a5a, hor: 0xe08a4a, haze: 0.62 },
  { h: 9,    top: 0x3f7fd0, bot: 0xa8c8e8, hor: 0xf0dcbc, haze: 0.44 },
  { h: 13,   top: 0x2f6fc4, bot: 0x9dc4e6, hor: 0xdce9f4, haze: 0.30 },
  { h: 16.5, top: 0x3a6fb4, bot: 0xc0ccd8, hor: 0xffd0a0, haze: 0.42 },
  { h: 18.5, top: 0x2b3f7a, bot: 0xc07a56, hor: 0xff9a52, haze: 0.70 },
  { h: 20.2, top: 0x0e1730, bot: 0x2a2a44, hor: 0x4a3a54, haze: 0.48 },
  { h: 24,   top: 0x050912, bot: 0x0c1526, hor: 0x16233c, haze: 0.30 }
];

function lerpSky(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (h >= SKY_KEYS[i].h && h <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = THREE.MathUtils.clamp((h - a.h) / Math.max(0.001, b.h - a.h), 0, 1);
  const s = t * t * (3 - 2 * t);
  return {
    top: new THREE.Color(a.top).lerp(new THREE.Color(b.top), s),
    bot: new THREE.Color(a.bot).lerp(new THREE.Color(b.bot), s),
    hor: new THREE.Color(a.hor).lerp(new THREE.Color(b.hor), s),
    haze: THREE.MathUtils.lerp(a.haze, b.haze, s)
  };
}

function lerpKeys(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = SUN_KEYS[0], b = SUN_KEYS[SUN_KEYS.length - 1];
  for (let i = 0; i < SUN_KEYS.length - 1; i++) {
    if (h >= SUN_KEYS[i].h && h <= SUN_KEYS[i + 1].h) { a = SUN_KEYS[i]; b = SUN_KEYS[i + 1]; break; }
  }
  const span = Math.max(0.0001, b.h - a.h);
  const t = THREE.MathUtils.clamp((h - a.h) / span, 0, 1);
  const s = t * t * (3 - 2 * t);
  return {
    col: new THREE.Color(a.col).lerp(new THREE.Color(b.col), s),
    int: THREE.MathUtils.lerp(a.int, b.int, s),
    amb: new THREE.Color(a.amb).lerp(new THREE.Color(b.amb), s),
    ambInt: THREE.MathUtils.lerp(a.ambInt, b.ambInt, s),
    fog: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), s)
  };
}

/* 天空穹頂：以頂點著色器做雙色漸層 + 地平線暖光 */
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(t, 0.75));
  float horizon = 1.0 - clamp(abs(d.y) * 3.4, 0.0, 1.0);
  col = mix(col, uHorizon, horizon * uHaze);
  float sun = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 220.0) * 1.4;      // 太陽本體
  col += uSunColor * pow(sun, 6.0) * 0.14;        // 大氣散射
  gl_FragColor = vec4(col, 1.0);
}`;

export function createLighting(scene, renderer) {
  /* ── 環境反射（PBR 需要）：以 RoomEnvironment 產生 PMREM ── */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  const envIntensity = { value: 0.55 };

  /* ── 天空穹頂 ── */
  const skyUniforms = {
    uTop: { value: new THREE.Color(0x4b7fc4) },
    uBottom: { value: new THREE.Color(0xcfe0ee) },
    uHorizon: { value: new THREE.Color(0xffd9a8) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
    uSunColor: { value: new THREE.Color(0xfff2d0) },
    uHaze: { value: 0.55 }
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 40, 24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false
    })
  );
  sky.name = 'sky';
  scene.add(sky);

  /* ── 太陽／月亮（主方向光，投射陰影）── */
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 46;
  const S = 12;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.022;
  scene.add(sun);
  scene.add(sun.target);

  /* ── 天空補光（Hemisphere 提供柔和環境光）── */
  const hemi = new THREE.HemisphereLight(0xbcd6f0, 0x4a3a2c, 0.85);
  scene.add(hemi);

  /* ── 室內燈籠／吊燈（夜晚才亮；數量受限以維持效能）── */
  const lampGroup = new THREE.Group();
  lampGroup.name = 'lamps';
  scene.add(lampGroup);

  const lampDefs = [
    { x: -4.6, y: 2.15, z: -2.55, color: 0xffc978, intensity: 12, dist: 7.5 },
    { x: 0.8,  y: 2.15, z: 0.15,  color: 0xffc978, intensity: 12, dist: 7.5 },
    { x: -5.2, y: 1.95, z: -0.3,  color: 0xffb95e, intensity: 9,  dist: 6.0 },
    { x: 4.4,  y: 2.05, z: 2.5,   color: 0xffc07a, intensity: 10, dist: 6.5 },
    { x: 3.6,  y: 2.30, z: -3.4,  color: 0xdfe9ff, intensity: 8,  dist: 6.0 }
  ];
  const lamps = lampDefs.map((d) => {
    const l = new THREE.PointLight(d.color, 0, d.dist, 2);
    l.position.set(d.x, d.y, d.z);
    l.castShadow = false;
    lampGroup.add(l);
    return { light: l, def: d };
  });

  scene.fog = new THREE.FogExp2(0xb8c6d4, 0.0012);

  /* ── 狀態 ── */
  const state = {
    hour: 12,
    weather: 'sunny',
    nightBoost: 1,
    sun, hemi, sky, lamps, envIntensity,
    /** 目前是否為夜間（給外部判斷燈籠要不要亮） */
    isNight: false
  };

  function setTimeOfDay(hour) {
    state.hour = hour;
    const k = lerpKeys(hour);
    const w = WEATHER_LIGHT[state.weather] || WEATHER_LIGHT.sunny;

    // 太陽方位：以 6 點東方、12 點天頂、18 點西方（刻意偏一點，讓正午也有方向性陰影）
    const t = (hour - 6) / 12;                 // 0..1（6h→18h）
    const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(t, -0.2, 1.2));
    const az = Math.PI * (t - 0.5) * 1.15 + 0.35;
    const dir = new THREE.Vector3(Math.sin(az), Math.max(-0.25, elev * 0.92), Math.cos(az) * 0.62).normalize();

    const night = hour < 6.2 || hour > 18.6;
    state.isNight = night;

    sun.position.copy(dir).multiplyScalar(26);
    sun.target.position.set(0, 0.6, 0);
    sun.color.copy(k.col);
    sun.intensity = k.int * w.sun;
    // 夜晚改當月光（冷色、低強度）
    if (night) {
      sun.color.set(0x9fb4e6);
      sun.intensity = Math.max(0.12, k.int * 0.9);
    }

    hemi.color.copy(k.amb);
    hemi.intensity = k.ambInt * w.amb * 0.8;

    // 天空：明確的時段色盤（比從太陽色推導更乾淨）
    const skyCol = lerpSky(hour);
    skyUniforms.uTop.value.copy(skyCol.top);
    skyUniforms.uBottom.value.copy(skyCol.bot);
    skyUniforms.uHorizon.value.copy(skyCol.hor);
    skyUniforms.uSunDir.value.copy(dir);
    skyUniforms.uSunColor.value.copy(k.col);
    skyUniforms.uHaze.value = skyCol.haze * (state.weather === 'sunny' ? 1 : 1.35);

    (scene.fog || (scene.fog = new THREE.FogExp2(0xb8c6d4, 0.0012))).color.copy(k.fog);
    scene.fog.density = w.fog * (night ? 1.35 : 1);

    // 燈籠：日落後全亮；白天也保留 22% 的暖光，讓室內不會顯得死白
    const lampOn = night ? 1 : (hour > 16.6 ? Math.min(1, (hour - 16.6) / 1.6) : 0.22);
    for (const { light, def } of lamps) {
      light.intensity = def.intensity * lampOn * state.nightBoost;
      light.visible = light.intensity > 0.01;
    }
    envIntensity.value = night ? 0.14 : 0.38;
    scene.environmentIntensity = envIntensity.value;
    renderer.toneMappingExposure = night ? 1.12 : 0.94;
  }

  function setWeather(kind) {
    state.weather = WEATHER_LIGHT[kind] ? kind : 'sunny';
    setTimeOfDay(state.hour);
    return state.weather;
  }

  setTimeOfDay(12);
  setWeather('sunny');

  return { state, setTimeOfDay, setWeather, sun, hemi, sky, lamps };
}

export default createLighting;
