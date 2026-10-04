import { performance } from "node:perf_hooks";
import { setTimeout as nextTurn } from "node:timers/promises";
import { Encoder, StateView } from "@colyseus/schema";
import type { Client } from "@colyseus/core";
import { Player, Unit, UnitType, TILE_SIZE, PERFORMANCE } from "shared";
import { Simulation } from "../src/game/Simulation";
import { Visibility } from "../src/game/Visibility";
import { loadMap } from "../src/world/worldManager";

async function benchmark() {
  // The comparison deliberately encodes the entire world once.
  Encoder.BUFFER_SIZE = 512 * 1024;
  const simulation = new Simulation(loadMap(), () => {});
  const world = simulation.world;
  const players = 32,
    unitsPerPlayer = 32;
  for (let i = 0; i < players; i++) {
    const spawn = world.findSpawn({
      x: (10 + (i % 8) * 30) * TILE_SIZE,
      y: (12 + Math.floor(i / 8) * 56) * TILE_SIZE,
    });
    if (!spawn) throw new Error("Benchmark spawn not found.");
    const player = new Player();
    Object.assign(player, { id: `p${i}`, ...spawn });
    world.players.set(player.id, player);
    world.playerIndex.put(player);
    for (let j = 0; j < unitsPerPlayer; j++) {
      const point = world.findSpawn({
        x: player.x + ((j % 8) - 3) * TILE_SIZE,
        y: player.y + (Math.floor(j / 8) - 2) * TILE_SIZE,
      });
      if (!point) throw new Error("Benchmark unit spawn not found.");
      const unit = new Unit();
      Object.assign(unit, {
        id: `u${i}_${j}`,
        owner: player.id,
        type: UnitType.WARRIOR,
        ...point,
      });
      world.addUnit(unit);
    }
  }
  const encoder = new Encoder(world.state),
    visibility = new Visibility(world);
  const clients = [...world.players.values()].map(
    (player) => ({ sessionId: player.id, send() {} }) as unknown as Client,
  );
  for (const client of clients) visibility.join(client);
  const fullView = new StateView();
  for (const collection of [
    world.players,
    world.units,
    world.buildings,
    world.resources,
  ]) {
    for (const entity of collection.values()) fullView.add(entity);
  }
  const cursor = { offset: 0 };
  encoder.encodeAll(cursor);
  const fullBytes = encoder.encodeAllView(fullView, cursor.offset, {
    offset: cursor.offset,
  }).length;
  const localBytes = encoder.encodeAllView(clients[0].view!, cursor.offset, {
    offset: cursor.offset,
  }).length;
  encoder.discardChanges();
  const durations: number[] = [];
  let now = Date.now();
  for (let tick = 0; tick < 660; tick++) {
    // Change army targets regularly so this measures active movement and path searches.
    if (tick % 90 === 0)
      for (const player of world.players.values()) {
        player.isMovingUnits = true;
        player.unitMoveTargetX =
          player.x + (tick % 180 === 0 ? 1 : -1) * TILE_SIZE * 5;
        player.unitMoveTargetY = player.y;
      }
    const start = performance.now();
    simulation.update(PERFORMANCE.SIMULATION_INTERVAL, now);
    if (tick % 3 === 0) {
      for (const client of clients) visibility.update(client);
      const offset = { offset: 0 };
      encoder.encode(offset);
      for (const client of clients)
        encoder.encodeView(client.view!, offset.offset, {
          offset: offset.offset,
        });
      encoder.discardChanges();
    }
    if (tick >= 60) durations.push(performance.now() - start);
    now += PERFORMANCE.SIMULATION_INTERVAL;
    await nextTurn(0); // Let EasyStar's asynchronous callbacks run between ticks.
  }
  durations.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        node: process.version,
        map: `${world.map[0].length}x${world.map.length}`,
        players: world.players.size,
        units: world.units.size,
        resources: world.resourceIndex.queryBox(0, 0, Infinity, Infinity)
          .length,
        measuredTicks: durations.length,
        tickBudgetMs: PERFORMANCE.SIMULATION_INTERVAL,
        tickMs: {
          median: durations[Math.floor(durations.length / 2)],
          p95: durations[Math.floor(durations.length * 0.95)],
          max: durations.at(-1),
        },
        initialStateBytes: { full: fullBytes, firstPlayerView: localBytes },
        heapMiB: process.memoryUsage().heapUsed / 1024 / 1024,
      },
      null,
      2,
    ),
  );
  visibility.dispose();
  simulation.dispose();
}
void benchmark().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
