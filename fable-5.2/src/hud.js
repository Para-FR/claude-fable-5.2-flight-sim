// HUD : instruments texte (DOM), horizon artificiel, ruban de cap et mini-globe (canvas 2D).
import { M2FT, MS2KT, DEG } from './config.js';
import { terrainHeight, terrainColor, waterColor, dirFromLatLon } from './terrain.js';

const $ = (id) => document.getElementById(id);
const GREEN = '#7dffb0';

function setupCanvas(id, w, h) {
  const c = $(id);
  const s = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(s, s);
  return ctx;
}

export class Hud {
  constructor() {
    this.el = {
      spd: $('spd'), alt: $('alt'), altKm: $('altkm'), vs: $('vs'), agl: $('agl'), hdg: $('hdg'),
      thr: $('thr'), thrBar: $('thrbar'), lat: $('lat'), lon: $('lon'), g: $('gload'),
      cam: $('cam'), warn: $('warn'), fps: $('fps'), boost: $('boost'), warp: $('warp'),
    };
    this.hz = setupCanvas('horizon', 210, 210);
    this.tape = setupCanvas('hdgtape', 440, 46);
    this.globeCanvas = $('globe');
    this.globeCanvas.width = this.globeCanvas.height = 150;
    this.gctx = this.globeCanvas.getContext('2d');
    this.gimg = this.gctx.createImageData(150, 150);
    this.globeTimer = 0;
    this.buildMap();
  }

