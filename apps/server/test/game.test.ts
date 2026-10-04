import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Encoder, Decoder, StateView } from "@colyseus/schema";
import {
  BUILDING_COSTS,
  BuildingType,
  DEATH_SYSTEM,
  Player,
  Resource,
  ResourceType,
  TILE_SIZE,
  Unit,
  UnitType,
  UnitState,
  WorldState,
} from "shared";
import { Simulation } from "../src/game/Simulation";
import { parseMap } from "../src/world/worldManager";
import { SpatialIndex } from "../src/game/SpatialIndex";

function fixture() {
  const map = Array.from({ length: 40 }, (_, y) =>
    y === 0 || y === 39 ? "#".repeat(40) : `#${".".repeat(38)}#`,
  ).join("\n");
  const events: { kind: string; amount?: number }[] = [];
  const simulation = new Simulation(parseMap(map), (event) =>
    events.push(event),
  );
  const player = new Player();
  player.id = "player";
  player.x = 10 * TILE_SIZE;
  player.y = 12 * TILE_SIZE;
  for (const type of Object.values(ResourceType))
    player.resources.set(type, 1000);
  simulation.world.players.set(player.id, player);
  simulation.world.playerIndex.put(player);
  const build = (type: BuildingType) => {
    assert.equal(
      simulation.economy.build(player, type, {
        x: 12 * TILE_SIZE,
        y: 12 * TILE_SIZE,
      }),
      undefined,
    );
    return [...simulation.world.buildings.values()].at(-1)!;
  };
  return { simulation, player, build, events };
}

test("map parsing normalizes CRLF, rejects ragged maps, and initializes finite amounts", () => {
  const map = parseMap("#####\r\n#GWS#\r\n#####\r\n");
  assert.equal(map.mapLines.length, 3);
  assert.deepEqual(
    map.resources.map((resource) => resource.amount),
    [100, 10, 20],
  );
  assert.equal(map.resources[0].maxAmount, 100);
  assert.throws(() => parseMap("###\n##"));
  assert.equal(parseMap("#####\n#IC.#\n#####").resources.length, 0);
});

test("rooms clone mutable resources rather than sharing depletion", () => {
  const template = parseMap("#####\n#G..#\n#####");
  const first = new Simulation(template, () => {}),
    second = new Simulation(template, () => {});
  first.world.resources.values().next().value!.amount = 0;
  assert.equal(second.world.resources.values().next().value!.amount, 100);
  assert.equal(template.resources[0].amount, 100);
});

test("native schemas encode initialized fields and keep inventory private through StateView", () => {
  const state = new WorldState(),
    player = new Player();
  player.id = "owner";
  player.x = 320;
  player.resources.set("gold", 42);
  state.players.set(player.id, player);
  const encoder = new Encoder(state),
    ownerView = new StateView(),
    strangerView = new StateView();
  ownerView.add(player);
  ownerView.add(player, 1);
  strangerView.add(player);
  const cursor = { offset: 0 };
  encoder.encodeAll(cursor);
  const sharedOffset = cursor.offset;
  const owner = new Decoder(new WorldState()),
    stranger = new Decoder(new WorldState());
  owner.decode(
    encoder.encodeAllView(ownerView, sharedOffset, { offset: sharedOffset }),
  );
  stranger.decode(
    encoder.encodeAllView(strangerView, sharedOffset, { offset: sharedOffset }),
  );
  assert.equal(owner.state.players.get("owner")?.x, 320);
  assert.equal(owner.state.players.get("owner")?.resources.get("gold"), 42);
  assert.equal(stranger.state.players.get("owner")?.resources.size, 0);
});

for (const [type, duration, input, output] of [
  [BuildingType.FURNACE, 10000, ResourceType.WOOD, ResourceType.COAL],
  [BuildingType.FORGE, 8000, ResourceType.STONE, ResourceType.IRON],
  [BuildingType.FACTORY, 30000, ResourceType.COAL, ResourceType.STEEL],
] as const) {
  test(`${type} accumulates fractional progress, completes on elapsed time, and respects pause`, () => {
    const { simulation, player, build, events } = fixture();
    const building = build(type);
    const before = player.resources.get(output)!;
    for (let i = 0; i < duration / 100; i++)
      simulation.economy.update(100, i * 100);
    assert.ok(player.resources.get(output)! > before);
    assert.equal(building.productionProgress, 0);
    assert.equal(
      events.filter((event) => event.kind === "production").length,
      1,
    );
    building.productionActive = false;
    simulation.economy.update(duration, duration * 2);
    assert.equal(building.productionElapsed, 0);
    building.productionActive = true;
    player.resources.set(input, 0);
    simulation.economy.update(duration, duration * 3);
    assert.equal(building.productionProgress, 100);
    const stalled = player.resources.get(output)!;
    simulation.economy.update(100, duration * 3 + 100);
    assert.equal(player.resources.get(output), stalled);
  });
}

