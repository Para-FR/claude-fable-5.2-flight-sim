// Atmosphère : diffusion Rayleigh/Mie analytique partagée par le terrain, les nuages et le ciel,
// plus le ciel étoilé et le disque solaire. Dans les shaders, les distances sont en KILOMÈTRES
// (conversion faite à l'entrée) pour rester dans la précision des flottants 32 bits.
import * as THREE from 'three';
import { R, ATM_TOP } from './config.js';

// Uniforms partagés par tous les matériaux « planétaires ».
export const shared = {
  uCamPos: { value: new THREE.Vector3() },     // position caméra / centre planète (km)
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  uCAtm: { value: 0 },                         // |cam|² - Ratm²  (km², calculé en double)
  uCPlanet: { value: 0 },                      // |cam|² - R²     (km², calculé en double)
  uExposure: { value: 1.0 },
};

export const ATM_GLSL = /* glsl */`
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uCAtm;
uniform float uCPlanet;
uniform float uExposure;
const float ATM_R = ${(R / 1000).toFixed(1)};
const float ATM_HR = 8.0;
const float ATM_HM = 1.2;
const vec3 ATM_BR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const float ATM_BM = 2.4e-3;
const float ATM_BME = 2.7e-3;
const float ATM_SUN = 22.0;

// Fonction de Chapman approchée : épaisseur optique vers le soleil, en hauteurs d'échelle.
float atmChapman(float X, float h, float c) {
  float s = sqrt(1.5708 * (X + h));
  if (c >= 0.0) return s / (s * c + 1.0) * exp(-h);
  float x0 = sqrt(max(1.0 - c * c, 0.0)) * (X + h);
  float s0 = sqrt(1.5708 * x0);
  return 2.0 * s0 * exp(min(X - x0, 40.0)) - s / (1.0 - s * c) * exp(-h);
}

// Transmittance du soleil jusqu'à un point de rayon r (km) ; cs = cos de l'angle zénithal solaire.
vec3 atmSunT(float r, float cs) {
  float h = max(r - ATM_R, 0.0);
  float oR = ATM_HR * atmChapman(ATM_R / ATM_HR, h / ATM_HR, cs);
  float oM = ATM_HM * atmChapman(ATM_R / ATM_HM, h / ATM_HM, cs);
  float hc = -sqrt(max(1.0 - (ATM_R * ATM_R) / (r * r), 0.0));
  return exp(-(ATM_BR * oR + ATM_BME * oM)) * smoothstep(hc - 0.012, hc + 0.012, cs);
}

// Lumière diffusée vers la caméra le long du rayon [t0, t1] ; trans = transmittance du trajet.
vec3 atmScatter(vec3 ro, vec3 rd, float t0, float t1, out vec3 trans) {
  float dt = (t1 - t0) / float(ATM_STEPS);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < ATM_STEPS; i++) {
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    float r = length(p);
    float h = max(r - ATM_R, 0.0);
    float dR = exp(-h / ATM_HR) * dt;
    float dM = exp(-h / ATM_HM) * dt;
    odR += dR * 0.5; odM += dM * 0.5;
    vec3 att = exp(-(ATM_BR * odR + ATM_BME * odM)) * atmSunT(r, dot(p, uSunDir) / r);
    sumR += att * dR; sumM += att * dM;
    odR += dR * 0.5; odM += dM * 0.5;
  }
  trans = exp(-(ATM_BR * odR + ATM_BME * odM));
  float mu = dot(rd, uSunDir);
  float pR = 0.0596831 * (1.0 + mu * mu);
  float g = 0.76;
  float pM = 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  return ATM_SUN * (sumR * ATM_BR * pR + sumM * ATM_BM * pM);
}

// Perspective aérienne appliquée à une couleur de surface vue à la distance dist (km).
vec3 atmApply(vec3 col, vec3 rd, float dist) {
  float b = dot(uCamPos, rd);
  float t0 = 0.0;
  if (uCAtm > 0.0) {
    float disc = b * b - uCAtm;
    if (disc <= 0.0) return col;
    t0 = max(-b - sqrt(disc), 0.0);
  }
  if (dist <= t0) return col;
  vec3 trans;
  vec3 ins = atmScatter(uCamPos, rd, t0, dist, trans);
  return col * trans + ins;
}

vec3 atmTonemap(vec3 c) {
  c = 1.0 - exp(-c * uExposure);
  return pow(c, vec3(0.4545));
}
`;

