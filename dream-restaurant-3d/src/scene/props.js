/**
 * props.js — procedural 3D prop library for the Japanese restaurant sim.
 *
 * Conventions (hard contract):
 *   • Units are METERS, Y is up.
 *   • Every exported builder is `(opts = {}) => THREE.Group`.
 *   • Every returned Group sits ON the floor: its bounding box min Y === 0.
 *   • Every Group is centred on the origin in X and Z (see per-prop notes).
 *   • Every mesh has castShadow = true and receiveShadow = true.
 *   • group.userData.role   = prop id string
 *   • group.userData.bounds = { x, y, z } axis-aligned size in meters
 *   • Only MeshStandardMaterial / MeshPhysicalMaterial. No unlit materials.
 *   • All surface detail is procedural CanvasTexture generated in-code.
 *   • Only dependency: 'three' (resolved through the page import map).
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * 0. Small maths helpers
 * ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** Deterministic PRNG so every texture / scatter is identical between runs. */
function rng(seed) {
  let s = (seed | 0) || 1;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToHex(h, s, l) {
  const hue = ((h % 1) + 1) % 1;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n) => {
    const k = (n + hue * 12) % 12;
    return Math.round(255 * (ll - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return `rgb(${f(0)},${f(8)},${f(4)})`;
}

function toHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Fine per-pixel grain — this is what keeps flat colours from looking dead. */
function speckle(ctx, w, h, count, alpha, seed, radiusMax = 1.2) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 0.25 + r() * radiusMax;
    ctx.globalAlpha = alpha * (0.25 + r() * 0.75);
    ctx.fillStyle = r() > 0.5 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ *
 * 1. Canvas texture factory (module-level cache)
 * ------------------------------------------------------------------ */

const TEX = new Map();

/** Minimal canvas — works on the main thread and inside workers. */
function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') throw new Error('props.js: no canvas implementation available');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Build (or fetch) a cached CanvasTexture.
 *
 * @param {string}   key       cache key
 * @param {number}   w         canvas width  (px)
 * @param {number}   h         canvas height (px)
 * @param {Function} drawFn    (ctx, w, h) => void
 * @param {number}   repeatX   horizontal tiling
 * @param {number}   repeatY   vertical tiling
 * @param {object}   [opts]    { offsetX, offsetY, srgb = true }
 */
function canvasTex(key, w, h, drawFn, repeatX = 1, repeatY = 1, opts = {}) {
  const cacheKey = `${key}|${w}x${h}|${repeatX}x${repeatY}|${opts.offsetX || 0},${opts.offsetY || 0}`;
  const hit = TEX.get(cacheKey);
  if (hit) return hit;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('props.js: 2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  drawFn(ctx, w, h);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (opts.offsetX || opts.offsetY) tex.offset.set(opts.offsetX || 0, opts.offsetY || 0);
  if (canvas.width === canvas.height && canvas.width >= 256) {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
  }

  TEX.set(cacheKey, tex);
  return tex;
}

/* ------------------------------------------------------------------ *
 * 2. Shared material cache — one material per physical surface type
 * ------------------------------------------------------------------ */

const MAT = Object.create(null);

/**
 * Lazily create and cache a material. The same name always yields the same
 * instance, which keeps the renderer's draw-call/program count low.
 */
function mat(name, params) {
  const hit = MAT[name];
  if (hit) return hit;
  if (!params) throw new Error(`props.js: material "${name}" has not been defined yet`);
  const m = new THREE.MeshStandardMaterial(params);
  m.name = name;
  MAT[name] = m;
  return m;
}

/* --- 2a. procedural texture painters --------------------------------- */

/** Wood: grain lines running along +V, optional plank rows running along +U. */
function paintWood(ctx, w, h, o) {
  const r = rng(o.seed || 7);
  ctx.fillStyle = o.base;
  ctx.fillRect(0, 0, w, h);

  const rowH = h / o.rows;
  for (let i = 0; i < o.rows; i++) {
    const y0 = i * rowH;
    if (o.planks) {
      // Each plank gets its own tone + its own grain phase so the floor reads
      // as many separate boards rather than one repeating sheet.
      const shift = r() * w;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = r() < 0.5 ? '#000000' : '#ffffff';
      ctx.fillRect(0, y0 + 1, w, rowH - 2);
      ctx.globalAlpha = 1;
      const cols = Math.max(2, Math.round(o.planks / o.rows));
      const cw = w / cols;
      for (let c = 0; c < cols; c++) {
        let x0 = c * cw - shift;
        if (x0 < -cw) x0 += w;
        if (x0 > 0) x0 -= w;
        const board = hslToHex(o.hue + (r() - 0.5) * 0.012, o.sat, clamp(o.light + (r() - 0.5) * 0.05, 0.05, 0.9));
        ctx.fillStyle = board;
        ctx.fillRect(x0 + 1, y0 + 1, cw - 2, rowH - 2);
        ctx.strokeStyle = 'rgba(30,18,10,0.5)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 1);
        ctx.lineTo(x0, y0 + rowH - 1);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = r() < 0.5 ? '#000000' : '#ffffff';
      ctx.fillRect(0, y0, w, rowH);
      ctx.globalAlpha = 1;
    }
  }

  // Seams between plank rows (and a specular highlight on the board edge).
  ctx.strokeStyle = o.seam;
  ctx.lineWidth = Math.max(1, h / 220);
  for (let i = 0; i <= o.rows; i++) {
    const y = i * rowH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,244,226,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i < o.rows; i++) {
    const y = i * rowH + 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Grain: harmonic sine rings stay periodic, so the texture tiles seamlessly.
  const lines = o.grainLines;
  for (let i = 0; i < lines; i++) {
    const x0 = (i / lines) * w + r() * (w / lines) * 0.85;
    const amp = w * (0.004 + r() * (o.knotty ? 0.02 : 0.009));
    const freq = 1 + Math.floor(r() * 3);
    const f2 = freq * (2 + Math.floor(r() * 2));
    const ph = r() * Math.PI * 2;
    const dark = r() < (o.knotty ? 0.55 : 0.3);
    const passes = 1 + (r() < 0.35 ? 1 : 0);
    for (let p = 0; p < passes; p++) {
      ctx.beginPath();
      for (let y = -2; y <= h + 2; y += 2) {
        const t = (y / h) * Math.PI * 2;
        const x = x0 + Math.sin(t * freq + ph) * amp + Math.sin(t * f2 + ph * 1.7) * amp * 0.34;
        if (y <= -2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = dark ? 'rgba(36,20,10,0.11)' : 'rgba(255,232,198,0.10)';
      ctx.lineWidth = 0.8 + r() * 1.3;
      ctx.stroke();
    }
  }

  // Occasional knot.
  if (o.knotty) {
    for (let k = 0; k < 2; k++) {
      const kx = r() * w;
      const ky = r() * h;
      const kr = 3 + r() * 5;
      ctx.strokeStyle = 'rgba(40,22,12,0.30)';
      ctx.lineWidth = 1.1;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * i * 0.35, kr * i * 0.20, 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  if (o.sheen) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.00)');
    g.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  speckle(ctx, w, h, 900, 0.05, (o.seed || 7) + 91, 1);
}

/* --- 2b. material definitions ---------------------------------------- */

mat('floorWood', {
  map: canvasTex('floorWood', 512, 512, (c, w, h) => paintWood(c, w, h, {
    base: '#b58c5c', rows: 8, planks: 32, hue: 0.086, sat: 0.30, light: 0.55,
    seam: 'rgba(52,31,16,0.55)', grainLines: 150, seed: 11, sheen: true
  }), 3, 3, { srgb: true }),
  roughness: 0.48, metalness: 0.02
});

mat('deckWood', {
  map: canvasTex('deckWood', 512, 512, (c, w, h) => paintWood(c, w, h, {
    base: '#9d7648', rows: 6, planks: 5, hue: 0.082, sat: 0.30, light: 0.50,
    seam: 'rgba(44,26,12,0.55)', grainLines: 120, seed: 23, sheen: true
  }), 2, 2, { srgb: true }),
  roughness: 0.60, metalness: 0.02
});

mat('woodWarm', {
  map: canvasTex('woodWarm', 256, 256, (c, w, h) => paintWood(c, w, h, {
    base: '#b98f5f', rows: 5, planks: 0, hue: 0.083, sat: 0.30, light: 0.55,
    seam: 'rgba(48,28,14,0.38)', grainLines: 110, seed: 5
  }), 2, 2, { srgb: true }),
  roughness: 0.55, metalness: 0.02
});

mat('woodDark', {
  map: canvasTex('woodDark', 256, 256, (c, w, h) => paintWood(c, w, h, {
    base: '#5c3a25', rows: 5, planks: 0, hue: 0.062, sat: 0.36, light: 0.28,
    seam: 'rgba(22,12,6,0.42)', grainLines: 120, seed: 17
  }), 2, 2, { srgb: true }),
  roughness: 0.52, metalness: 0.03
});

mat('woodDeep', {
  map: canvasTex('woodDeep', 256, 256, (c, w, h) => paintWood(c, w, h, {
    base: '#3d2317', rows: 4, planks: 0, hue: 0.055, sat: 0.42, light: 0.19,
    seam: 'rgba(12,6,3,0.5)', grainLines: 90, seed: 29
  }), 3, 3, { srgb: true }),
  roughness: 0.58, metalness: 0.02
});

mat('woodCounter', {
  map: canvasTex('woodCounter', 256, 256, (c, w, h) => paintWood(c, w, h, {
    base: '#6f4629', rows: 3, planks: 0, hue: 0.07, sat: 0.42, light: 0.31,
    seam: 'rgba(20,10,4,0.4)', grainLines: 150, seed: 37, knotty: true, sheen: true
  }), 2, 2, { srgb: true }),
  roughness: 0.42, metalness: 0.03
});

mat('stainless', { color: 0xb4bcc2, metalness: 0.85, roughness: 0.35 });
mat('stainlessDark', { color: 0x6c757b, metalness: 0.82, roughness: 0.44 });
mat('steelDark', { color: 0x2b2f33, metalness: 0.7, roughness: 0.5 });
mat('ironBlack', { color: 0x191b1d, metalness: 0.4, roughness: 0.62 });
mat('brass', { color: 0xb98b3c, metalness: 0.92, roughness: 0.28 });
mat('gold', { color: 0xd0a03c, metalness: 0.95, roughness: 0.22 });

mat('plaster', {
  map: canvasTex('plaster', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e6ddc8';
    ctx.fillRect(0, 0, w, h);
    const r = rng(31);
    for (let i = 0; i < 260; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 6 + r() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const light = r() > 0.5;
      g.addColorStop(0, light ? 'rgba(255,253,244,0.10)' : 'rgba(158,144,118,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 42; i++) {
      ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,248,0.07)' : 'rgba(146,132,108,0.07)';
      ctx.lineWidth = 6 + r() * 12;
      const y = r() * h;
      ctx.beginPath();
      ctx.moveTo(-10, y);
      ctx.quadraticCurveTo(w / 2, y + (r() - 0.5) * 44, w + 10, y + (r() - 0.5) * 16);
      ctx.stroke();
    }
    speckle(ctx, w, h, 2600, 0.05, 57, 1);
  }, 3, 2, { srgb: true }),
  roughness: 0.94, metalness: 0.0
});

mat('paper', {
  map: canvasTex('paper', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f7efdc';
    ctx.fillRect(0, 0, w, h);
    const r = rng(43);
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,250,0.05)' : 'rgba(180,164,132,0.05)';
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 14 + r() * 52, 14 + r() * 52, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 220; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = 3 + r() * 20;
      const a = r() * Math.PI;
      ctx.strokeStyle = `rgba(150,130,98,${0.04 + r() * 0.08})`;
      ctx.lineWidth = 0.5 + r() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    speckle(ctx, w, h, 1400, 0.04, 61, 1);
  }, 1, 1, { srgb: true }),
  roughness: 0.85, metalness: 0.0
});

/** Washi with a kumiko lattice painted in so a sh?ji shows a fine grid. */
const SHOJI_TEX = (() => {
  const draw = (ctx, w, h) => {
    ctx.fillStyle = '#f7eeda';
    ctx.fillRect(0, 0, w, h);
    const r = rng(67);
    for (let i = 0; i < 180; i++) {
      const x = r() * w;
      const y = r() * h;
      const len = 3 + r() * 16;
      const a = r() * Math.PI;
      ctx.strokeStyle = `rgba(152,132,100,${0.05 + r() * 0.07})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    const cell = w / 8;
    ctx.lineCap = 'round';
    for (let i = 0; i <= 8; i++) {
      const p = i * cell;
      const edge = i === 0 || i === 8;
      ctx.strokeStyle = edge ? 'rgba(58,40,24,0.50)' : 'rgba(58,40,24,0.34)';
      ctx.lineWidth = edge ? 5 : 3.2;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,252,240,0.22)';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(p + 2, 0); ctx.lineTo(p + 2, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p + 2); ctx.lineTo(w, p + 2); ctx.stroke();
    }
    // Soft contact shading where the paper meets each cell of the lattice.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const g = ctx.createRadialGradient(
          i * cell + cell / 2, j * cell + cell / 2, cell * 0.06,
          i * cell + cell / 2, j * cell + cell / 2, cell * 0.62
        );
        g.addColorStop(0, 'rgba(255,252,240,0.10)');
        g.addColorStop(1, 'rgba(150,128,94,0.09)');
        ctx.fillStyle = g;
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
    speckle(ctx, w, h, 1200, 0.035, 71, 1);
  };
  return { map: canvasTex('shoji', 256, 256, draw, 1, 1, { srgb: true }), emissiveMap: canvasTex('shojiEmis', 256, 256, draw, 1, 1, { srgb: true }) };
})();

mat('shojiPaper', {
  map: SHOJI_TEX.map, emissiveMap: SHOJI_TEX.emissiveMap,
  emissive: new THREE.Color(0xffd8a0), emissiveIntensity: 0.55,
  transparent: true, opacity: 0.85, roughness: 0.72, metalness: 0.0
});
mat('shojiPaperUnlit', {
  map: SHOJI_TEX.map, roughness: 0.78, metalness: 0.0,
  transparent: true, opacity: 0.85
});

mat('lampPaper', {
  map: canvasTex('lampPaper', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fdf1d6';
    ctx.fillRect(0, 0, w, h);
    const r = rng(83);
    for (let i = 0; i < 300; i++) {
      const x = r() * w;
      const y = r() * h;
      ctx.strokeStyle = `rgba(186,152,104,${0.03 + r() * 0.06})`;
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 26, y + (r() - 0.5) * 8);
      ctx.stroke();
    }
    speckle(ctx, w, h, 900, 0.03, 97, 1);
  }, 1, 1, { srgb: true }),
  emissiveMap: canvasTex('lampPaperE', 128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffcf92');
    g.addColorStop(0.5, '#fff0cf');
    g.addColorStop(1, '#ffc684');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 1, 1, { srgb: true }),
  emissive: new THREE.Color(0xffd6a0), emissiveIntensity: 0.9,
  roughness: 0.8, metalness: 0.0
});

mat('tatami', {
  map: canvasTex('tatami', 512, 512, (ctx, w, h) => {
    const r = rng(53);
    ctx.fillStyle = '#c9bd7c';
    ctx.fillRect(0, 0, w, h);
    // Soft tonal patches keep the weave from looking like a printed grid.
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 18 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, r() > 0.5 ? 'rgba(255,248,206,0.10)' : 'rgba(126,114,66,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // Reed weft: packed horizontal rows of individual rush strands.
    const rows = 64;
    const rh = h / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      const v = 0.5 + (r() - 0.5) * 0.34;
      ctx.fillStyle = toHex(196 * v + 26, 186 * v + 24, 120 * v + 18);
      ctx.fillRect(0, y, w, rh - 1.2);
      ctx.fillStyle = 'rgba(70,58,24,0.34)';
      ctx.fillRect(0, y + rh - 1.4, w, 1.4);
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,248,208,0.10)';
        ctx.fillRect(0, y + 0.6, w, 1.1);
      }
    }
    // Warp: faint vertical binder threads.
    for (let i = 0; i < 6; i++) {
      const x = (i + 0.5) * (w / 6);
      ctx.fillStyle = 'rgba(150,136,78,0.16)';
      ctx.fillRect(x, 0, 3, h);
    }
    speckle(ctx, w, h, 5200, 0.06, 101, 1.1);
  }, 2, 5, { srgb: true }),
  roughness: 0.95, metalness: 0.0
});

mat('heri', {
  map: canvasTex('heri', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#26241f';
    ctx.fillRect(0, 0, w, h);
    const r = rng(19);
    for (let i = 0; i < 128; i += 2) {
      ctx.fillStyle = i % 8 === 0 ? 'rgba(190,172,132,0.16)' : 'rgba(160,146,112,0.07)';
      ctx.fillRect(i, 0, 1, h);
    }
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(255,240,200,${0.02 + r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 1, 1 + r() * 2);
    }
    speckle(ctx, w, h, 500, 0.05, 103, 1);
  }, 4, 1, { srgb: true }),
  roughness: 0.9, metalness: 0.02
});

mat('fabricZabuton', {
  map: canvasTex('fabricZabuton', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7c2f2c';
    ctx.fillRect(0, 0, w, h);
    const r = rng(89);
    for (let y = 0; y < h; y += 2) {
      ctx.strokeStyle = y % 4 === 0 ? 'rgba(255,225,205,0.09)' : 'rgba(40,10,8,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
    }
    for (let x = 0; x < w; x += 3) {
      ctx.fillStyle = 'rgba(255,225,205,0.045)';
      ctx.fillRect(x, 0, 1, h);
    }
    // A woven lattice of slightly darker threads gives the cloth its tooth.
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,220,200,0.05)' : 'rgba(30,8,6,0.07)';
      ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 1);
    }
    speckle(ctx, w, h, 2200, 0.05, 107, 1);
  }, 4, 4, { srgb: true }),
  roughness: 0.92, metalness: 0.0
});

mat('fabricNavy', {
  map: canvasTex('fabricNavy', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c2c4a';
    ctx.fillRect(0, 0, w, h);
    const r = rng(109);
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(200,220,255,0.06)' : 'rgba(0,4,16,0.10)';
      ctx.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 3) {
      ctx.fillStyle = 'rgba(200,220,255,0.035)';
      ctx.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '210,225,255' : '8,14,30'},${0.03 + r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 2, 1);
    }
  }, 6, 6, { srgb: true }),
  roughness: 0.88, metalness: 0.0
});

mat('fabricWarm', {
  map: canvasTex('fabricWarm', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8a6c3c';
    ctx.fillRect(0, 0, w, h);
    const r = rng(113);
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(255,240,200,0.08)' : 'rgba(50,32,8,0.09)';
      ctx.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,236,196,0.05)' : 'rgba(40,24,6,0.06)';
      ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 1);
    }
  }, 5, 5, { srgb: true }),
  roughness: 0.9, metalness: 0.0
});

mat('rope', {
  map: canvasTex('rope', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#baa068';
    ctx.fillRect(0, 0, w, h);
    const r = rng(127);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(96,76,40,0.28)' : 'rgba(248,232,190,0.22)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      const y0 = (i / 40) * h;
      ctx.moveTo(0, y0);
      ctx.lineTo(w, y0 + h / 40);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '250,236,196' : '110,88,48'},${0.06 + r() * 0.10})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    }
  }, 3, 3, { srgb: true }),
  roughness: 0.95, metalness: 0.0
});

mat('porcelain', { color: 0xf4f1e8, metalness: 0.0, roughness: 0.16 });

mat('ceramicCream', {
  map: canvasTex('ceramicCream', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#eae1cd';
    ctx.fillRect(0, 0, w, h);
    const r = rng(131);
    for (let i = 0; i < 90; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 4 + r() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, r() > 0.5 ? 'rgba(255,255,250,0.10)' : 'rgba(150,132,100,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    speckle(ctx, w, h, 700, 0.05, 137, 1);
  }, 2, 2, { srgb: true }),
  roughness: 0.32, metalness: 0.0
});

function glazeMat(name, base, blotch, seed) {
  const key = `glaze_${name}`;
  return mat(key, {
    map: canvasTex(key, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const r = rng(seed);
      for (let i = 0; i < 120; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 3 + r() * 18;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${blotch},${0.05 + r() * 0.13})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      // Fine crazing — the hairline cracks of a real glaze.
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 22; i++) {
        ctx.strokeStyle = `rgba(70,58,42,${0.05 + r() * 0.10})`;
        ctx.beginPath();
        let x = r() * w;
        let y = r() * h;
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
          x += (r() - 0.5) * 26;
          y += (r() - 0.5) * 26;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      speckle(ctx, w, h, 600, 0.05, seed + 7, 1);
    }, 2, 2, { srgb: true }),
    roughness: 0.26, metalness: 0.0
  });
}

glazeMat('indigo', '#2b3f60', '220,232,255', 149);
glazeMat('celadon', '#9dc3ab', '255,255,255', 151);
glazeMat('white', '#f2efe6', '150,140,120', 157);
glazeMat('brown', '#6a452e', '240,205,160', 163);

mat('soil', { color: 0x35281c, roughness: 0.98, metalness: 0.0 });
mat('pineDark', { color: 0x243d21, roughness: 0.88, metalness: 0.0 });
mat('leaf', { color: 0x3c6b2c, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide, flatShading: true });
mat('leafBright', { color: 0x548a33, roughness: 0.68, metalness: 0.0, side: THREE.DoubleSide, flatShading: true });
mat('bambooGreen', {
  map: canvasTex('bambooGreen', 64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#6f9a44';
    ctx.fillRect(0, 0, w, h);
    const r = rng(167);
    for (let x = 0; x < w; x += 3) {
      ctx.fillStyle = x % 6 === 0 ? 'rgba(232,246,190,0.10)' : 'rgba(40,70,20,0.10)';
      ctx.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '230,246,190' : '40,66,20'},${0.05 + r() * 0.08})`;
      ctx.fillRect(r() * w, r() * h, 1, 4 + r() * 22);
    }
  }, 2, 1, { srgb: true }),
  roughness: 0.62, metalness: 0.02
});
mat('neonDark', { color: 0x14161a, metalness: 0.35, roughness: 0.55 });
mat('bottleGreen', { color: 0x2f5230, metalness: 0.1, roughness: 0.24, transparent: true, opacity: 0.99 });
mat('bottleAmber', { color: 0x7a4a18, metalness: 0.1, roughness: 0.22, transparent: true, opacity: 0.99 });
mat('bottleClear', { color: 0xd7e2e0, metalness: 0.1, roughness: 0.14, transparent: true, opacity: 0.97 });

/* --- 2c. text / sign textures ---------------------------------------- */

/** The only font stack used for Japanese text — no web fonts are loaded. */
const JP_FONT = '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';

/**
 * Draw Japanese text centred on (cx, cy).
 * @param {object} o { text, color, size, x, y, vertical, align, stroke, strokeWidth, alpha }
 */
function drawJPText(ctx, o) {
  const size = o.size;
  const chars = Array.from(String(o.text == null ? '' : o.text));
  if (!chars.length || !(size > 0)) return;
  ctx.save();
  ctx.font = `${o.weight || '700'} ${size}px ${JP_FONT}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = o.color || '#f5f0e2';
  if (o.stroke) {
    ctx.lineWidth = o.strokeWidth || 2;
    ctx.strokeStyle = o.stroke;
    ctx.lineJoin = 'round';
  }
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  if (o.vertical) {
    const step = size * 1.12;
    const top = o.y - ((chars.length - 1) * step) / 2;
    for (let i = 0; i < chars.length; i++) {
      if (o.stroke) ctx.strokeText(chars[i], o.x, top + i * step);
      ctx.fillText(chars[i], o.x, top + i * step);
    }
  } else {
    const step = size * 1.06;
    const left = o.x - ((chars.length - 1) * step) / 2;
    for (let i = 0; i < chars.length; i++) {
      if (o.stroke) ctx.strokeText(chars[i], left + i * step, o.y);
      ctx.fillText(chars[i], left + i * step, o.y);
    }
  }
  ctx.restore();
}

/** A tapered brush stroke: a polyline swept with a brush-shaped line width. */
function brushStroke(ctx, pts, width, seed, color) {
  const segs = 14;
  const r = rng(seed);
  let x0 = pts[0][0];
  let y0 = pts[0][1];
  const jitter = [];
  for (let i = 0; i <= segs; i++) jitter.push((r() - 0.5) * width * 0.12);
  for (let i = 1; i < pts.length; i++) {
    const x1 = pts[i][0];
    const y1 = pts[i][1];
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const mt = 1 - t;
      const px = mt * mt * x0 + 2 * mt * t * ((x0 + x1) / 2) + t * t * x1;
      const py = mt * mt * y0 + 2 * mt * t * ((y0 + y1) / 2) + t * t * y1;
      ctx.beginPath();
      ctx.moveTo(px - width * 0.32, py + 0.5);
      ctx.lineTo(px + width * 0.32, py + 0.5);
      ctx.lineWidth = width * (0.24 + 0.94 * Math.sin(Math.PI * clamp(t, 0.02, 0.98)));
      ctx.strokeStyle = color;
      ctx.stroke();
      if (jitter[s] !== 0) {
        ctx.beginPath();
        ctx.moveTo(px, py + jitter[s]);
        ctx.lineTo(px + width * 0.18, py + jitter[s]);
        ctx.lineWidth = width * 0.5;
        ctx.globalAlpha = 0.22;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    x0 = x1;
    y0 = y1;
  }
}

/* ------------------------------------------------------------------ *
 * 3. Geometry helpers
 * ------------------------------------------------------------------ */

const GEO = new Map();

/** Bake real-world size into the UVs so grain never reads as stretched. */
function scaleUV(geometry, sx, sy) {
  const uv = geometry.attributes && geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Cached box with UVs scaled to a metre grid, so wood grain stays 1:1. */
function boxGeo(w, h, d, texScale) {
  const s = texScale || 0.55;
  const key = `B${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${s}`;
  const hit = GEO.get(key);
  if (hit) return hit;
  const g = scaleUV(new THREE.BoxGeometry(w, h, d), w * s, h * s);
  GEO.set(key, g);
  return g;
}

/** Cached box with an asymmetric vertex displacement (cloth wave, leaves). */
function waveBoxGeo(w, h, d, ws, hs, amp, waves, phase, flipDown) {
  const key = `W${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${ws},${hs},${amp.toFixed(4)},${waves},${phase.toFixed(3)},${flipDown ? 1 : 0}`;
  const hit = GEO.get(key);
  if (hit) return hit;
  const g = new THREE.BoxGeometry(w, h, d, ws, hs, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = w > 1e-6 ? (x + w / 2) / w : 0.5;
    const v = h > 1e-6 ? (y + h / 2) / h : 0.5;
    const s = Math.sin(u * Math.PI * 2 * waves + phase);
    pos.setZ(i, pos.getZ(i) + s * amp * (0.25 + 0.75 * clamp(v, 0, 1)));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  if (flipDown) {
    // Three.js box UVs put the -Y face on the same tile as the +Y face, so
    // e.g. a table top would show its grain mirrored. Flip that face only.
    const uv = g.attributes.uv;
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (n.getY(i) < -0.5) uv.setY(i, 1 - uv.getY(i));
    }
    uv.needsUpdate = true;
  }
  GEO.set(key, g);
  return g;
}

/**
 * Cached rounded box with bevelled edges.
 *
 * Built as a (w x depth) rounded rect in the shape plane, extruded along Z by
 * `thickness` and then rotated so the extrusion axis becomes world +Y. The
 * result is exactly w (X) by thickness (Y) by depth (Z), so a table top lies
 * flat with its grain on the horizontal faces instead of standing on edge.
 *
 * ExtrudeGeometry grows the outline outward by bevelSize on every side, so both
 * the shape and the extrusion are inset to keep the final bounding box exact —
 * a prop's bounding box defines its on-floor placement, so it must be exact.
 */
function roundGeo(w, depth, thickness, rIn, seed) {
  const key = `R${w.toFixed(4)},${depth.toFixed(4)},${thickness.toFixed(4)},${(rIn == null ? 0.02 : rIn).toFixed(4)},${seed || 0}`;
  const hit = GEO.get(key);
  if (hit) return hit;

  const bevel = Math.min(Math.min(w, depth) * 0.06, thickness * 0.3, 0.006);
  const sw = w - bevel * 2;
  const sd = depth - bevel * 2;
  const r = Math.min(rIn == null ? 0.02 : rIn, sw / 2 - 1e-4, sd / 2 - 1e-4);

  let geometry;
  if (r <= 1e-4 || sw <= 1e-4 || sd <= 1e-4) {
    geometry = scaleUV(new THREE.BoxGeometry(w, thickness, depth), w * 0.55, depth * 0.55);
  } else {
    const shape = new THREE.Shape();
    const x0 = -sw / 2;
    const y0 = -sd / 2;
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x0 + sw - r, y0);
    shape.quadraticCurveTo(x0 + sw, y0, x0 + sw, y0 + r);
    shape.lineTo(x0 + sw, y0 + sd - r);
    shape.quadraticCurveTo(x0 + sw, y0 + sd, x0 + sw - r, y0 + sd);
    shape.lineTo(x0 + r, y0 + sd);
    shape.quadraticCurveTo(x0, y0 + sd, x0, y0 + sd - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);
    const ext = Math.max(thickness - bevel * 2, 1e-3);
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: ext,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 6,
      steps: 1
    });
    // ExtrudeGeometry writes raw shape-space UVs; normalise to 0..1 so the
    // shared wood textures keep a consistent density on every prop.
    const uv = geometry.attributes.uv;
    const su = 1 / Math.max(w, 1e-4);
    const sv = 1 / Math.max(depth, 1e-4);
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) + w / 2) * su, (uv.getY(i) + depth / 2) * sv);
    }
    uv.needsUpdate = true;
    geometry.translate(0, 0, -ext / 2);
    geometry.rotateX(-Math.PI / 2);
  }
  GEO.set(key, geometry);
  return geometry;
}

/** Bowl / cup / vase silhouette revolved around Y (object sits on y = 0). */
function latheGeo(pts, seg) {
  const key = `L${pts.map((p) => `${p[0].toFixed(4)}_${p[1].toFixed(4)}`).join('|')}_${seg}`;
  const hit = GEO.get(key);
  if (hit) return hit;
  const points = pts.map((p) => new THREE.Vector2(Math.max(p[0], 1e-4), p[1]));
  const g = new THREE.LatheGeometry(points, seg);
  GEO.set(key, g);
  return g;
}

/* ------------------------------------------------------------------ *
 * 4. Group / mesh assembly helpers
 * ------------------------------------------------------------------ */

/** World-space bounding box of every mesh under `group` (group must be at the origin). */
function measureBounds(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const bb = new THREE.Box3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(bb);
  });
  return box;
}

/**
 * Guarantee the contract position: min Y exactly 0 and (when asked) a bounding
 * box centred on the origin in X and Z. Only the direct children's transforms
 * move — geometries stay shared with every other instance of the same prop.
 * @returns {THREE.Box3} the corrected world bounds
 */
function normalizePlacement(group, centerX, centerZ) {
  for (let pass = 0; pass < 2; pass++) {
    const box = measureBounds(group);
    if (box.isEmpty()) return box;
    const dx = centerX ? (box.min.x + box.max.x) / 2 : 0;
    const dz = centerZ ? (box.min.z + box.max.z) / 2 : 0;
    const dy = box.min.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9) return box;
    for (const child of group.children) {
      child.position.set(child.position.x - dx, child.position.y - dy, child.position.z - dz);
    }
  }
  return measureBounds(group);
}

/** Tag a built prop with its contract metadata and derive exact bounds. */
function finishProp(group, id, sink, place) {
  const p = place || {};
  const box = normalizePlacement(group, p.centerX !== false, p.centerZ !== false);
  const size = new THREE.Vector3();
  if (box.isEmpty()) size.set(0, 0, 0);
  else box.getSize(size);

  group.userData.role = id;
  group.userData.bounds = { x: size.x, y: size.y, z: size.z };
  if (sink) {
    sink.minY = box.isEmpty() ? 0 : box.min.y;
    sink.maxY = box.isEmpty() ? 0 : box.max.y;
    sink.minX = box.isEmpty() ? 0 : box.min.x;
    sink.maxX = box.isEmpty() ? 0 : box.max.x;
    sink.minZ = box.isEmpty() ? 0 : box.min.z;
    sink.maxZ = box.isEmpty() ? 0 : box.max.z;
  }
  return group;
}

/**
 * True when a surface is visually solid enough to throw a real shadow.
 * Only the two translucent washi sheets (shōji paper, andon lamp paper) opt
 * out: they still receive shadows, but a solid shadow volume clipped out of a
 * backlit translucent sheet reads worse than no shadow. Every opaque mesh —
 * including the alpha-cut glyph decals and the glass bottles — casts.
 */
const NO_CAST = new Set(['shojiPaper', 'lampPaper']);

function addShadowFlags(mesh) {
  const name = mesh.material && mesh.material.name;
  mesh.castShadow = !NO_CAST.has(name);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Add a mesh with the contract shadow flags: every opaque mesh casts and
 * receives, translucent washi sheets receive without casting.
 */
function addMesh(group, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  addShadowFlags(m);
  group.add(m);
  return m;
}

/** Balance a prop's footprint: after Y is settled, anything sticking out on one
 * side (a counter's foot rail, a fridge handle) would push the bounding box off
 * the origin, so every direct child is shifted back onto the centre.
 */
function symmetrizeXZ(group) {
  for (let pass = 0; pass < 2; pass++) {
    const box = measureBounds(group);
    if (box.isEmpty()) return box;
    const dx = (box.min.x + box.max.x) / 2;
    const dz = (box.min.z + box.max.z) / 2;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return box;
    for (const child of group.children) {
      child.position.set(child.position.x - dx, child.position.y, child.position.z - dz);
    }
  }
  return measureBounds(group);
}

/**
 * Mesh positioned by its centre plus Euler rotation (same shadow rule as
 * addMesh).
 */
function addMeshE(group, geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = addMesh(group, geometry, material, x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** Grid of thin bars (sh?ji kumiko, counter slats, shelf braces). */
function addLattice(group, o) {
  const bw = o.barW == null ? 0.018 : o.barW;
  const bd = o.barD == null ? 0.012 : o.barD;
  const y = o.y + o.h / 2;
  for (let i = 0; i <= o.cols; i++) {
    const x = o.x - o.w / 2 + (i * o.w) / o.cols;
    addMesh(group, boxGeo(bw, o.h, bd, 1.2), o.mat, x, y, o.z);
  }
  for (let j = 0; j <= o.rows; j++) {
    const yy = o.y + (j * o.h) / o.rows;
    addMesh(group, boxGeo(o.w, bw, bd, 1.2), o.mat, o.x, yy, o.z);
  }
}

/* ------------------------------------------------------------------ *
 * 5. ROOM SHELL
 * ------------------------------------------------------------------ */

/**
 * Interlocking plank floor. Extruded slab with a bevelled edge; the plank
 * seams, per-plank tone variation and grain live in the procedural texture.
 * Centred on X/Z, min Y = 0, +Y face is the walking surface.
 * @param {{w?:number,h?:number}} [opts] w along X, h along Z
 */
export function makeWoodFloor(opts = {}) {
  const w = Math.max(0.1, num(opts.w, 4));
  const h = Math.max(0.1, num(opts.h, 4));
  const g = new THREE.Group();
  g.userData.builder = 'makeWoodFloor';
  const sink = {};
  // One slab: the plank layout, seams, per-plank tone and grain all come from
  // the tiling floor texture, and the texture repeats 3x per metre so the
  // plank pitch stays around 8 cm at any room size.
  addMesh(g, roundGeo(w, h, 0.05, Math.min(0.02, w / 8, h / 8)), mat('floorWood'), 0, 0.025, 0);
  return finishProp(g, 'woodFloor', sink);
}

/**
 * Tatami mat: woven rush surface with a dark heri cloth border on the two
 * short ends (as specified), subtle thickness. Centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number}} [opts] w along X (short end), h along Z
 */
export function makeTatami(opts = {}) {
  const w = Math.max(0.2, num(opts.w, 0.9));
  const h = Math.max(0.2, num(opts.h, 1.8));
  const th = 0.055;
  const heriW = Math.min(0.07, w * 0.12, h * 0.3);
  const heriHalf = heriW / 2;
  const g = new THREE.Group();
  g.userData.builder = 'makeTatami';
  const sink = {};
  // Heri frame first (it is the footprint), mat surface laid on top of it.
  const railD = h - heriW;
  addMesh(g, boxGeo(heriW, th, railD, 2.2), mat('heri'), -(w - heriW) / 2, th / 2, 0);
  addMesh(g, boxGeo(heriW, th, railD, 2.2), mat('heri'), (w - heriW) / 2, th / 2, 0);
  addMesh(g, boxGeo(w, th, heriW, 2.2), mat('heri'), 0, th / 2, -(h - heriW) / 2);
  addMesh(g, boxGeo(w, th, heriW, 2.2), mat('heri'), 0, th / 2, (h - heriW) / 2);
  // Rush surface — a couple of millimetres proud of the cloth so the heri
  // reads as a border rather than a painted stripe. UVs are baked to the
  // same 1-tile-per-metre grid every other prop uses.
  const matGeo = scaleUV(new THREE.PlaneGeometry(w - heriHalf, h - heriW), w - heriHalf, h - heriW);
  matGeo.rotateX(-Math.PI / 2);
  addMesh(g, matGeo, mat('tatami'), 0, th + 0.0015, 0, false);
  return finishProp(g, 'tatami', sink);
}

/**
 * Shikkui plaster wall panel with trowel texture and a wooden nageshi
 * baseboard along the bottom. Centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number,d?:number}} [opts]
 */
export function makeWall(opts = {}) {
  const w = Math.max(0.2, num(opts.w, 4));
  const h = Math.max(0.2, num(opts.h, 2.6));
  const d = Math.max(0.04, num(opts.d, 0.12));
  const bbH = Math.min(0.11, h * 0.1);
  const g = new THREE.Group();
  g.userData.builder = 'makeWall';
  const sink = {};
  addMesh(g, boxGeo(w, h, d, 0.6), mat('plaster'), 0, h / 2, 0);
  addMesh(g, boxGeo(w, bbH, d + 0.035, 1.1), mat('woodDark'), 0, bbH / 2, 0);
  return finishProp(g, 'wall', sink);
}

/**
 * Wooden pillar with visible grain and a darker foot block.
 * Centred on X/Z, min Y = 0.
 * @param {{h?:number,r?:number}} [opts] r = half-width of the post
 */
export function makePillar(opts = {}) {
  const h = Math.max(0.3, num(opts.h, 2.6));
  const r = clamp(num(opts.r, 0.09), 0.02, 0.5);
  const footH = Math.min(0.09, h * 0.06);
  const g = new THREE.Group();
  g.userData.builder = 'makePillar';
  const sink = {};
  addMesh(g, new THREE.CylinderGeometry(r, r * 1.03, h, 20, 1), mat('woodWarm'), 0, h / 2, 0);
  addMesh(g, new THREE.CylinderGeometry(r * 1.16, r * 1.24, footH, 20, 1), mat('woodDeep'), 0, footH / 2, 0);
  const cap = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.02, 20, 1);
  addMesh(g, cap, mat('woodDeep'), 0, h - 0.01, 0);
  return finishProp(g, 'pillar', sink);
}

/**
 * Ceiling beam. Height h is along Y, w along Z; the beam runs along X.
 * Centred on X/Z, min Y = 0.
 * @param {{len?:number,w?:number,h?:number}} [opts]
 */
export function makeBeam(opts = {}) {
  const len = Math.max(0.2, num(opts.len, 4));
  const w = Math.max(0.03, num(opts.w, 0.14));
  const h = Math.max(0.03, num(opts.h, 0.16));
  const g = new THREE.Group();
  g.userData.builder = 'makeBeam';
  const sink = {};
  addMesh(g, roundGeo(len, w, h, 0.014), mat('woodWarm'), 0, h / 2, 0);
  return finishProp(g, 'beam', sink);
}

/**
 * Wooden slat ceiling: thin boards running along Z over exposed rafters
 * running along X. Centred on X/Z, min Y = 0 (bottom of the rafters).
 * @param {{w?:number,d?:number}} [opts]
 */
export function makeCeiling(opts = {}) {
  const w = Math.max(0.5, num(opts.w, 8));
  const d = Math.max(0.5, num(opts.d, 8));
  const slatW = 0.068;
  const gap = 0.012;
  const pitch = slatW + gap;
  const rafters = Math.max(2, Math.round(d / 0.75));
  const g = new THREE.Group();
  g.userData.builder = 'makeCeiling';
  const sink = {};

  const count = Math.max(1, Math.floor(w / pitch));
  const slatGeo = boxGeo(slatW, 0.028, d - 0.02, 1.6);
  const start = -((count - 1) * pitch) / 2;
  for (let i = 0; i < count; i++) {
    // Two tone classes instead of two materials: same draw calls, more life.
    addMesh(g, slatGeo, i % 6 === 0 ? mat('woodDark') : mat('woodWarm'), start + i * pitch, 0.078, 0);
  }

  const rafterGeo = roundGeo(w - 0.04, 0.070, 0.070, 0.012);
  for (let i = 0; i < rafters; i++) {
    const z = -d / 2 + ((i + 0.5) * d) / rafters;
    addMesh(g, rafterGeo, mat('woodDark'), 0, 0.035, z);
  }
  return finishProp(g, 'ceiling', sink);
}

/**
 * Sliding sh?ji screen: wooden frame, two panels, each with a kumiko grid and
 * translucent washi paper (optionally backlit).
 *
 * NOTE ON BOUNDS: the sliding panel never leaves the frame, and the frame is
 * symmetric, so the Group stays centred on X/Z for every `open` value.
 * min Y = 0.
 *
 * @param {{w?:number,h?:number,open?:number,lit?:boolean}} [opts]
 */
export function makeShoji(opts = {}) {
  const w = Math.max(0.3, num(opts.w, 0.9));
  const h = Math.max(0.3, num(opts.h, 1.8));
  const open = clamp(num(opts.open, 0), 0, 1);
  const lit = opts.lit !== false;
  const t = 0.035;
  const rail = Math.min(0.055, h * 0.05);
  const stile = Math.min(0.045, w * 0.05);
  const panelH = h - rail * 2;
  const panelW = w / 2;
  const paper = lit ? mat('shojiPaper') : mat('shojiPaperUnlit');
  const g = new THREE.Group();
  g.userData.builder = 'makeShoji';
  const sink = {};

  // Outer frame.
  addMesh(g, roundGeo(w, t, rail, 0.008), mat('woodDeep'), 0, rail / 2, 0);
  addMesh(g, roundGeo(w, t, rail, 0.008), mat('woodDeep'), 0, h - rail / 2, 0);
  addMesh(g, roundGeo(stile, t, h - rail * 2, 0.008), mat('woodDeep'), -(w / 2 - stile / 2), h / 2, 0);
  addMesh(g, roundGeo(stile, t, h - rail * 2, 0.008), mat('woodDeep'), (w / 2 - stile / 2), h / 2, 0);
  // Centre rail in front of the two tracks.
  addMesh(g, roundGeo(0.032, 0.016, h - rail * 2, 0.006), mat('woodDeep'), 0, h / 2, t / 2 - 0.004);

  // Paper sits behind the kumiko bars so the grid casts onto it.
  addMesh(g, boxGeo(panelW - 0.02, panelH - 0.02, 0.006, 2.2), paper, -panelW / 2, rail + panelH / 2, -0.006, false);
  addMesh(g, boxGeo(panelW - 0.02, panelH - 0.02, 0.006, 2.2), paper, panelW / 2, rail + panelH / 2, -0.018, false);

  const barW = 0.014;
  const zFront = t / 2 - 0.008;
  addLattice(g, { x: -panelW / 2, y: rail + 0.02, z: zFront, w: panelW - 0.02, h: panelH - 0.04, cols: 4, rows: 7, barW, barD: 0.010, mat: mat('woodDark') });
  // Sliding panel: travels inside the frame so the bounds stay symmetric.
  const slide = -open * w * 0.40;
  addLattice(g, { x: panelW / 2 + slide, y: rail + 0.02, z: t / 2 - 0.02, w: panelW - 0.02, h: panelH - 0.04, cols: 4, rows: 7, barW, barD: 0.010, mat: mat('woodDark') });
  return finishProp(g, 'shoji', sink);
}

/**
 * Split hanging curtain (noren): 4 fabric panels with gaps, a gentle sine
 * wave across the cloth, white characters reading down the centre.
 *
 * The rod sits at y = h; min Y = 0 (the hem). Centred on X/Z.
 * @param {{w?:number,h?:number,text?:string,color?:string}} [opts]
 */
export function makeNoren(opts = {}) {
  const w = Math.max(0.3, num(opts.w, 1.2));
  const h = Math.max(0.2, num(opts.h, 0.5));
  const text = opts.text == null ? 'らーめん' : String(opts.text);
  const color = opts.color || '#1b3a6b';
  const panels = clamp(num(opts.panels, Math.max(3, Math.min(4, Math.round(w / 0.3)))), 2, 6);

  const gap = 0.016;
  const panelW = Math.max(0.06, (w - gap * (panels - 1)) / panels);

  const fabric = mat('norenFabric', {
    map: canvasTex('norenFabric', 128, 128, (ctx, cw, ch) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, cw, ch);
      const r = rng(173);
      for (let y = 0; y < ch; y += 2) {
        ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
        ctx.fillRect(0, y, cw, 1);
      }
      for (let x = 0; x < cw; x += 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(x, 0, 1, ch);
      }
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.05})`;
        ctx.fillRect(r() * cw, r() * ch, 3, 1);
      }
    }, 5, 4, { srgb: true }),
    roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide
  });

  const g = new THREE.Group();
  g.userData.builder = 'makeNoren';
  const sink = {};

  // Hanging rod with turned end caps.
  const rod = new THREE.CylinderGeometry(0.014, 0.014, w + 0.05, 12, 1);
  rod.rotateZ(Math.PI / 2);
  addMesh(g, rod, mat('woodDeep'), 0, h + 0.014, 0);
  addMeshE(g, new THREE.ConeGeometry(0.018, 0.03, 10), mat('woodDeep'), -(w / 2 + 0.032), h + 0.014, 0, 0, 0, Math.PI / 2);
  addMeshE(g, new THREE.ConeGeometry(0.018, 0.03, 10), mat('woodDeep'), (w / 2 + 0.032), h + 0.014, 0, 0, 0, -Math.PI / 2);

  // Cloth panels: one per character column, each with its own sine phase so
  // the hem ripples instead of hanging as a flat plane.
  const clothH = h - 0.02;
  const totalW = panels * panelW + gap * (panels - 1);
  for (let i = 0; i < panels; i++) {
    const x = -totalW / 2 + panelW / 2 + i * (panelW + gap);
    const geo = waveBoxGeo(panelW, clothH, 0.006, 3, 6, 0.012, 0.6, i * 0.9);
    addMesh(g, geo, fabric, x, clothH / 2, 0);
  }

  // White text ribbon, wave-matched to the cloth so it stays glued to it.
  const textTexKey = `norenText_${text.slice(0, 24)}_${panels}`;
  const textMat = mat('norenTextMat', {
    map: canvasTex(textTexKey, 64 * panels, 256, (ctx, cw, chh) => {
      ctx.clearRect(0, 0, cw, chh);
      ctx.lineJoin = 'round';
      const chars = Array.from(text);
      for (let i = 0; i < panels; i++) {
        const ch2 = chars[i];
        if (!ch2) continue;
        drawJPText(ctx, {
          text: ch2, color: 'rgba(246,243,232,0.97)', stroke: 'rgba(18,22,32,0.30)', strokeWidth: 3,
          size: 148, x: i * 64 + 32, y: chh / 2, vertical: false
        });
      }
    }, 1, 1),
    roughness: 0.9, metalness: 0.0,
    side: THREE.DoubleSide, alphaTest: 0.35
  });
  for (let i = 0; i < panels; i++) {
    if (!Array.from(text)[i]) continue;
    const x = -totalW / 2 + panelW / 2 + i * (panelW + gap);
    const geo = waveBoxGeo(panelW, clothH, 0.002, 3, 6, 0.012, 0.6, i * 0.9);
    addMesh(g, geo, textMat, x, clothH / 2, 0.007, false);
  }
  return finishProp(g, 'noren', sink);
}

/**
 * Wooden veranda deck (engawa): board deck with a nosing beam and short feet.
 * Centred on X/Z, min Y = 0.
 * @param {{len?:number,w?:number}} [opts] len along X, w along Z
 */
export function makeEngawa(opts = {}) {
  const len = Math.max(0.5, num(opts.len, 3));
  const w = Math.max(0.3, num(opts.w, 0.9));
  const top = 0.055;
  const g = new THREE.Group();
  g.userData.builder = 'makeEngawa';
  const sink = {};

  const boards = Math.max(3, Math.round(w / 0.075));
  const bd = (w - 0.01 * (boards - 1)) / boards;
  const boardGeo = boxGeo(len - 0.02, top, bd, 1.4);
  for (let i = 0; i < boards; i++) {
    const z = -w / 2 + bd / 2 + i * (bd + 0.01);
    addMesh(g, boardGeo, i % 5 === 0 ? mat('woodDark') : mat('deckWood'), 0, top / 2, z);
  }
  addMesh(g, roundGeo(len, 0.075, 0.05, 0.01), mat('woodDark'), 0, 0.02, w / 2 - 0.037);
  addMesh(g, roundGeo(len, 0.05, 0.075, 0.01), mat('woodDark'), 0, 0.02, -(w / 2 - 0.037));
  const feet = Math.max(2, Math.round(len / 1.2));
  const footGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.02, 10, 1);
  for (let i = 0; i < feet; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / feet;
    addMesh(g, footGeo, mat('woodDeep'), x, 0.012, w / 2 - 0.06);
    addMesh(g, footGeo, mat('woodDeep'), x, 0.012, -(w / 2 - 0.06));
  }
  return finishProp(g, 'engawa', sink);
}

/* ------------------------------------------------------------------ *
 * 6. FURNITURE
 * ------------------------------------------------------------------ */

/**
 * Low Japanese table: thick rounded top on four short legs.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,d?:number,h?:number}} [opts]
 */
export function makeChabudai(opts = {}) {
  const w = Math.max(0.3, num(opts.w, 1.2));
  const d = Math.max(0.3, num(opts.d, 0.75));
  const h = Math.max(0.16, num(opts.h, 0.32));
  const top = Math.min(0.045, h * 0.2);
  const inset = Math.min(w, d) * 0.09;
  const g = new THREE.Group();
  g.userData.builder = 'makeChabudai';
  const sink = {};
  addMesh(g, roundGeo(w, d, top, Math.min(0.02, top * 0.45), 1), mat('woodWarm'), 0, h - top / 2, 0);
  const legH = h - top;
  const legGeo = boxGeo(0.055, legH, 0.055, 2.0);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? -1 : 1;
    const sz = i % 2 === 0 ? -1 : 1;
    addMesh(g, legGeo, mat('woodDark'), sx * (w / 2 - inset), legH / 2, sz * (d / 2 - inset));
  }
  return finishProp(g, 'chabudai', sink);
}

