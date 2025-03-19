# Optimisations de Performance pour PvPStrat.io

Basé sur l'analyse des rapports existants et les meilleures pratiques pour Phaser et Colyseus, voici les optimisations recommandées pour améliorer les performances du jeu.

## Optimisations Côté Serveur

### 1. Optimisation de l'IA des Villageois

**Problème actuel** : 
La méthode `updateVillagerAI()` est trop gourmande en ressources CPU car elle s'exécute à chaque frame de simulation.

**Solution recommandée** :
```typescript
private lastVillagerAIUpdate: number = 0;

// Dans la méthode update() du serveur
const now = Date.now();
if (now - this.lastVillagerAIUpdate > 250) { // 4 fois par seconde au lieu de 30
  this.updateVillagerAI();
  this.lastVillagerAIUpdate = now;
}
```

**Avantages** :
- Réduction de la charge CPU de ~85%
- Comportement des villageois toujours fluide visuellement
- Possibilité d'adapter dynamiquement la fréquence selon le nombre de villageois

### 2. Implémentation d'une Grille Spatiale

**Problème actuel** :
Les recherches de ressources et les détections de collision utilisent des méthodes O(n²) inefficaces.

**Solution recommandée** :
```typescript
class SpatialGrid {
  private grid: Map<string, Set<string>> = new Map();
  private cellSize: number = 64; // Taille de la cellule en pixels
  
  addEntity(id: string, x: number, y: number) {
    const key = this.getCellKey(x, y);
    if (!this.grid.has(key)) {
      this.grid.set(key, new Set());
    }
    this.grid.get(key)!.add(id);
  }
  
  removeEntity(id: string, x: number, y: number) {
    const key = this.getCellKey(x, y);
    const cell = this.grid.get(key);
    if (cell) {
      cell.delete(id);
    }
  }
  
  getEntitiesInRadius(x: number, y: number, radius: number): Set<string> {
    const result = new Set<string>();
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellY = Math.floor(y / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${centerCellX + dx},${centerCellY + dy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const id of cell) {
            result.add(id);
          }
        }
      }
    }
    
    return result;
  }
  
  private getCellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
}
```

**Utilisation dans le code** :
```typescript
// Initialisation
this.spatialGrid = new SpatialGrid();

// À chaque fois qu'une ressource est ajoutée
this.spatialGrid.addEntity(resource.id, resource.x, resource.y);

// Pour rechercher des ressources près d'un villageois
const nearbyEntityIds = this.spatialGrid.getEntitiesInRadius(villager.x, villager.y, searchRadius);
const nearbyResources = new Set<string>();
for (const id of nearbyEntityIds) {
  const resource = this.state.resources.get(id);
  if (resource) {
    nearbyResources.add(id);
  }
}
```

**Avantages** :
- Complexité réduite de O(n²) à O(1) pour les recherches spatiales
- Optimisation majeure pour les détections de collision
- Performance améliorée avec un grand nombre d'entités

### 3. Réduction des Logs

**Problème actuel** :
De nombreux logs de débogage consomment des ressources.

**Solution recommandée** :
```typescript
// Remplacer tous les console.log par une fonction conditionnelle
const DEBUG = false; // Désactiver en production

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Exemple d'utilisation
debugLog(`Villageois ${villager.id} récolte ${collectAmount} de ${resource.type}`);
```

**Avantages** :
- Réduction significative de la charge serveur
- Pas de surcharge réseau liée aux logs
- Facilité à réactiver les logs pour le débogage

## Optimisations Côté Client

### 1. Système de Level of Detail (LOD)

**Problème actuel** :
Tous les villageois et entités sont rendus avec la même qualité quelle que soit leur distance.

**Solution recommandée** :
```typescript
// Dans GameScene.ts
private applyLOD(sprite: Phaser.GameObjects.Sprite, distance: number) {
  const qualityLevel = PerformanceManager.qualityLevel;
  let updateInterval = 16; // Mise à jour à chaque frame par défaut
  
  if (distance > 300) {
    // Entités très éloignées
    sprite.setVisible(false);
    updateInterval = 0; // Ne pas mettre à jour du tout
  } else if (distance > 200) {
    // Entités éloignées
    sprite.setVisible(true);
    sprite.setScale(0.8);
    sprite.anims.stop(); // Désactiver les animations
    updateInterval = 200; // 5 fois par seconde
  } else if (distance > 100) {
    // Entités à distance moyenne
    sprite.setVisible(true);
    sprite.setScale(0.9);
    updateInterval = 100; // 10 fois par seconde
  } else {
    // Entités proches
    sprite.setVisible(true);
    sprite.setScale(1);
    // Animation normale
  }
  
  // Stocker l'intervalle de mise à jour dans les données du sprite
  sprite.setData('updateInterval', updateInterval);
  sprite.setData('lastUpdate', 0);
}

// Dans la méthode update des unités
private updateUnits(delta: number, time: number) {
  this.unitSprites.forEach((data, unitId) => {
    const { sprite } = data;
    
    // Calculer la distance par rapport au joueur
    const distance = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, sprite.x, sprite.y
    );
    
    // Appliquer le LOD en fonction de la distance
    this.applyLOD(sprite, distance);
    
    // Vérifier si cette entité doit être mise à jour à ce frame
    const updateInterval = sprite.getData('updateInterval') || 16;
    const lastUpdate = sprite.getData('lastUpdate') || 0;
    
    if (updateInterval === 0 || time - lastUpdate < updateInterval) {
      return; // Ne pas mettre à jour cette entité
    }
    
    sprite.setData('lastUpdate', time);
    
    // Continuer avec la logique de mise à jour normale
    // ...
  });
}
```

