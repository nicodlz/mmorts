import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { WorldState, TILE_SIZE, ResourceType } from "shared";
import { GameRoom } from "../src/rooms/GameRoom";
import { parseMap } from "../src/world/worldManager";

async function waitFor(predicate: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for a network state change.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test(
  "real Colyseus clients receive filtered state, private inventory and authoritative corrections",
  { timeout: 20000 },
  async () => {
    const rows = Array.from({ length: 160 }, (_, y) =>
      y === 0 || y === 159 ? "#".repeat(160) : `#${".".repeat(158)}#`,
    );
    rows[12] = rows[12].slice(0, 11) + "G" + rows[12].slice(12);
    rows[120] = rows[120].slice(0, 120) + "W" + rows[120].slice(121);
    const server = new Server({
      transport: new WebSocketTransport({
        server: createServer(),
        maxPayload: 16384,
      }),
      gracefullyShutdown: false,
    });
    server.define("network_test", GameRoom, {
      worldData: parseMap(rows.join("\n")),
    });
    await server.listen(0, "127.0.0.1");
    const address = server.transport.server!.address();
    assert.ok(address && typeof address !== "string");
    const sdk = new Client(`ws://127.0.0.1:${address.port}`);
    const clients: Room<WorldState>[] = [];
    try {
      const first = await sdk.joinOrCreate<WorldState>(
        "network_test",
        { name: "Alice", hue: 150 },
        WorldState,
      );
      clients.push(first);
      let worldInfo = false;
      first.onMessage("worldInfo", () => {
        worldInfo = true;
      });
      first.onMessage("gameEvent", () => {});
      first.onMessage("actionRejected", () => {});
      first.send("ready", {});
      await waitFor(
        () => worldInfo && first.state.players.has(first.sessionId),
      );
      let latency: number | undefined;
      first.ping((ms) => {
        latency = ms;
      });
      await waitFor(() => latency !== undefined);
      assert.ok(Number.isFinite(latency) && latency! >= 0);
      const serverRoom = matchMaker.getLocalRoomById(first.roomId) as GameRoom;
      const alice = serverRoom.state.players.get(first.sessionId)!;
      alice.resources.set("gold", 123);
      const second = await sdk.joinOrCreate<WorldState>(
        "network_test",
        { name: "Bob", hue: -10 },
        WorldState,
      );
      clients.push(second);
      second.onMessage("gameEvent", () => {});
      second.onMessage("actionRejected", () => {});
      await waitFor(
        () =>
          second.state.players.has(first.sessionId) &&
          first.state.players.has(second.sessionId),
      );
      assert.equal(
        first.state.players.get(first.sessionId)?.resources.get("gold"),
        123,
      );
      assert.equal(
        second.state.players.get(first.sessionId)?.resources.size,
        0,
      );
      assert.equal(second.state.players.get(second.sessionId)?.hue, 350);
      assert.equal(first.state.resources.has("gold_11_12"), true);
      assert.equal(first.state.resources.has("wood_120_120"), false);
      let correction: { x: number; y: number } | undefined;
      first.onMessage("positionCorrection", (point) => {
        correction = point;
      });
      const start = { x: alice.x, y: alice.y };
      first.send("move", { x: 100000, y: 100000 });
      await waitFor(() => correction !== undefined);
      assert.deepEqual(correction, start);
      assert.equal(alice.x, start.x);
      correction = undefined;
      first.send("move", { x: NaN, y: Infinity });
      await waitFor(() => correction !== undefined);
      assert.deepEqual(correction, start);
      // Nearby legal movement still works after a rejected packet.
      first.send("move", { x: start.x, y: start.y + 5 });
      await waitFor(() => alice.y === start.y + 5);
      const before = alice.resources.get(ResourceType.GOLD);
      first.send("harvest", null);
      first.send("spawnUnit", { buildingId: "none", unitType: "villager" });
      first.send("build", { type: "__proto__", x: start.x, y: start.y });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(alice.resources.get(ResourceType.GOLD), before);
      assert.equal(serverRoom.state.units.size, 0);
      // The server moves an observer between distant areas to test native view add/remove.
      const bob = serverRoom.state.players.get(second.sessionId)!;
      bob.x = 120 * TILE_SIZE;
      bob.y = 120 * TILE_SIZE;
      serverRoom.simulation.world.playerIndex.put(bob);
      await waitFor(
        () =>
          !second.state.players.has(first.sessionId) &&
          second.state.resources.has("wood_120_120"),
      );
      assert.equal(second.state.resources.has("gold_11_12"), false);
      bob.x = start.x;
      bob.y = start.y;
      serverRoom.simulation.world.playerIndex.put(bob);
      await waitFor(
        () =>
          second.state.players.has(first.sessionId) &&
          second.state.resources.has("gold_11_12"),
      );
      assert.equal(second.state.resources.has("wood_120_120"), false);
      assert.equal(
        second.state.players.get(first.sessionId)?.resources.size,
        0,
      );
      await first.leave();
      clients.splice(clients.indexOf(first), 1);
      await waitFor(() => !second.state.players.has(first.sessionId));
      assert.equal(
        serverRoom.simulation.world.players.has(first.sessionId),
        false,
      );
      assert.equal(
        serverRoom.simulation.world.unitsByOwner.has(first.sessionId),
        false,
      );
    } finally {
      await Promise.all(clients.map((room) => room.leave()));
      await server.gracefullyShutdown(false);
    }
  },
);