/**
 * Floor cushion: tufted button in the middle, piped edge.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,d?:number}} [opts]
 */
export function makeZabuton(opts = {}) {
  const w = Math.max(0.2, num(opts.w, 0.55));
  const d = Math.max(0.2, num(opts.d, 0.55));
  const th = 0.085;
  const g = new THREE.Group();
  g.userData.builder = 'makeZabuton';
  const sink = {};
  // Piping (a slightly larger rounded slab) peeking out under the cushion.
  addMesh(g, roundGeo(w, d, th * 0.45, Math.min(0.05, w * 0.12), 2), mat('fabricNavy'), 0, th * 0.225, 0);
  addMesh(g, roundGeo(w - 0.03, d - 0.03, th, Math.min(0.055, w * 0.14), 3), mat('fabricZabuton'), 0, th / 2 + 0.012, 0);
  const button = new THREE.CylinderGeometry(0.028, 0.032, 0.012, 14, 1);
  addMesh(g, button, mat('woodDeep'), 0, th + 0.018, 0);
  return finishProp(g, 'zabuton', sink);
}

/**
 * Dining table: wooden top and four legs with cross braces.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,d?:number,h?:number}} [opts]
 */
export function makeTable(opts = {}) {
  const w = Math.max(0.4, num(opts.w, 1.2));
  const d = Math.max(0.4, num(opts.d, 0.8));
  const h = Math.max(0.4, num(opts.h, 0.72));
  const topT = 0.042;
  const legH = h - topT;
  const leg = 0.062;
  const inset = Math.min(w, d) * 0.08;
  const g = new THREE.Group();
  g.userData.builder = 'makeTable';
  const sink = {};
  addMesh(g, roundGeo(w, d, topT, Math.min(0.016, topT * 0.4), 1), mat('woodWarm'), 0, h - topT / 2, 0);
  // Apron ties the legs together visually.
  addMesh(g, boxGeo(w - inset * 2, 0.05, 0.026, 1.6), mat('woodDark'), 0, h - topT - 0.03, d / 2 - inset);
  addMesh(g, boxGeo(w - inset * 2, 0.05, 0.026, 1.6), mat('woodDark'), 0, h - topT - 0.03, -(d / 2 - inset));
  const legGeo = boxGeo(leg, legH, leg, 1.8);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? -1 : 1;
    const sz = i % 2 === 0 ? -1 : 1;
    addMesh(g, legGeo, mat('woodDark'), sx * (w / 2 - inset), legH / 2, sz * (d / 2 - inset));
  }
  // Cross braces low on the legs.
  const by = legH * 0.28;
  addMesh(g, boxGeo(w - inset * 2, 0.028, 0.022, 1.6), mat('woodDark'), 0, by, d / 2 - inset);
  addMesh(g, boxGeo(w - inset * 2, 0.028, 0.022, 1.6), mat('woodDark'), 0, by, -(d / 2 - inset));
  addMesh(g, boxGeo(0.022, 0.028, d - inset * 2, 1.6), mat('woodDark'), w / 2 - inset, by, 0);
  addMesh(g, boxGeo(0.022, 0.028, d - inset * 2, 1.6), mat('woodDark'), -(w / 2 - inset), by, 0);
  return finishProp(g, 'table', sink);
}

