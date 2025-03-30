import Phaser from 'phaser';
import { BuildingType, BUILDING_COSTS, TILE_SIZE, CHUNK_SIZE, ResourceType } from 'shared';

interface MenuItem {
  icon: string;
  tooltip: string;
  cost?: { [key: string]: number };
  action: () => void;
}

export class BuildingSystem {
  private scene: Phaser.Scene;
  private buildingSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private buildingPreview: Phaser.GameObjects.Sprite | null = null;
  private _isPlacingBuilding: boolean = false;
  private selectedBuildingType: string | null = null;
  private canPlaceBuilding: boolean = true;
  private selectedBuilding: string | null = null;
  private destroyButton: Phaser.GameObjects.Text | null = null;
  private lastProductionBarsUpdate: number = 0;

  // Getter public pour isPlacingBuilding
  get isPlacingBuilding(): boolean {
    return this._isPlacingBuilding;
  }

  // Mapping des types de bâtiments vers les noms de sprites
  public static readonly BUILDING_SPRITES = {
    [BuildingType.FORGE]: 'forge',
    [BuildingType.HOUSE]: 'house',
    [BuildingType.FURNACE]: 'furnace',
    [BuildingType.FACTORY]: 'factory',
    [BuildingType.TOWER]: 'tower',
    [BuildingType.BARRACKS]: 'barracks',
    [BuildingType.TOWN_CENTER]: 'tc',
    [BuildingType.YARD]: 'quarry',
    [BuildingType.CABIN]: 'hut',
    [BuildingType.PLAYER_WALL]: 'playerWall'
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // Configure les gestionnaires d'événements réseau pour les bâtiments
  setupNetworkHandlers(room: any) {
    if (!room) return;
    
    // Gestionnaire pour les bâtiments ajoutés
    room.state.buildings.onAdd((building: any, buildingId: string) => {
      console.log(`Bâtiment ajouté: ${buildingId}, type: ${building.type}, position: (${building.x}, ${building.y})`);
      
      // Créer le sprite du bâtiment
      const sprite = this.createBuildingSprite(building);
      
      // Ne pas repositionner le sprite - il est déjà correctement positionné dans createBuildingSprite
      // avec l'origine (0,0) qui correspond au coin supérieur gauche
      
      // Stocker le sprite dans la Map
      this.addBuildingSprite(buildingId, sprite);
      
      // Configuration des interacteurs
      this.setupBuildingSpriteInteractions(sprite, buildingId);
      
      // Vérifier si ce bâtiment a des propriétés de production
      if (['forge', 'furnace', 'factory'].includes(building.type)) {
        // Stocker les données de production
        sprite.setData('productionProgress', building.productionProgress || 0);
        sprite.setData('productionActive', building.productionActive !== false);
      }
    });
    
    // Gestionnaire pour les bâtiments supprimés
    room.state.buildings.onRemove = (building: any, buildingId: string) => {
      console.log(`Bâtiment supprimé: ${buildingId}`);
      this.removeBuildingSprite(buildingId);
    };
    
    // Gestionnaire pour les changements d'état des bâtiments
    room.state.buildings.onChange = (building: any, buildingId: string) => {
      const sprite = this.buildingSprites.get(buildingId);
      if (sprite) {
        // Mettre à jour les données du bâtiment
        sprite.setData('health', building.health);
        sprite.setData('maxHealth', building.maxHealth);
        
        // Mettre à jour la barre de vie
        this.updateBuildingHealthBar(sprite, building.health, building.maxHealth);
        
        // Mettre à jour les données de production si c'est un bâtiment de production
        if (['forge', 'furnace', 'factory'].includes(building.type)) {
          sprite.setData('productionProgress', building.productionProgress || 0);
          sprite.setData('productionActive', building.productionActive !== false);
        }
      }
    };
  }

  // Configure les interactions de survol et de clic pour un sprite de bâtiment
  private setupBuildingSpriteInteractions(sprite: Phaser.GameObjects.Sprite, buildingId: string) {
    // Rendre le sprite interactif s'il ne l'est pas déjà
    if (!sprite.input) {
      const hitArea = new Phaser.Geom.Rectangle(-TILE_SIZE/2 - 5, 0, TILE_SIZE + 10, TILE_SIZE);
      sprite.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    }
    
    // Effet de survol
    sprite.on('pointerover', () => {
      // Ne pas appliquer la teinte si le bâtiment est déjà sélectionné
      if (this.selectedBuilding !== buildingId) {
        sprite.setTint(0xaaffaa);
      }
      
      // Changer le curseur en survol
      this.scene.input.setDefaultCursor('pointer');
    });
    
    // Effet de sortie de survol
    sprite.on('pointerout', () => {
      if (this.selectedBuilding !== buildingId) {
        sprite.clearTint();
      } else {
        sprite.setTint(0x00ffff);
      }
      
      // Rétablir le curseur par défaut
      this.scene.input.setDefaultCursor('default');
    });
    
    // Effet de clic
    sprite.on('pointerdown', () => {
      console.log(`Bâtiment ${buildingId} cliqué`);
      this.selectBuilding(buildingId);
    });
  }

  startPlacingBuilding(buildingType: string) {
    this._isPlacingBuilding = true;
    this.selectedBuildingType = buildingType;
    
    // Créer un aperçu du bâtiment
    if (this.buildingPreview) {
      this.buildingPreview.destroy();
    }
    
    const spriteName = BuildingSystem.BUILDING_SPRITES[buildingType] || 'house';
    this.buildingPreview = this.scene.add.sprite(0, 0, spriteName);
    this.buildingPreview.setAlpha(0.7);
    this.buildingPreview.setDepth(5);
    
    // Ajuster l'échelle selon le type
    if (buildingType === BuildingType.TOWN_CENTER) {
      this.buildingPreview.setScale(1);
    }
    
    // Mettre à jour la position de l'aperçu avec la position actuelle de la souris
    const gameScene = this.scene as any;
    const pointer = gameScene.input.activePointer;
    const worldPoint = gameScene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    
    // Aligner sur la grille et ajouter le décalage pour centrer sur la tuile
    const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
    const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
    
    this.updateBuildingPreview(tileX, tileY);
  }

  stopPlacingBuilding() {
    this._isPlacingBuilding = false;
    this.selectedBuildingType = null;
    
    if (this.buildingPreview) {
      this.buildingPreview.destroy();
      this.buildingPreview = null;
    }
  }

  cancelPlacingBuilding() {
    this.stopPlacingBuilding();
    
    // Réinitialiser le curseur
    this.scene.input.setDefaultCursor('default');
  }

  // Retourner la Map des sprites de bâtiments (utilisée par RenderManager)
  getBuildingSprites(): Map<string, Phaser.GameObjects.Sprite> {
    return this.buildingSprites;
  }

  checkCanPlaceBuilding(tileX: number, tileY: number): boolean {
    if (!this.selectedBuildingType) return false;
    
    const gameScene = this.scene as any;
    
    // Coordonnées du coin supérieur gauche de la tuile
    // tileX et tileY sont déjà les coordonnées de la grille (sans le décalage visuel)
    
    // Vérifier si on est sur un mur
    if (gameScene.isWallAt && gameScene.isWallAt(tileX, tileY)) {
      return false;
    }
    
    // Vérifier s'il y a une collision
    if (gameScene.isCollisionAt && gameScene.isCollisionAt(tileX, tileY)) {
      return false;
    }
    
    // Vérifier si le joueur a assez de ressources
    if (gameScene.playerEntity) {
      const costs = BUILDING_COSTS[this.selectedBuildingType];
      if (costs) {
        for (const [resource, amount] of Object.entries(costs)) {
          const playerResource = gameScene.playerEntity.resources.get(resource) || 0;
          if (playerResource < amount) {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  updateBuildingPreview(tileX: number, tileY: number) {
    if (!this.buildingPreview || !this._isPlacingBuilding) return;
    
    // Positionner l'aperçu sur la tuile (tileX et tileY incluent déjà le décalage TILE_SIZE/2)
    this.buildingPreview.setPosition(tileX, tileY);
    
    // Pour la vérification de construction, utiliser les coordonnées de la grille
    // IMPORTANT: Soustraire TILE_SIZE/2 pour obtenir le coin supérieur gauche avant le calcul
    const gridX = Math.floor((tileX - TILE_SIZE/2) / TILE_SIZE) * TILE_SIZE;
    const gridY = Math.floor((tileY - TILE_SIZE/2) / TILE_SIZE) * TILE_SIZE;
    
    // Vérifier si on peut construire ici en utilisant les coordonnées du coin supérieur gauche
    this.canPlaceBuilding = this.checkCanPlaceBuilding(gridX, gridY);
    
    // Changer l'apparence en fonction de la possibilité de construire
    if (this.canPlaceBuilding) {
      this.buildingPreview.setTint(0x00ff00);
    } else {
      this.buildingPreview.setTint(0xff0000);
    }
  }

  handlePlaceBuildingAt(tileX: number, tileY: number) {
    if (!this._isPlacingBuilding || !this.selectedBuildingType || !this.canPlaceBuilding) return;
    
    const gameScene = this.scene as any;
    
    // IMPORTANT: tileX et tileY sont les coordonnées CENTRÉES sur la tuile (avec déjà +TILE_SIZE/2)
    // Pour obtenir le coin supérieur gauche (ce qu'attend le serveur), il faut soustraire TILE_SIZE/2
    console.log(`Tentative de construction de ${this.selectedBuildingType} à (${tileX}, ${tileY})`);
    
    // Envoyer une demande de construction au serveur
    if (gameScene.room) {
      // Le serveur attend les coordonnées du coin supérieur gauche de la tuile
      // Soustraire TILE_SIZE/2 puis arrondir à la tuile précise
      const alignedX = Math.floor((tileX - TILE_SIZE/2) / TILE_SIZE) * TILE_SIZE;
      const alignedY = Math.floor((tileY - TILE_SIZE/2) / TILE_SIZE) * TILE_SIZE;
      
      console.log(`Coordonnées ajustées pour le serveur: (${alignedX}, ${alignedY})`);
      
      gameScene.room.send("build", {
        type: this.selectedBuildingType,
        x: alignedX,
        y: alignedY
      });
    }
    
    // Arrêter le mode construction
    this.stopPlacingBuilding();
  }

  createBuildingSprite(building: any) {
    const spriteName = BuildingSystem.BUILDING_SPRITES[building.type] || 'house';
    // Créer le sprite à la position exacte (sans ajustement, celui-ci est fait dans onAdd)
    const sprite = this.scene.add.sprite(building.x, building.y, spriteName);
    
    // Ajuster l'origine du sprite pour qu'il s'affiche correctement par rapport à sa position logique
    // L'origine à (0, 0) positionne le sprite avec son coin supérieur gauche à la position spécifiée
    sprite.setOrigin(0, 0);
    
    // Ajuster l'échelle selon le type
    if (building.type === BuildingType.TOWN_CENTER) {
      sprite.setScale(1);
    }
    
    // Définir la profondeur pour que le bâtiment apparaisse au-dessus des tuiles
    sprite.setDepth(10);
    
    // Amélioration: s'assurer que le sprite est bien visible et interactif
    sprite.setAlpha(1);
    
    // Utiliser une zone d'interaction spécifiquement ajustée pour correspondre à la partie visible du bâtiment
    // La zone de clic est déplacée vers le bas pour mieux correspondre à l'apparence du bâtiment
    const hitArea = new Phaser.Geom.Rectangle(0, 0, TILE_SIZE, TILE_SIZE);
    sprite.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    
    // Colorer selon le propriétaire
    const gameScene = this.scene as any;
    if (building.owner !== gameScene.playerEntity?.id) {
      sprite.setTint(gameScene.hueToColor ? gameScene.hueToColor(building.hue || 0) : 0xff0000);
    }
    
    // Ajouter une barre de couleur pour indiquer le propriétaire
    if (building.owner) {
      // Récupérer le joueur propriétaire
      const owner = gameScene.room?.state.players.get(building.owner);
      if (owner && owner.hue !== undefined) {
        // Convertir la teinte en couleur
        const ownerColor = gameScene.hueToRgb ? gameScene.hueToRgb(owner.hue) : 0x00ff00;
        
        // Créer une barre de couleur sous le bâtiment
        const barWidth = TILE_SIZE * 0.8;
        const barHeight = 4;
        
        // Calculer le pourcentage de santé
        const healthPercentage = Math.max(0, Math.min(1, building.health / building.maxHealth));
        
        // Positionner la barre au centre du bâtiment
        const bar = this.scene.add.rectangle(
          sprite.x + TILE_SIZE/2,
          sprite.y + TILE_SIZE + 2,
          barWidth,
          barHeight,
          ownerColor
        );
        
        // Origine centrée
        bar.setOrigin(0.5, 0.5);
        bar.setDepth(9); // Profondeur réduite pour être sous le bâtiment (qui est à 10)
        
        // Stocker la référence à la barre
        sprite.setData('ownerBar', bar);
      }
    }
    
    // Si c'est un bâtiment de production, ajouter les barres de progression
    if (['forge', 'furnace', 'factory'].includes(building.type)) {
      // Fond de la barre de progression (gris)
      const progressBg = this.scene.add.rectangle(
        sprite.x + TILE_SIZE/2,
        sprite.y + TILE_SIZE + 8,
        TILE_SIZE * 0.8,
        5,
        0x333333
      );
      progressBg.setOrigin(0.5, 0.5);
      progressBg.setDepth(9); // Profondeur réduite pour être sous le bâtiment (qui est à 10)
      
      // Barre de progression (verte)
      const progressBar = this.scene.add.rectangle(
        sprite.x + TILE_SIZE/2 - (TILE_SIZE * 0.4), // Aligné à gauche
        sprite.y + TILE_SIZE + 8,
        0, // La largeur sera mise à jour dynamiquement
        5,
        0x00ff00
      );
      progressBar.setOrigin(0, 0.5); // Origine à gauche pour l'animation
      progressBar.setDepth(9); // Profondeur réduite pour être sous le bâtiment (qui est à 10)
      
      // Stocker des références aux barres pour les mises à jour
      sprite.setData('progressBg', progressBg);
      sprite.setData('progressBar', progressBar);
      sprite.setData('isProductionBuilding', true);
    }
    
    // Stocker des données importantes associées au bâtiment
    sprite.setData('type', building.type);
    sprite.setData('owner', building.owner);
    sprite.setData('health', building.health);
    sprite.setData('maxHealth', building.maxHealth);
    sprite.setData('buildingId', building.id);
    
    return sprite;
  }

  selectBuilding(buildingId: string | null) {
    // Désélectionner le bâtiment actuel
    if (this.selectedBuilding) {
      const currentSprite = this.buildingSprites.get(this.selectedBuilding);
      if (currentSprite) {
        currentSprite.setAlpha(1);
        // Supprimer l'encadrement de sélection
        if (currentSprite.getData('selectionGraphics')) {
          currentSprite.getData('selectionGraphics').destroy();
          currentSprite.setData('selectionGraphics', null);
        }
      }
    }
    
    // Nettoyer proprement le menu contextuel
    this.cleanupBuildingMenu();
    
    this.selectedBuilding = buildingId;
    
    // Si on sélectionne un nouveau bâtiment
    if (buildingId) {
      const sprite = this.buildingSprites.get(buildingId);
      if (sprite) {
        // Mettre en évidence le bâtiment sélectionné
        sprite.setAlpha(1);
        
        // Créer un graphique pour l'encadrement de sélection
        const selectionGraphics = this.scene.add.graphics();
        selectionGraphics.lineStyle(2, 0xffff00, 1);
        selectionGraphics.strokeRect(
          sprite.x - 5, 
          sprite.y - 5,
          TILE_SIZE + 10,
          TILE_SIZE + 10
        );
        selectionGraphics.setDepth(sprite.depth - 1);
        sprite.setData('selectionGraphics', selectionGraphics);
        
        // Vérifier si le bâtiment appartient au joueur
        const gameScene = this.scene as any;
        if (sprite.getData('owner') === gameScene.playerEntity?.id) {
          this.createBuildingMenu(sprite);
        }
      }
    }
  }

  destroySelectedBuilding() {
    if (!this.selectedBuilding) return;
    
    const gameScene = this.scene as any;
    
    console.log(`Tentative de destruction du bâtiment ${this.selectedBuilding}`);
    
    // Envoyer une demande de destruction au serveur
    if (gameScene.room) {
      gameScene.room.send("destroyBuilding", {
        buildingId: this.selectedBuilding
      });
    }
    
    // Désélectionner le bâtiment
    this.selectBuilding(null);
  }

  updateProductionBars() {
    // Mettre à jour les barres de progression de production
    const now = Date.now();
    if (now - this.lastProductionBarsUpdate < 200) return; // Limiter les mises à jour
    
    this.lastProductionBarsUpdate = now;
    
    for (const [buildingId, sprite] of this.buildingSprites.entries()) {
      // Vérifier si ce bâtiment a une production active
      const productionProgress = sprite.getData('productionProgress');
      const productionActive = sprite.getData('productionActive');
      
      if (productionActive && productionProgress !== undefined) {
        // Obtenir ou créer le graphique de progression
        let progressBar = sprite.getData('progressBar');
        if (!progressBar) {
          progressBar = this.scene.add.graphics();
          sprite.setData('progressBar', progressBar);
        }
        
        // Dessiner la barre de progression
        progressBar.clear();
        progressBar.fillStyle(0x00ff00, 0.8);
        
        // Calculer la largeur de la barre en fonction du progrès
        const maxWidth = TILE_SIZE * 0.8;
        const width = (productionProgress / 100) * maxWidth;
        
        progressBar.fillRect(
          sprite.x + TILE_SIZE/2 - maxWidth/2,
          sprite.y + TILE_SIZE + 8,
          width,
          5
        );
      } else {
        // Supprimer la barre de progression si elle existe
        const progressBar = sprite.getData('progressBar');
        if (progressBar) {
          progressBar.clear();
        }
      }
    }
  }

  updateBuildingHealthBar(buildingSprite: Phaser.GameObjects.Sprite, currentHealth: number, maxHealth: number) {
    // Créer ou mettre à jour la barre de vie du bâtiment
    let healthBar = buildingSprite.getData('healthBar');
    if (!healthBar) {
      healthBar = this.scene.add.graphics();
      buildingSprite.setData('healthBar', healthBar);
    }
    
    const barWidth = TILE_SIZE * 0.8;
    const barHeight = 4;
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));
    
    healthBar.clear();
    
    // Barre de fond (grise)
    healthBar.fillStyle(0x666666, 0.8);
    healthBar.fillRect(
      buildingSprite.x + TILE_SIZE/2 - barWidth/2,
      buildingSprite.y + TILE_SIZE + 2,
      barWidth,
      barHeight
    );
    
    // Couleur en fonction du pourcentage de vie
    let healthColor = 0x00ff00; // Vert
    if (healthPercent < 0.3) {
      healthColor = 0xff0000; // Rouge
    } else if (healthPercent < 0.6) {
      healthColor = 0xffff00; // Jaune
    }
    
    // Barre de vie
    healthBar.fillStyle(healthColor, 0.8);
    healthBar.fillRect(
      buildingSprite.x + TILE_SIZE/2 - barWidth/2,
      buildingSprite.y + TILE_SIZE + 2,
      barWidth * healthPercent,
      barHeight
    );
  }

  getSelectedBuilding(): string | null {
    return this.selectedBuilding;
  }

  addBuildingSprite(buildingId: string, sprite: Phaser.GameObjects.Sprite) {
    this.buildingSprites.set(buildingId, sprite);
  }

  removeBuildingSprite(buildingId: string) {
    const sprite = this.buildingSprites.get(buildingId);
    if (sprite) {
      console.log(`Suppression du sprite pour le bâtiment ${buildingId}`);
      
      // Supprimer les graphiques associés
      const selectionGraphics = sprite.getData('selectionGraphics');
      if (selectionGraphics) selectionGraphics.destroy();
      
      const progressBar = sprite.getData('progressBar');
      if (progressBar) progressBar.destroy();
      
      const progressBg = sprite.getData('progressBg');
      if (progressBg) progressBg.destroy();
      
      const healthBar = sprite.getData('healthBar');
      if (healthBar) healthBar.destroy();
      
      const ownerBar = sprite.getData('ownerBar');
      if (ownerBar) ownerBar.destroy();
      
      // Supprimer la zone d'influence si elle existe
      const influenceGraphics = sprite.getData('influenceGraphics');
      if (influenceGraphics) influenceGraphics.destroy();
      
      const areaGraphics = sprite.getData('areaGraphics');
      if (areaGraphics) areaGraphics.destroy();
      
      // Désélectionner le bâtiment s'il est sélectionné
      if (this.selectedBuilding === buildingId) {
        this.selectBuilding(null);
      }
      
      // Supprimer tous les écouteurs d'événements pour éviter les fuites de mémoire
      sprite.removeAllListeners();
      
      // Détruire le sprite
      sprite.destroy();
      this.buildingSprites.delete(buildingId);
      
      console.log(`Sprite du bâtiment ${buildingId} supprimé avec succès`);
    } else {
      console.warn(`Impossible de trouver le sprite du bâtiment ${buildingId} pour le supprimer`);
      
      // Recherche secondaire parmi tous les sprites
      const gameScene = this.scene as any;
      gameScene.children.list.forEach((child: any) => {
        if (child.type === 'Sprite' && child.getData('buildingId') === buildingId) {
          console.log(`Sprite du bâtiment ${buildingId} trouvé par recherche secondaire`);
          child.destroy();
        }
      });
    }
  }

  // Nettoyer proprement le menu contextuel
  private cleanupBuildingMenu() {
    if (!this.destroyButton) return;
    
    // Récupérer et détruire tous les boutons du menu
    for (let i = -20; i <= 20; i++) {
      const buttonKey = `button_${i * 20}`;
      const button = this.destroyButton.getData(buttonKey);
      if (button) {
        // Supprimer les tooltips et infos de coût associés
        const tooltip = button.getData('tooltip');
        if (tooltip) tooltip.destroy();
        
        const costDisplay = button.getData('costDisplay');
        if (costDisplay) costDisplay.destroy();
        
        // Détruire le bouton
        button.destroy();
      }
    }
    
    // Retirer le gestionnaire d'événements de clic extérieur
    const clickOutsideHandler = this.destroyButton.getData('clickOutsideHandler');
    if (clickOutsideHandler) {
      this.scene.input.off('pointerdown', clickOutsideHandler);
    }
    
    // Méthode plus agressive pour nettoyer tous les éléments liés au menu
    // Rechercher et détruire tous les objets texte avec une profondeur > 100 (ce qui correspond au menu)
    const allGameObjects = this.scene.children.list;
    allGameObjects.forEach(obj => {
      // Vérifier que l'objet a une propriété depth (GameObject ne l'a pas par défaut)
      if ((obj as any).depth !== undefined) {
        // Si c'est un objet avec une profondeur élevée (menu, tooltips, etc.)
        if ((obj as any).depth >= 100) {
          obj.destroy();
        }
      }
    });
    
    // Nettoyage direct de la liste des éléments de menu
    if (this.menuElements && this.menuElements.length > 0) {
      this.menuElements.forEach(element => {
        if (element && typeof element.destroy === 'function') {
          element.destroy();
        }
      });
      this.menuElements = [];
    }
    
    // Détruire le fond du menu
    if (this.destroyButton) {
      this.destroyButton.destroy();
    }
    this.destroyButton = null;
  }

  // Sauvegarder tous les éléments créés pour le menu
  private menuElements: Phaser.GameObjects.GameObject[] = [];

  createBuildingMenu(sprite: Phaser.GameObjects.Sprite) {
    // Nettoyer tous les éléments précédents du menu
    this.cleanupBuildingMenu();
    
    // Réinitialiser le tableau des éléments du menu
    this.menuElements = [];
    
    const buildingType = sprite.getData('type');
    const menuItems: MenuItem[] = [];
    
    // Obtenir les dimensions pour positionner le menu
    const menuY = sprite.y + TILE_SIZE + 10; // Positionner sous le bâtiment
    
    // 1. Ajouter l'icône de recyclage (détruire) pour tous les bâtiments
    menuItems.push({
      icon: '♻️',
      tooltip: 'Détruire',
      action: () => this.destroySelectedBuilding()
    });
    
    // 2. Ajouter les icônes de production d'unités spécifiques
    if (buildingType === BuildingType.BARRACKS) {
      menuItems.push({
        icon: '⚔️',
        tooltip: 'Guerrier',
        cost: { [ResourceType.GOLD]: 2, [ResourceType.IRON]: 2 },
        action: () => this.spawnUnit('WARRIOR')
      });
    }
    
    if (buildingType === BuildingType.TOWN_CENTER) {
      menuItems.push({
        icon: '👨‍🌾',
        tooltip: 'Villageois',
        cost: { [ResourceType.GOLD]: 10 },
        action: () => this.spawnVillager()
      });
    }
    
    // 3. Ajouter un bouton de pause/reprise pour les bâtiments de production
    if (['forge', 'furnace', 'factory'].includes(buildingType)) {
      const isActive = sprite.getData('productionActive') !== false;
      menuItems.push({
        icon: isActive ? '⏸️' : '▶️',
        tooltip: isActive ? 'Mettre en pause' : 'Reprendre',
        action: () => this.toggleProduction(sprite)
      });
    }
    
    // Créer un menu contextuel avec fond - dimensions réduites de moitié
    const menuWidth = menuItems.length * 20 + 5; // Réduit de 40 à 20 par icône
    const menuHeight = 25; // Réduit de 50 à 25
    const menuX = sprite.x + TILE_SIZE/2 - menuWidth / 2;
    
    // Créer le fond du menu
    const menuBackground = this.scene.add.rectangle(
      sprite.x + TILE_SIZE/2,
      menuY,
      menuWidth,
      menuHeight,
      0x333333,
      0.8
    );
    menuBackground.setOrigin(0.5, 0.5);
    menuBackground.setStrokeStyle(1, 0x666666);
    menuBackground.setDepth(100);
    
    // Ajouter le fond du menu à la liste des éléments
    this.menuElements.push(menuBackground);
    
    // Stocker une référence au menu pour pouvoir le supprimer plus tard
    this.destroyButton = menuBackground as any;
    
    // Ajouter les icônes au menu - espacement réduit de moitié
    let offsetX = -((menuItems.length - 1) * 20) / 2; // Réduit de 40 à 20
    menuItems.forEach(item => {
      // Créer le bouton d'icône - taille réduite
      const button = this.scene.add.text(
        sprite.x + TILE_SIZE/2 + offsetX,
        menuY,
        item.icon,
        {
          fontSize: '12px', // Réduit de 24px à 12px
          padding: {
            left: 4, // Réduit de 8 à 4
            right: 4, // Réduit de 8 à 4
            top: 2, // Réduit de 4 à 2
            bottom: 2 // Réduit de 4 à 2
          }
        }
      ).setOrigin(0.5, 0.5);
      
      button.setDepth(101);
      button.setInteractive({ useHandCursor: true });
      
      // Ajouter le bouton à la liste des éléments
      this.menuElements.push(button);
      
      // Ajouter des effets de survol
      button.on('pointerover', () => {
        button.setStyle({ fontSize: '13px' }); // Réduit de 26px à 13px
        
        // Afficher le tooltip et le coût si disponible
        if (item.tooltip) {
          const tooltipY = menuY + menuHeight/2 + 8; // Réduit de 15 à 8
          const tooltipText = item.tooltip;
          
          const tooltip = this.scene.add.text(
            sprite.x + TILE_SIZE/2,
            tooltipY,
            tooltipText,
            {
              fontSize: '10px', // Réduit de 14px à 10px
              backgroundColor: '#222222',
              padding: { x: 3, y: 2 }, // Réduit de x:5,y:3 à x:3,y:2
              stroke: '#000000',
              strokeThickness: 1
            }
          ).setOrigin(0.5, 0);
          tooltip.setDepth(102);
          button.setData('tooltip', tooltip);
          
          // Ajouter le tooltip à la liste des éléments
          this.menuElements.push(tooltip);
          
          // Afficher le coût si disponible
          if (item.cost) {
            let costText = '';
            Object.entries(item.cost).forEach(([resource, amount], index) => {
              // Convertir le nom de la ressource à afficher en format lisible
              const resourceName = this.getResourceDisplayName(resource);
              // Ajouter un séparateur entre les ressources
              if (index > 0) costText += ' | ';
              costText += `${resourceName}: ${amount}`;
            });
            
            const costDisplay = this.scene.add.text(
              sprite.x + TILE_SIZE/2,
              tooltipY + 15, // Réduit de 25 à 15
              costText,
              {
                fontSize: '8px', // Réduit de 12px à 8px
                backgroundColor: '#222222',
                padding: { x: 3, y: 2 }, // Réduit de x:5,y:3 à x:3,y:2
                stroke: '#000000',
                strokeThickness: 1,
                color: '#FFCC33' // Couleur dorée pour les coûts
              }
            ).setOrigin(0.5, 0);
            costDisplay.setDepth(102);
            button.setData('costDisplay', costDisplay);
            
            // Ajouter l'affichage du coût à la liste des éléments
            this.menuElements.push(costDisplay);
          }
        }
      });
      
      button.on('pointerout', () => {
        button.setStyle({ fontSize: '12px' }); // Réduit de 24px à 12px
        
        // Supprimer tooltip et coût
        const tooltip = button.getData('tooltip');
        if (tooltip) {
          tooltip.destroy();
          button.setData('tooltip', null);
        }
        
        const costDisplay = button.getData('costDisplay');
        if (costDisplay) {
          costDisplay.destroy();
          button.setData('costDisplay', null);
        }
      });
      
      button.on('pointerdown', item.action);
      
      // Stocker une référence à ce bouton
      menuBackground.setData(`button_${offsetX}`, button);
      
      offsetX += 20; // Réduit de 40 à 20
    });

    // Ajouter un gestionnaire d'événements pour fermer le menu lorsqu'on clique ailleurs
    const clickOutsideHandler = (pointer: Phaser.Input.Pointer) => {
      // Vérifier si le clic est en dehors du bâtiment et du menu
      const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      
      // Vérifier si le clic est sur le menu
      const menuBounds = menuBackground.getBounds();
      if (menuBounds.contains(worldPoint.x, worldPoint.y)) {
        return; // Ne rien faire si le clic est sur le menu
      }
      
      // Vérifier si le clic est sur le bâtiment
      const spriteBounds = new Phaser.Geom.Rectangle(
        sprite.x - sprite.displayWidth/2,
        sprite.y - sprite.displayHeight/2,
        sprite.displayWidth,
        sprite.displayHeight
      );
      
      if (!spriteBounds.contains(worldPoint.x, worldPoint.y)) {
        // Le clic est en dehors du bâtiment et du menu, désélectionner
        this.selectBuilding(null);
        // Retirer ce gestionnaire d'événements après utilisation
        this.scene.input.off('pointerdown', clickOutsideHandler);
      }
    };
    
    // Ajouter le gestionnaire d'événements avec un délai pour éviter qu'il ne se déclenche immédiatement
    this.scene.time.delayedCall(100, () => {
      this.scene.input.on('pointerdown', clickOutsideHandler);
    });
    
    // Stocker la référence au gestionnaire pour pouvoir le nettoyer plus tard
    menuBackground.setData('clickOutsideHandler', clickOutsideHandler);
  }
  
  spawnUnit(unitType: string) {
    if (!this.selectedBuilding) return;
    
    const gameScene = this.scene as any;
    
    console.log(`Tentative de création d'unité ${unitType} depuis le bâtiment ${this.selectedBuilding}`);
    
    // Envoyer une demande de création au serveur
    if (gameScene.room) {
      gameScene.room.send("spawnUnit", {
        buildingId: this.selectedBuilding,
        unitType: unitType
      });
    }
  }
  
  spawnVillager() {
    if (!this.selectedBuilding) return;
    
    const gameScene = this.scene as any;
    
    console.log(`Tentative de création d'un villageois depuis le bâtiment ${this.selectedBuilding}`);
    
    // Envoyer une demande de création au serveur
    if (gameScene.room) {
      gameScene.room.send("spawnVillager", {
        buildingId: this.selectedBuilding
      });
    }
  }
  
  toggleProduction(sprite: Phaser.GameObjects.Sprite) {
    if (!this.selectedBuilding) return;
    
    const gameScene = this.scene as any;
    const isActive = sprite.getData('productionActive') !== false;
    
    console.log(`Tentative de ${isActive ? 'pause' : 'reprise'} de la production pour ${this.selectedBuilding}`);
    
    // Envoyer une demande au serveur
    if (gameScene.room) {
      gameScene.room.send("toggleProduction", {
        buildingId: this.selectedBuilding,
        active: !isActive
      });
      
      // Mettre à jour l'état local en attendant la confirmation du serveur
      sprite.setData('productionActive', !isActive);
    }
  }

  // Utilitaire pour convertir les clés de ressources en noms affichables
  private getResourceDisplayName(resourceKey: string): string {
    // Map des clés de ressources vers des noms affichables
    const resourceDisplayNames: {[key: string]: string} = {
      'gold': 'Or',
      'wood': 'Bois',
      'stone': 'Pierre',
      'iron': 'Fer',
      'coal': 'Charbon',
      'steel': 'Acier'
    };
    
    return resourceDisplayNames[resourceKey] || resourceKey;
  }
} 