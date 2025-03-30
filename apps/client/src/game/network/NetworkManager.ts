import { Client } from 'colyseus.js';
import Phaser from 'phaser';
import { EventEmitter } from 'events';

export class NetworkManager extends EventEmitter {
  private client: Client;
  private room: any;
  private scene: Phaser.Scene;
  private isConnected: boolean = false;
  private lastPingTime: number = 0;
  private currentPing: number = 0;
  
  constructor(scene: Phaser.Scene) {
    super();
    this.scene = scene;
    
    // Créer le client Colyseus
    const protocol = window.location.protocol.replace('http', 'ws');
    const endpoint = process.env.NODE_ENV === 'production' 
      ? `${protocol}//${window.location.host}` 
      : `${protocol}//localhost:2567`;
    
    this.client = new Client(endpoint);
    console.log(`Client Colyseus initialisé avec l'endpoint: ${endpoint}`);
  }
  
  async connectToServer(playerName: string, playerHue: number): Promise<boolean> {
    try {
      console.log(`Tentative de connexion avec nom: ${playerName}, teinte: ${playerHue}`);
      
      // Joindre ou créer la salle de jeu
      this.room = await this.client.joinOrCreate("game", {
        name: playerName,
        hue: playerHue
      });
      
      console.log("Connexion réussie! ID du joueur:", this.room.sessionId);
      this.isConnected = true;
      
      // Écouter les messages du serveur
      this.setupMessageHandlers();
      
      // Émettre un événement local de connexion réussie
      this.emit('connected', this.room.sessionId);
      
      return true;
    } catch (error) {
      console.error("Erreur lors de la connexion au serveur:", error);
      this.isConnected = false;
      
      // Émettre un événement local d'erreur de connexion
      this.emit('connectionError', error);
      
      return false;
    }
  }
  
  private setupMessageHandlers() {
    if (!this.room) return;
    
    // Configurer les écouteurs d'événements génériques
    this.room.onStateChange((state: any) => {
      this.emit('stateChanged', state);
    });
    
    this.room.onError((code: number, message: string) => {
      console.error(`Erreur du serveur: [${code}] ${message}`);
      this.emit('error', { code, message });
    });
    
    this.room.onLeave((code: number) => {
      console.log(`Déconnecté du serveur avec code: ${code}`);
      this.isConnected = false;
      this.emit('disconnected', code);
    });
    
    // Gestion des pings pour mesurer la latence
    this.setupPing();
  }
  
  private setupPing() {
    if (!this.room) return;
    
    // Envoyer un ping toutes les secondes
    const pingInterval = setInterval(() => {
      if (!this.isConnected) {
        clearInterval(pingInterval);
        return;
      }
      
      this.lastPingTime = Date.now();
      this.room.send("ping");
    }, 1000);
    
    // Recevoir les pongs
    this.room.onMessage("pong", () => {
      this.currentPing = Date.now() - this.lastPingTime;
      this.emit('pingUpdated', this.currentPing);
    });
  }
  
  // Méthode pour envoyer un message au serveur
  send(messageType: string, data?: any) {
    if (!this.room || !this.isConnected) {
      console.warn(`Tentative d'envoi du message "${messageType}" alors que non connecté`);
      return false;
    }
    
    try {
      this.room.send(messageType, data);
      return true;
    } catch (error) {
      console.error(`Erreur lors de l'envoi du message "${messageType}":`, error);
      return false;
    }
  }
  
  // Méthode pour s'abonner aux messages du serveur
  onMessage(messageType: string, callback: (data: any) => void) {
    if (!this.room) {
      console.warn(`Tentative d'écoute du message "${messageType}" alors que la salle n'est pas initialisée`);
      return () => {}; // Fonction vide pour désabonnement
    }
    
    this.room.onMessage(messageType, callback);
    
    // Retourner une fonction pour se désabonner
    return () => {
      // Note: Colyseus ne fournit pas de méthode directe pour se désabonner
      // des messages individuels, donc on réimplémente avec un écouteur vide
      this.room.onMessage(messageType, () => {});
    };
  }
  
  // Récupérer le client Colyseus
  getClient(): Client {
    return this.client;
  }
  
  // Récupérer la salle de jeu
  getRoom(): any {
    return this.room;
  }
  
  // Vérifier si on est connecté au serveur
  isServerConnected(): boolean {
    return this.isConnected;
  }
  
  // Récupérer la latence actuelle
  getPing(): number {
    return this.currentPing;
  }
  
  // Méthode pour se déconnecter proprement
  disconnect() {
    if (this.room) {
      this.room.leave();
      this.isConnected = false;
    }
  }
} 