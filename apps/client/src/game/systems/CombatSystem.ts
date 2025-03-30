import Phaser from 'phaser';
import { COMBAT } from 'shared';
import { ObjectPool } from '../utils/ObjectPool';

export class CombatSystem {
  private scene: Phaser.Scene;
  private damageEffectPool?: ObjectPool<Phaser.GameObjects.Text>;
  private activeDamageEffects: Set<Phaser.GameObjects.Text> = new Set();
  private deathScreen?: Phaser.GameObjects.Container;
  private respawnCountdown?: Phaser.GameObjects.Text;
  private isPlayerDead: boolean = false;
  private respawnIntervalId?: number;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initObjectPools();
  }
  
  private initObjectPools() {
    // Initialiser le pool d'effets de dégâts
    this.damageEffectPool = new ObjectPool<Phaser.GameObjects.Text>(
      () => {
        const text = this.scene.add.text(0, 0, '', {
          fontSize: '24px',
          fontStyle: 'bold',
          color: '#ff0000',
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
        this.activeDamageEffects.delete(text);
      },
      20
    );
  }
  
  showDamageEffect(x: number, y: number, damage: number) {
    if (!this.damageEffectPool) return;
    
    const damageText = this.damageEffectPool.get();
    if (!damageText) return;
    
    // Configurer le texte
    damageText.setText(`-${Math.round(damage)}`);
    damageText.setPosition(x, y - 40);
    damageText.setAlpha(1);
    damageText.setScale(1);
    
    // Ajouter à la liste des effets actifs
    this.activeDamageEffects.add(damageText);
    
    // Créer une animation de montée et disparition
    this.scene.tweens.add({
      targets: damageText,
      y: y - 80,
      alpha: 0,
      scale: 1.5,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        this.damageEffectPool?.release(damageText);
      }
    });
    
    // Ajouter un effet de secousse à la position horizontale
    this.scene.tweens.add({
      targets: damageText,
      x: { from: x - 10, to: x + 10 },
      duration: 100,
      repeat: 3,
      yoyo: true,
      ease: 'Sine.easeInOut'
    });
  }
  
  showPlayerDamageEffect(damage: number) {
    // Effet visuel pour les dégâts subis par le joueur
    const gameScene = this.scene as any;
    
    // Flash rouge sur l'écran
    if (gameScene.playerController && gameScene.playerController.showDamageEffect) {
      gameScene.playerController.showDamageEffect(damage);
    } else {
      // Implémentation de secours si le contrôleur n'a pas cette méthode
      const flashRect = this.scene.add.rectangle(
        0, 0, 
        this.scene.cameras.main.width, 
        this.scene.cameras.main.height,
        0xff0000
      );
      flashRect.setScrollFactor(0);
      flashRect.setAlpha(Math.min(0.7, damage / 100));
      flashRect.setDepth(100);
      
      // Animation de disparition
      this.scene.tweens.add({
        targets: flashRect,
        alpha: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => {
          flashRect.destroy();
        }
      });
      
      // Secousse de la caméra
      const intensity = Math.min(0.01, damage / 1000);
      this.scene.cameras.main.shake(200, intensity);
    }
    
    // Jouer un son de dégât (si implémenté)
    if (gameScene.sound && gameScene.sound.play) {
      // gameScene.sound.play('player_hurt', { volume: Math.min(1, damage / 50) });
    }
    
    // Afficher le dégât numériquement
    if (gameScene.player) {
      this.showDamageEffect(gameScene.player.x, gameScene.player.y, damage);
    }
    
    // Alerter si la santé est critique
    if (gameScene.playerEntity && gameScene.playerEntity.health < 30) {
      this.showCriticalHealthWarning();
    }
  }
  
  showCriticalHealthWarning() {
    // Créer un effet de battement rouge pour avertir d'une santé critique
    const gameScene = this.scene as any;
    
    // Vérifier si l'effet est déjà actif
    if (gameScene.criticalHealthEffect) return;
    
    // Créer un rectangle qui couvre tout l'écran
    const warningRect = this.scene.add.rectangle(
      0, 0,
      this.scene.cameras.main.width,
      this.scene.cameras.main.height,
      0xff0000
    );
    warningRect.setScrollFactor(0);
    warningRect.setAlpha(0);
    warningRect.setDepth(99); // Sous les effets de dégâts mais au-dessus de tout le reste
    
    // Stocker la référence
    gameScene.criticalHealthEffect = warningRect;
    
    // Créer une animation de pulsation
    const pulse = this.scene.tweens.add({
      targets: warningRect,
      alpha: 0.2,
      duration: 500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });
    
    // Nettoyage si la santé remonte
    const checkHealth = () => {
      if (!gameScene.playerEntity || gameScene.playerEntity.health >= 30) {
        // Santé remontée, arrêter l'effet
        pulse.stop();
        warningRect.destroy();
        gameScene.criticalHealthEffect = null;
        return;
      }
      
      // Continuer à vérifier
      this.scene.time.delayedCall(1000, checkHealth);
    };
    
    // Démarrer la vérification
    checkHealth();
  }
  
  showDeathScreen(respawnTimeMs: number) {
    // Afficher l'écran de mort avec le compte à rebours de réapparition
    this.isPlayerDead = true;
    
    const gameScene = this.scene as any;
    
    // Désactiver les contrôles du joueur
    if (gameScene.playerController) {
      gameScene.playerController.disablePlayerControls();
    }
    
    // Calculer les dimensions
    const width = this.scene.cameras.main.width;
    const height = this.scene.cameras.main.height;
    
    // Créer un conteneur pour l'écran de mort
    this.deathScreen = this.scene.add.container(width / 2, height / 2);
    this.deathScreen.setDepth(200);
    this.deathScreen.setScrollFactor(0);
    
    // Fond noir semi-transparent
    const background = this.scene.add.rectangle(0, 0, width, height, 0x000000);
    background.setAlpha(0.8);
    this.deathScreen.add(background);
    
    // Texte "VOUS ÊTES MORT"
    const deathText = this.scene.add.text(0, -100, "VOUS ÊTES MORT", {
      fontSize: '48px',
      fontStyle: 'bold',
      color: '#ff0000'
    }).setOrigin(0.5);
    this.deathScreen.add(deathText);
    
    // Compte à rebours
    const respawnSeconds = Math.ceil(respawnTimeMs / 1000);
    this.respawnCountdown = this.scene.add.text(0, 0, `Réapparition dans: ${respawnSeconds}`, {
      fontSize: '32px',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.deathScreen.add(this.respawnCountdown);
    
    // Animation d'entrée
    this.scene.tweens.add({
      targets: this.deathScreen,
      scale: { from: 0.8, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: 500,
      ease: 'Back.easeOut'
    });
    
    // Mise à jour du compte à rebours
    let remainingSeconds = respawnSeconds;
    
    const updateCountdown = () => {
      remainingSeconds--;
      
      if (remainingSeconds <= 0) {
        // Réapparition
        this.hideDeathScreen();
        clearInterval(this.respawnIntervalId);
        this.respawnIntervalId = undefined;
        
        // Si le serveur a déjà confirmé la réapparition, montrer l'effet
        if (gameScene.playerEntity && gameScene.playerEntity.health > 0) {
          this.showRespawnEffect();
        }
      } else if (this.respawnCountdown) {
        this.respawnCountdown.setText(`Réapparition dans: ${remainingSeconds}`);
      }
    };
    
    // Mettre à jour chaque seconde
    this.respawnIntervalId = window.setInterval(updateCountdown, 1000);
  }
  
  hideDeathScreen() {
    if (!this.deathScreen) return;
    
    // Animation de sortie
    this.scene.tweens.add({
      targets: this.deathScreen,
      scale: { from: 1, to: 0.8 },
      alpha: 0,
      duration: 500,
      ease: 'Back.easeIn',
      onComplete: () => {
        if (this.deathScreen) {
          this.deathScreen.destroy();
          this.deathScreen = undefined;
        }
        
        this.isPlayerDead = false;
        
        // Réactiver les contrôles du joueur
        const gameScene = this.scene as any;
        if (gameScene.playerController) {
          gameScene.playerController.enablePlayerControls();
        }
      }
    });
    
    // Arrêter le compte à rebours
    if (this.respawnIntervalId !== undefined) {
      clearInterval(this.respawnIntervalId);
      this.respawnIntervalId = undefined;
    }
  }
  
  showRespawnEffect() {
    const gameScene = this.scene as any;
    
    if (!gameScene.player) return;
    
    // Effet de lumière à la position du joueur
    const respawnLight = this.scene.add.sprite(
      gameScene.player.x,
      gameScene.player.y,
      'respawn_light'
    );
    
    // Si la texture n'existe pas, utiliser un cercle
    if (!respawnLight.texture.key) {
      respawnLight.destroy();
      
      const graphics = this.scene.add.graphics();
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(gameScene.player.x, gameScene.player.y, 50);
      
      // Animation de disparition
      this.scene.tweens.add({
        targets: graphics,
        alpha: 0,
        scale: 2,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => {
          graphics.destroy();
        }
      });
      
      return;
    }
    
    // Configurer le sprite
    respawnLight.setScale(0);
    respawnLight.setAlpha(0.8);
    respawnLight.setBlendMode(Phaser.BlendModes.ADD);
    
    // Animation d'apparition puis disparition
    this.scene.tweens.add({
      targets: respawnLight,
      scale: 2,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        respawnLight.destroy();
      }
    });
    
    // Effet de particules (si disponible)
    if (gameScene.particleEmitters) {
      const emitter = gameScene.particleEmitters.createEmitter({
        speed: { min: 50, max: 100 },
        scale: { start: 0.5, end: 0 },
        blendMode: 'ADD',
        lifespan: 1000
      });
      
      emitter.explode(30, gameScene.player.x, gameScene.player.y);
    }
    
    // Effet de secousse de caméra
    this.scene.cameras.main.shake(500, 0.005);
    
    // Son de réapparition (si disponible)
    // gameScene.sound.play('respawn');
  }
  
  isPlayerCurrentlyDead(): boolean {
    return this.isPlayerDead;
  }
  
  addDamageFlashEffect(target: Phaser.GameObjects.GameObject, flashes: number = COMBAT.DAMAGE_FLASH_COUNT, flashDuration: number = COMBAT.DAMAGE_FLASH_DURATION) {
    // Vérifier si l'objet a la propriété alpha
    if (!('alpha' in target)) return;
    
    // Vérifier si un effet est déjà en cours
    if (target.getData('flashing')) return;
    
    // Marquer l'objet comme en cours de flash
    target.setData('flashing', true);
    
    // Stocker l'alpha d'origine
    const originalAlpha = (target as any).alpha;
    
    // Créer une séquence de clignotements
    this.createFlashSequence(target, originalAlpha, flashes, flashDuration);
  }
  
  private createFlashSequence(target: Phaser.GameObjects.GameObject, originalAlpha: number, count: number, flashDuration: number) {
    const flashSequence = () => {
      if (count <= 0) {
        this.finishDamageEffect(target, originalAlpha, flashDuration);
        return;
      }
      
      // Vérifier si l'objet a la propriété alpha
      if (!('alpha' in target)) {
        target.setData('flashing', false);
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
    // Vérifier si l'objet a la propriété alpha
    if (!('alpha' in target)) {
      target.setData('flashing', false);
      return;
    }
    
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
} 