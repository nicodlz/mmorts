import Phaser from 'phaser';
import { TILE_SIZE } from 'shared';

export class PlayerController {
  private scene: Phaser.Scene;
  private player?: Phaser.GameObjects.Container;
  private tool?: Phaser.GameObjects.Sprite;
  private playerSpeed: number = 3;
  private subPixelFactor: number = 4;
  private actualX: number = 0;
  private actualY: number = 0;
  private lastPlayerX: number = 0;
  private lastPlayerY: number = 0;
  private positionThreshold: number = 0.5;
  private lastNetworkUpdate: number = 0;
  private readonly NETWORK_UPDATE_RATE: number = 100;
  private readonly LERP_FACTOR: number = 0.08;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private tabKey?: Phaser.Input.Keyboard.Key;
  private lastCursorUpdate: number = 0;
  private lastCursorMode: boolean = true;
  private isToolMode: boolean = true;
  private healthBar?: Phaser.GameObjects.Graphics;
  private isPlayerDead: boolean = false;
  private damageTint?: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupControls();
  }

  setupControls() {
    this.cursors = this.scene.input.keyboard.createCursorKeys();
    this.wasdKeys = {
      W: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    };
    this.tabKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    
    // Ajouter des écouteurs pour le changement de mode
    this.tabKey.on('down', () => {
      this.isToolMode = !this.isToolMode;
      this.updateCursor();
    });
  }

  setPlayer(player: Phaser.GameObjects.Container) {
    this.player = player;
    
    // Initialiser la position réelle
    if (player) {
      this.actualX = player.x;
      this.actualY = player.y;
      this.lastPlayerX = player.x;
      this.lastPlayerY = player.y;
    }
  }

  setTool(tool: Phaser.GameObjects.Sprite) {
    this.tool = tool;
  }

  updateTool() {
    if (!this.player || !this.tool) return;
    
    const gameScene = this.scene as any;
    
    // Positionner l'outil à côté du joueur
    const pointer = gameScene.input.activePointer;
    const cameraX = gameScene.cameras.main.scrollX;
    const cameraY = gameScene.cameras.main.scrollY;
    
    // Calculer l'angle entre le joueur et le curseur
    const pointerX = pointer.x + cameraX;
    const pointerY = pointer.y + cameraY;
    
    const dx = pointerX - this.player.x;
    const dy = pointerY - this.player.y;
    const angle = Math.atan2(dy, dx);
    
    // Positionner l'outil à une distance fixe du joueur dans la direction du curseur
    const distance = 30;
    this.tool.x = this.player.x + Math.cos(angle) * distance;
    this.tool.y = this.player.y + Math.sin(angle) * distance;
    
    // Faire pivoter l'outil pour qu'il pointe vers le curseur
    this.tool.rotation = angle;
  }

  updateCursor() {
    // Mettre à jour le curseur en fonction du mode
    const now = Date.now();
    if (now - this.lastCursorUpdate < 100 && this.lastCursorMode === this.isToolMode) return;
    
    this.lastCursorUpdate = now;
    this.lastCursorMode = this.isToolMode;
    
    if (this.isToolMode) {
      this.scene.input.setDefaultCursor('url(assets/cursors/pickaxe_cursor.png), pointer');
    } else {
      this.scene.input.setDefaultCursor('url(assets/cursors/sword_cursor.png), pointer');
    }
  }

  handlePlayerMovement() {
    if (!this.player || !this.cursors || !this.wasdKeys || this.isPlayerDead) return;
    
    const gameScene = this.scene as any;
    
    // Calculer le déplacement en fonction des touches
    let dx = 0;
    let dy = 0;
    
    // Touches directionnelles
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) {
      dx -= this.playerSpeed;
    }
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) {
      dx += this.playerSpeed;
    }
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) {
      dy -= this.playerSpeed;
    }
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) {
      dy += this.playerSpeed;
    }
    
    // Normaliser la diagonale pour éviter une vitesse plus élevée
    if (dx !== 0 && dy !== 0) {
      const length = Math.sqrt(dx * dx + dy * dy);
      dx = (dx / length) * this.playerSpeed;
      dy = (dy / length) * this.playerSpeed;
    }
    
    // Ajouter du subpixel pour un mouvement plus fluide
    this.actualX += dx / this.subPixelFactor;
    this.actualY += dy / this.subPixelFactor;
    
    // Vérifier les collisions avant de déplacer le joueur
    let newX = Math.round(this.actualX);
    let newY = Math.round(this.actualY);
    
    // Si on ne peut pas bouger dans cette direction, rétablir la position précédente
    if (gameScene.isCollisionAt && gameScene.isCollisionAt(newX, newY)) {
      // Essayer de déplacer le joueur seulement en X si possible
      if (!gameScene.isCollisionAt(newX, Math.round(this.player.y))) {
        newY = Math.round(this.player.y);
        this.actualY = this.player.y;
      } 
      // Sinon essayer de déplacer le joueur seulement en Y si possible
      else if (!gameScene.isCollisionAt(Math.round(this.player.x), newY)) {
        newX = Math.round(this.player.x);
        this.actualX = this.player.x;
      } 
      // Si les deux sont bloqués, annuler tout mouvement
      else {
        newX = Math.round(this.player.x);
        newY = Math.round(this.player.y);
        this.actualX = this.player.x;
        this.actualY = this.player.y;
      }
    }
    
    // Mettre à jour la position du joueur
    this.player.x = newX;
    this.player.y = newY;
    
    // Mettre à jour l'outil si présent
    this.updateTool();
    
    // Envoyer les mises à jour de position au serveur
    this.synchronizePlayerPosition();
  }

  synchronizePlayerPosition() {
    // Envoyer les mises à jour au serveur seulement si on a bougé significativement
    // ou si un certain temps s'est écoulé depuis la dernière mise à jour
    if (!this.player) return;
    
    const gameScene = this.scene as any;
    const now = Date.now();
    
    const hasMoved = 
      Math.abs(this.player.x - this.lastPlayerX) > this.positionThreshold ||
      Math.abs(this.player.y - this.lastPlayerY) > this.positionThreshold;
    
    if ((hasMoved || now - this.lastNetworkUpdate > this.NETWORK_UPDATE_RATE) && gameScene.room) {
      gameScene.room.send("move", {
        x: this.player.x,
        y: this.player.y
      });
      
      this.lastPlayerX = this.player.x;
      this.lastPlayerY = this.player.y;
      this.lastNetworkUpdate = now;
    }
  }

  createHealthBar() {
    if (!this.player) return;
    
    // Créer la barre de vie du joueur
    this.healthBar = this.scene.add.graphics();
    this.healthBar.setScrollFactor(0); // Fixer à la caméra
    this.updateHealthBar(100, 100); // 100% de vie au début
    
    // Créer un rectangle pour l'effet de dégâts
    this.damageTint = this.scene.add.rectangle(
      0, 0, 
      this.scene.cameras.main.width, 
      this.scene.cameras.main.height,
      0xff0000
    );
    this.damageTint.setScrollFactor(0);
    this.damageTint.setAlpha(0);
    this.damageTint.setDepth(100);
  }

  updateHealthBar(currentHealth: number, maxHealth: number) {
    if (!this.healthBar) return;
    
    // Dessiner la barre de vie
    this.healthBar.clear();
    
    const width = 200;
    const height = 20;
    const x = 20;
    const y = 20;
    const padding = 2;
    
    // Fond de la barre
    this.healthBar.fillStyle(0x000000, 0.5);
    this.healthBar.fillRect(x - padding, y - padding, width + padding * 2, height + padding * 2);
    
    // Barre grise (fond)
    this.healthBar.fillStyle(0x666666);
    this.healthBar.fillRect(x, y, width, height);
    
    // Pourcentage de vie
    const healthPercent = Math.max(0, currentHealth / maxHealth);
    
    // Couleur en fonction du pourcentage de vie
    let healthColor = 0x00ff00; // Vert
    if (healthPercent < 0.3) {
      healthColor = 0xff0000; // Rouge
    } else if (healthPercent < 0.6) {
      healthColor = 0xffff00; // Jaune
    }
    
    // Barre de vie
    this.healthBar.fillStyle(healthColor);
    this.healthBar.fillRect(x, y, width * healthPercent, height);
  }

  showDamageEffect(damage: number) {
    if (!this.damageTint) return;
    
    // Calculer l'intensité de l'effet en fonction des dégâts
    const intensity = Math.min(0.7, damage / 100); // Limiter à 0.7 max
    
    // Montrer un flash rouge
    this.damageTint.setAlpha(intensity);
    
    // Animation de disparition
    this.scene.tweens.add({
      targets: this.damageTint,
      alpha: 0,
      duration: 500,
      ease: 'Power2'
    });
    
    // Ajouter un effet de secousse à la caméra
    this.scene.cameras.main.shake(200 * intensity, 0.01 * intensity);
  }

  disablePlayerControls() {
    this.isPlayerDead = true;
  }

  enablePlayerControls() {
    this.isPlayerDead = false;
  }

  getPlayerPosition(): { x: number, y: number } | null {
    if (!this.player) return null;
    return { x: this.player.x, y: this.player.y };
  }

  isInToolMode(): boolean {
    return this.isToolMode;
  }

  setToolMode(isToolMode: boolean) {
    this.isToolMode = isToolMode;
    this.updateCursor();
  }
} 