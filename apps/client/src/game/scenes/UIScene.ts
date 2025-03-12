import Phaser from 'phaser';
import { ResourceType, BuildingType, TILE_SIZE } from 'shared';

export class UIScene extends Phaser.Scene {
  // Éléments UI
  private resourceTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private buildMenu?: Phaser.GameObjects.Container;
  private healthBar: Phaser.GameObjects.Graphics;
  private minimap: Phaser.GameObjects.Graphics;
  private minimapDiscoveredAreas: Phaser.GameObjects.Graphics;
  private fpsText: Phaser.GameObjects.Text;
  private populationText: Phaser.GameObjects.Text;
  
  // Pour la minimap
  private minimapMemory: Map<string, {color: number, type: string}> = new Map();
  private minimapRadius: number = 30; // Rayon visible autour du joueur en tuiles (augmenté à 30)
  
  // Pour la carte complète
  private fullMap: Phaser.GameObjects.Container;
  private fullMapBackground: Phaser.GameObjects.Graphics;
  private fullMapContent: Phaser.GameObjects.Graphics;
  private fullMapVisible: boolean = false;
  private mKey: Phaser.Input.Keyboard.Key;
  private fullMapWidth: number = 0;
  private fullMapHeight: number = 0;
  
  // Référence à la scène de jeu
  private gameScene: Phaser.Scene;
  
  // Constantes de profondeur pour l'UI
  private static readonly DEPTHS = {
    BACKGROUND: 90,
    RESOURCES_UI: 91,
    BUILD_MENU: 92,
    MINIMAP: 93,
    FPS_COUNTER: 94
  };
  
  // Ajouter ces propriétés
  private selectedBuildingIndex: number = -1;
  private selectedOverlay?: Phaser.GameObjects.Graphics;
  
  private static readonly BUILDING_SPRITES = {
    [BuildingType.FORGE]: 'forge',
    [BuildingType.HOUSE]: 'house',
    [BuildingType.FURNACE]: 'furnace',
    [BuildingType.FACTORY]: 'factory',
    [BuildingType.TOWER]: 'tower',
    [BuildingType.BARRACKS]: 'barracks',
    [BuildingType.TOWN_CENTER]: 'tc',
    [BuildingType.YARD]: 'quarry',
    [BuildingType.CABIN]: 'hut',
    [BuildingType.PLAYER_WALL]: 'playerwall'
  };
  
  constructor() {
    super({ key: 'UIScene' });
  }
  
  preload() {
    // Charger les sprites des bâtiments
    this.load.image('forge', '/sprites/forge.png');
    this.load.image('house', '/sprites/house.png');
    this.load.image('furnace', '/sprites/furnace.png');
    this.load.image('factory', '/sprites/factory.png');
    this.load.image('tower', '/sprites/tower.png');
    this.load.image('barracks', '/sprites/barracks.png');
    this.load.image('tc', '/sprites/tc.png');
    this.load.image('quarry', '/sprites/quarry.png');
    this.load.image('hut', '/sprites/hut.png');
    this.load.image('playerwall', '/sprites/playerWall.png');
  }
  
