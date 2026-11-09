// Définition procédurale de la planète : altitude et couleur en tout point de la sphère.
// Module partagé par le thread principal (collisions, mini-globe) et les workers (maillage).
import { noise3 } from './noise.js';
import { DEG } from './config.js';

const HALF_PI = Math.PI / 2;

function sstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Somme fractale. Les octaves de fréquence > maxF sont ignorées (détail adaptatif).
function fbm(x, y, z, f, oct, maxF) {
  let a = 1, s = 0;
  for (let i = 0; i < oct && f <= maxF; i++) {
    s += a * noise3(x * f, y * f, z * f);
    a *= 0.5;
    f *= 2.03;
  }
  return s;
}

// Bruit « crêté » pour les chaînes de montagnes. Résultat dans [0, ~1].
function ridged(x, y, z, f, oct, maxF) {
  let a = 0.5, s = 0, w = 1;
  for (let i = 0; i < oct && f <= maxF; i++) {
    let n = 1 - Math.abs(noise3(x * f, y * f, z * f));
    n *= n * w;
    w = n * 2;
    if (w > 1) w = 1;
    s += n * a;
    a *= 0.5;
    f *= 2.07;
  }
  return s;
}

// Projection cube -> sphère (faces à angles égaux). u, v dans [-1, 1].
export function faceDir(face, u, v, out) {
  const a = Math.tan(u * Math.PI / 4), b = Math.tan(v * Math.PI / 4);
  let x, y, z;
  switch (face) {
    case 0: x = 1; y = b; z = -a; break;
    case 1: x = -1; y = b; z = a; break;
    case 2: x = a; y = 1; z = -b; break;
    case 3: x = a; y = -1; z = b; break;
    case 4: x = a; y = b; z = 1; break;
    default: x = -a; y = b; z = -1; break;
  }
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  out[0] = x * l; out[1] = y * l; out[2] = z * l;
  return out;
}

// Convention : axe Y = axe des pôles ; longitude = atan2(-z, x), positive vers l'est.
export function dirFromLatLon(lat, lon, out) {
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -c * Math.sin(lon);
  return out;
}

// Altitude du terrain (m) par rapport au niveau de la mer, pour une direction unitaire.
// Négatif = fond océanique. maxF limite le détail (fréquence max sur la sphère unité).
export function terrainHeight(x, y, z, maxF = Infinity) {
  const wx = noise3(x * 1.7 + 11.3, y * 1.7 + 5.1, z * 1.7 - 7.7);
  const wy = noise3(x * 1.7 - 31.9, y * 1.7 + 17.3, z * 1.7 + 3.3);
  const wz = noise3(x * 1.7 + 2.9, y * 1.7 - 23.1, z * 1.7 + 41.7);
  const qx = x + 0.16 * wx, qy = y + 0.16 * wy, qz = z + 0.16 * wz;

  // Continents
  const c = fbm(qx + 3.1, qy - 1.7, qz + 8.3, 1.3, 10, maxF) - 0.07;
  if (c < -0.14) return -Math.min(6000, 300 * -c + 6000 * c * c);

  const land = sstep(-0.14, 0.03, c);
  const base = c > 0 ? 150 * c + 1800 * c * c : -(300 * -c + 6000 * c * c);

  // Chaînes de montagnes
  const mm = fbm(x - 7.7, y + 2.2, z + 13.1, 2.4, 3, maxF);
  const mMask = sstep(0.0, 0.5, mm) * land;
  const mountains = mMask > 0.002 ? ridged(qx, qy, qz, 60, 13, maxF) * 7000 * mMask : 0;

  // Collines et micro-relief
  const hills = fbm(x + 17, y + 29, z - 11, 150, 4, maxF) * 110 * land * (0.4 + 0.6 * sstep(0.02, 0.3, c));
  const inner = 0.3 + 0.7 * sstep(0.02, 0.3, c);
  const hills2 = fbm(x + 5, y - 13, z + 37, 700, 3, maxF) * 45 * land * inner;
  const detail = fbm(x - 41, y + 7, z + 23, 2500, 9, maxF) * (22 + 70 * mMask) * land;

  return base + mountains + hills + hills2 + detail;
}

function mix3(out, r, g, b, t) {
  out[0] += (r - out[0]) * t;
  out[1] += (g - out[1]) * t;
  out[2] += (b - out[2]) * t;
}

const _c = [0, 0, 0];

// Couleur de l'eau selon la profondeur d (m). Même dégradé que dans le shader du terrain.
export function waterColor(out, o, d) {
  const c = _c;
  c[0] = 34; c[1] = 124; c[2] = 138;                           // lagon
  mix3(c, 14, 64, 112, sstep(0, 180, d));                      // plateau continental
  mix3(c, 6, 24, 62, sstep(120, 3500, d));                     // grands fonds
  out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
}