**Avantages** :
- Réduction drastique du nombre d'entités rendues
- Optimisation du CPU pour les animations
- Mise à jour adaptative selon la distance

### 2. Utilisation d'un Pool d'Objets

**Problème actuel** :
Création fréquente d'objets temporaires pour les effets visuels, textes, etc.

**Solution recommandée** :
```typescript
class SpritePool {
  private pool: Phaser.GameObjects.Sprite[] = [];
  private scene: Phaser.Scene;
  private textureKey: string;
  
  constructor(scene: Phaser.Scene, textureKey: string, initialSize: number = 20) {
    this.scene = scene;
    this.textureKey = textureKey;
    
    // Pré-créer les sprites
    for (let i = 0; i < initialSize; i++) {
      const sprite = this.scene.add.sprite(0, 0, textureKey);
      sprite.setVisible(false);
      this.pool.push(sprite);
    }
  }
  
  get(): Phaser.GameObjects.Sprite {
    // Réutiliser un sprite existant ou en créer un nouveau
    let sprite = this.pool.find(s => !s.visible);
    
    if (!sprite) {
      sprite = this.scene.add.sprite(0, 0, this.textureKey);
      this.pool.push(sprite);
    }
    
    sprite.setVisible(true);
    return sprite;
  }
  
  release(sprite: Phaser.GameObjects.Sprite) {
    sprite.setVisible(false);
  }
}

// Utilisation pour les effets de récolte
this.harvestEffectPool = new SpritePool(this, 'harvest-effect', 10);

// Pour créer un effet
const effect = this.harvestEffectPool.get();
effect.setPosition(x, y);
effect.play('harvest-animation');

// Libérer l'effet après utilisation
this.tweens.add({
  targets: effect,
  alpha: 0,
  duration: 500,
  onComplete: () => this.harvestEffectPool.release(effect)
});
```

**Avantages** :
- Réduction des allocations mémoire
- Moins de travail pour le garbage collector
- Performance améliorée pendant les pics d'activité

### 3. Optimisation du Rendu Phaser

**Problème actuel** :
Performances de rendu sous-optimales, notamment à faible FPS.

**Solution recommandée** :
```typescript
// Dans config.js
const config = {
  type: Phaser.AUTO, // Choisir automatiquement le meilleur renderer
  width: 800, // Utiliser une taille de canvas plus petite
  height: 600,
  pixelArt: true, // Activer le mode pixel art pour une meilleure mise à l'échelle
  roundPixels: true, // Éviter les problèmes d'anti-aliasing
  powerPreference: 'high-performance', // Privilégier les performances
  disableContextMenu: true, // Désactiver le menu contextuel
  backgroundColor: '#4a8bc3',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: {
    target: 60, // Cibler 60 FPS
    forceSetTimeOut: false // Utiliser requestAnimationFrame
  },
  callbacks: {
    postBoot: (game) => {
      // Tester si CANVAS est plus performant que WebGL sur ce dispositif
      if (game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
        const testFPS = () => {
          const currentFPS = game.loop.actualFps;
          if (currentFPS < 30) {
            // Recréer le jeu avec le renderer Canvas si WebGL est lent
            const canvasConfig = { ...config, type: Phaser.CANVAS };
            game.destroy(true);
            new Phaser.Game(canvasConfig);
          }
        };
        
        // Tester après 5 secondes
        setTimeout(testFPS, 5000);
      }
    }
  }
};
```

**Avantages** :
- Taille de canvas optimisée (moins de pixels à traiter)
- Test automatique du renderer le plus efficace
- Paramètres de rendu optimisés pour les performances

## Optimisations Réseau

### 1. Compression des Positions

**Problème actuel** :
Envoi trop fréquent de données de position complètes.

