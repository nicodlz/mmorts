import Phaser from 'phaser';
import { Client } from 'colyseus.js';
import { 
  PlayerSchema, 
  UnitSchema, 
  BuildingSchema, 
  ResourceSchema,
  TILE_SIZE,
  CHUNK_SIZE,
  ResourceType,
  BUILDING_COSTS,
  BuildingType
} from 'shared';

export class GameScene extends Phaser.Scene {
  // Client Colyseus
  private client: Client;
  private room: any; // Type à définir plus précisément plus tard
  
  // Éléments de jeu
  private player?: Phaser.GameObjects.Container;
  private tool?: Phaser.GameObjects.Sprite;
  private playerEntity: PlayerSchema;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private tabKey?: Phaser.Input.Keyboard.Key;
  private bKey: Phaser.Input.Keyboard.Key;
  private playerSpeed: number = 3; // Vitesse réduite pour des mouvements plus fins
  
  // Groupes d'objets
  private resourceSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private visibleResources: Set<string> = new Set(); // Ressources actuellement visibles
  private unitSprites: Map<string, { 
    sprite: Phaser.GameObjects.Container; 
    targetX: number; 
    targetY: number;
    nameText?: Phaser.GameObjects.Text;
    walkingPhase?: number;
  }> = new Map();
  private buildingSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  
  // Stockage de la carte pour le chargement dynamique
  private mapData: string = '';
  private mapLines: string[] = [];
  private tileSize: number = TILE_SIZE;
  private loadedTiles: Set<string> = new Set(); // Garder trace des tuiles déjà chargées
  private renderDistance: number = 3; // Distance en chunks (augmentée de 2 à 3)
  private loadedChunks: Set<string> = new Set(); // Garder trace des chunks chargés
  
  // Mode de jeu
  private isToolMode: boolean = true;
  
  // Paramètres d'interpolation
  private readonly LERP_FACTOR: number = 0.08;
  private readonly NETWORK_UPDATE_RATE: number = 100;
  private lastNetworkUpdate: number = 0;
  
  // Dernière position chargée pour éviter le rechargement constant
  private lastLoadedChunkX: number = -1;
  private lastLoadedChunkY: number = -1;
  private readonly CHUNK_SIZE: number = CHUNK_SIZE; // Utiliser la constante partagée
  
  // Ajouter ces propriétés privées dans la classe
  private tileLayers: Map<string, Phaser.GameObjects.Image> = new Map();
  private tilePool: Phaser.GameObjects.Image[] = [];
  private maxTilePoolSize: number = 500;
  private lastCleanupTime: number = 0;
  private cleanupInterval: number = 5000;
  
  // Propriétés supplémentaires
  private lastPlayerX: number = 0;
  private lastPlayerY: number = 0;
  private positionThreshold: number = 0.5; // Seuil pour détecter un changement significatif de position
  
  // Ajout de propriétés pour la gestion de subpixels
  private subPixelFactor: number = 4; // Facteur de subdivision des pixels
  private actualX: number = 0; // Position réelle en x (précision subpixel)
  private actualY: number = 0; // Position réelle en y (précision subpixel)
  
  // Ajout de la propriété pour suivre la dernière mise à jour des ressources
  private lastResourcesUpdate: number = 0;
  
  private resourcesUI: {
    container: Phaser.GameObjects.Container | null;
    texts: Map<string, Phaser.GameObjects.Text>;
  } = { container: null, texts: new Map() }; // Initialisation avec des valeurs par défaut
  
  // Propriétés pour la gestion de la collecte
  private isHarvesting: boolean = false;
  private harvestTarget: { id: string, type: string } | null = null;
  private isMiningActive: boolean = false; // Indique si le joueur est en train de miner
  private numericEffects: Phaser.GameObjects.Group | null = null; // Groupe pour les effets numériques
  private miningConfig = {
    cooldown: 500, // Temps en ms entre chaque collecte
    animationPhases: 3, // Nombre de phases de l'animation
    phaseSpeed: 150, // Durée de chaque phase en ms
    lastCollectTime: 0, // Dernier temps de collecte
    resourceAmounts: { // Quantité de ressources par type
      'gold': 100,
      'wood': 20,
      'stone': 50
    }
  };
  
  // Propriétés pour la construction
  private buildingPreview: Phaser.GameObjects.Sprite | null = null;
  private isPlacingBuilding: boolean = false;
  private selectedBuildingType: string | null = null;
  private canPlaceBuilding: boolean = true;
  
  // Paramètres d'optimisation du rendu
  private lastRenderOptimization: number = 0;
  private readonly RENDER_OPTIMIZATION_INTERVAL: number = 500; // ms entre les optimisations
  private visibleScreenRect: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  
  // Ajouter cette propriété pour suivre si la position initiale a été définie
  private initialPositionSet: boolean = false;
  
  // Mapping des types de bâtiments vers les noms de sprites
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
  
  // Initialiser les variables pour la sélection de bâtiment
  private selectedBuilding: string | null = null;
  private destroyButton: Phaser.GameObjects.Text | null = null;
  
  // Variable pour suivre si un objet du jeu a été cliqué
  private clickedOnGameObject: boolean = false;
  
  private lastProductionBarsUpdate: number = 0;
  
  private lastUnitSyncCheck = 0;
  
  private lastCursorUpdate: number = 0;
  private lastCursorMode: boolean = true;
  
  // Variables pour le clic prolongé des soldats
  private isLongPressing: boolean = false;
  private longPressTimer: number = 0;
  private longPressTarget: { x: number, y: number } | null = null;
  private readonly LONG_PRESS_THRESHOLD: number = 200; // Millisecondes avant qu'un clic soit considéré comme prolongé
  
  // Nouveaux éléments pour le système de combat
  private healthBar?: Phaser.GameObjects.Graphics;
  private unitHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private deathScreen?: Phaser.GameObjects.Container;
  private respawnCountdown?: Phaser.GameObjects.Text;
  private damageTint?: Phaser.GameObjects.Rectangle;
  private isPlayerDead: boolean = false;
  
  // Ajouter cette propriété à la classe
  private respawnIntervalId?: number;
  
  constructor() {
    super({ key: 'GameScene' });
    // @ts-ignore - Ignorer l'erreur de TypeScript pour import.meta.env
    const serverUrl = import.meta.env?.VITE_COLYSEUS_URL || "ws://localhost:2567";
    console.log("Tentative de connexion au serveur:", serverUrl);
    this.client = new Client(serverUrl);
  }
  
  preload() {
    // Log le début du chargement
    console.log("Début du chargement des assets");
    
    // Désactiver l'interpolation sur toutes les textures
    this.textures.on('addtexture', (key: string) => {
      console.log(`Configurant texture ${key} en mode NEAREST`);
      this.textures.list[key].setFilter(Phaser.Textures.NEAREST);
    });
    
    // Gérer les erreurs de chargement
    this.load.on('loaderror', (file: any) => {
      console.error(`Erreur de chargement: ${file.key} (${file.src})`);
    });
    
    // Créer un groupe de cache pour réduire le scintillement
    this.textures.addBase64('__WHITE', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==');
    
    // Charger les sprites nécessaires
    this.load.image('player', 'sprites/player.png');
    this.load.image('pickaxe', 'sprites/pickaxe.png');
    this.load.image('gold', 'sprites/gold.png');
    this.load.image('wood', 'sprites/tree2.png');
    this.load.image('stone', 'sprites/stone2.png');
    
    // Charger les sprites des bâtiments
    this.load.image('forge', 'sprites/forge.png');
    this.load.image('house', 'sprites/house.png');
    this.load.image('furnace', 'sprites/furnace.png');
    this.load.image('factory', 'sprites/factory.png');
    this.load.image('tower', 'sprites/tower.png');
    this.load.image('barracks', 'sprites/barracks.png');
    this.load.image('town_center', 'sprites/tc.png');
    this.load.image('yard', 'sprites/quarry.png');
    this.load.image('cabin', 'sprites/hut.png');
    this.load.image('player_wall', 'sprites/playerWall.png');
    
    // Charger les tuiles de terrain
    this.load.image('grass', 'sprites/grass.png');
    this.load.image('grass2', 'sprites/grass2.png');
    this.load.image('grass3', 'sprites/grass3.png');
    this.load.image('wall', 'sprites/wall.png');
    
    // Charger la carte
    this.load.text('map', 'default.map');
    
    console.log("Fin de la configuration du chargement");
  }
  
  init() {
    // Définir les propriétés pour un rendu optimal de texte
    
    // Configurer le mode de rendu pour le pixel art
    // La méthode setTexturePriority n'existe pas dans Phaser
    // Utilisons plutôt la configuration globale des textures
    this.textures.on('addtexture', (key: string) => {
      this.textures.list[key].setFilter(Phaser.Textures.NEAREST);
      console.log(`Mode NEAREST appliqué à la texture: ${key}`);
    });
    
    // Vérifier que le clavier est disponible
    if (!this.input.keyboard) {
      console.error("Clavier non disponible");
      return;
    }
    
    // Initialiser les contrôles
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    };
    
    // Tab pour changer de mode
    this.tabKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.tabKey.on('down', () => {
      this.isToolMode = !this.isToolMode;
      this.updateCursor();
      
      // Arrêter le minage si on change de mode
      if (!this.isToolMode) {
        this.handlePointerUp();
      }
    });
    
    // B pour ouvrir le menu de construction
    this.bKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.bKey.on('down', () => {
      // Émettre l'événement sur la UIScene
      const uiScene = this.scene.get('UIScene');
      uiScene.events.emit('toggleBuildMenu');
    });
    
    // Variable pour suivre si un objet du jeu a été cliqué
    this.clickedOnGameObject = false;
    
    // Déselectionner le bâtiment quand on clique ailleurs
    this.input.on('pointerdown', (pointer) => {
      if (this.selectedBuilding && !this.clickedOnGameObject) {
        this.selectBuilding(null);
      }
      
      // Réinitialiser le flag pour le prochain clic
      this.clickedOnGameObject = false;
    });
    
    // Suivre les clics sur les objets de jeu pour éviter de déselectionner
    this.input.on('gameobjectdown', () => {
      this.clickedOnGameObject = true;
    });
    
    // Ajouter les événements de souris pour la collecte
    this.input.on('pointerdown', (pointer) => {
      // Ne traiter que si on n'a pas cliqué sur un objet du jeu
      if (!this.clickedOnGameObject) {
        this.handlePointerDown(pointer);
      }
      // Réinitialiser pour le prochain clic
      this.clickedOnGameObject = false;
    }, this);
    
    this.input.on('pointerup', this.handlePointerUp, this);
  }
  
  async create() {
    // Récupérer les infos du joueur
    const playerHue = Number(localStorage.getItem('playerHue')) || 0;
    const playerName = localStorage.getItem('playerName') || 'Player';
    
    console.log('=== Création du joueur ===');
    console.log(`Valeurs récupérées du localStorage:`);
    console.log(`- playerHue (brut): ${localStorage.getItem('playerHue')}`);
    console.log(`- playerHue (converti): ${playerHue}`);
    console.log(`- playerName: ${playerName}`);
    
    // Charger la carte
    this.loadMap();
    
    // Position temporaire du joueur (sera mise à jour à la connexion)
    const mapCenterX = 10 * this.tileSize; // Position temporaire à x=10
    const mapCenterY = 12 * this.tileSize; // Position temporaire à y=12
    
    // Initialiser les positions subpixel
    this.actualX = mapCenterX;
    this.actualY = mapCenterY;
    
    // IMPORTANT: Appliquer la couleur correctement
    console.log('=== Application de la couleur ===');
    console.log(`Teinte à convertir: ${playerHue}`);
    const playerColor = this.hueToRgb(playerHue);
    console.log(`Couleur RGB calculée: 0x${playerColor.toString(16)}`);
    
    // Calculer une version plus foncée pour le contour
    const r = (playerColor >> 16) & 0xFF;
    const g = (playerColor >> 8) & 0xFF;
    const b = playerColor & 0xFF;
    
    // Réduire chaque composante de 40% pour assombrir
    const darkerR = Math.max(0, Math.floor(r * 0.6));
    const darkerG = Math.max(0, Math.floor(g * 0.6));
    const darkerB = Math.max(0, Math.floor(b * 0.6));
    
    const darkerColor = (darkerR << 16) | (darkerG << 8) | darkerB;
    console.log(`Couleur contour calculée: 0x${darkerColor.toString(16)}`);
    
    // Créer un container pour le joueur
    const containerSize = 6; // Taille réduite (6x6 pixels)
    const container = this.add.container(mapCenterX, mapCenterY);
    
    // Créer un graphique pour le joueur (contour + remplissage)
    const playerGraphics = this.add.graphics();
    
    // D'abord dessiner le contour
    playerGraphics.fillStyle(darkerColor, 1);
    playerGraphics.fillRect(-containerSize - 1, -containerSize - 1, containerSize * 2 + 2, containerSize * 2 + 2);
    
    // Ensuite dessiner le remplissage
    playerGraphics.fillStyle(playerColor, 1);
    playerGraphics.fillRect(-containerSize, -containerSize, containerSize * 2, containerSize * 2);
    
    // Ajouter le graphique au container
    container.add(playerGraphics);
    
    // Référencer le container comme joueur
    this.player = container;
    this.player.setDepth(10);
    
    // Ajouter le nom du joueur
    const playerNameText = this.add.text(
      mapCenterX,
      mapCenterY - 12,
      playerName,
      {
        fontSize: '8px',
        fontFamily: 'Arial, sans-serif', 
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
        letterSpacing: 2
      }
    ).setOrigin(0.5).setDepth(10);
    
    // Stocker une référence pour l'identifier plus tard
    playerNameText.setData('playerId', 'mainPlayer');

    // Configurer la caméra
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(2);
    this.cameras.main.roundPixels = true;

    // Réactiver ces paramètres qui étaient présents avant
    this.cameras.main.followOffset.set(0, 0);
    this.cameras.main.deadzone = null;

    // Configuration supplémentaire pour réduire le scintillement
    this.cameras.main.useBounds = true;
    
    // Définir les limites de la caméra basées sur la taille de la carte
    if (this.mapLines.length > 0) {
      const mapWidth = this.mapLines[0].length * this.tileSize;
      const mapHeight = this.mapLines.length * this.tileSize;
      this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
      console.log(`Limites de la caméra: (0, 0) à (${mapWidth}, ${mapHeight})`);
    }
    
    // Créer l'outil (pioche)
    this.tool = this.add.sprite(
      mapCenterX,
      mapCenterY,
      'pickaxe'
    );
    this.tool.setOrigin(0, 0.5);
    this.tool.setDepth(10);
    
    // Stocker l'angle d'origine de l'outil pour les animations
    this.tool.setData('baseRotation', this.tool.rotation);
    this.tool.setData('animating', false);
    
    // Écouter les mises à jour pour animer doucement l'outil
    this.events.on('update', this.updateToolAnimation, this);
    
    // Charger les tuiles autour du joueur
    this.updateVisibleTiles();
    
    // Se connecter au serveur Colyseus avec les infos du joueur
    await this.connectToServer(playerName, playerHue);
    
    // Initialiser les écouteurs d'événements pour les ressources
    this.initializeResourceListeners();
    
    // Mettre à jour le curseur
    this.updateCursor();

    // Démarrer la scène UI qui affichera les ressources et autres éléments d'interface
    this.scene.launch('UIScene');
    console.log("Scène UI démarrée");
    
    // Émettre un événement pour initialiser les ressources dans l'UI
    this.updateResourcesUI();

    // Créer un groupe pour les effets numériques
    this.numericEffects = this.add.group();
    
    // Initialiser les gestionnaires de ressources
    this.initializeResourceListeners();
    
    // S'assurer que les gestionnaires d'événements sont configurés correctement
    this.setupNetworkHandlers();
    
    // Ajouter un log pour vérifier que tout est bien initialisé
    console.log("GameScene créée avec succès");
    console.log("État de la room:", this.room ? "Connecté" : "Non connecté");
    console.log("Gestionnaires réseau configurés:", 
      this.room && this.room.onMessage ? "Oui" : "Non");
    
    // Écouter les événements de construction
    this.events.on('buildingSelected', (buildingType: string) => {
      this.startPlacingBuilding(buildingType);
    });
    
    // Écouter l'événement d'arrêt de placement de bâtiment (quand le menu est fermé)
    this.events.on('stopPlacingBuilding', () => {
      if (this.isPlacingBuilding) {
        this.stopPlacingBuilding();
      }
    });

    // Ajouter les événements de la souris pour la construction
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isPlacingBuilding && this.buildingPreview) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE;
        const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE;
        
