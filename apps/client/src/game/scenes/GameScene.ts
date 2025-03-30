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
  BuildingType,
  HARVEST_AMOUNT,
  RESOURCE_AMOUNTS,
  COMBAT
} from 'shared';
import { PerformanceManager, QualityLevel } from '../utils/PerformanceManager';
import { ObjectPool } from '../utils/ObjectPool';
// Import necessaire pour MapSchema
import { MapSchema } from "@colyseus/schema";

// Imports des nouveaux modules
import { ResourceSystem, BuildingSystem, UnitSystem, CombatSystem } from '../systems';
import { RenderManager } from '../managers';
import { PlayerController } from '../systems/PlayerController';
import { NetworkManager } from '../network';
import { UiSystem } from '../systems/UiSystem';
import { TerrainSystem } from '../systems/TerrainSystem';
import { HeroSystem } from '../systems/HeroSystem';
import { FogOfWarSystem } from '../systems/FogOfWarSystem';
import { UiScene } from './UiScene';
import { Room } from 'colyseus';
import { PvPStratRoomState } from 'shared';

export class GameScene extends Phaser.Scene {
  // Client Colyseus
  private room?: Room<any>;
  private client?: Client;
  
  // Nouveaux systèmes
  private resourceSystem!: ResourceSystem;
  private buildingSystem!: BuildingSystem;
  private unitSystem!: UnitSystem;
  private combatSystem!: CombatSystem;
  private renderManager!: RenderManager;
  private playerController!: PlayerController;
  private networkManager!: NetworkManager;
  private uiSystem!: UiSystem;
  private terrainSystem!: TerrainSystem;
  private heroSystem!: HeroSystem;
  private fogOfWarSystem!: FogOfWarSystem;
  
  // Éléments de jeu
  private player?: Phaser.GameObjects.Container;
  private tool?: Phaser.GameObjects.Sprite;
  private playerEntity?: any;
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
  
  // État d'initialisation
  private isInitialized: boolean = false;
  
  // Groupes d'objets
  private resourceSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private visibleResources: Set<string> = new Set(); // Ressources actuellement visibles
  private unitSprites: Map<string, { 
    sprite: Phaser.GameObjects.Container; 
    nameText?: Phaser.GameObjects.Text;
  }> = new Map();
  private otherPlayers: Map<string, Phaser.GameObjects.Container> = new Map(); // Autres joueurs
  
  // Stockage de la carte pour le chargement dynamique
  private mapData: string = '';
  private mapLines: string[] = [];
  private tileSize: number = TILE_SIZE;
  private loadedTiles: Set<string> = new Set(); // Garder trace des tuiles déjà chargées
  private renderDistance: number = 4; // Distance en chunks (augmentée de 3 à 4)
  private loadedChunks: Set<string> = new Set(); // Garder trace des chunks chargés
  
  // Mode de jeu
  private isToolMode: boolean = true;
  
  // Paramètres d'interpolation - à remplacer par des valeurs dynamiques
  private readonly LERP_FACTOR: number = 0.08;
  private readonly NETWORK_UPDATE_RATE: number = 100;
  private lastNetworkUpdate: number = 0;
  
  // Dernière position chargée pour éviter le rechargement constant
  private lastLoadedChunkX: number = -1;
  private lastLoadedChunkY: number = -1;
  private lastChunkLoadTime: number = 0; // Timestamp du dernier chargement de chunk
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

