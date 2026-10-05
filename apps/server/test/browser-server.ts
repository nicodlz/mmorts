import { Server, type Client } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "node:http";
import { ResourceType } from "shared";
import { GameRoom } from "../src/rooms/GameRoom";
import { parseMap } from "../src/world/worldManager";

// Test-only fixture: no cheats, grants or admin endpoints exist in the production server.
class BrowserRoom extends GameRoom {
  onJoin(client: Client, options: unknown): void {
    super.onJoin(client, options);
    const player = this.state.players.get(client.sessionId)!;
    if (player.name.startsWith("Tutorial")) return;
    for (const type of Object.values(ResourceType))
      player.resources.set(type, 1000);
  }
}
const rows = Array.from({ length: 64 }, (_, y) =>
  y === 0 || y === 63 ? "#".repeat(64) : `#${".".repeat(62)}#`,
);
rows[12] = rows[12].slice(0, 10) + "G" + rows[12].slice(11);
for (const [x, y, type] of [
  [6, 8, "W"],
  [6, 6, "W"],
  [6, 4, "W"],
  [3, 4, "W"],
  [12, 8, "S"],
  [12, 5, "S"],
] as const)
  rows[y] = rows[y].slice(0, x) + type + rows[y].slice(x + 1);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});
gameServer.define("game_room", BrowserRoom, {
  worldData: parseMap(rows.join("\n")),
});
void gameServer.listen(2577, "127.0.0.1");
