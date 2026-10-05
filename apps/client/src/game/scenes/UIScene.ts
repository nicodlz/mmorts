import Phaser from "phaser";
import {
  BUILDING_COSTS,
  BuildingType,
  PRODUCTION_RATES,
  ResourceType,
  UnitType,
  UNIT_COSTS,
} from "shared";
import { BUILDINGS, RESOURCE_LABELS } from "../rendering/presentation";
import { Minimap } from "../ui/Minimap";
import { Tutorial } from "../ui/Tutorial";
import type { GameScene } from "./GameScene";

const STYLE = {
  fontSize: "14px",
  fontFamily: "Arial",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 2,
};

export class UIScene extends Phaser.Scene {
  private gameScene?: GameScene;
  private resources?: Phaser.GameObjects.Text;
  private status?: Phaser.GameObjects.Text;
  private help?: Phaser.GameObjects.Text;
  private notice?: Phaser.GameObjects.Text;
  private noticeUntil = 0;
  private buildMenu?: Phaser.GameObjects.Container;
  private buildingPanel?: Phaser.GameObjects.Container;
  private panelKey = "";
  private readonly buildButtons: Phaser.GameObjects.Text[] = [];
  private menuVisible = false;
  private selectedIndex = 0;
  private minimap?: Minimap;
  private tutorial?: Tutorial;
  private death?: Phaser.GameObjects.Text;
  private lastText = "";
  private onResize = () => this.layout();
  private onNotice = (text: string) => {
    this.notice?.setText(text);
    this.noticeUntil = this.time.now + 3000;
  };
  private onWheel = (
    _pointer: Phaser.Input.Pointer,
    _objects: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ) => {
    if (!this.menuVisible || !dy) return;
    this.selectedIndex =
      (this.selectedIndex + Math.sign(dy) + BUILDINGS.length) %
      BUILDINGS.length;
    this.gameScene?.selectBuild(BUILDINGS[this.selectedIndex]!.type);
    this.highlight();
  };
  constructor() {
    super({ key: "UIScene" });
  }
  create(data: { gameScene: GameScene }): void {
    this.gameScene = data.gameScene;
    this.panelKey = "";
    this.lastText = "";
    this.menuVisible = false;
    this.resources = this.add.text(12, 12, "", STYLE);
    this.status = this.add.text(12, 38, "", STYLE);
    this.help = this.add.text(
      12,
      64,
      "WASD / ZQSD : déplacer · Clic : récolter · Tab : combat",
      { ...STYLE, fontSize: "12px", color: "#b6c5b5" },
    );
    this.notice = this.add
      .text(this.scale.width / 2, 95, "", STYLE)
      .setOrigin(0.5);
    this.death = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "", {
        ...STYLE,
        fontSize: "28px",
        backgroundColor: "#111111dd",
        padding: { x: 24, y: 20 },
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.button("B · Construire", 12, 90, () => this.toggleBuildMenu());
    this.button("M · Carte", 140, 90, () => this.toggleMap());
    this.button("Menu", 240, 90, () => this.gameScene?.returnToMenu());
    this.button("Tuto", 305, 90, () => this.tutorial?.restart());
    this.createBuildMenu();
    this.minimap = new Minimap(
      this,
      data.gameScene.mapLines,
      () => this.gameScene?.connection.room?.state,
      () => this.gameScene?.localPosition ?? { x: 0, y: 0 },
    );
    this.minimap.full.on(
      "pointerdown",
      (
        pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        const point = this.minimap?.worldPoint(pointer.x, pointer.y);
        if (point) this.gameScene?.moveUnits(point);
      },
    );
    this.tutorial = new Tutorial(this, data.gameScene, {
      build: (type) => this.openBuildMenu(type),
      map: () => this.toggleMap(),
      isMapOpen: () => !!this.minimap?.full.visible,
    });
    this.gameScene.events.on("notice", this.onNotice);
    this.scale.on("resize", this.onResize);
    this.input.on("wheel", this.onWheel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.layout();
  }
  update(_time: number, delta: number): void {
    const game = this.gameScene,
      player = game?.self;
    if (!game || !player) return;
    const text = Object.values(ResourceType)
      .map(
        (type) =>
          `${RESOURCE_LABELS[type]} : ${player.resources.get(type) ?? 0}`,
      )
      .join("   ");
    if (text !== this.lastText) {
      this.resources?.setText(text);
      this.lastText = text;
    }
    this.status?.setText(
      `PV ${player.health}/${player.maxHealth} · Population ${player.population}/${player.maxPopulation} · ${game.combatMode ? "Combat" : "Récolte"} · ${Math.round(this.game.loop.actualFps)} FPS · ${game.ping} ms`,
    );
    if (this.time.now > this.noticeUntil) this.notice?.setText("");
    this.death?.setVisible(player.isDead);
    if (player.isDead)
      this.death?.setText(
        `Vous êtes mort\nRéapparition dans ${Math.max(0, Math.ceil((player.respawnTime - Date.now()) / 1000))} s`,
      );
    this.minimap?.update(delta);
    this.tutorial?.update(delta);
    const building = game.connection.room?.state.buildings.get(
      game.selectedBuildingId ?? "",
    );
    const key =
      building && !player.isDead
        ? `${building.id}:${building.productionActive}`
        : "";
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.createBuildingPanel();
    }
  }
  toggleBuildMenu(): void {
    this.menuVisible = !this.menuVisible;
    this.buildMenu?.setVisible(this.menuVisible);
    if (!this.menuVisible) this.gameScene?.cancelBuild();
  }
  toggleMap(): void {
    this.minimap?.toggle();
    this.tutorial?.mapVisibilityChanged(!!this.minimap?.full.visible);
  }
  private openBuildMenu(type: BuildingType): void {
    this.menuVisible = true;
    this.buildMenu?.setVisible(true);
    this.selectedIndex = BUILDINGS.findIndex(
      (building) => building.type === type,
    );
    this.gameScene?.selectBuild(type);
    this.highlight();
  }
  cancel(): void {
    this.minimap?.close();
    this.tutorial?.mapVisibilityChanged(false);
    this.menuVisible = false;
    this.buildMenu?.setVisible(false);
  }
  private button(
    text: string,
    x: number,
    y: number,
    callback: () => void,
    parent?: Phaser.GameObjects.Container,
  ): Phaser.GameObjects.Text {
    const button = this.add
      .text(x, y, text, {
        ...STYLE,
        fontSize: "12px",
        backgroundColor: "#273c29",
        padding: { x: 8, y: 6 },
      })
      .setInteractive({ useHandCursor: true });
    button.on(
      "pointerdown",
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        callback();
      },
    );
    parent?.add(button);
    return button;
  }
  private createBuildMenu(): void {
    this.buildMenu = this.add.container(0, 0).setDepth(5).setVisible(false);
    this.buildButtons.length = 0;
    for (const [index, building] of BUILDINGS.entries()) {
      const cost = Object.entries(BUILDING_COSTS[building.type])
        .map(
          ([type, amount]) =>
            `${RESOURCE_LABELS[type as ResourceType]} ${amount}`,
        )
        .join(" / ");
      const label = this.button(
        `${building.name}\n${cost}`,
        0,
        0,
        () => {
          this.selectedIndex = index;
          this.gameScene?.selectBuild(building.type);
          this.highlight();
        },
        this.buildMenu,
      );
      label.setStyle({ fontSize: "11px", fixedWidth: 130, fixedHeight: 50 });
      this.buildButtons.push(label);
    }
    this.highlight();
  }
  private highlight(): void {
    this.buildButtons.forEach((button, i) =>
      button.setBackgroundColor(
        i === this.selectedIndex ? "#416347" : "#273c29",
      ),
    );
  }
  private createBuildingPanel(): void {
    this.buildingPanel?.destroy(true);
    this.buildingPanel = undefined;
    const game = this.gameScene;
    const building = game?.connection.room?.state.buildings.get(
      game.selectedBuildingId ?? "",
    );
    if (
      !game ||
      !building ||
      building.owner !== game.connection.room?.sessionId ||
      game.self?.isDead
    )
      return;
    const panel = this.add.container(12, 150).setDepth(5);
    this.buildingPanel = panel;
    panel.add(
      this.add.text(
        0,
        0,
        BUILDINGS.find((item) => item.type === building.type)?.name ??
          building.type,
        STYLE,
      ),
    );
    let row = 26;
    const action = (label: string, callback: () => void) => {
      this.button(label, 0, row, callback, panel);
      row += 32;
    };
    if (building.type === BuildingType.BARRACKS)
      action(
        `Soldat · Or ${UNIT_COSTS.WARRIOR.gold} / Fer ${UNIT_COSTS.WARRIOR.iron}`,
        () =>
          game.connection.send("spawnUnit", {
            buildingId: building.id,
            unitType: UnitType.WARRIOR,
          }),
      );
    if (building.type === BuildingType.TOWN_CENTER)
      action(`Villageois · Or ${UNIT_COSTS.VILLAGER.gold}`, () =>
        game.connection.send("spawnVillager", { buildingId: building.id }),
      );
    if (PRODUCTION_RATES[building.type])
      action(
        building.productionActive
          ? "Suspendre la production"
          : "Reprendre la production",
        () =>
          game.connection.send("toggleProduction", {
            buildingId: building.id,
            active: !building.productionActive,
          }),
      );
    action("Recycler · remboursement 75 %", () => {
      game.connection.send("destroyBuilding", { buildingId: building.id });
      game.selectedBuildingId = undefined;
    });
  }
  private layout(): void {
    const columns = Math.max(
      1,
      Math.min(10, Math.floor((this.scale.width - 24) / 138)),
    );
    const rows = Math.ceil(BUILDINGS.length / columns);
    this.buildMenu?.setPosition(12, this.scale.height - rows * 58 - 12);
    this.buildButtons.forEach((button, index) =>
      button.setPosition(
        (index % columns) * 138,
        Math.floor(index / columns) * 58,
      ),
    );
    this.resources?.setWordWrapWidth(this.scale.width - 24);
    this.notice?.setPosition(this.scale.width / 2, 125);
    this.death?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.minimap?.resize();
    this.tutorial?.resize();
  }
  private shutdown(): void {
    this.scale.off("resize", this.onResize);
    this.input.off("wheel", this.onWheel);
    this.gameScene?.events.off("notice", this.onNotice);
    this.minimap?.destroy();
    this.minimap = undefined;
    this.tutorial?.destroy();
    this.tutorial = undefined;
    this.buildButtons.length = 0;
    this.gameScene = undefined;
    this.buildingPanel = undefined;
    this.buildMenu = undefined;
  }
}
