import { Client, Room } from "@colyseus/sdk";
import { PROTOCOL_VERSION, WorldState } from "shared";
import type { ClientMessages, ServerMessages } from "shared";

export function serverEndpoint(): string {
  if (import.meta.env.VITE_COLYSEUS_URL)
    return import.meta.env.VITE_COLYSEUS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${import.meta.env.DEV ? "/colyseus" : ""}`;
}

/** Colyseus Room and its schema callbacks supply the state; no parallel client model. */
export class GameConnection {
  room?: Room<WorldState>;
  closed = false;
  private pending?: (error: Error) => void;

  async connect(
    name: string,
    hue: number,
    handlers: {
      worldInfo: (info: ServerMessages["worldInfo"]) => void;
      state: (state: WorldState) => void;
      event: (event: ServerMessages["gameEvent"]) => void;
      rejected: (reason: string) => void;
      correction: (point: ServerMessages["positionCorrection"]) => void;
      left: () => void;
    },
  ): Promise<void> {
    const room = await new Client(serverEndpoint()).joinOrCreate<WorldState>(
      "game_room",
      { name, hue },
      WorldState,
    );
    if (this.closed) {
      await room.leave();
      throw new Error("Connection cancelled.");
    }
    this.room = room;
    // The room removes a disconnected player immediately; retries use the visible retry action.
    room.reconnection.enabled = false;
    await new Promise<void>((resolve, reject) => {
      let gotMap = false;
      let gotPlayer = false;
      const finish = () => {
        if (!gotMap || !gotPlayer) return;
        clearTimeout(timeout);
        this.pending = undefined;
        resolve();
      };
      const fail = (error: Error) => {
        clearTimeout(timeout);
        this.pending = undefined;
        reject(error);
      };
      const timeout = window.setTimeout(
        () => fail(new Error("Le serveur ne répond pas.")),
        10000,
      );
      this.pending = fail;
      room.onMessage<ServerMessages["worldInfo"]>("worldInfo", (info) => {
        if (this.closed) return;
        if (info.protocolVersion !== PROTOCOL_VERSION) {
          fail(new Error("Versions du client et du serveur incompatibles."));
          return;
        }
        handlers.worldInfo(info);
        gotMap = true;
        finish();
      });
      room.onStateChange((state) => {
        if (this.closed) return;
        handlers.state(state);
        gotPlayer = state.players.has(room.sessionId);
        finish();
      });
      room.onMessage<ServerMessages["gameEvent"]>("gameEvent", (event) => {
        if (!this.closed) handlers.event(event);
      });
      room.onMessage<ServerMessages["actionRejected"]>(
        "actionRejected",
        (message) => {
          if (!this.closed) handlers.rejected(message.reason);
        },
      );
      room.onMessage<ServerMessages["positionCorrection"]>(
        "positionCorrection",
        (point) => {
          if (!this.closed) handlers.correction(point);
        },
      );
      room.onLeave(() => {
        if (!this.closed) {
          fail(new Error("Connexion interrompue."));
          handlers.left();
        }
      });
      room.onError((_code, message) => {
        if (!this.closed) handlers.rejected(message || "Erreur réseau.");
      });
      // Handlers are installed before the server sends the map. Schema state may arrive first.
      room.send("ready", {});
      if (room.state.players.has(room.sessionId)) {
        handlers.state(room.state);
        gotPlayer = true;
      }
      finish();
    });
  }
  send<K extends keyof ClientMessages>(
    type: K,
    payload: ClientMessages[K],
  ): void {
    if (!this.closed) this.room?.send(type, payload);
  }
  ping(callback: (ms: number) => void): void {
    if (!this.closed)
      this.room?.ping((ms) => {
        if (!this.closed) callback(ms);
      });
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending?.(new Error("Connection cancelled."));
    this.pending = undefined;
    if (this.room) {
      // SDK's own onLeave listener clears callbacks and tears down the decoder.
      void this.room.leave();
    }
    this.room = undefined;
  }
}