  // Performance monitoring
  private fpsText?: Phaser.GameObjects.Text;
  private pingText?: Phaser.GameObjects.Text;
  private lastPingTime: number = 0;
  private currentPing: number = 0;
  private lastFpsUpdate: number = 0;
  
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
    lastCollectTime: 0 // Dernier temps de collecte
  };
  
  // Propriétés pour la construction

  
  // Propriétés pour le minage
  private miningData = {
    cooldown: 500, // Temps en ms entre chaque collecte
    animationPhases: 3, // Nombre de phases de l'animation
    phaseSpeed: 150, // Durée de chaque phase en ms
    lastCollectTime: 0 // Dernier temps de collecte
  };
  
  // Paramètres d'optimisation du rendu
  private lastRenderOptimization: number = 0;
  private readonly RENDER_OPTIMIZATION_INTERVAL: number = 500; // ms entre les optimisations
  private visibleScreenRect: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  
  // Ajouter cette propriété pour suivre si la position initiale a été définie
  private initialPositionSet: boolean = false;
  
  // Variable pour suivre si un objet du jeu a été cliqué
  private clickedOnGameObject: boolean = false;
  
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
  
  // Pools d'objets pour les effets visuels
  private textEffectPool?: ObjectPool<Phaser.GameObjects.Text>;
  private damageEffectPool?: ObjectPool<Phaser.GameObjects.Text>;
  private activeTextEffects: Set<Phaser.GameObjects.Text> = new Set();
  private activeDamageEffects: Set<Phaser.GameObjects.Text> = new Set();
  
  // Propriétés pour le TileMap
  private map?: Phaser.Tilemaps.Tilemap;
  private tileset?: Phaser.Tilemaps.Tileset;
  private groundLayer?: Phaser.Tilemaps.TilemapLayer;
  private wallLayer?: Phaser.Tilemaps.TilemapLayer;
  private tileIndexes: { [key: string]: number } = {};
  private tilesets: { [key: string]: Phaser.Tilemaps.Tileset } = {};
  
  // Flag pour savoir si nous venons de l'écran de chargement
  private isPreloaded: boolean = false;
  
  private isFromMenu: boolean = false;
  
  // État du jeu
  private isConnected = false;
  private gridSize = 64;
  private currentPlayerId = '';
  private heroCooldowns: Map<string, number> = new Map();
  
  // UI
  private uiScene!: UiScene;
  private currentError: Phaser.GameObjects.Text | null = null;
  private errorDisplayTime = 0;
  private frameTimeText!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;
  private pingText!: Phaser.GameObjects.Text;
  private lastPingTime = 0;
  private lastFrameTimes: number[] = [];
  private debugModeEnabled = false;
  
  // La Map otherPlayers est déjà déclarée à la ligne 89
  
  constructor() {
    super({
      key: 'GameScene',
      active: false
    });
    
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
    this.load.image('wood', 'sprites/tree.png');
    this.load.image('stone', 'sprites/stone.png');
    
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
    this.load.image('playerWall', '/sprites/playerWall.png');
    
    // Charger les tuiles de terrain
    this.load.image('grass', '/sprites/grass.png');
    this.load.image('grass2', '/sprites/grass2.png');
    this.load.image('grass3', '/sprites/grass3.png');
    this.load.image('wall', '/sprites/wall.png');
    
    // Charger la carte
    this.load.text('map', '/default.map');
    
    console.log("Fin de la configuration du chargement");
  }
  
  init(data?: any) {
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
    
    // Récupérer les données passées par LoadingScene si disponible
    if (data) {
      console.log("Données reçues de LoadingScene:", data);
      
      if (data.playerName) {
        localStorage.setItem('playerName', data.playerName);
      }
      
      if (data.playerHue !== undefined) {
        localStorage.setItem('playerHue', data.playerHue.toString());
      }
      
      // Flag indiquant que nous venons de l'écran de chargement
      this.isPreloaded = !!data.preloaded;
    } else {
      this.isPreloaded = false;
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
    
    // Initialiser le gestionnaire de performances
    PerformanceManager.initialize();
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
    
    // Initialiser le système de gestion des bâtiments (déplacé en haut)
    this.buildingSystem = new BuildingSystem(this);
    
    // Vérifier que toutes les textures essentielles sont chargées
    const requiredTextures = ['grass', 'grass2', 'grass3', 'wall', 'player', 'villager', 'warrior'];
    let allTexturesLoaded = true;
    
    for (const texture of requiredTextures) {
      if (this.textures.exists(texture)) {
        console.log(`✓ Texture ${texture} chargée`);
      } else {
        console.error(`✗ Texture ${texture} MANQUANTE!`);
        allTexturesLoaded = false;
      }
    }
    
    if (!allTexturesLoaded) {
      console.error("Des textures essentielles sont manquantes. Certains éléments pourraient ne pas s'afficher correctement.");
    }
    
    // Ne plus charger la carte localement, tout sera géré par le serveur via Colyseus
    // this.loadMap();
    
    // Créer une grille d'herbe basique pour éviter un monde vide
    this.createBasicGrassTiles();
    
    // Créer les murs de bordure
    this.createBorderWalls();
    
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
    
    // Définir les limites de la caméra avec des valeurs par défaut
    // car nous n'utilisons plus mapLines
    const defaultMapWidth = 1000 * this.tileSize;  // Grande carte par défaut
    const defaultMapHeight = 1000 * this.tileSize; // Grande carte par défaut
    this.cameras.main.setBounds(0, 0, defaultMapWidth, defaultMapHeight);
    console.log(`Limites de la caméra par défaut: (0, 0) à (${defaultMapWidth}, ${defaultMapHeight})`);
    
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
    
    // Ne plus charger les tuiles localement, tout sera géré par le serveur via Colyseus
    // this.updateVisibleTiles();
    
    // Se connecter au serveur
    try {
      console.log("Tentative de connexion au serveur...");
      const connectionSuccess = await this.connectToServer(playerName, playerHue);
      
      if (connectionSuccess) {
        console.log("Connexion au serveur réussie!");
      } else {
        console.error("Échec de la connexion au serveur");
        this.showErrorMessage("Impossible de se connecter au serveur. Veuillez réessayer plus tard.");
      }
    } catch (error) {
      console.error("Erreur lors de la connexion au serveur:", error);
      this.showErrorMessage("Erreur de connexion au serveur. Veuillez réessayer plus tard.");
    }
    
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
    
    // S'assurer que les gestionnaires d'événements sont configurés correctement
    this.setupNetworkHandlers();
    
    // Écouter les événements de construction
    this.events.on('buildingSelected', (buildingType: string) => {
      this.startPlacingBuilding(buildingType);
    });
    
    // Écouter l'événement d'arrêt de placement de bâtiment (quand le menu est fermé)
    this.events.on('stopPlacingBuilding', (fromMenu = false) => {
      if (this.isPlacingBuilding) {
        this.isFromMenu = fromMenu;
        this.stopPlacingBuilding();
        this.isFromMenu = false;
      }
    });

    // Ajouter les événements de la souris pour la construction
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.buildingSystem.isPlacingBuilding) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
        const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
        
        this.updateBuildingPreview(tileX, tileY);
      }
    });

    // Modifié pour ne pas interférer avec la sélection des bâtiments
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.buildingSystem.isPlacingBuilding) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
        const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
        
        this.buildingSystem.handlePlaceBuildingAt(tileX, tileY);
      }
    });

    // Écouter la touche Escape pour annuler la construction
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.buildingSystem.isPlacingBuilding) {
        this.cancelPlacingBuilding();
      }
    });
    
    // Initialiser les variables pour la sélection de bâtiment
    this.selectedBuilding = null;
    this.destroyButton = null;
    
    // Initialiser les systèmes et l'interface utilisateur
    this.createResourcesUI();
    
    // Supprimer toutes les barres de vie des unités
    this.clearAllUnitHealthBars();
    
    // Initialiser les pools d'objets
    this.initObjectPools();
    
    // Ajouter des indicateurs de performance
    this.createPerformanceIndicators();
    
    console.log("GameScene initialisée avec succès!");
    
    // Vérifier si toutes les initialisations nécessaires sont faites
    this.isInitialized = true;
  }
  
  // Affiche un message d'erreur sur l'écran
  private showErrorMessage(message: string) {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    const errorBox = this.add.rectangle(width / 2, height / 2, 400, 150, 0x000000, 0.8);
    errorBox.setDepth(1000);
    
    const errorText = this.add.text(width / 2, height / 2, message, {
      fontSize: '18px',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 380 }
    }).setOrigin(0.5).setDepth(1001);
    
    const retryButton = this.add.rectangle(width / 2, height / 2 + 50, 150, 40, 0x4CAF50)
      .setInteractive()
      .setDepth(1001);
    
    const retryText = this.add.text(width / 2, height / 2 + 50, 'Réessayer', {
      fontSize: '16px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1002);
    
    retryButton.on('pointerdown', () => {
      errorBox.destroy();
      errorText.destroy();
      retryButton.destroy();
      retryText.destroy();
      
      this.scene.restart();
    });
  }
  
  update(time: number, delta: number) {
    if (!this.room || !this.player) return;
    
    // Mise à jour de la prévisualisation des bâtiments si active
    if (this.buildingSystem && this.buildingSystem.isPlacingBuilding) {
      const pointer = this.input.activePointer;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
      const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
      this.buildingSystem.updateBuildingPreview(tileX, tileY);
    }
    
    // Mettre à jour les métriques de performance tous les 500ms
    if (time - this.lastFpsUpdate > 500) {
      // Calculer FPS
      const fps = Math.round(1000 / delta);
      
      // Mettre à jour les indicateurs
      if (this.fpsText && this.fpsText.active) {
        this.fpsText.setText(`FPS: ${fps}`);
        this.fpsText.setColor(fps < 20 ? '#ff0000' : (fps < 45 ? '#ffff00' : '#00ff00'));
      }
      
      if (this.pingText && this.pingText.active) {
        this.pingText.setText(`Ping: ${this.currentPing}ms`);
        this.pingText.setColor(this.currentPing > 300 ? '#ff0000' : (this.currentPing > 150 ? '#ffff00' : '#00ff00'));
      }
      
      // Mettre à jour les statistiques de performance
      PerformanceManager.updateStats(fps, this.currentPing);
      this.lastFpsUpdate = time;
      
      // Mettre à jour les paramètres adaptés aux performances
      this.updateDynamicParameters();
    }
    

    // Déterminer le chunk actuel du joueur
    const playerChunkX = Math.floor(this.actualX / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.actualY / (this.tileSize * this.CHUNK_SIZE));
    

    
    // Pour garder une référence de la position du joueur
    if (playerChunkX !== this.lastLoadedChunkX || playerChunkY !== this.lastLoadedChunkY) {
      this.lastLoadedChunkX = playerChunkX;
      this.lastLoadedChunkY = playerChunkY;
    }
    
    // Optimiser le rendu en désactivant les objets hors écran
    if (time - this.lastRenderOptimization > PerformanceManager.renderOptimizationInterval) {
      this.optimizeRendering();
      this.lastRenderOptimization = time;
    }
    
    // Gérer le mouvement du joueur
    this.handlePlayerMovement();
    
    // Mettre à jour les positions des autres joueurs avec interpolation
    this.updateOtherPlayers(delta);
    
    // Mettre à jour les positions des unités avec interpolation
    this.updateUnits();
    
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
    
    // Mettre à jour l'animation de l'outil (une seule fois)
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
    if ((Math.abs(this.actualX - this.lastPlayerX) > PerformanceManager.positionThreshold || 
         Math.abs(this.actualY - this.lastPlayerY) > PerformanceManager.positionThreshold) &&
        (now - this.lastNetworkUpdate > PerformanceManager.networkUpdateRate)) {
      this.synchronizePlayerPosition();
      this.lastNetworkUpdate = now;
      
      // Calculer le ping (temps entre l'envoi et la réception d'une mise à jour)
      this.lastPingTime = now;
      
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
    
    // Adapter la taille des pools en fonction de la qualité (moins fréquemment)
    if (this.textEffectPool && this.damageEffectPool && time % 1000 < 20) {
      const maxPoolSize = Math.floor(PerformanceManager.maxTilePoolSize / 10);
      this.textEffectPool.maxPoolSize = maxPoolSize;
      this.damageEffectPool.maxPoolSize = Math.floor(maxPoolSize / 2);
    }
  }
  
  // Configuration simplifiée des gestionnaires réseau Colyseus
  private setupNetworkHandlers(): void {
    if (!this.room) return;
    
    // ======== GESTIONNAIRES POUR LES BÂTIMENTS ========
    // Configurer d'abord les gestionnaires pour les bâtiments via BuildingSystem
    // IMPORTANT: Ceci doit être fait avant toute autre configuration liée aux bâtiments
    console.log("Configuration des gestionnaires réseau pour les bâtiments via BuildingSystem");
    // this.buildingSystem.setupNetworkHandlers(this.room);
    
    // ======== GESTIONNAIRES NATIFS COLYSEUS ========
    // Gestionnaire pour les changements d'état (système natif de Colyseus)
    this.room.onStateChange((state) => {
      // Récupérer notre joueur
      const player = state.players.get(this.room.sessionId);
      if (player) {
        this.playerEntity = player;
        
        // Utiliser la position initiale fournie par le serveur
        if (this.player && !this.initialPositionSet) {
          this.actualX = player.x;
          this.actualY = player.y;
          this.player.setPosition(player.x, player.y);
          this.initialPositionSet = true;
        }
        
        // Mettre à jour l'interface des ressources
        this.updateResourcesUI();
      }
    });
    
    // Gestionnaire pour déboguer les positions des joueurs (message explicite)
    this.room.onMessage("playerPositionDebug", (data) => {
      // Ne pas traiter notre propre joueur
      if (data.id === this.room.sessionId) return;
      
      console.log(`DEBUG: Message playerPositionDebug reçu pour ${data.id}: position (${data.x}, ${data.y}), timestamp: ${data.timestamp}`);
      
      // Récupérer le sprite du joueur
      const playerSprite = this.otherPlayers.get(data.id);
      if (playerSprite) {
        console.log(`DEBUG: Mise à jour forcée du sprite à (${data.x}, ${data.y})`);
        
        // Définir la position cible pour l'interpolation
        playerSprite.setData('targetX', data.x);
        playerSprite.setData('targetY', data.y);
      } else {
        console.warn(`DEBUG: Impossible de trouver le sprite pour ${data.id}`);
        
        // Tenter de récupérer les données du joueur pour créer le sprite
        const playerData = this.room.state.players.get(data.id);
        if (playerData) {
          console.log(`DEBUG: Création tardive du sprite pour ${data.id}`);
          this.createPlayerSprite(playerData, data.id);
          
          // Définir la position cible immédiatement
          const newSprite = this.otherPlayers.get(data.id);
          if (newSprite) {
            newSprite.setData('targetX', data.x);
            newSprite.setData('targetY', data.y);
          }
        } else {
          console.error(`DEBUG: Joueur ${data.id} introuvable dans l'état du jeu!`);
        }
      }
    });
    
    // Ajout d'un gestionnaire pour les mises à jour de joueurs envoyées par le serveur
    this.room.onMessage("playerUpdate", (message) => {
      console.log(`Mise à jour du joueur reçue:`, message);
      
      // Ne pas traiter notre propre joueur
      if (message.id === this.room.sessionId) return;
      
      // Récupérer le sprite du joueur
      const playerSprite = this.otherPlayers.get(message.id);
      if (playerSprite) {
        // Traiter chaque changement
        message.changes.forEach(change => {
          if (change.field === 'x' || change.field === 'y') {
            console.log(`Mise à jour position joueur ${message.id}: ${change.field}=${change.value}`);
            // Mettre à jour la position cible pour l'interpolation
            playerSprite.setData(`target${change.field.toUpperCase()}`, change.value);
          }
        });
      } else {
        console.warn(`Sprite non trouvé pour le joueur ${message.id}`);
        
        // Tenter de récupérer les données du joueur pour créer le sprite
        const playerData = this.room.state.players.get(message.id);
        if (playerData) {
          this.createPlayerSprite(playerData, message.id);
        }
      }
    });
    
    // ======== GESTIONNAIRES POUR LE SYSTÈME DE FILTRAGE NATIF DE COLYSEUS ========
    
    // Gestionnaire pour les joueurs ajoutés (filtrage natif)
    this.room.state.players.onAdd((player, sessionId) => {
      console.log(`Joueur ajouté: ${sessionId}, nom: ${player.name}, position: (${player.x}, ${player.y})`);
      
      // Ne pas créer de sprite pour notre propre joueur (déjà géré)
      if (sessionId === this.room.sessionId) {
        console.log(`C'est notre propre joueur, sprite déjà créé`);
        return;
      }
      
      // Vérifier si ce joueur n'existe pas déjà
      if (!this.otherPlayers.has(sessionId)) {
        this.createPlayerSprite(player, sessionId);
      }
    });
    
    // Gestionnaire pour les joueurs supprimés (filtrage natif)
    this.room.state.players.onRemove((player, sessionId) => {
      console.log(`Joueur supprimé: ${sessionId}`);
      
      // Ne pas traiter notre propre joueur
      if (sessionId === this.room.sessionId) return;
      
      // Supprimer le sprite du joueur
      const playerSprite = this.otherPlayers.get(sessionId);
      if (playerSprite) {
        playerSprite.destroy();
        this.otherPlayers.delete(sessionId);
      }
    });
    
    // Gestionnaire pour les changements d'état des joueurs (filtrage natif)
    this.room.state.players.onChange((player, sessionId) => {
      // Ne pas traiter notre propre joueur
      if (sessionId === this.room.sessionId) return;
      
      // Log détaillé pour débogage
      console.log(`Changement détecté pour le joueur ${sessionId}: 
        position: (${player.x.toFixed(2)}, ${player.y.toFixed(2)})
        isDead: ${player.isDead}
        timestamp: ${Date.now()}
      `);
      
      // Mettre à jour le sprite du joueur
      const playerSprite = this.otherPlayers.get(sessionId);
      if (playerSprite) {
        // Log détaillé de l'état actuel du sprite
        console.log(`État actuel du sprite pour ${sessionId}:
          position: (${playerSprite.x.toFixed(2)}, ${playerSprite.y.toFixed(2)})
          targetX: ${playerSprite.getData('targetX')}
          targetY: ${playerSprite.getData('targetY')}
        `);
        
        // Mettre à jour la position (interpolation douce gérée dans update())
        playerSprite.setData('targetX', player.x);
        playerSprite.setData('targetY', player.y);
        
        console.log(`Position cible mise à jour pour ${sessionId}: (${player.x}, ${player.y})`);
        
        // Si le joueur est mort, mettre à jour son état
        if (player.isDead !== undefined) {
          playerSprite.setData('isDead', player.isDead);
        }
      } else {
        console.warn(`Sprite non trouvé pour le joueur ${sessionId}, tentative de création`);
        
        // Tenter de créer le sprite
        this.createPlayerSprite(player, sessionId);
      }
    });
    
    // NOTE: Le gestionnaire "playerMoved" a été supprimé car redondant.
    // Nous utilisons maintenant uniquement le système natif de Colyseus (onChange) pour gérer les mises à jour de position.
    
    // Gestionnaire pour les unités ajoutées (filtrage natif)
    this.room.state.units.onAdd((unit, unitId) => {
      // Vérifier si cette unité n'existe pas déjà pour éviter les doublons
      if (!this.unitSprites.has(unitId)) {
        this.createUnitSprite(unit, unitId);
      }
    });
    
    // Gestionnaire pour les unités supprimées (filtrage natif)
    this.room.state.units.onRemove((unit, unitId) => {
      const unitData = this.unitSprites.get(unitId);
      if (unitData) {
        unitData.sprite.destroy();
        if (unitData.nameText) {
          unitData.nameText.destroy();
        }
        this.unitSprites.delete(unitId);
      }
    });

    // Gestionnaire pour les changements d'unités (filtrage natif)
    this.room.state.units.onChange((unit, unitId) => {
      const unitData = this.unitSprites.get(unitId);
      if (unitData) {
        // IMPORTANT: Distinguer la position actuelle des positions cibles
        // Ne mettre à jour la position actuelle QUE si c'est une téléportation
        // sinon on garde les targets pour l'interpolation
        
        // Vérifier si les positions cibles sont définies dans l'unité
        const serverTargetX = unit.targetX !== undefined ? unit.targetX : unit.x;
        const serverTargetY = unit.targetY !== undefined ? unit.targetY : unit.y;
        
        // Extraire les données du sprite actuel
        const currentTargetX = unitData.sprite.getData('targetX');
        const currentTargetY = unitData.sprite.getData('targetY');
        
        // Si les targets serveur sont différentes de la position actuelle,
        // alors c'est vraiment une cible d'interpolation
        const isRealTarget = (
          Math.abs(serverTargetX - unit.x) > 0.1 || 
          Math.abs(serverTargetY - unit.y) > 0.1
        );
        
        // Si les positions sont significativement différentes des targets actuelles
        const hasChangedSignificantly = (
          currentTargetX === undefined || 
          currentTargetY === undefined ||
          Math.abs(serverTargetX - currentTargetX) > 1 ||
          Math.abs(serverTargetY - currentTargetY) > 1
        );
        
        if (hasChangedSignificantly) {
          // Log pour déboguer (moins fréquent)
          if (Math.random() < 0.1) { // 10% des mises à jour importantes
            console.log(`Mise à jour significative unité ${unitId}: 
              Position: (${unit.x.toFixed(2)}, ${unit.y.toFixed(2)})
              TargetServer: (${serverTargetX.toFixed(2)}, ${serverTargetY.toFixed(2)})
              Est une réelle target? ${isRealTarget}
            `);
          }
          
          // Dans tous les cas, mettre à jour les cibles pour l'interpolation
          unitData.sprite.setData('targetX', serverTargetX);
          unitData.sprite.setData('targetY', serverTargetY);
          
          // Si c'est une téléportation ou un saut instantané, mettre à jour la position directement
          // sans passer par l'interpolation (par exemple pour la première apparition)
          if (!isRealTarget && Math.abs(unit.x - unitData.sprite.x) > 10) {
            unitData.sprite.x = unit.x;
            unitData.sprite.y = unit.y;
            console.log(`Téléportation de l'unité ${unitId} à (${unit.x}, ${unit.y})`);
          }
        }
        
        // Gestion de l'animation de récolte
        if (unit.isHarvesting !== undefined) {
          // Animation de récolte
            const unitRect = unitData.sprite.getAt(0) as Phaser.GameObjects.Rectangle;
            if (unitRect) {
            if (unit.isHarvesting && unit.type === "villager") {
              // Appliquer une teinte jaune pour indiquer la récolte
              (unitRect as any).setTint(0xffffaa);
              // Stocker l'état de récolte dans les données du sprite
              unitData.sprite.setData('harvesting', true);
            } else if (unitData.sprite.getData('harvesting')) {
              // Restaurer la couleur normale
              (unitRect as any).clearTint();
              // Réinitialiser l'état de récolte
              unitData.sprite.setData('harvesting', false);
            }
          }
        }
        
        // Stocke d'autres attributs utiles de l'unité
        unitData.sprite.setData('type', unit.type);
        unitData.sprite.setData('health', unit.health);
        unitData.sprite.setData('maxHealth', unit.maxHealth);
        unitData.sprite.setData('state', unit.state);
        unitData.sprite.setData('owner', unit.owner);
      }
    });
    
    // Gestionnaire pour les ressources ajoutées (filtrage natif)
    this.room.state.resources.onAdd = (resource, resourceId) => {
      console.log(`🔶 Ressource ajoutée: ${resourceId}, type: ${resource.type}, position: (${resource.x}, ${resource.y}), montant: ${resource.amount}, respawn: ${resource.isRespawning}`);
      
      // Ne pas créer de sprite si la ressource est en cours de respawn ou épuisée
      if (resource.amount <= 0 || resource.isRespawning) {
        console.log(`Ressource ${resourceId} ignorée car épuisée ou en respawn`);
        return;
      }
      
      // Vérifier si la ressource existe déjà
      if (this.resourceSprites.has(resourceId)) {
        console.log(`Ressource ${resourceId} existe déjà, mise à jour`);
      const existingSprite = this.resourceSprites.get(resourceId);
      if (existingSprite) {
        existingSprite.setData('amount', resource.amount);
          existingSprite.setVisible(true);
        }
      } else {
        console.log(`Création d'une nouvelle ressource ${resourceId}`);
        
        // Conversion correcte des coordonnées (si nécessaire)
        // Si les coordonnées sont en tuiles, les convertir en pixels
        const pixelX = resource.x; // Coordonnées déjà en pixels
        const pixelY = resource.y; // Coordonnées déjà en pixels
        
        // Utiliser createResource pour créer un nouveau sprite
        const resourceSprite = this.createResource(resource.type, pixelX, pixelY);
        
        // Forcer la visibilité, la position et la profondeur
        resourceSprite.setVisible(true);
        resourceSprite.setDepth(10); // Plus haut que les tuiles d'herbe
      
      // Stocker la référence au sprite
      this.resourceSprites.set(resourceId, resourceSprite);
      
        // Mettre à jour les données avec celles du serveur
        resourceSprite.setData('amount', resource.amount);
        resourceSprite.setData('isRespawning', resource.isRespawning);
        
        // Ajouter à visibleResources pour la garder affichée
        this.visibleResources.add(resourceId);
        
        // Ajouter un effet pour marquer l'apparition
        this.tweens.add({
          targets: resourceSprite,
          scale: { from: 0.7, to: 1 },
          alpha: { from: 0.7, to: 1 },
          duration: 300,
          ease: 'Back.easeOut'
        });
      }
    };
    
    this.room.state.resources.onRemove((resource, resourceId) => {
      console.log(`Ressource supprimée par le serveur: ${resourceId}`);
      
      const resourceSprite = this.resourceSprites.get(resourceId);
      if (resourceSprite) {
        resourceSprite.destroy();
        this.resourceSprites.delete(resourceId);
        this.visibleResources.delete(resourceId);
      }
    });
    
    // Gestionnaire pour les modifications des ressources (filtrage natif)
    this.room.state.resources.onChange((resource, resourceId) => {
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
    });
    
    // Gestionnaire pour les suppressions de ressources (filtrage natif)
    this.room.state.resources.onRemove((resource, resourceId) => {
      // Récupérer et supprimer le sprite
      const resourceSprite = this.resourceSprites.get(resourceId);
      if (resourceSprite) {
        resourceSprite.destroy();
        this.resourceSprites.delete(resourceId);
      }
    });
    
    // Remarque: La gestion des bâtiments est maintenant entièrement gérée par le BuildingSystem
    // Voir this.buildingSystem.setupNetworkHandlers(this.room) plus bas dans cette méthode
    
    // Gestionnaire pour les changements d'état des bâtiments (filtrage natif)
    // this.room.state.buildings.onChange((building, buildingId) => {
    //   // Récupérer le sprite correspondant
    //   const buildingSprite = this.getBuildingSprites().get(buildingId);
    //   if (!buildingSprite) return;
      
    //   // Mettre à jour la position cible
    //   buildingSprite.x = building.x;
    //   buildingSprite.y = building.y;
      
    //   // Mettre à jour les propriétés
    //   buildingSprite.setData('health', building.health);
    //   buildingSprite.setData('maxHealth', building.maxHealth);
      
    //   // Mettre à jour les barres de progression
    //   buildingSprite.setData('progressBg', building.progressBg);
    //   buildingSprite.setData('progressBar', building.progressBar);
      
    //   // Mettre à jour les données
    //   buildingSprite.setData('isProductionBuilding', building.isProductionBuilding);
    // });
    
    // Gestionnaire bpour les ressources initiales
    this.room.onMessage("initialResources", (data) => {
      console.log(`🌍 Ressources initiales reçues: ${data.length} ressources`);
      
      // Nettoyer toute ressource existante
      this.resourceSprites.forEach(sprite => sprite.destroy());
      this.resourceSprites.clear();
      this.visibleResources.clear();
      
      // Ajouter chaque ressource avec des logs détaillés
      data.forEach((resourceData: any, index: number) => {
        // Vérifier que les données sont valides
        if (!resourceData.id || !resourceData.type || 
            resourceData.x === undefined || resourceData.y === undefined) {
          console.error("Données de ressource invalides:", resourceData);
          return;
        }
        
        console.log(`🌟 Traitement ressource initiale ${index+1}/${data.length}: ${resourceData.id}, type: ${resourceData.type}, position: (${resourceData.x}, ${resourceData.y})`);
        
        // Créer directement un sprite pour la ressource au lieu d'utiliser onAdd
        if (resourceData.amount > 0 && !resourceData.isRespawning) {
          const resourceSprite = this.createResource(resourceData.type, resourceData.x, resourceData.y);
          
          // Stocker la référence au sprite
          this.resourceSprites.set(resourceData.id, resourceSprite);
          
          // Mettre à jour les données
          resourceSprite.setData('amount', resourceData.amount);
          resourceSprite.setData('isRespawning', resourceData.isRespawning || false);
          
          // Forcer la visibilité et une profondeur élevée
          resourceSprite.setVisible(true);
          resourceSprite.setDepth(10);
          
          // Ajouter à visibleResources pour la garder affichée
          this.visibleResources.add(resourceData.id);
          
          // Ajouter un effet d'apparition
          this.tweens.add({
            targets: resourceSprite,
            scale: { from: 0.7, to: 1 },
            alpha: { from: 0.7, to: 1 },
            duration: 300,
            ease: 'Back.easeOut'
          });
        }
      });
      
      console.log(`✅ ${this.resourceSprites.size} ressources initiales affichées`);
    });
    
    // Gestionnaire pour les mises à jour de ressources visibles
    this.room.onMessage("updateVisibleResources", (data) => {
      console.log(`🔄 Mise à jour des ressources visibles: ${data.length} ressources`);
      
      // Tableau pour stocker les IDs des ressources dans cette mise à jour
      const receivedResourceIds = new Set<string>();
      
      // Parcourir les ressources envoyées et les traiter directement
      data.forEach((resourceData: any, index: number) => {
        // Vérifier que les données sont valides
        if (!resourceData.id || !resourceData.type || 
            resourceData.x === undefined || resourceData.y === undefined) {
          console.error("Données de ressource invalides:", resourceData);
          return;
        }
        
        receivedResourceIds.add(resourceData.id);
        
        // Vérifier si la ressource existe déjà
        if (this.resourceSprites.has(resourceData.id)) {
          console.log(`🔄 Mise à jour ressource existante: ${resourceData.id}`);
          const sprite = this.resourceSprites.get(resourceData.id);
          if (sprite) {
            // Mettre à jour les propriétés
            sprite.setData('amount', resourceData.amount);
            // Mettre à jour la position si nécessaire
            sprite.x = resourceData.x;
            sprite.y = resourceData.y;
            // S'assurer que la ressource est visible
            sprite.setVisible(true);
            // Ajouter à l'ensemble des ressources visibles
            this.visibleResources.add(resourceData.id);
          }
        } else {
          console.log(`➕ Nouvelle ressource de chunk: ${resourceData.id}, type: ${resourceData.type}, position: (${resourceData.x}, ${resourceData.y})`);
          
          // Créer directement un sprite pour la ressource
          if (resourceData.amount > 0 && !resourceData.isRespawning) {
            const resourceSprite = this.createResource(resourceData.type, resourceData.x, resourceData.y);
            
            // Stocker la référence au sprite
            this.resourceSprites.set(resourceData.id, resourceSprite);
            
            // Mettre à jour les données
            resourceSprite.setData('amount', resourceData.amount);
            resourceSprite.setData('isRespawning', resourceData.isRespawning || false);
            
            // Forcer la visibilité et une profondeur élevée
            resourceSprite.setVisible(true);
            resourceSprite.setDepth(10);
            
            // Ajouter à visibleResources pour la garder affichée
            this.visibleResources.add(resourceData.id);
            
            // Ajouter un effet d'apparition
            this.tweens.add({
              targets: resourceSprite,
              scale: { from: 0.7, to: 1 },
              alpha: { from: 0.7, to: 1 },
              duration: 300,
              ease: 'Back.easeOut'
            });
          }
        }
      });
      
      console.log(`✅ Mise à jour terminée: ${receivedResourceIds.size} ressources reçues, ${this.resourceSprites.size} ressources totales affichées`);
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
      const buildingSprite = this.getBuildingSprites().get(data.buildingId);
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
      const buildingSprite = this.getBuildingSprites().get(data.buildingId);
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

    // NOUVEAU: Diagnostiquer les messages de combat - utile pour déboguer
    this.room.onMessage("*", (type: string, message: any) => {
      // Ne loguer que les messages liés aux combats ou dégâts
      if (type.includes('attack') || type.includes('damage') || type.includes('hit') || type.includes('combat')) {
        console.log(`Message de combat reçu [${type}]:`, message);
      }
    });
    
    // Écouter les dépôts de ressources au centre-ville
    this.room.onMessage("resourceDeposited", (data: any) => {
      console.log("Ressources déposées:", data);
      
      // Vérifier si c'est notre joueur qui a reçu les ressources
      if (data.playerId === this.room.sessionId) {
        // Afficher directement l'effet à la position du villageois
        if (data.villagerX && data.villagerY) {
          console.log(`Affichage effet dépôt à position villageois: (${data.villagerX}, ${data.villagerY})`);
          
          // Montrer un premier effet à la position du villageois - simplement "+20" sans type
          this.showNumericEffect(
            `+${data.amount}`, 
            data.villagerX, 
            data.villagerY - 20, 
            data.type,
            0.5 // Taille deux fois plus petite
          );
          
          // Essayer de trouver un centre-ville pour l'effet visuel supplémentaire
          let closestTownCenter = null;
          this.getBuildingSprites().forEach((buildingSprite) => {
            if (buildingSprite.getData('type') === 'town_center' && 
                buildingSprite.getData('owner') === this.room.sessionId) {
              // Ajouter un effet visuel au centre-ville - pulsation
              this.tweens.add({
                targets: buildingSprite,
                scaleX: 1.1,
                scaleY: 1.1,
                duration: 300,
                yoyo: true,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                  buildingSprite.setScale(1);
                }
              });
            }
          });
        }
        
        // Mettre à jour l'affichage des ressources
        this.updateResourcesUI();
      }
    });

    // Écouter les dépôts de ressources au centre-ville
    this.room.onMessage("resourceHarvested", (data: any) => {
      const { resourceId, amount, villagerX, villagerY } = data;
      
      // Trouver le sprite de la ressource
      const resourceSprite = this.resourceSprites.get(resourceId);
      if (resourceSprite) {
        // Ajouter l'effet de tremblement
        this.addShakeEffect(resourceSprite, 0.5); // Intensité réduite pour les villageois
        
        // Afficher l'effet numérique de récolte (avec +1 au lieu de -1)
        this.showNumericEffect(
          `+${amount}`,
          villagerX,
          villagerY,
          resourceSprite.getData('type'),
          0.5 // Taille deux fois plus petite
        );

        // Mettre à jour les données du sprite
        const currentAmount = resourceSprite.getData('amount') - amount;
        resourceSprite.setData('amount', currentAmount);
        
        // Assombrir progressivement la ressource en fonction de la quantité restante
        const maxAmount = resourceSprite.getData('maxAmount');
        if (maxAmount > 0) {
          const ratio = Math.max(0.1, currentAmount / maxAmount);
          resourceSprite.setScale(0.8 + (0.2 * ratio));
          
          // Assombrir la couleur en fonction de la quantité restante
          const darkenFactor = 0.7 + (0.3 * ratio);
          resourceSprite.setTint(Phaser.Display.Color.GetColor(
            Math.floor(255 * darkenFactor),
            Math.floor(255 * darkenFactor),
            Math.floor(255 * darkenFactor)
          ));
        }
      }
    });

    // Écouter les dégâts subis par les bâtiments
    this.room.onMessage("buildingDamaged", (data: any) => {
      console.log("Bâtiment endommagé:", data);
      
      // Récupérer le sprite du bâtiment
      const buildingSprite = this.getBuildingSprites().get(data.buildingId);
      if (!buildingSprite) return;
      
      // Montrer l'effet de dégâts
      this.showDamageEffect(buildingSprite.x, buildingSprite.y - 10, data.damage);
      
      // Ajouter effet visuel de dégâts (clignotement)
      this.addDamageFlashEffect(buildingSprite);
      
      // Mettre à jour les données de santé (sans mettre à jour la barre de vie)
      buildingSprite.setData('health', data.health);
      buildingSprite.setData('maxHealth', data.maxHealth);
    });

    // Gestionnaire pour les rafraîchissements manuels de ressources (debug)
    this.room.onMessage("refreshResources", (data) => {
      console.log(`🔍 Rafraîchissement des ressources reçu: ${data.count} ressources à ${new Date(data.timestamp).toLocaleTimeString()}`);
      
      // Nettoyer les sprites de ressources existants si demandé
      const clearExisting = true; // Option pour nettoyer totalement les ressources existantes
      
      if (clearExisting) {
        console.log("🧹 Nettoyage des ressources existantes...");
        this.resourceSprites.forEach(sprite => sprite.destroy());
        this.resourceSprites.clear();
        this.visibleResources.clear();
      }
      
      // Créer les sprites pour toutes les ressources reçues
      if (data.resources && Array.isArray(data.resources)) {
        console.log(`Traitement de ${data.resources.length} ressources rafraîchies`);
        
        // Compteurs pour statistiques
        let created = 0;
        let updated = 0;
        
        // Traiter chaque ressource
        data.resources.forEach((resourceData: any, index: number) => {
          // Vérifier que les données sont valides
          if (!resourceData.id || !resourceData.type || 
              resourceData.x === undefined || resourceData.y === undefined) {
            console.error("Données de ressource invalides:", resourceData);
            return;
          }
          
          // Vérifier si la ressource existe déjà
          if (this.resourceSprites.has(resourceData.id)) {
            // Mettre à jour la ressource existante
            const sprite = this.resourceSprites.get(resourceData.id);
            if (sprite) {
              // Mettre à jour les propriétés
              sprite.setData('amount', resourceData.amount);
              // Mettre à jour la position
              sprite.x = resourceData.x;
              sprite.y = resourceData.y;
              // S'assurer que la ressource est visible
              sprite.setVisible(true);
              updated++;
            }
          } else {
            // Créer une nouvelle ressource
            if (resourceData.amount > 0 && !resourceData.isRespawning) {
              const resourceSprite = this.createResource(resourceData.type, resourceData.x, resourceData.y);
              
              // Stocker la référence au sprite
              this.resourceSprites.set(resourceData.id, resourceSprite);
              
              // Mettre à jour les données
              resourceSprite.setData('amount', resourceData.amount);
              resourceSprite.setData('isRespawning', resourceData.isRespawning || false);
              
              // Forcer la visibilité et une profondeur élevée
              resourceSprite.setVisible(true);
              resourceSprite.setDepth(10);
              
              // Ajouter un effet d'apparition
              this.tweens.add({
                targets: resourceSprite,
                scale: { from: 0.7, to: 1 },
                alpha: { from: 0.7, to: 1 },
                duration: 300,
                ease: 'Back.easeOut'
              });
              
              created++;
            }
          }
          
          // Ajouter à visibleResources pour la garder affichée
          this.visibleResources.add(resourceData.id);
        });
        
        // Afficher des statistiques
        console.log(`✅ Rafraîchissement terminé: ${created} ressources créées, ${updated} mises à jour`);
        
        // Ajouter un message temporaire sur l'écran
        const message = this.add.text(
          this.cameras.main.width / 2,
          100,
          `✨ ${data.count} ressources rafraîchies (${created} nouvelles)`,
          {
            fontSize: '20px',
            color: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 10, y: 5 }
          }
        );
        message.setOrigin(0.5);
        message.setScrollFactor(0);
        message.setDepth(1000);
        
        // Faire disparaître le message après quelques secondes
        this.tweens.add({
          targets: message,
          alpha: 0,
          y: 80,
          delay: 2000,
          duration: 1000,
          onComplete: () => message.destroy()
        });
      }
    });

    this.room.onMessage("resourceRespawned", (data: {
      resourceId: string;
    }) => {
      // ... existing code ...
    });

    this.room.onMessage("buildingRemoved", (message) => {
      console.log(`Message reçu: buildingRemoved pour le bâtiment ${message.id}`);
      
      // Rechercher d'abord le sprite dans la map des bâtiments
      let sprite = this.getBuildingSprites().get(message.id);
      
      if (!sprite) {
        // Si le sprite n'est pas trouvé dans la map, chercher parmi tous les sprites
        console.warn(`Sprite du bâtiment ${message.id} non trouvé dans la map, recherche parmi tous les sprites...`);
        
        // Rechercher parmi tous les sprites de la scène
        this.children.list.forEach((child: any) => {
          if (child.type === 'Sprite' && child.getData('buildingId') === message.id) {
            console.log(`Sprite du bâtiment ${message.id} trouvé par recherche secondaire`);
            sprite = child;
          }
        });
      }
      
      if (sprite) {
        console.log(`Suppression du sprite pour le bâtiment ${message.id}`);
        
        // Désélectionner le bâtiment s'il est sélectionné
        if (this.selectedBuilding === message.id) {
          this.selectBuilding(""); // Désélectionner en passant une chaîne vide
        }
        
        // Supprimer tous les écouteurs d'événements pour éviter les fuites de mémoire
        sprite.removeAllListeners();
        
        // Détruire le sprite
        sprite.destroy();
        
        // Retirer de la map
        this.getBuildingSprites().delete(message.id);
        
        console.log(`Sprite du bâtiment ${message.id} supprimé avec succès`);
      } else {
        console.warn(`Impossible de trouver le sprite du bâtiment ${message.id} pour le supprimer`);
      }
    });

    this.room.onMessage("systemNotice", (message) => {
      // ... existing code ...
    });

    // Configurer les gestionnaires d'événements réseau pour les bâtiments
    // this.buildingSystem.setupNetworkHandlers(this.room);
    
    // Ajouter un gestionnaire pour les joueurs qui rejoignent le jeu
    this.room.state.players.onAdd = (player, sessionId) => {
      console.log(`Joueur ajouté: ${sessionId}`);
      if (sessionId !== this.room.sessionId) {
        this.createPlayerSprite(player, sessionId);
      }
    };
    
    // Ajouter un gestionnaire pour le message playerAdded
    this.room.onMessage("playerAdded", (message) => {
      const { id: sessionId, x, y, name, hue } = message;
      console.log(`Message playerAdded reçu: ${sessionId} à la position ${x},${y}`);
      
      // Ne pas créer de sprite pour notre propre joueur
      if (sessionId === this.room.sessionId) {
        console.log("C'est notre joueur, pas besoin de créer un sprite");
        return;
      }
      
      // Utiliser la méthode createPlayerSprite au lieu de créer directement un sprite
      if (!this.otherPlayers.has(sessionId)) {
        this.createPlayerSprite({
          x, y, name, hue
        }, sessionId);
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
      const existingSprite = this.otherPlayers.get(sessionId);
      if (existingSprite) {
        existingSprite.destroy();
        this.otherPlayers.delete(sessionId);
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

      // Ajouter le texte au container pour qu'il suive le joueur
      container.add(nameText);
      nameText.setPosition(0, -15); // Positionner au-dessus du carré du joueur
      
      // Stocker des données pour l'interpolation et l'animation
      container.setData('targetX', x);
      container.setData('targetY', y);
      container.setData('nameText', nameText);
      container.setData('playerId', sessionId);
      
      // Stocker le container dans la map des autres joueurs
      this.otherPlayers.set(sessionId, container);
      
      console.log(`Sprite créé pour le joueur ${sessionId} à la position (${x}, ${y})`);
      return container;
    } catch (error) {
      console.error("Erreur lors de la création du sprite:", error);
      return null;
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
    
    // Obtenir le delta time depuis la dernière frame (en secondes)
    const delta = this.game.loop.delta / 1000;
    
    // CORRECTION: Utiliser un deltaTime normalisé à 60 FPS
    // Fixer la vitesse de déplacement indépendamment du FPS
    // La constante 1/60 = 0.01666... est le temps d'une frame à 60 FPS
    const normalizedDelta = delta / (1/60);
    
    // Mettre à jour la position avec la précision subpixel
    // La vitesse est maintenant correctement ajustée par rapport au taux de rafraîchissement idéal
    this.actualX += dx * this.playerSpeed * normalizedDelta;
    this.actualY += dy * this.playerSpeed * normalizedDelta;
    
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
  }
  
  // Vérifier si une tuile contient un mur
  private isWallAt(x: number, y: number): boolean {
    // Convertir les coordonnées en pixels en indices de tuiles
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    
    // Vérifier si on est hors limites
    if (tileX < 0 || tileY < 0) {
      return true; // Considérer les limites négatives comme des murs
    }
    
    // Vérifier les murs du serveur
    if (this.room && this.room.state) {
      // Vérifions les bâtiments d'abord (ils sont plus dynamiques)
      for (const [_, building] of this.room.state.buildings.entries()) {
        const buildingTileX = Math.floor(building.x / TILE_SIZE);
        const buildingTileY = Math.floor(building.y / TILE_SIZE);
        
        // Si c'est un mur ou un bâtiment avec collision sur toute la case
        if (buildingTileX === tileX && buildingTileY === tileY && 
            (building.type === 'wall' || building.type === 'gate' || building.type === 'tower')) {
          return true;
        }
      }
      
      // À terme, le serveur devrait nous envoyer cette information
      // en attendant, on considère qu'il n'y a des murs que sur les bords extérieurs
      // de la carte (plus facile que de parser mapLines du serveur)
      
      // Considérer les bords de la carte comme des murs
      // Taille de la carte en tuiles (correspond à ce qu'on a défini dans createBasicGrassTiles)
      const mapWidth = 150;
      const mapHeight = 150;
      
      if (tileX >= mapWidth - 1 || tileY >= mapHeight - 1) {
        return true; // Bord de la carte = mur
      }
      
      if (tileX === 0 || tileY === 0) {
        return true; // Bord de la carte = mur
      }
    }
    
    // Par défaut, pas de mur
    return false;
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
        
        if (distance < 22) { // Augmenté de 12 à 22 pixels pour une collision plus large
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
          // L'or utilise un octogone avec un rayon de 28 pixels
          const goldCorners = [
            {dx: -19, dy: -8}, {dx: -8, dy: -19}, 
            {dx: 8, dy: -19}, {dx: 19, dy: -8},
            {dx: 19, dy: 8}, {dx: 8, dy: 19}, 
            {dx: -8, dy: 19}, {dx: -19, dy: 8}
          ];
          
          // Vérifier si le point est à l'intérieur du polygone octogonal
          let insideGold = false;
          for (let i = 0, j = goldCorners.length - 1; i < goldCorners.length; j = i++) {
            const xi = resourceX + goldCorners[i].dx;
            const yi = resourceY + goldCorners[i].dy;
            const xj = resourceX + goldCorners[j].dx;
            const yj = resourceY + goldCorners[j].dy;
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) insideGold = !insideGold;
          }
          
          if (insideGold) {
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
          // Les pierres utilisent un octogone avec un rayon de 29 pixels
          const stoneCorners = [
            {dx: -20, dy: -8}, {dx: -8, dy: -20}, 
            {dx: 8, dy: -20}, {dx: 20, dy: -8},
            {dx: 20, dy: 8}, {dx: 8, dy: 20}, 
            {dx: -8, dy: 20}, {dx: -20, dy: 8}
          ];
          
          // Vérifier si le point est à l'intérieur du polygone octogonal
          let insideStone = false;
          for (let i = 0, j = stoneCorners.length - 1; i < stoneCorners.length; j = i++) {
            const xi = resourceX + stoneCorners[i].dx;
            const yi = resourceY + stoneCorners[i].dy;
            const xj = resourceX + stoneCorners[j].dx;
            const yj = resourceY + stoneCorners[j].dy;
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) insideStone = !insideStone;
          }
          
          if (insideStone) {
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
    // Vérifier si la méthode est appelée (réduire la fréquence des logs)
    if (Math.random() < 0.02) { // Seulement 2% des frames pour éviter trop de logs
      console.log(`updateOtherPlayers appelé avec ${this.otherPlayers.size} autres joueurs à traiter`);
    }
    
    this.otherPlayers.forEach((playerSprite, sessionId) => {
      if (sessionId === this.room?.sessionId) return; // Ignorer notre propre joueur
      
      const targetX = playerSprite.getData('targetX');
      const targetY = playerSprite.getData('targetY');
      
      // Ignorer s'il n'y a pas de destination définie
      if (targetX === undefined || targetY === undefined) {
        if (Math.random() < 0.01) { // Log moins fréquent
          console.log(`Joueur ${sessionId}: Pas de destination définie!`);
        }
        return;
      }
      
      // Ignorer les mises à jour de position pour les joueurs morts
      if (playerSprite.getData('isDead') === true) {
        // Mettre à jour uniquement la position du texte "MORT" si présent
        const deadText = playerSprite.getData('deadText');
        if (deadText && deadText.setPosition) {
          deadText.setPosition(playerSprite.x, playerSprite.y - 30);
        }
        return;
      }
      
      // Vérifier si la position a réellement changé et si la différence est significative
      const diffX = Math.abs(playerSprite.x - targetX);
      const diffY = Math.abs(playerSprite.y - targetY);
      const minThreshold = 0.001; // Seuil minimum pour éviter les calculs inutiles
      const needsUpdate = diffX > minThreshold || diffY > minThreshold;
      
      // N'effectuer l'interpolation que si la position a réellement changé
      if (needsUpdate) {
        // Calculer le facteur d'interpolation basé sur delta et distance
        const distance = Math.sqrt(diffX * diffX + diffY * diffY);
        
        // Facteur de base normalisé par delta
        const normalizedDelta = delta / 16.67; // 16.67ms = 60fps
        let lerpFactor = PerformanceManager.lerpFactor * normalizedDelta;
        
        // Adaptation dynamique du facteur en fonction de la distance
        // Plus la distance est grande, plus l'interpolation est rapide pour rattraper
        if (distance > 50) {
          // Accélération exponentielle pour les grandes distances
          lerpFactor = Math.min(lerpFactor * 1.5 * (distance / 50), 1);
        } else if (distance > 20) {
          // Accélération intermédiaire
          lerpFactor = Math.min(lerpFactor * 1.25, 1);
        } else if (distance < 5) {
          // Ralentissement pour les petites distances pour plus de précision
          lerpFactor = Math.max(lerpFactor * 0.8, 0.01);
        }
        
        // Interpolation avec un facteur adapté
        playerSprite.x = Phaser.Math.Linear(playerSprite.x, targetX, lerpFactor);
        playerSprite.y = Phaser.Math.Linear(playerSprite.y, targetY, lerpFactor);
        
        // Log seulement pour les grands mouvements et moins fréquemment
        if (distance > 5 && Math.random() < 0.05) {
          console.log(`Interpolation joueur ${sessionId}: 
            Distance: ${distance.toFixed(2)} pixels
            Facteur: ${lerpFactor.toFixed(3)}
            Position: (${playerSprite.x.toFixed(2)}, ${playerSprite.y.toFixed(2)}) → (${targetX.toFixed(2)}, ${targetY.toFixed(2)})
          `);
        }
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
      
      // Configuration du système hybride (filtrage natif + personnalisé)
      this.setupHybridNetworkSystem();
      
      // Attendre la réception des données initiales
      return await new Promise<boolean>((resolve) => {
        // Variables pour suivre la réception des messages critiques
        let mainPlayerDataReceived = false;
        let initialResourcesReceived = false;
        let initialEntitiesReceived = false;
        let initializationCompleteReceived = false;
        
        // Définir un timeout de sécurité (8 secondes)
        const timeout = setTimeout(() => {
          console.warn("Timeout d'attente des données initiales - passage en mode dégradé");
          resolve(true); // Continuer malgré tout pour éviter le blocage complet
        }, 8000);
        
        // Vérifier si nous avons reçu toutes les données nécessaires
        const checkInitDataComplete = () => {
          console.log(`État de la réception des données: 
            MainPlayer=${mainPlayerDataReceived}, 
            Resources=${initialResourcesReceived}, 
            Entities=${initialEntitiesReceived}, 
            Complete=${initializationCompleteReceived}`);
          
          // Si nous avons reçu le message d'initialisation complète, c'est suffisant
          if (initializationCompleteReceived) {
            clearTimeout(timeout);
            console.log("Initialisation confirmée par le serveur");
            resolve(true);
            return;
          }
          
          // Vérifier si on a reçu les données critiques (joueur principal et ressources)
          if (mainPlayerDataReceived && initialResourcesReceived) {
            clearTimeout(timeout);
            console.log("Données critiques reçues - initiation complète");
            resolve(true);
            return;
          }
          
          // Vérifier le cas des données traditionnelles si le nouveau système échoue
          if (this.playerEntity && initialResourcesReceived && initialEntitiesReceived) {
            clearTimeout(timeout);
            console.log("Données traditionnelles reçues - initiation complète");
            resolve(true);
          }
        };
        
        // Handler pour les données du joueur principal
        const onMainPlayerData = (data) => {
          console.log("Données du joueur principal reçues");
          mainPlayerDataReceived = true;
          this.room.onMessage("mainPlayerData", onMainPlayerData, false); // Se désabonner
          checkInitDataComplete();
        };
        
        // Handler temporaire pour les ressources initiales
        const onInitialResources = (data) => {
          console.log(`Ressources initiales reçues: ${data.length} ressources`);
          initialResourcesReceived = true;
          this.room.onMessage("initialResources", onInitialResources, false); // Se désabonner
          checkInitDataComplete();
        };
        
        // Handler temporaire pour les entités initiales
        const onInitialEntities = (data) => {
          console.log("Entités initiales reçues");
          initialEntitiesReceived = true;
          this.room.onMessage("initialEntities", onInitialEntities, false); // Se désabonner
          checkInitDataComplete();
        };
        
        // Handler pour le message de confirmation d'initialisation complète
        const onInitializationComplete = (data) => {
          console.log("Message de confirmation d'initialisation reçu:", data);
          initializationCompleteReceived = true;
          this.room.onMessage("initializationComplete", onInitializationComplete, false); // Se désabonner
          checkInitDataComplete();
        };
        
        // S'abonner aux messages pour les données initiales
        this.room.onMessage("initialResources", onInitialResources);
        this.room.onMessage("initialEntities", onInitialEntities);
        this.room.onMessage("initializationComplete", onInitializationComplete);
      });
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
  

  /**
   * Cache un chunk qui n'est plus dans la distance de rendu
   * @param chunkX Coordonnée X du chunk
   * @param chunkY Coordonnée Y du chunk
   */



  
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
    // Si le mode placement de bâtiment est actif, tenter de placer le bâtiment
    if (this.buildingSystem && this.buildingSystem.isPlacingBuilding) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      // Calcul du centre de la tuile (ce qui correspond à ce qu'utilise la prévisualisation)
      const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
      const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE/2;
      this.buildingSystem.handlePlaceBuildingAt(tileX, tileY);
      return;
    }
    
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
    
    // Récupérer la quantité qui sera récoltée pour ce type de ressource
    const harvestAmount = HARVEST_AMOUNT[resource.type as ResourceType] || 1;
    
    // Envoyer un message au serveur pour récolter
    if (this.room) {
      this.room.send("harvest", {
        resourceId: resource.id,
        type: resource.type
      });
      
      // Ajouter l'effet de tremblement
      this.addShakeEffect(resourceSprite, 0.5);
      
      // Afficher l'effet avec la quantité correcte
      this.showNumericEffect(`+${harvestAmount}`, resourceSprite.x, resourceSprite.y, resource.type);
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
    
    // Vérifier si la texture existe
    if (!this.textures.exists(type)) {
      console.error(`ERREUR: La texture ${type} n'existe pas! Utilisation d'une texture de remplacement.`);
      // Utiliser une texture de secours
      if (this.textures.exists('gold')) {
        type = 'gold';
      } else if (this.textures.exists('wood')) {
        type = 'wood';
      } else if (this.textures.exists('stone')) {
        type = 'stone';
      } else {
        console.error("ERREUR CRITIQUE: Aucune texture de ressource disponible!");
        // Créer un rectangle de couleur comme fallback
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffff00, 1);
        graphics.fillRect(-16, -16, 32, 32);
        graphics.generateTexture('resource_fallback', 32, 32);
        type = 'resource_fallback';
      }
    }
    
    console.log(`Utilisation de la texture: ${type}`);
    
    try {
      // Créer le sprite avec la texture appropriée
    const sprite = this.add.sprite(x, y, type);
      
      // Stocker les informations importantes
    sprite.setData('type', type);
    sprite.setData('amount', RESOURCE_AMOUNTS[type as ResourceType] || 100);
    sprite.setData('isRespawning', false);
      sprite.setData('originalPosition', { x, y });
      
      // S'assurer que le sprite est visible et bien positionné
      sprite.setVisible(true);
      sprite.setAlpha(1);
      sprite.setScale(1);
    
    // Définir la profondeur pour s'assurer que la ressource est visible
      sprite.setDepth(10); // Plus élevé que les tuiles d'herbe
    
    // Ajouter une interaction au clic
    sprite.setInteractive();
    
    // Vérifier que le sprite a été créé correctement
    if (!sprite.texture || sprite.texture.key !== type) {
        console.error(`Erreur: La texture ${type} n'a pas été chargée correctement pour le sprite`);
    } else {
        console.log(`Ressource créée avec succès: ${type} (${sprite.width}x${sprite.height}) à (${sprite.x}, ${sprite.y})`);
    }
      
    
    return sprite;
    } catch (error) {
      console.error(`Erreur lors de la création du sprite: ${error}`);
      // Fallback: créer un rectangle coloré
      const graphics = this.add.graphics();
      graphics.fillStyle(0xff0000, 1);
      graphics.fillRect(-16, -16, 32, 32);
      graphics.generateTexture('resource_fallback', 32, 32);
      const fallbackSprite = this.add.sprite(x, y, 'resource_fallback');
      fallbackSprite.setData('type', type);
      fallbackSprite.setData('amount', 100);
      fallbackSprite.setDepth(10);
      fallbackSprite.setInteractive();
      return fallbackSprite;
    }
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
  private showNumericEffect(text: string, x: number, y: number, type: string = '', scale: number = 1) {
    // Vérifier si le groupe d'effets existe, sinon le créer
    if (!this.numericEffects) {
      this.numericEffects = this.add.group();
    }
    
    // Déterminer la couleur en fonction du type
    let color = '#ffffff';
    if (type) {
      switch (type) {
        case 'gold':
          color = '#FFD700';
          break;
        case 'wood':
          color = '#8B4513';
          break;
        case 'stone':
          color = '#A9A9A9';
          break;
        case 'iron':
          color = '#A19D94';
          break;
        case 'coal':
          color = '#1A1A1A';
          break;
        case 'steel':
          color = '#708090';
          break;
        default:
          if (text.startsWith('-')) {
            color = '#ff0000'; // Rouge pour les dégâts
          } else if (text.startsWith('+')) {
            color = '#00ff00'; // Vert pour les gains
          }
      }
    }
    
    // Créer directement un nouvel effet textuel en contournant les problèmes de pool
    const textEffect = this.add.text(x, y, text, { 
      fontSize: `${16 * scale}px`, 
      fontFamily: 'Arial', 
      color: color,
      stroke: '#000000',
      strokeThickness: 3
    });
    textEffect.setOrigin(0.5);
    
    // S'assurer que le texte est visible et au premier plan
    textEffect.setDepth(100);
    textEffect.setVisible(true);
    
    // Animer le texte
    this.tweens.add({
      targets: textEffect,
      y: y - 30 * scale,
      alpha: 0,
      scale: scale * 1.2,
      duration: 1500, // Durée plus longue pour mieux voir l'effet
      ease: 'Power2',
      onComplete: () => {
        textEffect.destroy();
      }
    });
    
    // Pour debug : afficher les coordonnées et les valeurs dans la console
    console.log(`Affichage effet numérique "${text}" à (${x}, ${y}) avec échelle ${scale} et couleur ${color}`);
    
    return textEffect;
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


  private startPlacingBuilding(buildingType: string) {
    this.buildingSystem.startPlacingBuilding(buildingType);
  }

  private stopPlacingBuilding() {
    this.buildingSystem.stopPlacingBuilding();
  }

  // Nouvelle méthode pour annuler complètement le mode de placement
  private cancelPlacingBuilding() {
    this.buildingSystem.stopPlacingBuilding();
  }

  private checkCanPlaceBuilding(tileX: number, tileY: number): boolean {
    // Déléguer au buildingSystem
    return this.buildingSystem.checkCanPlaceBuilding(tileX, tileY);
  }

  // Nouvelle méthode pour optimiser le rendu
  private optimizeRendering() {
    if (!this.player || !this.cameras.main) return;

    // Calculer la zone visible à l'écran avec une marge adaptative
    const camera = this.cameras.main;
    const margin = 100 * PerformanceManager.effectsQuality; // Marge adaptative en fonction de la qualité
    
    this.visibleScreenRect.setTo(
      camera.scrollX - margin,
      camera.scrollY - margin,
      camera.width + margin * 2,
      camera.height + margin * 2
    );

    // Utiliser un compteur pour limiter le nombre d'opérations par frame
    let operationsCount = 0;
    // Adapter le nombre maximum d'opérations en fonction de la qualité et des FPS
    const maxOperationsPerFrame = PerformanceManager.fps < 25 ? 50 : 
                                 PerformanceManager.fps < 40 ? 75 : 100;
    
    // Pour les connexions très lentes, optimiser uniquement les ressources et unités les plus importantes
    const isLowPerformance = PerformanceManager.qualityLevel === QualityLevel.LOW && PerformanceManager.fps < 25;
    
    // Optimiser les ressources (priorité la plus haute)
    for (const [id, sprite] of this.resourceSprites.entries()) {
      if (operationsCount >= maxOperationsPerFrame) break;
      
      const isVisible = this.visibleScreenRect.contains(sprite.x, sprite.y);
      if (sprite.visible !== isVisible) {
        sprite.setVisible(isVisible);
        sprite.setActive(isVisible);
        operationsCount++;
      }
    }
    
    // S'il reste des opérations disponibles, optimiser les unités
    if (operationsCount < maxOperationsPerFrame) {
      for (const [id, data] of this.unitSprites.entries()) {
        if (operationsCount >= maxOperationsPerFrame) break;
        
        const isVisible = this.visibleScreenRect.contains(data.sprite.x, data.sprite.y);
        if (data.sprite.visible !== isVisible) {
          data.sprite.setVisible(isVisible);
          data.sprite.setActive(isVisible);
          
          // En mode performances très basses, limiter les mises à jour de textes
          if (!isLowPerformance || isVisible) {
            // Optimiser aussi le texte du nom
            if (data.nameText) {
              data.nameText.setVisible(isVisible);
              data.nameText.setActive(isVisible);
            }
          }
          operationsCount++;
        }
      }
    }

    // S'il reste des opérations disponibles, optimiser les bâtiments
    // En mode performances très basses, ne pas optimiser les bâtiments à chaque frame
    const shouldOptimizeBuildings = !isLowPerformance || (this.time.now % 2 === 0);
    if (operationsCount < maxOperationsPerFrame && shouldOptimizeBuildings) {
      for (const [id, sprite] of this.getBuildingSprites().entries()) {
        if (operationsCount >= maxOperationsPerFrame) break;
        
        const isVisible = this.visibleScreenRect.contains(sprite.x, sprite.y);
        if (sprite.visible !== isVisible) {
          sprite.setVisible(isVisible);
          sprite.setActive(isVisible);
          operationsCount++;
        }
      }
    }
    
    // Si on a atteint la limite d'opérations ou si on est en mode performances basses,
    // planifier une autre optimisation plus rapidement
    if (operationsCount >= maxOperationsPerFrame || isLowPerformance) {
      this.lastRenderOptimization = this.time.now - (PerformanceManager.renderOptimizationInterval / 2);
    }
  }

  private updateBuildingPreview(tileX: number, tileY: number) {
    // Déléguer à BuildingSystem pour mettre à jour l'aperçu
    this.buildingSystem.updateBuildingPreview(tileX, tileY);
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
    this.buildingSystem.selectBuilding(buildingId);
  }
  
  // Méthode pour détruire le bâtiment sélectionné
  private destroySelectedBuilding() {
    this.buildingSystem.destroySelectedBuilding();
  }
  
  // Méthode pour mettre à jour les barres de progression des bâtiments de production
  private updateProductionBars() {
    this.buildingSystem.updateProductionBars();
  }

  // Ajouter un sprite d'unité
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
    
    // Créer la forme de l'unité selon son type
    const graphics = this.add.graphics();
    
    if (unit.type === "villager") {
      // Villageois : cercle plus petit que le joueur (70%)
      const unitSize = 6 * 0.7; // 70% de la taille du joueur
      
      // Remplir avec la couleur du propriétaire
      graphics.fillStyle(color, 1);
      graphics.fillCircle(0, 0, unitSize/2);
      
      // Contour plus foncé
      const darkerColor = this.getDarkerColor(color);
      graphics.lineStyle(1, darkerColor, 1);
      graphics.strokeCircle(0, 0, unitSize/2);
    } else {
      // Guerrier (ou autre type) : carré
      const unitSize = 6 * 0.75; // 75% de la taille du joueur
    
      // Remplir avec la couleur du propriétaire
      graphics.fillStyle(color, 1);
      graphics.fillRect(-unitSize/2, -unitSize/2, unitSize, unitSize);
      
      // Contour plus foncé
      const darkerColor = this.getDarkerColor(color);
      graphics.lineStyle(1, darkerColor, 1);
      graphics.strokeRect(-unitSize/2, -unitSize/2, unitSize, unitSize);
    }
    
    // Ajouter le graphique au container
    container.add(graphics);
    
    // Stocker les données directement dans le sprite via setData (comme pour les joueurs)
    container.setData('targetX', unit.targetX || unit.x);
    container.setData('targetY', unit.targetY || unit.y);
    container.setData('type', unit.type);
    container.setData('owner', unit.owner);
    container.setData('health', unit.health);
    container.setData('maxHealth', unit.maxHealth);
    container.setData('state', unit.state || 'idle');
    container.setData('unitId', unitId);
    
    // Log pour débogage détaillé
    if (Math.random() < 0.1) { // Limiter à 10% des cas
      console.log(`Unité ${unitId} créée avec targetX=${container.getData('targetX')}, targetY=${container.getData('targetY')}`);
    }
    
    // Stocker uniquement l'essentiel dans la map unitSprites (nouvelle structure simplifiée)
    this.unitSprites.set(unitId, {
      sprite: container,
      nameText: undefined // Pas de texte pour les unités
    });
    
    return container;
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

  // Ces méthodes ne sont pas encore implémentées dans BuildingSystem, donc nous les gardons ici
  // mais nous les appellerons depuis le BuildingSystem à l'avenir.

  /**
   * Met à jour la position des unités via une interpolation douce
   */
  private updateUnits() {
    // Log pour vérifier si la méthode est appelée et le nombre d'unités
    console.log(`========== updateUnits: ${this.unitSprites.size} unités à traiter ==========`);
    
    // Facteur d'interpolation adaptif basé sur la qualité détectée
    const baseLerpFactor = this.LERP_FACTOR * 0.8;
    const qualityFactor = PerformanceManager.qualityLevel === QualityLevel.LOW ? 1.8 : 
                          PerformanceManager.qualityLevel === QualityLevel.MEDIUM ? 1.4 : 1.0;
    const lerpFactor = baseLerpFactor * qualityFactor;
    
    // Mise à jour de chaque unité
    let unitsMoved = 0;
    let unitsWithValidTargets = 0;
    let unitsWithoutTargets = 0;
    
    this.unitSprites.forEach((unitData, unitId) => {
      const sprite = unitData.sprite;
      
      // IMPORTANT: Log détaillé pour voir les données stockées dans le sprite
      console.log(`Unité ${unitId} (${sprite.getData('type')}):
        - position actuelle: (${sprite.x.toFixed(2)}, ${sprite.y.toFixed(2)})
        - targetX: ${sprite.getData('targetX')}
        - targetY: ${sprite.getData('targetY')}
        - owner: ${sprite.getData('owner')}
      `);
      
      const targetX = sprite.getData('targetX');
      const targetY = sprite.getData('targetY');
      
      // Vérifier que les cibles sont des nombres valides (car undefined est considéré comme falsy)
      if (targetX !== undefined && targetY !== undefined && 
          !isNaN(targetX) && !isNaN(targetY)) {
        
        unitsWithValidTargets++;
        const dx = targetX - sprite.x;
        const dy = targetY - sprite.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        console.log(`Unité ${unitId}: distance à la cible = ${distance.toFixed(2)} pixels`);
        
        // NOUVEAU: Vérifier si la cible est différente de la position actuelle
        if (distance < 0.001) {
          console.log(`Unité ${unitId}: Déjà à la position cible (${targetX}, ${targetY})`);
          return; // Passer à l'unité suivante
        }
        
        // Si la distance est significative, utiliser l'interpolation
        if (distance > 0.1) {
          // Facteur d'interpolation adapté à la distance
          // Plus on est loin, plus on se déplace rapidement
          const adaptiveFactor = Math.min(lerpFactor * (1 + distance / 100), 0.25);
          
          // NOUVEAU: Enregistrer l'ancienne position pour voir le mouvement
          const oldX = sprite.x;
          const oldY = sprite.y;
          
          // Interpolation linéaire avec facteur adaptatif
          sprite.x += dx * adaptiveFactor;
          sprite.y += dy * adaptiveFactor;
          
          // Log du mouvement
          console.log(`⮕ Unité ${unitId} déplacée: (${oldX.toFixed(2)}, ${oldY.toFixed(2)}) → (${sprite.x.toFixed(2)}, ${sprite.y.toFixed(2)})`);
          unitsMoved++;
          
          // Pour les unités en mouvement, orienter le sprite dans la direction du mouvement
          if (distance > 1) {
            // Calculer l'angle de rotation en radians
            const angle = Math.atan2(dy, dx);
            // Récupérer l'unité principale (souvent le rectangle)
            const unitRect = sprite.getAt(0) as Phaser.GameObjects.Rectangle;
            if (unitRect) {
              // Appliquer la rotation
              unitRect.rotation = angle;
            }
          }
        } else {
          // Si nous sommes très proches de la cible, aligner parfaitement
          sprite.x = targetX;
          sprite.y = targetY;
          console.log(`Unité ${unitId} alignée parfaitement sur (${targetX}, ${targetY})`);
        }
      } else {
        unitsWithoutTargets++;
        console.warn(`⚠️ Unité ${unitId}: cibles non définies ou invalides! targetX=${targetX}, targetY=${targetY}`);
      }
    });
    
    // Résumé global à la fin
    console.log(`
    ==== RÉSUMÉ DU DÉPLACEMENT DES UNITÉS ====
    🔹 Total d'unités: ${this.unitSprites.size}
    ✅ Unités avec cibles valides: ${unitsWithValidTargets}
    ❌ Unités sans cibles valides: ${unitsWithoutTargets}
    🚶 Unités effectivement déplacées: ${unitsMoved}
    `);
  }

  // Nouvelle méthode pour vérifier la synchronisation entre les unités locales et serveur
  private checkUnitSynchronization() {
    // ... code existant ...
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
    // ... code existant ...
  }
  
  // Afficher un effet de dégâts à une position donnée
  private showDamageEffect(x: number, y: number, damage: number) {
    // ... code existant ...
  }
  
  // Effet de flash rouge pour les dégâts du joueur
  private showPlayerDamageEffect(damage: number) {
    // ... code existant ...
  }
  
  // Alerte de santé critique
  private showCriticalHealthWarning() {
    // ... code existant ...
  }
  
  // Afficher l'écran de mort
  private showDeathScreen(respawnTimeMs: number) {
    // ... code existant ...
  }
  
  // Cacher l'écran de mort
  private hideDeathScreen() {
    // ... code existant ...
  }
  
  // Effet de réapparition
  private showRespawnEffect() {
    // ... code existant ...
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

  // Ajouter un effet de clignotement d'opacité pour les dégâts
  private addDamageFlashEffect(target: Phaser.GameObjects.GameObject, flashes: number = COMBAT.DAMAGE_FLASH_COUNT, flashDuration: number = COMBAT.DAMAGE_FLASH_DURATION) {
    // Arrêter toute animation d'opacité en cours
    this.tweens.killTweensOf(target);
    
    // Sauvegarder l'opacité originale (avec cast pour éviter les erreurs de typage)
    const originalAlpha = (target as any).alpha || 1;
    
    // Appliquer une teinte rouge plus vive à la cible
    if ((target as any).setTint) {
      (target as any).setTint(0xff0000);
    } else if ((target as Phaser.GameObjects.Container).list) {
      // Si c'est un container, appliquer la teinte à tous les sprites à l'intérieur
      (target as Phaser.GameObjects.Container).list.forEach(item => {
        if ((item as any).setTint) {
          (item as any).setTint(0xff0000);
        }
      });
    }
    
    // AMÉLIORÉ: Utiliser une séquence de tweens plus visibles
    // 1. Flash initial rapide et intense avec disparition presque complète
    this.tweens.add({
      targets: target,
      alpha: 0.05, // Presque invisible pour un flash plus prononcé
      duration: flashDuration * 0.7,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // 2. Retour à une opacité normale avec un effet de rebond
        this.tweens.add({
          targets: target,
          alpha: originalAlpha,
          duration: flashDuration * 1.2,
          ease: 'Back.easeOut',
          onComplete: () => {
            // Ajoutons des flashs supplémentaires si nécessaire
            if (flashes > 1) {
              // Créer une séquence de flashs rapides et intenses
              this.createFlashSequence(target, originalAlpha, flashes - 1, flashDuration);
            } else {
              // Si pas de flashs supplémentaires, terminer l'effet
              this.finishDamageEffect(target, originalAlpha, flashDuration);
            }
          }
        });
      }
    });
  }

  // Nouvelle méthode pour créer une séquence de flashs rapides
  private createFlashSequence(target: Phaser.GameObjects.GameObject, originalAlpha: number, count: number, flashDuration: number) {
    // Pour éviter les appels récursifs qui pourraient devenir problématiques
    let remainingFlashes = count;
    
    const flashSequence = () => {
      if (remainingFlashes <= 0) {
        this.finishDamageEffect(target, originalAlpha, flashDuration);
        return;
      }
      
      // Flash rapide d'opacité alternant entre clair et foncé
      this.tweens.add({
        targets: target,
        alpha: 0.3, // Valeur médiane pour un bon contraste
        duration: flashDuration * 0.6,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          remainingFlashes--;
          flashSequence(); // Appel récursif contrôlé
        }
      });
    };
    
    // Démarrer la séquence
    flashSequence();
  }

  // Méthode auxiliaire pour finir l'effet de dégâts
  private finishDamageEffect(target: Phaser.GameObjects.GameObject, originalAlpha: number, flashDuration: number) {
    this.tweens.add({
      targets: target,
      alpha: originalAlpha,
      duration: flashDuration,
      ease: 'Power2.easeOut',
      onComplete: () => {
        // Restaurer l'alpha original
        (target as any).alpha = originalAlpha;
        
        // Retirer la teinte rouge avec un fade
        if ((target as any).clearTint) {
          this.tweens.add({
            targets: target,
            tint: 0xffffff,
            duration: 200,
            ease: 'Linear',
            onComplete: () => {
              (target as any).clearTint();
            }
          });
        } else if ((target as Phaser.GameObjects.Container).list) {
          (target as Phaser.GameObjects.Container).list.forEach(item => {
            if ((item as any).clearTint) {
              this.tweens.add({
                targets: item,
                tint: 0xffffff,
                duration: 200,
                ease: 'Linear',
                onComplete: () => {
                  (item as any).clearTint();
                }
              });
            }
          });
        }
      }
    });
  }

  // Nouvelle méthode pour configurer le système hybride (filtrage natif + système personnalisé)
  private setupHybridNetworkSystem(): void {
    if (!this.room) return;

    // Configurer les gestionnaires d'événements réseau pour les bâtiments en premier
    // IMPORTANT: Ceci doit être appelé avant toute autre configuration liée aux bâtiments
    this.buildingSystem.setupNetworkHandlers(this.room);
    
    // Le reste du code existant continue ici...
    
    // Bâtiments
    // Remarque: La gestion des bâtiments est maintenant entièrement gérée par BuildingSystem
    
    // Unités
    this.room.state.units.onAdd((unit, unitId) => {
      // ... code existant ...
    });
    
    // ... le reste du code existant ...
  }

  // Créer une tuile d'herbe simple pour remplacer la fonctionnalité manquante de tilemap
  private createBasicGrassTiles(): void {
    console.log("Création d'une carte d'herbe complète basée sur les dimensions de la carte du serveur");
    
    // Dimensions de la carte complète basées sur default.map - 150 lignes x 150 colonnes
    const mapWidth = 150;
    const mapHeight = 150;
    
    // Calculer les dimensions en pixels
    const mapWidthPixels = mapWidth * this.tileSize;
    const mapHeightPixels = mapHeight * this.tileSize;
    
    console.log(`Dimensions de la carte: ${mapWidth}x${mapHeight} tuiles (${mapWidthPixels}x${mapHeightPixels} pixels)`);
    
    // Créer un groupe pour stocker toutes les tuiles (optimise le rendu)
    const grassGroup = this.add.group();
    
    // Utiliser une approche plus efficace avec moins de sprites individuels
    // Créer des tuiles d'herbe par blocs de 10x10 tuiles pour réduire le nombre de sprites
    const blockSize = 10; // Taille du bloc en tuiles
    
    for (let blockY = 0; blockY < mapHeight / blockSize; blockY++) {
      for (let blockX = 0; blockX < mapWidth / blockSize; blockX++) {
        // Position en pixels du coin supérieur gauche du bloc
        const blockPixelX = blockX * blockSize * this.tileSize;
        const blockPixelY = blockY * blockSize * this.tileSize;
        
        // Créer un sprite pour ce bloc
        const blockWidth = Math.min(blockSize * this.tileSize, mapWidthPixels - blockPixelX);
        const blockHeight = Math.min(blockSize * this.tileSize, mapHeightPixels - blockPixelY);
        
        if (blockWidth <= 0 || blockHeight <= 0) continue;
        
        // Créer une texture répétée au lieu de plusieurs sprites
        const rt = this.add.renderTexture(blockPixelX, blockPixelY, blockWidth, blockHeight);
        
        // Remplir la texture avec des tuiles d'herbe
        for (let y = 0; y < blockHeight; y += this.tileSize) {
          for (let x = 0; x < blockWidth; x += this.tileSize) {
            // Utiliser uniquement la texture 'grass' comme demandé
            rt.draw('grass', x, y);
          }
        }
        
        // Ajouter la render texture au groupe
        rt.setDepth(0); // S'assurer que l'herbe est sous tout le reste
        grassGroup.add(rt);
      }
    }
    
    // Ajuster les limites de la caméra pour la nouvelle taille de la carte
    this.cameras.main.setBounds(0, 0, mapWidthPixels, mapHeightPixels);
  }

  // Méthode pour afficher les murs au bord de la carte
  private createBorderWalls(): void {
    console.log("Création des murs de bordure de la carte");
    
    // Dimensions de la carte complète basées sur default.map
    const mapWidth = 150;
    const mapHeight = 150;
    
    // Créer un groupe pour stocker tous les murs
    const wallsGroup = this.add.group();
    
    // Fonction pour créer un mur
    const createWall = (x: number, y: number) => {
      const wall = this.add.image(
        x * this.tileSize + this.tileSize/2, 
        y * this.tileSize + this.tileSize/2, 
        'wall'
      );
      wall.setDepth(1); // Au-dessus du sol mais sous les entités
      wallsGroup.add(wall);
      return wall;
    };
    
    // Ajouter les murs horizontaux (haut et bas)
    for (let x = 0; x < mapWidth; x++) {
      // Mur du haut (y = 0)
      createWall(x, 0);
      // Mur du bas (y = mapHeight - 1)
      createWall(x, mapHeight - 1);
    }
    
    // Ajouter les murs verticaux (gauche et droite)
    for (let y = 1; y < mapHeight - 1; y++) {
      // Mur de gauche (x = 0)
      createWall(0, y);
      // Mur de droite (x = mapWidth - 1)
      createWall(mapWidth - 1, y);
    }
  }

  // Initialiser les pools d'objets pour les effets visuels
  private initObjectPools() {
    // Pool pour les effets numériques
    this.textEffectPool = new ObjectPool<Phaser.GameObjects.Text>(
      // Factory pour créer un nouvel effet
      () => {
        const text = this.add.text(0, 0, '', {
          fontSize: '20px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3
        });
        text.setOrigin(0.5);
        text.setDepth(100);
        text.setVisible(false);
        return text;
      },
      // Reset pour réinitialiser l'effet
      (text) => {
        text.setVisible(false);
        text.setScale(1);
        text.setAlpha(1);
        this.tweens.killTweensOf(text);
      },
      // Taille initiale
      10,
      // Taille maximale
      50
    );
    
    // Pool pour les effets de dégâts
    this.damageEffectPool = new ObjectPool<Phaser.GameObjects.Text>(
      // Factory pour créer un nouvel effet
      () => {
        const text = this.add.text(0, 0, '', {
          fontSize: '14px',
          color: '#ff0000',
          stroke: '#000000',
          strokeThickness: 2
        });
        text.setOrigin(0.5);
        text.setDepth(100);
        text.setVisible(false);
        return text;
      },
      // Reset pour réinitialiser l'effet
      (text) => {
        text.setVisible(false);
        text.setScale(1);
        text.setAlpha(1);
        this.tweens.killTweensOf(text);
      },
      // Taille initiale
      10,
      // Taille maximale
      30
    );
  }

  // Méthode pour créer les indicateurs de performance
  private createPerformanceIndicators() {
    // Texte FPS en haut à gauche
    this.fpsText = this.add.text(10, 10, 'FPS: 0', {
      fontSize: '16px', 
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    });
    this.fpsText.setScrollFactor(0);
    this.fpsText.setDepth(1000);
    
    // Texte Ping en haut à gauche, en dessous du FPS
    this.pingText = this.add.text(10, 30, 'Ping: 0ms', {
      fontSize: '16px', 
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    });
    this.pingText.setScrollFactor(0);
    this.pingText.setDepth(1000);
  }

  // Mettre à jour les paramètres en fonction des performances
  private updateDynamicParameters() {
    // Mettre à jour les paramètres pour qu'ils correspondent aux valeurs du gestionnaire
    
    // Gérer le changement de renderDistance progressivement pour éviter les pics
    const newRenderDistance = PerformanceManager.renderDistance;
    if (this.renderDistance !== newRenderDistance) {
      console.log(`Changement de renderDistance: ${this.renderDistance} -> ${newRenderDistance}`);
      // Changement progressif pour éviter les pics
      this.renderDistance = newRenderDistance;
    }
    
    // Mettre à jour les autres paramètres
    this.maxTilePoolSize = PerformanceManager.maxTilePoolSize;
    this.cleanupInterval = PerformanceManager.cleanupInterval;
  }

  // Méthode d'accès aux buildingSprites maintenant gérés par BuildingSystem
  private getBuildingSprites(): Map<string, Phaser.GameObjects.Sprite> {
    return this.buildingSystem.getBuildingSprites();
  }
  
  // Méthode pour accéder à un sprite de bâtiment spécifique
  private getBuildingSprite(buildingId: string): Phaser.GameObjects.Sprite | undefined {
    return this.buildingSystem.getBuildingSprites().get(buildingId);
  }
} 