// Couleur du sol (sRGB 0-255) écrite dans out[o..o+2]. Sous le niveau de la mer, on écrit la
// couleur du fond (sable) ou de la banquise ; out[o+3] = 255 × taux de banquise.
// h : altitude (m), slope : 1 - cos(angle entre la normale et la verticale).
export function terrainColor(out, o, x, y, z, h, slope, maxF = Infinity) {
  const absLat = Math.asin(Math.min(1, Math.abs(y))) / HALF_PI;   // 0 équateur .. 1 pôle
  const latDeg = absLat * 90;
  const tn = noise3(x * 4 + 9.1, y * 4 - 3.3, z * 4 + 1.7) * 0.6 + noise3(x * 17 - 2.3, y * 17 + 8.8, z * 17 + 4.1) * 0.4;
  const hl = h > 0.5 ? h : 0.5;
  const T = 27 - 50 * Math.pow(absLat, 1.7) + tn * 5 - hl * 0.0065;   // °C approx.
  const c = _c;
  let ice = 0;

  let m = 0.5 + 0.45 * (noise3(x * 3.1 + 40, y * 3.1 - 12, z * 3.1 + 6) * 0.7 + noise3(x * 9.7 - 5, y * 9.7 + 31, z * 9.7 - 17) * 0.3);
  const dl = (latDeg - 24) / 9, el = latDeg / 9;
  m += -0.28 * Math.exp(-dl * dl) + 0.2 * Math.exp(-el * el);
  const warm = sstep(8, 22, T);
  const cold = sstep(4, -6, T);
  const dry = sstep(0.45, 0.25, m);
  const wet = sstep(0.5, 0.75, m);

  // Tempéré : prairie -> forêt, steppe si sec
  let r = 96, g = 128, b = 62;
  r += (44 - r) * wet; g += (84 - g) * wet; b += (42 - b) * wet;
  r += (152 - r) * dry; g += (142 - g) * dry; b += (88 - b) * dry;
  // Chaud : savane -> jungle, désert si sec
  let hr = 142, hg = 138, hb = 70;
  hr += (30 - hr) * wet; hg += (86 - hg) * wet; hb += (36 - hb) * wet;
  const dd = Math.sqrt(dry);
  hr += (214 - hr) * dd; hg += (178 - hg) * dd; hb += (122 - hb) * dd;
  c[0] = r + (hr - r) * warm; c[1] = g + (hg - g) * warm; c[2] = b + (hb - b) * warm;

  mix3(c, 118, 112, 88, cold);                                 // toundra
  const rock = sstep(0.06, 0.22, slope);
  const hotDry = warm * dry;
  mix3(c, 112 + 40 * hotDry, 104 + 6 * hotDry, 98 - 14 * hotDry, rock);   // roche
  mix3(c, 216, 202, 162, sstep(14, 3, hl) * (1 - rock));       // plage
  const snow = sstep(-3, -9, T) * (1 - 0.7 * sstep(0.25, 0.5, slope));
  mix3(c, 244, 246, 250, snow);                                // neige / calotte

  let v = 1;
  if (maxF >= 900) v += 0.09 * noise3(x * 900 + 3, y * 900 - 8, z * 900 + 5);
  if (maxF >= 6000) v += 0.08 * noise3(x * 6000 - 6, y * 6000 + 2, z * 6000 - 9);
  if (maxF >= 40000) v += 0.08 * noise3(x * 40000 + 1, y * 40000 - 4, z * 40000 + 7);
  if (maxF >= 250000) v += 0.07 * noise3(x * 250000 - 2, y * 250000 + 9, z * 250000 + 3);
  c[0] *= v; c[1] *= v; c[2] *= v;

  if (h <= 0) {
    ice = sstep(-9, -13, T);                                   // banquise
    mix3(c, 228, 236, 244, ice);
  }
  out[o] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
  out[o + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
  out[o + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
  out[o + 3] = ice * 255;
}

// Cherche une côte tempérée pour le point de départ. Retourne { lat, lon } en radians.
export function findCoastStart() {
  const d = [0, 0, 0], col = [0, 0, 0, 0];
  const H = (lat, lon) => {
    dirFromLatLon(lat * DEG, lon * DEG, d);
    return terrainHeight(d[0], d[1], d[2], 500);
  };
  for (const lat of [36, 30, 42, 24, -34, 48, 18, -26, 12, 0, -42, 54]) {
    for (let lon = -180; lon < 180; lon += 0.4) {
      const a = H(lat, lon), b = H(lat, lon + 0.4);
      if (a < -30 && b > 15 && b < 700) {
        const inland = H(lat, lon + 1.2);
        dirFromLatLon(lat * DEG, (lon + 1.2) * DEG, d);
        terrainColor(col, 0, d[0], d[1], d[2], 200, 0, 200);
        const green = col[1] > col[0] + 12;
        if (green && inland > 20 && inland < 1500 && H(lat, lon - 1.5) < -50) {
          let lo = lon, hi = lon + 0.4;
          for (let i = 0; i < 14; i++) {
            const mid = (lo + hi) / 2;
            if (H(lat, mid) < 0) lo = mid; else hi = mid;
          }
          return { lat: lat * DEG, lon: ((lo + hi) / 2) * DEG };
        }
      }
    }
  }
  return { lat: 36 * DEG, lon: 0 };
}
