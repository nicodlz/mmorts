/**
 * Classe générique de pool d'objets pour réduire la création/destruction d'objets
 * et améliorer les performances.
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;
  private maxSize: number;

  /**
   * Crée un nouveau pool d'objets
   * @param factory Fonction pour créer un nouvel objet
   * @param reset Fonction pour réinitialiser un objet avant réutilisation
   * @param initialSize Nombre d'objets à créer initialement
   * @param maxSize Taille maximale du pool
   */
  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 0, maxSize: number = 100) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;

    // Préremplir le pool avec des objets initiaux
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  /**
   * Obtient un objet du pool (réutilisé ou nouveau)
   */
  get(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    } else {
      return this.factory();
    }
  }

  /**
   * Retourne un objet au pool pour réutilisation
   * @param obj L'objet à recycler
   */
  release(obj: T): void {
    // Réinitialiser l'objet
    this.reset(obj);
    
    // Ajouter l'objet au pool s'il n'est pas plein
    if (this.pool.length < this.maxSize) {
      this.pool.push(obj);
    }
  }

  /**
   * Préremplir le pool avec un nombre spécifié d'objets
   * @param count Nombre d'objets à créer
   */
  preAllocate(count: number): void {
    const toAdd = Math.min(count, this.maxSize - this.pool.length);
    for (let i = 0; i < toAdd; i++) {
      this.pool.push(this.factory());
    }
  }

  /**
   * Vider le pool et libérer tous les objets
   * @param cleanup Fonction optionnelle pour nettoyer chaque objet avant de le libérer
   */
  clear(cleanup?: (obj: T) => void): void {
    if (cleanup) {
      this.pool.forEach(cleanup);
    }
    this.pool = [];
  }

  /**
   * Obtenir la taille actuelle du pool
   */
  get size(): number {
    return this.pool.length;
  }

  /**
   * Obtenir la taille maximale du pool
   */
  get maxPoolSize(): number {
    return this.maxSize;
  }

  /**
   * Définir la taille maximale du pool
   */
  set maxPoolSize(value: number) {
    this.maxSize = value;
    // Si le pool dépasse la nouvelle taille maximale, réduire
    if (this.pool.length > this.maxSize) {
      this.pool.length = this.maxSize;
    }
  }
} 