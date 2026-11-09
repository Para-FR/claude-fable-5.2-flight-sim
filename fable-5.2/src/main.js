// Point d'entrée : scène, boucle de jeu, états (accueil / vol / crash).
import * as THREE from 'three';
import { R, ATM_TOP, DEG } from './config.js';
import { terrainHeight, dirFromLatLon, findCoastStart } from './terrain.js';
import { shared, createSky, createStars, createSun, sunTransmittance } from './atmosphere.js';
import { Planet } from './planet.js';
import { Clouds } from './clouds.js';
import { createAircraft } from './aircraft.js';
import { Flight, groundHeight } from './physics.js';
import { Input } from './controls.js';
import { CameraRig, CAM_NAMES } from './cameras.js';
import { Hud } from './hud.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// --- Rendu -----------------------------------------------------------------------------
// Depth buffer logarithmique : un seul couple near/far couvre de 0,3 m à plusieurs millions
// de km sans z-fighting, du rase-mottes jusqu'à l'orbite.
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 2e9);

const stars = createStars();
const sky = createSky();
const sunSprite = createSun();
scene.add(stars, sky, sunSprite);
stars.material.uniforms.uPx.value = pixelRatio;

const planet = new Planet(scene);
const clouds = new Clouds(scene);

const plane = createAircraft();
scene.add(plane.group);
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
const hemi = new THREE.HemisphereLight(0x9cc4ff, 0x4a4338, 1);
scene.add(sunLight, sunLight.target, hemi);

// Marqueur de l'avion en vue orbitale
const marker = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffd24a'; g.lineWidth = 5;
  g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.arc(32, 32, 6, 0, Math.PI * 2); g.fill();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true,
  }));
  sp.scale.setScalar(0.035);
  sp.renderOrder = 10;
  sp.visible = false;
  scene.add(sp);
  return sp;
})();

// Boule de feu du crash
const fireball = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, depthWrite: false }),
);
fireball.visible = false;
fireball.renderOrder = 5;
scene.add(fireball);
let fireT = 0;

// --- Monde et état ---------------------------------------------------------------------
const flight = new Flight();
const input = new Input();
const rig = new CameraRig(camera, canvas);
const hud = new Hud();

const sunDir = shared.uSunDir.value;
const Yaxis = new THREE.Vector3(0, 1, 0);
const up = new THREE.Vector3(), north = new THREE.Vector3(), east = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), bup = new THREE.Vector3();
const tmp = new THREE.Vector3(), lodPos = new THREE.Vector3();
const col3 = [0, 0, 0];

function localFrame(pos) {
  up.copy(pos).normalize();
  north.set(0, 1, 0).addScaledVector(up, -up.y);
  if (north.lengthSq() < 1e-10) north.set(1, 0, 0);
  north.normalize();
  east.crossVectors(north, up);
}

// Départ : en vol, au-dessus d'une côte, en longeant le rivage.
(function placeStart() {
  const s = findCoastStart();
  const d = dirFromLatLon(s.lat, s.lon, [0, 0, 0]);
  const p = new THREE.Vector3(d[0], d[1], d[2]);
  localFrame(p);
  const H = (v) => { tmp.copy(v).normalize(); return terrainHeight(tmp.x, tmp.y, tmp.z, 500); };
  const e = 3000 / R;
  const gE = H(tmp.copy(p).addScaledVector(east, e)) - H(tmp.copy(p).addScaledVector(east, -e));
  const gN = H(tmp.copy(p).addScaledVector(north, e)) - H(tmp.copy(p).addScaledVector(north, -e));
  const along = new THREE.Vector3().addScaledVector(east, -gN).addScaledVector(north, gE);
  if (along.lengthSq() < 1e-6) along.copy(north);
  along.normalize();
  const ground = Math.max(terrainHeight(p.x, p.y, p.z), 0);
  const alt = Math.max(2500, ground + 1500);
  flight.reset(p.multiplyScalar(R + alt), along, 130, 0.32);
  rig.snap(flight);
  // Soleil : ~37° au-dessus de l'horizon, de trois quarts avant.
  right.crossVectors(along, up);
  sunDir.copy(up).multiplyScalar(0.6).addScaledVector(along, 0.5).addScaledVector(right, -0.62).normalize();
})();

