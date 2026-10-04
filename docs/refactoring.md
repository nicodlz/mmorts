# Audit et refactorisation du jeu

L’audit du 4 octobre 2026 couvre le client, le serveur, les schémas partagés, les dépendances et les commandes du monorepo. Les grandes scènes et la room ont été réparties en modules métier et de rendu. Les corrections sont accompagnées de tests reproductibles ; elles ne prouvent pas l’absence de tout bug dans toutes les situations de jeu.

## Corrections fonctionnelles

| Problème                                                          | Correction et vérification                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production bloquée par la perte des fractions                     | Accumulation du temps ; tests du fourneau, de la forge et de l’usine, de la pause et du manque de ressources                                                                                   |
| Récolte supérieure au stock et délai contournable entre gisements | Dernier lot plafonné et délai attaché au joueur ; tests de deux gisements et d’un joueur mort                                                                                                  |
| Téléportations et coordonnées invalides                           | Budget de distance et contrôle du segment ; vrais clients WebSocket, NaN, Infinity et déplacement valide                                                                                       |
| Construction sur des ressources ou des acteurs                    | Vérification spatiale avant consommation des coûts ; tests des emplacements occupés et de la portée                                                                                            |
| Population incorrecte après destruction d’une maison              | Capacité séparée des unités vivantes ; tests de destruction, recyclage et mort d’un soldat                                                                                                     |
| Mort et invulnérabilité dépendantes de timers                     | Échéances dans la simulation ; tests de perte de ressources par MapSchema, de réapparition et d’expiration                                                                                     |
| Combat manquant les voisins d’une autre cellule                   | Recherche sur tout le rayon ; combat entre positions 127 et 129                                                                                                                                |
| Remboursement lors d’une destruction au combat                    | Recyclage volontaire distinct ; tests des deux mécanismes                                                                                                                                      |
| Villageois perdant un sac partiel ou mélangeant ses ressources    | Conservation du type et dépôt du dernier lot ; tests d’épuisement et de changement de ressource                                                                                                |
| Gisement inaccessible bloquant un villageois                      | Échec de chemin ou absence de progression, puis exclusion temporaire ; test derrière un mur                                                                                                    |
| Chemin annulé remplaçant une nouvelle commande                    | Identité de requête et annulation EasyStar ; test de deux commandes avant les callbacks                                                                                                        |
| Modification lointaine invalidant les chemins                     | Conservation des routes et contrôle des obstacles à chaque déplacement ; test d’une modification indépendante                                                                                  |
| Ressources mutables partagées entre rooms                         | Copie explicite ; test de deux simulations                                                                                                                                                     |
| Schémas client et serveur divergents                              | Définition partagée ; tests d’encodage et de synchronisation                                                                                                                                   |
| Inventaires exposés                                               | Tags privés StateView ; deux clients proches, éloignés puis rapprochés                                                                                                                         |
| Fuites et erreur au retour au menu                                | Nettoyage des connexions et abonnements, libération native du décodeur Colyseus, respect du cycle des Group Phaser et création compatible StrictMode ; parcours navigateur avec trois relances |
| Raccourci traité plusieurs fois avant une nouvelle frame          | Propagation arrêtée avec l’API clavier Phaser ; parcours navigateur incluant déplacement, Tab, M et Échap                                                                                      |
| Carte absente du build et IP de production figée                  | Copie dans `dist`, connexion sur le même domaine et WS/WSS automatique ; test du serveur compilé                                                                                               |
| Types et lint incomplets                                          | Configuration stricte du jeu, versions de types alignées et fichiers Next générés exclus ; vérification de tous les packages                                                                   |

## Répartition entre le jeu et les bibliothèques

Colyseus 0.17 remplace les messages d’état et modèles client parallèles par les schémas natifs. `StateView` encode les ajouts, suppressions et changements des entités visibles, avec un tag réservé à l’inventaire du propriétaire. Le SDK fournit les callbacks de collections et le ping. Les commandes métier et les effets ponctuels restent des messages typés. Voir le [guide officiel de migration](https://docs.colyseus.io/migrating/0.17).

EasyStar fournit A*, sa file de priorité et un budget de 2 048 itérations par calcul. Le mode asynchrone évite de lancer une recherche entière pour chaque unité dans un même tick. Les collisions sont vérifiées contre le monde actuel même si la carte change après le calcul.

RBush fournit les recherches spatiales côté serveur. L’adaptateur conserve des bornes immuables pour retirer correctement une entité après déplacement. Le client utilise le RTree de Phaser : ses objets ont des bornes `left/top/right/bottom`, alors que ses recherches emploient `minX/minY/maxX/maxY`.

Le terrain utilise `TilemapLayer` et son culling. Les effets réutilisent un `Group` limité à 64 textes. Phaser gère les tweens, la caméra, le redimensionnement et les événements clavier/souris. Les anciennes classes de pooling et de gestion de performances ont été supprimées. La minimap conserve sa texture et redessine uniquement les cellules explorées qui changent.

Express sert le client compilé ; `compression` compresse HTTP et `express.static` gère le cache. Les versions Colyseus et TypeScript ont été alignées pour éviter plusieurs instances du framework. React et ses types sont alignés entre applications. Les dépendances ont été mises à jour ; l’override PostCSS corrige la version figée transitivement par Next.

## Tests et mesures

La suite comprend 20 tests serveur, dont une intégration avec deux vrais clients Colyseus, et un parcours Playwright. Le parcours couvre récolte, construction, recyclage, mouvement, mode combat, carte, redimensionnement et trois retours au menu. Le test de production vérifie la carte compilée, les assets, leur compression et cache, l’absence du moniteur public et la connexion WebSocket.

`pnpm benchmark` utilise la carte de 250 × 250 cases, 4 964 ressources, 32 joueurs et 1 024 soldats. Les destinations changent régulièrement. Après 60 ticks de chauffe, 600 ticks sont mesurés, avec mise à jour des vues et encodage tous les trois ticks.

Une exécution locale sous Node 26.3.1 a mesuré une médiane de 7,05 ms, un 95ᵉ percentile de 17,09 ms et un maximum de 38,90 ms, pour un budget de 33,33 ms. Le maximum dépasse le budget ; la mesure ne garantit pas une cadence constante sous toutes les charges. Elle dépend de la machine, du ramasse-miettes et des autres processus. Elle exclut les sockets, la latence réseau et le rendu, et ne compare pas les FPS à une version précédente.

Dans ce scénario, l’encodage initial du monde complet représente 326 399 octets ; la vue du premier joueur représente 11 916 octets. Il s’agit du filtrage du monde actuel, pas d’un gain mesuré contre l’ancien protocole.

## Limites connues

Le monde reste en mémoire, sans stockage durable, comptes ni reconnexion conservant les possessions. Une déconnexion retire les entités possédées ; le client propose une nouvelle connexion. Le changement Colyseus impose un déploiement conjoint du client et du serveur.

Phaser demeure un bundle conséquent. Le moteur, le SDK et l’application sont séparés pour améliorer leur cache, mais le poids initial du moteur reste. Une validation sur les appareils ciblés et avec de vrais joueurs est nécessaire pour établir les FPS et la capacité opérationnelle.

L’audit des dépendances de production ne signale plus de vulnérabilité. L’audit incluant les outils de développement signale encore `braces` 3.0.3, utilisé transitivement pour des motifs de fichiers, sans version corrigée annoncée dans l’avis. Cette dépendance ne fait pas partie des paquets de production du jeu.