  create() {
    // Nettoyer tous les anciens éléments d'UI au démarrage
    this.cleanupAllUI();

    // Référence à la scène de jeu
    this.gameScene = this.scene.get('GameScene');
    
    // L'UI reste fixe et ne suit pas la caméra principale
    this.cameras.main.setScroll(0, 0);
    
    // Créer l'affichage des ressources
    this.createResourceDisplay();
    
    // Créer la mini-carte
    this.createMinimap();
    
    // Créer la carte complète (initialement cachée)
    this.createFullMap();
    
    // Créer le menu de construction (initialement caché)
    this.createBuildMenu();
    
    // Créer l'affichage des FPS
    this.createFpsCounter();
    
    // Créer l'indicateur de population
    this.createPopulationDisplay();
    
    // Configurer la touche M pour ouvrir/fermer la carte (au lieu de F)
    if (this.input.keyboard) {
      this.mKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
      this.input.keyboard.on('keydown-M', this.toggleFullMap, this);
    }
    
    // Écouter les événements de la scène de jeu
    this.gameScene.events.on('updateResources', this.updateResourceDisplay, this);
    this.gameScene.events.on('updatePopulation', this.updatePopulationDisplay, this);
    
    // Écouter les événements pour mettre à jour la minimap
    this.gameScene.events.on('updatePlayerPosition', this.updateMinimap, this);
    this.gameScene.events.on('updateResources', this.updateMinimap, this);
    
    // Écouter pour le menu de construction
    this.events.on('toggleBuildMenu', this.toggleBuildMenu, this);

    // Ajouter l'écouteur pour la molette
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number) => {
      if (this.buildMenu?.visible) {
        // Déterminer la direction (haut = -1, bas = 1)
        const direction = deltaY > 0 ? 1 : -1;
        this.cycleBuildingSelection(direction);
      }
    });
  }
  
  update(time: number, delta: number) {
    // Mettre à jour la mini-carte
    this.updateMinimap();
    
    // Mettre à jour l'affichage des FPS
    this.updateFpsCounter();
    
    // Mettre à jour la population
    this.updatePopulationDisplay();
  }
  
  // Affichage des ressources
  private createResourceDisplay() {
    // Créer un fond noir semi-transparent pour les ressources
    const padding = 15;
    const width = 110;  // Augmenté pour éviter le débordement horizontal
    const height = 200; // Augmenté pour plus d'espace
    const x = padding;
    const y = this.cameras.main.height - height - padding;
    
    // Créer le fond
    const background = this.add.graphics();
    background.fillStyle(0x000000, 0.9);  // Noir semi-transparent
    background.fillRect(x, y, width, height);
    background.lineStyle(1, 0x444444);
    background.strokeRect(x, y, width, height);
    
    // Définir les ressources avec leurs émojis
    const resources = [
      { type: ResourceType.GOLD, emoji: '🪙', color: '#FFD700', position: { x: x + width/2, y: y + 25 } },
      { type: ResourceType.WOOD, emoji: '🌲', color: '#8B4513', position: { x: x + width/2, y: y + 50 } },
      { type: ResourceType.STONE, emoji: '🪨', color: '#808080', position: { x: x + width/2, y: y + 75 } },
      { type: ResourceType.IRON, emoji: '⚙️', color: '#A9A9A9', position: { x: x + width/2, y: y + 100 } },
      { type: ResourceType.COAL, emoji: '⚫', color: '#000000', position: { x: x + width/2, y: y + 125 } },
      { type: ResourceType.STEEL, emoji: '🔧', color: '#4682B4', position: { x: x + width/2, y: y + 150 } }
    ];
    
    resources.forEach(resource => {
      const text = this.add.text(
        resource.position.x, 
        resource.position.y, 
        `${resource.emoji}:0`, 
        { 
          fontSize: '16px', // Augmenté pour une meilleure lisibilité
          color: resource.color,
          stroke: '#000',
          strokeThickness: 1,
          shadow: {
            offsetX: 1,
            offsetY: 1,
            color: '#000000',
            blur: 2,
            fill: true
          }
        }
      ).setOrigin(0.5);
      
      this.resourceTexts.set(resource.type, text);
    });
    
    // Ajouter un événement de redimensionnement pour repositionner l'UI
    this.scale.on('resize', () => {
      background.clear();
      const newY = this.cameras.main.height - height - padding;
      background.fillStyle(0x000000, 0.9);
      background.fillRect(x, newY, width, height);
      background.lineStyle(1, 0x444444);
      background.strokeRect(x, newY, width, height);
      
      resources.forEach((resource, index) => {
        const text = this.resourceTexts.get(resource.type);
        if (text) {
          text.setPosition(x + width/2, newY + 25 + (index * 25));
        }
      });
    });
  }
  
  private updateResourceDisplay(resources) {
    Object.entries(resources).forEach(([type, amount]) => {
      const text = this.resourceTexts.get(type);
      if (text) {
        // Récupérer l'emoji depuis le texte existant
        const emoji = text.text.split(':')[0];
        text.setText(`${emoji}:${amount}`);
      }
    });
  }
  
  // Mini-carte
  private createMinimap() {
    const width = 220;
    const height = 220;
    const x = this.cameras.main.width - width - 10;
    const y = this.cameras.main.height - height - 10;
    
    // Créer un conteneur pour la minimap et tous ses éléments
    
    // Couche pour les zones découvertes (mémoire)
    this.minimapDiscoveredAreas = this.add.graphics();
    this.minimapDiscoveredAreas.setScrollFactor(0);
    this.minimapDiscoveredAreas.setDepth(10);
    
    // Fond de la mini-carte
    this.minimap = this.add.graphics();
    this.minimap.fillStyle(0x000000, 0.7);
    this.minimap.fillRect(x, y, width, height);
    this.minimap.lineStyle(1, 0x444444);
    this.minimap.strokeRect(x, y, width, height);
    
    // Ajouter un petit panneau au-dessus avec l'emoji carte et M
    const labelWidth = 50; // Réduit de 220 à 50
    const labelHeight = 30;
    const labelX = x + width - labelWidth; // Aligner à droite
    const labelY = y - labelHeight - 5; // 5px de marge
    
    // Panneau pour le bouton M (Map)
    const mapLabel = this.add.graphics();
    mapLabel.fillStyle(0x000000, 0.7);
    mapLabel.fillRect(labelX, labelY, labelWidth, labelHeight);
    mapLabel.lineStyle(1, 0x444444);
    mapLabel.strokeRect(labelX, labelY, labelWidth, labelHeight);
    
    // Créer un rectangle interactif pour M
    const mapLabelButton = this.add.rectangle(
      labelX + labelWidth/2, 
      labelY + labelHeight/2, 
      labelWidth, 
      labelHeight
    ).setInteractive({ useHandCursor: true })
     .on('pointerdown', () => {
       this.toggleFullMap();
     });
    
    // Pour le debug - rendre visible le rectangle (à supprimer en production)
    mapLabelButton.setFillStyle(0, 0); // Transparent
    
    // Texte pour le panneau M
    const labelText = this.add.text(labelX + labelWidth/2, labelY + labelHeight/2, "🗺️ M", {
      fontSize: '16px',
      color: '#FFFFFF',
      align: 'center'
    }).setOrigin(0.5);
    
    // Panneau pour le bouton B (Build)
    const buildLabelX = labelX - labelWidth - 5; // 5px de marge entre les boutons
    const buildLabel = this.add.graphics();
    buildLabel.fillStyle(0x000000, 0.7);
    buildLabel.fillRect(buildLabelX, labelY, labelWidth, labelHeight);
    buildLabel.lineStyle(1, 0x444444);
    buildLabel.strokeRect(buildLabelX, labelY, labelWidth, labelHeight);
    
    // Créer un rectangle interactif pour B
    const buildLabelButton = this.add.rectangle(
      buildLabelX + labelWidth/2, 
      labelY + labelHeight/2, 
      labelWidth, 
      labelHeight
    ).setInteractive({ useHandCursor: true })
     .on('pointerdown', () => {
       this.toggleBuildMenu();
     });
    
    // Pour le debug - rendre visible le rectangle (à supprimer en production)
    buildLabelButton.setFillStyle(0, 0); // Transparent
    
    // Texte pour le panneau B
    const buildLabelText = this.add.text(buildLabelX + labelWidth/2, labelY + labelHeight/2, "🔨 B", {
      fontSize: '16px',
      color: '#FFFFFF',
      align: 'center'
    }).setOrigin(0.5);

    // Panneau pour le bouton Tab (Combat/Selection)
    const tabLabelX = buildLabelX - labelWidth - 5; // 5px de marge entre les boutons
    const tabLabel = this.add.graphics();
    tabLabel.fillStyle(0x000000, 0.7);
    tabLabel.fillRect(tabLabelX, labelY, labelWidth, labelHeight);
    tabLabel.lineStyle(1, 0x444444);
    tabLabel.strokeRect(tabLabelX, labelY, labelWidth, labelHeight);
    
    // Texte pour le panneau Tab - épées croisées et symbole tab
    const tabLabelText = this.add.text(tabLabelX + labelWidth/2, labelY + labelHeight/2, "⚔️ ↹", {
      fontSize: '16px',
      color: '#FFFFFF',
      align: 'center'
    }).setOrigin(0.5);
    
    // Configurer la mini-carte pour qu'elle reste en bas à droite
    this.minimap.setScrollFactor(0);
    this.minimap.setDepth(11);
    
    // Initialiser une mise à jour immédiate
    this.updateMinimap();
    
    // Ajouter un événement de redimensionnement
    this.scale.on('resize', () => {
      const newX = this.cameras.main.width - width - 10;
      const newY = this.cameras.main.height - height - 10;
      const newLabelX = newX + width - labelWidth;
      const newLabelY = newY - labelHeight - 5;
      const newBuildLabelX = newLabelX - labelWidth - 5;
      const newTabLabelX = newBuildLabelX - labelWidth - 5;
      
      // Mettre à jour le fond de la minimap
      this.minimap.clear();
      this.minimap.fillStyle(0x000000, 0.7);
      this.minimap.fillRect(newX, newY, width, height);
      this.minimap.lineStyle(1, 0x444444);
      this.minimap.strokeRect(newX, newY, width, height);
      
      // Mettre à jour le panneau indicateur M
      mapLabel.clear();
      mapLabel.fillStyle(0x000000, 0.7);
      mapLabel.fillRect(newLabelX, newLabelY, labelWidth, labelHeight);
      mapLabel.lineStyle(1, 0x444444);
      mapLabel.strokeRect(newLabelX, newLabelY, labelWidth, labelHeight);
      
      // Mettre à jour la position du bouton M et du texte
      mapLabelButton.setPosition(newLabelX + labelWidth/2, newLabelY + labelHeight/2);
      labelText.setPosition(newLabelX + labelWidth/2, newLabelY + labelHeight/2);
      
      // Mettre à jour le panneau indicateur B
      buildLabel.clear();
      buildLabel.fillStyle(0x000000, 0.7);
      buildLabel.fillRect(newBuildLabelX, newLabelY, labelWidth, labelHeight);
      buildLabel.lineStyle(1, 0x444444);
      buildLabel.strokeRect(newBuildLabelX, newLabelY, labelWidth, labelHeight);
      
      // Mettre à jour la position du bouton B et du texte
      buildLabelButton.setPosition(newBuildLabelX + labelWidth/2, newLabelY + labelHeight/2);
      buildLabelText.setPosition(newBuildLabelX + labelWidth/2, newLabelY + labelHeight/2);
      
      // Mettre à jour le panneau indicateur Tab
      tabLabel.clear();
      tabLabel.fillStyle(0x000000, 0.7);
      tabLabel.fillRect(newTabLabelX, newLabelY, labelWidth, labelHeight);
      tabLabel.lineStyle(1, 0x444444);
      tabLabel.strokeRect(newTabLabelX, newLabelY, labelWidth, labelHeight);
      
      // Mettre à jour la position du texte Tab
      tabLabelText.setPosition(newTabLabelX + labelWidth/2, newLabelY + labelHeight/2);
      
      this.updateMinimap();
    });
  }
  
  // Ajoutons une fonction de conversion de teinte en couleur RGB
  private hueToRgb(hue: number): number {
    // Conversion HSV -> RGB simplifiée (saturation et valeur à 100%)
    const h = hue % 360;
    const s = 1.0;
    const v = 1.0;
    
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    
    const rr = Math.round((r + m) * 255);
    const gg = Math.round((g + m) * 255);
    const bb = Math.round((b + m) * 255);
    
    return (rr << 16) + (gg << 8) + bb;
  }

  // Modifier la fonction updateMinimap pour afficher le joueur avec sa propre couleur 
  // et les autres joueurs avec leur couleur respective
  private updateMinimap() {
    if (!this.gameScene || !this.minimap) return;
    
    // Trouver les références aux éléments du jeu
    const gameInstance = this.gameScene as any;
    if (!gameInstance.player || !gameInstance.resourceSprites) return;
    
    // Récupérer les dimensions de la mini-carte
    const width = 220;
    const height = 220;
    const x = this.cameras.main.width - width - 10;
    const y = this.cameras.main.height - height - 10;
    
    // Calculer la taille réelle de la carte
    const mapWidth = gameInstance.mapLines[0]?.length * TILE_SIZE || 3200;
    const mapHeight = gameInstance.mapLines.length * TILE_SIZE || 3200;
    
    // Position du joueur en tuiles
    const playerTileX = Math.floor(gameInstance.playerEntity.x / TILE_SIZE);
    const playerTileY = Math.floor(gameInstance.playerEntity.y / TILE_SIZE);
    
    // Calculer l'échelle en fonction de la taille visible
    const visibleWidth = this.minimapRadius * 2 * TILE_SIZE;
    const visibleHeight = this.minimapRadius * 2 * TILE_SIZE;
    
    const scaleX = width / visibleWidth;
    const scaleY = height / visibleHeight;
    const mapScale = Math.min(scaleX, scaleY);

    // Calculer les limites de la zone visible
    let minVisibleX = playerTileX - this.minimapRadius;
    let maxVisibleX = playerTileX + this.minimapRadius;
    let minVisibleY = playerTileY - this.minimapRadius;
    let maxVisibleY = playerTileY + this.minimapRadius;

    // Ajuster les limites pour ne pas dépasser les bords de la carte
    if (minVisibleX < 0) {
      maxVisibleX -= minVisibleX; // Décaler la zone visible vers la droite
      minVisibleX = 0;
    }
    if (maxVisibleX > mapWidth / TILE_SIZE) {
      minVisibleX -= (maxVisibleX - mapWidth / TILE_SIZE); // Décaler la zone visible vers la gauche
      maxVisibleX = mapWidth / TILE_SIZE;
    }
    if (minVisibleY < 0) {
      maxVisibleY -= minVisibleY; // Décaler la zone visible vers le bas
      minVisibleY = 0;
    }
    if (maxVisibleY > mapHeight / TILE_SIZE) {
      minVisibleY -= (maxVisibleY - mapHeight / TILE_SIZE); // Décaler la zone visible vers le haut
      maxVisibleY = mapHeight / TILE_SIZE;
    }

    // Calculer les offsets pour la position correcte sur la minimap
    const offsetX = x;
    const offsetY = y;
    
    // Effacer la mini-carte précédente
    this.minimap.clear();
    this.minimapDiscoveredAreas.clear();
    
    // Recréer le fond
    this.minimap.fillStyle(0x000000, 0.9);
    this.minimap.fillRect(x, y, width, height);
    this.minimap.lineStyle(1, 0x444444);
    this.minimap.strokeRect(x, y, width, height);
    
    // Dessiner les zones découvertes
    if (gameInstance.loadedTiles.size > 0) {
      this.minimap.fillStyle(0x444444, 0.3);
      gameInstance.loadedTiles.forEach(tileKey => {
        const [tileX, tileY] = tileKey.split(',').map(Number);
        
        if (tileX >= minVisibleX && tileX <= maxVisibleX && 
            tileY >= minVisibleY && tileY <= maxVisibleY) {
          
          const miniX = offsetX + ((tileX - minVisibleX) / (maxVisibleX - minVisibleX)) * width;
          const miniY = offsetY + ((tileY - minVisibleY) / (maxVisibleY - minVisibleY)) * height;
          
          this.minimap.fillRect(
            miniX,
            miniY,
            width / (maxVisibleX - minVisibleX),
            height / (maxVisibleY - minVisibleY)
          );
        }
      });
    }

    // Dessiner les ressources
    if (gameInstance.resourceSprites.size > 0) {
      gameInstance.resourceSprites.forEach((sprite, key) => {
        const tileX = Math.floor(sprite.x / TILE_SIZE);
        const tileY = Math.floor(sprite.y / TILE_SIZE);
        const tileKey = `${tileX},${tileY}`;
        
        if (gameInstance.loadedTiles.has(tileKey)) {
          let color;
          let type = '';
          
          if (key.includes('gold')) {
            color = 0xFFD700;
            type = 'gold';
          } else if (key.includes('wood')) {
            color = 0x8B4513;
            type = 'wood';
          } else if (key.includes('stone')) {
            color = 0x808080;
            type = 'stone';
          } else if (key.includes('iron')) {
            color = 0xA9A9A9;
            type = 'iron';
          } else if (key.includes('coal')) {
            color = 0x000000;
            type = 'coal';
          } else {
            color = 0xFFFFFF;
            type = 'other';
          }
          
          this.minimapMemory.set(tileKey, { color, type });
        }
        
        if (tileX >= minVisibleX && tileX <= maxVisibleX && 
            tileY >= minVisibleY && tileY <= maxVisibleY) {
          
          const miniX = offsetX + ((tileX - minVisibleX) / (maxVisibleX - minVisibleX)) * width;
          const miniY = offsetY + ((tileY - minVisibleY) / (maxVisibleY - minVisibleY)) * height;
          
          const memoryData = this.minimapMemory.get(tileKey);
          if (memoryData) {
            this.minimap.fillStyle(memoryData.color, 1);
            this.minimap.fillRect(miniX - 1, miniY - 1, 3, 3);
          }
        }
      });
    }

    // Obtenir la couleur du joueur
    const playerHue = gameInstance.playerEntity?.hue || 0;
    const playerColor = this.hueToRgb(playerHue);
    
    // Dessiner le joueur à sa position relative dans la zone visible
    const playerMinimapX = offsetX + ((playerTileX - minVisibleX) / (maxVisibleX - minVisibleX)) * width;
    const playerMinimapY = offsetY + ((playerTileY - minVisibleY) / (maxVisibleY - minVisibleY)) * height;
    
    this.minimap.fillStyle(playerColor, 1);
    this.minimap.fillCircle(playerMinimapX, playerMinimapY, 3);
    
    // Dessiner les autres joueurs
    if (gameInstance.room && gameInstance.room.state && gameInstance.room.state.players) {
      const players = gameInstance.room.state.players;
      players.forEach((otherPlayer, sessionId) => {
        if (sessionId === gameInstance.room.sessionId) return;
        
        const otherTileX = Math.floor(otherPlayer.x / TILE_SIZE);
        const otherTileY = Math.floor(otherPlayer.y / TILE_SIZE);
        
        if (otherTileX >= minVisibleX && otherTileX <= maxVisibleX && 
            otherTileY >= minVisibleY && otherTileY <= maxVisibleY) {
          
          const otherX = offsetX + ((otherTileX - minVisibleX) / (maxVisibleX - minVisibleX)) * width;
          const otherY = offsetY + ((otherTileY - minVisibleY) / (maxVisibleY - minVisibleY)) * height;
          
          const otherColor = this.hueToRgb(otherPlayer.hue || 0);
          this.minimap.fillStyle(otherColor, 1);
          this.minimap.fillCircle(otherX, otherY, 3);
        }
      });
    }
    
    // Si la carte complète est visible, la mettre à jour aussi
    if (this.fullMapVisible) {
      this.updateFullMap();
    }
  }
  
  // Carte complète
  private createFullMap() {
    // Rendre la carte carrée en prenant la plus petite dimension comme référence
    const mapSize = Math.min(this.cameras.main.width, this.cameras.main.height) * 0.9; // Agrandir à 90% de l'écran
    this.fullMapWidth = mapSize;
    this.fullMapHeight = mapSize;
    
    const x = (this.cameras.main.width - this.fullMapWidth) / 2;
    const y = (this.cameras.main.height - this.fullMapHeight) / 2;
    
    // Créer un conteneur pour la carte complète
    this.fullMap = this.add.container(x, y);
    this.fullMap.setDepth(100);
    
    // Fond de la carte
    this.fullMapBackground = this.add.graphics();
    this.fullMapBackground.fillStyle(0x000000, 0.85); // Fond noir semi-transparent
    this.fullMapBackground.fillRect(0, 0, this.fullMapWidth, this.fullMapHeight);
    this.fullMapBackground.lineStyle(1, 0x333333); // Bordure subtile
    this.fullMapBackground.strokeRect(0, 0, this.fullMapWidth, this.fullMapHeight);
    
    // Contenu de la carte
    this.fullMapContent = this.add.graphics();
    
    // Ajouter au conteneur
    this.fullMap.add([this.fullMapBackground, this.fullMapContent]);
    
    // Cacher la carte par défaut
    this.fullMap.setVisible(false);
    
    // Ajouter un gestionnaire de clic global pour fermer la carte
    this.input.on('pointerdown', this.handleMapClick, this);
  }
  
  private updateFullMap() {
    if (!this.gameScene || !this.fullMapContent || !this.fullMapVisible) return;
    
    const gameInstance = this.gameScene as any;
    if (!gameInstance.player) return;
    
    // Utiliser les dimensions stockées
    const containerWidth = this.fullMapWidth;
    const containerHeight = this.fullMapHeight;
    
    // Calculer la taille réelle de la carte
    const mapWidth = gameInstance.mapLines[0]?.length * TILE_SIZE || 3200;
    const mapHeight = gameInstance.mapLines.length * TILE_SIZE || 3200;
    
    // Calculer l'échelle pour voir toute la carte
    const scaleX = containerWidth / mapWidth;
    const scaleY = containerHeight / mapHeight;
    const mapScale = Math.min(scaleX, scaleY) * 0.95; // 95% pour une petite marge
    
    // Calculer les offsets pour centrer la carte
    const offsetX = (containerWidth - mapWidth * mapScale) / 2;
    const offsetY = (containerHeight - mapHeight * mapScale) / 2;
    
    // Effacer le contenu précédent
    this.fullMapContent.clear();
    
    // Fond plus opaque
    this.fullMapBackground.clear();
    this.fullMapBackground.fillStyle(0x000000, 0.92); // Augmenté de 0.85 à 0.92
    this.fullMapBackground.fillRect(0, 0, this.fullMapWidth, this.fullMapHeight);
    this.fullMapBackground.lineStyle(1, 0x555555); // Bordure plus visible
    this.fullMapBackground.strokeRect(0, 0, this.fullMapWidth, this.fullMapHeight);
    
    // Dessiner le cadre de la carte
    this.fullMapContent.lineStyle(1, 0x666666);
    this.fullMapContent.strokeRect(
      offsetX,
      offsetY,
      mapWidth * mapScale,
      mapHeight * mapScale
    );
    
    // Dessiner les zones explorées avec plus d'opacité
    if (gameInstance.loadedTiles.size > 0) {
      this.fullMapContent.fillStyle(0x444444, 0.4); // Augmenté de 0.3 à 0.4
      gameInstance.loadedTiles.forEach(tileKey => {
        const [tileX, tileY] = tileKey.split(',').map(Number);
        
        const mapX = offsetX + tileX * TILE_SIZE * mapScale;
        const mapY = offsetY + tileY * TILE_SIZE * mapScale;
        
        this.fullMapContent.fillRect(
          mapX,
          mapY,
          TILE_SIZE * mapScale,
          TILE_SIZE * mapScale
        );
      });
    }
    
    // Dessiner toutes les ressources découvertes avec plus d'opacité et taille
    this.minimapMemory.forEach((data, tileKey) => {
      const [tileX, tileY] = tileKey.split(',').map(Number);
      
      const mapX = offsetX + tileX * TILE_SIZE * mapScale;
      const mapY = offsetY + tileY * TILE_SIZE * mapScale;
      
      // Couleur plus saturée et opaque
      let color = data.color;
      // Augmenter la luminosité des couleurs pour plus de visibilité
      if (data.type === 'gold') color = 0xFFE566; // Or plus vif
      else if (data.type === 'wood') color = 0xA86032; // Bois plus vif
      else if (data.type === 'stone') color = 0xBBBBBB; // Pierre plus claire
      else if (data.type === 'iron') color = 0xCCCCDD; // Fer plus visible
      else if (data.type === 'coal') color = 0x222222; // Charbon plus contrasté
      
      this.fullMapContent.fillStyle(color, 1.0);
      // Augmenter légèrement la taille
      const pointSize = Math.max(0.5, TILE_SIZE * mapScale * 0.6); // 60% au lieu de 40%
      this.fullMapContent.fillRect(
        mapX - pointSize/4, // Centrer un peu mieux
        mapY - pointSize/4, // Centrer un peu mieux
        pointSize,
        pointSize
      );
    });
    
    // Obtenir la couleur du joueur (hue)
    const playerHue = gameInstance.playerEntity?.hue || 0;
    const playerColor = this.hueToRgb(playerHue);
    
    // Dessiner la position du joueur (en plus petit)
    const playerTileX = Math.floor(gameInstance.playerEntity.x / TILE_SIZE);
    const playerTileY = Math.floor(gameInstance.playerEntity.y / TILE_SIZE);
    
    const playerX = offsetX + playerTileX * TILE_SIZE * mapScale;
    const playerY = offsetY + playerTileY * TILE_SIZE * mapScale;
    
    this.fullMapContent.fillStyle(playerColor, 1);
    this.fullMapContent.fillCircle(playerX, playerY, 3); // Réduit de 5 à 3
    
    // Les autres joueurs ne sont pas affichés sur la grande carte
  }
  
  private toggleFullMap() {
    this.fullMapVisible = !this.fullMapVisible;
    this.fullMap.setVisible(this.fullMapVisible);
    
    if (this.fullMapVisible) {
      this.updateFullMap();
    }
  }
  
  private handleMapClick(pointer: Phaser.Input.Pointer) {
    // Si la carte est visible
    if (this.fullMapVisible) {
      // Calculer si le clic est dans la carte
      const containerX = this.fullMap.x;
      const containerY = this.fullMap.y;
      
      const containerBounds = new Phaser.Geom.Rectangle(
        containerX,
        containerY,
        this.fullMapWidth,
        this.fullMapHeight
      );
      
      // Si le clic est en dehors du conteneur, fermer la carte
      if (!containerBounds.contains(pointer.x, pointer.y)) {
        this.toggleFullMap();
      }
    }
  }
  
  // Affichage du compteur de FPS
  private createFpsCounter() {
    this.fpsText = this.add.text(10, 10, 'FPS: 0', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#00000080',
      padding: { x: 5, y: 2 }
    });
    this.fpsText.setScrollFactor(0);
    this.fpsText.setDepth(100);
  }
  
  private updateFpsCounter() {
    const fps = Math.round(this.game.loop.actualFps);
    this.fpsText.setText(`FPS: ${fps}`);
    
    // Colorer le texte en fonction de la performance
    if (fps >= 55) {
      this.fpsText.setColor('#00ff00'); // Vert si bon framerate
    } else if (fps >= 40) {
      this.fpsText.setColor('#ffff00'); // Jaune si framerate moyen
    } else {
      this.fpsText.setColor('#ff0000'); // Rouge si framerate bas
    }
  }
  
  // Menu de construction
  private createBuildMenu() {
    // Nettoyer l'ancien menu s'il existe
    if (this.buildMenu) {
      this.buildMenu.destroy();
    }

    const padding = 15;
    const itemSize = 96; // Taille de chaque case
    const itemsPerRow = 10; // Tous les bâtiments sur une ligne (maintenant 10 avec le mur)
    const spacing = 10;
    
    const totalWidth = (itemSize + spacing) * itemsPerRow - spacing;
    const height = itemSize + padding * 2;
    
    // Positionner en bas au centre
    const x = (this.cameras.main.width - totalWidth) / 2;
    const y = this.cameras.main.height - height - padding;
    
    // Créer le nouveau conteneur
    this.buildMenu = this.add.container(x, y);
    this.buildMenu.setDepth(UIScene.DEPTHS.BUILD_MENU);
    
    // Liste des bâtiments avec leurs infos (nouvel ordre)
    const buildings = [
      { type: BuildingType.HOUSE, name: 'House', sprite: 'house', cost: { wood: 10, stone: 10 } },
      { type: BuildingType.FORGE, name: 'Forge', sprite: 'forge', cost: { wood: 20, stone: 20 } },
      { type: BuildingType.BARRACKS, name: 'Barracks', sprite: 'barracks', cost: { wood: 10, iron: 10 } },
      { type: BuildingType.FURNACE, name: 'Furnace', sprite: 'furnace', cost: { stone: 30 } },
      { type: BuildingType.FACTORY, name: 'Factory', sprite: 'factory', cost: { iron: 20, stone: 20 } },
      { type: BuildingType.PLAYER_WALL, name: 'Wall', sprite: 'playerwall', cost: { stone: 10 } },
      { type: BuildingType.TOWER, name: 'Tower', sprite: 'tower', cost: { wood: 50, iron: 5 } },
      { type: BuildingType.TOWN_CENTER, name: 'Town Center', sprite: 'tc', cost: { stone: 30, wood: 30, gold: 30 } },
      { type: BuildingType.YARD, name: 'Quarry', sprite: 'quarry', cost: { iron: 20 } },
      { type: BuildingType.CABIN, name: 'Hut', sprite: 'hut', cost: { steel: 20 } }
    ];
    
    buildings.forEach((building, index) => {
      const itemX = (itemSize + spacing) * index;
      
      // Fond de la case
      const itemBackground = this.add.graphics();
      itemBackground.fillStyle(0x333333, 1);
      itemBackground.fillRect(itemX, padding, itemSize, itemSize);
      itemBackground.lineStyle(1, 0x666666);
      itemBackground.strokeRect(itemX, padding, itemSize, itemSize);
      
      // Zone interactive
      const hitArea = new Phaser.Geom.Rectangle(itemX, padding, itemSize, itemSize);
      const hitAreaGraphics = this.add.graphics();
      hitAreaGraphics.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains)
        .on('pointerover', () => {
          itemBackground.clear();
          itemBackground.fillStyle(0x444444, 1);
          itemBackground.fillRect(itemX, padding, itemSize, itemSize);
          itemBackground.lineStyle(1, 0x666666);
          itemBackground.strokeRect(itemX, padding, itemSize, itemSize);
        })
        .on('pointerout', () => {
          itemBackground.clear();
          itemBackground.fillStyle(0x333333, 1);
          itemBackground.fillRect(itemX, padding, itemSize, itemSize);
          itemBackground.lineStyle(1, 0x666666);
          itemBackground.strokeRect(itemX, padding, itemSize, itemSize);
        })
        .on('pointerdown', () => {
          if (this.buildMenu) {
            this.selectedBuildingIndex = index;
            this.selectBuilding(building.type);
            this.updateSelectionOverlay();
          }
        });
      
      // Sprite du bâtiment
      const sprite = this.add.sprite(itemX + itemSize/2, padding + itemSize/2 - 10, building.sprite);
      sprite.setScale(1.5);
      
      // Nom du bâtiment
      const name = this.add.text(itemX + itemSize/2, padding + itemSize - 25, building.name, {
        fontSize: '12px',
        color: '#ffffff'
      }).setOrigin(0.5);
      
      // Coût avec emojis
      const costText = Object.entries(building.cost)
        .map(([resource, amount]) => {
          const emoji = resource === 'gold' ? '🪙' :
                       resource === 'wood' ? '🌲' :
                       resource === 'stone' ? '🪨' :
                       resource === 'iron' ? '⚙️' :
                       resource === 'coal' ? '⚫' :
                       resource === 'steel' ? '🔧' : '❓';
          return `${emoji}${amount}`;
        })
        .join(' ');
      
      const cost = this.add.text(itemX + itemSize/2, padding + itemSize - 10, costText, {
        fontSize: '10px',
        color: '#aaaaaa'
      }).setOrigin(0.5);
      
      // Ajouter tous les éléments au conteneur
      if (this.buildMenu) {
        this.buildMenu.add([itemBackground, hitAreaGraphics, sprite, name, cost]);
      }
    });
    
    // Cacher le menu par défaut
    this.buildMenu.setVisible(false);

    // Ajouter un gestionnaire de redimensionnement
    this.scale.on('resize', this.onResize, this);
  }

  private onResize() {
    if (this.buildMenu) {
      const padding = 15;
      const itemSize = 96;
      const itemsPerRow = 10;
      const spacing = 10;
      const totalWidth = (itemSize + spacing) * itemsPerRow - spacing;
      const height = itemSize + padding * 2;
      
      const x = (this.cameras.main.width - totalWidth) / 2;
      const y = this.cameras.main.height - height - padding;
      
      this.buildMenu.setPosition(x, y);
    }
  }

  private toggleBuildMenu() {
    if (this.buildMenu) {
      const newVisible = !this.buildMenu.visible;
      this.buildMenu.setVisible(newVisible);
      
      // Réinitialiser la sélection quand on ferme le menu
      if (!newVisible) {
        this.selectedBuildingIndex = -1;
        this.selectedOverlay?.destroy();
        
        // Notifier la GameScene pour arrêter le mode de placement du bâtiment
        if (this.gameScene) {
          this.gameScene.events.emit('stopPlacingBuilding');
        }
      }
    }
  }

  private selectBuilding(buildingType: string) {
    // Ne plus cacher le menu
    // Informer la scène principale avec le type de bâtiment directement au lieu du nom du sprite
    this.gameScene.events.emit('buildingSelected', buildingType);
  }

  private cycleBuildingSelection(direction: number) {
    const buildings = [
      BuildingType.HOUSE,
      BuildingType.FORGE,
      BuildingType.BARRACKS,
      BuildingType.FURNACE,
      BuildingType.FACTORY,
      BuildingType.PLAYER_WALL,
      BuildingType.TOWER,
      BuildingType.TOWN_CENTER,
      BuildingType.YARD,
      BuildingType.CABIN
    ];

    // Mettre à jour l'index
    if (this.selectedBuildingIndex === -1) {
      this.selectedBuildingIndex = direction > 0 ? 0 : buildings.length - 1;
    } else {
      this.selectedBuildingIndex = (this.selectedBuildingIndex + direction + buildings.length) % buildings.length;
    }

    // Sélectionner le nouveau bâtiment
    this.selectBuilding(buildings[this.selectedBuildingIndex]);
    this.updateSelectionOverlay();
  }

  private updateSelectionOverlay() {
    const padding = 15;
    const itemSize = 96;
    const spacing = 10;
    const itemX = (itemSize + spacing) * this.selectedBuildingIndex;

    // Supprimer l'ancien overlay s'il existe
    this.selectedOverlay?.destroy();

    // Créer le nouvel overlay
    this.selectedOverlay = this.add.graphics();
    this.selectedOverlay.lineStyle(3, 0xffff00);
    this.selectedOverlay.strokeRect(itemX, padding, itemSize, itemSize);

    // Ajouter l'overlay au conteneur du menu
    if (this.buildMenu) {
      this.buildMenu.add(this.selectedOverlay);
    }
  }

  private cleanupAllUI() {
    // Détruire tous les conteneurs existants
    this.children.list.forEach(child => {
      if (child instanceof Phaser.GameObjects.Container) {
        child.destroy(true);
      }
    });

    // Détruire tous les graphics existants
    this.children.list.forEach(child => {
      if (child instanceof Phaser.GameObjects.Graphics) {
        child.destroy();
      }
    });

    // Réinitialiser les références
    this.buildMenu = undefined;
    this.minimap?.destroy();
    this.minimapDiscoveredAreas?.destroy();
    this.fullMap?.destroy();
    this.fullMapBackground?.destroy();
    this.fullMapContent?.destroy();
    this.resourceTexts.clear();
  }

  // Méthode pour créer l'indicateur de population
  private createPopulationDisplay() {
    const x = this.cameras.main.width - 100;
    const y = 10;
    
    this.populationText = this.add.text(x, y, '👨‍👨‍👧‍👦 1/1', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#00000080',
      padding: { x: 5, y: 2 }
    });
    this.populationText.setScrollFactor(0);
    this.populationText.setDepth(100);
    
    // Ajouter un événement de redimensionnement
    this.scale.on('resize', () => {
      const newX = this.cameras.main.width - 100;
      this.populationText.setPosition(newX, y);
    });
  }
  
  // Méthode pour mettre à jour l'indicateur de population
  private updatePopulationDisplay() {
    if (!this.gameScene) return;
    
    const gameInstance = this.gameScene as any;
    if (!gameInstance.playerEntity) return;
    
    const population = gameInstance.playerEntity.population || 1;
    const maxPopulation = gameInstance.playerEntity.maxPopulation || 1;
    
    this.populationText.setText(`👨‍👨‍👧‍👦 ${population}/${maxPopulation}`);
    
    // Colorer le texte en fonction de l'occupation
    if (population < maxPopulation * 0.7) {
      this.populationText.setColor('#00ff00'); // Vert si peu peuplé
    } else if (population < maxPopulation) {
      this.populationText.setColor('#ffff00'); // Jaune si moyennement peuplé
    } else {
      this.populationText.setColor('#ff0000'); // Rouge si complètement peuplé
    }
  }
} 