/**
 * Wooden chair, ~0.45 m seat height, slatted back, matching table timber.
 * Centred on X/Z, min Y = 0.
 */
export function makeChair(opts = {}) {
  const seatH = Math.max(0.3, num(opts.seatH, 0.45));
  const w = 0.42;
  const d = 0.42;
  const seatT = 0.036;
  const backH = 0.44;
  const legInset = 0.03;
  const g = new THREE.Group();
  g.userData.builder = 'makeChair';
  const sink = {};
  addMesh(g, roundGeo(w, d, seatT, 0.012, 1), mat('woodWarm'), 0, seatH - seatT / 2, 0);
  const legGeo = boxGeo(0.036, seatH - seatT, 0.036, 1.8);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? -1 : 1;
    const sz = i % 2 === 0 ? -1 : 1;
    addMesh(g, legGeo, mat('woodDark'), sx * (w / 2 - legInset), (seatH - seatT) / 2, sz * (d / 2 - legInset));
  }
  // Stretchers.
  addMesh(g, boxGeo(w - legInset * 2, 0.024, 0.02, 1.6), mat('woodDark'), 0, seatH * 0.3, d / 2 - legInset);
  addMesh(g, boxGeo(w - legInset * 2, 0.024, 0.02, 1.6), mat('woodDark'), 0, seatH * 0.3, -(d / 2 - legInset));
  // Back posts + slats.
  const postH = backH + 0.10;
  const postGeo = boxGeo(0.036, postH, 0.036, 1.8);
  const bz = d / 2 - legInset;
  addMeshE(g, postGeo, mat('woodDark'), -(w / 2 - legInset), seatH + postH / 2 - 0.02, bz, -0.05, 0, 0);
  addMeshE(g, postGeo, mat('woodDark'), (w / 2 - legInset), seatH + postH / 2 - 0.02, bz, -0.05, 0, 0);
  addMesh(g, roundGeo(w - legInset * 2, 0.028, 0.05, 0.01), mat('woodWarm'), 0, seatH + backH, bz - 0.01);
  const slats = 3;
  for (let i = 0; i < slats; i++) {
    const y = seatH + 0.10 + (i / (slats - 1)) * (backH - 0.16);
    addMesh(g, boxGeo(w - legInset * 2 - 0.04, 0.034, 0.018, 1.8), mat('woodDark'), 0, y, bz - 0.008);
  }
  return finishProp(g, 'chair', sink);
}

