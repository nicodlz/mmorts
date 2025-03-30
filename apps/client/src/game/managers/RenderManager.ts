import Phaser from 'phaser';
import { TILE_SIZE, CHUNK_SIZE } from 'shared';
import { PerformanceManager } from '../utils/PerformanceManager';

export class RenderManager {
  private scene: Phaser.Scene;
  private visibleScreenRect: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private lastRenderOptimization: number = 0;
  private readonly RENDER_OPTIMIZATION_INTERVAL: number = 500;
  private loadedChunks: Set<string> = new Set();
  private renderDistance: number = 4;
  private lastLoadedChunkX: number = -1;
  private lastLoadedChunkY: number = -1;
  private tileLayers: Map<string, Phaser.GameObjects.Image> = new Map();
  private tilePool: Phaser.GameObjects.Image[] = [];
  private maxTilePoolSize: number = 500;
  private lastCleanupTime: number = 0;
  private cleanupInterval: number = 5000;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  optimizeRendering() {
    // Mettre à jour le rectangle visible
    const camera = this.scene.cameras.main;
    this.visibleScreenRect.setTo(
      camera.scrollX,
      camera.scrollY,
      camera.width,
      camera.height
    );
    
    // Récupérer les sprites pour les optimiser
    const gameScene = this.scene as any;
    
    // Optimiser les ressources
    if (gameScene.resourceSystem) {
      const resourceSprites = gameScene.resourceSystem.getResourceSprites();
      for (const [id, sprite] of resourceSprites.entries()) {
        if (!sprite || !sprite.active) continue;
        
        this.optimizeSprite(sprite);
      }
    }
    
    // Optimiser les bâtiments
    if (gameScene.buildingSystem) {
      const buildingSprites = gameScene.buildingSystem.getBuildingSprites();
      for (const [id, sprite] of buildingSprites.entries()) {
        if (!sprite || !sprite.active) continue;
        
        this.optimizeSprite(sprite);
      }
    }
    
    // Optimiser les unités
    if (gameScene.unitSystem) {
      const unitSprites = gameScene.unitSystem.getUnitSprites();
      for (const [id, unitData] of unitSprites.entries()) {
        if (!unitData || !unitData.sprite || !unitData.sprite.active) continue;
        
        this.optimizeContainer(unitData.sprite);
      }
    }
    
    // Optimiser les autres joueurs
    if (gameScene.otherPlayers) {
      for (const [id, playerSprite] of gameScene.otherPlayers.entries()) {
        if (!playerSprite || !playerSprite.active) continue;
        
        this.optimizeContainer(playerSprite);
      }
    }
  }

  private optimizeSprite(sprite: Phaser.GameObjects.Sprite) {
    const bounds = sprite.getBounds();
    
    // Comparer avec le rectangle de la caméra
    const isVisible = Phaser.Geom.Rectangle.Overlaps(this.visibleScreenRect, bounds);
    
    // Désactiver les sprites hors de l'écran
    sprite.setActive(isVisible);
    sprite.setVisible(isVisible);
  }

  private optimizeContainer(container: Phaser.GameObjects.Container) {
    const bounds = container.getBounds();
    
    // Comparer avec le rectangle de la caméra
    const isVisible = Phaser.Geom.Rectangle.Overlaps(this.visibleScreenRect, bounds);
    
    // Désactiver les conteneurs hors de l'écran
    container.setActive(isVisible);
    container.setVisible(isVisible);
  }

  updateVisibleChunks(playerX: number, playerY: number) {
    const playerChunkX = Math.floor(playerX / (TILE_SIZE * CHUNK_SIZE));
    const playerChunkY = Math.floor(playerY / (TILE_SIZE * CHUNK_SIZE));
    
    // Si on est toujours dans le même chunk, ne rien faire
    if (playerChunkX === this.lastLoadedChunkX && playerChunkY === this.lastLoadedChunkY) {
      return { newChunks: [], removedChunks: [] };
    }
    
    // Mettre à jour les chunks actuels
    this.lastLoadedChunkX = playerChunkX;
    this.lastLoadedChunkY = playerChunkY;
    
    const newChunks: string[] = [];
    const currentChunks: Set<string> = new Set();
    
    // Calculer les chunks visibles autour du joueur
    for (let y = playerChunkY - this.renderDistance; y <= playerChunkY + this.renderDistance; y++) {
      for (let x = playerChunkX - this.renderDistance; x <= playerChunkX + this.renderDistance; x++) {
        const chunkKey = `${x},${y}`;
        currentChunks.add(chunkKey);
        
        // Si ce chunk n'est pas déjà chargé, l'ajouter à la liste des nouveaux chunks
        if (!this.loadedChunks.has(chunkKey)) {
          newChunks.push(chunkKey);
          this.loadedChunks.add(chunkKey);
        }
      }
    }
    
    // Trouver les chunks qui ne sont plus visibles
    const removedChunks: string[] = [];
    for (const chunkKey of this.loadedChunks) {
      if (!currentChunks.has(chunkKey)) {
        removedChunks.push(chunkKey);
        this.loadedChunks.delete(chunkKey);
      }
    }
    
    // Retourner les listes des nouveaux chunks et des chunks supprimés
    return { newChunks, removedChunks };
  }

