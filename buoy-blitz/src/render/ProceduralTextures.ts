import * as THREE from 'three';

/* ---------------- noise helpers ---------------- */

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise on a grid of `period` cells. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smoothstep(x - xi);
  const fy = smoothstep(y - yi);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, octaves: number, basePeriod: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let period = basePeriod;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * period, v * period, period, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/* ---------------- water detail ---------------- */

export function makeWaterNormalMap(size = 256, strength = 2.2): THREE.DataTexture {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, 5, 4, 7) * 0.7 + fbm(u + 0.37, v + 0.11, 3, 12, 91) * 0.3;
      heights[y * size + x] = n;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = heights[y * size + ((x - 1 + size) % size)];
      const r = heights[y * size + ((x + 1) % size)];
      const d = heights[((y - 1 + size) % size) * size + x];
      const u = heights[((y + 1) % size) * size + x];
      let nx = (l - r) * strength * size * 0.02;
      let ny = (d - u) * strength * size * 0.02;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const nz = 1 / len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeFoamTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = fbm(u, v, 5, 6, 3);
      const b = fbm(u * 1.0 + 0.5, v + 0.25, 4, 14, 41);
      // ridged look: bubbles / lace
      let n = 1 - Math.abs(a * 2 - 1);
      n = Math.pow(n, 1.6) * 0.65 + b * 0.35;
      const val = Math.round(Math.min(1, Math.max(0, n)) * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------- canvas helpers ---------------- */

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function hex(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Skin for the inflatable tube. u runs along the tube, v around it (v=0.5 is the outer side). */
export function makeTubeTexture(main: number, accent: number): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = hex(main);
    ctx.fillRect(0, 0, 1024, 256);
    // subtle vinyl sheen noise
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 256, 3, 3);
    }
    // top stripe (accent) around v ~ 0.72..0.82 (top of tube)
    ctx.fillStyle = hex(accent);
    ctx.fillRect(0, 172, 1024, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 196, 1024, 6);
    // rope line on outer side
    ctx.strokeStyle = 'rgba(255,245,220,0.95)';
    ctx.lineWidth = 7;
    ctx.setLineDash([16, 8]);
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.lineTo(1024, 128);
    ctx.stroke();
    ctx.setLineDash([]);
    // seams every 128px along u
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 3;
    for (let x = 0; x < 1024; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    // valve dots
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(64, 180, 9, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Beach-ball style skin with colored panels + a friendly star. */
export function makeBallTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 512, (ctx) => {
    const colors = ['#ff4d5a', '#ffffff', '#2f8cff', '#ffffff', '#ffd23f', '#ffffff', '#3fd07a', '#ffffff'];
    const w = 1024 / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * w, 0, w + 1, 512);
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= colors.length; i++) {
      ctx.beginPath();
      ctx.moveTo(i * w, 0);
      ctx.lineTo(i * w, 512);
      ctx.stroke();
    }
    // glossy vinyl speckle
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 512, 3, 3);
    }
    // stars on white panels
    ctx.fillStyle = 'rgba(255,190,60,0.9)';
    for (let i = 1; i < colors.length; i += 2) {
      const cx = i * w + w / 2;
      for (const cy of [140, 372]) {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 === 0 ? 30 : 13;
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

/** Pool floor: tiles with grout, halfway line, center circle, team goal boxes. World size passed for correct proportions. */
export function makePoolFloorTexture(width: number, length: number, blue: number, orange: number): THREE.CanvasTexture {
  const scale = 24; // px per meter
  const W = Math.round(width * scale);
  const L = Math.round(length * scale);
  return canvasTexture(W, L, (ctx) => {
    ctx.fillStyle = '#c9e6f0';
    ctx.fillRect(0, 0, W, L);
    const tile = scale * 1.0;
    for (let y = 0; y < L; y += tile) {
      for (let x = 0; x < W; x += tile) {
        const n = hash2(x, y, 5);
        const shade = 190 + Math.floor(n * 45);
        ctx.fillStyle = `rgb(${shade - 30},${shade + 20},${shade + 40})`;
        ctx.fillRect(x + 1.5, y + 1.5, tile - 3, tile - 3);
      }
    }
    // markings
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = scale * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, L / 2);
    ctx.lineTo(W, L / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, L / 2, scale * 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(W / 2, L / 2, scale * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // goal boxes (blue at -Z => top of texture, since v=1 maps to +Z we flip later by orientation)
    const boxW = scale * 26;
    const boxD = scale * 10;
    ctx.lineWidth = scale * 0.3;
    ctx.strokeStyle = hex(blue);
    ctx.fillStyle = hex(blue) + '33';
    ctx.fillRect(W / 2 - boxW / 2, 0, boxW, boxD);
    ctx.strokeRect(W / 2 - boxW / 2, 0, boxW, boxD);
    ctx.strokeStyle = hex(orange);
    ctx.fillStyle = hex(orange) + '33';
    ctx.fillRect(W / 2 - boxW / 2, L - boxD, boxW, boxD);
    ctx.strokeRect(W / 2 - boxW / 2, L - boxD, boxW, boxD);
    // lane dots
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 1; i < 6; i++) {
      const x = (W / 6) * i;
      for (let y = scale * 4; y < L; y += scale * 6) {
        ctx.beginPath();
        ctx.arc(x, y, scale * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

export function makeSandTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#c8b58a';
    ctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x += 2) {
        const n = fbm(x / 512, y / 512, 4, 8, 23);
        ctx.fillStyle = `rgba(${90 + n * 60},${70 + n * 60},${30 + n * 50},${0.25 + n * 0.3})`;
        ctx.fillRect(x, y, 2, 1);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Transparent goal net texture. */
export function makeNetTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    const step = 32;
    for (let i = 0; i <= 256; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Faint hex/grid pattern used on the glass walls. */
export function makeGlassPanelTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 254);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.lineTo(256, 128);
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 256);
    ctx.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Striped bumper skin for the pool-edge inflatable. */
export function makeBumperTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 128, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#ff5a6e';
      ctx.fillRect(i * 64, 0, 64, 128);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 128, 3, 3);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Soft round sprite for particles. */
export function makeParticleSprite(): THREE.CanvasTexture {
  const tex = canvasTexture(
    64,
    64,
    (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    },
    false,
  );
  return tex;
}

/** Foam ribbon texture for wake trails (alpha fades across width). */
export function makeWakeTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(
    128,
    128,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
        ctx.beginPath();
        ctx.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    false,
  );
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