// --- Version JS de la transmittance solaire (pour éclairer l'avion et teinter le soleil) ---
function chapman(X, h, c) {
  const s = Math.sqrt(1.5708 * (X + h));
  if (c >= 0) return s / (s * c + 1) * Math.exp(-h);
  const x0 = Math.sqrt(Math.max(1 - c * c, 0)) * (X + h);
  const s0 = Math.sqrt(1.5708 * x0);
  return 2 * s0 * Math.exp(Math.min(X - x0, 40)) - s / (1 - s * c) * Math.exp(-h);
}
const BR = [5.8e-3, 13.5e-3, 33.1e-3];
export function sunTransmittance(rMeters, cs, out) {
  const rk = rMeters / 1000, Rk = R / 1000;
  const h = Math.max(rk - Rk, 0);
  const oR = 8.0 * chapman(Rk / 8.0, h / 8.0, cs);
  const oM = 1.2 * chapman(Rk / 1.2, h / 1.2, cs);
  const hc = -Math.sqrt(Math.max(1 - (Rk * Rk) / (rk * rk), 0));
  let s = (cs - (hc - 0.012)) / 0.024;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  s = s * s * (3 - 2 * s);
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-(BR[i] * oR + 2.7e-3 * oM)) * s;
  return out;
}

// --- Ciel : sphère centrée sur la caméra, intégrale de diffusion par pixel ---
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #define ATM_STEPS 12
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${ATM_GLSL}
      varying vec3 vDir;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 rd = normalize(vDir);
        float b = dot(uCamPos, rd);
        float disc = b * b - uCAtm;
        if (disc <= 0.0) discard;
        float sq = sqrt(disc);
        float t0 = max(-b - sq, 0.0);
        float t1 = -b + sq;
        if (t1 <= t0) discard;
        float dp = b * b - uCPlanet;
        if (dp > 0.0 && b < 0.0) t1 = min(t1, -b - sqrt(dp));
        vec3 trans;
        vec3 c = atmScatter(uCamPos, rd, t0, t1, trans);
        c = atmTonemap(c);
        float a = clamp(max(c.r, max(c.g, c.b)) * 2.5, 0.0, 1.0);
        gl_FragColor = vec4(c, a);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  mesh.scale.setScalar(4e8);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// --- Étoiles ---
export function createStars(count = 7000) {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
  const band = new THREE.Vector3(0.35, 0.8, 0.48).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    for (;;) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, q = Math.sqrt(1 - z * z);
      v.set(q * Math.cos(a), z, q * Math.sin(a));
      // ~35 % des étoiles concentrées près d'un grand cercle (« voie lactée »)
      if (i % 3 !== 0 || Math.abs(v.dot(band)) < 0.12 + rnd() * 0.1) break;
    }
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const m = Math.pow(rnd(), 3.2);
    const b = 0.35 + 0.65 * m;
    const tint = rnd();
    col[i * 3] = b * (tint < 0.3 ? 1.0 : 0.85);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (tint > 0.6 ? 1.0 : 0.82);
    size[i] = 1.2 + 2.4 * m;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSize; attribute vec3 aColor; uniform float uPx; varying vec3 vC;
      void main() {
        vC = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() {
        float a = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.scale.setScalar(3e8);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}

// --- Disque solaire (texture générée sur un canvas) ---
export function createSun() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.06, 'rgba(255,252,240,1)');
  grad.addColorStop(0.09, 'rgba(255,240,200,0.55)');
  grad.addColorStop(0.3, 'rgba(255,220,160,0.12)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(3e8 * 0.16);
  sp.renderOrder = 2;
  sp.frustumCulled = false;
  return sp;
}

export const ATM_TOP_KM = (R + ATM_TOP) / 1000;
