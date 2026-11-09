// Planète : quadtree sur cube-sphère à niveau de détail adaptatif (« chunked LOD »).
// Chaque tuile est générée dans un worker, avec des sommets relatifs à son propre centre
// (précision float32 préservée malgré le rayon de 6371 km).
import * as THREE from 'three';
import { R, PATCH_N as N, MIN_LEVEL, MAX_LEVEL, LOD_K, MAX_TERRAIN_H } from './config.js';
import { faceDir } from './terrain.js';
import { shared, ATM_GLSL } from './atmosphere.js';

const _d = [0, 0, 0];

class Node {
  constructor(face, level, u0, v0, du) {
    this.face = face; this.level = level; this.u0 = u0; this.v0 = v0; this.du = du;
    this.sizeM = (Math.PI / 2 * R) / (1 << level);
    faceDir(face, u0 + du / 2, v0 + du / 2, _d);
    this.center = new THREE.Vector3(_d[0] * R, _d[1] * R, _d[2] * R);
    let rad = 0;
    for (let k = 0; k < 4; k++) {
      faceDir(face, u0 + (k & 1) * du, v0 + (k >> 1) * du, _d);
      const dx = _d[0] * R - this.center.x, dy = _d[1] * R - this.center.y, dz = _d[2] * R - this.center.z;
      rad = Math.max(rad, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    this.radius = rad;
    this.mesh = null;
    this.children = null;
    this.inflight = false;
    this.dead = false;
    this.prio = 0;
  }
}

function buildIndex() {
  const idx = [];
  const W = N + 1, NV = W * W;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const edge = (e, t) => (e === 0 ? t : e === 1 ? N * W + t : e === 2 ? t * W : t * W + N);
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < N; t++) {
      const a = edge(e, t), b = edge(e, t + 1), sa = NV + e * W + t, sb = sa + 1;
      idx.push(a, sa, b, b, sa, sb);
    }
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

function createTerrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aNormal;
      attribute vec4 aColor;
      attribute float aH;
      attribute vec3 aDet;
      varying vec3 vDet;
      varying vec3 vNormal;
      varying vec4 vColor;
      varying vec3 vView;
      varying float vH;
      void main() {
        vH = aH;
        vDet = aDet;
        vNormal = aNormal;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #define ATM_STEPS 7
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${ATM_GLSL}
      varying vec3 vNormal;
      varying vec4 vColor;
      varying vec3 vView;
      varying float vH;
      varying vec3 vDet;
      // Bruit de valeur 3D périodique (période en cellules) : détail de surface par pixel.
      float dHash(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float dNoise(vec3 x, float per) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        #define DH(o) dHash(mod(i + o, per))
        return mix(mix(mix(DH(vec3(0, 0, 0)), DH(vec3(1, 0, 0)), f.x), mix(DH(vec3(0, 1, 0)), DH(vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(DH(vec3(0, 0, 1)), DH(vec3(1, 0, 1)), f.x), mix(DH(vec3(0, 1, 1)), DH(vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float dOct(float cell, float dm, out float w) {
        w = 1.0 - smoothstep(cell * 90.0, cell * 320.0, dm);
        if (w <= 0.0) return 0.5;
        return dNoise(vDet / cell, 2048.0 / cell);
      }
      void main() {
        #include <logdepthbuf_fragment>
        float dist = length(vView) * 0.001;
        vec3 rd = normalize((vec4(vView, 0.0) * viewMatrix).xyz);
        vec3 P = uCamPos + rd * dist;
        float r = length(P);
        vec3 up = P / r;
        vec3 n = normalize(vNormal);
        float cs = dot(up, uSunDir);
        vec3 sunT = atmSunT(r, cs);
        float ndl = max(dot(n, uSunDir), 0.0);
        float day = smoothstep(-0.12, 0.15, cs);
        // Le trait de côte est décidé par pixel (altitude interpolée), pas par sommet.
        vec3 base = vColor.rgb;
        float water = (vH < 0.0) ? 1.0 - vColor.a : 0.0;
        if (water > 0.0) {
          float d = -vH;
          vec3 wc = mix(vec3(0.133, 0.486, 0.541), vec3(0.055, 0.251, 0.439), smoothstep(0.0, 180.0, d));
          wc = mix(wc, vec3(0.024, 0.094, 0.243), smoothstep(120.0, 3500.0, d));
          wc = mix(base * 0.75, wc, smoothstep(0.0, 5.0, d));
          base = mix(base, wc, water);
          n = normalize(mix(n, up, water));
        }
        else {
          // Détail procédural proche : grain du sol et bosquets, estompés avec la distance.
          float dm = dist * 1000.0;
          float w1, w4, w16, w64, w256;
          float n1 = dOct(1.0, dm, w1), n4 = dOct(4.0, dm, w4), n16 = dOct(16.0, dm, w16);
          float n64 = dOct(64.0, dm, w64), n256 = dOct(256.0, dm, w256);
          float det = w1 * (n1 - 0.5) * 0.22 + w4 * (n4 - 0.5) * 0.28 + w16 * (n16 - 0.5) * 0.32
                    + w64 * (n64 - 0.5) * 0.30 + w256 * (n256 - 0.5) * 0.24;
          float veg = smoothstep(0.02, 0.10, base.g - max(base.r, base.b));
          float clump = smoothstep(0.50, 0.60, n16 * 0.55 + n4 * 0.3 + n64 * 0.15) * w16;
          base *= (1.0 + det) * (1.0 - 0.38 * veg * clump);
        }
        vec3 albedo = pow(base, vec3(2.2));
        vec3 amb = vec3(0.10, 0.15, 0.24) * day + vec3(0.0035, 0.0045, 0.007);
        vec3 col = albedo * (sunT * ndl * 4.5 + amb);
        if (water > 0.5) {
          vec3 hv = normalize(uSunDir - rd);
          float nh = max(dot(n, hv), 0.0);
          float spec = pow(nh, 400.0) * 6.0 + pow(nh, 40.0) * 0.25;
          float fres = 0.02 + 0.5 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
          col += sunT * spec + vec3(0.25, 0.42, 0.65) * fres * day;
        }
        col = atmApply(col, rd, dist);
        gl_FragColor = vec4(atmTonemap(col), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}

export class Planet {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = createTerrainMaterial();
    this.index = buildIndex();
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(f, 0, -1, -1, 2));
    this.jobs = new Map();
    this.nextId = 1;
    this.queue = [];
    this.inflight = 0;
    this.pending = 1;
    this.patchCount = 0;

    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this.onResult(w, e.data);
      this.workers.push(w);
    }
    this._cam = new THREE.Vector3();
    this._lod = new THREE.Vector3();
    this._horizon = 0;
  }

  onResult(worker, data) {
    worker.busy = false;
    this.inflight--;
    const node = this.jobs.get(data.id);
    this.jobs.delete(data.id);
    if (!node) return;
    node.inflight = false;
    if (node.dead) return;
    const geo = new THREE.BufferGeometry();
    geo.setIndex(this.index);
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aNormal', new THREE.BufferAttribute(data.normals, 3, true));
    geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 4, true));
    geo.setAttribute('aH', new THREE.BufferAttribute(data.heights, 1));
    geo.setAttribute('aDet', new THREE.BufferAttribute(data.detail, 3));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(data.center[0], data.center[1], data.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    node.mesh = mesh;
    this.group.add(mesh);
    this.patchCount++;
  }

  disposeChildren(node) {
    for (const c of node.children) {
      if (c.children) this.disposeChildren(c);
      c.dead = true;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
        this.patchCount--;
      }
    }
    node.children = null;
  }

  enqueue(node, bias) {
    if (node.mesh || node.inflight) return;
    node.prio = Math.max(0, this._lod.distanceTo(node.center) - node.radius) / node.sizeM + bias;
    this.queue.push(node);
  }

  visit(node) {
    const d = Math.max(0, this._lod.distanceTo(node.center) - node.radius);
    const culled = this._cam.distanceTo(node.center) - node.radius > this._horizon;
    const forced = node.level < MIN_LEVEL;
    const split = forced || (!culled && node.level < MAX_LEVEL &&
      d < node.sizeM * LOD_K * (node.children ? 1.15 : 1));
    if (split) {
      if (!node.children) {
        const h = node.du / 2, l = node.level + 1;
        node.children = [
          new Node(node.face, l, node.u0, node.v0, h),
          new Node(node.face, l, node.u0 + h, node.v0, h),
          new Node(node.face, l, node.u0, node.v0 + h, h),
          new Node(node.face, l, node.u0 + h, node.v0 + h, h),
        ];
      }
      let ready = true;
      for (const c of node.children) {
        if (!c.mesh) { ready = false; this.enqueue(c, forced ? -100 + node.level : 0); }
      }
      if (ready) {
        if (node.mesh) node.mesh.visible = false;
        for (const c of node.children) this.visit(c);
        return;
      }
    } else if (node.children) {
      this.disposeChildren(node);
    }
    if (node.mesh) node.mesh.visible = !culled;
  }

  // camPos : position réelle de la caméra ; lodPos : caméra ramenée à sa hauteur au-dessus du sol.
  update(camPos, lodPos) {
    this._cam.copy(camPos);
    this._lod.copy(lodPos);
    const rc = camPos.length();
    this._horizon = Math.sqrt(Math.max(rc * rc - R * R, 0)) +
      Math.sqrt((R + MAX_TERRAIN_H) * (R + MAX_TERRAIN_H) - R * R);
    this.queue.length = 0;
    for (const root of this.roots) {
      this.enqueue(root, -1000);
      this.visit(root);
    }
    if (this.queue.length && this.inflight < this.workers.length) {
      this.queue.sort((a, b) => a.prio - b.prio);
      let qi = 0;
      for (const w of this.workers) {
        if (w.busy) continue;
        if (qi >= this.queue.length) break;
        const node = this.queue[qi++];
        const id = this.nextId++;
        node.inflight = true;
        this.jobs.set(id, node);
        w.busy = true;
        this.inflight++;
        w.postMessage({ id, face: node.face, level: node.level, u0: node.u0, v0: node.v0, du: node.du });
      }
    }
    this.pending = this.queue.length + this.inflight;
  }
}