**Solution recommandée** :
```typescript
// Côté serveur
private compressPosition(x: number, y: number): number {
  // Compresser x et y dans un seul nombre 32 bits
  // x: 16 bits, y: 16 bits
  // Plage: 0-65535 pour x et y
  const compressedX = Math.round(x * 10); // Précision à 0.1 pixel
  const compressedY = Math.round(y * 10);
  return (compressedX & 0xFFFF) | ((compressedY & 0xFFFF) << 16);
}

// Côté client
private decompressPosition(compressed: number): {x: number, y: number} {
  const x = (compressed & 0xFFFF) / 10;
  const y = ((compressed >> 16) & 0xFFFF) / 10;
  return {x, y};
}
```

**Avantages** :
- Réduction de la taille des messages de 50%
- Moins de bande passante utilisée
- Précision suffisante (0.1 pixel)

### 2. Mise à Jour Différentielle

**Problème actuel** :
Tous les champs sont envoyés à chaque mise à jour.

**Solution recommandée** :
```typescript
// Dans la classe schema.ts
@type("number") lastUpdateFlags = 0;

// Constantes pour les flags
const FLAG_POSITION = 1;
const FLAG_HEALTH = 2;
const FLAG_STATE = 4;

// Dans la méthode d'envoi des mises à jour
private sendUnitUpdate(unit: UnitSchema) {
  // Déterminer quels champs ont changé
  let flags = 0;
  
  if (unit.x !== unit.prevX || unit.y !== unit.prevY) {
    flags |= FLAG_POSITION;
    unit.prevX = unit.x;
    unit.prevY = unit.y;
  }
  
  if (unit.health !== unit.prevHealth) {
    flags |= FLAG_HEALTH;
    unit.prevHealth = unit.health;
  }
  
  if (unit.state !== unit.prevState) {
    flags |= FLAG_STATE;
    unit.prevState = unit.state;
  }
  
  // Si rien n'a changé, ne pas envoyer de mise à jour
  if (flags === 0) return;
  
  // Mise à jour des flags
  unit.lastUpdateFlags = flags;
}
```

**Avantages** :
- Envoi uniquement des champs modifiés
- Réduction du trafic réseau de 50-80%
- Meilleures performances sous contraintes réseau

### 3. Throttling Adaptatif

**Problème actuel** :
Fréquence de mise à jour réseau fixe, peu adaptative.

**Solution recommandée** :
```typescript
class AdaptiveThrottler {
  private minInterval: number;
  private maxInterval: number;
  private currentInterval: number;
  private lastUpdateTime: number = 0;
  private pingHistory: number[] = [];
  
  constructor(minInterval: number = 50, maxInterval: number = 300) {
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.currentInterval = (minInterval + maxInterval) / 2;
  }
  
  // Mettre à jour l'intervalle en fonction du ping
  updateInterval(ping: number) {
    this.pingHistory.push(ping);
    if (this.pingHistory.length > 10) {
      this.pingHistory.shift();
    }
    
    const avgPing = this.pingHistory.reduce((sum, p) => sum + p, 0) / this.pingHistory.length;
    
    // Ajuster l'intervalle selon le ping
    if (avgPing < 50) {
      this.currentInterval = this.minInterval;
    } else if (avgPing > 200) {
      this.currentInterval = this.maxInterval;
    } else {
      // Interpolation linéaire
      const t = (avgPing - 50) / 150;
      this.currentInterval = this.minInterval + t * (this.maxInterval - this.minInterval);
    }
  }
  
  // Vérifier si une mise à jour doit être envoyée
  shouldUpdate(now: number): boolean {
    if (now - this.lastUpdateTime >= this.currentInterval) {
      this.lastUpdateTime = now;
      return true;
    }
    return false;
  }
}

// Utilisation
const throttler = new AdaptiveThrottler();

// Dans la méthode update()
const now = Date.now();
if (throttler.shouldUpdate(now)) {
  this.synchronizePlayerPosition();
}
```

**Avantages** :
- Adaptation en temps réel aux conditions réseau
- Moins de congestion sur les connexions lentes
- Meilleures performances sur les réseaux rapides

## Optimisations de Données

### 1. Cache des Résultats de Recherche

**Problème actuel** :
Recherches répétées des mêmes ressources.

