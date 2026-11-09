// Trois caméras : poursuite, cockpit, orbite libre. Toutes les orientations sont des quaternions.
import * as THREE from 'three';
import { R } from './config.js';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const CAM_NAMES = ['EXTÉRIEURE', 'COCKPIT', 'ORBITE LIBRE'];

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 0;
    this.smoothQ = new THREE.Quaternion();
    this.yawOff = 2.5; this.pitchOff = 0.12;
    this.dist = 26;
    this.orbitQ = new THREE.Quaternion();
    this.orbitAlt = 2 * R;         // altitude de la caméra orbitale au-dessus du niveau de la mer
    this.orbitTilt = 0;            // inclinaison du regard depuis le nadir vers l'horizon (rad)
    this.dragging = false;
    this.tilting = false;
    this.menu = true;

    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.tilting = e.button === 2 || e.shiftKey;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('pointercancel', () => { this.dragging = false; });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (this.mode === 2 && this.tilting) {
        this.orbitTilt = Math.max(0, Math.min(1.9, this.orbitTilt + dy * 0.005));
        _q.setFromAxisAngle(Z, -dx * 0.005);
        this.orbitQ.multiply(_q).normalize();
      } else if (this.mode === 2) {
        const k = 0.004 * Math.min(1, this.orbitAlt / R);
        _q.setFromAxisAngle(Y, -dx * k);
        _q2.setFromAxisAngle(X, -dy * k);
        this.orbitQ.multiply(_q).multiply(_q2).normalize();
      } else if (this.mode === 0) {
        this.yawOff -= dx * 0.006;
        this.pitchOff = Math.max(-1.3, Math.min(1.3, this.pitchOff + dy * 0.006));
      }
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * 0.0025);
      if (this.mode === 2) this.orbitAlt = Math.max(20000, Math.min(12 * R, this.orbitAlt * k));
      else if (this.mode === 0) this.dist = Math.max(12, Math.min(150, this.dist * k));
    }, { passive: false });
  }

  snap(flight) { this.smoothQ.copy(flight.quat); }

  cycle(flight) {
    this.mode = (this.mode + 1) % 3;
    if (this.mode === 0) { this.snap(flight); this.yawOff = 0; this.pitchOff = 0; }
    if (this.mode === 2) {
      // Départ à la verticale de l'avion, nord en haut de l'écran.
      _a.copy(flight.pos).normalize();                            // axe Z caméra = verticale locale
      _b.set(0, 1, 0).addScaledVector(_a, -_a.y);
      if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0);
      _b.normalize();                                             // axe Y caméra = nord
      _c.crossVectors(_b, _a);                                    // axe X caméra
      _m.makeBasis(_c, _b, _a);
      this.orbitQ.setFromRotationMatrix(_m);
      this.orbitAlt = Math.max(2 * R, flight.pos.length() - R + 500000);
      this.orbitTilt = 0;
    }
  }

  update(dt, flight) {
    const cam = this.camera;
    if (this.mode === 0) {
      this.smoothQ.slerp(flight.quat, 1 - Math.exp(-dt * 5));
      if (this.menu) this.yawOff += dt * 0.12;
      else if (!this.dragging) {
        const k = Math.exp(-dt * 2.5);
        this.yawOff = Math.atan2(Math.sin(this.yawOff), Math.cos(this.yawOff)) * k;
        this.pitchOff *= k;
      }
      _q.setFromAxisAngle(Y, this.yawOff);
      _q2.setFromAxisAngle(X, -this.pitchOff - 0.16);
      cam.quaternion.copy(this.smoothQ).multiply(_q).multiply(_q2);
      _v.set(0, 0.6, this.dist).applyQuaternion(cam.quaternion);
      cam.position.copy(flight.pos).add(_v);
      cam.fov = 60;
    } else if (this.mode === 1) {
      cam.quaternion.copy(flight.quat);
      _v.set(0, 1.18, -1.7).applyQuaternion(flight.quat);
      cam.position.copy(flight.pos).add(_v);
      cam.fov = 72;
    } else {
      _q.setFromAxisAngle(X, this.orbitTilt);
      cam.quaternion.copy(this.orbitQ).multiply(_q);
      cam.position.set(0, 0, R + this.orbitAlt).applyQuaternion(this.orbitQ);
      cam.fov = 50;
    }
    cam.updateProjectionMatrix();
  }
}
