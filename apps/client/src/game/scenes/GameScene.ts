import Phaser from "phaser";
import {
  BUILDING_COSTS,
  BuildingType,
  MINING_CONFIG,
  PLAYER_SPEED,
  TILE_SIZE,
  touchesWall,
  distanceSquared,
} from "shared";
import type { Player, Vector2, WorldState } from "shared";
import { GameConnection } from "../network/GameConnection";
import { InputController } from "../InputController";
import { Collision } from "../rendering/Collision";
import { Entities } from "../rendering/Entities";
import { Effects } from "../rendering/Effects";
import { Terrain } from "../rendering/Terrain";
import { preloadAssets } from "../rendering/presentation";
import type { UIScene } from "./UIScene";

export class GameScene extends Phaser.Scene {
  connection = new GameConnection();
  self?: Player;
  localPosition: Vector2 = { x: 0, y: 0 };
  mapLines: string[] = [];
  combatMode = false;
  selectedBuildingId?: string;
  ping = 0;
  private selectedType?: BuildingType;
  private terrain?: Terrain;
  private collision?: Collision;
  private entities?: Entities;
  private effects?: Effects;
  private controls?: InputController;
  private preview?: Phaser.GameObjects.Image;
  private toolPivot?: Phaser.GameObjects.Container;
  private tool?: Phaser.GameObjects.Image;
  private swing?: Phaser.Tweens.Tween;
  private cursor?: Phaser.GameObjects.Graphics;
  private ready = false;
  private alive = false;
  private playerName = "Player";
  private playerHue = 180;
  private lastSend = 0;
  private lastCursor = 0;
  private lastHarvest = 0;
  private lastPing = 0;
  private lastSent: Vector2 = { x: 0, y: 0 };
  private connectionText?: Phaser.GameObjects.Text;
  constructor() {
    super({ key: "GameScene" });
  }
  init(data: { playerName?: string; playerHue?: number }): void {
    this.connection = new GameConnection();
    this.self = undefined;
    this.ready = false;
    this.alive = true;
    this.combatMode = false;
    this.selectedType = undefined;
    this.selectedBuildingId = undefined;
    this.playerName =
      data.playerName || localStorage.getItem("playerName") || "Player";
    this.playerHue =
      data.playerHue ?? Number(localStorage.getItem("playerHue") || 180);
    this.lastSend = this.lastCursor = this.lastHarvest = this.lastPing = 0;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }
  preload(): void {
    preloadAssets(this);
  }
  async create(): Promise<void> {
    this.connectionText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Connexion…", {
        fontSize: "24px",
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
    try {
      await this.connection.connect(this.playerName, this.playerHue, {
        worldInfo: (info) => {
          if (!this.alive) return;
          this.mapLines = info.map;
          this.terrain = new Terrain(this, this.mapLines);
          this.collision = new Collision(this.mapLines);
        },
        state: (state) => this.onState(state),
        event: (event) => this.effects?.show(event),
        rejected: (reason) => this.events.emit("notice", reason),
        correction: (point) => {
          this.localPosition = { x: point.x, y: point.y };
          this.lastSent = { ...point };
        },
        left: () => {
          this.ready = false;
          this.showConnectionError("Connexion interrompue.");
        },
      });
      if (!this.alive || !this.collision || !this.connection.room) return;
      this.connectionText?.destroy();
      this.connectionText = undefined;
      this.entities = new Entities(this, this.collision, (id) => {
        this.selectedBuildingId = id;
        this.cancelBuild();
      });
      this.entities.bind(this.connection.room);
      this.effects = new Effects(this);
      this.tool = this.add
        .image(10, 0, "pickaxe")
        .setDisplaySize(24, 24)
        .setOrigin(0, 0.5);
      this.toolPivot = this.add
        .container(this.localPosition.x, this.localPosition.y, [this.tool])
        .setDepth(15);
      this.preview = this.add
        .image(0, 0, BuildingType.HOUSE)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setAlpha(0.5)
        .setDepth(20)
        .setVisible(false);
      this.cursor = this.add.graphics().setDepth(20);
      this.controls = new InputController(this, {
        click: (point, button) => {
          if (button === 2) {
            this.cancelBuild();
            return;
          }
          if (this.self?.isDead) return;
          this.selectedBuildingId = undefined;
          if (this.selectedType && this.canBuild(point)) {
            this.connection.send("build", {
              type: this.selectedType,
              x: point.x,
              y: point.y,
            });
          }
        },
        mode: () => this.toggleMode(),
        buildMenu: () => this.ui()?.toggleBuildMenu(),
        fullMap: () => this.ui()?.toggleMap(),
        escape: () => {
          this.cancelBuild();
          this.selectedBuildingId = undefined;
          this.ui()?.cancel();
        },
        moveUnits: (point) => this.moveUnits(point),
        isCombatMode: () => this.combatMode,
      });
      const playerObject = this.entities.players.get(
        this.connection.room.sessionId,
      )?.object;
      if (playerObject) this.cameras.main.startFollow(playerObject, true, 1, 1);
      this.cameras.main.setZoom(2).setRoundPixels(true);
      this.ready = true;
      this.scene.launch("UIScene", { gameScene: this });
    } catch (error) {
      if (this.alive) {
        this.connection.dispose();
        this.showConnectionError(
          error instanceof Error
            ? error.message
            : "Impossible de se connecter.",
        );
      }
    }
  }
  update(time: number, delta: number): void {
    if (
      !this.ready ||
      !this.self ||
      !this.controls ||
      !this.collision ||
      !this.connection.room
    )
      return;
    const frame = Math.min(delta, 100);
    if (!this.self.isDead) {
      const direction = this.controls.direction();
      const steps = Math.max(1, Math.ceil((PLAYER_SPEED * frame) / 1000 / 4));
      for (let i = 0; i < steps; i++) {
        const x =
          this.localPosition.x +
          (direction.x * PLAYER_SPEED * frame) / 1000 / steps;
        const y =
          this.localPosition.y +
          (direction.y * PLAYER_SPEED * frame) / 1000 / steps;
        if (this.collision.isFree({ x, y })) this.localPosition = { x, y };
        else if (this.collision.isFree({ x, y: this.localPosition.y }))
          this.localPosition.x = x;
        else if (this.collision.isFree({ x: this.localPosition.x, y }))
          this.localPosition.y = y;
      }
      this.controls.update();
    }
    this.entities?.update(
      frame,
      this.connection.room.sessionId,
      this.localPosition,
    );
    const pointer = this.input.activePointer;
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Math.atan2(
      point.y - this.localPosition.y,
      point.x - this.localPosition.x,
    );
    this.toolPivot
      ?.setPosition(this.localPosition.x, this.localPosition.y)
      .setRotation(angle)
      .setVisible(!this.combatMode && !this.self.isDead);
    if (this.combatMode && !this.self.isDead && time - this.lastCursor >= 200) {
      this.connection.send("targetCursorPosition", {
        ...point,
        isTargetMode: true,
      });
      this.lastCursor = time;
    }
    this.cursor?.clear();
    if (this.combatMode)
      this.cursor
        ?.lineStyle(1, 0xffffff, 0.6)
        .strokeCircle(point.x, point.y, 8);
    if (
      !this.self.isDead &&
      time - this.lastSend >= 100 &&
      distanceSquared(this.localPosition, this.lastSent) > 0.01
    ) {
      this.connection.send("move", { ...this.localPosition });
      this.lastSent = { ...this.localPosition };
      this.lastSend = time;
    }
    if (time - this.lastPing >= 2000) {
      this.connection.ping((ms) => {
        this.ping = Math.round(ms);
      });
      this.lastPing = time;
    }
    this.updatePreview(point);
    const mining =
      !this.self.isDead &&
      !this.combatMode &&
      !this.selectedType &&
      this.controls.mining;
    if (mining && time - this.lastHarvest >= MINING_CONFIG.COOLDOWN) {
      const resource = this.collision.resourceNear(this.localPosition, 50);
      if (resource) {
        this.connection.send("harvest", { resourceId: resource.id });
        this.lastHarvest = time;
      }
    }
    if (mining && !this.swing && this.tool) {
      this.swing = this.tweens.add({
        targets: this.tool,
        rotation: -0.7,
        duration: 200,
        yoyo: true,
        repeat: -1,
      });
    } else if (!mining && this.swing) {
      this.swing.stop();
      this.swing = undefined;
      this.tool?.setRotation(0);
    }
  }
  selectBuild(type: BuildingType): void {
    this.selectedType = type;
    this.selectedBuildingId = undefined;
    this.preview?.setTexture(type).setVisible(true);
  }
  get buildType(): BuildingType | undefined {
    return this.selectedType;
  }
  cancelBuild(): void {
    this.selectedType = undefined;
    this.preview?.setVisible(false);
  }
  moveUnits(point: Vector2): void {
    if (!this.ready || this.self?.isDead) return;
    if (!this.combatMode) this.toggleMode();
    this.connection.send("unitMoveTarget", { ...point, isMoving: true });
  }
  returnToMenu(): void {
    this.scene.start("MenuScene");
  }
  private toggleMode(): void {
    if (this.self?.isDead) return;
    this.combatMode = !this.combatMode;
    this.cancelBuild();
    const pointer = this.input.activePointer,
      point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.connection.send("targetCursorPosition", {
      ...point,
      isTargetMode: this.combatMode,
    });
  }
  private onState(state: WorldState): void {
    const player = state.players.get(this.connection.room?.sessionId ?? "");
    if (!player) return;
    const reset = !this.self || this.lastDead !== player.isDead;
    this.self = player;
    if (reset) {
      this.localPosition = { x: player.x, y: player.y };
      this.lastSent = { ...this.localPosition };
    }
    this.lastDead = player.isDead;
    if (player.isDead) {
      this.combatMode = false;
      this.cancelBuild();
    }
  }
  private lastDead = false;
  private canBuild(point: Vector2): boolean {
    if (!this.selectedType || !this.self || this.self.isDead || !this.collision)
      return false;
    const x = Math.floor(point.x / TILE_SIZE) * TILE_SIZE,
      y = Math.floor(point.y / TILE_SIZE) * TILE_SIZE;
    if (
      touchesWall(this.mapLines, x + TILE_SIZE / 2, y + TILE_SIZE / 2, 0) ||
      this.collision.isTileOccupied(x, y)
    )
      return false;
    const range = Math.max(
      Math.abs(Math.floor(this.localPosition.x / TILE_SIZE) - x / TILE_SIZE),
      Math.abs(Math.floor(this.localPosition.y / TILE_SIZE) - y / TILE_SIZE),
    );
    if (range > 2) return false;
    for (const [type, amount] of Object.entries(
      BUILDING_COSTS[this.selectedType],
    ))
      if ((this.self.resources.get(type) ?? 0) < amount) return false;
    const state = this.connection.room?.state;
    if (state)
      for (const entity of [
        ...state.players.values(),
        ...state.units.values(),
      ]) {
        const position =
          entity.id === this.self.id ? this.localPosition : entity;
        if (
          position.x > x - 6 &&
          position.x < x + TILE_SIZE + 6 &&
          position.y > y - 6 &&
          position.y < y + TILE_SIZE + 6
        )
          return false;
      }
    return true;
  }
  private updatePreview(point: Vector2): void {
    if (!this.selectedType || !this.preview) return;
    const x = Math.floor(point.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2,
      y = Math.floor(point.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
    this.preview
      .setPosition(x, y)
      .setTint(this.canBuild(point) ? 0x88ff88 : 0xff8888);
  }
  private ui(): UIScene | undefined {
    return this.scene.isActive("UIScene")
      ? (this.scene.get("UIScene") as UIScene)
      : undefined;
  }
  private showConnectionError(message: string): void {
    this.connectionText?.destroy();
    this.connectionText = this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        `${message}\n\nCliquer pour réessayer · Échap : menu`,
        {
          fontSize: "18px",
          color: "#ffffff",
          backgroundColor: "#111111",
          padding: { x: 20, y: 20 },
          align: "center",
        },
      )
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(0)
      .setInteractive();
    this.connectionText.once("pointerdown", () =>
      this.scene.restart({
        playerName: this.playerName,
        playerHue: this.playerHue,
      }),
    );
    this.input.keyboard?.once("keydown-ESC", () => this.returnToMenu());
  }
  private shutdown(): void {
    this.alive = false;
    this.ready = false;
    this.scene.stop("UIScene");
    this.connection.dispose();
    this.controls?.destroy();
    this.controls = undefined;
    this.entities?.destroy();
    this.entities = undefined;
    this.effects?.destroy();
    this.effects = undefined;
    this.collision?.destroy();
    this.collision = undefined;
    this.terrain?.destroy();
    this.terrain = undefined;
    this.swing?.stop();
    this.swing = undefined;
    this.preview = undefined;
    this.tool = undefined;
    this.toolPivot = undefined;
    this.cursor = undefined;
    this.self = undefined;
    this.lastDead = false;
  }
}
