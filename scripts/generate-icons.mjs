/**
 * Generates the FamLink PWA icon set.
 *
 * Deliberately dependency-free: the mark is rasterised with 4x supersampling
 * and written out through a minimal PNG encoder, so `npm run icons` works on a
 * clean checkout without pulling in a native image toolchain.
 *
 * The mark is a heart whose lower point doubles as a map-pin tip — family and
 * place in a single shape.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync, crc32 as nodeCrc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof nodeCrc32 === 'function') return nodeCrc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode raw RGBA (width*height*4) as a PNG buffer. */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------- geometry ---- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dot2 = (x, y) => x * x + y * y;

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a disc. */
function sdDisc(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) - radius;
}

/**
 * Signed distance to a triangle (Inigo Quilez's formulation). The heart's
 * lower half is a triangle, which is what gives the mark its pin-like point.
 */
function sdTriangle(px, py, p0, p1, p2) {
  const e0x = p1[0] - p0[0];
  const e0y = p1[1] - p0[1];
  const e1x = p2[0] - p1[0];
  const e1y = p2[1] - p1[1];
  const e2x = p0[0] - p2[0];
  const e2y = p0[1] - p2[1];

  const v0x = px - p0[0];
  const v0y = py - p0[1];
  const v1x = px - p1[0];
  const v1y = py - p1[1];
  const v2x = px - p2[0];
  const v2y = py - p2[1];

  const t0 = clamp01((v0x * e0x + v0y * e0y) / dot2(e0x, e0y));
  const t1 = clamp01((v1x * e1x + v1y * e1y) / dot2(e1x, e1y));
  const t2 = clamp01((v2x * e2x + v2y * e2y) / dot2(e2x, e2y));

  const d0 = dot2(v0x - e0x * t0, v0y - e0y * t0);
  const d1 = dot2(v1x - e1x * t1, v1y - e1y * t1);
  const d2 = dot2(v2x - e2x * t2, v2y - e2y * t2);

  // Winding sign tells us whether the point falls inside the triangle.
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const w0 = s * (v0x * e0y - v0y * e0x);
  const w1 = s * (v1x * e1y - v1y * e1x);
  const w2 = s * (v2x * e2y - v2y * e2x);

  const d = Math.min(d0, d1, d2);
  const w = Math.min(w0, w1, w2);
  return -Math.sqrt(d) * Math.sign(w);
}

/* -------------------------------------------------------------- render ---- */

const TEAL_TOP = [30, 165, 140]; // #1ea58c
const TEAL_BOTTOM = [18, 105, 93]; // #12695d

/**
 * Draw the mark into an RGBA buffer.
 *
 * @param size    output pixel size
 * @param variant 'any' keeps the rounded-square silhouette; 'maskable' bleeds
 *                the background to the edges and shrinks the glyph into the
 *                80% safe zone that launchers crop to.
 */
function render(size, variant) {
  const SS = 4; // supersampling factor per axis
  const rgba = Buffer.alloc(size * size * 4);

  // The glyph is authored in a 32x32 space; map it into the icon's safe area.
  const glyphScale = variant === 'maskable' ? 0.58 : 0.8;
  const unit = (size * glyphScale) / 32;
  const originX = (size - 32 * unit) / 2;
  const originY = (size - 32 * unit) / 2;
  const g = (x, y) => [originX + x * unit, originY + y * unit];

  // Heart-pin: two lobes unioned with a downward triangle ending in a point.
  const lobeL = g(12.4, 13.0);
  const lobeR = g(19.6, 13.0);
  const lobeRadius = 4.7 * unit;
  const triA = g(7.75, 13.9);
  const triB = g(24.25, 13.9);
  const triC = g(16, 26.4);

  const bgHalf = variant === 'maskable' ? size / 2 : (size * 0.94) / 2;
  const bgRadius = variant === 'maskable' ? 0 : size * 0.94 * (9 / 32);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let gAcc = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // Background coverage.
          const bgD = sdRoundRect(px, py, size / 2, size / 2, bgHalf, bgHalf, bgRadius);
          const bgCov = clamp01(0.5 - bgD);
          if (bgCov <= 0) continue;

          const t = clamp01(py / size);
          let cr = lerp(TEAL_TOP[0], TEAL_BOTTOM[0], t);
          let cg = lerp(TEAL_TOP[1], TEAL_BOTTOM[1], t);
          let cb = lerp(TEAL_TOP[2], TEAL_BOTTOM[2], t);

          // White glyph composited over the gradient.
          const glyphD = Math.min(
            sdDisc(px, py, lobeL[0], lobeL[1], lobeRadius),
            sdDisc(px, py, lobeR[0], lobeR[1], lobeRadius),
            sdTriangle(px, py, triA, triB, triC),
          );
          const glyphCov = clamp01(0.5 - glyphD);
          if (glyphCov > 0) {
            cr = lerp(cr, 255, glyphCov);
            cg = lerp(cg, 255, glyphCov);
            cb = lerp(cb, 255, glyphCov);
          }

          r += cr * bgCov;
          gAcc += cg * bgCov;
          b += cb * bgCov;
          a += bgCov;
        }
      }

      const samples = SS * SS;
      const alpha = a / samples;
      const i = (y * size + x) * 4;

      if (alpha > 0) {
        // Un-premultiply so edge pixels keep their colour.
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(gAcc / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round(alpha * 255);
      }
    }
  }

  return encodePng(rgba, size, size);
}

/* ---------------------------------------------------------------- main ---- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, 'any'],
  ['icon-512.png', 512, 'any'],
  ['maskable-192.png', 192, 'maskable'],
  ['maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'maskable'],
  ['favicon-32.png', 32, 'any'],
];

for (const [name, size, variant] of targets) {
  const png = render(size, variant);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log(`\nWrote ${targets.length} icons to public/icons/`);
