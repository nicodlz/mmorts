/**
 * Niveaux de qualité disponibles
 */
export enum QualityLevel {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2
}

/**
 * Gestionnaire de performances pour adapter dynamiquement les paramètres du jeu
 * en fonction des capacités de l'appareil et de la qualité de la connexion réseau.
 */
export class PerformanceManager {
  // Performance globale
  private static _qualityLevel: QualityLevel = QualityLevel.MEDIUM;
  private static _lastQualityChange: number = 0;
  private static _qualityChangeDelay: number = 5000; // Délai minimum entre les changements de qualité (5 secondes)
  
  // FPS
  private static _fpsHistory: number[] = [];
  private static _fpsAverage: number = 60;
  private static _fpsTarget: number = 60;
  private static _fpsThresholdLow: number = 20;
  private static _fpsThresholdHigh: number = 45;
  
  // Réseau
  private static _pingHistory: number[] = [];
  private static _pingAverage: number = 100;
  private static _pingThresholdLow: number = 300;
  private static _pingThresholdHigh: number = 150;
  
  // Paramètres adaptables
  private static _networkUpdateRate: number = 100;
  private static _renderDistance: number = 4;
  private static _renderOptimizationInterval: number = 500;
  private static _cleanupInterval: number = 5000;
  private static _maxTilePoolSize: number = 500;
  private static _positionThreshold: number = 0.5;
  private static _lerpFactor: number = 0.08;
  private static _effectsQuality: number = 1.0;
  
  // Indicateurs de changement
  private static _parametersChanged: boolean = false;