test("harvesting caps the last batch and throttles per player across resource nodes", () => {
  const { simulation, player } = fixture();
  for (let i = 0; i < 2; i++) {
    const resource = new Resource();
    Object.assign(resource, {
      id: `r${i}`,
      type: ResourceType.GOLD,
      x: player.x + 30,
      y: player.y + i,
      amount: i === 0 ? 1 : 100,
    });
    simulation.world.resources.set(resource.id, resource);
    simulation.world.resourceIndex.put(resource);
  }
  const before = player.resources.get("gold")!;
  assert.equal(simulation.economy.harvest(player, "r0", 1000), undefined);
  assert.equal(player.resources.get("gold"), before + 1);
  assert.equal(simulation.economy.harvest(player, "r1", 1001), "cooldown");
  assert.equal(simulation.economy.harvest(player, "r1", 1500), undefined);
  player.isDead = true;
  assert.equal(
    simulation.economy.harvest(player, "r1", 2000),
    "Vous êtes mort.",
  );
});

test("construction rejects walls, resources, occupied positions and distant coordinates without charging", () => {
  const { simulation, player } = fixture();
  const before = player.resources.get("wood");
  assert.ok(
    simulation.economy.build(player, BuildingType.HOUSE, {
      x: player.x,
      y: player.y,
    }),
  );
  assert.ok(
    simulation.economy.build(player, BuildingType.HOUSE, { x: -1, y: -1 }),
  );
  assert.ok(
    simulation.economy.build(player, BuildingType.HOUSE, { x: 1000, y: 1000 }),
  );
  const resource = new Resource();
  Object.assign(resource, {
    id: "wood_12_12",
    type: ResourceType.WOOD,
    x: 400,
    y: 400,
  });
  simulation.world.resourcesByTile.set("12,12", resource);
  assert.ok(
    simulation.economy.build(player, BuildingType.HOUSE, { x: 384, y: 384 }),
  );
  assert.equal(player.resources.get("wood"), before);
});

test("decreasing housing capacity never hides living units from the population count", () => {
  const { simulation, player, build } = fixture();
  const house = build(BuildingType.HOUSE);
  const unit = new Unit();
  Object.assign(unit, { id: "warrior", owner: player.id, x: 200, y: 200 });
  simulation.world.addUnit(unit);
  assert.equal(player.population, 2);
  assert.equal(player.maxPopulation, 10);
  const before = player.resources.get("wood")!;
  simulation.economy.destroy(house.id, true);
  assert.equal(player.maxPopulation, 0);
  assert.equal(player.population, 2);
  assert.equal(
    player.resources.get("wood"),
    before + Math.floor(BUILDING_COSTS[BuildingType.HOUSE].wood! * 0.75),
  );
  simulation.world.removeUnit(unit.id);
  assert.equal(player.population, 1);
});

test("unit spawning checks type, owner, population, cost, health and unique IDs", () => {
  const { simulation, player, build } = fixture();
  const barracks = build(BuildingType.BARRACKS);
  assert.ok(simulation.units.spawn(player, barracks.id, UnitType.WARRIOR));
  player.maxPopulation = 10;
  const before = player.resources.get("gold")!;
  assert.equal(
    simulation.units.spawn(player, barracks.id, UnitType.WARRIOR),
    undefined,
  );
  assert.equal(
    simulation.units.spawn(player, barracks.id, UnitType.WARRIOR),
    undefined,
  );
  assert.equal(player.population, 3);
  assert.equal(player.resources.get("gold"), before - 4);
  assert.equal(new Set(simulation.world.units.keys()).size, 2);
  assert.ok(simulation.units.spawn(player, barracks.id, UnitType.VILLAGER));
});

