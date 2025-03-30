import Phaser from 'phaser';
import { ResourceType, HARVEST_AMOUNT, RESOURCE_AMOUNTS } from 'shared';
import { ObjectPool } from '../utils/ObjectPool';

export class ResourceSystem {
  private scene: Phaser.Scene;
  private resourceSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private visibleResources: Set<string> = new Set();
  private isHarvesting: boolean = false;
  private harvestTarget: { id: string, type: string } | null = null;
  private isMiningActive: boolean = false;
  private numericEffects: Phaser.GameObjects.Group | null = null;
  private textEffectPool?: ObjectPool<Phaser.GameObjects.Text>;
  private miningConfig = {
    cooldown: 500,
    animationPhases: 3,
    phaseSpeed: 150,
    lastCollectTime: 0
  };
  private tool?: Phaser.GameObjects.Sprite;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initializeObjectPools();
  }

  setTool(tool: Phaser.GameObjects.Sprite) {
    this.tool = tool;
  }

  private initializeObjectPools() {
    // Initialiser le pool de textes pour les effets
    this.textEffectPool = new ObjectPool<Phaser.GameObjects.Text>(
      () => {
        const text = this.scene.add.text(0, 0, '', {
          fontSize: '16px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3
        });
        text.setOrigin(0.5);
        text.setAlpha(0);
        text.setDepth(100);
        return text;
      },
      (text: Phaser.GameObjects.Text) => {
        text.setAlpha(0);
        text.setActive(false);
        text.setVisible(false);
      },
      50
    );
  }

  initializeResourceListeners() {
    // Cette méthode configure les écouteurs d'événements réseau pour les ressources
    const gameScene = this.scene as any; // Pour accéder aux propriétés de GameScene
    
    if (!gameScene.room) return;
    
    gameScene.room.onMessage("resourceAdded", (resource) => {
      console.log(`Ressource ajoutée: ${resource.id} de type ${resource.type} à (${resource.x}, ${resource.y})`);
      
      // Si on a déjà cette ressource, la supprimer d'abord
      if (this.resourceSprites.has(resource.id)) {
        const existingSprite = this.resourceSprites.get(resource.id);
        if (existingSprite) existingSprite.destroy();
        this.resourceSprites.delete(resource.id);
      }
      
      // Créer le sprite pour cette ressource
      const sprite = this.createResource(resource.type, resource.x, resource.y);
      this.resourceSprites.set(resource.id, sprite);
      this.visibleResources.add(resource.id);
      
      // Mettre à jour les propriétés
      if (resource.amount) {
        sprite.setData('amount', resource.amount);
      }
    });
    
    gameScene.room.onMessage("resourceUpdated", (resource) => {
      const sprite = this.resourceSprites.get(resource.id);
      if (sprite && resource.amount !== undefined) {
        sprite.setData('amount', resource.amount);
        
        // Animation de shake
        if (resource.harvested) {
          this.addShakeEffect(sprite);
          
          // Trouver la position de la caméra pour décaler le texte
          const cameraX = gameScene.cameras.main.scrollX;
          const cameraY = gameScene.cameras.main.scrollY;
          
          // Afficher l'effet de texte
          this.showNumericEffect(
            `+${HARVEST_AMOUNT[resource.type] || 1}`, 
            sprite.x - cameraX + this.scene.cameras.main.width / 2,
            sprite.y - cameraY + this.scene.cameras.main.height / 2, 
            resource.type
          );
        }
      }
    });
    
    gameScene.room.onMessage("resourceRemoved", (resourceId) => {
      console.log(`Ressource supprimée: ${resourceId}`);
      if (this.resourceSprites.has(resourceId)) {
        this.depleteResource(this.resourceSprites.get(resourceId)!, resourceId);
      }
      this.visibleResources.delete(resourceId);
    });
  }

  createResource(type: string, x: number, y: number): Phaser.GameObjects.Sprite {
    // Créer un sprite en fonction du type de ressource
    let spriteName;
    let scale = 1;
    
    switch (type) {
      case ResourceType.WOOD:
        spriteName = 'tree';
        scale = 1;
        break;
      case ResourceType.STONE:
        spriteName = 'stone';
        scale = 0.8;
        break;
      case ResourceType.IRON:
        spriteName = 'iron';
        scale = 0.8;
        break;
      case ResourceType.GOLD:
        spriteName = 'gold';
        scale = 0.8;
        break;
      case ResourceType.COAL:
        spriteName = 'coal';
        scale = 0.7;
        break;
      case ResourceType.STEEL:
        spriteName = 'steel';
        scale = 0.7;
        break;
      default:
        spriteName = 'tree';
        break;
    }
    
    const sprite = this.scene.add.sprite(x, y, spriteName);
    sprite.setScale(scale);
    sprite.setData('type', type);
    sprite.setData('amount', RESOURCE_AMOUNTS[type] || 100);
    sprite.setData('originalScale', scale);
    
    return sprite;
  }

  depleteResource(sprite: Phaser.GameObjects.Sprite, resourceId: string) {
    // Animation de suppression d'une ressource
    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      scaleX: 0,
      scaleY: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        sprite.destroy();
        this.resourceSprites.delete(resourceId);
      }
    });
  }

  showNumericEffect(text: string, x: number, y: number, type: string = '', scale: number = 1) {
    if (!this.textEffectPool) return;
    
    const textEffect = this.textEffectPool.get();
    if (!textEffect) return;
    
    textEffect.setText(text);
    textEffect.setPosition(x, y - 20);
    textEffect.setAlpha(1);
    textEffect.setScale(scale);
    
    // Choisir la couleur en fonction du type
    let color = '#ffffff';
    switch (type) {
      case ResourceType.WOOD:
        color = '#8B4513';
        break;
      case ResourceType.STONE:
        color = '#A9A9A9';
        break;
      case ResourceType.IRON:
        color = '#B87333';
        break;
      case ResourceType.GOLD:
        color = '#FFD700';
        break;
      case ResourceType.COAL:
        color = '#3C3C3C';
        break;
      case ResourceType.STEEL:
        color = '#708090';
        break;
      default:
        color = '#ffffff';
    }
    
    textEffect.setColor(color);
    
    // Animation de montée et de disparition
    this.scene.tweens.add({
      targets: textEffect,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        this.textEffectPool?.release(textEffect);
      }
    });
  }

  addShakeEffect(sprite: Phaser.GameObjects.Sprite, intensity: number = 1) {
    // Arrêter tout tween précédent sur ce sprite
    this.scene.tweens.killTweensOf(sprite);
    
    const createNextTween = (index: number) => {
      if (index >= 4) return; // Limiter le nombre de tremblements
      
      const isEven = index % 2 === 0;
      const direction = isEven ? 1 : -1;
      const distance = 3 * intensity * (4 - index) / 4; // Réduire progressivement l'intensité
      
      this.scene.tweens.add({
        targets: sprite,
        x: sprite.x + direction * distance,
        duration: 50,
        ease: 'Power1',
        onComplete: () => {
          createNextTween(index + 1);
        }
      });
    };
    
    // Démarrer la séquence de tremblements
    createNextTween(0);
  }

  checkToolResourceCollision(): { id: string, type: string } | null {
    if (!this.tool) return null;
    
    const toolBounds = this.tool.getBounds();
    
    for (const [resourceId, resourceSprite] of this.resourceSprites.entries()) {
      // Ignorer les ressources invisibles ou inactives
      if (!resourceSprite.visible || !resourceSprite.active) continue;
      
      // Créer un rectangle un peu plus grand pour la ressource
      const expandedBounds = resourceSprite.getBounds();
      expandedBounds.inflate(10, 10); // Agrandir légèrement la zone de collision
      
      if (Phaser.Geom.Rectangle.Overlaps(toolBounds, expandedBounds)) {
        return {
          id: resourceId,
          type: resourceSprite.getData('type')
        };
      }
    }
    
    return null;
  }

  collectResource(resource: { id: string, type: string }) {
    // Cette méthode envoie une demande de collecte au serveur
    const gameScene = this.scene as any;
    
    if (!gameScene.room) return;
    
    console.log(`Collecte de ressource: ${resource.id} (${resource.type})`);
    
    // Envoyer un message au serveur pour collecter cette ressource
    gameScene.room.send("harvest", {
      resourceId: resource.id
    });
  }

  updateMining(time: number) {
    // Vérifier si on est en train de miner et si un écart suffisant s'est écoulé
    if (this.isMiningActive && 
        time > this.miningConfig.lastCollectTime + this.miningConfig.cooldown) {
      
      // Vérifier s'il y a des ressources à collecter
      const resourceCollision = this.checkToolResourceCollision();
      if (resourceCollision) {
        // Mettre à jour le temps de la dernière collecte
        this.miningConfig.lastCollectTime = time;
        
        // Collecter la ressource
        this.collectResource(resourceCollision);
      }
    }
  }

  cleanupInvisibleResources(removedChunks: string[]) {
    // Nettoyer les ressources qui ne sont plus visibles
    if (removedChunks.length === 0) return;
    
    const gameScene = this.scene as any;
    
    console.log(`Nettoyage des ressources pour ${removedChunks.length} chunks supprimés`);
    
    for (const resourceId of this.visibleResources) {
      const sprite = this.resourceSprites.get(resourceId);
      if (!sprite) continue;
      
      // Convertir la position en position de chunk
      const resourceChunkX = Math.floor(sprite.x / (gameScene.tileSize * gameScene.CHUNK_SIZE));
      const resourceChunkY = Math.floor(sprite.y / (gameScene.tileSize * gameScene.CHUNK_SIZE));
      const resourceChunkKey = `${resourceChunkX},${resourceChunkY}`;
      
      // Si ce chunk est parmi ceux supprimés, supprimer le sprite
      if (removedChunks.includes(resourceChunkKey)) {
        console.log(`Suppression du sprite de ressource ${resourceId} dans le chunk ${resourceChunkKey}`);
        sprite.destroy();
        this.resourceSprites.delete(resourceId);
        this.visibleResources.delete(resourceId);
      }
    }
  }

  startMining() {
    this.isMiningActive = true;
  }

  stopMining() {
    this.isMiningActive = false;
  }

  getVisibleResources(): Set<string> {
    return this.visibleResources;
  }

  getResourceSprites(): Map<string, Phaser.GameObjects.Sprite> {
    return this.resourceSprites;
  }
} 