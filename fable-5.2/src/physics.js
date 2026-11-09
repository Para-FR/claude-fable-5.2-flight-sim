// Modèle de vol simplifié à 6 degrés de liberté. Orientation en quaternion (aucun angle d'Euler),
// position/vitesse en mètres dans le repère planétocentrique (doubles JS).
// Repère avion : nez -Z, dessus +Y, aile droite +X.
import * as THREE from 'three';
import { R, MU, G0, MAX_TERRAIN_H, DEG } from './config.js';
import { terrainHeight } from './terrain.js';

const MASS = 5000;          // kg
const S = 25;               // surface alaire (m²)
const CL0 = 0.25, CLA = 5.0;
const CD0 = 0.025, K_IND = 0.082;
const T_MAX = 30000;        // poussée max au niveau de la mer (N)
const BOOST_ACC = 45;       // accélération de la post-combustion orbitale (m/s²)
const A_STALL = 14 * DEG;
const Q_REF = 6125;         // pression dynamique de référence (100 m/s au niveau de la mer)
const KP = 3.0, CMA = 10, DP = 3.0;
const KR = 7.0, DR = 3.0;
const KY = 1.2, CNB = 6.0, DY = 2.5;
export const GEAR = 1.6;    // hauteur du centre de gravité au-dessus des roues (m)

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const _up = new THREE.Vector3(), _vb = new THREE.Vector3(), _f = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _axis = new THREE.Vector3();

export function groundHeight(p, maxF) {
  const r = p.length();
  return Math.max(terrainHeight(p.x / r, p.y / r, p.z / r, maxF), 0);
}

export class Flight {
  constructor() {
    this.pos = new THREE.Vector3(R + 3000, 0, 0);
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();      // vitesse angulaire, repère avion (rad/s)
    this.throttle = 0.5;
    this.onGround = false;
    this.crashed = false;
    this.crashReason = '';
    this.stall = 0;
    this.alpha = 0;
    this.gLoad = 1;
    this.trimAlpha = 0;
    this.agl = 3000;
    this.time = 0;
    this.distance = 0;
  }

  // Place l'avion en vol : position, direction du nez (monde), vitesse (m/s).
  reset(pos, forward, speed, throttle) {
    this.pos.copy(pos);
    _up.copy(pos).normalize();
    _f.copy(forward).addScaledVector(_up, -forward.dot(_up)).normalize();
    this.setAttitude(_f, _up);
    this.vel.copy(_f).multiplyScalar(speed);
    this.omega.set(0, 0, 0);
    this.throttle = throttle;
    this.onGround = false;
    this.crashed = false;
    this.crashReason = '';
    this.stall = 0;
    this.trimAlpha = 0;
    this.time = 0;
    this.distance = 0;
  }

  setAttitude(f, up) {
    _r.crossVectors(f, up).normalize();
    _a.crossVectors(_r, f);
    _b.copy(f).negate();
    _m.makeBasis(_r, _a, _b);
    this.quat.setFromRotationMatrix(_m);
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
  }

  step(dt, inp) {
    if (this.crashed) return;
    const pos = this.pos, vel = this.vel, quat = this.quat, om = this.omega;
    this.time += dt;

    const r = pos.length();
    _up.copy(pos).divideScalar(r);
    const alt = r - R;
    const rho = 1.225 * Math.exp(-Math.max(alt, -500) / 8500);

    // Vitesse air dans le repère avion
    _qi.copy(quat).invert();
    _vb.copy(vel).applyQuaternion(_qi);
    const V = _vb.length();
    const qd = 0.5 * rho * V * V;
    let alpha = 0, beta = 0;
    if (V > 0.5) {
      alpha = Math.atan2(-_vb.y, -_vb.z);
      beta = Math.asin(clamp(_vb.x / V, -1, 1));
    }
    this.alpha = alpha;

    // Portance / traînée, avec décrochage au-delà de l'incidence critique
    const st = sstep(A_STALL - 1.5 * DEG, A_STALL + 5 * DEG, Math.abs(alpha));
    const clLin = CL0 + CLA * alpha;
    const sa = Math.sin(alpha), sb = Math.sin(beta);
    const CL = clLin * (1 - st) + Math.sin(2 * alpha) * st;
    const CD = (CD0 + K_IND * clLin * clLin) * (1 - st) + (CD0 + 1.7 * sa * sa) * st +
      0.6 * sb * sb + inp.brake * 0.09;
    this.stall = this.onGround ? 0 : st;

    let fx = 0, fy = 0, fz = 0;
    if (V > 0.5) {
      const vx = _vb.x / V, vy = _vb.y / V, vz = _vb.z / V;
      const ll = Math.hypot(vz, vy);
      const L = qd * S * CL, D = qd * S * CD;
      if (ll > 1e-4) { fy += (-vz / ll) * L; fz += (vy / ll) * L; }
      fx += -vx * D - qd * S * 1.2 * beta;
      fy += -vy * D;
      fz += -vz * D;
    }
    const thrust = this.throttle * T_MAX * Math.pow(rho / 1.225, 0.6) + inp.boost * MASS * BOOST_ACC;
    fz -= thrust;
    this.gLoad = fy / (MASS * G0);

    // Intégration linéaire (gravité vers le centre de la planète, en 1/r²)
    _a.set(fx / MASS, fy / MASS, fz / MASS).applyQuaternion(quat);
    _a.addScaledVector(_up, -MU / (r * r));
    vel.addScaledVector(_a, dt);
    pos.addScaledVector(vel, dt);
    this.distance += V * dt;

    // Dynamique de rotation
    const auth = clamp(qd / Q_REF, 0, 1.6);
    const ctrl = Math.max(auth, 0.08);
    const gl = Math.min(1, 11760 / Math.max(qd, 1));
    _b.set(0, 1, 0).applyQuaternion(quat);
    const gUp = clamp(_b.dot(_up), -0.3, 1);
    let aT = 12 * DEG;
    if (qd > 50) aT = clamp((MASS * G0 * gUp / (qd * S) - CL0) / CLA, -3 * DEG, 12 * DEG);
    this.trimAlpha += (aT - this.trimAlpha) * Math.min(1, dt / 0.8);

    const sgn = alpha >= 0 ? 1 : -1;
    const wx = KP * inp.pitch * ctrl * gl * (1 - 0.5 * st) - CMA * (alpha - this.trimAlpha) * auth -
      DP * om.x * (0.25 + auth) - 1.5 * st * sgn * Math.min(auth * 4, 1);
    const wz = -KR * inp.roll * ctrl - DR * om.z * (0.3 + auth) + 0.6 * beta * auth +
      st * 0.9 * Math.sin(this.time * 2.3) * Math.min(auth * 4, 1);
    const wy = -KY * inp.yaw * ctrl - CNB * beta * auth - DY * om.y * (0.3 + auth);
    om.x += wx * dt; om.y += wy * dt; om.z += wz * dt;

    const w = om.length();
    if (w > 1e-9) {
      _axis.copy(om).divideScalar(w);
      _dq.setFromAxisAngle(_axis, w * dt);
      quat.multiply(_dq).normalize();
    }

    // Sol
    const r2 = pos.length();
    const alt2 = r2 - R;
    if (alt2 < MAX_TERRAIN_H + 200) this.ground(dt, inp, r2);
    else { this.agl = alt2; this.onGround = false; }
  }

