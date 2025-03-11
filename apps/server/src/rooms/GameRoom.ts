import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { 
  PlayerSchema, 
  BuildingSchema, 
  UnitSchema, 
  ResourceSchema,
  TILE_SIZE,
  CHUNK_SIZE,
  ResourceType,
  GameState 
} from "../schemas/GameState";

// Schéma principal du jeu
class GameState extends Schema {
  @type({ map: PlayerSchema })
  players = new MapSchema<PlayerSchema>();

  @type({ map: UnitSchema })
  units = new MapSchema<UnitSchema>();

  @type({ map: BuildingSchema })
  buildings = new MapSchema<BuildingSchema>();

  @type({ map: ResourceSchema })
  resources = new MapSchema<ResourceSchema>();
}

export class GameRoom extends Room<GameState> {
  private readonly SIMULATION_INTERVAL = 1000 / 30; // 30 fois par seconde
  private intervalId: NodeJS.Timeout | null = null;

  onCreate() {
    // Initialiser l'état du jeu
    this.setState(new GameState());

    // Configurer les gestionnaires de messages
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        
        // Diffuser le mouvement à tous les autres clients
        this.broadcast("playerMoved", {
          sessionId: client.sessionId,
          x: data.x,
          y: data.y
        }, { except: client });
      }
    });

    this.onMessage("harvest", (client, data) => {
      this.handleHarvest(client, data);
    });

    this.onMessage("build", (client, data) => {
      this.handleBuild(client, data);
    });

    // Log de débogage pour les connexions
    console.log("Room créée, en attente de joueurs...");
    
    // Démarrer la boucle de simulation
    this.intervalId = setInterval(() => this.update(), this.SIMULATION_INTERVAL);
    
    // Générer le monde initial
    this.generateWorld();
  }

  // Nouveau joueur rejoint la partie
  onJoin(client: Client, options: any) {
    console.log(`Joueur ${client.sessionId} a rejoint la partie`);
    console.log("Options reçues:", options);
    
    // Créer un joueur avec nom et couleur
    const player = new PlayerSchema();
    player.id = client.sessionId;
    
    // Position initiale aléatoire
    player.x = Math.floor(Math.random() * 800) + 800;
    player.y = Math.floor(Math.random() * 800) + 800;
    
    // Récupérer les infos du joueur depuis les options
    if (options && options.name) {
      player.name = options.name.substring(0, 16); // Limiter à 16 caractères
    } else {
      player.name = `Player ${client.sessionId.substring(0, 4)}`;
    }
    
    if (options && options.hue !== undefined) {
      console.log(`Teinte reçue du client: ${options.hue} (type: ${typeof options.hue})`);
      // Utiliser directement la valeur de teinte (entre 0-360)
      player.hue = options.hue;
    } else {
      // Couleur aléatoire si non spécifiée
      player.hue = Math.floor(Math.random() * 360);
      console.log(`Aucune teinte reçue, génération aléatoire: ${player.hue}`);
    }
    
    console.log(`Joueur créé: ${player.name} (${player.x}, ${player.y}), hue: ${player.hue}`);
    
    // Ajouter le joueur à la room
    this.state.players.set(client.sessionId, player);
    
    // Log de débogage pour les joueurs actuels
    console.log(`Nombre de joueurs actuels: ${this.state.players.size}`);
    this.state.players.forEach((p: PlayerSchema, id: string) => {
      console.log(`- Joueur ${id}: ${p.name} à (${p.x}, ${p.y})`);
    });
    
    // Annoncer aux autres clients qu'un nouveau joueur a rejoint
    this.broadcast("playerJoined", { 
      sessionId: client.sessionId,
      name: player.name,
      x: player.x,
      y: player.y,
      hue: player.hue
    }, { except: client });
  }

  // Joueur quitte la partie
  onLeave(client: Client, consented: boolean) {
    console.log(`Joueur ${client.sessionId} a quitté la partie`);
    
    // Supprimer le joueur
    this.state.players.delete(client.sessionId);
    
    // Annoncer aux autres clients que le joueur est parti
    this.broadcast("playerLeft", { sessionId: client.sessionId });
    
    // Log de débogage pour les joueurs restants
    console.log(`Nombre de joueurs restants: ${this.state.players.size}`);
  }

  // Nettoyage lors de la suppression de la room
  onDispose() {
    console.log("Room supprimée");
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Mise à jour du jeu (appelée à intervalle régulier)
  private update() {
    // Mise à jour de l'IA et de la production
    this.updateAI();
    this.updateProduction();
  }

  // Génération du monde initial
  private generateWorld() {
    // Générer les ressources
    this.generateResources();
  }

  // Génération des ressources
  private generateResources() {
    // Générer l'or, le bois et la pierre ici
    // Exemple simple: générer quelques ressources
    for (let i = 0; i < 10; i++) {
      // Or
      const gold = new ResourceSchema();
      gold.id = `gold_${i}`;
      gold.type = ResourceType.GOLD;
      gold.x = Math.floor(Math.random() * 2000);
      gold.y = Math.floor(Math.random() * 2000);
      this.state.resources.set(gold.id, gold);
      
      // Bois
      const wood = new ResourceSchema();
      wood.id = `wood_${i}`;
      wood.type = ResourceType.WOOD;
      wood.x = Math.floor(Math.random() * 2000);
      wood.y = Math.floor(Math.random() * 2000);
      this.state.resources.set(wood.id, wood);
      
      // Pierre
      const stone = new ResourceSchema();
      stone.id = `stone_${i}`;
      stone.type = ResourceType.STONE;
      stone.x = Math.floor(Math.random() * 2000);
      stone.y = Math.floor(Math.random() * 2000);
      this.state.resources.set(stone.id, stone);
    }
  }

  // Gestion de la récolte de ressources
  private handleHarvest(client: Client, data: any) {
    // Récupération du joueur et de la ressource
    const player = this.state.players.get(client.sessionId);
    const resourceId = data.resourceId;
    const resource = this.state.resources.get(resourceId);
    
    if (!player || !resource) {
      console.log(`Ressource ou joueur non trouvé: ${resourceId}`);
      return;
    }
    
    // Vérifier la distance entre le joueur et la ressource
    const distance = Math.sqrt(
      Math.pow(player.x - resource.x, 2) + 
      Math.pow(player.y - resource.y, 2)
    );
    
    // Si le joueur est trop loin, annuler la récolte
    if (distance > 50) {
      console.log(`Joueur trop loin pour récolter: ${distance.toFixed(2)} pixels`);
      return;
    }
    
    console.log(`${client.sessionId} récolte ${resourceId} de type ${resource.type}`);
    
    // Quantité à récolter
    const harvestAmount = 5;
    
    // Initialiser les ressources du joueur si nécessaire
    if (!player.resources) {
      player.resources = new MapSchema<number>();
    }
    
    // Ajouter la ressource au joueur selon son type
    const currentAmount = player.resources.get(resource.type) || 0;
    player.resources.set(resource.type, currentAmount + harvestAmount);
    
    // Réduire la quantité de ressource disponible
    resource.amount -= harvestAmount;
    
    // Supprimer la ressource si elle est épuisée
    if (resource.amount <= 0) {
      this.state.resources.delete(resourceId);
      console.log(`Ressource épuisée: ${resourceId}`);
    }
    
    console.log(`Joueur ${client.sessionId} a maintenant ${player.resources.get(resource.type)} ${resource.type}`);
  }

  // Gestion de la construction
  private handleBuild(client: Client, data: any) {
    // Implémenter la construction ici
    console.log(`${client.sessionId} tente de construire à (${data.x}, ${data.y})`);
  }

  // Mise à jour de l'IA
  private updateAI() {
    // Mettre à jour l'IA ici
  }

  // Mise à jour de la production
  private updateProduction() {
    // Mettre à jour la production ici
  }
} 