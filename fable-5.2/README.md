# Aérosphère — simulateur de vol planétaire

Simulateur de vol jouable dans le navigateur (Three.js) : on pilote un avion au-dessus d'une planète
entière de 6 371 km de rayon, générée intégralement par le code. On vole en continu de 100 m du sol
jusqu'à l'orbite (400 km et au-delà).

Projet 100 % statique : pas de build, pas de dépendance en ligne, pas de clé d'API, aucune image ni
modèle 3D. Three.js (r170) est embarqué dans `vendor/`.

## Lancer en local

Les modules ES et les Web Workers exigent un serveur HTTP (ouvrir `index.html` en `file://` ne
fonctionne pas). Depuis le dossier du projet, au choix :

```bash
python3 -m http.server 8000
```

ou

```bash
npx serve -l 8000 .
```

Puis ouvrir <http://localhost:8000> et cliquer sur **Décoller**.

## Déployer

Copier le dossier tel quel sur n'importe quel hébergement statique (Netlify, Vercel, GitHub Pages,
Cloudflare Pages, S3, nginx…). Aucune étape de build.

## Commandes

Les touches sont lues par position physique : ZQSD sur un clavier AZERTY = WASD sur un QWERTY.

| Touche | Action |
| --- | --- |
| `↑` `↓` ou `Z` `S` (`W` `S`) | Tangage — `↓` / `S` pour cabrer (tirer le manche) |
| `←` `→` ou `Q` `D` (`A` `D`) | Roulis |
| `A` `E` (`Q` `E`) | Lacet |
| `Maj` / `Ctrl` (ou `R` / `F`) | Poussée + / − |
| `B` | Freins (aérofreins en vol, roues au sol) |
| `Espace` (maintenir) | Post-combustion orbitale : pour grimper jusqu'à l'espace |
| `C` | Caméra : extérieure → cockpit → orbite libre |
| `T` | Accélérer le temps (course du soleil ×900) |
| `P` / `H` | Pause / afficher-masquer l'aide |
| `R` ou `Entrée` | Réapparaître en vol après un crash |
| Souris | Glisser : regarder autour (vue extérieure) ou orbiter ; molette : zoom ; clic droit ou `Maj` + glisser en orbite : incliner le regard vers l'horizon |

Pour atteindre l'orbite : plein gaz, cabrer vers 40-60°, maintenir `Espace`. Comptez environ deux
minutes pour passer 200 km. À 400 km, une vitesse d'environ 7,7 km/s (≈ 14 900 kt) à l'horizontale
vous maintient en orbite.

## Comment ça marche

- **Unité** : le mètre, partout (`src/config.js`). Les shaders d'atmosphère convertissent en km à l'entrée.
- **Planète** (`src/planet.js`, `src/terrain.js`, `src/terrainWorker.js`) : cube-sphère découpé en
  quadtree, niveaux 3 à 16 (tuiles de ~1 250 km à ~150 m, maille de ~5 m au plus fin). Les tuiles
  sont générées dans des Web Workers à partir d'un bruit simplex déterministe : continents, océans,
  chaînes de montagnes, déserts, calottes polaires, couleurs selon latitude, altitude, humidité et
  pente. Un bruit périodique par pixel ajoute le grain du sol en rase-mottes.
- **Précision** : depth buffer logarithmique (`logarithmicDepthBuffer`, near 0,3 m / far 2·10⁹ m) ;
  sommets de chaque tuile stockés relativement au centre de la tuile, positions en double précision
  côté JavaScript : pas de scintillement ni de tremblement, du sol à l'orbite.
- **Atmosphère** (`src/atmosphere.js`) : diffusion Rayleigh + Mie intégrée par pixel, partagée par
  le ciel, le terrain (perspective aérienne) et les nuages. Elle produit le halo bleu vu de l'orbite,
  la ligne jour / nuit et les couchers de soleil. Étoiles et disque solaire générés par le code.
- **Nuages** (`src/clouds.js`) : coquille à 5 500 m, densité fractale par pixel, dérive lente.
- **Physique** (`src/physics.js`) : 6 degrés de liberté, orientation en quaternion (aucun angle
  d'Euler), portance fonction de la vitesse et de l'incidence, décrochage au-delà de ~14°, traînée,
  poussée, gravité en 1/r² vers le centre de la planète, contact et roulage au sol, crash.
- **HUD** (`src/hud.js`) : vitesse (kt), altitude (ft), cap, variomètre, poussée, facteur de charge,
  latitude / longitude, horizon artificiel, mini-globe avec jour / nuit, compteur de FPS.
- **Performance** : la résolution de rendu baisse automatiquement si le débit passe sous 50 FPS.
  Réglages dans `src/config.js` (`LOD_K`, `MAX_LEVEL`, `PATCH_N`).

## Structure

```
index.html          page, HUD, écrans d'accueil et de crash
css/style.css       styles
src/main.js         scène, boucle de jeu, états
src/config.js       constantes (rayon, unités, niveaux de détail)
src/noise.js        bruit simplex 3D
src/terrain.js      altitude et couleur de la planète
src/terrainWorker.js génération des tuiles (Web Worker)
src/planet.js       quadtree à niveau de détail adaptatif + shader du terrain
src/atmosphere.js   diffusion atmosphérique, ciel, étoiles, soleil
src/clouds.js       couche nuageuse
src/aircraft.js     modèle de l'avion (primitives)
src/physics.js      modèle de vol
src/controls.js     clavier
src/cameras.js      caméras
src/hud.js          instruments
vendor/three.module.js  Three.js r170 (licence MIT)
```

Navigateur récent requis (WebGL 2, Web Workers en modules) : Chrome, Edge, Firefox ou Safari à jour.