test("villagers deposit the final partial bag and do not mix resource types", () => {
  const { simulation, player, build } = fixture();
  const home = build(BuildingType.TOWN_CENTER);
  player.maxPopulation = 10;
  assert.equal(
    simulation.units.spawn(player, home.id, UnitType.VILLAGER),
    undefined,
  );
  const villager = [...simulation.world.units.values()][0];
  assert.equal(villager.health, 50);
  const resource = new Resource();
  Object.assign(resource, {
    id: "gold",
    x: villager.x + 25,
    y: villager.y,
    amount: 1,
  });
  simulation.world.resources.set(resource.id, resource);
  simulation.world.resourceIndex.put(resource);
  const before = player.resources.get("gold")!;
  simulation.units.updateVillagers(100, 10000);
  assert.equal(villager.carryingAmount, 1);
  assert.equal(villager.state, UnitState.RETURNING);
  simulation.units.updateVillagers(100, 10100);
  assert.equal(player.resources.get("gold"), before + 1);
  assert.equal(villager.carryingAmount, 0);
  villager.carryingAmount = 3;
  villager.carryingType = ResourceType.WOOD;
  villager.targetResourceId = "gone";
  simulation.units.updateVillagers(100, 10200);
  assert.equal(villager.carryingAmount, 0);
});

test("combat finds enemies across spatial boundaries and never damages a deleted target twice", () => {
  const { simulation, player } = fixture();
  const defender = new Player();
  defender.id = "enemy";
  defender.x = 900;
  defender.y = 900;
  simulation.world.players.set(defender.id, defender);
  simulation.world.playerIndex.put(defender);
  for (const [id, owner, x, health] of [
    ["a", player.id, 127, 100],
    ["b", defender.id, 129, 1],
  ] as const) {
    const unit = new Unit();
    Object.assign(unit, { id, owner, x, y: 100, health });
    simulation.world.addUnit(unit);
  }
  simulation.combat.update(10000);
  assert.equal(simulation.world.units.has("b"), false);
  assert.equal(defender.population, 1);
});

test("combat destruction does not refund costs and player death loses resources through MapSchema", () => {
  const { simulation, player, build } = fixture();
  const house = build(BuildingType.HOUSE);
  house.health = 1;
  const attacker = new Unit();
  Object.assign(attacker, {
    id: "enemy_unit",
    owner: "enemy",
    x: house.x + 16,
    y: house.y + 16,
  });
  simulation.world.addUnit(attacker);
  const before = player.resources.get("wood");
  simulation.combat.update(10000);
  assert.equal(simulation.world.buildings.has(house.id), false);
  assert.equal(player.resources.get("wood"), before);
  attacker.x = player.x;
  attacker.y = player.y;
  simulation.world.unitIndex.put(attacker);
  player.health = 1;
  player.resources.set("gold", 101);
  simulation.combat.update(11000);
  assert.equal(player.isDead, true);
  assert.equal(player.resources.get("gold"), 71);
  simulation.combat.updateRespawns(11000 + DEATH_SYSTEM.PLAYER_RESPAWN_TIME);
  assert.equal(player.isDead, false);
  assert.equal(player.health, player.maxHealth);
  assert.equal(player.isInvulnerable, true);
  simulation.combat.updateRespawns(player.invulnerableUntil);
  assert.equal(player.isInvulnerable, false);
});

test("RBush entries remain correct after a mutable entity crosses the index", () => {
  const tree = new SpatialIndex<Player>(),
    player = new Player();
  player.id = "test";
  tree.put(player);
  player.x = 500;
  tree.put(player);
  assert.equal(tree.queryRadius(0, 0, 10).length, 0);
  assert.equal(tree.queryRadius(500, 0, 10).length, 1);
  tree.remove(player.id);
  assert.equal(tree.queryRadius(500, 0, 10).length, 0);
});

test("EasyStar routes around a wall with bounded incremental calculation and collision checks", async () => {
  const { simulation, player } = fixture();
  for (let y = 3; y <= 8; y++)
    simulation.world.map[y] =
      simulation.world.map[y].slice(0, 6) +
      "#" +
      simulation.world.map[y].slice(7);
  // Build a fresh navigator against the fixture with the wall present.
  const data = parseMap(simulation.world.map.join("\n"));
  const routed = new Simulation(data, () => {});
  const unit = new Unit();
  Object.assign(unit, {
    id: "path",
    owner: player.id,
    x: 4.5 * TILE_SIZE,
    y: 5.5 * TILE_SIZE,
  });
  routed.world.addUnit(unit);
  const target = { x: 8.5 * TILE_SIZE, y: 5.5 * TILE_SIZE };
  for (let i = 0; i < 160; i++) {
    routed.navigation.update();
    routed.navigation.move(unit, target, 180, 100, i * 100);
    assert.ok(routed.world.isFree(unit.x, unit.y, 3));
    await nextTurn();
  }
  assert.ok(Math.hypot(unit.x - target.x, unit.y - target.y) <= 4);
  routed.dispose();
});

