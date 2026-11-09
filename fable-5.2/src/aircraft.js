// Avion modélisé avec des primitives. Repère : nez vers -Z, dessus +Y, aile droite +X. Unités : mètres.
import * as THREE from 'three';

// Surface plane (aile, empennage) : contour [x, zArrière] extrudé en épaisseur.
function planform(points, thickness) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);          // y -> z (arrière), épaisseur -> -y
  geo.translate(0, thickness / 2, 0);
  return geo;
}

export function createAircraft() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.45, metalness: 0.15 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd63a26, roughness: 0.5, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18354f, roughness: 0.12, metalness: 0.6 });

  // Fuselage (profil de révolution, du cône de queue au nez)
  const profile = [
    [0.0, -5.5], [0.1, -5.45], [0.34, -3.6], [0.66, -1.4], [0.8, 0.4], [0.8, 1.6],
    [0.7, 2.9], [0.52, 3.8], [0.34, 4.3], [0.0, 4.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.LatheGeometry(profile, 20);
  fus.rotateX(-Math.PI / 2);         // +Y (nez) -> -Z
  group.add(new THREE.Mesh(fus, white));

  // Ailes
  const wing = planform([[0, -1.0], [5.6, -0.35], [5.6, 0.65], [0, 1.1], [-5.6, 0.65], [-5.6, -0.35]], 0.16);
  const wingMesh = new THREE.Mesh(wing, white);
  wingMesh.position.set(0, -0.32, -0.4);
  group.add(wingMesh);
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(planform([[0, -0.12], [0.9, 0], [0.9, 1.0], [0, 1.06]], 0.18), red);
    tip.position.set(sx > 0 ? 4.72 : -5.62, -0.32, -0.75);
    group.add(tip);
  }

  // Empennage horizontal
  const stab = new THREE.Mesh(planform([[0, -0.5], [2.1, -0.1], [2.1, 0.5], [0, 0.65], [-2.1, 0.5], [-2.1, -0.1]], 0.1), white);
  stab.position.set(0, 0.18, 4.55);
  group.add(stab);

  // Dérive
  const finShape = new THREE.Shape();
  [[3.5, 0.25], [4.9, 2.0], [5.5, 2.0], [5.35, 0.15]].forEach(([z, y], i) => (i === 0 ? finShape.moveTo(z, y) : finShape.lineTo(z, y)));
  finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
  fin.rotateY(-Math.PI / 2);         // x -> z, épaisseur -> -x
  fin.translate(0.05, 0, 0);
  group.add(new THREE.Mesh(fin, red));

  // Verrière
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glass);
  canopy.scale.set(0.5, 0.48, 1.25);
  canopy.position.set(0, 0.62, -1.3);
  group.add(canopy);

  // Hélice
  const prop = new THREE.Group();
  prop.position.set(0, 0, -4.35);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.75, 16), red);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.3;
  prop.add(spinner);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 1.15, 0.04), dark);
    blade.position.y = 0.6;
    blade.rotation.y = 0.35;
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI * 2) / 3;
    holder.add(blade);
    prop.add(holder);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 32),
    new THREE.MeshBasicMaterial({ color: 0xbfc8d0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.position.z = -0.08;
  prop.add(disc);
  group.add(prop);

  // Train d'atterrissage
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1.5, -0.2], [1.5, -0.2], [0, -3.2]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), dark);
    strut.position.set(x, -0.8, z);
    group.add(strut);
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.position.set(x, -1.3, z);
    group.add(wheel);
  }

  // Feux de navigation
  const light = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    group.add(m);
  };
  light(0xff2020, -5.65, -0.24, -0.2);
  light(0x20ff40, 5.65, -0.24, -0.2);
  light(0xffffff, 0, 0.1, 5.5);

  return { group, prop, canopy };
}
