import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { MenuScene } from './scenes/MenuScene';

export class Game extends Phaser.Game {
  constructor() {
    console.log('Configuration du jeu...');
    
    // Configuration Phaser
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.CANVAS, // Utiliser CANVAS qui peut donner un meilleur rendu pixel art
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#000000',
      parent: 'phaser-container',
      scene: [MenuScene, GameScene, UIScene],
      pixelArt: true,
      antialias: false,
      roundPixels: false,
      fps: {
        target: 60,
        forceSetTimeOut: false,
        min: 30
      },
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
          fps: 60
        }
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight
      },
      render: {
        pixelArt: true,
        antialias: false,
        roundPixels: false,
        powerPreference: 'high-performance'
      }
    };

    super(config);
    console.log('Jeu créé avec la configuration:', config);

    // Gestionnaire de redimensionnement
    window.addEventListener('resize', () => {
      this.scale.resize(window.innerWidth, window.innerHeight);
    });
    
    // Configuration globale des textures pour un rendu pixel art
    this.textures.on('addtexture', (texture) => {
      this.textures.list[texture].setFilter(Phaser.Textures.NEAREST);
    });
  }
} 