test("disconnect removes dynamic state, spatial entries and owner indexes", () => {
  const { simulation, player, build } = fixture();
  build(BuildingType.HOUSE);
  const unit = new Unit();
  Object.assign(unit, { id: "u", owner: player.id, x: 200, y: 200 });
  simulation.world.addUnit(unit);
  simulation.removePlayer(player.id);
  assert.equal(simulation.world.players.size, 0);
  assert.equal(simulation.world.units.size, 0);
  assert.equal(simulation.world.buildings.size, 0);
  assert.equal(simulation.world.unitsByOwner.size, 0);
  assert.equal(simulation.world.buildingsByOwner.size, 0);
  assert.equal(
    simulation.world.playerIndex.queryRadius(player.x, player.y, 100).length,
    0,
  );
});

test("a completed path survives an unrelated building edit", async () => {
  const { simulation, player } = fixture();
  const unit = new Unit();
  Object.assign(unit, { id: "route", owner: player.id, x: 100, y: 100 });
  simulation.world.addUnit(unit);
  const target = { x: 600, y: 100 };
  simulation.navigation.move(unit, target, 70, 100, 1000);
  simulation.navigation.update();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(unit.path.length > 0);
  const path = unit.path;
  simulation.world.invalidate(1000, 1000);
  simulation.navigation.update();
  simulation.navigation.move(unit, target, 70, 100, 1100);
  assert.equal(unit.path, path);
  simulation.dispose();
});

test("a cancelled asynchronous path cannot overwrite a newer command", async () => {
  const { simulation, player } = fixture();
  const unit = new Unit();
  Object.assign(unit, { id: "route", owner: player.id, x: 100, y: 100 });
  simulation.world.addUnit(unit);
  simulation.navigation.move(unit, { x: 600, y: 100 }, 70, 100, 1000);
  simulation.navigation.update();
  simulation.navigation.move(unit, { x: 100, y: 600 }, 70, 100, 1100);
  simulation.navigation.update();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(unit.path.at(-1)?.y, 592);
  assert.equal(unit.path.at(-1)?.x, 112);
  simulation.dispose();
});

test("villagers skip an unreachable resource and choose an accessible node", async () => {
  const rows = Array.from({ length: 40 }, (_, y) =>
    y === 0 || y === 39 ? "#".repeat(40) : `#${".".repeat(38)}#`,
  );
  for (let y = 1; y < 39; y++)
    rows[y] = rows[y].slice(0, 15) + "#" + rows[y].slice(16);
  rows[12] = rows[12].slice(0, 16) + "G" + rows[12].slice(17);
  rows[20] = rows[20].slice(0, 12) + "W" + rows[20].slice(13);
  const simulation = new Simulation(parseMap(rows.join("\n")), () => {});
  const player = new Player();
  player.id = "p";
  player.x = 320;
  player.y = 384;
  player.maxPopulation = 10;
  for (const type of Object.values(ResourceType))
    player.resources.set(type, 1000);
  simulation.world.players.set(player.id, player);
  simulation.world.playerIndex.put(player);
  assert.equal(
    simulation.economy.build(player, BuildingType.TOWN_CENTER, {
      x: 384,
      y: 384,
    }),
    undefined,
  );
  const home = [...simulation.world.buildings.values()][0];
  assert.equal(
    simulation.units.spawn(player, home.id, UnitType.VILLAGER),
    undefined,
  );
  const villager = [...simulation.world.units.values()][0];
  villager.x = 14.5 * TILE_SIZE;
  villager.y = 12.5 * TILE_SIZE;
  simulation.world.unitIndex.put(villager);
  simulation.units.updateVillagers(100, 1000);
  assert.equal(villager.targetResourceId, "gold_16_12");
  simulation.navigation.update();
  await new Promise((resolve) => setTimeout(resolve, 10));
  simulation.units.updateVillagers(100, 1100);
  assert.equal(villager.ignoredResources.has("gold_16_12"), true);
  simulation.units.updateVillagers(100, 2100);
  assert.equal(villager.targetResourceId, "wood_12_20");
  simulation.dispose();
});