/**
 * Restaurant counter: thick top, slatted front panel, brass foot rail.
 * Centred on X/Z, min Y = 0.
 * @param {{len?:number,h?:number,d?:number}} [opts]
 */
export function makeCounter(opts = {}) {
  const len = Math.max(0.6, num(opts.len, 3));
  const h = Math.max(0.5, num(opts.h, 1.05));
  const depth = Math.max(0.3, num(opts.d, 0.6));
  const topT = 0.055;
  const g = new THREE.Group();
  g.userData.builder = 'makeCounter';
  const sink = {};
  addMesh(g, roundGeo(len, depth, topT, 0.018, 1), mat('woodCounter'), 0, h - topT / 2, 0);
  addMesh(g, boxGeo(len - 0.04, h - topT - 0.02, depth - 0.16, 1.1), mat('woodDark'), 0, (h - topT - 0.02) / 2 + 0.02, 0);
  // Vertical slats across the customer side.
  const slats = Math.max(4, Math.round(len / 0.085));
  const pitch = (len - 0.06) / slats;
  const slatW = pitch * 0.66;
  const slatGeo = boxGeo(slatW, h - topT - 0.03, 0.025, 1.6);
  for (let i = 0; i < slats; i++) {
    const x = -(len - 0.06) / 2 + (i + 0.5) * pitch;
    addMesh(g, slatGeo, i % 2 === 0 ? mat('woodDark') : mat('woodDeep'), x, (h - topT - 0.03) / 2 + 0.015, depth / 2 - 0.012);
  }
  // Brass foot rail on brackets, sized so the rail stays inside the counter
  // footprint (the bounding box must stay centred on the origin).
  const railZ = depth / 2 - 0.015;
  const rail = new THREE.CylinderGeometry(0.021, 0.021, len - 0.1, 14, 1);
  rail.rotateZ(Math.PI / 2);
  addMesh(g, rail, mat('brass'), 0, 0.20, railZ);
  const bracket = new THREE.CylinderGeometry(0.013, 0.013, 0.075, 10, 1);
  for (const bx of [-len / 2 + 0.22, 0, len / 2 - 0.22]) {
    addMeshE(g, bracket, mat('brass'), bx, 0.20, railZ - 0.055, Math.PI / 2, 0, 0);
  }
  symmetrizeXZ(g);
  return finishProp(g, 'counter', sink);
}

/**
 * Stainless prep counter with an undershelf.
 * Centred on X/Z, min Y = 0.
 * @param {{len?:number,h?:number,d?:number}} [opts]
 */
export function makeKitchenCounter(opts = {}) {
  const len = Math.max(0.5, num(opts.len, 2.4));
  const h = Math.max(0.5, num(opts.h, 0.9));
  const d = Math.max(0.3, num(opts.d, 0.65));
  const topT = 0.045;
  const legInset = 0.06;
  const g = new THREE.Group();
  g.userData.builder = 'makeKitchenCounter';
  const sink = {};
  addMesh(g, roundGeo(len, d, topT, 0.008, 1), mat('stainless'), 0, h - topT / 2, 0);
  // Returned edge lip.
  addMesh(g, boxGeo(len, 0.035, 0.02, 1.4), mat('stainless'), 0, h - 0.06, d / 2 - 0.005);
  addMesh(g, boxGeo(len, 0.03, 0.02, 1.4), mat('stainless'), 0, h - 0.06, -(d / 2 - 0.005));
  const legH = h - topT - 0.05;
  const legGeo = new THREE.CylinderGeometry(0.024, 0.024, legH, 12, 1);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addMesh(g, legGeo, mat('stainless'), sx * (len / 2 - legInset), legH / 2, sz * (d / 2 - legInset));
    }
  }
  // Lower shelf.
  addMesh(g, roundGeo(len - legInset * 2, d - legInset * 2, 0.03, 0.006, 1), mat('stainlessDark'), 0, 0.22, 0);
  addMesh(g, boxGeo(len - legInset * 2, 0.055, 0.016, 1.4), mat('stainless'), 0, 0.24, d / 2 - legInset);
  addMesh(g, boxGeo(len - legInset * 2, 0.055, 0.016, 1.4), mat('stainless'), 0, 0.24, -(d / 2 - legInset));
  return finishProp(g, 'kitchenCounter', sink);
}

/**
 * Commercial range: stainless body, three burner rings, a wok, front knobs.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,d?:number,h?:number}} [opts]
 */
