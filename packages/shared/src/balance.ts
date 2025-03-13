/**
 * FICHIER DE CONFIGURATION DU BALANCING
 * Centralise tous les paramètres d'équilibrage du jeu
 */

import { ResourceType, BuildingType, BUILDING_COSTS } from './index';

// ====== POINTS DE VIE ET DÉGÂTS ======

// Points de vie
export const PLAYER_HEALTH = {
  MAX_HEALTH: 1000,
  INVULNERABLE_TIME: 2000, // ms d'invulnérabilité après respawn
};

export const UNIT_HEALTH = {
  WARRIOR: {
    MAX_HEALTH: 100,
  },
};

export const BUILDING_HEALTH = {
  DEFAULT: 100,
};

// Dégâts
export const COMBAT = {
  // Paramètres de base des dégâts
  UNIT_BASE_DAMAGE: 25,
  DAMAGE_RANDOM_VARIATION: 0.1, // ±10% de variation
  
  // Modificateurs de dégâts
  DEFENSIVE_MODE_REDUCTION: 0.3, // Réduction de 30% en mode défensif
  PLAYER_DAMAGE_REDUCTION: 0.2, // Réduction de 20% contre les joueurs
  
  // Paramètres d'attaque
  ATTACK_COOLDOWN: 500, // ms entre chaque attaque
  ATTACK_RANGE: 20, // pixels
};

// ====== RESSOURCES DE DÉPART DU JOUEUR ======

// Quantités de ressources données au joueur lors de sa création
export const PLAYER_STARTING_RESOURCES = {
  [ResourceType.WOOD]: 0,
  [ResourceType.STONE]: 0,
  [ResourceType.GOLD]: 0,
  [ResourceType.IRON]: 0,
  [ResourceType.COAL]: 0,
  [ResourceType.STEEL]: 0
};

// ====== COÛTS DE CONSTRUCTION ======

// Défini dans index.ts - utilisé ici par référence
// export const BUILDING_COSTS = { ... }

// ====== PRODUCTION DE RESSOURCES ======

// Taux de production en millisecondes
export const PRODUCTION_RATES = {
  [BuildingType.FURNACE]: 10000, // 10 secondes pour le charbon
  [BuildingType.FORGE]: 8000,    // 8 secondes pour le fer
  [BuildingType.FACTORY]: 30000, // 30 secondes pour l'acier
};

// Recettes de production
export const PRODUCTION_RECIPES = {
  [BuildingType.FURNACE]: {
    inputs: { [ResourceType.WOOD]: 5 },
    outputs: { [ResourceType.COAL]: 1 },
  },
  [BuildingType.FORGE]: {
    inputs: { [ResourceType.STONE]: 3 },
    outputs: { [ResourceType.IRON]: 2 },
  },
  [BuildingType.FACTORY]: {
    inputs: { [ResourceType.COAL]: 3, [ResourceType.IRON]: 3 },
    outputs: { [ResourceType.STEEL]: 1 },
  },
};

// ====== RÉCOLTE DE RESSOURCES ======

export const MINING_CONFIG = {
  COOLDOWN: 500, // ms entre chaque collecte
  ANIMATION_PHASES: 3,
  PHASE_SPEED: 150, // ms par phase d'animation
  RESOURCE_AMOUNTS: {
    [ResourceType.GOLD]: 100,
    [ResourceType.WOOD]: 10,
    [ResourceType.STONE]: 20,
  },
};

// Quantité récoltée à chaque action de harvest
export const HARVEST_AMOUNT = {
  [ResourceType.GOLD]: 2,
  [ResourceType.WOOD]: 2,
  [ResourceType.STONE]: 2,
  [ResourceType.IRON]: 0, // Non récoltable directement
  [ResourceType.COAL]: 0, // Non récoltable directement
  [ResourceType.STEEL]: 0  // Non récoltable directement
};

// Quantités initiales des ressources dans l'environnement
export const RESOURCE_AMOUNTS = {
  [ResourceType.GOLD]: 100,
  [ResourceType.WOOD]: 10,
  [ResourceType.STONE]: 20,

};

// Temps de respawn des ressources (en millisecondes)
export const RESOURCE_RESPAWN_TIMES = {
  [ResourceType.GOLD]: 999999999,   // Désactivé temporairement
  [ResourceType.WOOD]: 999999999,   // Désactivé temporairement
  [ResourceType.STONE]: 999999999,  // Désactivé temporairement
  [ResourceType.IRON]: 999999999,   // Désactivé temporairement
  [ResourceType.COAL]: 999999999,   // Désactivé temporairement
  [ResourceType.STEEL]: 999999999,  // Désactivé temporairement
};

// ====== UNITÉS MILITAIRES ======

// Coût des unités
export const UNIT_COSTS = {
  WARRIOR: {
    [ResourceType.GOLD]: 2,
    [ResourceType.IRON]: 2,
  },
};

// Vitesse des unités
export const UNIT_SPEED = {
  BASE_SPEED: 0.3,
  MAX_SPEED: 0.8,
};

// ====== SYSTÈME DE MORT ET RESPAWN ======

export const DEATH_SYSTEM = {
  PLAYER_RESPAWN_TIME: 5000, // ms
  RESOURCE_LOSS_PERCENT: 0.3, // 30% des ressources perdues à la mort
};

// ====== POPULATION ======

export const POPULATION = {
  DEFAULT_MAX: 10,
  HOUSE_INCREASE: 10, // Augmentation par maison
};

// ====== OPTIMISATION DU JEU ======

export const PERFORMANCE = {
  NEARBY_UPDATE_RATE: 100, // ms (10 fois par seconde)
  DISTANT_UPDATE_RATE: 500, // ms (2 fois par seconde)
  SIMULATION_INTERVAL: 1000 / 30, // ms (30 fois par seconde)
  RENDER_OPTIMIZATION_INTERVAL: 500, // ms
}; 