  getTileFromPool(texture: string): Phaser.GameObjects.Image {
    // Essayer de réutiliser une tuile du pool
    for (let i = 0; i < this.tilePool.length; i++) {
      const tile = this.tilePool[i];
      if (tile.texture.key === texture) {
        // Retirer la tuile du pool et la retourner
        this.tilePool.splice(i, 1);
        return tile;
      }
    }
    
    // Si aucune tuile compatible n'est trouvée, en créer une nouvelle
    return this.scene.add.image(0, 0, texture);
  }

  releaseTileToPool(tile: Phaser.GameObjects.Image) {
    // Vérifier si le pool n'est pas déjà trop grand
    if (this.tilePool.length < this.maxTilePoolSize) {
      // Réinitialiser les propriétés et ajouter au pool
      tile.setActive(false);
      tile.setVisible(false);
      this.tilePool.push(tile);
    } else {
      // Détruire la tuile si le pool est plein
      tile.destroy();
    }
  }

  cleanupTilePool(force: boolean = false) {
    const now = Date.now();
    
    // Nettoyer seulement si assez de temps s'est écoulé depuis le dernier nettoyage
    if (!force && now - this.lastCleanupTime < this.cleanupInterval) {
      return;
    }
    
    this.lastCleanupTime = now;
    
    // Si le pool est trop grand, réduire sa taille
    if (this.tilePool.length > this.maxTilePoolSize / 2) {
      // Supprimer l'excès de tuiles
      const tilesToRemove = this.tilePool.slice(this.maxTilePoolSize / 2);
      this.tilePool = this.tilePool.slice(0, this.maxTilePoolSize / 2);
      
      // Détruire les tuiles supprimées
      for (const tile of tilesToRemove) {
        tile.destroy();
      }
      
      console.log(`Pool de tuiles nettoyé: ${tilesToRemove.length} tuiles supprimées`);
    }
  }

  snapCameraToGrid() {
    const camera = this.scene.cameras.main;
    camera.scrollX = Math.floor(camera.scrollX);
    camera.scrollY = Math.floor(camera.scrollY);
  }

  updateDynamicParameters() {
    // Ajuster les paramètres en fonction du niveau de performance
    const qualityLevel = PerformanceManager.getCurrentQualityLevel();
    
    // Ajuster la distance de rendu
    switch (qualityLevel) {
      case 'low':
        this.renderDistance = 2;
        this.maxTilePoolSize = 200;
        this.RENDER_OPTIMIZATION_INTERVAL = 1000;
        break;
      case 'medium':
        this.renderDistance = 3;
        this.maxTilePoolSize = 350;
        this.RENDER_OPTIMIZATION_INTERVAL = 750;
        break;
      case 'high':
        this.renderDistance = 4;
        this.maxTilePoolSize = 500;
        this.RENDER_OPTIMIZATION_INTERVAL = 500;
        break;
      case 'ultra':
        this.renderDistance = 5;
        this.maxTilePoolSize = 650;
        this.RENDER_OPTIMIZATION_INTERVAL = 250;
        break;
    }
    
    // Limiter la taille du pool si nécessaire
    this.cleanupTilePool(true);
  }

  getRenderDistance(): number {
    return this.renderDistance;
  }

  getLoadedChunks(): Set<string> {
    return this.loadedChunks;
  }

  shouldOptimizeRendering(time: number): boolean {
    return time - this.lastRenderOptimization > PerformanceManager.renderOptimizationInterval;
  }

  updateLastRenderOptimization(time: number) {
    this.lastRenderOptimization = time;
  }
} 