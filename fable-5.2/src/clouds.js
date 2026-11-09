// Couche nuageuse : coquille sphérique découpée en tuiles (sommets relatifs à leur centre),
// densité procédurale calculée par pixel, qui dérive lentement autour de l'axe des pôles.
import * as THREE from 'three';
import { R, CLOUD_ALT } from './config.js';
import { faceDir } from './terrain.js';
import { shared, ATM_GLSL } from './atmosphere.js';

export class Clouds {
  constructor(scene) {
    this.uniforms = { ...shared, uTime: { value: 0 }, uOct: { value: 5 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aDir;
        varying vec3 vDir;
        varying vec3 vView;
        void main() {
          vDir = aDir;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #define ATM_STEPS 6
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${ATM_GLSL}
        uniform float uTime;
        uniform int uOct;
        varying vec3 vDir;
        varying vec3 vView;
        float cHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float cNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x),
                         mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x),
                         mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float cFbm(vec3 p, int oct) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 8; i++) {
            if (i >= oct) break;
            s += a * cNoise(p);
            p = p * 2.02 + vec3(13.1, 7.7, 3.3);
            a *= 0.5;
          }
          return s;
        }
        void main() {
          #include <logdepthbuf_fragment>
          float dist = length(vView) * 0.001;
          vec3 rd = normalize((vec4(vView, 0.0) * viewMatrix).xyz);
          vec3 d = normalize(vDir);
          float ang = uTime * 4.0e-5;
          float ca = cos(ang), sa = sin(ang);
          vec3 p = vec3(ca * d.x - sa * d.z, d.y, sa * d.x + ca * d.z);
          float big = cFbm(p * 3.0 + 5.0, 4);
          float det = cFbm(p * 24.0 + vec3(0.0, uTime * 2.0e-4, 0.0), uOct);
          float dens = big * 0.62 + det * 0.38;
          float a = smoothstep(0.535, 0.67, dens);
          a *= smoothstep(0.15, 2.5, dist);
          if (a < 0.004) discard;
          vec3 P = uCamPos + rd * dist;
          float r = length(P);
          float cs = dot(P / r, uSunDir);
          vec3 sunT = atmSunT(r, cs);
          float day = smoothstep(-0.12, 0.15, cs);
          vec3 amb = vec3(0.22, 0.27, 0.36) * day + vec3(0.004, 0.005, 0.008);
          vec3 col = sunT * 2.6 * (1.0 - 0.3 * smoothstep(0.5, 1.0, a)) + amb;
          col = atmApply(col, rd, dist);
          gl_FragColor = vec4(atmTonemap(col), a * 0.95);
        }`,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });

    this.group = new THREE.Group();
    const CH = 4, SEG = 32, rad = R + CLOUD_ALT;
    const d = [0, 0, 0];
    const idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
    const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    for (let f = 0; f < 6; f++) for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CH; cx++) {
      const du = 2 / CH, u0 = -1 + cx * du, v0 = -1 + cy * du;
      faceDir(f, u0 + du / 2, v0 + du / 2, d);
      const ox = d[0] * rad, oy = d[1] * rad, oz = d[2] * rad;
      const pos = new Float32Array((SEG + 1) * (SEG + 1) * 3);
      const dirs = new Float32Array((SEG + 1) * (SEG + 1) * 3);
      let k = 0;
      for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
        faceDir(f, u0 + (i / SEG) * du, v0 + (j / SEG) * du, d);
        pos[k] = d[0] * rad - ox; pos[k + 1] = d[1] * rad - oy; pos[k + 2] = d[2] * rad - oz;
        dirs[k] = d[0]; dirs[k + 1] = d[1]; dirs[k + 2] = d[2];
        k += 3;
      }
      const geo = new THREE.BufferGeometry();
      geo.setIndex(index);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(ox, oy, oz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = 3;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(time, camAlt) {
    this.uniforms.uTime.value = time;
    this.uniforms.uOct.value = camAlt < 40000 ? 8 : camAlt < 300000 ? 6 : 5;
  }
}