**Solution recommandée** :
```typescript
class ResourceCache {
  private cache: Map<string, Set<string>> = new Map();
  private expireTime: number = 2000; // 2 secondes
  private lastCacheTime: Map<string, number> = new Map();
  
  getCachedResources(x: number, y: number, radius: number): Set<string> | null {
    const key = `${Math.floor(x/10)},${Math.floor(y/10)},${radius}`;
    const now = Date.now();
    
    if (this.cache.has(key)) {
      const lastTime = this.lastCacheTime.get(key) || 0;
      if (now - lastTime < this.expireTime) {
        return this.cache.get(key) || null;
      }
    }
    
    return null; // Cache miss
  }
  
  setCachedResources(x: number, y: number, radius: number, resources: Set<string>) {
    const key = `${Math.floor(x/10)},${Math.floor(y/10)},${radius}`;
    this.cache.set(key, resources);
    this.lastCacheTime.set(key, Date.now());
    
    // Limiter la taille du cache
    if (this.cache.size > 100) {
      // Supprimer l'entrée la plus ancienne
      let oldestKey = null;
      let oldestTime = Date.now();
      
      for (const [k, _] of this.cache.entries()) {
        const time = this.lastCacheTime.get(k) || 0;
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = k;
        }
      }
      
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.lastCacheTime.delete(oldestKey);
      }
    }
  }
}

// Utilisation
const resourceCache = new ResourceCache();

private findResourceToCollect(villager: UnitSchema) {
  // Vérifier d'abord le cache
  const cachedResources = resourceCache.getCachedResources(
    villager.x, villager.y, searchRadius
  );
  
  if (cachedResources) {
    return this.processResources(cachedResources, villager);
  }
  
  // Sinon faire la recherche normalement
  const nearbyResources = this.getResourcesInRange(villager.x, villager.y, searchRadius);
  
  // Mettre en cache le résultat
  resourceCache.setCachedResources(villager.x, villager.y, searchRadius, nearbyResources);
  
  return this.processResources(nearbyResources, villager);
}
```

**Avantages** :
- Réduction significative des calculs redondants
- Particulièrement efficace pour les villageois stationnaires
- Cache adaptatif qui expire naturellement

### 2. Optimisation des Collisions

**Problème actuel** :
La méthode `isValidPosition()` est coûteuse et appelée fréquemment.

**Solution recommandée** :
```typescript
private isValidPosition(x: number, y: number): boolean {
  // Vérifier d'abord le cache
  const key = `${Math.floor(x)},${Math.floor(y)}`;
  
  if (this.positionValidityCache.has(key)) {
    return this.positionValidityCache.get(key) || false;
  }
  
  // Vérifier les limites de la carte
  if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
    this.positionValidityCache.set(key, false);
    return false;
  }
  
  // Vérifier les murs avec une fonction simplifiée
  if (this.isWallAt(x, y)) {
    this.positionValidityCache.set(key, false);
    return false;
  }
  
  // Utiliser la grille spatiale pour les ressources et bâtiments
  const nearbyEntities = this.spatialGrid.getEntitiesInRadius(x, y, 1);
  
  for (const id of nearbyEntities) {
    // Vérification simplifiée pour chaque type d'entité
    const entity = this.getEntityById(id);
    if (entity && this.isColliding(x, y, entity)) {
      this.positionValidityCache.set(key, false);
      return false;
    }
  }
  
  // Position valide
  this.positionValidityCache.set(key, true);
  return true;
}

// Simplification des tests de collision selon le type
private isColliding(x: number, y: number, entity: any): boolean {
  const dx = x - entity.x;
  const dy = y - entity.y;
  const distanceSquared = dx * dx + dy * dy;
  
  // Rayon de collision simplifié selon le type
  let radiusSquared = 16 * 16; // Valeur par défaut
  
  if (entity.type === 'tree') {
    radiusSquared = 10 * 10;
  } else if (entity.type === 'stone') {
    radiusSquared = 12 * 12;
  } else if (entity.type === 'building') {
    radiusSquared = 20 * 20;
  }
  
  return distanceSquared < radiusSquared;
}
```

**Avantages** :
- Tests simplifiés utilisant des distances au carré (évite les racines carrées)
- Utilisation d'un cache pour les positions récemment testées
- Utilisation de la grille spatiale pour limiter les entités à tester

## Recommandations d'Implémentation

1. **Priorité d'Implémentation** :
   - Commencer par l'optimisation de l'IA des villageois (impact immédiat)
   - Implémenter ensuite la grille spatiale (gain majeur avec beaucoup d'entités)
   - Ajouter le système de LOD côté client (amélioration visuelle progressive)

2. **Mesures de Performance** :
   - Ajouter un compteur FPS en mode développement
   - Monitorer l'utilisation CPU côté serveur
   - Tracer les temps d'exécution des méthodes critiques

3. **Test Progressif** :
   - Implémenter et tester une optimisation à la fois
   - Mesurer l'impact avant/après chaque modification
   - Tester sur différents dispositifs (faible/haute performance)

Cette approche globale d'optimisation devrait résoudre la majorité des problèmes de performance identifiés, tout en conservant l'intégrité du gameplay. 