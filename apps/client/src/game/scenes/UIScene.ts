import Phaser from 'phaser';
import { ResourceType, BuildingType } from 'shared';

export class UIScene extends Phaser.Scene {
  // Éléments UI
  private resourceTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private buildMenu: Phaser.GameObjects.Container;
  private healthBar: Phaser.GameObjects.Graphics;
  private minimap: Phaser.GameObjects.Graphics;
  private fpsText: Phaser.GameObjects.Text;
  
  // Référence à la scène de jeu
  private gameScene: Phaser.Scene;
  
  constructor() {
    super({ key: 'UIScene' });
  }
  
  create() {
    // Référence à la scène de jeu
    this.gameScene = this.scene.get('GameScene');
    
    // L'UI reste fixe et ne suit pas la caméra principale
    this.cameras.main.setScroll(0, 0);
    
    // Créer l'affichage des ressources
    this.createResourceDisplay();
    
    // Créer la mini-carte (la barre de santé est supprimée)
    this.createMinimap();
    
    // Créer le menu de construction (initialement caché)
    this.createBuildMenu();
    
    // Créer l'affichage des FPS
    this.createFpsCounter();
    
    // Écouter les événements de la scène de jeu
    this.gameScene.events.on('updateResources', this.updateResourceDisplay, this);
    
    // Écouter les événements pour mettre à jour la minimap
    this.gameScene.events.on('updatePlayerPosition', this.updateMinimap, this);
    this.gameScene.events.on('updateResources', this.updateMinimap, this);
    
    // Écouter pour le menu de construction
    this.events.on('toggleBuildMenu', this.toggleBuildMenu, this);
  }
  
  update(time: number, delta: number) {
    // Mettre à jour la mini-carte
    this.updateMinimap();
    
    // Mettre à jour l'affichage des FPS
    this.updateFpsCounter();
  }
  
  // Affichage des ressources
  private createResourceDisplay() {
    // Créer un fond noir semi-transparent pour les ressources
    const padding = 15;
    const width = 85;  // Augmenté pour éviter le débordement horizontal
    const height = 180; // Augmenté de 150 à 180 pour éviter le débordement vertical
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
          fontSize: '14px', 
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
    const width = 180;  // Augmenté de 150 à 180
    const height = 180; // Augmenté de 150 à 180
    const x = this.cameras.main.width - width - 10;
    const y = this.cameras.main.height - height - 10;
    
    // Fond de la mini-carte
    this.minimap = this.add.graphics();
    this.minimap.fillStyle(0x000000, 0.7);
    this.minimap.fillRect(x, y, width, height);
    this.minimap.lineStyle(1, 0x444444);
    this.minimap.strokeRect(x, y, width, height);
    
    // Configurer la mini-carte pour qu'elle reste en bas à droite
    this.minimap.setScrollFactor(0);
    this.minimap.setDepth(10);
    
    // Initialiser une mise à jour immédiate
    this.updateMinimap();
  }
  