  /**
   * Initialise le gestionnaire de performances
   */
  public static initialize() {
    this.detectInitialPerformance();
    
    // Écouter les événements de performance après l'initialisation
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F8') {
        this.togglePerformanceMode();
      }
    });
    
    // Initialiser le timestamp du dernier changement
    this._lastQualityChange = Date.now();
  }

  /**
   * Détecte les performances initiales de l'appareil et de la connexion
   */
  private static detectInitialPerformance() {
    // Utiliser navigator.connection si disponible (peut ne pas être supporté partout)
    const connection = (navigator as any).connection;
    
    if (connection) {
      const type = connection.effectiveType; // 4g, 3g, 2g, slow-2g
      const rtt = connection.rtt; // Round-trip time
      
      // Détecter ADSL ou connexions lentes
      if (type === '2g' || type === 'slow-2g' || rtt > 300) {
        this._qualityLevel = QualityLevel.LOW;
      } else if (type === '3g' || rtt > 100) {
        this._qualityLevel = QualityLevel.MEDIUM;
      } else {
        this._qualityLevel = QualityLevel.HIGH;
      }
    }
    
    // Appliquer les paramètres en fonction du niveau détecté
    this.applyQualitySettings();
  }

  /**
   * Met à jour les statistiques de performance
   * @param fps Le FPS actuel
   * @param ping Le ping actuel en ms
   */
  public static updateStats(fps: number, ping: number) {
    // Mettre à jour l'historique FPS
    this._fpsHistory.push(fps);
    if (this._fpsHistory.length > 60) {
      this._fpsHistory.shift();
    }
    
    // Mettre à jour l'historique ping
    this._pingHistory.push(ping);
    if (this._pingHistory.length > 10) {
      this._pingHistory.shift();
    }
    
    // Calculer les moyennes
    this._fpsAverage = this._fpsHistory.reduce((sum, value) => sum + value, 0) / this._fpsHistory.length;
    this._pingAverage = this._pingHistory.reduce((sum, value) => sum + value, 0) / this._pingHistory.length;
    
    // Réaction d'urgence pour FPS très bas (moins de 15)
    const now = Date.now();
    if (fps < 15 && this._qualityLevel > QualityLevel.LOW && now - this._lastQualityChange > 1000) {
      console.log(`FPS critique (${fps}) détecté! Passage immédiat en mode basse qualité.`);
      this._qualityLevel = QualityLevel.LOW;
      this.applyQualitySettings();
      this._lastQualityChange = now;
      this._parametersChanged = true;
      return; // Ne pas exécuter l'ajustement normal
    }
    
    // Ajuster automatiquement la qualité si nécessaire
    this.adjustQualityIfNeeded();
  }

  /**
   * Ajuste automatiquement le niveau de qualité en fonction des performances observées
   */
  private static adjustQualityIfNeeded() {
    // Éviter les ajustements trop fréquents
    if (this._fpsHistory.length < 30 || this._pingHistory.length < 5) {
      return;
    }
    
    // Vérifier si assez de temps s'est écoulé depuis le dernier changement
    const now = Date.now();
    if (now - this._lastQualityChange < this._qualityChangeDelay) {
      return;
    }
    
    // Réduire la qualité si les performances sont faibles
    if (this._fpsAverage < this._fpsThresholdLow || this._pingAverage > this._pingThresholdLow) {
      if (this._qualityLevel > QualityLevel.LOW) {
        this._qualityLevel--;
        this.applyQualitySettings();
        this._lastQualityChange = now;
        this._parametersChanged = true;
        console.log(`Performance faible détectée: FPS = ${this._fpsAverage.toFixed(1)}, Ping = ${this._pingAverage.toFixed(0)}ms. Qualité réduite à ${QualityLevel[this._qualityLevel]}`);
      }
    } 
    // Augmenter la qualité si les performances sont bonnes - exiger une marge plus grande pour ADSL
    else if (this._fpsAverage > this._fpsThresholdHigh + 5 && this._pingAverage < this._pingThresholdHigh) {
      if (this._qualityLevel < QualityLevel.HIGH) {
        this._qualityLevel++;
        this.applyQualitySettings();
        this._lastQualityChange = now;
        this._parametersChanged = true;
        console.log(`Bonnes performances détectées: FPS = ${this._fpsAverage.toFixed(1)}, Ping = ${this._pingAverage.toFixed(0)}ms. Qualité augmentée à ${QualityLevel[this._qualityLevel]}`);
      }
    }
  }

  /**
   * Applique les paramètres correspondant au niveau de qualité actuel
   */
  private static applyQualitySettings() {
    // Enregistrer les anciens paramètres pour détecter les changements
    const oldRenderDistance = this._renderDistance;
    
    switch (this._qualityLevel) {
      case QualityLevel.LOW:
        console.log("Qualité BASSE appliquée");
        // Paramètres pour qualité basse
        this._networkUpdateRate = 150; // Mises à jour moins fréquentes
        this._renderDistance = 4;     // Garder le renderDistance à 4 même en qualité basse
        this._renderOptimizationInterval = 250;
        this._cleanupInterval = 3000;
        this._maxTilePoolSize = 300;
        this._positionThreshold = 1.0;
        this._lerpFactor = 0.05;
        this._effectsQuality = 0.5;
        break;
        
      case QualityLevel.MEDIUM:
        console.log("Qualité MOYENNE appliquée");
        // Paramètres pour qualité moyenne
        this._networkUpdateRate = 120;
        this._renderDistance = 4;           // Distance moyenne
        this._renderOptimizationInterval = 500;
        this._cleanupInterval = 5000;
        this._maxTilePoolSize = 500;
        this._positionThreshold = 0.5;
        this._lerpFactor = 0.08;
        this._effectsQuality = 0.75;
        break;
        
      case QualityLevel.HIGH:
        console.log("Qualité HAUTE appliquée");
        // Paramètres pour qualité haute
        this._networkUpdateRate = 100;
        this._renderDistance = 4;           // Distance maximale
        this._renderOptimizationInterval = 750;
        this._cleanupInterval = 7000;
        this._maxTilePoolSize = 750;
        this._positionThreshold = 0.2;
        this._lerpFactor = 0.12;
        this._effectsQuality = 1.0;
        break;
    }
    
    // Détecter si le renderDistance a changé
    if (oldRenderDistance !== this._renderDistance) {
      console.log(`Changement de renderDistance: ${oldRenderDistance} -> ${this._renderDistance}`);
    }
  }

  /**
   * Bascule manuellement entre les modes de performance
   */
  public static togglePerformanceMode() {
    // Faire défiler les niveaux de qualité
    this._qualityLevel = (this._qualityLevel + 1) % 3;
    this.applyQualitySettings();
    this._lastQualityChange = Date.now();
    this._parametersChanged = true;
    console.log(`Mode de performance changé à ${QualityLevel[this._qualityLevel]}`);
  }

  /**
   * Vérifie si les paramètres ont changé depuis le dernier appel
   * @returns true si les paramètres ont changé, false sinon
   */
  public static checkParametersChanged(): boolean {
    const changed = this._parametersChanged;
    this._parametersChanged = false;
    return changed;
  }

  // Getters pour les paramètres
  public static get networkUpdateRate(): number { return this._networkUpdateRate; }
  public static get renderDistance(): number { return this._renderDistance; }
  public static get renderOptimizationInterval(): number { return this._renderOptimizationInterval; }
  public static get cleanupInterval(): number { return this._cleanupInterval; }
  public static get maxTilePoolSize(): number { return this._maxTilePoolSize; }
  public static get positionThreshold(): number { return this._positionThreshold; }
  public static get lerpFactor(): number { return this._lerpFactor; }
  public static get effectsQuality(): number { return this._effectsQuality; }
  public static get qualityLevel(): QualityLevel { return this._qualityLevel; }
  
  // Performance metrics
  public static get fps(): number { return this._fpsAverage; }
  public static get ping(): number { return this._pingAverage; }
} 