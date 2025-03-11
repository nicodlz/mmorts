import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  private playerPreview?: Phaser.GameObjects.Sprite;
  private selectedHue: number = 180; // Couleur par défaut (bleu-vert)
  private playerName: string = '';
  private nameText?: Phaser.GameObjects.Text;
  private isTyping: boolean = false;

  constructor() {
    super({ key: 'MenuScene' });
    console.log('MenuScene créée');
  }
  
  preload() {
    console.log('MenuScene preload...');
    this.load.image('player', 'sprites/player.png');
    console.log('Assets chargés');
  }
  
  create() {
    console.log('MenuScene create...');
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;

    // Fond noir
    this.cameras.main.setBackgroundColor('#000000');

    // Titre
    this.add.text(centerX, centerY - 100, 'PvPStrat.io', {
      fontSize: '48px',
      color: '#ffffff'
    }).setOrigin(0.5);

    console.log('Ajout du sprite player...');
    
    // Création d'un rectangle de couleur au lieu du sprite
    const size = 32;
    const graphics = this.add.graphics();
    graphics.fillStyle(0xFFFFFF, 1);
    graphics.fillRect(centerX - size, centerY - 20 - size, size * 2, size * 2);
    
    // Contour plus foncé
    graphics.lineStyle(2, 0x000000, 1);
    graphics.strokeRect(centerX - size, centerY - 20 - size, size * 2, size * 2);
    
    // Stocker une référence comme playerPreview
    this.playerPreview = this.add.sprite(centerX, centerY - 20, 'player')
      .setScale(2)
      .setVisible(false); // Caché mais utilisé pour les calculs
    
    // Initialisation de la couleur par défaut
    this.updatePlayerColor(this.selectedHue);
    console.log('Sprite player ajouté');

    console.log('MenuScene créée avec succès');

    // Zone de texte pour le pseudo
    const textBox = this.add.rectangle(centerX, centerY + 100, 200, 40, 0x333333);
    const textBoxBorder = this.add.rectangle(centerX, centerY + 100, 202, 42, 0x666666);
    textBoxBorder.setDepth(0);
    textBox.setDepth(1);

    // Texte du pseudo
    this.nameText = this.add.text(centerX - 90, centerY + 100, '', {
      fontSize: '16px',
      color: '#ffffff',
      fixedWidth: 180,
    }).setOrigin(0, 0.5)
      .setDepth(2);

    // Placeholder
    const placeholder = this.add.text(centerX - 90, centerY + 100, 'Entrez votre pseudo...', {
      fontSize: '16px',
      color: '#666666',
      fixedWidth: 180,
    }).setOrigin(0, 0.5)
      .setDepth(2);

    // Rendre la zone de texte interactive
    textBox.setInteractive();
    textBox.on('pointerdown', () => {
      this.isTyping = true;
      textBoxBorder.setStrokeStyle(2, 0x4CAF50);
      if (!this.playerName) {
        placeholder.setVisible(false);
      }
    });

    // Gérer la saisie du texte
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (!this.isTyping) return;

      if (event.key === 'Backspace') {
        this.playerName = this.playerName.slice(0, -1);
      } else if (event.key.length === 1 && this.playerName.length < 16) {
        this.playerName += event.key;
      }

      if (this.nameText) {
        this.nameText.setText(this.playerName);
        placeholder.setVisible(!this.playerName);
      }
      
      // Mettre à jour la couleur basée sur le nom
      this.updateColorFromName();
    });

    // Désactiver la saisie quand on clique ailleurs
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
      if (!gameObjects.includes(textBox)) {
        textBoxBorder.setStrokeStyle(0);
        this.isTyping = false;
      }
    });

    // Bouton Play
    const playButton = this.add.rectangle(centerX, centerY + 160, 200, 50, 0x4CAF50)
      .setInteractive()
      .on('pointerover', () => {
        playButton.setFillStyle(0x66BB6A);
        this.input.setDefaultCursor('pointer');
      })
      .on('pointerout', () => {
        playButton.setFillStyle(0x4CAF50);
        this.input.setDefaultCursor('default');
      })
      .on('pointerdown', () => {
        if (this.playerName.length > 0) {
          localStorage.setItem('playerName', this.playerName);
          localStorage.setItem('playerHue', this.selectedHue.toString());
          this.scene.start('GameScene');
        } else {
          // Effet de shake sur la textbox pour indiquer l'erreur
          this.tweens.add({
            targets: [textBox, textBoxBorder],
            x: { from: centerX - 5, to: centerX },
            duration: 50,
            yoyo: true,
            repeat: 2
          });
        }
      });

    // Texte du bouton Play
    this.add.text(centerX, centerY + 160, 'PLAY', {
      fontSize: '24px',
      color: '#ffffff'
    }).setOrigin(0.5);

    // Version du jeu
    this.add.text(
      this.cameras.main.width - 20, 
      this.cameras.main.height - 20, 
      'v0.1.0', 
      {
        fontSize: '16px',
        color: '#ffffff'
      }
    ).setOrigin(1);

    // Initialisation de la couleur basée sur le nom (qui est vide au début)
    this.updateColorFromName();
  }
  
  private updatePlayerColor(hue: number) {
    console.log('=== Début updatePlayerColor ===');
    console.log(`Teinte reçue: ${hue}`);
    
    // Convertir la teinte en couleur RGB
    const color = this.hueToRgb(hue);
    console.log(`Couleur RGB calculée: 0x${color.toString(16)}`);
    
    // Calculer une version plus foncée de la même couleur pour le contour
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    
    // Réduire chaque composante de 40% pour assombrir
    const darkerR = Math.max(0, Math.floor(r * 0.6));
    const darkerG = Math.max(0, Math.floor(g * 0.6));
    const darkerB = Math.max(0, Math.floor(b * 0.6));
    
    const darkerColor = (darkerR << 16) | (darkerG << 8) | darkerB;
    console.log(`Couleur contour calculée: 0x${darkerColor.toString(16)}`);
    
    // Mettre à jour le rectangle coloré
    const size = 32;
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    
    // Effacer les graphiques précédents
    this.children.list.forEach(child => {
      if (child instanceof Phaser.GameObjects.Graphics) {
        child.destroy();
      }
    });
    
    // Créer un nouveau rectangle avec la couleur
    const graphics = this.add.graphics();
    
    // D'abord dessiner le contour (plus grand de 4 pixels pour avoir 2px de chaque côté)
    graphics.fillStyle(darkerColor, 1);
    graphics.fillRect(centerX - size - 2, centerY - 20 - size - 2, size * 2 + 4, size * 2 + 4);
    
    // Ensuite dessiner le remplissage
    graphics.fillStyle(color, 1);
    graphics.fillRect(centerX - size, centerY - 20 - size, size * 2, size * 2);
    
    console.log('Couleur appliquée au sprite');
    console.log('=== Fin updatePlayerColor ===');
  }

  private hueToRgb(hue: number): number {
    // Normaliser la teinte entre 0 et 360
    hue = hue % 360;
    if (hue < 0) hue += 360;

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

    console.log(`HSV(${hue}, 1, 1) -> RGB(${red}, ${green}, ${blue})`);
    
    // Retourner la couleur au format hexadécimal
    return (red << 16) | (green << 8) | blue;
  }

  private updateColorFromName() {
    console.log('=== Début updateColorFromName ===');
    console.log(`Nom actuel: "${this.playerName}"`);
    
    if (!this.playerName || this.playerName.length === 0) {
      this.selectedHue = 180;
      console.log('Nom vide, utilisation de la teinte par défaut:', this.selectedHue);
    } else {
      let hash = 0;
      for (let i = 0; i < this.playerName.length; i++) {
        hash = ((hash << 5) - hash) + this.playerName.charCodeAt(i);
        hash |= 0;
      }
      this.selectedHue = Math.abs(hash % 360);
      console.log(`Hash calculé: ${hash}`);
      console.log(`Teinte calculée: ${this.selectedHue}`);
    }

    // Stocker dans localStorage
    localStorage.setItem('playerHue', this.selectedHue.toString());
    localStorage.setItem('playerName', this.playerName);
    console.log(`Valeurs stockées dans localStorage: hue=${this.selectedHue}, name="${this.playerName}"`);

    if (this.playerPreview) {
      console.log('Application de la couleur au preview...');
      this.updatePlayerColor(this.selectedHue);
    } else {
      console.error('playerPreview est undefined!');
    }
    console.log('=== Fin updateColorFromName ===');
  }
} 