  private updateMinimap() {
    if (!this.gameScene || !this.minimap) return;
    
    // Trouver les références aux éléments du jeu
    const gameInstance = this.gameScene as any;
    if (!gameInstance.player || !gameInstance.resourceSprites) return;
    
    // Récupérer les dimensions de la mini-carte
    const width = 180;  // Augmenté de 150 à 180
    const height = 180; // Augmenté de 150 à 180
    const x = this.cameras.main.width - width - 10;
    const y = this.cameras.main.height - height - 10;
    
    // Échelle de la mini-carte (monde du jeu -> mini-carte)
    const mapScale = 0.05; // Ajuster selon la taille du monde
    
    // Effacer la mini-carte précédente sauf le fond
    this.minimap.clear();
    this.minimap.fillStyle(0x000000, 0.9); // Augmenté de 0.5 à 0.7 pour meilleure visibilité
    this.minimap.fillRect(x, y, width, height);
    this.minimap.lineStyle(1, 0x444444);
    this.minimap.strokeRect(x, y, width, height);
    
    // Dessiner les ressources
    if (gameInstance.resourceSprites.size > 0) {
      gameInstance.resourceSprites.forEach((sprite, key) => {
        // Déterminer la couleur en fonction du type de ressource
        let color;
        if (key.includes('gold')) color = 0xFFD700;
        else if (key.includes('wood')) color = 0x8B4513;
        else if (key.includes('stone')) color = 0x808080;
        else color = 0xFFFFFF;
        
        // Calculer la position sur la mini-carte
        const miniX = x + (sprite.x * mapScale);
        const miniY = y + (sprite.y * mapScale);
        
        // Dessiner un point pour cette ressource avec opacité augmentée
        this.minimap.fillStyle(color, 1);  // Opacité augmentée de 0.6 à 0.9
        this.minimap.fillRect(miniX, miniY, 0.8, 0.8);  // Garder la petite taille
      });
    }
    
    // Dessiner le joueur avec opacité maximale
    if (gameInstance.player) {
      const playerX = x + (gameInstance.actualX * mapScale);
      const playerY = y + (gameInstance.actualY * mapScale);
      
      // Dessiner un point plus grand pour le joueur
      this.minimap.fillStyle(0xFF0000, 1);  // Opacité maximale
      this.minimap.fillCircle(playerX, playerY, 3);
    }
  }
  
  // Menu de construction
  private createBuildMenu() {
    const width = 400;
    const height = 300;
    const x = (this.cameras.main.width - width) / 2;
    const y = (this.cameras.main.height - height) / 2;
    
    this.buildMenu = this.add.container(x, y);
    
    // Fond du menu
    const background = this.add.graphics();
    background.fillStyle(0x333333, 1);
    background.fillRect(0, 0, width, height);
    background.lineStyle(2, 0xffffff);
    background.strokeRect(0, 0, width, height);
    
    // Titre
    const title = this.add.text(width/2, 20, 'Construction', { 
      fontSize: '24px', 
      color: '#ffffff' 
    }).setOrigin(0.5);
    
    // Boutons pour chaque bâtiment
    const buildings = [
      { type: BuildingType.FORGE, name: 'Forge', cost: 'Bois: 20, Pierre: 20' },
      { type: BuildingType.HOUSE, name: 'Maison', cost: 'Bois: 10, Pierre: 10' },
      { type: BuildingType.FURNACE, name: 'Four', cost: 'Pierre: 30' },
      { type: BuildingType.FACTORY, name: 'Usine', cost: 'Fer: 20, Pierre: 20' },
      { type: BuildingType.BARRACKS, name: 'Caserne', cost: 'Bois: 10, Fer: 10' }
    ];
    
    buildings.forEach((building, index) => {
      const buttonY = 60 + index * 40;
      
      // Bouton
      const button = this.add.rectangle(width/2, buttonY, 300, 30, 0x666666)
        .setInteractive()
        .on('pointerdown', () => {
          this.selectBuilding(building.type);
        })
        .on('pointerover', () => {
          button.setFillStyle(0x888888);
        })
        .on('pointerout', () => {
          button.setFillStyle(0x666666);
        });
      
      // Texte du bouton
      const text = this.add.text(width/2, buttonY, `${building.name} (${building.cost})`, {
        fontSize: '16px',
        color: '#ffffff'
      }).setOrigin(0.5);
      
      // Ajouter au conteneur
      this.buildMenu.add([button, text]);
    });
    
    // Bouton fermer
    const closeButton = this.add.text(width - 20, 10, 'X', {
      fontSize: '20px',
      color: '#ffffff'
    })
    .setInteractive()
    .on('pointerdown', () => {
      this.toggleBuildMenu();
    });
    
    // Ajouter tous les éléments au conteneur
    this.buildMenu.add([background, title, closeButton]);
    
    // Cacher le menu par défaut
    this.buildMenu.setVisible(false);
  }
  
  private toggleBuildMenu() {
    this.buildMenu.setVisible(!this.buildMenu.visible);
  }
  
  private selectBuilding(buildingType: string) {
    // Cacher le menu
    this.buildMenu.setVisible(false);
    
    // Informer la scène principale
    this.gameScene.events.emit('buildingSelected', buildingType);
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
} 