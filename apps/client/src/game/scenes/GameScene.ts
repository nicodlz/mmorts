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
  BUILDING_COSTS
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
  
  constructor() {
    super({ key: 'GameScene' });
    // @ts-ignore - Ignorer l'erreur de TypeScript pour import.meta.env
    this.client = new Client(import.meta.env?.VITE_COLYSEUS_URL || "ws://localhost:2567");
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
    this.load.image('forge', 'sprites/buildings/forge.png');
    this.load.image('house', 'sprites/buildings/house.png');
    this.load.image('furnace', 'sprites/buildings/furnace.png');
    this.load.image('factory', 'sprites/buildings/factory.png');
    this.load.image('tower', 'sprites/buildings/tower.png');
    this.load.image('barracks', 'sprites/buildings/barracks.png');
    this.load.image('town_center', 'sprites/buildings/town_center.png');
    this.load.image('yard', 'sprites/buildings/yard.png');
    this.load.image('cabin', 'sprites/buildings/cabin.png');
    
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
      // À implémenter: ouvrir le menu de construction
      this.events.emit('toggleBuildMenu');
    });
    
    // Ajouter les événements de souris pour la collecte
    this.input.on('pointerdown', this.handlePointerDown, this);
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

    // Écouter les événements de construction
    this.events.on('buildingSelected', (buildingType: string) => {
      this.startPlacingBuilding(buildingType);
    });

    // Ajouter les événements de la souris pour la construction
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isPlacingBuilding && this.buildingPreview) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE) * TILE_SIZE;
        const tileY = Math.floor(worldPoint.y / TILE_SIZE) * TILE_SIZE;
        
        this.buildingPreview.setPosition(tileX + TILE_SIZE/2, tileY + TILE_SIZE/2);
        
        // Vérifier si on peut placer le bâtiment ici
        this.canPlaceBuilding = this.checkCanPlaceBuilding(tileX, tileY);
        this.buildingPreview.setTint(this.canPlaceBuilding ? 0xffffff : 0xff0000);
      }
    });

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
  }
  
  update(time: number, delta: number) {
    if (!this.player) return;
    
    // Déterminer le chunk actuel du joueur
    const playerChunkX = Math.floor(this.actualX / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.actualY / (this.tileSize * this.CHUNK_SIZE));
    
    // Ne charger les chunks que si le joueur a changé de chunk
    if (playerChunkX !== this.lastLoadedChunkX || playerChunkY !== this.lastLoadedChunkY) {
      // Remplacer updateVisibleTiles par updateVisibleChunks
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
    
    // Vérifier si la position a réellement changé (au-delà d'un certain seuil)
    const hasMoved = Math.abs(this.actualX - this.lastPlayerX) > this.positionThreshold || 
                    Math.abs(this.actualY - this.lastPlayerY) > this.positionThreshold;
    
    // Mettre à jour l'outil seulement si nécessaire
    this.updateTool();
    
    // Gérer le minage et la collecte
    if (this.isMiningActive && this.isToolMode) {
      this.updateMining(time);
    }
    
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
    
    // Mettre à jour les positions des autres joueurs avec interpolation
    this.updateOtherPlayers(delta);
    
    // Synchroniser la position avec le serveur (limité par la fréquence et seulement si on a bougé)
    const now = time;
    if (hasMoved && now - this.lastNetworkUpdate > this.NETWORK_UPDATE_RATE) {
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
  }
  
  // Configuration simplifiée des gestionnaires réseau Colyseus
  private setupNetworkHandlers() {
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
    
    this.room.onMessage("playerLeft", (message) => {
      console.log("Message playerLeft reçu:", message);
      
      // Supprimer le sprite du joueur qui part
      const playerData = this.unitSprites.get(message.sessionId);
      if (playerData) {
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
    this.room.state.listen("units/:id", "add", (unitId, unit) => {
      console.log(`Unité ajoutée: ${unitId}`, unit);
      // Ajouter le code pour gérer les unités ici si nécessaire
    });
    
    // Écouter la suppression d'unités
    this.room.state.listen("units/:id", "remove", (unitId) => {
      console.log(`Unité supprimée: ${unitId}`);
      // Ajouter le code pour gérer la suppression d'unités ici si nécessaire
    });

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

    // Écouter l'ajout de bâtiments
    this.room.state.buildings.onAdd = (building: any, buildingId: string) => {
      console.log(`Bâtiment ajouté: ${buildingId} (type: ${building.type}, position: ${building.x}, ${building.y})`);
      
      // Créer le sprite du bâtiment
      const sprite = this.add.sprite(building.x, building.y, building.type.toLowerCase());
      sprite.setDepth(8); // Au-dessus du sol mais en-dessous des joueurs
      
      // Stocker la référence au sprite
      this.buildingSprites.set(buildingId, sprite);
    };
    
    // Écouter les modifications des bâtiments
    this.room.state.buildings.onChange = (building: any, buildingId: string) => {
      // Récupérer le sprite correspondant
      const buildingSprite = this.buildingSprites.get(buildingId);
      if (!buildingSprite) return;
      
      // Mettre à jour la position si elle a changé
      if (building.x !== undefined && building.y !== undefined) {
        buildingSprite.setPosition(building.x, building.y);
      }
      
      // Mettre à jour d'autres propriétés si nécessaire (santé, état, etc.)
      if (building.health !== undefined) {
        // Ajouter une barre de vie ou un indicateur visuel si nécessaire
      }
    };
    
    // Écouter les suppressions de bâtiments
    this.room.state.buildings.onRemove = (building: any, buildingId: string) => {
      console.log(`Bâtiment supprimé: ${buildingId}`);
      
      // Récupérer et supprimer le sprite
      const buildingSprite = this.buildingSprites.get(buildingId);
      if (buildingSprite) {
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
    this.room.onMessage("initialResources", (resources: any[]) => {
      console.log("Réception des ressources initiales:", resources.length);
      
      // Supprimer toutes les ressources existantes
      this.resourceSprites.forEach(sprite => sprite.destroy());
      this.resourceSprites.clear();
      this.visibleResources.clear();
      
      // Créer les sprites pour les nouvelles ressources
      resources.forEach(resource => {
        this.createResourceSprite(resource);
        this.visibleResources.add(resource.id);
      });
    });

    // Gestionnaire pour les mises à jour des ressources visibles
    this.room.onMessage("updateVisibleResources", (resources: any[]) => {
      console.log(`=== Mise à jour des ressources visibles: ${resources.length} ressources reçues ===`);
      
      // Créer un ensemble des nouvelles ressources
      const newResourceIds = new Set(resources.map(r => r.id));
      
      // Log détaillé des ressources reçues
      console.log("Ressources reçues:", resources.map(r => `${r.id} (${r.type})`).join(', '));
      console.log("Ressources actuellement visibles:", Array.from(this.visibleResources).join(', '));
      
      // Supprimer les ressources qui ne sont plus visibles
      let removedCount = 0;
      this.visibleResources.forEach(id => {
        if (!newResourceIds.has(id)) {
          const sprite = this.resourceSprites.get(id);
          if (sprite) {
            sprite.destroy();
            this.resourceSprites.delete(id);
            removedCount++;
          }
          this.visibleResources.delete(id);
        }
      });
      
      // Ajouter ou mettre à jour les nouvelles ressources
      let addedCount = 0;
      resources.forEach(resource => {
        if (!this.visibleResources.has(resource.id)) {
          this.createResourceSprite(resource);
          this.visibleResources.add(resource.id);
          addedCount++;
        } else {
          // Mettre à jour la ressource existante si nécessaire
          const sprite = this.resourceSprites.get(resource.id);
          if (sprite) {
            sprite.setPosition(resource.x, resource.y);
            // Mettre à jour d'autres propriétés si nécessaire
          }
        }
      });
      
      console.log(`Ressources supprimées: ${removedCount}, ajoutées: ${addedCount}`);
      console.log(`Total des ressources visibles: ${this.visibleResources.size}`);
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
    }
  }
  
  // Mise à jour des autres joueurs avec interpolation
  private updateOtherPlayers(delta: number) {
    this.unitSprites.forEach((data, sessionId) => {
      if (sessionId === this.room?.sessionId) return; // Ignorer notre propre joueur
      
      const { sprite, targetX, targetY, nameText } = data;
      
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
    // Si le joueur n'est pas en mode outil, ignorer
    if (!this.isToolMode || !this.player || !this.tool) return;
    
    // Activer le minage
    this.isMiningActive = true;
    
    // Démarrer immédiatement l'animation
    this.animatePickaxe();
  }
  
  // Gestionnaire d'événement quand le joueur relâche la souris
  private handlePointerUp() {
    this.isMiningActive = false;
    this.isHarvesting = false;
    this.harvestTarget = null;
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
    if (!this.numericEffects) return;

    const color = type === 'gold' ? '#FFD700' : 
                 type === 'wood' ? '#8B4513' : 
                 type === 'stone' ? '#808080' : '#FFFFFF';

    const effect = this.add.text(x, y - 20, text, {
      fontSize: '16px',
      color: color,
      stroke: '#000000',
      strokeThickness: 2
    });
    effect.setOrigin(0.5);
    effect.setDepth(100);

    this.tweens.add({
      targets: effect,
      y: y - 40,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        effect.destroy();
      }
    });
  }
  
  // Ajouter un petit effet de secousse à un sprite
  private addShakeEffect(sprite: Phaser.GameObjects.Sprite, intensity: number = 1) {
    // Sauvegarder la position originale
    const originalX = sprite.x;
    const originalY = sprite.y;
    
    // Réduire l'intensité de vibration
    const offset = intensity;
    
    // Créer une séquence de secousse
    const shakeSequence = [
      { x: offset, y: 0 },
      { x: 0, y: offset },
      { x: -offset, y: 0 },
      { x: 0, y: -offset },
      { x: 0, y: 0 }
    ];
    
    // Fonction pour créer un tween
    const createNextTween = (index: number) => {
      if (index >= shakeSequence.length) return;
      
      const shake = shakeSequence[index];
      this.tweens.add({
        targets: sprite,
        x: originalX + shake.x,
        y: originalY + shake.y,
        duration: 25,
        ease: 'Power1',
        onComplete: () => {
          createNextTween(index + 1);
        }
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
    
    // Créer l'aperçu du bâtiment
    if (this.buildingPreview) {
      this.buildingPreview.destroy();
    }
    
    this.buildingPreview = this.add.sprite(0, 0, buildingType.toLowerCase());
    this.buildingPreview.setAlpha(0.7);
    this.buildingPreview.setDepth(100);
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
    
    for (const [resource, amount] of Object.entries(costs)) {
      const playerResource = player.resources.get(resource) || 0;
      if (playerResource < amount) {
        return false;
      }
    }
    
    // Vérifier si l'emplacement est libre
    for (const [_, building] of this.room.state.buildings.entries()) {
      const buildingTileX = Math.floor(building.x / TILE_SIZE) * TILE_SIZE;
      const buildingTileY = Math.floor(building.y / TILE_SIZE) * TILE_SIZE;
      
      if (buildingTileX === tileX && buildingTileY === tileY) {
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
} 