export function makeStove(opts = {}) {
  const w = Math.max(0.5, num(opts.w, 1.4));
  const d = Math.max(0.4, num(opts.d, 0.7));
  const h = Math.max(0.5, num(opts.h, 0.9));
  const topT = 0.05;
  const g = new THREE.Group();
  g.userData.builder = 'makeStove';
  const sink = {};
  addMesh(g, roundGeo(w, d, h - topT, 0.01, 1), mat('stainlessDark'), 0, (h - topT) / 2, 0);
  addMesh(g, roundGeo(w, d, topT, 0.008, 1), mat('stainless'), 0, h - topT / 2, 0);

  const burners = 3;
  const pitch = w / (burners + 0.6);
  const ring = new THREE.TorusGeometry(0.10, 0.017, 8, 22);
  const grate = new THREE.CylinderGeometry(0.105, 0.09, 0.014, 20, 1);
  for (let i = 0; i < burners; i++) {
    const x = -w / 2 + pitch * (i + 0.8);
    addMeshE(g, ring, mat('ironBlack'), x, h + 0.006, 0, Math.PI / 2, 0, 0);
    addMesh(g, grate, mat('steelDark'), x, h + 0.008, 0);
  }
  // Wok sitting on the rear burner: a sphere shell with the top sliced off.
  const wok = new THREE.SphereGeometry(0.155, 22, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  wok.scale(1, 0.72, 1);
  addMesh(g, wok, mat('steelDark'), -w / 2 + pitch * 0.8, h + 0.075, -d * 0.16);
  const handle = new THREE.CylinderGeometry(0.014, 0.014, 0.20, 10, 1);
  addMeshE(g, handle, mat('woodDeep'), -w / 2 + pitch * 0.8, h + 0.13, -d * 0.16 + 0.20, Math.PI / 2.35, 0, 0);

  // Control knobs.
  const knob = new THREE.CylinderGeometry(0.026, 0.028, 0.028, 14, 1);
  for (let i = 0; i < burners; i++) {
    const x = -w / 2 + pitch * (i + 0.8);
    addMeshE(g, knob, mat('ironBlack'), x, h - 0.11, d / 2 - 0.004, Math.PI / 2, 0, 0);
  }
  // Oven door + handle below.
  addMesh(g, roundGeo(w - 0.06, 0.02, h * 0.45, 0.006, 1), mat('stainless'), 0, h * 0.30, d / 2 - 0.006);
  const bar = new THREE.CylinderGeometry(0.014, 0.014, w - 0.16, 12, 1);
  bar.rotateZ(Math.PI / 2);
  addMesh(g, bar, mat('stainless'), 0, h * 0.46, d / 2 + 0.035);
  return finishProp(g, 'stove', sink);
}

/**
 * Stainless sink with a basin recess and a curved gooseneck faucet.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,d?:number,h?:number}} [opts]
 */
export function makeSink(opts = {}) {
  const w = Math.max(0.4, num(opts.w, 0.9));
  const d = Math.max(0.3, num(opts.d, 0.6));
  const h = Math.max(0.5, num(opts.h, 0.9));
  const topT = 0.045;
  const bW = w * 0.62;
  const bD = d * 0.6;
  const bDepth = 0.20;
  const g = new THREE.Group();
  g.userData.builder = 'makeSink';
  const sink = {};

  // Work surface: a rectangle with a basin-shaped hole.
  const bw = bW / 2;
  const bd = bD / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2);
  s.lineTo(w / 2, -d / 2);
  s.lineTo(w / 2, d / 2);
  s.lineTo(-w / 2, d / 2);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-bw, -bd);
  hole.lineTo(-bw, bd);
  hole.lineTo(bw, bd);
  hole.lineTo(bw, -bd);
  hole.closePath();
  s.holes.push(hole);
  const topGeo = new THREE.ExtrudeGeometry(s, { depth: topT - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 2, steps: 1 });
  topGeo.translate(0, 0, -(topT - 0.006) / 2);
  addMeshE(g, topGeo, mat('stainless'), 0, h - topT / 2, 0, Math.PI / 2, 0, 0);

  // Basin walls + floor.
  addMesh(g, boxGeo(bW + 0.02, bDepth, 0.016, 1.6), mat('stainless'), 0, h - topT - bDepth / 2, -bd);
  addMesh(g, boxGeo(bW + 0.02, bDepth, 0.016, 1.6), mat('stainless'), 0, h - topT - bDepth / 2, bd);
  addMesh(g, boxGeo(0.016, bDepth, bD, 1.6), mat('stainless'), -bw, h - topT - bDepth / 2, 0);
  addMesh(g, boxGeo(0.016, bDepth, bD, 1.6), mat('stainless'), bw, h - topT - bDepth / 2, 0);
  addMesh(g, boxGeo(bW + 0.02, 0.016, bD + 0.02, 1.6), mat('stainlessDark'), 0, h - topT - bDepth, 0);
  addMesh(g, new THREE.CylinderGeometry(0.026, 0.026, 0.006, 14, 1), mat('steelDark'), 0, h - topT - bDepth + 0.008, 0);

  // Cabinet + door seams.
  addMesh(g, boxGeo(w - 0.02, h - topT - 0.02, d - 0.03, 1.1), mat('stainlessDark'), 0, (h - topT) / 2, -0.01);
  addMesh(g, boxGeo(0.012, h - topT - 0.10, 0.012, 1.6), mat('ironBlack'), 0, (h - topT) / 2, d / 2 - 0.014);
  const knob = new THREE.CylinderGeometry(0.013, 0.013, 0.09, 10, 1);
  knob.rotateZ(Math.PI / 2);
  addMesh(g, knob, mat('stainless'), w * 0.16, h - 0.24, d / 2 - 0.004);

  // Gooseneck faucet: vertical riser, bent neck, aerator.
  const fx = -w * 0.30;
  const fz = -d * 0.30;
  const riser = new THREE.CylinderGeometry(0.019, 0.022, 0.26, 14, 1);
  addMesh(g, riser, mat('stainless'), fx, h + 0.13, fz);
  const curve = new THREE.TorusGeometry(0.11, 0.017, 8, 20, Math.PI * 0.62);
  addMeshE(g, curve, mat('stainless'), fx + 0.11, h + 0.26, fz, 0, 0, Math.PI * 0.19);
  addMesh(g, new THREE.CylinderGeometry(0.016, 0.014, 0.07, 12, 1), mat('stainless'), fx + 0.11, h + 0.19, fz);
  const lever = new THREE.CylinderGeometry(0.011, 0.011, 0.11, 10, 1);
  addMeshE(g, lever, mat('brass'), fx, h + 0.20, fz - 0.05, Math.PI / 3.1, 0, 0);
  symmetrizeXZ(g);
  return finishProp(g, 'sink', sink);
}

/**
 * Stainless upright refrigerator with a door seam and a vertical handle.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number,d?:number}} [opts]
 */
export function makeFridge(opts = {}) {
  const w = Math.max(0.4, num(opts.w, 0.7));
  const h = Math.max(0.8, num(opts.h, 1.9));
  const d = Math.max(0.4, num(opts.d, 0.7));
  const g = new THREE.Group();
  g.userData.builder = 'makeFridge';
  const sink = {};
  addMesh(g, roundGeo(w, d, h, 0.014, 1), mat('stainless'), 0, h / 2, 0);
  // Door panel, slightly proud, with a dark seam around it.
  addMesh(g, boxGeo(w - 0.05, h - 0.09, 0.03, 1.1), mat('stainlessDark'), 0, h / 2, d / 2 - 0.012);
  const zf = d / 2 + 0.002;
  addMesh(g, boxGeo(w - 0.07, 0.012, 0.012, 1.6), mat('ironBlack'), 0, h - 0.055, zf);
  addMesh(g, boxGeo(w - 0.07, 0.012, 0.012, 1.6), mat('ironBlack'), 0, 0.055, zf);
  addMesh(g, boxGeo(0.012, h - 0.09, 0.012, 1.6), mat('ironBlack'), -(w / 2 - 0.035), h / 2, zf);
  addMesh(g, boxGeo(0.012, h - 0.09, 0.012, 1.6), mat('ironBlack'), (w / 2 - 0.035), h / 2, zf);
  // Vertical pull handle on the free edge.
  const handle = new THREE.CylinderGeometry(0.016, 0.016, h * 0.42, 12, 1);
  addMesh(g, handle, mat('stainless'), w / 2 - 0.085, h * 0.55, d / 2 + 0.048);
  const standoff = new THREE.CylinderGeometry(0.012, 0.012, 0.045, 10, 1);
  standoff.rotateX(Math.PI / 2);
  addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.045, 10, 1), mat('stainless'), w / 2 - 0.085, h * 0.55 + h * 0.19, d / 2 + 0.024);
  const so2 = new THREE.CylinderGeometry(0.012, 0.012, 0.045, 10, 1);
  so2.rotateX(Math.PI / 2);
  addMesh(g, so2, mat('stainless'), w / 2 - 0.085, h * 0.55 - h * 0.19, d / 2 + 0.024);
  // Vent grille at the base + a small brand plate.
  addMesh(g, boxGeo(w - 0.14, 0.05, 0.012, 1.6), mat('ironBlack'), 0, 0.10, zf);
  addMesh(g, boxGeo(0.14, 0.035, 0.006, 2.0), mat('stainlessDark'), 0, h * 0.86, zf);
  symmetrizeXZ(g);
  return finishProp(g, 'fridge', sink);
}

/**
 * Open wooden shelf stocked with sake bottles and jars.
 * Centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number,d?:number,bottles?:number}} [opts]
 */
export function makeShelf(opts = {}) {
  const w = Math.max(0.5, num(opts.w, 1.6));
  const h = Math.max(0.6, num(opts.h, 1.7));
  const d = Math.max(0.2, num(opts.d, 0.35));
  const bottles = Math.max(0, Math.round(num(opts.bottles, 8)));
  const levels = 4;
  const panelT = 0.028;
  const g = new THREE.Group();
  g.userData.builder = 'makeShelf';
  const sink = {};

  addMesh(g, boxGeo(panelT, h, d, 1.4), mat('woodDark'), -(w / 2 - panelT / 2), h / 2, 0);
  addMesh(g, boxGeo(panelT, h, d, 1.4), mat('woodDark'), (w / 2 - panelT / 2), h / 2, 0);
  addMesh(g, boxGeo(w, h, 0.014, 1.2), mat('woodDeep'), 0, h / 2, -(d / 2 - 0.007));

  const shelfGeo = roundGeo(w - panelT * 2, d, 0.026, 0.006, 1);
  const shelfY = [];
  for (let i = 0; i <= levels; i++) {
    const y = 0.02 + ((h - 0.04) * i) / levels;
    shelfY.push(y);
  }
  const shelfPitch = shelfY[1] - shelfY[0];
  for (const y of shelfY) addMesh(g, shelfGeo, mat('woodWarm'), 0, y, 0);

  // Stock: cylinders and jars in varied colours, kept under the shelf above.
  const glassMats = [mat('bottleGreen'), mat('bottleAmber'), mat('bottleClear')];
  const jarMats = [mat('glaze_indigo'), mat('glaze_celadon'), mat('glaze_white'), mat('glaze_brown')];
  const perShelf = Math.max(1, Math.ceil(bottles / Math.max(1, levels)));
  const r = rng(211);
  let placed = 0;
  for (let s = 0; s < shelfY.length - 1 && placed < bottles; s++) {
    const y = shelfY[s];
    const band = (w - panelT * 2 - 0.08) / perShelf;
    // The top bay of the case caps the tallest bottle; every bay is capped by
    // the shelf above it, so the stock never pushes the prop out of size.
    const headroom = (s === shelfY.length - 2 ? h - 0.03 : shelfPitch) - 0.06 - 0.013;
    for (let i = 0; i < perShelf && placed < bottles; i++, placed++) {
      const x = -(w / 2 - panelT) + 0.04 + (i + 0.5) * band + (r() - 0.5) * band * 0.2;
      const z = (r() - 0.5) * 0.03;
      if (r() < 0.62) {
        const bh = Math.max(0.08, 0.19 + r() * 0.05 - (s === shelfY.length - 2 ? 0.05 : 0));
        const br = 0.030 + r() * 0.008;
        const capH = Math.min(bh * 0.40, headroom - bh - 0.006);
        addMesh(g, new THREE.CylinderGeometry(br, br * 1.06, bh, 12, 1), glassMats[(placed + s) % 3], x, y + 0.013 + bh / 2, z);
        if (capH > 0.03) {
          addMesh(g, new THREE.CylinderGeometry(br * 0.34, br * 0.78, capH, 12, 1), glassMats[(placed + s) % 3], x, y + 0.013 + bh + capH / 2 - 0.004, z);
          addMesh(g, new THREE.CylinderGeometry(br * 0.36, br * 0.36, 0.018, 12, 1), mat('glaze_white'), x, y + 0.013 + bh + capH - 0.002, z);
        } else {
          addMesh(g, new THREE.CylinderGeometry(br * 0.36, br * 0.36, 0.016, 12, 1), mat('glaze_white'), x, y + 0.013 + bh + 0.004, z);
        }
      } else {
        const jh = Math.min(0.09 + r() * 0.05, headroom);
        const jr = 0.036 + r() * 0.012;
        addMesh(g, new THREE.CylinderGeometry(jr, jr * 0.86, jh, 14, 1), jarMats[(placed * 3 + s) % 4], x, y + 0.013 + jh / 2, z);
        addMesh(g, new THREE.CylinderGeometry(jr * 0.92, jr * 0.92, 0.014, 14, 1), mat('woodDark'), x, y + 0.013 + jh + 0.004, z);
      }
    }
  }
  symmetrizeXZ(g);
  return finishProp(g, 'shelf', sink);
}

/**
 * A place setting for one table: plate(s), rice bowl, teacup, chopsticks on a
 * rest and a soy dish, all in varied ceramic glazes.
 * Centred on X/Z, min Y = 0 (the tabletop the setting rests on).
 * @param {{plates?:number}} [opts]
 */
export function makeTableSetting(opts = {}) {
  const plates = clamp(Math.round(num(opts.plates, 2)), 1, 4);
  const g = new THREE.Group();
  g.userData.builder = 'makeTableSetting';
  const sink = {};

  const plateGeo = latheGeo([
    [0.0, 0.0], [0.085, 0.0], [0.105, 0.004], [0.115, 0.014], [0.118, 0.022], [0.108, 0.021], [0.092, 0.012], [0.085, 0.010], [0.0, 0.010]
  ], 26);
  const bowlGeo = latheGeo([
    [0.0, 0.0], [0.032, 0.0], [0.045, 0.006], [0.052, 0.022], [0.058, 0.046], [0.061, 0.058], [0.053, 0.058], [0.050, 0.044], [0.043, 0.020], [0.030, 0.010], [0.0, 0.009]
  ], 24);
  const cupGeo = latheGeo([
    [0.0, 0.0], [0.028, 0.0], [0.032, 0.004], [0.034, 0.026], [0.036, 0.046], [0.040, 0.050], [0.033, 0.050], [0.030, 0.044], [0.028, 0.022], [0.026, 0.006], [0.0, 0.005]
  ], 22);
  const dishGeo = latheGeo([
    [0.0, 0.0], [0.030, 0.0], [0.040, 0.004], [0.044, 0.012], [0.038, 0.012], [0.030, 0.006], [0.026, 0.005], [0.0, 0.005]
  ], 20);
  const stickGeo = boxGeo(0.006, 0.004, 0.22, 6.0);
  const restGeo = roundGeo(0.048, 0.016, 0.022, 0.006, 1);

  const glazes = [mat('glaze_indigo'), mat('glaze_celadon'), mat('glaze_white'), mat('glaze_brown')];

  // Plate(s) fanned towards the diner.
  for (let i = 0; i < plates; i++) {
    const x = plates === 1 ? 0 : (i - (plates - 1) / 2) * 0.26;
    const y = i === 0 ? 0 : 0.024;
    addMesh(g, plateGeo, glazes[i % glazes.length], x, i === 0 ? 0 : 0, 0);
    if (i > 0) addMesh(g, plateGeo, glazes[(i + 2) % glazes.length], x, 0.012, 0.012);
  }
  // Rice bowl + teacup to the upper side, soy dish + chopsticks to the lower.
  addMesh(g, bowlGeo, mat('glaze_celadon'), -0.22, 0, -0.16);
  addMesh(g, cupGeo, mat('glaze_brown'), 0.02, 0, -0.20);
  addMesh(g, dishGeo, mat('glaze_white'), 0.20, 0, 0.14);
  addMeshE(g, restGeo, mat('porcelain'), -0.14, 0.008, 0.12, 0, 0.34, 0);
  addMeshE(g, stickGeo, mat('woodDeep'), -0.152, 0.024, 0.115, 0, 0.34, 0);
  addMeshE(g, stickGeo, mat('woodDeep'), -0.128, 0.024, 0.128, 0, 0.34, 0);
  return finishProp(g, 'tableSetting', sink);
}

/* ------------------------------------------------------------------ *
 * 7. DECOR
 * ------------------------------------------------------------------ */

/**
 * Paper lantern: ribbed barrel body, warm glow, black caps, character on the
 * side, cord and hook above. Centred on X/Z, min Y = 0 (the hem).
 * @param {{r?:number,h?:number,text?:string}} [opts]
 */