  // Carte équirectangulaire basse résolution de la planète, générée une fois.
  buildMap() {
    const W = 360, H = 180;
    this.mapW = W; this.mapH = H;
    this.map = new Uint8Array(W * H * 4);
    const d = [0, 0, 0];
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - (j + 0.5) / H) * Math.PI;
      for (let i = 0; i < W; i++) {
        const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
        dirFromLatLon(lat, lon, d);
        const h = terrainHeight(d[0], d[1], d[2], 200);
        const o = (j * W + i) * 4;
        terrainColor(this.map, o, d[0], d[1], d[2], h, 0, 200);
        if (h <= 0 && this.map[o + 3] < 128) waterColor(this.map, o, -h);
      }
    }
  }

  drawHorizon(pitch, roll) {
    const c = this.hz, w = 210, r = w / 2 - 6;
    c.clearRect(0, 0, w, w);
    c.save();
    c.translate(w / 2, w / 2);
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    c.rotate(-roll);
    const ppr = r / (32 * DEG);
    c.translate(0, pitch * ppr);
    c.fillStyle = '#2f7fd0'; c.fillRect(-3 * r, -6 * r, 6 * r, 6 * r);
    c.fillStyle = '#7a5230'; c.fillRect(-3 * r, 0, 6 * r, 6 * r);
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-3 * r, 0); c.lineTo(3 * r, 0); c.stroke();
    c.lineWidth = 1.3; c.fillStyle = '#fff'; c.font = '10px ui-monospace, Menlo, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const y = -d * DEG * ppr;
      const half = d % 10 === 0 ? 26 : 12;
      c.beginPath(); c.moveTo(-half, y); c.lineTo(half, y); c.stroke();
      if (d % 10 === 0) { c.fillText(String(Math.abs(d)), -half - 11, y); c.fillText(String(Math.abs(d)), half + 11, y); }
    }
    c.restore();

    // Échelle de roulis (fixe) et index (mobile)
    c.save();
    c.translate(w / 2, w / 2);
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const t = (a - 90) * DEG, l = a % 30 === 0 ? 10 : 6;
      c.beginPath();
      c.moveTo(Math.cos(t) * r, Math.sin(t) * r);
      c.lineTo(Math.cos(t) * (r - l), Math.sin(t) * (r - l));
      c.stroke();
    }
    c.rotate(-roll);
    c.fillStyle = '#ffd24a';
    c.beginPath(); c.moveTo(0, -r + 11); c.lineTo(-6, -r + 21); c.lineTo(6, -r + 21); c.closePath(); c.fill();
    c.restore();

    // Maquette avion (fixe)
    c.save();
    c.translate(w / 2, w / 2);
    c.strokeStyle = '#ffd24a'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-46, 0); c.lineTo(-18, 0); c.lineTo(-18, 7);
    c.moveTo(46, 0); c.lineTo(18, 0); c.lineTo(18, 7);
    c.stroke();
    c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(0, 0, 2.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(125,255,176,0.7)'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.restore();
  }

  drawTape(hdg) {
    const c = this.tape, w = 440, h = 46, ppd = 4.2;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = GREEN; c.fillStyle = GREEN; c.lineWidth = 1.4;
    c.font = '12px ui-monospace, Menlo, monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' };
    const start = Math.floor((hdg - 55) / 5) * 5;
    for (let d = start; d <= hdg + 55; d += 5) {
      const x = w / 2 + (d - hdg) * ppd;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 10 === 0;
      c.globalAlpha = Math.max(0, 1 - Math.abs(x - w / 2) / (w / 2));
      c.beginPath(); c.moveTo(x, h - 2); c.lineTo(x, h - (major ? 14 : 8)); c.stroke();
      if (dd % 30 === 0) c.fillText(names[dd] || String(dd / 10).padStart(2, '0'), x, 6);
    }
    c.globalAlpha = 1;
    c.fillStyle = '#ffd24a';
    c.beginPath(); c.moveTo(w / 2, h - 16); c.lineTo(w / 2 - 6, h - 26); c.lineTo(w / 2 + 6, h - 26); c.closePath(); c.fill();
  }

  // Globe orthographique centré sur l'avion, nord en haut, avec ombrage jour/nuit.
  drawGlobe(up, north, east, sun, hdg) {
    const N = 150, data = this.gimg.data, map = this.map, W = this.mapW, H = this.mapH;
    const rad = N / 2 - 3;
    for (let py = 0; py < N; py++) {
      const y = -(py + 0.5 - N / 2) / rad;
      for (let px = 0; px < N; px++) {
        const x = (px + 0.5 - N / 2) / rad;
        const o = (py * N + px) * 4;
        const rr = x * x + y * y;
        if (rr > 1) { data[o + 3] = 0; continue; }
        const z = Math.sqrt(1 - rr);
        const dx = east.x * x + north.x * y + up.x * z;
        const dy = east.y * x + north.y * y + up.y * z;
        const dz = east.z * x + north.z * y + up.z * z;
        const lat = Math.asin(dy < -1 ? -1 : dy > 1 ? 1 : dy);
        const lon = Math.atan2(-dz, dx);
        let mi = Math.floor((lon / (2 * Math.PI) + 0.5) * W); if (mi >= W) mi = W - 1; if (mi < 0) mi = 0;
        let mj = Math.floor((0.5 - lat / Math.PI) * H); if (mj >= H) mj = H - 1; if (mj < 0) mj = 0;
        const m = (mj * W + mi) * 4;
        const l = dx * sun.x + dy * sun.y + dz * sun.z;
        const light = (0.16 + 0.84 * Math.min(1, Math.max(0, l * 3 + 0.25))) * (0.72 + 0.28 * z);
        data[o] = map[m] * light; data[o + 1] = map[m + 1] * light; data[o + 2] = map[m + 2] * light;
        data[o + 3] = rr > 0.96 ? 255 * (1 - rr) / 0.04 : 255;
      }
    }
    const g = this.gctx;
    g.putImageData(this.gimg, 0, 0);
    g.strokeStyle = 'rgba(120,180,255,0.75)'; g.lineWidth = 2;
    g.beginPath(); g.arc(N / 2, N / 2, rad, 0, Math.PI * 2); g.stroke();
    g.save();
    g.translate(N / 2, N / 2); g.rotate(hdg * DEG);
    g.fillStyle = '#ffd24a'; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  // s : état de vol calculé par main.js
  update(dt, s) {
    const e = this.el;
    e.spd.textContent = Math.round(s.speed * MS2KT);
    const ft = s.alt * M2FT;
    e.alt.textContent = Math.round(ft).toLocaleString('fr-FR');
    e.altKm.textContent = s.alt >= 10000 ? (s.alt / 1000).toFixed(1) + ' km' : Math.round(s.alt) + ' m';
    const vs = s.vs * M2FT * 60;
    e.vs.textContent = (vs >= 0 ? '+' : '−') + Math.abs(Math.round(vs / 10) * 10).toLocaleString('fr-FR');
    e.agl.textContent = Math.round(Math.max(0, s.agl) * M2FT).toLocaleString('fr-FR');
    e.hdg.textContent = String(Math.round(s.hdg) % 360).padStart(3, '0') + '°';
    e.thr.textContent = Math.round(s.throttle * 100) + ' %';
    e.thrBar.style.height = (s.throttle * 100).toFixed(1) + '%';
    e.g.textContent = s.g.toFixed(1);
    const la = s.lat / DEG, lo = s.lon / DEG;
    e.lat.textContent = Math.abs(la).toFixed(4) + '° ' + (la >= 0 ? 'N' : 'S');
    e.lon.textContent = Math.abs(lo).toFixed(4) + '° ' + (lo >= 0 ? 'E' : 'O');
    e.cam.textContent = s.camName;
    e.boost.classList.toggle('hidden', !s.boost);
    e.warp.classList.toggle('hidden', !s.warp);
    let warn = '';
    if (s.crashed) warn = '';
    else if (s.stall > 0.35) warn = 'DÉCROCHAGE';
    else if (s.agl < 150 && s.vs < -8 && !s.onGround) warn = 'TERRAIN — REDRESSEZ';
    else if (s.onGround) warn = 'AU SOL';
    e.warn.textContent = warn;
    e.warn.classList.toggle('hidden', warn === '');
    e.warn.classList.toggle('soft', warn === 'AU SOL');

    this.drawHorizon(s.pitch, s.roll);
    this.drawTape(s.hdg);
    this.globeTimer -= dt;
    if (this.globeTimer <= 0) {
      this.globeTimer = 0.15;
      this.drawGlobe(s.up, s.north, s.east, s.sun, s.hdg);
    }
  }

  setFps(v) { this.el.fps.textContent = v + ' FPS'; }
}
