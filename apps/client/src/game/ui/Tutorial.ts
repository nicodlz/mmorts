import Phaser from "phaser";
import { TILE_SIZE, distanceSquared } from "shared";
import type { BuildingType } from "shared";
import type { GameScene } from "../scenes/GameScene";
import { TutorialProgress, type TutorialView } from "./TutorialProgress";

const STORAGE_KEY = "mmorts.tutorial.v1";
const STYLE = { fontFamily: "Arial", fontSize: "13px", color: "#d8e6db" };

/** A non-modal Phaser guide; its own surface consumes clicks before the world does. */
export class Tutorial {
  private readonly panel: Phaser.GameObjects.Container;
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly progress: Phaser.GameObjects.Text;
  private readonly action: Phaser.GameObjects.Text;
  private readonly dismiss: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly markerLabel: Phaser.GameObjects.Text;
  private readonly anchor: Phaser.GameObjects.Zone;
  private goals?: TutorialProgress;
  private current?: TutorialView;
  private elapsed = 200;
  private lastText = "";
  private width = 320;
  private height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly game: GameScene,
    private readonly actions: {
      build: (type: BuildingType) => void;
      map: () => void;
      isMapOpen: () => boolean;
    },
  ) {
    this.panel = scene.add.container(0, 0).setDepth(15).setVisible(false);
    this.background = scene.add
      .rectangle(0, 0, 320, 200, 0x10251b, 0.97)
      .setOrigin(0)
      .setStrokeStyle(1, 0x65977a)
      .setInteractive();
    this.background.on(
      "pointerdown",
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation(),
    );
    this.title = scene.add.text(16, 14, "", {
      ...STYLE,
      fontSize: "15px",
      color: "#b4edc7",
      fontStyle: "bold",
    });
    this.body = scene.add.text(16, 44, "", STYLE).setLineSpacing(4);
    this.progress = scene.add.text(16, 0, "", { ...STYLE, color: "#ffdb8a" });
    this.action = this.button(() => {
      const action = this.current?.action;
      if (action?.kind === "build") actions.build(action.type);
      if (action?.kind === "select") {
        game.cancelBuild();
        game.selectedBuildingId = action.id;
      }
      if (action?.kind === "map") actions.map();
    });
    this.dismiss = this.button(() =>
      this.close(this.current?.complete ? "done" : "skipped"),
    );
    this.panel.add([
      this.background,
      this.title,
      this.body,
      this.progress,
      this.action,
      this.dismiss,
    ]);
    this.marker = scene.add.graphics().setDepth(12);
    this.anchor = new Phaser.GameObjects.Zone(game, 0, 0, 1, 1);
    this.markerLabel = scene.add
      .text(0, 0, "", {
        ...STYLE,
        fontSize: "12px",
        backgroundColor: "#10251bee",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 0)
      .setDepth(12)
      .setVisible(false);
    let seen = false;
    try {
      seen = !!localStorage.getItem(STORAGE_KEY);
    } catch {
      /* The guide also works without browser storage. */
    }
    if (!seen) this.restart();
  }

  restart(): void {
    if (!this.game.self) return;
    this.goals = new TutorialProgress(this.game.self);
    this.lastText = "";
    this.elapsed = 200;
    this.panel.setVisible(true);
    this.update(0);
  }

  mapVisibilityChanged(open: boolean): void {
    this.goals?.mapVisibilityChanged(open);
    this.elapsed = 200;
  }

  update(delta: number): void {
    this.elapsed += delta;
    const room = this.game.connection.room,
      player = this.game.self;
    if (!this.goals || !room || !player) return;
    if (this.elapsed >= 200) {
      this.elapsed = 0;
      this.current = this.goals.view(room.state, player, {
        combat: this.game.combatMode,
        building: !!this.game.buildType,
      });
      const key = JSON.stringify([
        this.current.step,
        this.current.title,
        this.current.text,
        this.current.progress,
        this.current.actionLabel,
      ]);
      if (key !== this.lastText) {
        this.lastText = key;
        this.title.setText(
          `${this.current.complete ? "Tutoriel terminé" : this.current.step ? `Débuter · ${this.current.step}/7` : "Tutoriel en pause"}\n${this.current.title}`,
        );
        this.body.setText(this.current.text);
        this.progress.setText(this.current.progress ?? "");
        this.action
          .setText(this.current.actionLabel ?? "")
          .setVisible(!!this.current.action);
        this.dismiss.setText(
          this.current.complete ? "Terminer" : "Passer le tutoriel",
        );
        if (this.current.complete) this.remember("done");
        this.resize();
      }
    }
    this.drawMarker();
  }

  resize(): void {
    this.width = Math.min(320, this.scene.scale.width - 24);
    this.title.setWordWrapWidth(this.width - 32);
    this.body
      .setWordWrapWidth(this.width - 32)
      .setY(this.title.y + this.title.height + 12);
    this.progress.setY(this.body.y + this.body.height + 12);
    this.action.setY(
      this.progress.y + (this.progress.text ? this.progress.height + 12 : 0),
    );
    this.dismiss.setY(
      this.action.y + (this.action.visible ? this.action.height + 10 : 0),
    );
    this.height = this.dismiss.y + this.dismiss.height + 14;
    this.background.setSize(this.width, this.height);
    // Top right leaves the HUD, building actions, bottom construction menu and minimap available.
    this.panel.setPosition(
      this.scene.scale.width - this.width - 12,
      this.scene.scale.width >= 1000 ? 12 : 120,
    );
  }

  destroy(): void {
    this.panel.destroy(true);
    this.marker.destroy();
    this.markerLabel.destroy();
    this.anchor.destroy();
    this.goals = undefined;
  }

  private close(status: string): void {
    this.remember(status);
    this.goals = undefined;
    this.current = undefined;
    this.panel.setVisible(false);
    this.marker.clear();
    this.markerLabel.setVisible(false);
  }

  private remember(status: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, status);
    } catch {
      /* Optional persistence. */
    }
  }

  private button(callback: () => void): Phaser.GameObjects.Text {
    const button = this.scene.add
      .text(16, 0, "", {
        ...STYLE,
        backgroundColor: "#315e43",
        padding: { x: 10, y: 7 },
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
    return button;
  }

  private drawMarker(): void {
    this.marker.clear();
    this.markerLabel.setVisible(false);
    const target = this.current?.target;
    if (!target || this.game.self?.isDead || this.actions.isMapOpen()) return;
    const camera = this.game.cameras.main;
    this.anchor.setPosition(target.x, target.y);
    const point = Phaser.GameObjects.GetCalcMatrix(
      this.anchor,
      camera,
    ).calc.transformPoint(0, 0);
    const width = this.scene.scale.width,
      height = this.scene.scale.height;
    let x = Phaser.Math.Clamp(point.x, 40, width - 40),
      y = Phaser.Math.Clamp(point.y, 155, height - 70);
    const panelBounds = this.background.getBounds();
    if (panelBounds.contains(x, y)) {
      // On smaller viewports the resource can be behind the guide itself.
      if (panelBounds.bottom + 90 < height) y = panelBounds.bottom + 40;
      else x = Math.max(40, panelBounds.left - 40);
    }
    const outside = x !== point.x || y !== point.y;
    this.marker.lineStyle(2, 0xffdb8a, 1);
    if (outside) {
      const angle = Math.atan2(point.y - y, point.x - x);
      const a = new Phaser.Math.Vector2(14, 0).rotate(angle).add({ x, y });
      const b = new Phaser.Math.Vector2(-8, -8).rotate(angle).add({ x, y });
      const c = new Phaser.Math.Vector2(-8, 8).rotate(angle).add({ x, y });
      this.marker.strokeTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    } else this.marker.strokeCircle(x, y, 30);
    const distance = Math.ceil(
      Math.sqrt(distanceSquared(this.game.localPosition, target)) / TILE_SIZE,
    );
    this.markerLabel
      .setText(`${target.label} · ${distance} case${distance === 1 ? "" : "s"}`)
      .setPosition(x, y + 33)
      .setVisible(true);
    const bounds = this.markerLabel.getBounds();
    this.markerLabel.x +=
      Math.max(0, 12 - bounds.left) - Math.max(0, bounds.right - width + 12);
  }
}