export function makeChochin(opts = {}) {
  const r = clamp(num(opts.r, 0.18), 0.05, 0.6);
  const h = clamp(num(opts.h, 0.34), 0.1, 1.2);
  const text = opts.text == null ? 'らーめん' : String(opts.text);
  const seg = 24;
  const g = new THREE.Group();
  g.userData.builder = 'makeChochin';
  const sink = {};

  const key = `chochinBody_${text}`;
  const body = mat(key, {
    map: canvasTex(`${key}_map`, 256, 256, (ctx, w, hh) => {
      ctx.fillStyle = '#f7e6c4';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(223);
      for (let i = 0; i < 420; i++) {
        ctx.strokeStyle = `rgba(178,146,96,${0.03 + rr() * 0.06})`;
        ctx.lineWidth = 0.6 + rr();
        const y = rr() * hh;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + (rr() - 0.5) * 6);
        ctx.stroke();
      }
      // Darker shadow bands where the ribs pull the paper in.
      for (let i = 1; i < 8; i++) {
        ctx.fillStyle = 'rgba(120,92,54,0.10)';
        ctx.fillRect(0, (i * hh) / 8 - 2, w, 4);
      }
      drawJPText(ctx, {
        text, color: 'rgba(38,22,14,0.92)', size: 118, x: w * 0.25, y: hh * 0.5, vertical: false
      });
      drawJPText(ctx, {
        text, color: 'rgba(38,22,14,0.92)', size: 118, x: w * 0.75, y: hh * 0.5, vertical: false
      });
      speckle(ctx, w, hh, 700, 0.03, 227, 1);
    }, 1, 1, { srgb: true }),
    emissiveMap: canvasTex(`${key}_emis`, 64, 64, (ctx, w, hh) => {
      const grd = ctx.createLinearGradient(0, 0, 0, hh);
      grd.addColorStop(0, '#ffbe78');
      grd.addColorStop(0.5, '#fff2d2');
      grd.addColorStop(1, '#ffb867');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, hh);
    }, 1, 1, { srgb: true }),
    emissive: new THREE.Color(0xffc98a), emissiveIntensity: 0.85,
    roughness: 0.85, metalness: 0.0
  });

  const profile = (v) => 0.52 + 0.48 * Math.sin(Math.PI * v);
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([r * profile(i / 12), (i / 12) * h]);
  addMesh(g, latheGeo(pts, seg), body, 0, 0, 0);

  const ribs = 7;
  for (let i = 1; i < ribs; i++) {
    const v = i / ribs;
    const rad = r * profile(v);
    const rib = new THREE.TorusGeometry(rad, 0.0038, 6, seg);
    addMeshE(g, rib, mat('woodDeep'), 0, v * h, 0, Math.PI / 2, 0, 0);
  }
  // Caps, cord and hook.
  addMesh(g, new THREE.CylinderGeometry(r * 0.44, r * 0.40, 0.032, seg, 1), mat('ironBlack'), 0, h - 0.008, 0);
  addMesh(g, new THREE.CylinderGeometry(r * 0.40, r * 0.44, 0.032, seg, 1), mat('ironBlack'), 0, 0.008, 0);
  addMesh(g, new THREE.CylinderGeometry(0.004, 0.004, 0.10, 8, 1), mat('rope'), 0, h + 0.06, 0);
  const hook = new THREE.TorusGeometry(0.026, 0.004, 6, 16, Math.PI * 1.4);
  addMeshE(g, hook, mat('ironBlack'), 0, h + 0.13, 0, 0, 0, Math.PI * 0.3);
  return finishProp(g, 'chochin', sink);
}

/**
 * Floor lamp: wooden posts and rails around a glowing washi box.
 * Centred on X/Z, min Y = 0.
 * @param {{h?:number}} [opts]
 */
export function makeAndon(opts = {}) {
  const h = clamp(num(opts.h, 0.85), 0.25, 2);
  const w = clamp(num(opts.w, h * 0.42), 0.16, 1.2);
  const d = clamp(num(opts.d, h * 0.42), 0.16, 1.2);
  const post = 0.028;
  const baseH = 0.05;
  const topH = 0.032;
  const g = new THREE.Group();
  g.userData.builder = 'makeAndon';
  const sink = {};

  addMesh(g, roundGeo(w + 0.03, d + 0.03, baseH, 0.008, 1), mat('woodDark'), 0, baseH / 2, 0);
  addMesh(g, roundGeo(w + 0.03, d + 0.03, topH, 0.008, 1), mat('woodDark'), 0, h - topH / 2, 0);
  const postGeo = boxGeo(post, h - baseH - topH, post, 2.0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addMesh(g, postGeo, mat('woodDark'), sx * (w / 2 - post / 2), baseH + (h - baseH - topH) / 2, sz * (d / 2 - post / 2));
    }
  }
  // Washi box, bright inside, dimmer through the corners.
  const lampH = h - baseH - topH - 0.04;
  addMesh(g, boxGeo(w - post, lampH, d - post, 1.2), mat('lampPaper'), 0, baseH + 0.02 + lampH / 2, 0, false);
  addMesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12, 1), mat('brass'), 0, h - topH - 0.012, 0);
  return finishProp(g, 'andon', sink);
}

/**
 * Hanging scroll: wooden dowels, silk border, paper centre with a brushed ink
 * motif. The plane hangs in the XY plane facing +Z; centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number,text?:string}} [opts]
 */
