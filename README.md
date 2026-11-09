# Claude Fable 5.2 — le simulateur de vol, en un seul prompt

Le build généré par Claude Code avec **Claude Fable 5.2**, à partir **exactement du même prompt** qu'Opus 5.5, Sonnet 5.5 et Haiku 5.5 : un simulateur de vol jouable dans le navigateur, au-dessus d'une planète entière en 3D (Three.js), générée à 100 % par le code.

| Dossier | Modèle | Date | Réglage |
|---|---|---|---|
| [`fable-5.2/`](fable-5.2/) | `claude-fable-5-2` | 09/11/2026 | effort par défaut de Claude Code (`medium`) |

Règle du test : **un prompt, zéro intervention sur le code**. Le code est publié tel que le modèle l'a écrit, sans correction.

Le prompt complet est dans [`PROMPT.md`](PROMPT.md). Les builds Opus 5.5 et Sonnet 5.5 sont dans [claude-sonnet-vs-opus-flight-sim](https://github.com/Para-FR/claude-sonnet-vs-opus-flight-sim).

## Lancer le build

Le build utilise des modules ES et des Web Workers : il faut un petit serveur local, un double-clic sur `index.html` ne suffit pas.

```bash
cd fable-5.2
python3 -m http.server 8000
```

Puis ouvre <http://localhost:8000> et clique sur **Décoller**. Three.js (r170) est embarqué dans `vendor/` : aucune dépendance, aucune clé d'API, rien à installer.

Commandes : flèches ou ZQSD/WASD pour le tangage et le roulis, A/E ou Q/E pour le lacet, Maj / Ctrl pour la poussée, Espace (maintenu) pour grimper jusqu'à l'orbite, C pour changer de caméra. La liste complète est dans [`fable-5.2/README.md`](fable-5.2/README.md).

## Le verdict de la vidéo

- **Ce qui va** : un build rapide, une Terre un peu plus belle avec plus de relief, une bonne réactivité.
- **Ce qui déçoit** : l'avion, vraiment pas soigné, et un résultat quasiment identique à celui d'Opus 5.5… pour un modèle 2× plus cher au token.
- Fable 5.2 est taillé pour les projets de plusieurs heures ou plusieurs jours, pas pour un one-shot de ce type. Pour ce genre de test, Opus 5.5 suffit.

À toi de comparer : lance les builds et dis-moi lequel tu préfères.

## Liens

- Communauté Skool (gratuite) : https://shorturl.at/gAGbV
- Former ton équipe à Claude Code : https://calendly.com/claudecodefrance
- Discord : https://cc-france.org