  ground(dt, inp, r) {
    const pos = this.pos, vel = this.vel, quat = this.quat, om = this.omega;
    _up.copy(pos).divideScalar(r);
    const hRaw = terrainHeight(_up.x, _up.y, _up.z);
    const h = Math.max(hRaw, 0);
    const agl = r - R - h;
    this.agl = agl;
    if (agl > GEAR) {
      if (agl > GEAR + 0.4) this.onGround = false;
      return;
    }
    if (hRaw <= 0) { this.crash('Amerrissage brutal : l’avion a percuté l’océan.'); return; }

    // Normale du terrain par différences finies
    _t1.set(0, 1, 0);
    if (Math.abs(_up.y) > 0.9) _t1.set(1, 0, 0);
    _t1.addScaledVector(_up, -_t1.dot(_up)).normalize();
    _t2.crossVectors(_up, _t1);
    const e = 6 / R;
    _a.copy(_up).addScaledVector(_t1, e).normalize();
    const s1 = (Math.max(terrainHeight(_a.x, _a.y, _a.z), 0) - h) / 6;
    _a.copy(_up).addScaledVector(_t2, e).normalize();
    const s2 = (Math.max(terrainHeight(_a.x, _a.y, _a.z), 0) - h) / 6;
    _n.copy(_up).addScaledVector(_t1, -s1).addScaledVector(_t2, -s2).normalize();

    const vn = vel.dot(_n);
    const speed = vel.length();
    _b.set(0, 1, 0).applyQuaternion(quat);       // dessus de l'avion
    _f.set(0, 0, -1).applyQuaternion(quat);      // nez
    if (!this.onGround) {
      if (vn < -6) { this.crash(`Impact trop violent : ${(-vn).toFixed(1)} m/s vers le sol.`); return; }
      if (speed > 120) { this.crash(`Contact avec le sol trop rapide : ${(speed * 1.943844).toFixed(0)} nœuds.`); return; }
      if (_b.dot(_n) < Math.cos(25 * DEG)) { this.crash('Avion trop incliné au moment du contact avec le sol.'); return; }
    } else if (vn < -12) {
      this.crash('Collision avec le relief.');
      return;
    }
    this.onGround = true;

    pos.addScaledVector(_up, GEAR - agl);
    if (vn < 0) vel.addScaledVector(_n, -vn);

    // Frottements : roulement + freins, et adhérence latérale des roues
    _r.set(1, 0, 0).applyQuaternion(quat);
    const vl = vel.dot(_r);
    vel.addScaledVector(_r, -vl * Math.min(1, 8 * dt));
    const sp = vel.length();
    if (sp > 0) {
      const dec = (0.03 + 0.55 * inp.brake) * G0 * dt;
      vel.multiplyScalar(Math.max(0, sp - dec) / sp);
    }

    // Assiette : roulis aligné sur le sol, tangage limité, direction au palonnier
    const fn = _f.dot(_n);
    const pitch = Math.asin(clamp(fn, -1, 1));
    const pc = clamp(pitch, 0, 0.26);
    _t1.copy(_f).addScaledVector(_n, -fn);
    if (_t1.lengthSq() < 1e-8) return;
    _t1.normalize();
    _t1.applyAxisAngle(_n, -inp.yaw * 0.5 * dt * Math.min(1, sp / 8));
    _a.copy(_t1).multiplyScalar(Math.cos(pc)).addScaledVector(_n, Math.sin(pc));   // nouveau nez
    _r.crossVectors(_a, _n).normalize();
    _t2.crossVectors(_r, _a);
    _b.copy(_a).negate();
    _m.makeBasis(_r, _t2, _b);
    _qt.setFromRotationMatrix(_m);
    quat.slerp(_qt, Math.min(1, 12 * dt));
    om.y = 0; om.z = 0;
    if (pitch <= 0) om.x = Math.max(om.x, 0);
    if (pitch >= 0.26) om.x = Math.min(om.x, 0);
  }
}
