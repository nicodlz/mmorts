import Phaser from 'phaser';
import { Client } from 'colyseus.js';
import { 
  PlayerSchema, 
  UnitSchema, 
  BuildingSchema, 
  ResourceSchema,
  TILE_SIZE,
  CHUNK_SIZE,
  ResourceType
} from 'shared';

export class GameScene extends Phaser.Scene {
  // Client Colyseus
  private client: Client;
  private room: any;
  
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
  private tileSize: number = 32;
  private loadedTiles: Set<string> = new Set(); // Garder trace des tuiles déjà chargées
  private renderDistance: number = 25; // Augmenté de 15 à 25 pour charger les chunks plus tôt
  
  // Mode de jeu
  private isToolMode: boolean = true;
  
  // Paramètres d'interpolation
  private readonly LERP_FACTOR: number = 0.08; // Facteur d'interpolation réduit pour éviter les à-coups
  private readonly NETWORK_UPDATE_RATE: number = 100; // Millisecondes entre chaque mise à jour réseau
  private lastNetworkUpdate: number = 0;
  
  // Dernière position chargée pour éviter le rechargement constant
  private lastLoadedChunkX: number = -1;
  private lastLoadedChunkY: number = -1;
  private readonly CHUNK_SIZE: number = 8; // Taille des chunks en tuiles
  
  // Ajouter ces propriétés privées dans la classe
  private tileLayers: Map<string, Phaser.GameObjects.Image> = new Map();
  private tilePool: Phaser.GameObjects.Image[] = [];
  private maxTilePoolSize: number = 500;
  private lastCleanupTime: number = 0;
  private cleanupInterval: number = 5000; // 5 secondes entre les nettoyages
  
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
  
  constructor() {
    super({ key: 'GameScene' });
    // @ts-ignore - Ignorer l'erreur de TypeScript pour import.meta.env
    this.client = new Client(import.meta.env?.VITE_COLYSEUS_URL || "ws://localhost:2567");
  }
  
  preload() {
    // Log le début du chargement
    console.log("Début du chargement des assets");
    
    // Désactiver l'interpolation sur toutes les textures (utiliser nearest neighbor pour le pixel art)
    this.textures.on('addtexture', (key: string) => {
      console.log(`Configurant texture ${key} en mode NEAREST`);
      this.textures.get(key).setFilter(Phaser.Textures.NEAREST);
    });
    
    // Afficher un message quand un asset est chargé
    this.load.on('filecomplete', (key, type, data) => {
      console.log(`Asset chargé: ${key} (type: ${type})`);
      // Forcer le mode NEAREST pour chaque texture chargée
      if (type === 'image' || type === 'spritesheet') {
        this.textures.get(key).setFilter(Phaser.Textures.NEAREST);
        console.log(`Mode NEAREST appliqué à ${key}`);
      }
    });
    
    // Afficher un message en cas d'erreur de chargement
    this.load.on('loaderror', (file) => {
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
      this.textures.get(key).setFilter(Phaser.Textures.NEAREST);
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
    });
    
    // B pour ouvrir le menu de construction
    this.bKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.bKey.on('down', () => {
      // À implémenter: ouvrir le menu de construction
      this.events.emit('toggleBuildMenu');
    });
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
    
    // Position du joueur au centre de la carte
    const mapCenterX = this.tileSize * 50;
    const mapCenterY = this.tileSize * 50;
    
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
    this.tool.setScale(0.8);
    this.tool.setPipelineData('antialiasTexture', false);
    
    // Charger les tuiles autour du joueur
    this.updateVisibleTiles();
    
    // Se connecter au serveur Colyseus avec les infos du joueur
    await this.connectToServer(playerName, playerHue);
    
    // Mettre à jour le curseur
    this.updateCursor();

    // Démarrer la scène UI qui affichera les ressources et autres éléments d'interface
    this.scene.launch('UIScene');
    console.log("Scène UI démarrée");
    
    // Émettre un événement pour initialiser les ressources dans l'UI
    this.updateResourcesUI();
  }
  
