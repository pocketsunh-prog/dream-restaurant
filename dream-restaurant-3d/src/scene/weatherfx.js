// ============================================================================
// weatherfx.js — 屋外の天気エフェクト（雨・雷・雪・みぞれ・霧・猛暑）
//
//   天気ごとに「店の外」だけに見える演出を出す。室内は屋根があるので雨粒は
//   入らず、雷の閃光だけが一瞬だけ室內も照らす（それっぽく見える）。
//
//   使い方（main.js）:
//     const wfx = buildWeatherFx(scene);
//     ...毎フレーム... wfx.update(dt, game.weather, game.__night);
// ============================================================================
import * as THREE from 'three';

const AREA = { x: 34, zMin: 4.5, zMax: 26 };   // 店の前の道路あたり
const N = { rain: 900, storm: 1400, snow: 500, sleet: 700 };

/** 屋外の天気エフェクトを作る */
export function buildWeatherFx(scene) {
  const root = new THREE.Group();
  root.name = 'weatherFx';
  scene.add(root);

  // ── 雨（細い筋）──────────────────────────────────────────────
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(N.storm * 3);
  const rainSpeed = new Float32Array(N.storm);
  for (let i = 0; i < N.storm; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * AREA.x;
    rainPos[i * 3 + 1] = Math.random() * 9;
    rainPos[i * 3 + 2] = AREA.zMin + Math.random() * (AREA.zMax - AREA.zMin);
    rainSpeed[i] = 9 + Math.random() * 7;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xaecbe8, size: 0.09, transparent: true, opacity: 0.75, depthWrite: false
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  root.add(rain);

  // ── 雪（ゆっくり舞う）────────────────────────────────────────
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(N.snow * 3);
  const snowPhase = new Float32Array(N.snow);
  for (let i = 0; i < N.snow; i++) {
    snowPos[i * 3] = (Math.random() - 0.5) * AREA.x;
    snowPos[i * 3 + 1] = Math.random() * 9;
    snowPos[i * 3 + 2] = AREA.zMin + Math.random() * (AREA.zMax - AREA.zMin);
    snowPhase[i] = Math.random() * Math.PI * 2;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.13, transparent: true, opacity: 0.9, depthWrite: false
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  root.add(snow);

  // ── 雷（光る板＋閃光ライト）──────────────────────────────────
  const flashLight = new THREE.PointLight(0xdce8ff, 0, 60, 2);
  flashLight.position.set(0, 14, 12);
  root.add(flashLight);
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const bolt = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 12), boltMat);
  bolt.position.set(-8, 7, 20);
  root.add(bolt);

  // ── 霧（遠景を白く吞む板）────────────────────────────────────
  const fogMat = new THREE.MeshBasicMaterial({ color: 0xd7dde4, transparent: true, opacity: 0, depthWrite: false });
  const fogPlane = new THREE.Mesh(new THREE.PlaneGeometry(AREA.x + 20, 14), fogMat);
  fogPlane.position.set(0, 5, AREA.zMax + 4);
  root.add(fogPlane);

  // ── 猛暑（地面の陽炎）────────────────────────────────────────
  const hazeMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, depthWrite: false });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(AREA.x, 12), hazeMat);
  haze.rotation.x = -Math.PI / 2;
  haze.position.set(0, 0.12, (AREA.zMin + AREA.zMax) / 2);
  root.add(haze);

  let clock = 0;
  let nextBolt = 2 + Math.random() * 4;
  let boltT = 0;
  let lastWeather = '';

  function setCount(mesh, n) {
    mesh.geometry.setDrawRange(0, Math.max(0, Math.min(mesh.geometry.attributes.position.count, n)));
    mesh.visible = n > 0;
  }

  /** 毎フレーム呼ぶ */
  function update(dt, weather, night = false) {
    clock += dt;
    const w = weather || 'sunny';
    if (w !== lastWeather) {
      lastWeather = w;
      const stormy = w === 'storm';
      setCount(rain, w === 'rain' ? N.rain : stormy ? N.storm : w === 'sleet' ? N.sleet : 0);
      setCount(snow, w === 'snow' ? N.snow : w === 'sleet' ? Math.round(N.sleet * 0.5) : 0);
      rainMat.opacity = stormy ? 0.95 : 0.7;
      rainMat.color.set(stormy ? 0x9fb6d0 : 0xaecbe8);
      fogMat.opacity = w === 'fog' ? 0.5 : w === 'storm' ? 0.22 : 0;
      hazeMat.opacity = w === 'heat' ? 0.16 : 0;
      bolt.visible = stormy;
    }
    // 雨：落下（斜めに流す）
    if (rain.visible) {
      const arr = rainGeo.attributes.position.array;
      const n = rain.geometry.drawRange.count;
      const wind = w === 'storm' ? 3.4 : 0.9;
      for (let i = 0; i < n; i++) {
        arr[i * 3 + 1] -= rainSpeed[i] * dt;
        arr[i * 3] += wind * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 9;
          arr[i * 3] = (Math.random() - 0.5) * AREA.x;
        }
        if (arr[i * 3] > AREA.x / 2) arr[i * 3] -= AREA.x;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    // 雪：ゆっくり＋横揺れ
    if (snow.visible) {
      const arr = snowGeo.attributes.position.array;
      const n = snow.geometry.drawRange.count;
      for (let i = 0; i < n; i++) {
        arr[i * 3 + 1] -= (1.1 + (i % 5) * 0.16) * dt;
        arr[i * 3] += Math.sin(clock * 1.3 + snowPhase[i]) * 0.35 * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 9;
          arr[i * 3] = (Math.random() - 0.5) * AREA.x;
        }
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
    // 雷：ランダムに閃光（2〜6 秒間隔）
    if (w === 'storm') {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        nextBolt = 2 + Math.random() * 4;
        boltT = 0.42;
        bolt.position.x = -14 + Math.random() * 28;
        bolt.position.z = 16 + Math.random() * 6;
        flashLight.position.set(bolt.position.x, 13, bolt.position.z);
      }
    }
    if (boltT > 0) {
      boltT = Math.max(0, boltT - dt);
      const k = boltT / 0.42;
      // 2 回明滅させる（それっぽい稲妻）
      const flick = k > 0.6 ? 1 : k > 0.42 ? 0.25 : k > 0.2 ? 0.85 : 0.15;
      boltMat.opacity = k * flick * 0.95;
      flashLight.intensity = k * flick * 260;
    } else if (flashLight.intensity !== 0) {
      flashLight.intensity = 0;
      boltMat.opacity = 0;
    }
    // 猛暑：地面の陽炎をゆらす
    if (hazeMat.opacity > 0) {
      haze.position.y = 0.12 + Math.sin(clock * 2.2) * 0.04;
      hazeMat.opacity = 0.13 + 0.05 * Math.sin(clock * 1.7);
    }
    void night;
  }

  function dispose() {
    scene.remove(root);
    root.traverse((o) => {
      if (o.isMesh || o.isPoints) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
    });
  }

  return { root, update, dispose, state: () => ({ weather: lastWeather, rain: rain.geometry.drawRange.count, snow: snow.geometry.drawRange.count, bolt: flashLight.intensity > 1 }) };
}

export default { buildWeatherFx };
