# PvPStrat.io

Jeu de stratégie multijoueur en TypeScript. Phaser affiche le monde ; Colyseus synchronise les entités visibles. Le serveur valide les déplacements, récoltes, constructions et commandes d’unités.

## Développement

Utiliser Node.js 20.19+ ou 22.12+ et pnpm 9.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir `http://localhost:3000`. Le serveur écoute sur le port 2567 ; Vite transmet HTTP et WebSocket sous `/colyseus`. Le package partagé est recompilé automatiquement.

Les applications `apps/web` et `apps/docs` sont les exemples Next.js conservés dans le monorepo. Elles ne servent pas le jeu. Les lancer séparément avec `pnpm --filter web dev` ou `pnpm --filter docs dev`.

## Commandes du jeu

| Commande                | Action                                   |
| ----------------------- | ---------------------------------------- |
| WASD, ZQSD ou flèches   | Déplacer le joueur                       |
| Clic gauche maintenu    | Récolter une ressource proche            |
| B                       | Ouvrir les constructions                 |
| Clic sur un bâtiment    | Afficher ses actions                     |
| Tab                     | Basculer entre récolte et combat         |
| Clic maintenu en combat | Donner une destination à l’armée         |
| M                       | Afficher la carte et y commander l’armée |
| Échap ou clic droit     | Annuler la construction sélectionnée     |

Le joueur commence sans ressources. Les maisons augmentent la capacité de population ; les casernes recrutent les soldats et les centres-villes recrutent les villageois. Les coûts et recettes sont centralisés dans `packages/shared/src`.

## Tutoriel de départ

À la première partie dans ce navigateur, un guide accompagne le joueur : déplacement, récolte pour une maison, construction, préparation et placement d'un centre-ville, recrutement d'un villageois, puis découverte de la carte. Les compteurs utilisent les coûts partagés avec le serveur ; les étapes de construction et de recrutement attendent les entités confirmées par Colyseus.

Le guide indique une réserve proche encore disponible avec un cercle ou une flèche lorsqu'elle est hors écran. Il propose de continuer l'exploration si aucune réserve adaptée n'est visible. Il reste accessible pendant le jeu, se met en pause à la mort et vérifie la capacité de population avant le recrutement.

« Passer le tutoriel » permet de jouer librement. Le bouton « Tuto » relance le guide à tout moment. La fin ou le passage est mémorisé localement dans le navigateur ; une partie quittée retire les bâtiments et unités, donc un guide inachevé recommence avec la nouvelle colonie.

## Vérification

```sh
pnpm --filter client exec playwright install chromium
pnpm lint check-types
pnpm test
pnpm build
pnpm smoke-production
pnpm benchmark
pnpm audit --prod
```

Les tests serveur utilisent le lanceur natif de Node et de vrais clients Colyseus. Playwright vérifie les interactions, les retours répétés au menu et le tutoriel complet avec les coûts réels, sans ressources de départ. D'autres scénarios reçoivent des ressources uniquement dans la fixture ; la production ne propose aucune commande de ce type.

Le benchmark mesure 600 ticks après 60 ticks de chauffe sur la carte réelle, avec 32 joueurs et 1 024 soldats en mouvement. Il inclut les vues clients et leur encodage toutes les 100 ms. Ses résultats dépendent de la machine et ne constituent pas une limite de capacité en production.

## Production

```sh
pnpm prod
```

Cette commande compile le jeu, copie la carte dans `apps/server/dist/default.map`, puis sert le client et Colyseus depuis `http://localhost:2567`. Les assets utilisent la compression HTTP et un cache durable pour les noms contenant un hash. Le moniteur Colyseus est réservé au développement.

En HTTPS, le client utilise WSS sur le même domaine. Le reverse proxy doit transmettre le matchmaking et les mises à niveau WebSocket. Déployer le client et le serveur ensemble : Colyseus 0.14 a été remplacé par Colyseus 0.17.

| Variable            | Usage                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| `PORT`              | Port du serveur, 2567 par défaut                                             |
| `HOST`              | Interface d’écoute, `0.0.0.0` par défaut                                     |
| `MAP_PATH`          | Chemin d’une autre carte rectangulaire                                       |
| `ALLOWED_ORIGINS`   | Origines HTTP autorisées, séparées par des virgules                          |
| `VITE_SERVER_URL`   | Cible du proxy Vite en développement                                         |
| `VITE_COLYSEUS_URL` | Adresse publique Colyseus si différente du domaine du jeu ; définie au build |

La room conserve le monde en mémoire tant que le processus reste actif. Quitter retire les unités et bâtiments du joueur. Les ressources épuisées ne réapparaissent pas par défaut. Le jeu ne dispose pas de stockage durable ni de comptes.

## Modules et bibliothèques

| Emplacement                         | Responsabilité                                            |
| ----------------------------------- | --------------------------------------------------------- |
| `packages/shared/src/entities.ts`   | Schémas Colyseus communs                                  |
| `apps/server/src/game`              | Monde, économie, unités, combat, navigation et visibilité |
| `apps/server/src/rooms/GameRoom.ts` | Cycle de vie Colyseus et validation des messages          |
| `apps/client/src/game/rendering`    | Carte, entités, collisions et effets Phaser               |
| `apps/client/src/game/network`      | Connexion au SDK Colyseus                                 |
| `apps/client/src/game/scenes`       | Coordination du jeu, du menu et de l’interface            |

Colyseus gère les deltas, vues privées, callbacks et ping. EasyStar fournit A* et son budget de calcul. RBush indexe les entités serveur ; Phaser fournit son RTree côté client. Phaser gère aussi le culling de carte, les groupes réutilisables, les animations et le redimensionnement. Les règles de coûts, collision et combat restent du code métier.

Le [rapport de refactorisation](docs/refactoring.md) détaille les corrections, validations et limites des mesures.
