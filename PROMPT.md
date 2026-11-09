# Le prompt

Copié tel quel, en un seul message, dans un dossier vierge, avec `claude-fable-5-2`. Effort : le défaut de Claude Code (`medium`). Aucune intervention sur le code ensuite.

C'est exactement le même prompt que pour Opus 5.5, Sonnet 5.5 et Haiku 5.5.

Crée un simulateur de vol jouable dans le navigateur, en Three.js : on pilote un avion au-dessus d'une planète en 3D, style Flight Simulator.

**La planète**
- Une planète sphérique complète, qu'on peut faire entièrement le tour, avec un rayon réaliste à l'échelle (type Terre, environ 6371 km) et une unité de distance cohérente dans tout le projet.
- Surface générée procéduralement, **sans aucune image ni asset externe** : continents, océans, chaînes de montagnes, déserts, calottes polaires aux pôles. Des couleurs qui varient selon la latitude et l'altitude du terrain.
- Relief visible en rase-mottes : le terrain se détaille quand on s'approche, et reste léger vu de l'orbite (niveau de détail adaptatif).
- Une couche de nuages semi-transparente au-dessus de la surface, qui défile lentement.
- Un halo atmosphérique bleu visible depuis l'orbite, sur le bord de la planète.
- Un soleil directionnel qui éclaire un seul côté : on doit voir la ligne jour / nuit, et un ciel étoilé quand on est du côté nuit ou en très haute altitude.

**L'avion**
- Un avion modélisé avec des formes simples (fuselage, ailes, empennage, hélice ou réacteurs) — pas de fichier 3D externe.
- Physique de vol simplifiée mais crédible : poussée, portance dépendant de la vitesse et de l'incidence, traînée, gravité orientée vers le centre de la planète, inertie. À basse vitesse, l'avion décroche et pique du nez.
- Commandes clavier : flèches ou ZQSD/WASD pour le tangage et le roulis, A/E ou Q/E pour le lacet, Shift et Ctrl pour la poussée, et une touche pour les freins.
- **Utilise des quaternions pour les rotations**, pas des angles d'Euler : l'avion doit pouvoir passer à la verticale, faire un tonneau ou un looping complet sans se bloquer ni se retourner brutalement.
- Une touche bascule entre trois caméras : vue extérieure qui suit l'avion, vue cockpit, et vue libre en orbite.
- Collision avec le sol : si l'avion touche la surface trop vite ou trop incliné, il crashe, avec un écran de crash et une touche pour réapparaître en vol.

**Les échelles — important**
- On doit pouvoir voler à **100 mètres du sol comme à 400 kilomètres d'altitude**, et passer de l'un à l'autre de façon continue, sans que la géométrie se mette à clignoter ni que la planète disparaisse. Gère explicitement la précision de la profondeur (par exemple avec un depth buffer logarithmique ou plusieurs plans de coupe).
- Au démarrage, l'avion est **en vol**, à quelques kilomètres d'altitude, moteur en marche, au-dessus d'une côte.

**HUD et interface**
- Un HUD façon simulateur : vitesse en nœuds, altitude en pieds, cap en degrés, variomètre, niveau de poussée en pourcentage, et un **horizon artificiel** qui s'incline avec l'avion.
- Coordonnées latitude / longitude affichées en direct.
- Une mini-carte ou un globe miniature dans un coin, montrant la position de l'avion sur la planète.
- Un écran d'accueil avec un bouton « Décoller » et la liste des commandes.
- Un compteur de FPS.

**Performance**
- Objectif : 60 FPS sur une machine normale, avec un ciel étoilé et des nuages affichés.
- Aucune dépendance à un service en ligne, aucune clé d'API, aucune texture téléchargée : tout doit être généré par le code.

**Livrable**
- Un projet web statique, déployable tel quel sur un hébergement statique. Aucune étape de build compliquée.
- Un README avec les commandes exactes pour le lancer en local.
- Le code doit tourner du premier coup, sans erreur dans la console du navigateur.