export function makeKakemono(opts = {}) {
  const w = clamp(num(opts.w, 0.5), 0.15, 2);
  const h = clamp(num(opts.h, 1.6), 0.3, 4);
  const rodR = Math.min(0.022, w * 0.06);
  const g = new THREE.Group();
  g.userData.builder = 'makeKakemono';
  const sink = {};

  const paperKey = `kakemonoPaper_${opts.text || 'ink'}`;
  const paper = mat(paperKey, {
    map: canvasTex(`${paperKey}_map`, 256, 512, (ctx, ww, hh) => {
      ctx.fillStyle = '#f2ead6';
      ctx.fillRect(0, 0, ww, hh);
      const rr = rng(229);
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = rr() > 0.5 ? 'rgba(255,255,248,0.05)' : 'rgba(186,168,132,0.06)';
        ctx.beginPath();
        ctx.ellipse(rr() * ww, rr() * hh, 10 + rr() * 46, 10 + rr() * 46, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'round';
      const ink = 'rgba(24,22,26,0.88)';
      brushStroke(ctx, [[ww * 0.36, hh * 0.14], [ww * 0.30, hh * 0.30], [ww * 0.40, hh * 0.44]], 26, 3, ink);
      brushStroke(ctx, [[ww * 0.40, hh * 0.44], [ww * 0.56, hh * 0.52], [ww * 0.60, hh * 0.70]], 22, 5, ink);
      brushStroke(ctx, [[ww * 0.24, hh * 0.62], [ww * 0.42, hh * 0.60], [ww * 0.62, hh * 0.64]], 18, 7, ink);
      brushStroke(ctx, [[ww * 0.52, hh * 0.16], [ww * 0.62, hh * 0.28], [ww * 0.58, hh * 0.42]], 20, 11, ink);
      brushStroke(ctx, [[ww * 0.44, hh * 0.80], [ww * 0.54, hh * 0.88], [ww * 0.50, hh * 0.94]], 12, 13, 'rgba(24,22,26,0.7)');
      // Hanko: a small red seal in the lower corner.
      ctx.fillStyle = 'rgba(168,42,34,0.88)';
      ctx.fillRect(ww * 0.62, hh * 0.86, ww * 0.16, ww * 0.16);
      drawJPText(ctx, { text: '印', color: 'rgba(240,232,216,0.95)', size: ww * 0.12, x: ww * 0.70, y: hh * 0.86 + ww * 0.08 });
      speckle(ctx, ww, hh, 1800, 0.03, 233, 1);
    }, 1, 1, { srgb: true }),
    roughness: 0.88, metalness: 0.0
  });
  const cloth = mat('kakemonoCloth', {
    map: canvasTex('kakemonoCloth', 128, 256, (ctx, ww, hh) => {
      ctx.fillStyle = '#8d7a4e';
      ctx.fillRect(0, 0, ww, hh);
      const rr = rng(239);
      for (let y = 0; y < hh; y += 2) {
        ctx.fillStyle = y % 4 === 0 ? 'rgba(255,246,214,0.07)' : 'rgba(48,36,12,0.08)';
        ctx.fillRect(0, y, ww, 1);
      }
      for (let x = 0; x < ww; x += 3) {
        ctx.fillStyle = 'rgba(255,246,214,0.03)';
        ctx.fillRect(x, 0, 1, hh);
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(${rr() > 0.5 ? '255,244,208' : '60,44,16'},${0.03 + rr() * 0.05})`;
        ctx.beginPath();
        ctx.ellipse(rr() * ww, rr() * hh, 8 + rr() * 26, 8 + rr() * 26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 1, 1, { srgb: true }),
    roughness: 0.92, metalness: 0.0
  });

  // Silk mount behind the paper.
  addMesh(g, boxGeo(w, h - rodR * 2, 0.008, 1.1), cloth, 0, h / 2, -0.004);
  // Paper centre.
  const border = w * 0.14;
  addMesh(g, boxGeo(w - border * 2, h - rodR * 2 - 0.10, 0.004, 1.2), paper, 0, h / 2, 0.004);
  // Dowels top and bottom.
  const rod = new THREE.CylinderGeometry(rodR, rodR, w + 0.09, 12, 1);
  rod.rotateZ(Math.PI / 2);
  addMesh(g, rod, mat('woodDeep'), 0, h - rodR, 0);
  const rodB = new THREE.CylinderGeometry(rodR * 0.85, rodR * 0.85, w + 0.07, 12, 1);
  rodB.rotateZ(Math.PI / 2);
  addMesh(g, rodB, mat('woodDeep'), 0, rodR * 0.9, 0);
  // Hanging cord loop.
  const loop = new THREE.TorusGeometry(0.028, 0.003, 6, 14, Math.PI * 1.5);
  addMeshE(g, loop, mat('rope'), 0, h + 0.026, 0, 0, 0, Math.PI * 0.25);
  return finishProp(g, 'kakemono', sink);
}

/**
 * Potted pine: ceramic pot, soil, a trunk with two bends and five foliage
 * clusters. Centred on X/Z, min Y = 0.
 */
export function makeBonsai(opts = {}) {
  const scale = clamp(num(opts.scale, 1), 0.4, 2.5);
  const g = new THREE.Group();
  g.userData.builder = 'makeBonsai';
  const sink = {};

  const potR = 0.13 * scale;
  const potH = 0.10 * scale;
  addMesh(g, latheGeo([
    [0.0, 0.0], [potR * 0.72, 0.0], [potR * 0.80, 0.008 * scale], [potR * 0.86, potH * 0.55],
    [potR, potH * 0.86], [potR * 1.04, potH], [potR * 0.95, potH * 0.98], [potR * 0.92, potH * 0.80],
    [potR * 0.80, potH * 0.5], [potR * 0.74, 0.02 * scale], [0.0, 0.018 * scale]
  ], 26), mat('glaze_brown'), 0, 0, 0);
  addMesh(g, new THREE.CylinderGeometry(potR * 0.86, potR * 0.84, 0.012 * scale, 20, 1), mat('soil'), 0, potH * 0.94, 0);

  // Trunk: two bends, tapering.
  const t0 = potH * 0.95;
  addMeshE(g, new THREE.CylinderGeometry(0.020 * scale, 0.028 * scale, 0.14 * scale, 10, 1), mat('woodDeep'), -0.004 * scale, t0 + 0.07 * scale, 0, 0, 0, 0.10);
  addMeshE(g, new THREE.CylinderGeometry(0.014 * scale, 0.020 * scale, 0.13 * scale, 10, 1), mat('woodDeep'), 0.018 * scale, t0 + 0.195 * scale, 0.01 * scale, 0.10, 0, -0.42);
  addMeshE(g, new THREE.CylinderGeometry(0.009 * scale, 0.014 * scale, 0.11 * scale, 8, 1), mat('woodDeep'), 0.062 * scale, t0 + 0.30 * scale, -0.01 * scale, -0.12, 0, -0.55);

  // Branches.
  const branches = [
    [-0.07, 0.22, 0.01, 0.5, 0.42],
    [-0.02, 0.31, -0.05, 0.4, 1.15],
    [0.07, 0.36, 0.05, 0.44, -0.5],
    [0.11, 0.29, -0.03, 0.36, -1.25],
    [0.03, 0.40, 0.0, 0.30, 0.1]
  ];
  const branchGeo = new THREE.CylinderGeometry(0.006 * scale, 0.010 * scale, 1, 7, 1);
  for (const b of branches) {
    const y = t0 + b[1] * scale;
    const m = new THREE.Mesh(branchGeo, mat('woodDeep'));
    m.position.set(b[0] * scale, y, b[2] * scale);
    m.rotation.set(b[3] * 0.5, b[4], Math.PI * 0.5);
    m.scale.y = 0.25 * scale;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // Foliage: flattened icosahedron pads, two greens.
  const pads = [
    [-0.075, 0.235, 0.012, 0.075], [-0.020, 0.325, -0.050, 0.058],
    [0.072, 0.375, 0.052, 0.070], [0.108, 0.300, -0.030, 0.052],
    [0.030, 0.412, 0.004, 0.048]
  ];
  const padGeo = new THREE.IcosahedronGeometry(1, 1);
  pads.forEach((p, i) => {
    const m = new THREE.Mesh(padGeo, i % 2 === 0 ? mat('pineDark') : mat('leaf'));
    m.position.set(p[0] * scale, t0 + p[1] * scale, p[2] * scale);
    m.scale.set(p[3] * scale, p[3] * 0.55 * scale, p[3] * scale);
    m.rotation.set(p[1] * 2, p[0] * 6, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return finishProp(g, 'bonsai', sink);
}

/**
 * Ikebana: tall vase with stems, leaves and small blossoms at varied heights.
 * Centred on X/Z, min Y = 0.
 */
export function makeIkebana(opts = {}) {
  const scale = clamp(num(opts.scale, 1), 0.5, 2);
  const g = new THREE.Group();
  g.userData.builder = 'makeIkebana';
  const sink = {};

  const vr = 0.055 * scale;
  const vh = 0.22 * scale;
  addMesh(g, latheGeo([
    [0.0, 0.0], [vr * 0.68, 0.0], [vr * 0.78, 0.01 * scale], [vr, vh * 0.35],
    [vr * 0.86, vh * 0.66], [vr * 0.62, vh * 0.86], [vr * 0.58, vh * 0.94],
    [vr * 0.66, vh], [vr * 0.52, vh * 0.97], [vr * 0.50, vh * 0.80],
    [vr * 0.72, vh * 0.6], [vr * 0.86, vh * 0.32], [vr * 0.66, 0.02 * scale], [0.0, 0.016 * scale]
  ], 26), mat('glaze_white'), 0, 0, 0);
  addMesh(g, new THREE.CylinderGeometry(vr * 0.56, vr * 0.5, 0.02 * scale, 16, 1), mat('soil'), 0, vh * 0.93, 0);

  const stems = [
    [0.00, 0.00, 0.62, 0.00, 0.00],
    [0.03, 0.02, 0.48, 0.22, 0.14],
    [-0.03, 0.01, 0.40, -0.26, 0.10],
    [0.01, -0.03, 0.54, 0.10, -0.24],
    [-0.02, -0.02, 0.34, -0.14, -0.18]
  ];
  const stemGeo = new THREE.CylinderGeometry(0.004 * scale, 0.006 * scale, 1, 6, 1);
  const leafGeo = new THREE.SphereGeometry(1, 8, 5);
  const bloomGeo = new THREE.SphereGeometry(1, 10, 7);
  stems.forEach((s, i) => {
    const len = s[2] * scale;
    const y0 = vh * 0.92;
    const m = new THREE.Mesh(stemGeo, mat('leaf'));
    m.position.set(s[0] * scale, y0 + len / 2, s[1] * scale);
    m.scale.y = len;
    m.rotation.set(s[4], 0, s[3]);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);

    const tipX = s[0] * scale - Math.sin(s[3]) * len;
    const tipZ = s[1] * scale + Math.sin(s[4]) * len * 0.4;
    const tipY = y0 + Math.cos(s[3]) * len;

    if (i % 2 === 0) {
      const bloom = new THREE.Mesh(bloomGeo, i === 0 ? mat('glaze_white') : i === 2 ? mat('glaze_brown') : mat('glaze_celadon'));
      bloom.position.set(tipX, tipY, tipZ);
      const bs = 0.022 * scale * (i === 0 ? 1.3 : 1);
      bloom.scale.set(bs * 1.6, bs * 0.7, bs * 1.6);
      bloom.castShadow = true;
      bloom.receiveShadow = true;
      g.add(bloom);
    }
    for (let k = 0; k < 2; k++) {
      const leaf = new THREE.Mesh(leafGeo, k === 0 ? mat('leafBright') : mat('leaf'));
      const lv = 0.35 + k * 0.3;
      leaf.position.set(tipX * lv, y0 + len * (0.35 + k * 0.28), tipZ * lv);
      leaf.scale.set(0.055 * scale, 0.006 * scale, 0.018 * scale);
      leaf.rotation.set(0.2 * (k ? 1 : -1), s[3] * 3 + k, s[3] * 0.8);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      g.add(leaf);
    }
  });
  return finishProp(g, 'ikebana', sink);
}

/**
 * Bamboo: segmented stalks with node rings and small leaves.
 * Centred on X/Z, min Y = 0.
 * @param {{h?:number,stalks?:number}} [opts]
 */
export function makeBamboo(opts = {}) {
  const h = clamp(num(opts.h, 2.2), 0.4, 6);
  const stalks = clamp(Math.round(num(opts.stalks, 3)), 1, 10);
  const g = new THREE.Group();
  g.userData.builder = 'makeBamboo';
  const sink = {};
  const r = rng(251);

  const culmR = clamp(0.020 * (h / 2.2), 0.008, 0.05);
  const segH = 0.28;
  const leafGeo = new THREE.SphereGeometry(1, 6, 4);

  for (let s = 0; s < stalks; s++) {
    const ang = (s / stalks) * Math.PI * 2 + r() * 0.5;
    const rad = stalks === 1 ? 0 : 0.035 + r() * 0.05;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const sh = h * (0.78 + r() * 0.22);
    const lean = (r() - 0.5) * 0.05;
    const segs = Math.max(2, Math.round(sh / segH));
    const actual = sh / segs;
    for (let i = 0; i < segs; i++) {
      const y = i * actual + actual / 2;
      const rr2 = culmR * (1 - (i / segs) * 0.35);
      addMeshE(g, new THREE.CylinderGeometry(rr2, rr2 * 1.04, actual * 0.965, 12, 1), mat('bambooGreen'), x + lean * i * 0.2, y, z, 0, 0, lean);
      if (i > 0) {
        addMesh(g, new THREE.TorusGeometry(rr2 * 1.06, rr2 * 0.22, 6, 12), mat('leaf'), x + lean * i * 0.2, i * actual, z);
      }
    }
    // Leaves near the top.
    const leaves = 5;
    for (let l = 0; l < leaves; l++) {
      const m = new THREE.Mesh(leafGeo, (l + s) % 2 === 0 ? mat('leafBright') : mat('leaf'));
      const a = r() * Math.PI * 2;
      const ly = sh * (0.62 + r() * 0.36);
      m.position.set(
        x + lean * (ly / actual) * 0.2 + Math.cos(a) * (0.05 + r() * 0.07),
        ly,
        z + Math.sin(a) * (0.05 + r() * 0.07)
      );
      m.scale.set(0.075, 0.005, 0.020);
      m.rotation.set((r() - 0.5) * 0.8, a, (r() - 0.5) * 0.9);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }
  return finishProp(g, 'bamboo', sink);
}

/**
 * Lucky cat: white ceramic body, raised paw, red collar with a bell, closed
 * eyes, a coin on the belly. Faces +Z. Centred on X/Z, min Y = 0.
 * @param {{h?:number}} [opts] overall height
 */
export function makeManekiNeko(opts = {}) {
  const h = clamp(num(opts.h, 0.28), 0.08, 0.9);
  const g = new THREE.Group();
  g.userData.builder = 'makeManekiNeko';
  const sink = {};
  const bodyH = h * 0.62;

  // Face plate: closed smiling eyes, whiskers, blush, drawn once.
  const face = mat('manekiFace', {
    map: canvasTex('manekiFace', 256, 256, (ctx, w, hh) => {
      ctx.fillStyle = '#f7f2e6';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(257);
      for (let i = 0; i < 90; i++) {
        const x = rr() * w;
        const y = rr() * hh;
        const rad = 6 + rr() * 26;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, 'rgba(190,178,158,0.07)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(34,28,26,0.9)';
      ctx.lineCap = 'round';
      const eyeW = w * 0.14;
      for (const ex of [w * 0.34, w * 0.66]) {
        const ey = hh * 0.52;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(ex - eyeW / 2, ey + 3);
        ctx.quadraticCurveTo(ex, ey - eyeW * 0.5, ex + eyeW / 2, ey + 3);
        ctx.stroke();
      }
      for (const nx of [w * 0.5]) {
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(nx, hh * 0.60);
        ctx.quadraticCurveTo(nx - 6, hh * 0.655, nx - 11, hh * 0.645);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nx, hh * 0.60);
        ctx.quadraticCurveTo(nx + 6, hh * 0.655, nx + 11, hh * 0.645);
        ctx.stroke();
      }
      ctx.lineWidth = 2.6;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const y0 = hh * (0.56 + i * 0.05);
          ctx.beginPath();
          ctx.moveTo(w * 0.5 + side * w * 0.17, y0);
          ctx.lineTo(w * 0.5 + side * w * 0.40, y0 + (i - 1) * 10);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(206,132,124,0.30)';
      for (const bx of [w * 0.26, w * 0.74]) {
        ctx.beginPath();
        ctx.ellipse(bx, hh * 0.66, w * 0.055, hh * 0.032, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Red collar band across the top of the sphere.
      ctx.fillStyle = '#a8262a';
      ctx.fillRect(0, hh * 0.80, w, hh * 0.075);
      ctx.fillStyle = 'rgba(255,214,150,0.45)';
      ctx.fillRect(0, hh * 0.855, w, hh * 0.012);
      speckle(ctx, w, hh, 700, 0.04, 263, 1);
    }, 1, 1, { srgb: true }),
    roughness: 0.28, metalness: 0.0
  });
  const coin = mat('manekiCoin', {
    map: canvasTex('manekiCoin', 256, 128, (ctx, w, hh) => {
      ctx.fillStyle = '#e7c265';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(269);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(${rr() > 0.5 ? '255,244,200' : '150,110,36'},${0.04 + rr() * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(rr() * w, rr() * hh, 8 + rr() * 30, 6 + rr() * 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawJPText(ctx, { text: '千万両', color: 'rgba(60,30,10,0.92)', size: 40, x: w * 0.5, y: hh * 0.5, vertical: false });
    }, 1, 1, { srgb: true }),
    roughness: 0.3, metalness: 0.85
  });

  // Body (revolution with a slight flare at the base).
  addMesh(g, latheGeo([
    [0.0, 0.0], [0.072, 0.0], [0.082, 0.012], [0.088, 0.05], [0.092, 0.09],
    [0.086, bodyH * 0.62], [0.074, bodyH * 0.82], [0.062, bodyH * 0.95], [0.055, bodyH], [0.0, bodyH * 0.99]
  ].map((p) => [p[0] * (h / 0.28), p[1] * (h / 0.28)]), 24), mat('manekiBody', {
    map: canvasTex('manekiBody', 128, 128, (ctx, w, hh) => {
      ctx.fillStyle = '#f7f2e6';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(271);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(196,184,166,${0.03 + rr() * 0.05})`;
        ctx.beginPath();
        ctx.ellipse(rr() * w, rr() * hh, 6 + rr() * 22, 6 + rr() * 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Tabby patches on the lower body.
      ctx.fillStyle = 'rgba(214,164,86,0.55)';
      ctx.beginPath();
      ctx.ellipse(w * 0.22, hh * 0.62, w * 0.16, hh * 0.09, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.74, hh * 0.78, w * 0.14, hh * 0.07, -0.2, 0, Math.PI * 2);
      ctx.fill();
      speckle(ctx, w, hh, 400, 0.04, 277, 1);
    }, 1, 1, { srgb: true }),
    roughness: 0.28, metalness: 0.0
  }), 0, 0, 0);

  const headR = 0.062 * (h / 0.28);
  const headY = bodyH + headR * 0.82;
  addMesh(g, new THREE.SphereGeometry(headR, 24, 16), face, 0, headY, 0);

  // Ears: 4-sided cones read as crisp triangles from any angle.
  const earGeo = new THREE.ConeGeometry(headR * 0.40, headR * 0.62, 4, 1);
  addMeshE(g, earGeo, mat('manekiBody'), -headR * 0.62, headY + headR * 0.74, 0, 0.1, 0.6, 0.22);
  addMeshE(g, earGeo, mat('manekiBody'), headR * 0.62, headY + headR * 0.74, 0, 0.1, 0.6, -0.22);
  const earIn = new THREE.ConeGeometry(headR * 0.22, headR * 0.34, 4, 1);
  addMeshE(g, earIn, mat('fabricZabuton'), -headR * 0.60, headY + headR * 0.70, headR * 0.10, 0.1, 0.6, 0.22);
  addMeshE(g, earIn, mat('fabricZabuton'), headR * 0.60, headY + headR * 0.70, headR * 0.10, 0.1, 0.6, -0.22);

  // Raised paw + a resting paw.
  const pawGeo = new THREE.CylinderGeometry(headR * 0.30, headR * 0.26, headR * 0.92, 14, 1);
  addMeshE(g, pawGeo, mat('manekiBody'), -0.082 * (h / 0.28), bodyH * 0.72, 0.012, 0.1, 0, 0.22);
  addMesh(g, new THREE.SphereGeometry(headR * 0.30, 14, 10), mat('manekiBody'), -0.098 * (h / 0.28), bodyH * 0.72 + headR * 0.44, 0.012);
  addMeshE(g, new THREE.CylinderGeometry(headR * 0.26, headR * 0.24, headR * 0.5, 12, 1), mat('manekiBody'), 0.062 * (h / 0.28), bodyH * 0.28, 0.03, Math.PI / 2.2, 0, 0.1);

  // Collar, bell, coin, tail.
  const collar = new THREE.TorusGeometry(headR * 0.86, headR * 0.11, 8, 22);
  collar.rotateX(Math.PI / 2);
  addMesh(g, collar, mat('manekiCollar', { color: 0xa8262a, roughness: 0.55, metalness: 0.0 }), 0, bodyH * 1.02, 0);
  addMesh(g, new THREE.SphereGeometry(headR * 0.15, 12, 10), mat('gold'), 0, bodyH * 0.94, headR * 0.62);
  const coinGeo = new THREE.CylinderGeometry(0.036 * (h / 0.28), 0.036 * (h / 0.28), 0.012 * (h / 0.28), 20, 1);
  addMeshE(g, coinGeo, coin, 0, bodyH * 0.52, 0.084 * (h / 0.28), Math.PI / 2, 0, 0);
  addMeshE(g, new THREE.TorusGeometry(headR * 0.34, headR * 0.07, 6, 14, Math.PI * 1.3), mat('manekiBody'), 0.055 * (h / 0.28), bodyH * 0.16, -0.06 * (h / 0.28), 0.4, 0.6, 1.2);
  return finishProp(g, 'manekiNeko', sink);
}

/**
 * Sake barrel (kazaridaru): staved body, straw rope wrap, red/white label.
 * Centred on X/Z, min Y = 0.
 * @param {{r?:number,h?:number}} [opts]
 */
export function makeSakeBarrel(opts = {}) {
  const r = clamp(num(opts.r, 0.32), 0.1, 0.8);
  const h = clamp(num(opts.h, 0.5), 0.15, 1.4);
  const g = new THREE.Group();
  g.userData.builder = 'makeSakeBarrel';
  const sink = {};

  const staves = 20;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const v = i / 10;
    pts.push([r * (1.0 + 0.035 * Math.sin(Math.PI * v)), v * h]);
  }
  const body = mat('barrelWood', {
    map: canvasTex('barrelWood', 256, 128, (ctx, w, hh) => {
      ctx.fillStyle = '#c8a06a';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(281);
      for (let i = 0; i < staves; i++) {
        const x = (i / staves) * w;
        ctx.fillStyle = hslToHex(0.085, 0.34, 0.44 + (rr() - 0.5) * 0.10);
        ctx.fillRect(x + 1, 0, w / staves - 2, hh);
        ctx.strokeStyle = 'rgba(58,36,16,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
        for (let k = 0; k < 12; k++) {
          ctx.strokeStyle = `rgba(${rr() > 0.5 ? '255,236,196' : '70,44,20'},${0.05 + rr() * 0.08})`;
          ctx.lineWidth = 0.8;
          const gx = x + rr() * (w / staves);
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.bezierCurveTo(gx + 2, hh * 0.33, gx - 2, hh * 0.66, gx, hh);
          ctx.stroke();
        }
      }
      // Shadow + highlight where the barrel bulges, so it does not read flat.
      const grd = ctx.createLinearGradient(0, 0, 0, hh);
      grd.addColorStop(0, 'rgba(60,36,14,0.18)');
      grd.addColorStop(0.45, 'rgba(255,236,200,0.10)');
      grd.addColorStop(1, 'rgba(60,36,14,0.20)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, hh);
      speckle(ctx, w, hh, 900, 0.05, 283, 1);
    }, 1, 1, { srgb: true }),
    roughness: 0.62, metalness: 0.02
  });
  addMesh(g, latheGeo(pts, staves * 2), body, 0, 0, 0);

  // Hoops.
  for (const v of [0.10, 0.90]) {
    const rad = r * (1.0 + 0.035 * Math.sin(Math.PI * v)) + 0.006;
    const hoop = new THREE.TorusGeometry(rad, 0.010, 6, 26);
    hoop.rotateX(Math.PI / 2);
    addMesh(g, hoop, mat('steelDark'), 0, v * h, 0);
  }
  // Straw rope wrapped round the middle.
  const ropeR = r * 1.0 + 0.028;
  const wrap = new THREE.TorusGeometry(ropeR, 0.030, 8, 30);
  wrap.rotateX(Math.PI / 2);
  addMesh(g, wrap, mat('rope'), 0, h * 0.5, 0);
  const wrap2 = new THREE.TorusGeometry(ropeR - 0.004, 0.022, 8, 30);
  wrap2.rotateX(Math.PI / 2);
  addMesh(g, wrap2, mat('rope'), 0, h * 0.5 + 0.052, 0);
  // Straw knot at the front.
  addMesh(g, new THREE.CylinderGeometry(0.022, 0.014, 0.09, 10, 1), mat('rope'), 0, h * 0.5, ropeR + 0.03);
  addMeshE(g, new THREE.TorusGeometry(0.030, 0.010, 6, 14, Math.PI * 1.6), mat('rope'), 0.02, h * 0.5 + 0.06, ropeR + 0.03, Math.PI / 2, 0, 0.4);

  // Lid + labels.
  const lidR = r * (1.0 + 0.035 * Math.sin(Math.PI)) * 0.96;
  addMesh(g, new THREE.CylinderGeometry(lidR, lidR, 0.026, 30, 1), mat('woodDark'), 0, h + 0.008, 0);
  const labelW = r * 0.85;
  addMesh(g, boxGeo(labelW, h * 0.42, 0.006, 2.4), mat('labelWhite', {
    map: canvasTex('labelWhite', 128, 128, (ctx, w, hh) => {
      ctx.fillStyle = '#f2ece0';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(293);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(180,166,140,${0.03 + rr() * 0.05})`;
        ctx.fillRect(rr() * w, rr() * hh, 6 + rr() * 22, 3 + rr() * 10);
      }
      drawJPText(ctx, { text: '正宗', color: 'rgba(150,26,26,0.95)', size: 34, x: w * 0.5, y: hh * 0.34, vertical: false });
      drawJPText(ctx, { text: '清酒', color: 'rgba(40,36,34,0.9)', size: 28, x: w * 0.5, y: hh * 0.70, vertical: false });
    }, 1, 1, { srgb: true }),
    roughness: 0.82, metalness: 0.0
  }), 0, h * 0.44, r + 0.006);
  addMesh(g, boxGeo(labelW * 0.55, h * 0.5, 0.006, 2.4), mat('labelRed', {
    map: canvasTex('labelRed', 64, 96, (ctx, w, hh) => {
      ctx.fillStyle = '#a3232a';
      ctx.fillRect(0, 0, w, hh);
      const rr = rng(307);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(${rr() > 0.5 ? '235,210,190' : '60,10,12'},${0.05 + rr() * 0.08})`;
        ctx.fillRect(rr() * w, rr() * hh, 4 + rr() * 14, 3 + rr() * 8);
      }
      drawJPText(ctx, { text: '酒', color: 'rgba(245,238,224,0.95)', size: 40, x: w * 0.5, y: hh * 0.5, vertical: false });
    }, 1, 1, { srgb: true }),
    roughness: 0.82, metalness: 0.0
  }), 0, h * 0.44, -(r + 0.006));
  return finishProp(g, 'sakeBarrel', sink);
}

/**
 * Hanging wooden signboard with carved-looking text and a rope/hook.
 * Faces +Z. Centred on X/Z, min Y = 0 (the rope hook).
 * @param {{w?:number,h?:number,text?:string}} [opts]
 */
export function makeSignboard(opts = {}) {
  const w = clamp(num(opts.w, 1.4), 0.2, 4);
  const h = clamp(num(opts.h, 0.5), 0.1, 2);
  const text = opts.text == null ? '食堂' : String(opts.text);
  const hookH = 0.26;
  const g = new THREE.Group();
  g.userData.builder = 'makeSignboard';
  const sink = {};

  const texKey = `signboard_${text}`;
  const board = mat(texKey, {
    map: canvasTex(texKey, 512, 256, (ctx, ww, hh) => {
      paintWood(ctx, ww, hh, {
        base: '#6b4a2a', rows: 3, planks: 0, hue: 0.07, sat: 0.36, light: 0.30,
        seam: 'rgba(24,12,4,0.4)', grainLines: 130, seed: 311
      });
      const chars = Array.from(text);
      const size = Math.min(hh * 0.46, (ww * 0.72) / Math.max(1, chars.length));
      ctx.save();
      ctx.font = `700 ${size}px ${JP_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const step = size * 1.14;
      const left = ww / 2 - ((chars.length - 1) * step) / 2;
      for (let i = 0; i < chars.length; i++) {
        const x = left + i * step;
        const y = hh * 0.52;
        // Carved relief: dark recess, lit lower lip, dark core.
        ctx.fillStyle = 'rgba(20,12,6,0.55)';
        ctx.fillText(chars[i], x + 2.5, y + 2.5);
        ctx.fillStyle = 'rgba(232,206,160,0.30)';
        ctx.fillText(chars[i], x - 1.5, y - 1.5);
        ctx.fillStyle = 'rgba(28,18,10,0.92)';
        ctx.fillText(chars[i], x, y);
      }
      ctx.restore();
      speckle(ctx, ww, hh, 1600, 0.05, 313, 1);
    }, 1, 1, { srgb: true }),
    roughness: 0.55, metalness: 0.02
  });

  const boardH = h;
  const boardY = hookH;
  addMesh(g, roundGeo(w, 0.05, boardH, 0.014, 1), board, 0, boardY + boardH / 2, 0);
  // Frame lip.
  addMesh(g, boxGeo(w + 0.015, 0.02, 0.058, 1.6), mat('woodDeep'), 0, boardY + boardH - 0.01, 0);
  addMesh(g, boxGeo(w + 0.015, 0.02, 0.058, 1.6), mat('woodDeep'), 0, boardY + 0.01, 0);

  // Ring, ropes and hooks.
  const ring = new THREE.TorusGeometry(0.028, 0.005, 6, 16);
  addMesh(g, ring, mat('ironBlack'), 0, hookH * 0.86, -0.03);
  const ropeGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 8, 1);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(ropeGeo, mat('rope'));
    const x0 = sx * w * 0.30;
    m.position.set(x0 * 0.62, hookH * 0.52, -0.02);
    m.rotation.z = sx * 0.52;
    m.scale.y = Math.hypot(x0 * 0.62, hookH * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    addMesh(g, new THREE.CylinderGeometry(0.007, 0.007, 0.035, 8, 1), mat('brass'), x0, boardY + boardH - 0.012, -0.012);
  }
  return finishProp(g, 'signboard', sink);
}

/**
 * Shop sign: dark backing panel, glowing glyphs drawn into a CanvasTexture,
 * plus real emissive tube meshes (straight runs and dividers) for depth.
 *
 * The glyph layout follows the panel aspect: a wide sign reads横 (side by side)
 * and a tall sign reads縦 (stacked), the same way a real shop board does.
 * Faces +Z. Centred on X/Z, min Y = 0.
 * @param {{w?:number,h?:number,text?:string}} [opts]
 */
export function makeNeonSign(opts = {}) {
  const w = clamp(num(opts.w, 1.6), 0.3, 4);
  const h = clamp(num(opts.h, 0.6), 0.15, 3);
  const text = opts.text == null ? '居酒屋' : String(opts.text);
  const chars = Array.from(text);
  const vertical = h > w * 1.15;
  const g = new THREE.Group();
  g.userData.builder = 'makeNeonSign';
  const sink = {};

  const drawSign = (ctx, ww, hh) => {
    ctx.fillStyle = '#0d1014';
    ctx.fillRect(0, 0, ww, hh);
    const rr = rng(317);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(${rr() > 0.6 ? '90,110,130' : '10,12,16'},${0.03 + rr() * 0.05})`;
      ctx.fillRect(rr() * ww, rr() * hh, 1 + rr() * 3, 1 + rr() * 3);
    }
    const n = Math.max(1, chars.length);
    const size = vertical
      ? Math.min(ww * 0.62, (hh * 0.82) / n)
      : Math.min(hh * 0.46, (ww * 0.76) / n);
    ctx.save();
    ctx.font = `700 ${size}px ${JP_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const blur of [34, 20, 10]) {
      ctx.shadowColor = 'rgba(255,80,150,0.95)';
      ctx.shadowBlur = blur;
      ctx.fillStyle = blur > 24 ? 'rgba(255,60,150,0.55)' : 'rgba(255,150,205,0.95)';
      drawJPText(ctx, { text, color: ctx.fillStyle, size, x: ww / 2, y: hh / 2, vertical });
    }
    ctx.shadowBlur = 0;
    drawJPText(ctx, { text, color: 'rgba(255,246,252,0.98)', size, x: ww / 2, y: hh / 2, vertical, stroke: 'rgba(255,120,190,0.55)', strokeWidth: 1.5 });
    ctx.restore();
    // Inner frame line, as on a real acrylic shop board.
    ctx.strokeStyle = 'rgba(255,120,190,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(ww * 0.05, hh * 0.045, ww * 0.9, hh * 0.91);
    // Glow bleed towards the panel edges.
    const grd = ctx.createRadialGradient(ww * 0.5, hh * 0.5, Math.min(ww, hh) * 0.1, ww * 0.5, hh * 0.5, Math.max(ww, hh) * 0.62);
    grd.addColorStop(0, 'rgba(255,90,170,0.12)');
    grd.addColorStop(1, 'rgba(255,90,170,0.0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, ww, hh);
  };

  // Panel aspect is baked into the texture key so both layouts are cached.
  const texKey = `neon_${vertical ? 'v' : 'h'}_${text}`;
  const canvasW = vertical ? 256 : 512;
  const canvasH = vertical ? 512 : 256;
  const panel = mat(texKey, {
    map: canvasTex(texKey, canvasW, canvasH, drawSign, 1, 1, { srgb: true }),
    emissive: new THREE.Color(0xff5fa8),
    emissiveIntensity: 0.75,
    roughness: 0.5, metalness: 0.35
  });

  const tube = mat('neonTube', {
    color: 0xffd9ee, emissive: new THREE.Color(0xff3f9c), emissiveIntensity: 2.6,
    roughness: 0.3, metalness: 0.0
  });
  const tubeWarm = mat('neonTubeWarm', {
    color: 0xffe9c4, emissive: new THREE.Color(0xffa63c), emissiveIntensity: 2.2,
    roughness: 0.3, metalness: 0.0
  });

  const panelT = 0.07;
  addMesh(g, roundGeo(w, panelT, h, 0.02, 1), panel, 0, h / 2, 0);
  addMesh(g, roundGeo(w + 0.028, 0.05, h + 0.028, 0.022, 1), mat('neonDark'), 0, h / 2, -0.02);

  // Real neon tubes laid just proud of the front face. The panel geometry is
  // 0.07 deep, so anything inside z = +/- 0.045 keeps the group centred on Z.
  const zf = panelT / 2 - 0.006;
  const tubeR = 0.010;
  if (vertical) {
    // Twin vertical runs down both edges (a cylinder is already Y-aligned),
    // plus a divider between each pair of stacked glyphs.
    const len = h - 0.10;
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.CylinderGeometry(tubeR, tubeR, len, 10, 1), sx < 0 ? tube : tubeWarm, sx * (w / 2 - 0.045), h / 2, zf);
    }
    const n = Math.max(1, chars.length);
    for (let i = 1; i < n; i++) {
      const t = new THREE.CylinderGeometry(tubeR * 0.85, tubeR * 0.85, w * 0.34, 10, 1);
      t.rotateZ(Math.PI / 2);
      addMesh(g, t, tube, 0, (i * h) / n, zf);
    }
    const cap = new THREE.TorusGeometry(Math.min(w * 0.2, 0.06), tubeR * 0.8, 6, 20);
    addMesh(g, cap, tubeWarm, 0, h * 0.5, zf);
  } else {
    // Horizontal runs above and below the glyph line, ringed at both ends.
    const len = w - 0.06;
    for (const y of [h - 0.035, 0.035]) {
      const t = new THREE.CylinderGeometry(tubeR, tubeR, len, 10, 1);
      t.rotateZ(Math.PI / 2);
      addMesh(g, t, tube, 0, y, zf);
    }
    const ringR = Math.max(0.02, Math.min(h * 0.26, ((w * 0.7) / Math.max(1, chars.length)) * 0.3));
    const ringGeo = new THREE.TorusGeometry(ringR, tubeR * 0.85, 6, 22);
    addMesh(g, ringGeo, tubeWarm, -(w / 2 - 0.075), h * 0.5, zf);
    addMesh(g, ringGeo, tubeWarm, w / 2 - 0.075, h * 0.5, zf);
  }

  // Mounting brackets, proud of the back plate and inside the panel footprint.
  for (const sx of [-1, 1]) {
    addMesh(g, boxGeo(0.028, 0.055, 0.03, 2.0), mat('steelDark'), sx * (w / 2 - 0.05), h * 0.5, -0.02);
  }
  return finishProp(g, 'neonSign', sink);
}

/**
 * Glazed ceramic pot with a leafy plant.
 * Centred on X/Z, min Y = 0.
 * @param {{r?:number}} [opts] pot rim radius
 */
export function makePlantPot(opts = {}) {
  const r = clamp(num(opts.r, 0.22), 0.06, 0.7);
  const potH = r * 0.85;
  const spread = clamp(num(opts.spread, 1), 0.4, 2.4);
  const g = new THREE.Group();
  g.userData.builder = 'makePlantPot';
  const sink = {};

  addMesh(g, latheGeo([
    [0.0, 0.0], [r * 0.68, 0.0], [r * 0.74, 0.008], [r * 0.80, potH * 0.55],
    [r * 0.94, potH * 0.90], [r, potH], [r * 0.90, potH * 0.97], [r * 0.86, potH * 0.80],
    [r * 0.74, potH * 0.5], [r * 0.70, 0.02], [0.0, 0.016]
  ], 26), mat('glaze_celadon'), 0, 0, 0);
  addMesh(g, new THREE.CylinderGeometry(r * 0.84, r * 0.82, 0.016, 20, 1), mat('soil'), 0, potH * 0.94, 0);

  const rr = rng(331);
  const stems = 7;
  const stemGeo = new THREE.CylinderGeometry(0.005, 0.007, 1, 6, 1);
  const leafGeo = new THREE.SphereGeometry(1, 8, 5);
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + rr() * 0.4;
    const tilt = 0.24 + rr() * 0.34;
    const len = (0.20 + rr() * 0.16) * spread;
    const x = Math.cos(a) * r * 0.34;
    const z = Math.sin(a) * r * 0.34;
    const m = new THREE.Mesh(stemGeo, mat('leaf'));
    m.position.set(x, potH * 0.95 + len / 2, z);
    m.scale.y = len;
    m.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    const tx = x - Math.cos(a) * Math.sin(tilt) * len * 0.8;
    const tz = z + Math.sin(a) * Math.sin(tilt) * len * 0.8;
    const ty = potH * 0.95 + Math.cos(tilt) * len;
    const leaf = new THREE.Mesh(leafGeo, i % 3 === 0 ? mat('leafBright') : mat('leaf'));
    leaf.position.set(tx, ty, tz);
    leaf.scale.set(0.085 * spread, 0.010, 0.045 * spread);
    leaf.rotation.set(0.25 * Math.sin(a), a, 0.3 * Math.cos(a));
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    g.add(leaf);
    // A second leaf lower down the stem.
    const leaf2 = new THREE.Mesh(leafGeo, i % 2 === 0 ? mat('leaf') : mat('leafBright'));
    leaf2.position.set(x * 1.4, potH * 0.95 + len * 0.45, z * 1.4);
    leaf2.scale.set(0.070 * spread, 0.008, 0.036 * spread);
    leaf2.rotation.set(-0.3 * Math.cos(a), a + 1.2, -0.35 * Math.sin(a));
    leaf2.castShadow = true;
    leaf2.receiveShadow = true;
    g.add(leaf2);
  }
  return finishProp(g, 'plantPot', sink);
}

/* ------------------------------------------------------------------ *
 * 8. Registry
 * ------------------------------------------------------------------ */

const BUILDERS = {
  woodFloor: makeWoodFloor,
  tatami: makeTatami,
  wall: makeWall,
  pillar: makePillar,
  beam: makeBeam,
  ceiling: makeCeiling,
  shoji: makeShoji,
  noren: makeNoren,
  engawa: makeEngawa,
  chabudai: makeChabudai,
  zabuton: makeZabuton,
  table: makeTable,
  chair: makeChair,
  counter: makeCounter,
  kitchenCounter: makeKitchenCounter,
  stove: makeStove,
  sink: makeSink,
  fridge: makeFridge,
  shelf: makeShelf,
  tableSetting: makeTableSetting,
  chochin: makeChochin,
  andon: makeAndon,
  kakemono: makeKakemono,
  bonsai: makeBonsai,
  ikebana: makeIkebana,
  bamboo: makeBamboo,
  manekiNeko: makeManekiNeko,
  sakeBarrel: makeSakeBarrel,
  signboard: makeSignboard,
  neonSign: makeNeonSign,
  plantPot: makePlantPot
};

/** Every registered prop id, in registry order. */
export const PROP_IDS = Object.freeze(Object.keys(BUILDERS));

/**
 * Build a prop by id.
 * @param {string} id  one of PROP_IDS
 * @param {object} [opts] forwarded to the builder
 * @returns {THREE.Group}
 * @throws {Error} when the id is unknown
 */
export function makeProp(id, opts = {}) {
  const builder = BUILDERS[id];
  if (typeof builder !== 'function') {
    throw new Error(`props.js: unknown prop id "${id}" (known: ${PROP_IDS.join(', ')})`);
  }
  return builder(opts);
}

/**
 * Bounding size of a prop without keeping the built object.
 * @param {string} id
 * @param {object} [opts]
 * @returns {{x:number,y:number,z:number}}
 */
export function propBounds(id, opts = {}) {
  const group = makeProp(id, opts);
  const b = group.userData.bounds;
  return { x: b.x, y: b.y, z: b.z };
}

/** Builder lookup table (id -> factory). Exposed for tooling/editors. */
export const PROP_BUILDERS_BY_ID = BUILDERS;
