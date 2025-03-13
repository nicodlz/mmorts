import { ResourceSchema, ResourceType, TILE_SIZE, CHUNK_SIZE, RESOURCE_AMOUNTS } from "shared";
import * as fs from 'fs';
import * as path from 'path';

export interface WorldData {
  mapLines: string[];
  resources: Map<string, ResourceSchema>;
  resourcesByChunk: Map<string, Set<string>>;
}

export function loadMap(): WorldData {
  let mapLines: string[] = [];
  
  try {
    // Chemin vers le fichier de carte
    const mapPath = path.join(__dirname, '..', 'default.map');
    console.log("Chargement de la carte depuis:", mapPath);
    
    // Lire le fichier
    const mapContent = fs.readFileSync(mapPath, 'utf8');
    mapLines = mapContent.split('\n');
    
    console.log(`Carte chargée avec succès: ${mapLines.length} lignes`);
  } catch (error) {
    console.error("Erreur lors du chargement de la carte:", error);
    // Créer une petite carte par défaut en cas d'erreur
    mapLines = [
      "################",
      "#..............#",
      "#....G...W....S#",
      "#..............#",
      "################"
    ];
    console.log("Utilisation de la carte par défaut");
  }

  // Générer les ressources
  const resources = new Map<string, ResourceSchema>();
  const resourcesByChunk = new Map<string, Set<string>>();

  console.log("Génération des ressources...");
  
  // Générer les ressources selon la carte
  for (let y = 0; y < mapLines.length; y++) {
    for (let x = 0; x < mapLines[y].length; x++) {
      const char = mapLines[y][x];
      let resourceType = null;
      
      switch (char) {
        case 'G':
          resourceType = ResourceType.GOLD;
          break;
        case 'W':
        case 'T':
          resourceType = ResourceType.WOOD;
          break;
        case 'S':
          resourceType = ResourceType.STONE;
          break;
        case 'I':
          resourceType = ResourceType.IRON;
          break;
        case 'C':
          resourceType = ResourceType.COAL;
          break;
      }
      
      if (resourceType) {
        const resource = new ResourceSchema();
        resource.id = `${resourceType}_${x}_${y}`;
        resource.type = resourceType;
        resource.x = x * TILE_SIZE + TILE_SIZE/2;
        resource.y = y * TILE_SIZE + TILE_SIZE/2;
        resource.amount = RESOURCE_AMOUNTS[resourceType];
        
        // Stocker la ressource
        resources.set(resource.id, resource);
        
        // Ajouter la ressource au chunk correspondant
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);
        const chunkKey = `${chunkX},${chunkY}`;
        
        if (!resourcesByChunk.has(chunkKey)) {
          resourcesByChunk.set(chunkKey, new Set());
        }
        resourcesByChunk.get(chunkKey)?.add(resource.id);
      }
    }
  }
  
  console.log(`Nombre total de ressources générées: ${resources.size}`);
  console.log(`Nombre de chunks contenant des ressources: ${resourcesByChunk.size}`);

  return {
    mapLines,
    resources,
    resourcesByChunk
  };
} 