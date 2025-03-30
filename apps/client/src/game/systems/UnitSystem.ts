import Phaser from 'phaser';
import { COMBAT } from 'shared';

export class UnitSystem {
  private scene: Phaser.Scene;
  private unitSprites: Map<string, { 
    sprite: Phaser.GameObjects.Container; 
    targetX: number; 
    targetY: number;
    nameText?: Phaser.GameObjects.Text;
    walkingPhase?: number;
    lastUpdateTime?: number;
    startX?: number;
    startY?: number;
    elapsedTime?: number;
    previousTargetX?: number;
    previousTargetY?: number;
    lastPos?: { x: number, y: number };
    velocity?: { x: number, y: number };
  }> = new Map();
  private unitHealthBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private readonly LERP_FACTOR: number = 0.08;
  private isLongPressing: boolean = false;
  private longPressTimer: number = 0;
  private longPressTarget: { x: number, y: number } | null = null;
  private readonly LONG_PRESS_THRESHOLD: number = 200;
  private lastUnitSyncCheck: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  createUnitSprite(unit: any, unitId: string) {
    // Création du conteneur pour l'unité
    const container = this.scene.add.container(unit.x, unit.y);
    
    // Sprite principal de l'unité
    let sprite;
    switch (unit.type) {
      case 'soldier':
        sprite = this.scene.add.sprite(0, 0, 'soldier');
        sprite.setScale(0.8);
        break;
      case 'villager':
        sprite = this.scene.add.sprite(0, 0, 'villager');
        sprite.setScale(0.8);
        break;
      default:
        sprite = this.scene.add.sprite(0, 0, 'soldier');
        sprite.setScale(0.8);
    }
    
    // Ajouter le sprite au conteneur
    container.add(sprite);
    
    // Appliquer une teinte en fonction du propriétaire
    const gameScene = this.scene as any;
    if (unit.owner !== gameScene.playerEntity?.id) {
      sprite.setTint(gameScene.hueToColor ? gameScene.hueToColor(unit.hue || 0) : 0xff0000);
    }
    
    // Ajouter du texte au-dessus de l'unité
    const nameColor = unit.owner === gameScene.playerEntity?.id ? '#ffffff' : '#ff9999';
    
    const nameText = this.scene.add.text(0, -25, unit.type, {
      fontSize: '16px',
      color: nameColor,
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    
    container.add(nameText);
    
    // Ajouter les données de l'unité
    sprite.setData('type', unit.type);
    sprite.setData('owner', unit.owner);
    sprite.setData('health', unit.health);
    sprite.setData('maxHealth', unit.maxHealth);
    
    // Stocker l'unité dans la map
    this.unitSprites.set(unitId, {
      sprite: container,
      targetX: unit.x,
      targetY: unit.y,
      nameText: nameText,
      walkingPhase: 0,
      lastUpdateTime: Date.now()
    });
    
    return container;
  }

  getDarkerColor(color: number): number {
    // Extraire les composantes RGB
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    
    // Assombrir chaque composante
    const darkerR = Math.floor(r * 0.7);
    const darkerG = Math.floor(g * 0.7);
    const darkerB = Math.floor(b * 0.7);
    
    // Recomposer la couleur
    return (darkerR << 16) | (darkerG << 8) | darkerB;
  }

  updateUnitNamePosition(unitId: string) {
    const unitData = this.unitSprites.get(unitId);
    if (unitData && unitData.nameText) {
      unitData.nameText.y = -25 - (unitData.walkingPhase || 0) * 2;
    }
  }

  updateUnits(delta: number) {
    // Interpoler les mouvements des unités pour un déplacement fluide
    const now = Date.now();
    
    for (const [unitId, unitData] of this.unitSprites.entries()) {
      const { sprite, targetX, targetY } = unitData;
      
      if (!sprite.active) continue;
      
      // Si l'unité a une cible de mouvement différente de sa position actuelle
      if (targetX !== sprite.x || targetY !== sprite.y) {
        // Stocker la dernière position si ce n'est pas déjà fait
        if (!unitData.lastPos) {
          unitData.lastPos = { x: sprite.x, y: sprite.y };
        }
        
        // Si la cible a changé, réinitialiser l'animation
        if (unitData.previousTargetX !== targetX || unitData.previousTargetY !== targetY) {
          unitData.startX = sprite.x;
          unitData.startY = sprite.y;
          unitData.elapsedTime = 0;
          unitData.previousTargetX = targetX;
          unitData.previousTargetY = targetY;
          
          // Calculer la vélocité pour les effets d'animation
          const dx = targetX - sprite.x;
          const dy = targetY - sprite.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0) {
            unitData.velocity = {
              x: dx / distance,
              y: dy / distance
            };
          }
        }
        
        // Utiliser l'interpolation pour déplacer l'unité
        const timePassed = delta;
        unitData.elapsedTime = (unitData.elapsedTime || 0) + timePassed;
        
        // Interpolation avec easing
        const progress = Math.min(1, (unitData.elapsedTime || 0) / 500); // 500ms pour un mouvement complet
        const easedProgress = this.easeInOutQuad(progress);
        
        // Mise à jour de la position
        sprite.x = (unitData.startX || sprite.x) + ((targetX - (unitData.startX || sprite.x)) * easedProgress);
        sprite.y = (unitData.startY || sprite.y) + ((targetY - (unitData.startY || sprite.y)) * easedProgress);
        
        // Animation de marche
        if (progress < 1) {
          // Oscillation pour simuler la marche
          unitData.walkingPhase = Math.sin(progress * Math.PI * 4) * 0.5;
          
          // Ajuster la position du nom
          this.updateUnitNamePosition(unitId);
          
          // Animation du sprite si nécessaire
          const unitSprite = sprite.getAt(0) as Phaser.GameObjects.Sprite;
          if (unitSprite) {
            unitSprite.y = (unitData.walkingPhase || 0) * 4;
          }
        } else {
          // Fin du mouvement
          sprite.x = targetX;
          sprite.y = targetY;
          unitData.walkingPhase = 0;
          
          // Réinitialiser la position du sprite et du nom
          const unitSprite = sprite.getAt(0) as Phaser.GameObjects.Sprite;
          if (unitSprite) {
            unitSprite.y = 0;
          }
          this.updateUnitNamePosition(unitId);
        }
        
        // Mettre à jour la position de la barre de vie si elle existe
        this.updateUnitHealthBar(unitId);
      }
    }
    
    // Vérification périodique de la synchronisation des unités
    this.checkUnitSynchronization();
  }

  checkUnitSynchronization() {
    const now = Date.now();
    if (now - this.lastUnitSyncCheck < 5000) return; // Vérifier toutes les 5 secondes
    
    this.lastUnitSyncCheck = now;
    const gameScene = this.scene as any;
    
    if (!gameScene.room) return;
    
    // Demander une synchronisation complète des unités
    console.log("Vérification de la synchronisation des unités");
    gameScene.room.send("checkUnitSync", {});
  }

  easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  startLongPress(target: { x: number, y: number }) {
    this.isLongPressing = true;
    this.longPressTarget = target;
    this.longPressTimer = Date.now();
  }

  checkLongPress(): boolean {
    if (!this.isLongPressing || !this.longPressTarget) return false;
    
    const elapsed = Date.now() - this.longPressTimer;
    return elapsed >= this.LONG_PRESS_THRESHOLD;
  }

  cancelLongPress() {
    this.isLongPressing = false;
    this.longPressTarget = null;
  }

  getLongPressTarget(): { x: number, y: number } | null {
    return this.longPressTarget;
  }

  updateUnitHealthBar(unitId: string) {
    const unitData = this.unitSprites.get(unitId);
    if (!unitData || !unitData.sprite.active) return;
    
    // Obtenir les données de santé de l'unité
    const unitSprite = unitData.sprite.getAt(0) as Phaser.GameObjects.Sprite;
    if (!unitSprite) return;
    
    const health = unitSprite.getData('health');
    const maxHealth = unitSprite.getData('maxHealth');
    
    if (health === undefined || maxHealth === undefined) return;
    
    // Créer ou récupérer la barre de vie
    let healthBar = this.unitHealthBars.get(unitId);
    if (!healthBar) {
      healthBar = this.scene.add.graphics();
      this.unitHealthBars.set(unitId, healthBar);
    }
    
    // Mettre à jour la barre de vie
    healthBar.clear();
    
    // Ne pas afficher si la santé est pleine
    if (health >= maxHealth) return;
    
    const healthPercent = Math.max(0, health / maxHealth);
    
    // Barre de fond (grise)
    healthBar.fillStyle(0x666666, 0.8);
    healthBar.fillRect(
      unitData.sprite.x - 15,
      unitData.sprite.y - 20,
      30,
      4
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
      unitData.sprite.x - 15,
      unitData.sprite.y - 20,
      30 * healthPercent,
      4
    );
  }

  addDamageFlashEffect(target: Phaser.GameObjects.GameObject, flashes: number = COMBAT.DAMAGE_FLASH_COUNT, flashDuration: number = COMBAT.DAMAGE_FLASH_DURATION) {
    // Vérifier si un effet est déjà en cours
    if (target.getData('flashing')) return;
    
    // Marquer le sprite comme en cours de flash
    target.setData('flashing', true);
    
    // Stocker l'alpha d'origine
    const originalAlpha = target.alpha;
    
    // Créer une séquence de clignotements
    this.createFlashSequence(target, originalAlpha, flashes, flashDuration);
  }

  private createFlashSequence(target: Phaser.GameObjects.GameObject, originalAlpha: number, count: number, flashDuration: number) {
    // Fonction récursive pour créer une séquence de flash
    const flashSequence = () => {
      if (count <= 0) {
        this.finishDamageEffect(target, originalAlpha, flashDuration);
        return;
      }
      
      // Faire apparaître et disparaître pour créer un flash
      this.scene.tweens.add({
        targets: target,
        alpha: 0.3,
        duration: flashDuration / 2,
        yoyo: true,
        onComplete: () => {
          count--;
          if (count > 0) {
            flashSequence();
          } else {
            this.finishDamageEffect(target, originalAlpha, flashDuration);
          }
        }
      });
    };
    
    // Lancer la séquence
    flashSequence();
  }

  private finishDamageEffect(target: Phaser.GameObjects.GameObject, originalAlpha: number, flashDuration: number) {
    // Assurer que l'alpha revient à la normale
    this.scene.tweens.add({
      targets: target,
      alpha: originalAlpha,
      duration: flashDuration / 2,
      onComplete: () => {
        target.setData('flashing', false);
      }
    });
  }

  clearAllUnitHealthBars() {
    for (const [unitId, healthBar] of this.unitHealthBars.entries()) {
      healthBar.destroy();
    }
    this.unitHealthBars.clear();
  }

  getUnitSpriteData(unitId: string) {
    return this.unitSprites.get(unitId);
  }

  getUnitSprites(): Map<string, any> {
    return this.unitSprites;
  }

  removeUnitSprite(unitId: string) {
    const unitData = this.unitSprites.get(unitId);
    if (unitData) {
      // Supprimer le sprite et ses composants
      unitData.sprite.destroy();
      this.unitSprites.delete(unitId);
      
      // Supprimer la barre de vie si elle existe
      const healthBar = this.unitHealthBars.get(unitId);
      if (healthBar) {
        healthBar.destroy();
        this.unitHealthBars.delete(unitId);
      }
    }
  }

  setUnitTarget(unitId: string, x: number, y: number) {
    const unitData = this.unitSprites.get(unitId);
    if (unitData) {
      unitData.targetX = x;
      unitData.targetY = y;
    }
  }
} 