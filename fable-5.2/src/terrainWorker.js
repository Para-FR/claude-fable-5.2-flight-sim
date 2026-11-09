// Worker : construit le maillage d'une tuile de terrain (positions, normales, couleurs).
import { R, PATCH_N as N } from './config.js';
import { faceDir, terrainHeight, terrainColor } from './terrain.js';

const G = N + 3;                       // grille avec une bordure d'un sommet (pour les normales)
const hs = new Float64Array(G * G);
const px = new Float64Array(G * G * 3);
const ds = new Float64Array(G * G * 3);
const dir = [0, 0, 0];
const NV = (N + 1) * (N + 1);
const NS = 4 * (N + 1);

self.onmessage = (e) => {
  const { id, face, level, u0, v0, du } = e.data;
  const sizeM = (Math.PI / 2 * R) / (1 << level);
  const spacing = sizeM / N;
  const maxF = R / spacing;

  faceDir(face, u0 + du / 2, v0 + du / 2, dir);
  const cx = dir[0] * R, cy = dir[1] * R, cz = dir[2] * R;

  for (let j = 0; j < G; j++) {
    const v = v0 + ((j - 1) / N) * du;
    for (let i = 0; i < G; i++) {
      const u = u0 + ((i - 1) / N) * du;
      const k = j * G + i;
      faceDir(face, u, v, dir);
      const h = terrainHeight(dir[0], dir[1], dir[2], maxF);
      hs[k] = h;
      const rr = R + (h > 0 ? h : 0);
      ds[k * 3] = dir[0]; ds[k * 3 + 1] = dir[1]; ds[k * 3 + 2] = dir[2];
      px[k * 3] = dir[0] * rr - cx; px[k * 3 + 1] = dir[1] * rr - cy; px[k * 3 + 2] = dir[2] * rr - cz;
    }
  }

  const positions = new Float32Array((NV + NS) * 3);
  const normals = new Int8Array((NV + NS) * 3);
  const colors = new Uint8Array((NV + NS) * 4);
  const heights = new Float32Array(NV + NS);
  // Coordonnées « détail » : position monde modulo 2048 m (bruit périodique par pixel, continu entre tuiles).
  const detail = new Float32Array((NV + NS) * 3);
  const P = 2048;
  const ox = cx - Math.floor(cx / P) * P, oy = cy - Math.floor(cy / P) * P, oz = cz - Math.floor(cz / P) * P;

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = (j + 1) * G + (i + 1);
      const o = j * (N + 1) + i;
      const k3 = k * 3, o3 = o * 3;
      positions[o3] = px[k3]; positions[o3 + 1] = px[k3 + 1]; positions[o3 + 2] = px[k3 + 2];

      const ax = px[k3 + 3] - px[k3 - 3], ay = px[k3 + 4] - px[k3 - 2], az = px[k3 + 5] - px[k3 - 1];
      const g3 = G * 3;
      const bx = px[k3 + g3] - px[k3 - g3], by = px[k3 + g3 + 1] - px[k3 - g3 + 1], bz = px[k3 + g3 + 2] - px[k3 - g3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const dx = ds[k3], dy = ds[k3 + 1], dz = ds[k3 + 2];
      let l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) { nx = dx; ny = dy; nz = dz; l = 1; }
      let dot = (nx * dx + ny * dy + nz * dz) / l;
      if (dot < 0) { l = -l; dot = -dot; }
      nx /= l; ny /= l; nz /= l;
      normals[o3] = Math.round(nx * 127); normals[o3 + 1] = Math.round(ny * 127); normals[o3 + 2] = Math.round(nz * 127);

      terrainColor(colors, o * 4, dx, dy, dz, hs[k], 1 - dot, maxF);
      heights[o] = hs[k];
      detail[o3] = px[k3] + ox; detail[o3 + 1] = px[k3 + 1] + oy; detail[o3 + 2] = px[k3 + 2] + oz;
    }
  }

  // Jupes : masquent les fissures entre niveaux de détail voisins.
  const depth = Math.max(20, sizeM * 0.06);
  for (let e2 = 0; e2 < 4; e2++) {
    for (let t = 0; t <= N; t++) {
      let i, j;
      if (e2 === 0) { i = t; j = 0; } else if (e2 === 1) { i = t; j = N; } else if (e2 === 2) { i = 0; j = t; } else { i = N; j = t; }
      const k3 = ((j + 1) * G + (i + 1)) * 3;
      const src = j * (N + 1) + i;
      const dst = NV + e2 * (N + 1) + t;
      positions[dst * 3] = px[k3] - ds[k3] * depth;
      positions[dst * 3 + 1] = px[k3 + 1] - ds[k3 + 1] * depth;
      positions[dst * 3 + 2] = px[k3 + 2] - ds[k3 + 2] * depth;
      normals[dst * 3] = normals[src * 3]; normals[dst * 3 + 1] = normals[src * 3 + 1]; normals[dst * 3 + 2] = normals[src * 3 + 2];
      colors[dst * 4] = colors[src * 4]; colors[dst * 4 + 1] = colors[src * 4 + 1];
      colors[dst * 4 + 2] = colors[src * 4 + 2]; colors[dst * 4 + 3] = colors[src * 4 + 3];
      heights[dst] = heights[src];
      detail[dst * 3] = detail[src * 3]; detail[dst * 3 + 1] = detail[src * 3 + 1]; detail[dst * 3 + 2] = detail[src * 3 + 2];
    }
  }

  self.postMessage({ id, positions, normals, colors, heights, detail, center: [cx, cy, cz] },
    [positions.buffer, normals.buffer, colors.buffer, heights.buffer, detail.buffer]);
};