let state = 'menu';       // 'menu' | 'flying' | 'crashed'
let paused = false;
let timeWarp = false;
let simTime = 0;

function respawn() {
  localFrame(flight.pos);
  fwd.set(0, 0, -1).applyQuaternion(flight.quat);
  fwd.addScaledVector(up, -fwd.dot(up));
  if (fwd.lengthSq() < 1e-6) fwd.copy(north);
  const ground = groundHeight(flight.pos);
  tmp.copy(up).multiplyScalar(R + ground + 1500);
  flight.reset(tmp, fwd, 130, 0.4);
  rig.snap(flight);
  plane.group.visible = true;
  fireball.visible = false;
  $('crash').classList.add('hidden');
  state = 'flying';
}

function onCrash() {
  state = 'crashed';
  plane.group.visible = false;
  fireball.visible = true;
  fireball.position.copy(flight.pos);
  fireT = 0;
  $('crashreason').textContent = flight.crashReason;
  const min = Math.floor(flight.time / 60), sec = Math.floor(flight.time % 60);
  $('crashstats').textContent =
    `Temps de vol : ${min} min ${String(sec).padStart(2, '0')} s — Distance : ${(flight.distance / 1000).toFixed(1)} km`;
  $('crash').classList.remove('hidden');
}

function start() {
  if (state !== 'menu') return;
  state = 'flying';
  input.enabled = true;
  rig.menu = false;
  $('home').classList.add('hidden');
  $('hud').classList.remove('hidden');
  canvas.focus();
}