  update(time: number, delta: number) {
    if (!this.player) return;
    
    // Déterminer le chunk actuel du joueur
    const playerChunkX = Math.floor(this.actualX / (this.tileSize * this.CHUNK_SIZE));
    const playerChunkY = Math.floor(this.actualY / (this.tileSize * this.CHUNK_SIZE));
    
    // Ne charger les tuiles que si le joueur a changé de chunk
    if (playerChunkX !== this.lastLoadedChunkX || playerChunkY !== this.lastLoadedChunkY) {
      this.updateVisibleTiles();
      this.lastLoadedChunkX = playerChunkX;
      this.lastLoadedChunkY = playerChunkY;
    }
    
    // Gérer le mouvement du joueur
    this.handlePlayerMovement();
    
    // Vérifier si la position a réellement changé (au-delà d'un certain seuil)
    const hasMoved = Math.abs(this.actualX - this.lastPlayerX) > this.positionThreshold || 
                    Math.abs(this.actualY - this.lastPlayerY) > this.positionThreshold;
    
    // Mettre à jour l'outil seulement si nécessaire
    this.updateTool();
    
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
    if (!this.room || !this.playerEntity) return;
    
    this.room.send('move', {
      x: this.actualX,
      y: this.actualY
    });
    
    // Émettre un événement pour mettre à jour la position sur la mini-carte
    this.events.emit('updatePlayerPosition', {
      x: this.actualX,
      y: this.actualY,
      resources: this.resourceSprites
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
    
    // Calculer les coordonnées de la tuile sur laquelle se trouve le joueur
    const playerTileX = Math.floor(this.player.x / this.tileSize);
    const playerTileY = Math.floor(this.player.y / this.tileSize);
    
    // Distance maximale pour le nettoyage (plus grande que renderDistance pour éviter les nettoyages fréquents)
    const cleanupDistance = this.renderDistance + 15;
    
    // Parcourir toutes les tuiles chargées
    this.tileLayers.forEach((tile, key) => {
      // Extraire les coordonnées de la clé (format "x,y")
      const [x, y] = key.split(',').map(Number);
      
      // Calculer la distance au joueur
      const distance = Math.max(Math.abs(x - playerTileX), Math.abs(y - playerTileY));
      
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
    
    console.log(`Nombre de tuiles actives: ${this.tileLayers.size}, Pool: ${this.tilePool.length}`);
  }
  
  // Méthode de chargement de la carte par chunks
  private updateVisibleTiles() {
    if (!this.player || this.mapLines.length === 0) return;
    
    // Nettoyer les tuiles éloignées
    this.cleanupDistantTiles(this.game.loop.time);
    
    // Calculer les coordonnées de la tuile sur laquelle se trouve le joueur
    const playerTileX = Math.floor(this.player.x / this.tileSize);
    const playerTileY = Math.floor(this.player.y / this.tileSize);
    
    // Charger les tuiles dans un carré autour du joueur
    for (let y = playerTileY - this.renderDistance; y <= playerTileY + this.renderDistance; y++) {
      if (y < 0 || y >= this.mapLines.length) continue;
      
      const line = this.mapLines[y];
      if (!line) continue;
      
      for (let x = playerTileX - this.renderDistance; x <= playerTileX + this.renderDistance; x++) {
        if (x < 0 || x >= line.length) continue;
        
        // Clé unique pour cette tuile
        const tileKey = `${x},${y}`;
        
        // Ne pas recharger les tuiles déjà rendues
        if (this.loadedTiles.has(tileKey)) continue;
        
        // Marquer cette tuile comme chargée
        this.loadedTiles.add(tileKey);
        
        const tileX = x * this.tileSize;
        const tileY = y * this.tileSize;
        const tileChar = line[x];
        
        // Utiliser des coordonnées entières pour éviter le scintillement
        const centerX = Math.round(tileX + this.tileSize/2);
        const centerY = Math.round(tileY + this.tileSize/2);
        
        // Créer le sol (utiliser le pool pour réduire la création d'objets)
        let randomGrass = 'grass';
        // Faire en sorte que grass soit 10x plus fréquent que grass2 et grass3
        const grassRandom = Math.random() * 12; // 0-12 au lieu de 0-3
        if (grassRandom > 10) { // si > 10 (environ 1/6 des cas), on utilise grass2 ou grass3
          randomGrass = grassRandom > 11 ? 'grass3' : 'grass2';
        }
        
        // Obtenir une tuile du pool ou en créer une nouvelle
        const grassTile = this.getTileFromPool(randomGrass);
        grassTile.setPosition(centerX, centerY);
        grassTile.setDepth(1); // Tuiles de sol en arrière-plan
        grassTile.setOrigin(0.5);
        
        // Stocker une référence à cette tuile
        this.tileLayers.set(tileKey, grassTile);
        
        // Ajouter des éléments spécifiques sur l'herbe
        switch (tileChar) {
          case '#': // Mur
            const wall = this.add.image(centerX, centerY, 'wall');
            wall.setOrigin(0.5).setDepth(5);
            break;
          case 'W': // Arbre (bois)
            const wood = this.add.sprite(centerX, centerY, 'wood');
            wood.setOrigin(0.5).setScale(0.8).setDepth(5);
            this.resourceSprites.set(`wood_${x}_${y}`, wood);
            break;
          case 'S': // Pierre
            const stone = this.add.sprite(centerX, centerY, 'stone');
            stone.setOrigin(0.5).setScale(0.8).setDepth(5);
            this.resourceSprites.set(`stone_${x}_${y}`, stone);
            break;
          case 'G': // Or
            const gold = this.add.sprite(centerX, centerY, 'gold');
            gold.setOrigin(0.5).setScale(0.8).setDepth(5);
            this.resourceSprites.set(`gold_${x}_${y}`, gold);
            break;
        }
      }
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
} 