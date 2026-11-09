// Constantes globales. Unité de distance du projet : le MÈTRE, partout.
export const R = 6371000;            // rayon de la planète (m)
export const G0 = 9.80665;           // gravité au niveau de la mer (m/s²)
export const MU = G0 * R * R;        // paramètre gravitationnel (m³/s²)
export const ATM_TOP = 60000;        // sommet de l'atmosphère rendue (m)
export const CLOUD_ALT = 5500;       // altitude de la couche nuageuse (m)
export const MAX_TERRAIN_H = 9000;   // majorant de l'altitude du relief (m)

export const PATCH_N = 32;           // segments par côté de tuile de terrain
export const MIN_LEVEL = 3;          // niveau de quadtree toujours affiché
export const MAX_LEVEL = 16;         // niveau le plus fin (~150 m de côté, maille ~5 m)
export const LOD_K = 2.0;            // une tuile se subdivise à moins de K × sa taille

export const SEED = 20261109;

export const M2FT = 3.28084;
export const MS2KT = 1.943844;
export const DEG = Math.PI / 180;
