// Clavier. On utilise event.code (touche physique) : ZQSD sur AZERTY et WASD sur QWERTY
// sont donc les mêmes touches, tout comme A/E (AZERTY) et Q/E (QWERTY) pour le lacet.
const approach = (v, target, rate, dt) => {
  const d = target - v, m = rate * dt;
  return Math.abs(d) <= m ? target : v + Math.sign(d) * m;
};

const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Enter']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pitch = 0; this.roll = 0; this.yaw = 0; this.brake = 0; this.boost = 0;
    this.actions = {};       // code -> fonction déclenchée à l'appui
    this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (BLOCK.has(e.code) || e.ctrlKey) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const fn = this.actions[e.code];
      if (fn) fn();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(code, fn) { this.actions[code] = fn; }
  down(...codes) { for (const c of codes) if (this.keys.has(c)) return 1; return 0; }

  update(dt, flight) {
    const tp = this.down('ArrowDown', 'KeyS') - this.down('ArrowUp', 'KeyW');      // + = cabrer
    const tr = this.down('ArrowRight', 'KeyD') - this.down('ArrowLeft', 'KeyA');   // + = à droite
    const ty = this.down('KeyE') - this.down('KeyQ');                              // + = nez à droite
    this.pitch = approach(this.pitch, tp, tp === 0 ? 5 : 3.5, dt);
    this.roll = approach(this.roll, tr, tr === 0 ? 6 : 4, dt);
    this.yaw = approach(this.yaw, ty, 4, dt);
    this.brake = this.down('KeyB');
    this.boost = this.down('Space');
    const th = this.down('ShiftLeft', 'ShiftRight', 'KeyR') - this.down('ControlLeft', 'ControlRight', 'KeyF');
    if (th !== 0) flight.throttle = Math.min(1, Math.max(0, flight.throttle + th * 0.45 * dt));
  }
}