$('startbtn').addEventListener('click', start);
$('respawnbtn').addEventListener('click', () => { if (state === 'crashed') respawn(); });
window.addEventListener('keydown', (e) => { if (state === 'menu' && e.code === 'Enter') start(); });
input.on('KeyC', () => rig.cycle(flight));
input.on('KeyP', () => { paused = !paused; $('pause').classList.toggle('hidden', !paused); });
input.on('KeyT', () => { timeWarp = !timeWarp; });
input.on('KeyH', () => $('help').classList.toggle('hidden'));
input.on('Enter', () => { if (state === 'crashed') respawn(); });
input.on('KeyR', () => { if (state === 'crashed') respawn(); });

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- Boucle ----------------------------------------------------------------------------
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let fpsFrames = 0, fpsTime = 0, lowFpsTime = 0, runTime = 0;
let propAngle = 0;
let loaded = false;
const hudState = { up, north, east, sun: sunDir };

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(rawDt, 0.1);

  // FPS + résolution adaptative
  fpsFrames++; fpsTime += rawDt; runTime += rawDt;
  if (fpsTime >= 0.5) {
    const fps = fpsFrames / fpsTime;
    hud.setFps(Math.round(fps));
    if (loaded && runTime > 6 && fps < 50) lowFpsTime += fpsTime; else lowFpsTime = 0;
    if (lowFpsTime >= 2 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      stars.material.uniforms.uPx.value = pixelRatio;
      lowFpsTime = 0;
    }
    fpsFrames = 0; fpsTime = 0;
  }

  const active = !paused && document.visibilityState === 'visible';

  // Simulation
  if (state === 'flying' && active) {
    input.update(dt, flight);
    acc = Math.min(acc + dt, 0.1);
    while (acc >= STEP) {
      flight.step(STEP, input);
      acc -= STEP;
      if (flight.crashed) { onCrash(); break; }
    }
  }
  if (active) {
    simTime += dt;
    sunDir.applyAxisAngle(Yaxis, -7.2921e-5 * (timeWarp ? 900 : 1) * dt).normalize();
  }

  // Avion
  plane.group.position.copy(flight.pos);
  plane.group.quaternion.copy(flight.quat);
  if (active) propAngle += dt * (18 + 55 * flight.throttle);
  plane.prop.rotation.z = -propAngle;
  plane.canopy.visible = rig.mode !== 1;

  if (state === 'crashed') {
    fireT += dt;
    const k = Math.min(fireT / 1.6, 1);
    fireball.scale.setScalar(4 + 60 * Math.sqrt(k));
    fireball.material.opacity = 0.9 * (1 - k);
    fireball.material.color.setRGB(1, 0.65 - 0.4 * k, 0.2 - 0.2 * k);
    fireball.visible = k < 1;
  }

  // Caméra (jamais sous le terrain)
  rig.update(dt, flight);
  let camR = camera.position.length();
  let camGround = 0;
  if (camR - R < 12000) {
    camGround = groundHeight(camera.position);
    if (camR < R + camGround + 2.5) {
      camera.position.multiplyScalar((R + camGround + 2.5) / camR);
      camR = R + camGround + 2.5;
    }
  } else if (camR - R < 200000) {
    camGround = groundHeight(camera.position, 3000);
  }
  camera.updateMatrixWorld();

  // Uniforms atmosphériques (calculés en double, transmis en km)
  const ck = camR / 1000, rk = R / 1000, ak = (R + ATM_TOP) / 1000;
  shared.uCamPos.value.copy(camera.position).multiplyScalar(0.001);
  shared.uCPlanet.value = ck * ck - rk * rk;
  shared.uCAtm.value = ck * ck - ak * ak;

  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 3e8);
  tmp.copy(camera.position).divideScalar(camR);
  sunTransmittance(camR, tmp.dot(sunDir), col3);
  const mx = Math.max(col3[0], col3[1], col3[2], 1e-4);
  sunSprite.material.color.setRGB(col3[0] / mx, col3[1] / mx, col3[2] / mx);
  sunSprite.material.opacity = Math.min(1, mx * 3);

  // Éclairage de l'avion par le soleil (éteint dans l'ombre de la planète)
  localFrame(flight.pos);
  const csPlane = up.dot(sunDir);
  sunTransmittance(flight.pos.length(), csPlane, col3);
  sunLight.color.setRGB(col3[0], col3[1], col3[2]);
  sunLight.position.copy(flight.pos).addScaledVector(sunDir, 100);
  sunLight.target.position.copy(flight.pos);
  const day = Math.min(1, Math.max(0, (csPlane + 0.12) / 0.27));
  hemi.intensity = 0.06 + 1.1 * day;
  hemi.position.copy(up);

  // Marqueur en vue orbitale (masqué si l'avion est derrière la planète)
  if (rig.mode === 2) {
    marker.position.copy(flight.pos);
    tmp.copy(flight.pos).sub(camera.position);
    const dist = tmp.length();
    tmp.divideScalar(dist);
    const b = camera.position.dot(tmp);
    const disc = b * b - (camR * camR - R * R);
    marker.visible = !(disc > 0 && -b - Math.sqrt(disc) < dist && -b > 0);
  } else marker.visible = false;

  // Terrain : niveau de détail d'après la hauteur de la caméra au-dessus du sol
  lodPos.copy(camera.position).multiplyScalar(Math.max(R + 2, camR - camGround) / camR);
  planet.update(camera.position, lodPos);
  clouds.update(simTime, camR - R);

  if (!loaded && (planet.pending === 0 || runTime > 12) && planet.patchCount > 6) {
    loaded = true;
    $('startbtn').disabled = false;
    $('startbtn').textContent = 'Décoller';
    $('loading').classList.add('hidden');
  } else if (!loaded) {
    $('loading').textContent = `Génération de la planète… ${planet.patchCount} tuiles`;
  }

  // HUD
  if (state !== 'menu') {
    fwd.set(0, 0, -1).applyQuaternion(flight.quat);
    right.set(1, 0, 0).applyQuaternion(flight.quat);
    bup.set(0, 1, 0).applyQuaternion(flight.quat);
    let hdg = Math.atan2(fwd.dot(east), fwd.dot(north)) / DEG;
    if (hdg < 0) hdg += 360;
    const s = hudState;
    s.speed = flight.vel.length();
    s.alt = flight.pos.length() - R;
    s.vs = flight.vel.dot(up);
    s.agl = flight.agl - 1.6;
    s.hdg = hdg;
    s.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.dot(up))));
    s.roll = Math.atan2(-right.dot(up), bup.dot(up));
    s.throttle = flight.throttle;
    s.g = flight.gLoad;
    s.lat = Math.asin(up.y);
    s.lon = Math.atan2(-up.z, up.x);
    s.stall = flight.stall;
    s.onGround = flight.onGround;
    s.crashed = flight.crashed;
    s.boost = input.boost > 0;
    s.warp = timeWarp;
    s.camName = CAM_NAMES[rig.mode];
    hud.update(dt, s);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Accès console pour le débogage / les tests.
window.sim = { flight, rig, planet, camera, renderer, shared, input, respawn };
