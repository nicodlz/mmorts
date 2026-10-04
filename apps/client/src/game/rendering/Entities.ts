import Phaser from "phaser";
import { getStateCallbacks, type Room } from "@colyseus/sdk";
import { TILE_SIZE, UnitType } from "shared";
import type { Building, Player, Resource, Unit, WorldState } from "shared";
import { Collision } from "./Collision";
import { hueColor, RESOURCE_SPRITES } from "./presentation";

interface Actor {
  object: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  health: Phaser.GameObjects.Rectangle;
  entity: Player | Unit;
}
interface BuildingSprite {
  object: Phaser.GameObjects.Container;
  entity: Building;
  progress: Phaser.GameObjects.Rectangle;
  health: Phaser.GameObjects.Rectangle;
}

export class Entities {
  readonly players = new Map<string, Actor>();
  readonly units = new Map<string, Actor>();
  readonly buildings = new Map<string, BuildingSprite>();
  readonly resources = new Map<string, Phaser.GameObjects.Image>();
  private readonly detach: (() => void)[] = [];
  private readonly resourceDetach = new Map<string, () => void>();
  private cullElapsed = 200;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly collision: Collision,
    private readonly selectBuilding: (id: string) => void,
  ) {}

  bind(room: Room<WorldState>): void {
    const $ = getStateCallbacks(room);
    this.detach.push(
      $(room.state).players.onAdd((player, id) => {
        const actor = this.actor(player, player.name, hueColor(player.hue), 6);
        this.players.set(id, actor);
      }),
      $(room.state).players.onRemove((_player, id) =>
        this.removeActor(this.players, id),
      ),
      $(room.state).units.onAdd((unit, id) => {
        const owner = room.state.players.get(unit.owner);
        const color = owner ? hueColor(owner.hue) : 0xcccccc;
        this.units.set(
          id,
          this.actor(
            unit,
            unit.type === UnitType.VILLAGER ? "V" : "",
            color,
            unit.type === UnitType.VILLAGER ? 4 : 5,
          ),
        );
      }),
      $(room.state).units.onRemove((_unit, id) =>
        this.removeActor(this.units, id),
      ),
      $(room.state).resources.onAdd((resource, id) => {
        this.resource(resource, id);
        this.resourceDetach.set(
          id,
          $(resource).onChange(() => this.resource(resource, id)),
        );
      }),
      $(room.state).resources.onRemove((_resource, id) => {
        this.resourceDetach.get(id)?.();
        this.resourceDetach.delete(id);
        this.resources.get(id)?.destroy();
        this.resources.delete(id);
        this.collision.remove(id);
      }),
      $(room.state).buildings.onAdd((building, id) => {
        const object = this.scene.add
          .container(building.x + TILE_SIZE / 2, building.y + TILE_SIZE / 2)
          .setDepth(5);
        const image = this.scene.add
          .image(0, 0, building.type)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setInteractive();
        image.on(
          "pointerdown",
          (
            _pointer: Phaser.Input.Pointer,
            _x: number,
            _y: number,
            event: Phaser.Types.Input.EventData,
          ) => {
            event.stopPropagation();
            this.selectBuilding(id);
          },
        );
        const owner = room.state.players.get(building.owner);
        const ownerMark = this.scene.add.rectangle(
          0,
          12,
          22,
          2,
          owner ? hueColor(owner.hue) : 0xcccccc,
        );
        const health = this.scene.add
          .rectangle(-12, -17, 24, 2, 0x66dd77)
          .setOrigin(0, 0.5);
        const progress = this.scene.add
          .rectangle(-12, 17, 24, 2, 0xffcc55)
          .setOrigin(0, 0.5);
        object.add([image, ownerMark, health, progress]);
        this.buildings.set(id, { object, entity: building, progress, health });
        this.collision.putBuilding(building);
      }),
      $(room.state).buildings.onRemove((_building, id) => {
        this.buildings.get(id)?.object.destroy(true);
        this.buildings.delete(id);
        this.collision.remove(id);
      }),
    );
  }
  update(
    delta: number,
    localId: string,
    local: { x: number; y: number },
  ): void {
    this.cullElapsed += delta;
    const cull = this.cullElapsed >= 200;
    if (cull) this.cullElapsed = 0;
    const camera = this.scene.cameras.main;
    const rect = camera.worldView;
    const visible = (x: number, y: number) =>
      x >= rect.x - 64 &&
      x <= rect.right + 64 &&
      y >= rect.y - 64 &&
      y <= rect.bottom + 64;
    const factor = 1 - Math.exp(-Math.min(delta, 100) / 80);
    const update = (actor: Actor, id: string) => {
      const entity = actor.entity;
      const isLocal = id === localId;
      const x = isLocal
        ? local.x
        : Phaser.Math.Linear(actor.object.x, entity.x, factor);
      const y = isLocal
        ? local.y
        : Phaser.Math.Linear(actor.object.y, entity.y, factor);
      actor.object.setPosition(x, y).setVisible(visible(x, y));
      actor.object.setAlpha(
        "isDead" in entity && entity.isDead
          ? 0.25
          : "isInvulnerable" in entity && entity.isInvulnerable
            ? 0.65
            : 1,
      );
      actor.health.scaleX = Math.max(0, entity.health / entity.maxHealth);
      actor.health.setVisible(entity.health < entity.maxHealth);
    };
    for (const [id, actor] of this.players) update(actor, id);
    for (const [id, actor] of this.units) update(actor, id);
    for (const sprite of this.buildings.values()) {
      if (cull)
        sprite.object.setVisible(visible(sprite.object.x, sprite.object.y));
      sprite.progress.scaleX = sprite.entity.productionProgress / 100;
      sprite.progress.setVisible(sprite.entity.productionProgress > 0);
      sprite.health.scaleX = sprite.entity.health / sprite.entity.maxHealth;
      sprite.health.setVisible(sprite.entity.health < sprite.entity.maxHealth);
    }
    if (cull)
      for (const sprite of this.resources.values())
        sprite.setVisible(visible(sprite.x, sprite.y));
  }
  destroy(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    for (const off of this.resourceDetach.values()) off();
    this.resourceDetach.clear();
    for (const map of [this.players, this.units]) {
      for (const actor of map.values()) actor.object.destroy(true);
      map.clear();
    }
    for (const building of this.buildings.values())
      building.object.destroy(true);
    this.buildings.clear();
    for (const resource of this.resources.values()) resource.destroy();
    this.resources.clear();
  }
  private actor(
    entity: Player | Unit,
    name: string,
    color: number,
    size: number,
  ): Actor {
    const object = this.scene.add.container(entity.x, entity.y).setDepth(10);
    const body = this.scene.add
      .rectangle(0, 0, size * 2, size * 2, color)
      .setStrokeStyle(1, 0x222222);
    const label = this.scene.add
      .text(0, -14, name, {
        fontSize: "8px",
        fontFamily: "Arial",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    const health = this.scene.add
      .rectangle(-8, -9, 16, 2, 0x66dd77)
      .setOrigin(0, 0.5)
      .setVisible(false);
    object.add([body, label, health]);
    return { object, label, health, entity };
  }
  private removeActor(map: Map<string, Actor>, id: string): void {
    map.get(id)?.object.destroy(true);
    map.delete(id);
  }
  private resource(resource: Resource, id: string): void {
    let image = this.resources.get(id);
    if (resource.amount <= 0) {
      image?.destroy();
      this.resources.delete(id);
      this.collision.remove(id);
      return;
    }
    if (!image) {
      image = this.scene.add
        .image(resource.x, resource.y, RESOURCE_SPRITES[resource.type])
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(3);
      this.resources.set(id, image);
    }
    this.collision.putResource(resource);
  }
}