        this.updateBuildingPreview(tileX, tileY);
      }
    });

    // Modifié pour ne pas interférer avec la sélection des bâtiments
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isPlacingBuilding && this.selectedBuildingType && this.canPlaceBuilding) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE;
        const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE;
        
        // Envoyer la demande de construction au serveur
        this.room.send("build", {
          type: this.selectedBuildingType,
          x: tileX,
          y: tileY
        });
        
        // Arrêter le mode placement
        this.stopPlacingBuilding();
      }
    });

    // Écouter la touche Escape pour annuler la construction
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.isPlacingBuilding) {
        this.stopPlacingBuilding();
      }
    });
    
    // Initialiser les variables pour la sélection de bâtiment
    this.selectedBuilding = null;
    this.destroyButton = null;
    
    // Initialiser les systèmes et l'interface utilisateur
    this.createResourcesUI();
    
    // Supprimer toutes les barres de vie des unités
    this.clearAllUnitHealthBars();
  }
  
  update(time: number, delta: number) {
    if (!this.room || !this.player) return;
    
    // Déterminer le chunk actuel du joueur
    const playerChunkX = Math.floor(this.actualX / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.actualY / (this.tileSize * this.CHUNK_SIZE));
    
    // Ne charger les chunks que si le joueur a changé de chunk
    if (playerChunkX !== this.lastLoadedChunkX || playerChunkY !== this.lastLoadedChunkY) {
      // Mettre à jour les chunks visibles
      this.updateVisibleChunks(playerChunkX, playerChunkY);
      this.lastLoadedChunkX = playerChunkX;
      this.lastLoadedChunkY = playerChunkY;
    }
    
    // Optimiser le rendu en désactivant les objets hors écran
    if (time - this.lastRenderOptimization > this.RENDER_OPTIMIZATION_INTERVAL) {
      this.optimizeRendering();
      this.lastRenderOptimization = time;
    }
    
    // Gérer le mouvement du joueur
    this.handlePlayerMovement();
    
    // Mettre à jour les positions des autres joueurs avec interpolation
    this.updateOtherPlayers(delta);
    
    // Mettre à jour les positions des unités avec interpolation
    this.updateUnits(delta);
    
    // Mettre à jour l'outil
    this.updateTool();
    
    // Envoyer la position du curseur au serveur si en mode main (non-outil)
    if (!this.isToolMode && time - (this.lastCursorUpdate || 0) > 200) { // Limiter à 5 fois par seconde
      const pointer = this.input.activePointer;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.room.send("targetCursorPosition", {
        x: worldPoint.x,
        y: worldPoint.y,
        isTargetMode: true
      });
      this.lastCursorUpdate = time;
    } else if (this.isToolMode && this.lastCursorMode !== this.isToolMode) {
      // Si on revient en mode outil, informer le serveur
      this.room.send("targetCursorPosition", {
        x: 0,
        y: 0,
        isTargetMode: false
      });
    }
    this.lastCursorMode = this.isToolMode;
    
    // Mettre à jour l'animation de l'outil (AJOUT CRITIQUE)
    this.updateToolAnimation(time, delta);
    
    // Mettre à jour la position du nom du joueur
    const playerNameText = this.children.list.find(
      child => child.type === 'Text' && 
      child.getData('playerId') === 'mainPlayer'
    ) as Phaser.GameObjects.Text | undefined;
    
    if (playerNameText) {
      // Positionner le texte avec la précision subpixel
      playerNameText.setPosition(
        this.player.x, 
        this.player.y - 22
      );
    }
    
    // Synchroniser la position avec le serveur (limité par la fréquence et seulement si on a bougé)
    const now = time;
    if (Math.abs(this.actualX - this.lastPlayerX) > this.positionThreshold || 
                    Math.abs(this.actualY - this.lastPlayerY) > this.positionThreshold) {
      this.synchronizePlayerPosition();
      this.lastNetworkUpdate = now;
      
      // Mémoriser la dernière position
      this.lastPlayerX = this.actualX;
      this.lastPlayerY = this.actualY;
    }
    
    // Forcer l'alignement de la caméra sur la grille de pixels
    this.snapCameraToGrid();

    // Mettre à jour l'interface des ressources (à un taux moins fréquent)
    if (time - (this.lastResourcesUpdate || 0) > 1000) {
      this.updateResourcesUI();
      this.lastResourcesUpdate = time;
      
      // Émettre un événement pour mettre à jour la position sur la mini-carte
      this.events.emit('updatePlayerPosition', {
        x: this.actualX,
        y: this.actualY,
        resources: this.resourceSprites
      });
    }
    
    // Mettre à jour les animations d'outils
    this.updateToolAnimation(time, delta);
    
    // Mettre à jour le minage
    this.updateMining(time);
    
    // Mettre à jour les barres de progression des bâtiments de production moins fréquemment
    if (time - this.lastProductionBarsUpdate > 200) { // Toutes les 200ms au lieu de chaque frame
      this.updateProductionBars();
      this.lastProductionBarsUpdate = time;
    }
    
    // Vérifier périodiquement la synchronisation des unités (toutes les 5 secondes)
    if (time - this.lastUnitSyncCheck > 5000) {
      this.checkUnitSynchronization();
      this.lastUnitSyncCheck = time;
      
      // Ajouter un diagnostic périodique
      this.logEntitiesStatus();
    }
    
    // Vérifier si on a un clic prolongé en cours
    if (!this.isToolMode && this.longPressTarget && this.input.activePointer.isDown) {
      const pressDuration = Date.now() - this.longPressTimer;
      
      // Si la durée dépasse le seuil et qu'on n'est pas déjà en mode clic prolongé
      if (pressDuration > this.LONG_PRESS_THRESHOLD && !this.isLongPressing) {
        this.isLongPressing = true;
        
        // Envoyer la position cible au serveur
        if (this.room) {
          this.room.send("unitMoveTarget", {
            x: this.longPressTarget.x,
            y: this.longPressTarget.y,
            isMoving: true
          });
        }
      }
    }
    
    // Vérification de sécurité pour l'écran de mort
    if (!this.isPlayerDead && this.deathScreen) {
      console.log("Anomalie détectée: écran de mort présent alors que le joueur n'est pas mort. Nettoyage forcé.");
      this.hideDeathScreen();
    }
  }
  
  // Configuration simplifiée des gestionnaires réseau Colyseus
  private setupNetworkHandlers(): void {
    if (!this.room) return;
    
    // Gestionnaire pour l'état initial du joueur
    this.room.onStateChange((state) => {
      console.log("État du jeu reçu:", state);
      
      // Récupérer notre joueur
      const player = state.players.get(this.room.sessionId);
      if (player) {
        this.playerEntity = player;
        
        // Utiliser la position initiale fournie par le serveur
        if (this.player && !this.initialPositionSet) {
          this.actualX = player.x;
          this.actualY = player.y;
          this.player.setPosition(player.x, player.y);
          console.log(`Position initiale définie: (${player.x}, ${player.y})`);
          this.initialPositionSet = true;
        }
        
        // Mettre à jour l'interface des ressources
        this.updateResourcesUI();
      }
    });
    
    // Récupérer l'état initial
    console.log("État initial reçu:", this.room.state);
    console.log("Structure de l'état:", JSON.stringify(Object.keys(this.room.state)));
    
    // Gestionnaires d'événements pour les messages du serveur
    this.room.onMessage("playerJoined", (message) => {
      console.log("Message playerJoined reçu:", message);
      
      // Vérifier si c'est notre propre joueur
      if (message.sessionId === this.room.sessionId) return;
      
      // Créer un sprite pour le nouveau joueur
      this.createPlayerSprite({
        x: message.x,
        y: message.y,
        name: message.name,
        hue: message.hue
      }, message.sessionId);
    });
    
    // NOUVEAU GESTIONNAIRE: Mise à jour des positions des unités
    this.room.onMessage("unitPositions", (message) => {
      // Vérifier que le message est bien formaté
      if (!message.units || !Array.isArray(message.units)) {
        console.error("Format de message unitPositions invalide:", message);
        return;
      }
      
      console.log(`Reçu ${message.units.length} positions d'unités`);
      
      // Mettre à jour les positions des unités
      message.units.forEach(unit => {
        // Vérifier si l'unité existe déjà dans notre collection
        if (this.unitSprites.has(unit.id)) {
          // Mettre à jour la position cible
          const unitData = this.unitSprites.get(unit.id);
          if (unitData) {
            unitData.targetX = unit.x;
            unitData.targetY = unit.y;
          }
        } else {
          // Si l'unité n'existe pas encore, la créer
          this.createUnitSprite(unit, unit.id);
        }
      });
    });
    
    // Écouter les messages d'épuisement de ressources
    this.room.onMessage("resourceDepleted", (message) => {
      console.log("Ressource épuisée:", message.resourceId);
      
      // Récupérer le sprite de la ressource
      const resourceSprite = this.resourceSprites.get(message.resourceId);
      if (resourceSprite) {
        // Marquer la ressource comme épuisée
        resourceSprite.setData('amount', 0);
        
        // Appliquer un effet visuel pour montrer l'épuisement
        this.depleteResource(resourceSprite, message.resourceId);
      }
    });
    
    // Écouter les dégâts subis par les unités
    this.room.onMessage("unitDamaged", (data: any) => {
      console.log("Unité endommagée:", data);
      
      // Ne plus mettre à jour la barre de vie
      // this.updateUnitHealthBar(data.unitId, data.health, data.maxHealth);
      
      // Montrer l'effet de dégâts
      const unitData = this.unitSprites.get(data.unitId);
      if (unitData) {
        this.showDamageEffect(unitData.sprite.x, unitData.sprite.y, data.damage);
        
        // Effet de recul léger (secousse)
        this.addContainerShakeEffect(unitData.sprite, 0.5);
      }
    });
    
    // Écouter les dégâts subis par le joueur
    this.room.onMessage("playerDamaged", (data: any) => {
      console.log("Joueur endommagé:", data);
      
      // Mise à jour de la barre de vie du joueur
      if (data.health !== undefined && data.maxHealth !== undefined) {
        this.updatePlayerHealthBar(data.health, data.maxHealth);
      } else {
        console.warn("Données de santé manquantes dans playerDamaged:", data);
      }
      
      // Effet visuel de dégâts
      this.showPlayerDamageEffect(data.damage);
      
      // Alerte de santé critique si besoin (moins de 30% de santé)
      if (data.health < data.maxHealth * 0.3) {
        this.showCriticalHealthWarning();
      }
    });
    
    // Écouter la mort d'une unité
    this.room.onMessage("unitKilled", (data: any) => {
      console.log("Unité tuée:", data);
      
      // Obtenir l'unité avant qu'elle ne soit supprimée
      const unitData = this.unitSprites.get(data.unitId);
      if (unitData) {
        // Effet de disparition
        this.tweens.add({
          targets: unitData.sprite,
          alpha: 0,
          y: unitData.sprite.y - 10,
          duration: 500,
          ease: 'Power2',
          onComplete: () => {
            // La suppression réelle est gérée par le handler de suppression d'unité
          }
        });
        
        // Supprimer aussi le texte du nom si présent
        if (unitData.nameText) {
          unitData.nameText.destroy();
        }
      }
      
      // Nettoyer les barres de vie - n'est plus nécessaire, mais gardé par sécurité
      const healthBar = this.unitHealthBars.get(data.unitId);
      if (healthBar) {
        healthBar.destroy();
        this.unitHealthBars.delete(data.unitId);
      }
    });
    
    // Écouter la mort du joueur
    this.room.onMessage("playerDied", (message) => {
      console.log("Joueur mort:", message);
      
      // Marquer le joueur comme mort
      this.isPlayerDead = true;
      
      // Afficher l'écran de mort avec la durée en millisecondes
      this.showDeathScreen(message.respawnTimeMs);
      
      // Désactiver les contrôles du joueur
      this.disablePlayerControls();
    });
    
    // Écouter le respawn du joueur
    this.room.onMessage("playerRespawned", (message) => {
      console.log("Joueur respawn:", message);
      
      // Réinitialiser l'état du joueur
      this.isPlayerDead = false;
      
      // S'assurer que la teinte rouge est réinitialisée
      if (this.damageTint) {
        this.damageTint.setAlpha(0);
        console.log("Teinte rouge réinitialisée lors du respawn");
      }
      
      // Vérifier s'il y a un intervalle de compte à rebours en cours et le supprimer
      if (this.respawnCountdown) {
        // Arrêter tout intervalle qui pourrait être en cours pour le compte à rebours
        // Ce n'est pas idéal car nous n'avons pas accès à l'ID de l'intervalle spécifique
        // mais c'est une façon de s'assurer que tout intervalle potentiel est arrêté
        this.respawnCountdown.setText("Respawn en cours...");
      }
      
      // Cacher l'écran de mort
      this.hideDeathScreen();
      
      // Réactiver les contrôles
      this.enablePlayerControls();
      
      // Mettre à jour la position du joueur
      if (this.player) {
        // Important: mettre à jour aussi les positions réelles en subpixels
        this.actualX = message.x;
        this.actualY = message.y;
        // Mettre à jour aussi la dernière position connue pour éviter une synchronisation immédiate
        this.lastPlayerX = message.x;
        this.lastPlayerY = message.y;
        
        this.player.setPosition(message.x, message.y);
        this.cameras.main.centerOn(message.x, message.y);
      }
      
      // Mettre à jour la barre de vie si l'information est disponible
      if (message.health !== undefined && message.maxHealth !== undefined) {
        this.updatePlayerHealthBar(message.health, message.maxHealth);
      }
      
      // Effet visuel de réapparition
      this.showRespawnEffect();
    });
    
    // Écouter les mises à jour de ressources
    this.room.onMessage("resourceUpdate", (message) => {
      console.log("Mise à jour de ressource:", message);
      
      // Récupérer le sprite de la ressource
      const resourceSprite = this.resourceSprites.get(message.resourceId);
      if (resourceSprite) {
        // Mettre à jour la quantité
        resourceSprite.setData('amount', message.amount);
      }
    });
    
    // Écouter quand un autre joueur meurt
    this.room.onMessage("otherPlayerDied", (message) => {
      console.log("Autre joueur mort:", message);
      
      // Récupérer le sprite du joueur
      const playerData = this.unitSprites.get(message.sessionId);
      if (playerData) {
        // Effet de disparition pour le joueur mort
        this.tweens.add({
          targets: playerData.sprite,
          alpha: 0.3, // Rendre semi-transparent plutôt que de disparaître complètement
          y: playerData.sprite.y - 5,
          duration: 500,
          ease: 'Power2'
        });
        
        // Marquer le joueur comme mort dans nos données
        playerData.sprite.setData('isDead', true);
        
        // Ajouter effet visuel "MORT" au-dessus du joueur
        const deadText = this.add.text(
          playerData.sprite.x,
          playerData.sprite.y - 30,
          "MORT",
          {
            fontSize: '12px',
            color: '#ff0000',
            stroke: '#000000',
            strokeThickness: 2
          }
        );
        deadText.setOrigin(0.5);
        deadText.setDepth(15); // Au-dessus du joueur
        
        // Attacher le texte au joueur pour qu'il bouge avec lui
        playerData.sprite.setData('deadText', deadText);
      }
    });
    
    // Écouter quand un autre joueur réapparaît
    this.room.onMessage("otherPlayerRespawned", (message) => {
      console.log("Autre joueur réapparu:", message);
      
      // Récupérer le sprite du joueur
      const playerData = this.unitSprites.get(message.sessionId);
      if (playerData) {
        // Réinitialiser les propriétés visuelles
        this.tweens.add({
          targets: playerData.sprite,
          alpha: 1, // Rétablir l'opacité normale
          y: message.y, // Mettre à jour la position
          duration: 500,
          ease: 'Power2'
        });
        
        // Mettre à jour la position cible
        playerData.targetX = message.x;
        playerData.targetY = message.y;
        
        // Marquer le joueur comme vivant
        playerData.sprite.setData('isDead', false);
        
        // Récupérer et supprimer le texte "MORT" s'il existe
        const deadText = playerData.sprite.getData('deadText');
        if (deadText) {
          console.log("Suppression du texte MORT pour le joueur", message.sessionId);
          if (deadText.destroy) {
            deadText.destroy();
          }
          // S'assurer que la référence est également supprimée
          playerData.sprite.setData('deadText', null);
        } else {
          console.log("Aucun texte MORT trouvé pour le joueur", message.sessionId);
          
          // Recherche dans les enfants de la scène pour trouver d'éventuels textes MORT orphelins
          this.children.list.forEach(child => {
            if (child instanceof Phaser.GameObjects.Text && 
                child.text === "MORT" && 
                Math.abs(child.x - playerData.sprite.x) < 50 && 
                Math.abs(child.y - playerData.sprite.y - 30) < 50) {
              console.log("Texte MORT orphelin trouvé et supprimé");
              child.destroy();
            }
          });
        }
        
        // Effet de réapparition
        const respawnEffect = this.add.particles(message.x, message.y, 'spark', {
          lifespan: 1000,
          speed: { min: 30, max: 70 },
          scale: { start: 0.2, end: 0 },
          quantity: 20,
          blendMode: 'ADD'
        });
        
        // Supprimer l'effet après un court délai
        this.time.delayedCall(1000, () => {
          if (respawnEffect) respawnEffect.destroy();
        });
      }
    });
    
    this.room.onMessage("playerLeft", (message) => {
      console.log("Message playerLeft reçu:", message);
      
      // Supprimer le sprite du joueur qui part
      const playerData = this.unitSprites.get(message.sessionId);
      if (playerData) {
        // Supprimer le texte MORT si le joueur était mort
        const deadText = playerData.sprite.getData('deadText');
        if (deadText && deadText.destroy) {
          deadText.destroy();
        }
        
        // Suppression du sprite du joueur et de son nom
        playerData.sprite.destroy();
        if (playerData.nameText) {
          playerData.nameText.destroy();
        }
        this.unitSprites.delete(message.sessionId);
      }
    });
    
    this.room.onMessage("playerMoved", (message) => {
      console.log("Message playerMoved reçu:", message);
      
      // Mettre à jour la position cible du joueur
      const playerData = this.unitSprites.get(message.sessionId);
      if (playerData) {
        playerData.targetX = message.x;
        playerData.targetY = message.y;
      } else {
        // Le joueur n'existe pas encore, tenter de le créer
        console.log("Joueur inconnu qui bouge, récupération des infos...");
        const player = this.room.state.players.get(message.sessionId);
        if (player) {
          this.createPlayerSprite(player, message.sessionId);
        }
      }
    });
    
    if (this.room.state.players) {
      console.log("Structure des joueurs:", Object.keys(this.room.state.players));
      console.log("Nombre de joueurs:", Object.keys(this.room.state.players).length);
      
      // Vérifier si la méthode forEach existe
      if (typeof this.room.state.players.forEach === 'function') {
        console.log("La méthode forEach existe sur players");
      } else {
        console.log("La méthode forEach N'EXISTE PAS sur players");
        // Utiliser une autre méthode pour itérer
        Object.keys(this.room.state.players).forEach(sessionId => {
          const player = this.room.state.players[sessionId];
          console.log(`Joueur trouvé avec autre méthode: ${sessionId}`, player);
          
          if (sessionId === this.room.sessionId) {
            this.playerEntity = player;
          } else if (player) {
            this.createPlayerSprite(player, sessionId);
          }
        });
      }
    } else {
      console.error("room.state.players est undefined ou null");
    }
    
    // Parcourir les joueurs existants dans l'état initial
    this.room.onStateChange.once((state) => {
      console.log("onStateChange.once appelé avec l'état:", state);
      
      if (state && state.players) {
        console.log("Joueurs dans l'état initial:", Object.keys(state.players).length);
        
        // Vérifier la structure de state.players
        if (typeof state.players.forEach === 'function') {
          // Utiliser la méthode forEach de Colyseus pour parcourir les joueurs
          state.players.forEach((player, sessionId) => {
            console.log("Joueur trouvé dans l'état initial:", sessionId, player);
            
            if (sessionId === this.room.sessionId) {
              this.playerEntity = player;
            } else if (player) {
              this.createPlayerSprite(player, sessionId);
            }
          });
        } else {
          // Parcourir manuellement les joueurs
          Object.keys(state.players).forEach(sessionId => {
            const player = state.players[sessionId];
            console.log(`Joueur trouvé avec méthode alternative: ${sessionId}`, player);
            
            if (sessionId === this.room.sessionId) {
              this.playerEntity = player;
            } else if (player) {
              this.createPlayerSprite(player, sessionId);
            }
          });
        }
      } else {
        console.error("state.players est undefined ou null dans onStateChange");
      }
    });
    
    // Débogage: Afficher tous les joueurs à intervalles réguliers
    setInterval(() => {
      if (this.room && this.room.state && this.room.state.players) {
        console.log("====== ÉTAT DES JOUEURS ======");
        console.log(`Notre ID: ${this.room.sessionId}`);
        
        // Vérifier si players est un objet ou un MapSchema
        if (typeof this.room.state.players.forEach === 'function') {
          console.log("Utilisation de la méthode forEach de MapSchema");
          let playerCount = 0;
          this.room.state.players.forEach((player, id) => {
            const isUs = id === this.room.sessionId;
            console.log(`Joueur ${id}${isUs ? ' (nous)' : ''}: x=${player.x}, y=${player.y}`);
            playerCount++;
          });
          console.log(`Nombre de joueurs: ${playerCount}`);
        } else {
          const playerKeys = Object.keys(this.room.state.players);
          console.log(`Nombre de joueurs: ${playerKeys.length}`);
          playerKeys.forEach(id => {
            const player = this.room.state.players[id];
            const isUs = id === this.room.sessionId;
            console.log(`Joueur ${id}${isUs ? ' (nous)' : ''}: x=${player.x}, y=${player.y}`);
          });
        }
        
        console.log(`Sprites affichés: ${this.unitSprites.size}`);
        this.unitSprites.forEach((data, id) => {
          console.log(`Sprite ${id}: x=${data.sprite.x}, y=${data.sprite.y}`);
        });
      }
    }, 5000);
    
    // Écouter l'ajout de nouveaux joueurs
    this.room.state.listen("players/:id", "add", (sessionId, player) => {
      console.log(`Joueur ajouté: ${sessionId}`, player);
      
      // Créer un sprite pour ce joueur
      this.createPlayerSprite(player, sessionId);
    });
    
    // Écouter la suppression de joueurs
    this.room.state.listen("players/:id", "remove", (sessionId) => {
      console.log(`Joueur supprimé: ${sessionId}`);
      const playerData = this.unitSprites.get(sessionId);
      
      if (playerData) {
        // Supprimer le sprite et le texte du nom
        playerData.sprite.destroy();
        if (playerData.nameText) {
          playerData.nameText.destroy();
        }
        this.unitSprites.delete(sessionId);
      }
    });
    
    // Écouter les changements de position avec plus de détails
    this.room.state.listen("players/:id/:attribute", "change", (sessionId, attribute, value) => {
      if (sessionId === this.room.sessionId) {
        // Si c'est notre joueur et que ses ressources ont changé
        if (attribute === "resources") {
          console.log("Resources updated, emitting event");
          // Mettre à jour l'interface immédiatement
          this.updateResourcesUI();
          return;
        }
        
        // Ignorer nos propres changements de position
        if (attribute === "x" || attribute === "y") return;
      }
      
      console.log(`Changement détecté: joueur ${sessionId}, ${attribute} = ${value}`);
      
      const playerData = this.unitSprites.get(sessionId);
      if (!playerData) {
        console.log(`Pas de sprite pour le joueur ${sessionId}, tentative de création...`);
        const player = this.room.state.players.get(sessionId);
        if (player) {
          this.createPlayerSprite(player, sessionId);
          return;
        }
      }
      
      if (playerData && (attribute === "x" || attribute === "y")) {
        console.log(`Mise à jour de ${attribute} à ${value} pour joueur ${sessionId}`);
        // Mettre à jour la cible pour l'interpolation
        if (attribute === "x") {
          playerData.targetX = value;
        } else if (attribute === "y") {
          playerData.targetY = value;
        }
      }
    });
    
    // Écouter l'ajout d'unités
    this.room.state.units.onAdd = (unit, unitId) => {
      console.log(`Unité ajoutée: ${unitId}`, unit);
      
      // Vérifier si cette unité n'existe pas déjà pour éviter les doublons
      if (!this.unitSprites.has(unitId)) {
        this.createUnitSprite(unit, unitId);
        console.log(`Sprite créé pour l'unité ${unitId}`);
      } else {
        console.log(`L'unité ${unitId} existe déjà, pas de création de sprite`);
      }
    };
    
    // Écouter la suppression d'unités
    this.room.state.units.onRemove = (unit, unitId) => {
      console.log(`Unité supprimée: ${unitId}`);
      const unitData = this.unitSprites.get(unitId);
      if (unitData) {
        unitData.sprite.destroy();
        if (unitData.nameText) {
          unitData.nameText.destroy();
        }
        this.unitSprites.delete(unitId);
      }
    };

    // Écouter les changements de position des unités
    this.room.state.units.onChange = (unit, unitId) => {
      const unitData = this.unitSprites.get(unitId);
      if (unitData) {
        unitData.targetX = unit.x;
        unitData.targetY = unit.y;
      }
    };

    // Écouter les changements sur les ressources
    this.room.state.resources.onAdd = (resource: any, resourceId: string) => {
      console.log(`Ressource ajoutée: ${resourceId} (type: ${resource.type}, position: ${resource.x}, ${resource.y})`);
      
      // Ne pas créer de sprite si la ressource est épuisée
      if (resource.amount <= 0 || resource.isRespawning) {
        console.log(`La ressource ${resourceId} est épuisée ou en respawn, ignorée`);
        return;
      }
      
      // Vérifier si la ressource n'existe pas déjà
      const existingSprite = this.resourceSprites.get(resourceId);
      if (existingSprite) {
        console.log(`La ressource ${resourceId} existe déjà, mise à jour...`);
        existingSprite.setPosition(resource.x, resource.y);
        existingSprite.setData('amount', resource.amount);
        return;
      }
      
      // Créer le sprite pour la ressource
      const resourceSprite = this.createResource(resource.type, resource.x, resource.y);
      
      // Mettre à jour la quantité avec celle du serveur
      resourceSprite.setData('amount', resource.amount);
      
      // Stocker la référence au sprite
      this.resourceSprites.set(resourceId, resourceSprite);
      
      console.log(`Nombre total de ressources: ${this.resourceSprites.size}`);
    };
    
    // Écouter les modifications des ressources
    this.room.state.resources.onChange = (resource: any, resourceId: string) => {
      // Récupérer le sprite correspondant
      const resourceSprite = this.resourceSprites.get(resourceId);
      if (!resourceSprite) return;
      
      // Si la quantité a changé, mettre à jour la donnée locale
      if (resource.amount !== undefined) {
        const oldAmount = resourceSprite.getData('amount') || 0;
        
        // Ne pas mettre à jour si c'est nous qui avons fait le changement
        if (this.harvestTarget && this.harvestTarget.id === resourceId) {
          return;
        }
        
        // Si la ressource est épuisée ou en respawn, la supprimer
        if (resource.amount <= 0 || resource.isRespawning) {
          this.depleteResource(resourceSprite, resourceId);
          return;
        }
        
        // Mettre à jour la quantité
        resourceSprite.setData('amount', resource.amount);
      }
    };
    
    // Écouter les suppressions de ressources
    this.room.state.resources.onRemove = (resource: any, resourceId: string) => {
      console.log(`Ressource supprimée: ${resourceId}`);
      
      // Récupérer et supprimer le sprite
      const resourceSprite = this.resourceSprites.get(resourceId);
      if (resourceSprite) {
        resourceSprite.destroy();
        this.resourceSprites.delete(resourceId);
      }
    };

    // Écouter les ajouts de bâtiments
    this.room.state.buildings.onAdd = (building: any, buildingId: string) => {
      console.log(`Bâtiment ajouté: ${buildingId}, type: ${building.type}`);
      
      // Récupérer le type de bâtiment et créer le sprite correspondant
      const buildingType = building.type.toLowerCase();
      const spriteName = GameScene.BUILDING_SPRITES[building.type] || buildingType;
      
      const sprite = this.add.sprite(
        building.x + TILE_SIZE/2,
        building.y + TILE_SIZE/2,
        spriteName
      );
      
      // Stocker le sprite dans la Map
      this.buildingSprites.set(buildingId, sprite);
      
      // Définir la profondeur pour que le bâtiment apparaisse au-dessus des tuiles
      sprite.setDepth(10);
      
      // Amélioration: s'assurer que le sprite est bien visible et interactif
      sprite.setAlpha(1);
      sprite.setScale(1);
      
      // Utiliser une zone d'interaction agrandie pour faciliter le clic
      const hitArea = new Phaser.Geom.Rectangle(-TILE_SIZE/2 - 5, -TILE_SIZE/2 - 5, TILE_SIZE + 10, TILE_SIZE + 10);
      sprite.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
      
      // Ajouter des événements de débogage
      sprite.on('pointerover', () => {
        console.log(`Survol du bâtiment: ${buildingId}`);
        sprite.setTint(0xaaffaa);
      });
      
      sprite.on('pointerout', () => {
        console.log(`Fin de survol du bâtiment: ${buildingId}`);
        if (this.selectedBuilding !== buildingId) {
          sprite.setTint(0xffffff);
        } else {
          sprite.setTint(0x00ffff);
        }
      });
      
      sprite.on('pointerdown', () => {
        console.log(`Clic sur le bâtiment: ${buildingId}`);
        this.selectBuilding(buildingId);
      });
      
      // Ajouter une barre de couleur pour indiquer le propriétaire
      if (building.owner) {
        console.log(`Propriétaire du bâtiment: ${building.owner}`);
        
        // Récupérer le joueur propriétaire
        const owner = this.room.state.players.get(building.owner);
        if (owner && owner.hue !== undefined) {
          // Convertir la teinte en couleur
          const ownerColor = this.hueToColor(owner.hue);
          
          // Créer une barre de couleur sous le bâtiment
          const barWidth = TILE_SIZE * 0.8;
          const barHeight = 4;
          const bar = this.add.rectangle(
            sprite.x,
            sprite.y + TILE_SIZE/2 + 2,
            barWidth,
            barHeight,
            ownerColor
          );
          bar.setDepth(11);
          
          // Stocker une référence à la barre de couleur
          sprite.setData('ownerBar', bar);
        }
      }
      
      // Si c'est un bâtiment de production (four, forge ou usine), ajouter une barre de progression
      if (building.type === BuildingType.FURNACE || building.type === BuildingType.FORGE || building.type === BuildingType.FACTORY) {
        // Fond de la barre de progression (gris)
        const progressBg = this.add.rectangle(
          sprite.x,
          sprite.y + TILE_SIZE/2 + 8, // Sous la barre du propriétaire
          TILE_SIZE * 0.8,
          5,
          0x444444
        );
        progressBg.setAlpha(0.7);
        progressBg.setDepth(11);
        
        // Barre de progression (verte)
        const progressBar = this.add.rectangle(
          sprite.x - (TILE_SIZE * 0.4), // Aligné à gauche
          sprite.y + TILE_SIZE/2 + 8,
          0, // La largeur sera mise à jour dynamiquement
          5,
          0x00ff00
        );
        progressBar.setOrigin(0, 0.5); // Origine à gauche pour l'animation
        progressBar.setDepth(12);
        
        // Stocker des références aux barres pour les mises à jour
        sprite.setData('progressBg', progressBg);
        sprite.setData('progressBar', progressBar);
        sprite.setData('isProductionBuilding', true);
      }
    };
    
    // Écouter les modifications des bâtiments
    this.room.state.buildings.onChange = (building: any, buildingId: string) => {
      // Récupérer le sprite correspondant
      const buildingSprite = this.buildingSprites.get(buildingId);
      if (!buildingSprite) return;
      
      // Mettre à jour la position si elle a changé
      if (building.x !== undefined && building.y !== undefined) {
        buildingSprite.setPosition(building.x + TILE_SIZE/2, building.y + TILE_SIZE/2);
      }
      
      // Mettre à jour d'autres propriétés si nécessaire (santé, état, etc.)
      if (building.health !== undefined) {
        // Ajouter une barre de vie ou un indicateur visuel si nécessaire
      }
    };
    
    // Écouter les suppressions de bâtiments
    this.room.state.buildings.onRemove = (building: any, buildingId: string) => {
      console.log(`Bâtiment supprimé: ${buildingId}`);
      
      // Si le bâtiment supprimé était sélectionné, le désélectionner
      if (this.selectedBuilding === buildingId) {
        this.selectBuilding("");
      }
      
      // Récupérer et supprimer le sprite
      const buildingSprite = this.buildingSprites.get(buildingId);
      if (buildingSprite) {
        // Supprimer également la barre de couleur si elle existe
        const ownerBar = buildingSprite.getData('ownerBar');
        if (ownerBar) {
          this.tweens.add({
            targets: ownerBar,
            alpha: 0,
            duration: 400,
            onComplete: () => {
              ownerBar.destroy();
            }
          });
        }
        
        // Supprimer les barres de progression si elles existent
        const progressBg = buildingSprite.getData('progressBg');
        const progressBar = buildingSprite.getData('progressBar');
        
        if (progressBg) {
          this.tweens.add({
            targets: progressBg,
            alpha: 0,
            duration: 400,
            onComplete: () => {
              progressBg.destroy();
            }
          });
        }
        
        if (progressBar) {
          this.tweens.add({
            targets: progressBar,
            alpha: 0,
            duration: 400,
            onComplete: () => {
              progressBar.destroy();
            }
          });
        }
        
        // Ajouter une animation de destruction si nécessaire
        this.tweens.add({
          targets: buildingSprite,
          alpha: 0,
          scale: 0.8,
          duration: 500,
          ease: 'Power2',
          onComplete: () => {
            buildingSprite.destroy();
            this.buildingSprites.delete(buildingId);
          }
        });
      }
    };

    // Gestionnaire pour les ressources initiales
    this.room.onMessage("initialResources", (data) => {
      console.log(`Ressources initiales reçues: ${data.length} ressources`);
      
      // Ajouter chaque ressource
      data.forEach((resourceData: any) => {
        // Vérifier que les données sont valides
        if (!resourceData.id || !resourceData.type || 
            resourceData.x === undefined || resourceData.y === undefined) {
          console.error("Données de ressource invalides:", resourceData);
          return;
        }
        
        // Ajouter la ressource à l'état local
        this.room.state.resources.onAdd(resourceData, resourceData.id);
      });
    });
    
    // Gestionnaire pour les mises à jour de ressources visibles
    this.room.onMessage("updateVisibleResources", (data) => {
      console.log(`Mise à jour des ressources visibles: ${data.length} ressources`);
      
      // Parcourir les ressources envoyées et ajouter celles qui n'existent pas encore
      data.forEach((resourceData: any) => {
        if (!resourceData.id) return;
        
        // Vérifier si la ressource existe déjà
        if (!this.resourceSprites.has(resourceData.id)) {
          // Ajouter la ressource à l'état local
          this.room.state.resources.onAdd(resourceData, resourceData.id);
        }
      });
    });
    
    // Gestionnaire pour les mises à jour de population
    this.room.onMessage("populationUpdate", (data: { population: number, maxPopulation: number }) => {
      console.log(`Mise à jour de la population: ${data.population}/${data.maxPopulation}`);
      
      // Mettre à jour les données du joueur
      if (this.playerEntity) {
        this.playerEntity.population = data.population;
        this.playerEntity.maxPopulation = data.maxPopulation;
      }
      
      // Émettre un événement pour mettre à jour l'UI
      this.events.emit('updatePopulation', data);
    });
    
    // Gestionnaire pour les ressources produites
    this.room.onMessage("resourceProduced", (data: {
      buildingId: string,
      inputs: { [resource: string]: number },
      outputs: { [resource: string]: number }
    }) => {
      console.log("PRODUCTION REÇUE:", data);
      
      // Mettre à jour les ressources dans l'interface
      this.updateResourcesUI();
      
      // Trouver le bâtiment concerné
      const buildingSprite = this.buildingSprites.get(data.buildingId);
      if (!buildingSprite) {
        console.error(`Sprite du bâtiment non trouvé pour l'ID: ${data.buildingId}`);
        return;
      }
      
      // Afficher des effets visuels pour chaque ressource produite
      let offsetX = 0;
      Object.entries(data.outputs).forEach(([resource, amount]) => {
        console.log(`Affichage de l'effet +${amount} pour ${resource}`);
        
        // Créer un effet +X pour chaque ressource produite
        this.showNumericEffect(`+${amount}`, buildingSprite.x + offsetX, buildingSprite.y - 20, resource);
        offsetX += 15; // Décaler les effets pour éviter qu'ils se superposent
      });
      
      // Effet visuel sur le bâtiment
      this.tweens.add({
        targets: buildingSprite,
        scale: 1.1,
        duration: 200,
        yoyo: true,
        ease: 'Power2',
        onComplete: () => {
          console.log("Animation de production terminée");
        }
      });
    });
    
    // Gestionnaire pour les échecs de production
    this.room.onMessage("productionFailed", (data: {
      buildingId: string,
      reason: string,
      requiredResources: { [resource: string]: number }
    }) => {
      console.log("PRODUCTION ÉCHOUÉE:", data);
      
      // Trouver le bâtiment concerné
      const buildingSprite = this.buildingSprites.get(data.buildingId);
      if (!buildingSprite) return;
      
      // Effet visuel pour montrer l'échec (optionnel)
      this.tweens.add({
        targets: buildingSprite,
        alpha: 0.5,
        duration: 200,
        yoyo: true,
        ease: 'Power2'
      });
    });

    // Écouter l'événement de ressources récupérées lors de la destruction d'un bâtiment
    this.room.onMessage("resourcesRefunded", (data) => {
      console.log("Ressources récupérées:", data);
      
      // Mettre à jour l'affichage des ressources
      this.updateResourcesUI();
      
      // Position pour afficher les effets flottants (position du joueur)
      const x = this.player ? this.player.x : this.cameras.main.width / 2;
      const y = this.player ? this.player.y : this.cameras.main.height / 2;
      
      // Afficher un effet flottant pour chaque ressource récupérée
      let offsetY = 0;
      for (const [resource, amount] of Object.entries(data.refunds)) {
        if (amount && typeof amount === 'number' && amount > 0) {
          this.showNumericEffect(`+${amount}`, x, y - offsetY, resource as string);
          offsetY += 20; // Espacer verticalement les effets
        }
      }
    });

    // Gestionnaire pour l'échec de création d'unité
    this.room.onMessage("unitCreationFailed", (data: {
      reason: string,
      required?: { [resource: string]: number }
    }) => {
      console.log("CRÉATION D'UNITÉ ÉCHOUÉE:", data);
      
      // Afficher un message au joueur
      const x = this.player ? this.player.x : this.cameras.main.width / 2;
      const y = this.player ? this.player.y : this.cameras.main.height / 2;
      
      // Utiliser une couleur rouge pour indiquer l'erreur
      this.showNumericEffect(data.reason, x, y - 20, 'error');
      
      // Si des ressources requises sont spécifiées, les afficher
      if (data.required) {
        let offsetY = 0;
        for (const [resource, amount] of Object.entries(data.required)) {
          const currentAmount = this.playerEntity.resources.get(resource) || 0;
          const missingAmount = amount - currentAmount;
          
          if (missingAmount > 0) {
            this.showNumericEffect(`Manque ${missingAmount} ${resource}`, x, y - 40 - offsetY, 'error');
            offsetY += 20;
          }
        }
      }
    });

    // Gestionnaire pour la création réussie d'unité
    this.room.onMessage("unitCreated", (data: {
      unitId: string,
      type: string,
      position: { x: number, y: number }
    }) => {
      console.log("UNITÉ CRÉÉE:", data);
      
      // Vérifier si cette unité existe déjà (pour éviter les doublons)
      if (!this.unitSprites.has(data.unitId)) {
        // Rechercher le propriétaire de l'unité (propriétaire probable: nous-mêmes)
        const owner = this.room.state.players.get(this.room.sessionId);
        if (owner) {
          // Créer l'unité immédiatement sans attendre la mise à jour d'état
          const unit = {
            x: data.position.x,
            y: data.position.y,
            type: data.type,
            owner: this.room.sessionId
          };
          
          // Créer le sprite pour cette unité
          this.createUnitSprite(unit, data.unitId);
          
          console.log(`Sprite créé immédiatement pour l'unité ${data.unitId}`);
          
          // Effet visuel pour signaler la création
          this.showNumericEffect("✓", data.position.x, data.position.y - 15, 'success');
        }
      } else {
        console.log(`Le sprite pour l'unité ${data.unitId} existe déjà`);
      }
    });
  }
  
  // Crée un sprite pour un autre joueur
  private createPlayerSprite(player, sessionId) {
    if (!player) {
      console.error("Cannot create player sprite: player object is undefined");
      return;
    }
    
    try {
      // Valeurs par défaut en cas de propriétés manquantes
      const x = typeof player.x === 'number' ? player.x : 0;
      const y = typeof player.y === 'number' ? player.y : 0;
      const name = player.name || `Player ${sessionId.substring(0, 4)}`;
      const hue = typeof player.hue === 'number' ? player.hue : 180;
      
      // Log détaillé pour débogage
      console.log(`Création du joueur ${sessionId} avec hue=${hue}`);
      
      // Vérifier si un sprite existe déjà
      const existingData = this.unitSprites.get(sessionId);
      if (existingData) {
        existingData.sprite.destroy();
        if (existingData.nameText) {
          existingData.nameText.destroy();
        }
      }
      
      // Appliquer la couleur
      const color = this.hueToRgb(hue);
      
      // Calculer une version plus foncée pour le contour
      const r = (color >> 16) & 0xFF;
      const g = (color >> 8) & 0xFF;
      const b = color & 0xFF;
      
      const darkerR = Math.max(0, Math.floor(r * 0.6));
      const darkerG = Math.max(0, Math.floor(g * 0.6));
      const darkerB = Math.max(0, Math.floor(b * 0.6));
      
      const darkerColor = (darkerR << 16) | (darkerG << 8) | darkerB;
      
      // Créer un container pour le joueur
      const containerSize = 6; // Taille réduite pour les autres joueurs
      const container = this.add.container(x, y);
      
      // Créer un graphique pour le joueur
      const playerGraphics = this.add.graphics();
      
      // D'abord dessiner le contour
      playerGraphics.fillStyle(darkerColor, 1);
      playerGraphics.fillRect(-containerSize - 1, -containerSize - 1, containerSize * 2 + 2, containerSize * 2 + 2);
      
      // Ensuite dessiner le remplissage
      playerGraphics.fillStyle(color, 1);
      playerGraphics.fillRect(-containerSize, -containerSize, containerSize * 2, containerSize * 2);
      
      // Ajouter le graphique au container
      container.add(playerGraphics);
      container.setDepth(10);
      
      // Créer le texte du nom
      const nameText = this.add.text(
        x,
        y - 12,
        name,
        {
          fontSize: '8px',
          fontFamily: 'Arial, sans-serif', 
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2,
          resolution: 2,
          letterSpacing: 2
        }
      ).setOrigin(0.5).setDepth(10);
      
      // Stocker une référence pour l'identifier facilement
      nameText.setData('playerId', sessionId);

      // Stocker le container avec ses coordonnées cibles pour l'interpolation
      this.unitSprites.set(sessionId, { 
        sprite: container, 
        targetX: x, 
        targetY: y,
        nameText
      });
      
      console.log(`Sprite créé pour le joueur ${sessionId} à la position (${x}, ${y})`);
    } catch (error) {
      console.error("Erreur lors de la création du sprite:", error);
    }
  }
  
  // Gestion du mouvement du joueur
  private handlePlayerMovement() {
    // Vérifie si le joueur et le contrôle clavier sont initialisés
    if (!this.player || !this.cursors || !this.wasdKeys) return;
    
    // Ignorer les mouvements si le joueur est mort
    if (this.isPlayerDead) return;
    
    // Priorité aux entrées clavier sur les mouvements réseau
    if (!this.cursors.left.isDown && !this.cursors.right.isDown && 
        !this.cursors.up.isDown && !this.cursors.down.isDown && 
        !this.wasdKeys.A.isDown && !this.wasdKeys.D.isDown && 
        !this.wasdKeys.W.isDown && !this.wasdKeys.S.isDown) {
      return;
    }
    
    // Calculer la direction du mouvement
    let dx = 0;
    let dy = 0;
    
    // Détection de mouvement horizontal
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) dx += 1;
    
    // Détection de mouvement vertical
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) dy += 1;
    
    // Normalisation du mouvement en diagonale
    if (dx !== 0 && dy !== 0) {
      const length = Math.sqrt(dx * dx + dy * dy);
      dx = dx / length;
      dy = dy / length;
    }
    
    // Calculer la nouvelle position (avec précision subpixel)
    const prevX = this.actualX;
    const prevY = this.actualY;
    
    // Mettre à jour la position avec la précision subpixel
    this.actualX += dx * this.playerSpeed;
    this.actualY += dy * this.playerSpeed;
    
    // Vérifier les collisions
    if (this.isCollisionAt(this.actualX, this.actualY)) {
      // En cas de collision, revenir à la position précédente
      this.actualX = prevX;
      this.actualY = prevY;
    }
    
    // Arrondir pour l'affichage à l'écran (éviter le scintillement)
    const roundedX = Math.round(this.actualX);
    const roundedY = Math.round(this.actualY);
    
    // Mettre à jour la position du container
    this.player.x = roundedX;
    this.player.y = roundedY;
    
    // Centrer la caméra sur le joueur avec des positions arrondies
    this.cameras.main.centerOn(roundedX, roundedY);
    
    // Mettre à jour la position du texte du nom
    const playerNameText = this.children.list.find(
      child => child instanceof Phaser.GameObjects.Text && child.getData('playerId') === 'mainPlayer'
    ) as Phaser.GameObjects.Text;
    
    if (playerNameText) {
      playerNameText.x = roundedX;
      playerNameText.y = roundedY - 12;
    }
  }
  
  // Vérifier si une tuile contient un mur
  private isWallAt(x: number, y: number): boolean {
    // Convertir les coordonnées en pixels en indices de tuiles
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    
    // Vérifier les limites de la carte
    if (tileX < 0 || tileY < 0 || tileX >= this.mapLines[0].length || tileY >= this.mapLines.length) {
      return true; // Collision avec les limites de la carte
    }
    
    // Vérifier si c'est un mur (#)
    return this.mapLines[tileY][tileX] === '#';
  }
  
  private isCollisionAt(x: number, y: number): boolean {
    // Vérifier d'abord les murs
    if (this.isWallAt(x, y)) {
      return true;
    }
    
    // Vérifier les bâtiments
    if (this.room) {
      const tileX = Math.floor(x / TILE_SIZE);
      const tileY = Math.floor(y / TILE_SIZE);
      
      for (const [_, building] of this.room.state.buildings.entries()) {
        const buildingTileX = Math.floor(building.x / TILE_SIZE);
        const buildingTileY = Math.floor(building.y / TILE_SIZE);
        
        // Si c'est un mur ou un bâtiment avec collision sur toute la case
        if (building.fullTileCollision && buildingTileX === tileX && buildingTileY === tileY) {
          return true;
        }
        
        // Pour les autres bâtiments, on considère une collision circulaire au centre
        const buildingCenterX = building.x + TILE_SIZE/2;
        const buildingCenterY = building.y + TILE_SIZE/2;
        const distance = Phaser.Math.Distance.Between(x, y, buildingCenterX, buildingCenterY);
        
        if (distance < 12) { // Collision avec une partie centrale du bâtiment
          return true;
        }
      }
    }
    
    // Rayon du joueur pour la détection de collision
    const playerRadius = 3;
    
    // Parcourir toutes les ressources
    for (const [resourceId, resourceSprite] of this.resourceSprites.entries()) {
      // Récupérer les coordonnées et le type de la ressource
      const resourceX = resourceSprite.x;
      const resourceY = resourceSprite.y;
      const resourceType = resourceSprite.texture.key;
      
      // Détecter les collisions avec des formes spécifiques selon le type de ressource
      switch (resourceType) {
        case 'gold':
          // L'or a une forme circulaire plus petite (centre uniquement)
          if (Phaser.Math.Distance.Between(x, y, resourceX, resourceY) < 14) {
            return true;
          }
          break;
          
        case 'wood':
          // Les arbres ont un tronc (rectangle) et un feuillage (cercle)
          // Vérifier le tronc (rectangle étroit au centre)
          if (x > resourceX - 4 && x < resourceX + 4 && 
              y > resourceY - 4 && y < resourceY + 16) {
            return true;
          }
          
          // Vérifier le feuillage (cercle au-dessus)
          if (Phaser.Math.Distance.Between(x, y, resourceX, resourceY - 10) < 16) {
            return true;
          }
          break;
          
        case 'stone':
          // Les pierres ont une forme octogonale
          // On utilise une approximation avec plusieurs tests de points
          
          // Test central - zone principale de la pierre
          if (Phaser.Math.Distance.Between(x, y, resourceX, resourceY) < 14) {
            return true;
          }
          
          // Tests sur les côtés de l'octogone
          const corners = [
            {dx: -11, dy: -4}, {dx: -6, dy: -11}, 
            {dx: 6, dy: -11}, {dx: 11, dy: -4},
            {dx: 11, dy: 4}, {dx: 6, dy: 11}, 
            {dx: -6, dy: 11}, {dx: -11, dy: 4}
          ];
          
          // Vérifier si le point est à l'intérieur du polygone octogonal
          let inside = false;
          for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
            const xi = resourceX + corners[i].dx;
            const yi = resourceY + corners[i].dy;
            const xj = resourceX + corners[j].dx;
            const yj = resourceY + corners[j].dy;
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          
          if (inside) {
            return true;
          }
          break;
          
        default:
          // Fallback pour les autres types de ressources
          if (Phaser.Math.Distance.Between(x, y, resourceX, resourceY) < 16) {
            return true;
          }
      }
    }
    
    // Aucune collision détectée
    return false;
  }
  
  // Mise à jour de la position de l'outil
  private updateTool() {
    if (!this.player || !this.tool) return;
    
    // Calculer l'angle vers la souris
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    
    const angle = Phaser.Math.Angle.Between(
      this.actualX, 
      this.actualY,
      worldPoint.x,
      worldPoint.y
    );
    
    // Positionner l'outil devant le joueur avec précision subpixel
    const distance = 12; // Réduit de 20 à 12 pour rapprocher la pioche
    const toolX = this.actualX + Math.cos(angle) * distance;
    const toolY = this.actualY + Math.sin(angle) * distance;
    this.tool.setPosition(toolX, toolY);
    
    // Rotation avec décalage pour orientation correcte
    const angleOffset = Math.PI/3;
    this.tool.setRotation(angle + angleOffset);
    
    // Afficher/cacher l'outil selon le mode
    this.tool.setVisible(this.isToolMode);
  }
  
  // Mise à jour du curseur selon le mode
  private updateCursor() {
    if (this.isToolMode) {
      this.input.setDefaultCursor('url(/cursors/pickaxe.cur), pointer');
    } else {
      this.input.setDefaultCursor('url(/cursors/hand.cur), pointer');
      
      // Si on passe en mode main, envoyer immédiatement la position du curseur
      if (this.room) {
        const pointer = this.input.activePointer;
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.room.send("targetCursorPosition", {
          x: worldPoint.x,
          y: worldPoint.y,
          isTargetMode: true
        });
      }
    }
  }
  
  // Mise à jour des autres joueurs avec interpolation
  private updateOtherPlayers(delta: number) {
    this.unitSprites.forEach((data, sessionId) => {
      if (sessionId === this.room?.sessionId) return; // Ignorer notre propre joueur
      
      const { sprite, targetX, targetY, nameText } = data;
      
      // Ignorer les mises à jour de position pour les joueurs morts
      if (sprite.getData('isDead') === true) {
        // Mettre à jour uniquement la position du texte "MORT" si présent
        const deadText = sprite.getData('deadText');
        if (deadText && deadText.setPosition) {
          deadText.setPosition(sprite.x, sprite.y - 30);
        }
        return;
      }
      
      // Calculer le facteur d'interpolation basé sur delta pour des mouvements constants
      const lerpFactor = Math.min(this.LERP_FACTOR * delta / 16, 1);
      
      // Appliquer l'interpolation pour un mouvement fluide en subpixels
      sprite.x = Phaser.Math.Linear(sprite.x, targetX, lerpFactor);
      sprite.y = Phaser.Math.Linear(sprite.y, targetY, lerpFactor);
      
      // Mettre à jour la position du nom s'il existe
      if (nameText) {
        nameText.setPosition(sprite.x, sprite.y - 22);
      }
    });
  }
  
  // Synchroniser la position avec le serveur
  private synchronizePlayerPosition() {
    if (!this.room) return;
    
    // Ne pas synchroniser si le joueur est mort
    if (this.isPlayerDead) return;
    
    // Envoyer les coordonnées actuelles (précises) au serveur
    console.log(`Envoi position au serveur: (${this.actualX}, ${this.actualY})`);
    
    this.room.send("move", {
      x: this.actualX,
      y: this.actualY
    });
  }
  
  // Méthode de chargement de la carte
  private loadMap() {
    this.mapData = this.cache.text.get('map');
    console.log("Données de la carte chargées:", this.mapData ? "OUI" : "NON", this.mapData ? `(${this.mapData.length} caractères)` : "");
    
    if (!this.mapData) {
      console.error("Impossible de charger la carte");
      return;
    }
    
    // Analyser le contenu du fichier map
    this.debugMapContent(this.mapData);
    
    // Stocker les lignes pour le chargement dynamique
    this.mapLines = this.mapData.split('\n');
    console.log(`Carte divisée en ${this.mapLines.length} lignes`);
    
    // Vérifier que les sprites sont chargés
    const grassLoaded = this.textures.exists('grass');
    const wallLoaded = this.textures.exists('wall');
    const woodLoaded = this.textures.exists('wood');
    const stoneLoaded = this.textures.exists('stone');
    const goldLoaded = this.textures.exists('gold');
    
    console.log("Sprites chargés:", {
      grass: grassLoaded,
      wall: wallLoaded,
      wood: woodLoaded,
      stone: stoneLoaded,
      gold: goldLoaded
    });
    
    if (!grassLoaded || !wallLoaded || !woodLoaded || !stoneLoaded || !goldLoaded) {
      console.error("Certains sprites nécessaires ne sont pas chargés");
      return;
    }
  }
  
  // Log le contenu du fichier map pour débogage
  private debugMapContent(mapData: string, maxChars: number = 500) {
    console.log("Début du fichier map:");
    console.log(mapData.substring(0, maxChars));
    
    // Compter les murs (#)
    const wallCount = (mapData.match(/#/g) || []).length;
    console.log(`Nombre de murs (#) dans la carte: ${wallCount}`);
    
    // Vérifier le premier et dernier caractère de chaque ligne
    const lines = mapData.split('\n');
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    console.log(`Première ligne: ${firstLine.substring(0, 50)}${firstLine.length > 50 ? '...' : ''}`);
    console.log(`Dernière ligne: ${lastLine.substring(0, 50)}${lastLine.length > 50 ? '...' : ''}`);
  }
  
  // Action de sélection
  private handleSelectionAction(pointer) {
    // À implémenter: sélection d'unités et de bâtiments
  }
  
  // Convertir une teinte en couleur RGB
  private hueToRgb(hue: number): number {
    console.log('=== Conversion HSV -> RGB ===');
    console.log(`Teinte d'entrée: ${hue}`);
    
    // Normaliser la teinte entre 0 et 360
    hue = hue % 360;
    if (hue < 0) hue += 360;
    console.log(`Teinte normalisée: ${hue}`);

    // Convertir en HSV avec saturation=1 et value=1
    const c = 1; // c = s * v
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = 0;

    let r = 0, g = 0, b = 0;
    if (hue >= 0 && hue < 60) {
      [r, g, b] = [c, x, 0];
    } else if (hue >= 60 && hue < 120) {
      [r, g, b] = [x, c, 0];
    } else if (hue >= 120 && hue < 180) {
      [r, g, b] = [0, c, x];
    } else if (hue >= 180 && hue < 240) {
      [r, g, b] = [0, x, c];
    } else if (hue >= 240 && hue < 300) {
      [r, g, b] = [x, 0, c];
    } else {
      [r, g, b] = [c, 0, x];
    }

    // Convertir en RGB 0-255
    const red = Math.round((r + m) * 255);
    const green = Math.round((g + m) * 255);
    const blue = Math.round((b + m) * 255);

    const color = (red << 16) | (green << 8) | blue;
    console.log(`Composantes RGB: R=${red}, G=${green}, B=${blue}`);
    console.log(`Couleur finale: 0x${color.toString(16)}`);
    
    return color;
  }
  
  // Se connecter au serveur Colyseus
  async connectToServer(playerName: string, playerHue: number) {
    try {
      console.log(`Tentative de connexion au serveur avec nom: "${playerName}", hue: ${playerHue}`);
      
      // Normaliser la teinte entre 0 et 360
      playerHue = Math.abs(playerHue % 360);
      
      this.room = await this.client.joinOrCreate('game_room', {
        name: playerName,
        hue: playerHue
      });
      
      console.log(`Connecté au serveur avec ID: ${this.room.sessionId}, teinte envoyée: ${playerHue}`);
      
      // Configuration des gestionnaires d'événements Colyseus
      this.setupNetworkHandlers();
      
      return true;
    } catch (e) {
      console.error("Erreur de connexion:", e);
      return false;
    }
  }
  
  // Méthode pour obtenir une tuile du pool ou en créer une nouvelle
  private getTileFromPool(texture: string): Phaser.GameObjects.Image {
    let tile: Phaser.GameObjects.Image;
    
    if (this.tilePool.length > 0) {
      tile = this.tilePool.pop() as Phaser.GameObjects.Image;
      tile.setTexture(texture);
      tile.setVisible(true);
    } else {
      tile = this.add.image(0, 0, texture);
    }
    
    // Toujours désactiver l'interpolation sur les textures
    tile.setPipelineData('antialiasTexture', false);
    
    return tile;
  }
  
  // Méthode pour nettoyer les tuiles qui ne sont plus visibles
  private cleanupDistantTiles(currentTime: number) {
    // Ne pas nettoyer trop fréquemment
    if (currentTime - this.lastCleanupTime < this.cleanupInterval) return;
    this.lastCleanupTime = currentTime;
    
    if (!this.player) return;
    
    console.log("Nettoyage des tuiles éloignées");
    
    // Calculer les coordonnées du chunk sur lequel se trouve le joueur
    const playerChunkX = Math.floor(this.player.x / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.player.y / (this.tileSize * this.CHUNK_SIZE));
    
    // Distance maximale pour le nettoyage (plus grande que renderDistance pour éviter les nettoyages fréquents)
    const cleanupDistance = this.renderDistance + 1;
    
    // Parcourir toutes les tuiles chargées
    this.tileLayers.forEach((tile, key) => {
      // Extraire les coordonnées de la clé (format "x,y")
      const [tileX, tileY] = key.split(',').map(Number);
      
      // Calculer le chunk de cette tuile
      const tileChunkX = Math.floor(tileX / this.CHUNK_SIZE);
      const tileChunkY = Math.floor(tileY / this.CHUNK_SIZE);
      
      // Calculer la distance en chunks au joueur
      const distance = Math.max(
        Math.abs(tileChunkX - playerChunkX), 
        Math.abs(tileChunkY - playerChunkY)
      );
      
      // Si la tuile est trop éloignée, la supprimer
      if (distance > cleanupDistance) {
        // Ajouter la tuile au pool pour réutilisation
        if (this.tilePool.length < this.maxTilePoolSize) {
          tile.setVisible(false);
          this.tilePool.push(tile);
        } else {
          tile.destroy();
        }
        
        // Supprimer la référence
        this.tileLayers.delete(key);
        this.loadedTiles.delete(key);
      }
    });
  }

  // Pour toute référence restante à updateVisibleTiles
  private updateVisibleTiles() {
    // Redirige vers la nouvelle méthode
    const playerChunkX = Math.floor(this.actualX / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.actualY / (this.tileSize * this.CHUNK_SIZE));
    this.updateVisibleChunks(playerChunkX, playerChunkY);
  }

  // Méthode de chargement de la carte par chunks
  private updateVisibleChunks(playerChunkX: number, playerChunkY: number) {
    console.log(`Mise à jour des chunks visibles autour de (${playerChunkX}, ${playerChunkY})`);
    
    // Calculer les chunks à charger
    const chunksToLoad = new Set<string>();
    for (let dy = -this.renderDistance; dy <= this.renderDistance; dy++) {
      for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
        const chunkX = playerChunkX + dx;
        const chunkY = playerChunkY + dy;
        const chunkKey = `${chunkX},${chunkY}`;
        chunksToLoad.add(chunkKey);
        
        // Si le chunk n'est pas déjà chargé, le charger
        if (!this.loadedChunks.has(chunkKey)) {
          this.loadChunk(chunkX, chunkY);
          this.loadedChunks.add(chunkKey);
        }
      }
    }
    
    // Décharger les chunks trop éloignés
    for (const chunkKey of Array.from(this.loadedChunks)) {
      if (!chunksToLoad.has(chunkKey)) {
        this.unloadChunk(chunkKey);
        this.loadedChunks.delete(chunkKey);
      }
    }
    
    console.log(`Chunks chargés: ${this.loadedChunks.size}`);
  }

  // Charger un chunk spécifique
  private loadChunk(chunkX: number, chunkY: number) {
    console.log(`Chargement du chunk (${chunkX}, ${chunkY})`);
    const startTileX = chunkX * this.CHUNK_SIZE;
    const startTileY = chunkY * this.CHUNK_SIZE;
    
    // Charger les tuiles du chunk
    for (let y = 0; y < this.CHUNK_SIZE; y++) {
      const worldTileY = startTileY + y;
      if (worldTileY < 0 || worldTileY >= this.mapLines.length) continue;
      
      for (let x = 0; x < this.CHUNK_SIZE; x++) {
        const worldTileX = startTileX + x;
        if (worldTileX < 0 || worldTileX >= this.mapLines[worldTileY].length) continue;
        
        // Utiliser notre méthode existante de création de tuile
        this.createTileAt(worldTileX, worldTileY);
      }
    }
  }

  // Décharger un chunk
  private unloadChunk(chunkKey: string) {
    const [chunkX, chunkY] = chunkKey.split(',').map(Number);
    const startTileX = chunkX * this.CHUNK_SIZE;
    const startTileY = chunkY * this.CHUNK_SIZE;
    
    // Supprimer les tuiles du chunk
    for (let y = 0; y < this.CHUNK_SIZE; y++) {
      const worldTileY = startTileY + y;
      for (let x = 0; x < this.CHUNK_SIZE; x++) {
        const worldTileX = startTileX + x;
        const tileKey = `${worldTileX},${worldTileY}`;
        
        const tile = this.tileLayers.get(tileKey);
        if (tile) {
          if (this.tilePool.length < this.maxTilePoolSize) {
            tile.setVisible(false);
            this.tilePool.push(tile);
          } else {
            tile.destroy();
          }
          this.tileLayers.delete(tileKey);
          this.loadedTiles.delete(tileKey);
        }
      }
    }
  }

  // Créer une tuile à une position spécifique
  private createTileAt(worldTileX: number, worldTileY: number) {
    const tileKey = `${worldTileX},${worldTileY}`;
    if (this.loadedTiles.has(tileKey)) return;
    
    // Vérifier si les coordonnées sont valides
    if (worldTileY < 0 || worldTileY >= this.mapLines.length) return;
    const line = this.mapLines[worldTileY];
    if (!line || worldTileX < 0 || worldTileX >= line.length) return;
    
    const tileChar = line[worldTileX];
    
    const centerX = Math.round(worldTileX * this.tileSize + this.tileSize/2);
    const centerY = Math.round(worldTileY * this.tileSize + this.tileSize/2);
    
    // Créer la tuile de base (herbe)
    let randomGrass = 'grass';
    const grassRandom = Math.random() * 12;
    if (grassRandom > 10) {
      randomGrass = grassRandom > 11 ? 'grass3' : 'grass2';
    }
    
    const grassTile = this.getTileFromPool(randomGrass);
    grassTile.setPosition(centerX, centerY);
    grassTile.setDepth(1);
    grassTile.setOrigin(0.5);
    grassTile.setVisible(true);
    
    this.tileLayers.set(tileKey, grassTile);
    this.loadedTiles.add(tileKey);
    
    // Ajouter des éléments spécifiques basés sur la carte
    if (tileChar === '#') {
      const wall = this.createTile('wall', centerX, centerY);
      wall.setDepth(5);
    }
  }
  
  // Mise à jour de la méthode update pour arrondir la position de la caméra
  private snapCameraToGrid() {
    if (!this.cameras.main || !this.player) return;
    
    // Forcer la position de la caméra à être alignée sur des pixels entiers
    this.cameras.main.scrollX = Math.floor(this.cameras.main.scrollX);
    this.cameras.main.scrollY = Math.floor(this.cameras.main.scrollY);
  }

  private createResourcesUI() {
    console.log("=== Création de l'interface des ressources ===");
    
    // Créer un container pour l'UI des ressources
    const padding = 10; // Espace entre les bords
    
    // Modification: Utiliser des coordonnées fixes au lieu de celles de la caméra
    // qui pourraient ne pas être correctement initialisées
    const uiY = window.innerHeight - 110;
    
    // Vérifier les dimensions du jeu
    console.log(`Dimensions de la fenêtre: ${window.innerWidth} x ${window.innerHeight}`);
    
    // Créer directement les éléments dans la scène au lieu d'utiliser un container
    // qui pourrait avoir des problèmes d'affichage
    
    // Créer le fond
    const background = this.add.graphics();
    background.fillStyle(0x000000, 0.7);  // Noir semi-transparent
    background.fillRoundedRect(padding, uiY, 160, 90, 8); // Rectangle arrondi
    background.lineStyle(1, 0x444444);
    background.strokeRoundedRect(padding, uiY, 160, 90, 8);
    background.setScrollFactor(0);
    background.setDepth(100);
    
    console.log("Fond créé à la position", padding, uiY);
    
    // Ajouter un titre
    const titleText = this.add.text(
      padding + 80, 
      uiY + 10, 
      "Ressources", 
      { 
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold'
      }
    ).setOrigin(0.5, 0)
     .setScrollFactor(0)
     .setDepth(100);
    
    console.log("Titre ajouté à la position", padding + 80, uiY + 10);
    
    // Définir les ressources avec leurs emojis
    const resources = [
      { type: 'gold', emoji: '💰', initialValue: 0, y: uiY + 30 },
      { type: 'wood', emoji: '🌲', initialValue: 0, y: uiY + 46 },
      { type: 'stone', emoji: '🪨', initialValue: 0, y: uiY + 62 },
      { type: 'iron', emoji: '⚙️', initialValue: 0, y: uiY + 78 }
    ];
    
    // Nouveau container pour stocker les références aux textes
    this.resourcesUI = {
      container: null, // On n'utilise plus de container
      texts: new Map()
    };
    
    // Ajouter chaque ressource à l'interface
    resources.forEach(resource => {
      const text = this.add.text(
        padding + 15, 
        resource.y, 
        `${resource.emoji} ${resource.type}: ${resource.initialValue}`, 
        { 
          fontSize: '14px',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          shadow: {
            offsetX: 1,
            offsetY: 1,
            color: '#000000',
            blur: 2,
            fill: true
          }
        }
      ).setScrollFactor(0)
       .setDepth(100);
      
      this.resourcesUI.texts.set(resource.type, text);
    });
    
    console.log(`${resources.length} ressources ajoutées`);
    
    // Mettre à jour les ressources initiales
    this.updateResourcesUI();
    
    console.log("=== Fin de la création de l'interface des ressources ===");
  }
  
  private onResize() {
    // Repositionner l'UI des ressources lorsque la fenêtre est redimensionnée
    if (this.resourcesUI.container) {
      this.resourcesUI.container.setPosition(10, this.cameras.main.height - 110);
    }
  }
  
  private updateResourcesUI() {
    // Avec la UIScene, nous n'avons plus besoin de cette méthode
    // Transmettre plutôt les ressources à la scène UI
    
    // Récupérer les ressources du joueur si disponibles, sinon utiliser des valeurs par défaut
    let resources = {
      gold: 0,
      wood: 0,
      stone: 0,
      iron: 0,
      coal: 0,
      steel: 0
    };
    
    // Si le playerEntity existe et a des ressources, les utiliser
    if (this.playerEntity && this.playerEntity.resources) {
      // Convertir le MapSchema en objet JavaScript
      const playerResources = this.playerEntity.resources;
      resources.gold = playerResources.get('gold') || 0;
      resources.wood = playerResources.get('wood') || 0;
      resources.stone = playerResources.get('stone') || 0;
      resources.iron = playerResources.get('iron') || 0;
      resources.coal = playerResources.get('coal') || 0;
      resources.steel = playerResources.get('steel') || 0;
      
      console.log('Ressources du joueur mises à jour:', resources);
    } else {
      console.log('Utilisation de ressources par défaut, playerEntity non disponible');
    }
    
    // Émettre un événement pour que la UIScene puisse mettre à jour l'affichage
    this.events.emit('updateResources', resources);
  }

  // Gestionnaire d'événement quand le joueur appuie sur la souris
  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    // Si le joueur est en mode outil, gérer le minage
    if (this.isToolMode) {
      // Activer le minage
      this.isMiningActive = true;
      
      // Démarrer immédiatement l'animation
      this.animatePickaxe();
    } 
    // Si en mode main (Tab), commencer à vérifier pour un clic prolongé
    else {
      // Enregistrer le moment où le clic a commencé
      this.longPressTimer = Date.now();
      
      // Calculer les coordonnées mondiales du clic
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      
      // Stocker la position cible
      this.longPressTarget = { x: worldPoint.x, y: worldPoint.y };
      
      // Écouter l'événement pointermove pour mettre à jour la position cible pendant un clic prolongé
      this.input.on('pointermove', this.handlePointerMove, this);
    }
  }
  
  // Nouvelle méthode pour gérer le déplacement du pointeur pendant un clic
  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.isToolMode && this.longPressTarget && this.input.activePointer.isDown) {
      // Mettre à jour la position cible avec les nouvelles coordonnées
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.longPressTarget.x = worldPoint.x;
      this.longPressTarget.y = worldPoint.y;
      
      // Si on est déjà en mode clic prolongé, envoyer immédiatement la nouvelle position
      if (this.isLongPressing && this.room) {
        this.room.send("unitMoveTarget", {
          x: this.longPressTarget.x,
          y: this.longPressTarget.y,
          isMoving: true
        });
      }
    }
  }

  // Gestionnaire d'événement quand le joueur relâche la souris
  private handlePointerUp() {
    // Si le joueur était en mode outil, désactiver le minage
    if (this.isToolMode) {
      // Désactiver le minage
      this.isMiningActive = false;
    } 
    // Si en mode main (Tab)
    else if (this.longPressTarget) {
      // Nettoyer l'écouteur d'événement pointermove
      this.input.off('pointermove', this.handlePointerMove, this);
      
      // Si c'était un clic prolongé, informer le serveur de l'arrêt
      if (this.isLongPressing && this.room) {
        this.room.send("unitMoveTarget", {
          x: 0,
          y: 0,
          isMoving: false
        });
        this.isLongPressing = false;
      }
      
      // Réinitialiser les variables de suivi
      this.longPressTarget = null;
      this.longPressTimer = 0;
    }
  }
  
  // Animation de pioche plus visible et naturelle
  private animatePickaxe() {
    if (!this.tool || !this.isMiningActive) return;
    
    // Si une animation est déjà en cours, ne pas la redémarrer
    if (this.tool.getData('animating')) return;
    
    // Marquer comme en cours d'animation
    this.tool.setData('animating', true);
    
    // Point d'origine (point de pivot) pour l'animation
    const pivotX = this.actualX;
    const pivotY = this.actualY;
    
    // Angle vers la cible (souris ou ressource)
    const pointerX = this.input.activePointer.worldX;
    const pointerY = this.input.activePointer.worldY;
    const targetAngle = Phaser.Math.Angle.Between(pivotX, pivotY, pointerX, pointerY);
    
    // Rotation de base de la pioche (vers le pointeur)
    this.tool.setRotation(targetAngle);
    
    // Calculer la position de départ de la pioche (légèrement décalée du joueur)
    const offsetDistance = 10; // Distance en pixels
    const offsetX = Math.cos(targetAngle) * offsetDistance;
    const offsetY = Math.sin(targetAngle) * offsetDistance;
    
    // Stocker l'offset dans les données de l'outil pour l'utiliser dans updateToolAnimation
    this.tool.setData('offsetX', offsetX);
    this.tool.setData('offsetY', offsetY);
    
    // Réinitialiser les données d'animation
    this.tool.setData('animationStep', 0);  // Étape d'animation actuelle
    this.tool.setData('targetAngle', targetAngle);  // Angle ciblé
    this.tool.setData('animationTime', 0);  // Temps d'animation écoulé
    this.tool.setData('animationDuration', 600);  // Durée totale d'animation (ms) - ralentie à 600ms
    
    // EFFET VISUEL: Ajouter un flash léger au début de l'animation
    this.tool.setTint(0xffffbb);
    this.tweens.add({
      targets: this.tool,
      tint: 0xffffff,
      duration: 250, // Prolonger la durée du flash
      ease: 'Linear'
    });
  }
  
  // Mise à jour de l'animation de l'outil frame par frame
  private updateToolAnimation(time: number, delta: number) {
    if (!this.tool || !this.isMiningActive) return;
    
    // Vérifier si on est en animation
    if (!this.tool.getData('animating')) return;
    
    // Augmenter le compteur de temps
    let animTime = this.tool.getData('animationTime') || 0;
    animTime += delta;
    this.tool.setData('animationTime', animTime);
    
    // Récupérer les données d'animation
    const duration = this.tool.getData('animationDuration');
    const targetAngle = this.tool.getData('targetAngle');
    const offsetX = this.tool.getData('offsetX') || 0;
    const offsetY = this.tool.getData('offsetY') || 0;
    
    // Calculer la progression (0 à 1)
    const progress = Math.min(1, animTime / duration);
    
    // Calculer l'angle actuel selon la courbe d'animation
    let currentRotation;
    
    if (progress < 0.4) {  // Phase 1 rallongée (0-40% du temps)
      // Phase 1: Lever la pioche en arrière
      const phase1Progress = progress / 0.4;
      const easeBack = this.easeInOutQuad(phase1Progress);
      currentRotation = targetAngle - Math.PI/3 * easeBack; // Angle plus prononcé
      
      // Augmenter légèrement l'échelle pendant la phase de préparation
      this.tool.setScale(1.0 + 0.15 * easeBack);
    } else if (progress < 0.6) {  // Phase 2 rallongée (40-60% du temps)
      // Phase 2: Frapper vers l'avant rapidement
      const phase2Progress = (progress - 0.4) / 0.2;
      const easeStrike = this.easeInCubic(phase2Progress);
      currentRotation = targetAngle - Math.PI/3 + Math.PI/2 * easeStrike; // Rotation plus forte
      
      // Réduire légèrement l'échelle pendant la frappe pour donner un sentiment d'impact
      this.tool.setScale(1.15 - 0.25 * easeStrike);
    } else if (progress < 1) {  // Phase 3 (60-100% du temps)
      // Phase 3: Retour à la position normale
      const phase3Progress = (progress - 0.6) / 0.4;
      const easeReturn = this.easeOutBack(phase3Progress);
      currentRotation = targetAngle + Math.PI/6 - Math.PI/6 * easeReturn;
      
      // Revenir à l'échelle normale
      this.tool.setScale(0.9 + 0.1 * easeReturn);
    } else {
      // Animation terminée
      currentRotation = targetAngle;
      this.tool.setScale(1.0);
      this.tool.setData('animating', false);
      
      // Recommencer l'animation si on continue de miner
      if (this.isMiningActive) {
        this.animatePickaxe();
      }
    }
    
    // Appliquer la rotation
    if (this.tool) {
      this.tool.setRotation(currentRotation);
      
      // Appliquer la position avec l'offset
      if (this.player) {
        // Calculer un offset dynamique qui varie selon la phase de l'animation
        let dynamicOffsetMultiplier = 1.0;
        
        // Pendant la phase de frappe, augmenter l'offset pour accentuer le mouvement
        if (progress > 0.4 && progress < 0.6) {
          dynamicOffsetMultiplier = 1.5;
        }
        
        // EFFET VISUEL: Ajouter un léger tremblement pendant la phase de frappe
        if (progress > 0.4 && progress < 0.6) {
          const shakeIntensity = 0.8; // Tremblement plus prononcé
          this.tool.x = this.player.x + offsetX * dynamicOffsetMultiplier + Math.random() * shakeIntensity - shakeIntensity/2;
          this.tool.y = this.player.y + offsetY * dynamicOffsetMultiplier + Math.random() * shakeIntensity - shakeIntensity/2;
        } else {
          this.tool.x = this.player.x + offsetX * dynamicOffsetMultiplier;
          this.tool.y = this.player.y + offsetY * dynamicOffsetMultiplier;
        }
      }
    }
  }
  
  // Fonctions d'accélération pour des animations plus naturelles
  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  
  private easeInCubic(t: number): number {
    return t * t * t;
  }
  
  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  
  // Mettre à jour l'animation de récolte
  private updateMining(time: number) {
    // Vérifier si le joueur est en train de miner (a cliqué)
    if (!this.isMiningActive) {
      // Si le joueur ne mine pas, désactiver l'état de récolte
      this.isHarvesting = false;
      this.harvestTarget = null;
      return;
    }
    
    // Vérifier s'il y a une ressource sous la pioche
    const resourceHit = this.checkToolResourceCollision();
    
    // Si on touche une ressource
    if (resourceHit) {
      // Activer l'état de récolte
      this.isHarvesting = true;
      this.harvestTarget = resourceHit;
      
      // Vérifier si on peut collecter une ressource (cooldown)
      if (time - this.miningConfig.lastCollectTime >= this.miningConfig.cooldown) {
        // Collecter la ressource
        this.collectResource(resourceHit);
        this.miningConfig.lastCollectTime = time;
      }
    } else {
      // Si on ne touche plus de ressource, désactiver l'état de récolte
      this.isHarvesting = false;
      this.harvestTarget = null;
    }
  }
  
  // Collecter une ressource
  private collectResource(resource: { id: string, type: string }) {
    // Vérifier si la ressource existe
    const resourceSprite = this.resourceSprites.get(resource.id);
    if (!resourceSprite) return;
    
    // Vérifier si la ressource n'est pas déjà épuisée
    const amount = resourceSprite.getData('amount');
    if (amount <= 0) return;
    
    // Envoyer un message au serveur pour récolter
    if (this.room) {
      this.room.send("harvest", {
        resourceId: resource.id,
        type: resource.type
      });
      
      // Ajouter l'effet de tremblement
      this.addShakeEffect(resourceSprite, 0.5);
      
      // Afficher l'effet +1
      this.showNumericEffect('+1', resourceSprite.x, resourceSprite.y, resource.type);
    }
  }
  
  // Initialisation des écouteurs d'événements pour les ressources
  private initializeResourceListeners() {
    if (!this.room) return;

    // Mise à jour d'une ressource
    this.room.onMessage("resourceUpdate", (data: {
      resourceId: string,
      amount: number,
      playerId: string,
      resourceType: string,
      playerResources?: {[key: string]: number}
    }) => {
      const resourceSprite = this.resourceSprites.get(data.resourceId);
      if (resourceSprite) {
        resourceSprite.setData('amount', data.amount);
        
        // Si c'est nous qui avons récolté, mettre à jour l'UI
        if (data.playerId === this.room.sessionId) {
          // Mise à jour directe des ressources du joueur si reçues du serveur
          if (data.playerResources && this.playerEntity) {
            // Mettre à jour la ressource spécifique
            Object.entries(data.playerResources).forEach(([type, amount]) => {
              // Utiliser la méthode set du MapSchema existant
              if (this.playerEntity.resources) {
                this.playerEntity.resources.set(type, amount);
              }
            });
            
            console.log('Ressources du joueur mises à jour depuis le serveur:', data.playerResources);
          }
          
          // Mettre à jour l'UI avec les ressources actuelles
          this.updateResourcesUI();
        }
      }
    });

    // Ressource épuisée
    this.room.onMessage("resourceDepleted", (data: {
      resourceId: string,
      respawnTime: number
    }) => {
      const resourceSprite = this.resourceSprites.get(data.resourceId);
      if (resourceSprite) {
        // Effet visuel pour l'épuisement
        this.tweens.add({
          targets: resourceSprite,
          alpha: 0.5,
          duration: 500,
          ease: 'Power2'
        });
        
        // Mettre à jour l'état
        resourceSprite.setData('amount', 0);
        resourceSprite.setData('isRespawning', true);
      }
    });

    // Réapparition d'une ressource
    this.room.onMessage("resourceRespawned", (data: {
      resourceId: string,
      amount: number
    }) => {
      const resourceSprite = this.resourceSprites.get(data.resourceId);
      if (resourceSprite) {
        // Effet visuel pour la réapparition
        this.tweens.add({
          targets: resourceSprite,
          alpha: 1,
          duration: 500,
          ease: 'Power2'
        });
        
        // Mettre à jour l'état
        resourceSprite.setData('amount', data.amount);
        resourceSprite.setData('isRespawning', false);
      }
    });
  }

  // Création d'une ressource
  private createResource(type: string, x: number, y: number): Phaser.GameObjects.Sprite {
    console.log(`Création d'une ressource de type ${type} à la position (${x}, ${y})`);
    
    const sprite = this.add.sprite(x, y, type);
    sprite.setData('type', type);
    sprite.setData('amount', this.miningConfig.resourceAmounts[type] || 100);
    sprite.setData('isRespawning', false);
    
    // Définir la profondeur pour s'assurer que la ressource est visible
    sprite.setDepth(5);
    
    // Ajouter une interaction au clic
    sprite.setInteractive();
    
    // Vérifier que le sprite a été créé correctement
    if (!sprite.texture || sprite.texture.key !== type) {
      console.error(`Erreur: La texture ${type} n'a pas été chargée correctement`);
    } else {
      console.log(`Ressource créée avec succès: ${type} (${sprite.width}x${sprite.height})`);
    }
    
    return sprite;
  }
  
  // Faire disparaître une ressource épuisée
  private depleteResource(sprite: Phaser.GameObjects.Sprite, resourceId: string) {
    // Désactiver l'interactivité pendant l'animation
    sprite.disableInteractive();
    
    // Animation de disparition
    this.tweens.add({
      targets: sprite,
      alpha: 0,
      scale: 0.8,
      duration: 1000,
      ease: 'Power1',
      onComplete: () => {
        // Supprimer la ressource une fois l'animation terminée
        sprite.destroy();
        this.resourceSprites.delete(resourceId);
      }
    });
  }
  
  // Afficher un effet numérique flottant
  private showNumericEffect(text: string, x: number, y: number, type: string = '') {
    // Ne plus dépendre du groupe numericEffects
    console.log(`Création d'un effet numérique: ${text} à (${x}, ${y}) de type ${type}`);
    
    const color = type === 'gold' ? '#FFD700' : 
                  type === 'wood' ? '#8B4513' : 
                  type === 'stone' ? '#808080' : 
                  type === 'iron' ? '#C0C0C0' :
                  type === 'coal' ? '#333333' :
                  type === 'steel' ? '#71797E' :
                  '#FFFFFF';

    const effect = this.add.text(x, y - 20, text, {
      fontSize: '16px',
      color: color,
      stroke: '#000000',
      strokeThickness: 2,
      fontStyle: 'bold'
    });
    effect.setOrigin(0.5);
    effect.setDepth(100);

    // Ajouter une animation plus visible
    this.tweens.add({
      targets: effect,
      y: y - 50, // Monter plus haut
      alpha: { from: 1, to: 0 },
      scale: { from: 1, to: 1.5 }, // Grossir légèrement
      duration: 1500, // Plus lente pour être plus visible
      ease: 'Power2',
      onComplete: () => {
        effect.destroy();
      }
    });
    
    return effect;
  }
  
  // Shake effect pour un sprite
  private addShakeEffect(sprite: Phaser.GameObjects.Sprite, intensity: number = 1) {
    if (!sprite) return;
    
    const originalX = sprite.x;
    const originalY = sprite.y;
    const shakeDistance = 2 * intensity;
    
    // Créer 5 tweens consécutifs pour l'effet de secousse
    const createNextTween = (index: number) => {
      if (index >= 5) {
        // Position d'origine à la fin
        this.tweens.add({
          targets: sprite,
          x: originalX,
          y: originalY,
          duration: 50,
          ease: 'Power1'
        });
        return;
      }
      
      // Créer un mouvement aléatoire
      this.tweens.add({
        targets: sprite,
        x: originalX + (Math.random() - 0.5) * 2 * shakeDistance,
        y: originalY + (Math.random() - 0.5) * 2 * shakeDistance,
        duration: 50,
        ease: 'Power1',
        onComplete: () => createNextTween(index + 1)
      });
    };
    
    // Démarrer la séquence
    createNextTween(0);
  }
  
  // Shake effect pour un Container (utilisé pour les unités)
  private addContainerShakeEffect(container: Phaser.GameObjects.Container, intensity: number = 1) {
    if (!container) return;
    
    const originalX = container.x;
    const originalY = container.y;
    const shakeDistance = 2 * intensity;
    
    // Créer 5 tweens consécutifs pour l'effet de secousse
    const createNextTween = (index: number) => {
      if (index >= 5) {
        // Position d'origine à la fin
        this.tweens.add({
          targets: container,
          x: originalX,
          y: originalY,
          duration: 50,
          ease: 'Power1'
        });
        return;
      }
      
      // Créer un mouvement aléatoire
      this.tweens.add({
        targets: container,
        x: originalX + (Math.random() - 0.5) * 2 * shakeDistance,
        y: originalY + (Math.random() - 0.5) * 2 * shakeDistance,
        duration: 50,
        ease: 'Power1',
        onComplete: () => createNextTween(index + 1)
      });
    };
    
    // Démarrer la séquence
    createNextTween(0);
  }

  // Vérifier si l'outil est en collision avec une ressource
  private checkToolResourceCollision(): { id: string, type: string } | null {
    if (!this.tool) return null;
    
    // Position de l'outil
    const toolX = this.tool.x;
    const toolY = this.tool.y;
    const toolRadius = 8; // Rayon approximatif de l'outil pour la détection
    
    // Vérifier chaque ressource
    for (const [resourceId, resourceSprite] of this.resourceSprites.entries()) {
      const resourceX = resourceSprite.x;
      const resourceY = resourceSprite.y;
      const distance = Phaser.Math.Distance.Between(toolX, toolY, resourceX, resourceY);
      
      // Distance de détection variable selon le type de ressource
      let detectionRadius = 16; // Valeur par défaut
      
      switch (resourceSprite.texture.key) {
        case 'gold':
          detectionRadius = 14;
          break;
        case 'wood':
          // Pour le bois, vérifier à la fois le tronc et le feuillage
          if (toolX > resourceX - 8 && toolX < resourceX + 8 && 
              toolY > resourceY - 8 && toolY < resourceY + 20) {
            return { id: resourceId, type: resourceSprite.texture.key };
          }
          if (Phaser.Math.Distance.Between(toolX, toolY, resourceX, resourceY - 10) < 16) {
            return { id: resourceId, type: resourceSprite.texture.key };
          }
          continue;
        case 'stone':
          detectionRadius = 18;
          break;
      }
      
      // Vérifier si l'outil est en collision avec la ressource
      if (distance < toolRadius + detectionRadius) {
        return { id: resourceId, type: resourceSprite.texture.key };
      }
    }
    
    return null;
  }

  // Créer une tuile de base
  private createTile(type: string, x: number, y: number): Phaser.GameObjects.Image {
    // Créer l'image de la tuile
    const tile = this.add.image(x, y, type);
    tile.setOrigin(0.5);
    tile.setDepth(1); // Profondeur standard pour les tuiles de base
    
    return tile;
  }

  private startPlacingBuilding(buildingType: string) {
    this.isPlacingBuilding = true;
    this.selectedBuildingType = buildingType;
    
    // Créer l'aperçu du bâtiment avec le bon nom de sprite
    if (this.buildingPreview) {
      this.buildingPreview.destroy();
    }
    
    // Utiliser le mapping pour obtenir le bon nom de sprite
    const spriteName = GameScene.BUILDING_SPRITES[buildingType] || buildingType.toLowerCase();
    
    this.buildingPreview = this.add.sprite(0, 0, spriteName);
    this.buildingPreview.setAlpha(0.7);
    this.buildingPreview.setDepth(100);
    this.buildingPreview.setScale(1);
  }

  private stopPlacingBuilding() {
    this.isPlacingBuilding = false;
    this.selectedBuildingType = null;
    
    if (this.buildingPreview) {
      this.buildingPreview.destroy();
      this.buildingPreview = null;
    }
  }

  private checkCanPlaceBuilding(tileX: number, tileY: number): boolean {
    // Vérifier si le joueur a assez de ressources
    if (!this.selectedBuildingType || !this.room) return false;
    
    const costs = BUILDING_COSTS[this.selectedBuildingType];
    if (!costs) return false;
    
    const player = this.room.state.players.get(this.room.sessionId);
    if (!player) return false;
    
    // Vérifier la distance avec le joueur (max 2 cases)
    if (this.player) {
      const playerTileX = Math.floor(this.player.x / TILE_SIZE);
      const playerTileY = Math.floor(this.player.y / TILE_SIZE);
      const buildingTileX = Math.floor(tileX / TILE_SIZE);
      const buildingTileY = Math.floor(tileY / TILE_SIZE);
      
      const distance = Math.max(
        Math.abs(playerTileX - buildingTileX),
        Math.abs(playerTileY - buildingTileY)
      );
      
      if (distance > 2) {
        return false;
      }
    }
    
    // Vérifier les ressources
    for (const [resource, amount] of Object.entries(costs)) {
      const playerResource = player.resources.get(resource) || 0;
      if (playerResource < amount) {
        return false;
      }
    }
    
    // Vérifier si l'emplacement est libre (pas d'autre bâtiment)
    for (const [_, building] of this.room.state.buildings.entries()) {
      const buildingTileX = Math.floor(building.x / TILE_SIZE) * TILE_SIZE;
      const buildingTileY = Math.floor(building.y / TILE_SIZE) * TILE_SIZE;
      
      if (buildingTileX === tileX && buildingTileY === tileY) {
        return false;
      }
    }
    
    // Vérifier qu'il n'y a pas de ressource à cet emplacement
    for (const [resourceId, resourceSprite] of this.resourceSprites.entries()) {
      const resourceX = Math.floor(resourceSprite.x / TILE_SIZE) * TILE_SIZE;
      const resourceY = Math.floor(resourceSprite.y / TILE_SIZE) * TILE_SIZE;
      
      // Vérifier si la ressource est sur la même case
      if (resourceX === tileX && resourceY === tileY) {
        console.log(`Impossible de construire sur une ressource en (${tileX/TILE_SIZE}, ${tileY/TILE_SIZE})`);
        return false;
      }
    }
    
    return true;
  }

  // Méthode pour créer un sprite de ressource
  private createResourceSprite(resource: any) {
    let sprite: Phaser.GameObjects.Sprite;
    
    switch (resource.type) {
      case ResourceType.GOLD:
        sprite = this.add.sprite(resource.x, resource.y, 'gold');
        break;
      case ResourceType.WOOD:
        sprite = this.add.sprite(resource.x, resource.y, 'wood');
        break;
      case ResourceType.STONE:
        sprite = this.add.sprite(resource.x, resource.y, 'stone');
        break;
      default:
        console.warn(`Type de ressource inconnu: ${resource.type}`);
        return;
    }
    
    sprite.setDepth(5);
    this.resourceSprites.set(resource.id, sprite);
  }

  // Nouvelle méthode pour optimiser le rendu
  private optimizeRendering() {
    if (!this.player || !this.cameras.main) return;

    // Calculer la zone visible à l'écran avec une marge
    const camera = this.cameras.main;
    const margin = 100; // Marge en pixels pour éviter les pop-ins
    
    this.visibleScreenRect.setTo(
      camera.scrollX - margin,
      camera.scrollY - margin,
      camera.width + margin * 2,
      camera.height + margin * 2
    );

    // Optimiser les ressources (activer/désactiver selon visibilité)
    this.resourceSprites.forEach((sprite, id) => {
      const isVisible = this.visibleScreenRect.contains(sprite.x, sprite.y);
      sprite.setVisible(isVisible);
      // Ne pas mettre à jour les sprites non visibles
      sprite.setActive(isVisible);
    });

    // Optimiser les autres joueurs
    this.unitSprites.forEach((data) => {
      const isVisible = this.visibleScreenRect.contains(data.sprite.x, data.sprite.y);
      data.sprite.setVisible(isVisible);
      // Ne pas mettre à jour les sprites non visibles
      data.sprite.setActive(isVisible);
      
      // Optimiser aussi le texte du nom
      if (data.nameText) {
        data.nameText.setVisible(isVisible);
        data.nameText.setActive(isVisible);
      }
    });

    // Optimiser les bâtiments
    this.buildingSprites.forEach((sprite) => {
      const isVisible = this.visibleScreenRect.contains(sprite.x, sprite.y);
      sprite.setVisible(isVisible);
      sprite.setActive(isVisible);
    });
  }

  private updateBuildingPreview(tileX: number, tileY: number) {
    if (!this.buildingPreview || !this.player) return;

    const canPlace = this.checkCanPlaceBuilding(tileX, tileY);
    const playerTileX = Math.floor(this.player.x / TILE_SIZE);
    const playerTileY = Math.floor(this.player.y / TILE_SIZE);
    const buildingTileX = Math.floor(tileX / TILE_SIZE);
    const buildingTileY = Math.floor(tileY / TILE_SIZE);
    
    const distance = Math.max(
      Math.abs(playerTileX - buildingTileX),
      Math.abs(playerTileY - buildingTileY)
    );

    // Ajuster l'apparence selon la validité
    if (distance > 2) {
      // Trop loin : rouge transparent
      this.buildingPreview.setAlpha(0.4);
      this.buildingPreview.setTint(0xff0000);
    } else if (!canPlace) {
      // Invalide pour d'autres raisons : rouge moins transparent
      this.buildingPreview.setAlpha(0.6);
      this.buildingPreview.setTint(0xff0000);
    } else {
      // Valide : vert légèrement transparent
      this.buildingPreview.setAlpha(0.8);
      this.buildingPreview.setTint(0x00ff00);
    }

    this.buildingPreview.setPosition(tileX + TILE_SIZE/2, tileY + TILE_SIZE/2);
    this.canPlaceBuilding = canPlace;
  }

  // Méthode utilitaire pour convertir une teinte en couleur Phaser
  private hueToColor(hue: number): number {
    // Convertir la teinte (0-360) en HSL puis en RGB
    const s = 0.8; // Saturation fixe
    const l = 0.5; // Luminosité fixe
    
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;
    
    let r, g, b;
    if (hue >= 0 && hue < 60) {
      [r, g, b] = [c, x, 0];
    } else if (hue >= 60 && hue < 120) {
      [r, g, b] = [x, c, 0];
    } else if (hue >= 120 && hue < 180) {
      [r, g, b] = [0, c, x];
    } else if (hue >= 180 && hue < 240) {
      [r, g, b] = [0, x, c];
    } else if (hue >= 240 && hue < 300) {
      [r, g, b] = [x, 0, c];
    } else {
      [r, g, b] = [c, 0, x];
    }
    
    // Convertir en RGB (0-255) puis en valeur hexadécimale
    const red = Math.round((r + m) * 255);
    const green = Math.round((g + m) * 255);
    const blue = Math.round((b + m) * 255);
    
    // Retourner la couleur au format hexadécimal pour Phaser
    return Phaser.Display.Color.GetColor(red, green, blue);
  }
  
  // Méthode pour sélectionner un bâtiment
  private selectBuilding(buildingId: string | null) {
    // Convertir null en chaîne vide pour compatibilité
    const id = buildingId === null ? "" : buildingId;
    
    // Gérer la déselection
    if (this.selectedBuilding) {
      // Enlever la surbrillance du bâtiment précédemment sélectionné
      const prevBuilding = this.buildingSprites.get(this.selectedBuilding);
      if (prevBuilding) {
        prevBuilding.clearTint();
        
        // Détruire le bouton de recyclage s'il existe
        if (prevBuilding.getData('destroyButton')) {
          const prevRecycleButton = prevBuilding.getData('destroyButton');
          prevRecycleButton.destroy();
          prevBuilding.setData('destroyButton', null);
        }
        
        // Détruire le bouton toggle s'il existe (production)
        if (prevBuilding.getData('toggleButton')) {
          const prevToggleButton = prevBuilding.getData('toggleButton');
          prevToggleButton.destroy();
          prevBuilding.setData('toggleButton', null);
        }
        
        // Détruire le bouton d'épée s'il existe (caserne)
        if (prevBuilding.getData('swordButton')) {
          const prevSwordButton = prevBuilding.getData('swordButton');
          prevSwordButton.destroy();
          prevBuilding.setData('swordButton', null);
        }
      }
    }
    
    // Si on déselectionne ou si le bâtiment n'existe pas
    if (id === "" || !this.buildingSprites.get(id)) {
      this.selectedBuilding = "";
      return;
    }
    
    // Récupérer les infos du bâtiment
    const building = {
      sprite: this.buildingSprites.get(id),
      entity: this.room.state.buildings.get(id)
    };
    
    // Récupérer le sprite et les données du bâtiment
    const sprite = this.buildingSprites.get(id);
    if (sprite) {
      const building = this.room.state.buildings.get(id);
      
      if (building) {
        const isOwner = building.owner === this.room.sessionId;
        
        // Si c'est un bâtiment du joueur, créer un bouton de recyclage
        if (isOwner) {
          // Créer le bouton de recyclage
          const destroyButton = this.add.text(
            sprite.x - 24, // Position à gauche du bâtiment
            sprite.y - 24, // Position au-dessus du bâtiment
            "♻️",
            { fontSize: '14px' }
          );
          destroyButton.setOrigin(0.5);
          destroyButton.setDepth(50); // Augmenter la profondeur Z pour être au-dessus des autres éléments
          
          // Rendre le bouton interactif
          destroyButton.setInteractive({ useHandCursor: true });
          destroyButton.on('pointerdown', () => {
            this.destroySelectedBuilding();
          });
          
          // Stocker une référence au bouton sur le sprite
          sprite.setData('destroyButton', destroyButton);
          
          // Si c'est un bâtiment de production, ajouter un bouton pour activer/désactiver
          if (building.type === BuildingType.FURNACE || building.type === BuildingType.FORGE || building.type === BuildingType.FACTORY) {
            // Déterminer l'emoji en fonction de l'état de production
            const toggleEmoji = building.productionActive ? "⏸️" : "▶️";
            
            // Créer le bouton toggle
            const toggleButton = this.add.text(
              sprite.x + 24, // Position à droite du bâtiment
              sprite.y - 24, // Même hauteur que le bouton de recyclage
              toggleEmoji,
              { fontSize: '14px' }
            );
            toggleButton.setOrigin(0.5);
            toggleButton.setDepth(50); // Augmenter la profondeur Z
            
            // Rendre le bouton interactif
            toggleButton.setInteractive({ useHandCursor: true });
            toggleButton.on('pointerdown', () => {
              // Envoyer un message au serveur pour changer l'état
              this.room.send("toggleProduction", {
                buildingId,
                active: !building.productionActive
              });
              
              // Mettre à jour l'emoji du bouton
              toggleButton.setText(building.productionActive ? "▶️" : "⏸️");
            });
            
            // Stocker une référence au bouton
            sprite.setData('toggleButton', toggleButton);
          }
          
          // Si c'est une caserne, ajouter un emoji épée
          if (building.type === BuildingType.BARRACKS) {
            // Créer le bouton avec l'emoji épée
            const swordButton = this.add.text(
              sprite.x + 24, // Position à droite du bâtiment
              sprite.y - 24, // Même hauteur que le bouton de recyclage
              "⚔️",
              { fontSize: '14px' }
            );
            swordButton.setOrigin(0.5);
            swordButton.setDepth(50); // Augmenter la profondeur Z
            
            // Rendre le bouton interactif
            swordButton.setInteractive({ useHandCursor: true });
            
            swordButton.on('pointerdown', () => {
              console.log("Bouton de production de soldats cliqué");
              
              // Effet visuel temporaire pour indiquer la demande
              this.tweens.add({
                targets: swordButton,
                scale: 1.5,
                duration: 200,
                yoyo: true,
                ease: 'Power2'
              });
              
              // Envoyer un message au serveur pour créer un soldat
              this.room.send("spawnUnit", {
                buildingId: buildingId,
                unitType: "warrior"
              });
            });
            
            // Stocker une référence au bouton
            sprite.setData('swordButton', swordButton);
          }
        }
      }
    }
    
    this.selectedBuilding = buildingId;
  }
  
  // Méthode pour détruire le bâtiment sélectionné
  private destroySelectedBuilding() {
    if (this.selectedBuilding) {
      console.log(`Demande de destruction du bâtiment: ${this.selectedBuilding}`);
      
      // Envoyer un message au serveur pour détruire le bâtiment
      this.room.send("destroyBuilding", { buildingId: this.selectedBuilding });
      
      // Désélectionner le bâtiment
      this.selectBuilding("");
    }
  }
  
  // Méthode pour mettre à jour les barres de progression des bâtiments de production
  private updateProductionBars() {
    if (!this.room || !this.room.state) return;
    
    this.room.state.buildings.forEach((building, buildingId) => {
      const sprite = this.buildingSprites.get(buildingId);
      if (sprite && sprite.getData('isProductionBuilding')) {
        const progressBar = sprite.getData('progressBar');
        
        if (progressBar) {
          // Calculer la largeur de la barre en fonction de la progression
          const maxWidth = TILE_SIZE * 0.8;
          const width = (building.productionProgress / 100) * maxWidth;
          
          // Mettre à jour la largeur de la barre
          progressBar.width = width;
          
          // Couleur en fonction de l'activité (vert si actif, rouge si inactif)
          if (building.productionActive) {
            progressBar.fillColor = 0x00ff00;
          } else {
            progressBar.fillColor = 0xff0000;
          }
        }
      }
    });
  }

  // Ajouter cette méthode pour créer la représentation visuelle d'une unité
  private createUnitSprite(unit: any, unitId: string) {
    console.log(`Création du sprite pour l'unité ${unitId}`, unit);
    
    // Trouver le propriétaire de l'unité pour obtenir sa couleur
    const owner = this.room.state.players.get(unit.owner);
    if (!owner) {
      console.error(`Propriétaire ${unit.owner} introuvable pour l'unité ${unitId}`);
      return;
    }
    
    // Convertir la teinte en couleur RGB
    const color = this.hueToRgb(owner.hue);
    
    // Créer un container pour l'unité
    const container = this.add.container(unit.x, unit.y);
    container.setDepth(10);
    
    // Créer un carré plus petit que le joueur (75%)
    const unitSize = 6 * 0.75; // 75% de la taille du joueur (qui est 6)
    
    // Créer le carré avec la couleur du propriétaire
    const graphics = this.add.graphics();
    graphics.fillStyle(color, 1);
    graphics.fillRect(-unitSize/2, -unitSize/2, unitSize, unitSize);
    
    // Contour plus foncé
    const darkerColor = this.getDarkerColor(color);
    graphics.lineStyle(1, darkerColor, 1);
    graphics.strokeRect(-unitSize/2, -unitSize/2, unitSize, unitSize);
    
    // Ajouter le graphique au container
    container.add(graphics);
    
    // Stocker les informations de l'unité
    this.unitSprites.set(unitId, {
      sprite: container,
      targetX: unit.x,
      targetY: unit.y,
      nameText: undefined // Nous n'utilisons plus de texte pour les unités
    });
  }

  // Obtenir une version plus foncée d'une couleur pour le contour
  private getDarkerColor(color: number): number {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    
    // Réduire chaque composante de 40%
    const darkerR = Math.max(0, Math.floor(r * 0.6));
    const darkerG = Math.max(0, Math.floor(g * 0.6));
    const darkerB = Math.max(0, Math.floor(b * 0.6));
    
    return (darkerR << 16) | (darkerG << 8) | darkerB;
  }

  // Mettre à jour la position du texte du nom de l'unité
  private updateUnitNamePosition(unitId: string) {
    // Cette méthode ne fait plus rien car nous n'avons plus de texte pour les unités
    // Mais elle est conservée pour compatibilité avec le code existant
  }

  // Ajouter cette méthode pour mettre à jour les unités
  private updateUnits(delta: number) {
    // Parcourir toutes les unités
    this.unitSprites.forEach((unitData, unitId) => {
      if (unitData.targetX !== undefined && unitData.targetY !== undefined) {
        // Vérifier si c'est un joueur ou une unité
        const isPlayer = this.room && this.room.state && this.room.state.players.has(unitId);
        
        // Calculer le facteur d'interpolation basé sur delta pour des mouvements constants
        // Pour les unités: utiliser un facteur plus doux (0.8 au lieu de 1.5)
        const lerpFactor = Math.min(this.LERP_FACTOR * delta / 16 * (isPlayer ? 1 : 0.8), 1);
        
        // Position actuelle
        const currentX = unitData.sprite.x;
        const currentY = unitData.sprite.y;
        
        // Distance à parcourir
        const distToTarget = Phaser.Math.Distance.Between(currentX, currentY, unitData.targetX, unitData.targetY);
        
        // Utiliser une fonction d'easing pour un mouvement plus fluide
        // Fonction easeInOutQuad pour une accélération et décélération progressives
        const easeInOutQuad = (t: number): number => {
          return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        };
        
        // Appliquer l'easing au facteur d'interpolation pour des mouvements plus naturels
        const easedFactor = easeInOutQuad(lerpFactor);
        
        // Utiliser l'interpolation linéaire avec le facteur modifié par l'easing
        const newX = Phaser.Math.Linear(currentX, unitData.targetX, easedFactor);
        const newY = Phaser.Math.Linear(currentY, unitData.targetY, easedFactor);
        
        // Mettre à jour la position du container
        unitData.sprite.setPosition(newX, newY);
        
        // Animation de marche seulement pour les unités (pas pour les joueurs)
        if (!isPlayer) {
          const unitRect = unitData.sprite.getAt(0) as Phaser.GameObjects.Rectangle;
          
          if (unitRect) {
            // Réduire le seuil de distance pour que l'animation ne s'active que si l'unité bouge réellement
            // Était 0.5 pixels, maintenant 0.2 pixels pour plus de stabilité
            if (distToTarget > 0.2) {
              // Oscillation de la rotation pour simuler la marche
              if (!unitData.walkingPhase) {
                unitData.walkingPhase = 0;
              }
              
              // Réduire la vitesse d'oscillation pour un effet plus naturel
              unitData.walkingPhase += delta * 0.007; // Était 0.01
              
              // Appliquer une légère rotation sinusoïdale pour simuler la marche
              // Réduire l'amplitude de 0.05 à 0.03 pour une oscillation plus subtile
              const walkAngle = Math.sin(unitData.walkingPhase) * 0.03;
              unitRect.setRotation(walkAngle);
            } else {
              // Stabiliser la rotation quand immobile
              unitRect.setRotation(0);
            }
          }
        }
      }
    });
  }

  // Nouvelle méthode pour vérifier la synchronisation entre les unités locales et serveur
  private checkUnitSynchronization() {
    if (!this.room || !this.room.state) return;
    
    console.log("Vérification de la synchronisation des unités...");
    
    // Collecter les IDs des unités serveur et des joueurs
    const serverUnitIds = new Set<string>();
    const serverPlayerIds = new Set<string>();
    
    // Ajouter toutes les unités du serveur
    this.room.state.units.forEach((unit, unitId) => {
      serverUnitIds.add(unitId);
    });
    
    // Ajouter tous les joueurs du serveur
    this.room.state.players.forEach((player, playerId) => {
      serverPlayerIds.add(playerId);
    });
    
    // Vérifier si des unités locales n'existent pas sur le serveur
    let ghostUnitsCount = 0;
    this.unitSprites.forEach((unitData, unitId) => {
      // Vérifier si l'ID est celui d'un joueur (les sessionIds sont généralement courts)
      const isPlayer = serverPlayerIds.has(unitId);
      
      // Ne pas traiter les sprites des joueurs
      if (isPlayer) {
        return; // Ignorer les joueurs dans cette vérification
      }
      
      // Si cette unité n'existe pas sur le serveur
      if (!serverUnitIds.has(unitId)) {
        ghostUnitsCount++;
        console.log(`Unité fantôme détectée: ${unitId} - Suppression`);
        
        // Supprimer le sprite et le texte
        unitData.sprite.destroy();
        if (unitData.nameText) {
          unitData.nameText.destroy();
        }
        
        // Supprimer de notre Map
        this.unitSprites.delete(unitId);
      }
    });
    
    if (ghostUnitsCount > 0) {
      console.log(`${ghostUnitsCount} unités fantômes supprimées`);
    } else {
      console.log("Aucune unité fantôme détectée");
    }
  }

  // Nouvelle méthode pour animer le cooldown visuellement
  private startCooldownAnimation(button: Phaser.GameObjects.Text, duration: number) {
    // Assombrir le bouton pendant le cooldown
    button.setAlpha(0.5);
    
    // Animation progressive de retour à l'alpha normal
    this.tweens.add({
      targets: button,
      alpha: 1,
      duration: duration,
      ease: 'Linear'
    });
  }

  // Nouvelle méthode pour diagnostiquer l'état des joueurs et unités
  private logEntitiesStatus() {
    if (!this.room || !this.room.state) return;
    
    console.log("======== DIAGNOSTIC DES ENTITÉS ========");
    
    // Compter les joueurs côté serveur
    let serverPlayerCount = 0;
    this.room.state.players.forEach(() => serverPlayerCount++);
    
    // Compter les unités côté serveur
    let serverUnitCount = 0;
    this.room.state.units.forEach(() => serverUnitCount++);
    
    // Compter les sprites de joueurs et d'unités côté client
    let clientPlayerCount = 0;
    let clientUnitCount = 0;
    
    // Collecter les IDs des joueurs du serveur
    const serverPlayerIds = new Set<string>();
    this.room.state.players.forEach((player, playerId) => {
      serverPlayerIds.add(playerId);
    });
    
    // Parcourir les sprites pour identifier joueurs vs unités
    this.unitSprites.forEach((data, id) => {
      if (serverPlayerIds.has(id)) {
        clientPlayerCount++;
      } else {
        clientUnitCount++;
      }
    });
    
    console.log(`Côté serveur: ${serverPlayerCount} joueurs, ${serverUnitCount} unités`);
    console.log(`Côté client: ${clientPlayerCount} joueurs, ${clientUnitCount} unités`);
    console.log(`Total sprites: ${this.unitSprites.size}`);
    
    // Vérifier si des joueurs sont manquants
    const missingPlayers: string[] = [];
    serverPlayerIds.forEach(id => {
      if (!this.unitSprites.has(id) && id !== this.room.sessionId) {
        missingPlayers.push(id);
        
        // Récupérer les données du joueur manquant et recréer son sprite
        const player = this.room.state.players.get(id);
        if (player) {
          console.log(`Recréation du sprite pour le joueur ${id}`);
          this.createPlayerSprite(player, id);
        }
      }
    });
    
    if (missingPlayers.length > 0) {
      console.warn(`ATTENTION: ${missingPlayers.length} joueurs manquants côté client ont été restaurés:`, missingPlayers);
    } else {
      console.log("Tous les joueurs du serveur sont présents côté client");
    }
    
    console.log("========================================");
  }
  
  // Créer une barre de vie pour une unité - désactivé
  private updateUnitHealthBar(unitId: string, currentHealth: number, maxHealth: number) {
    // Suppression de la barre si elle existe
    let healthBar = this.unitHealthBars.get(unitId);
    if (healthBar) {
      healthBar.destroy();
      this.unitHealthBars.delete(unitId);
    }
    
    // Plus de création de barre de vie - fonctionnalité désactivée
    return;
  }
  
  // Mise à jour de la barre de vie du joueur
  private updatePlayerHealthBar(currentHealth: number, maxHealth: number) {
    // Si la barre n'existe pas encore, la créer
    if (!this.healthBar) {
      this.healthBar = this.add.graphics();
      this.healthBar.setScrollFactor(0); // Fixe à l'écran
      this.healthBar.setDepth(90); // Au-dessus de la plupart des éléments
    } else {
      this.healthBar.clear();
    }
    
    // Dimensions et position de la barre
    const width = 200;
    const height = 10;
    const x = 10;
    const y = 10;
    
    // Calculer le pourcentage de santé
    const healthPercentage = Math.max(0, Math.min(1, currentHealth / maxHealth));
    
    // Déterminer la couleur en fonction de la santé
    const color = healthPercentage > 0.6 ? 0x00ff00 : healthPercentage > 0.3 ? 0xffff00 : 0xff0000;
    
    // Fond de la barre (gris foncé)
    this.healthBar.fillStyle(0x333333, 0.8);
    this.healthBar.fillRect(x, y, width, height);
    
    // Partie "remplie" de la barre
    this.healthBar.fillStyle(color, 1);
    this.healthBar.fillRect(x, y, width * healthPercentage, height);
    
    // Bordure
    this.healthBar.lineStyle(1, 0x000000, 1);
    this.healthBar.strokeRect(x, y, width, height);
  }
  
  // Afficher un effet de dégâts à une position donnée
  private showDamageEffect(x: number, y: number, damage: number) {
    // Créer un texte affichant les dégâts
    const damageText = this.add.text(x, y - 20, `-${damage}`, {
      fontSize: '14px',
      color: '#ff0000',
      stroke: '#000000',
      strokeThickness: 2
    });
    damageText.setOrigin(0.5);
    
    // Animation de "pop-up" et disparition
    this.tweens.add({
      targets: damageText,
      y: y - 40, // Monter
      alpha: 0,  // Disparaître
      scale: 1.5, // Grossir légèrement
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        damageText.destroy();
      }
    });
  }
  
  // Effet de flash rouge pour les dégâts du joueur
  private showPlayerDamageEffect(damage: number) {
    // Si l'effet n'existe pas, le créer
    if (!this.damageTint) {
      this.damageTint = this.add.rectangle(
        this.cameras.main.width / 2,
        this.cameras.main.height / 2,
        this.cameras.main.width,
        this.cameras.main.height,
        0xff0000
      );
      this.damageTint.setScrollFactor(0); // Fixe à l'écran
      this.damageTint.setDepth(95); // Au-dessus de la plupart des éléments
      this.damageTint.setAlpha(0); // Invisible par défaut
    }
    
    // Animation de flash rouge
    this.tweens.add({
      targets: this.damageTint,
      alpha: { from: 0.3, to: 0 }, // Apparaître puis disparaître
      duration: 300,
      ease: 'Power2'
    });
    
    // Afficher aussi les dégâts en texte
    const damageText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 3,
      `-${damage}`,
      {
        fontSize: '32px',
        color: '#ff0000',
        stroke: '#ffffff',
        strokeThickness: 3
      }
    );
    damageText.setScrollFactor(0);
    damageText.setOrigin(0.5);
    damageText.setDepth(96);
    
    // Animation de disparition
    this.tweens.add({
      targets: damageText,
      alpha: 0,
      y: '-=50',
      scale: 1.5,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        damageText.destroy();
      }
    });
  }
  
  // Alerte de santé critique
  private showCriticalHealthWarning() {
    // Ne rien faire si le joueur est déjà mort
    if (this.isPlayerDead) return;
    
    // Effet de battement rouge sur tout l'écran
    if (!this.damageTint) {
      this.showPlayerDamageEffect(0); // Créer le tint si nécessaire
    }
    
    // Animation de battement répété
    this.tweens.add({
      targets: this.damageTint,
      alpha: 0.2,
      yoyo: true,
      repeat: 5,
      duration: 400,
      ease: 'Sine.easeInOut'
    });
    
    // Message d'alerte en texte
    const warningText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 4,
      "Santé critique!",
      {
        fontSize: '24px',
        color: '#ff0000',
        stroke: '#ffffff',
        strokeThickness: 3
      }
    );
    warningText.setScrollFactor(0);
    warningText.setOrigin(0.5);
    warningText.setDepth(96);
    
    // Animation de disparition
    this.tweens.add({
      targets: warningText,
      alpha: 0,
      duration: 2000,
      delay: 1000,
      ease: 'Power2',
      onComplete: () => {
        warningText.destroy();
      }
    });
  }
  
  // Afficher l'écran de mort
  private showDeathScreen(respawnTimeMs: number) {
    // Nettoyer tout écran de mort précédent si nécessaire
    if (this.deathScreen) {
      this.hideDeathScreen();
    }
    
    // Arrêter tout intervalle existant
    if (this.respawnIntervalId) {
      clearInterval(this.respawnIntervalId);
      this.respawnIntervalId = undefined;
    }
    
    // Créer un conteneur pour l'écran de mort
    this.deathScreen = this.add.container(0, 0);
    this.deathScreen.setDepth(100); // Au-dessus de tout
    this.deathScreen.setScrollFactor(0); // Fixe à l'écran
    
    // Fond semi-transparent
    const overlay = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.7
    );
    
    // Texte "Vous êtes mort"
    const deathText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 3,
      "Vous êtes mort",
      {
        fontSize: '48px',
        color: '#ff0000',
        stroke: '#000000',
        strokeThickness: 4
      }
    );
    deathText.setOrigin(0.5);
    
    // Calculer le temps restant initial en secondes
    let remainingSeconds = Math.ceil(respawnTimeMs / 1000);
    
    // Texte du compte à rebours
    this.respawnCountdown = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      `Respawn dans: ${remainingSeconds}`,
      {
        fontSize: '32px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      }
    );
    this.respawnCountdown.setOrigin(0.5);
    
    // Ajouter les éléments au conteneur
    this.deathScreen.add([overlay, deathText, this.respawnCountdown] as Phaser.GameObjects.GameObject[]);
    
    // Mettre à jour le compte à rebours chaque seconde
    const updateInterval = setInterval(() => {
      if (!this.respawnCountdown || !this.deathScreen) {
        clearInterval(updateInterval);
        this.respawnIntervalId = undefined;
        return;
      }
      
      remainingSeconds--;
      
      if (remainingSeconds <= 0) {
        this.respawnCountdown.setText("Respawn imminent...");
        clearInterval(updateInterval);
        this.respawnIntervalId = undefined;
      } else {
        this.respawnCountdown.setText(`Respawn dans: ${remainingSeconds}`);
      }
    }, 1000);
    
    // Stocker l'ID de l'intervalle pour pouvoir l'arrêter plus tard
    this.respawnIntervalId = updateInterval as unknown as number;
  }
  
  // Cacher l'écran de mort
  private hideDeathScreen() {
    // Arrêter l'intervalle de compte à rebours
    if (this.respawnIntervalId) {
      clearInterval(this.respawnIntervalId);
      this.respawnIntervalId = undefined;
    }
    
    if (this.deathScreen) {
      // Supprimer directement sans animation pour éviter les problèmes
      this.deathScreen.destroy();
      this.deathScreen = undefined;
      this.respawnCountdown = undefined;
      
      console.log("Écran de mort supprimé immédiatement");
    }
    
    // Réinitialiser la teinte rouge si elle existe
    if (this.damageTint) {
      this.damageTint.setAlpha(0);
      console.log("Teinte rouge réinitialisée à alpha 0");
    }
  }
  
  // Effet de réapparition
  private showRespawnEffect() {
    // Réinitialiser la teinte rouge si elle existe pour s'assurer qu'elle disparaît
    if (this.damageTint) {
      this.damageTint.setAlpha(0);
    }
    
    // Flash blanc
    const whiteFlash = this.add.rectangle(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      this.cameras.main.width,
      this.cameras.main.height,
      0xffffff
    );
    whiteFlash.setScrollFactor(0);
    whiteFlash.setDepth(90);
    
    // Animation de disparition du flash
    this.tweens.add({
      targets: whiteFlash,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        whiteFlash.destroy();
      }
    });
    
    // Texte "Vous êtes de retour"
    const respawnText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 3,
      "Vous êtes de retour!",
      {
        fontSize: '32px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      }
    );
    respawnText.setScrollFactor(0);
    respawnText.setOrigin(0.5);
    respawnText.setDepth(91);
    
    // Animation de disparition du texte
    this.tweens.add({
      targets: respawnText,
      alpha: 0,
      y: "-=50",
      duration: 2000,
      ease: 'Power2',
      onComplete: () => {
        respawnText.destroy();
      }
    });
  }
  
  // Désactiver les contrôles du joueur
  private disablePlayerControls() {
    // Désactiver les événements d'entrée
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.input.enabled = false;
  }
  
  // Réactiver les contrôles du joueur
  private enablePlayerControls() {
    // Réactiver les événements d'entrée
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    this.input.enabled = true;
  }

  // Méthode pour supprimer toutes les barres de vie
  private clearAllUnitHealthBars() {
    // Détruire toutes les barres de vie existantes
    this.unitHealthBars.forEach(healthBar => {
      healthBar.destroy();
    });
    // Vider la collection
    this.unitHealthBars.clear();
  }
} 