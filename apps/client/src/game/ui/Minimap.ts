import Phaser from "phaser";
import { TILE_SIZE } from "shared";
import type { WorldState, Vector2 } from "shared";

const COLORS: Record<string, string> = {
  "#": "#626b73",
  G: "#d9b44a",
  W: "#397837",
  T: "#397837",
  S: "#a7adb5",
};

/** A cached canvas stores explored terrain; only newly seen or changed tiles are redrawn. */
export class Minimap {
  readonly mini: Phaser.GameObjects.Image;
  readonly full: Phaser.GameObjects.Image;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly fullDots: Phaser.GameObjects.Graphics;
  private readonly colors: (string | undefined)[];
  private readonly width: number;
  private readonly height: number;
  private fullVisible = false;
  private elapsed = 1000;
  private readonly key: string;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lines: readonly string[],
    private readonly getState: () => WorldState | undefined,
    private readonly getPlayer: () => Vector2,
  ) {
    this.width = lines[0]?.length ?? 0;
    this.height = lines.length;
    this.key = `minimap-${Phaser.Utils.String.UUID()}`;
    const texture = scene.textures.createCanvas(
      this.key,
      this.width,
      this.height,
    );
    if (!texture) throw new Error("Could not create minimap texture.");
    this.texture = texture;
    texture.setFilter(Phaser.Textures.NEAREST);
    texture.context.fillStyle = "#090d0b";
    texture.context.fillRect(0, 0, this.width, this.height);
    texture.refresh();
    this.colors = new Array(this.width * this.height);
    this.mini = scene.add.image(0, 0, this.key).setOrigin(1).setDepth(1);
    this.full = scene.add
      .image(0, 0, this.key)
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false)
      .setInteractive();
    this.dots = scene.add.graphics().setDepth(2);
    this.fullDots = scene.add.graphics().setDepth(11).setVisible(false);
    this.resize();
  }
  toggle(): void {
    this.fullVisible = !this.fullVisible;
    this.full.setVisible(this.fullVisible);
    this.fullDots.setVisible(this.fullVisible);
  }
  close(): void {
    this.fullVisible = false;
    this.full.setVisible(false);
    this.fullDots.setVisible(false);
  }
  contains(x: number, y: number): boolean {
    return this.fullVisible && this.full.getBounds().contains(x, y);
  }
  worldPoint(x: number, y: number): Vector2 {
    const rect = this.full.getBounds();
    return {
      x: ((x - rect.x) / rect.width) * this.width * TILE_SIZE,
      y: ((y - rect.y) / rect.height) * this.height * TILE_SIZE,
    };
  }
  resize(): void {
    const width = this.scene.scale.width,
      height = this.scene.scale.height;
    const miniSize = Math.min(200, Math.max(110, width / 5));
    this.mini
      .setPosition(width - 12, height - 12)
      .setDisplaySize(miniSize, (miniSize * this.height) / this.width);
    const size = Math.min(width - 60, height - 150);
    this.full
      .setPosition(width / 2, height / 2)
      .setDisplaySize(size, (size * this.height) / this.width);
  }
  update(delta: number): void {
    this.elapsed += delta;
    if (this.elapsed < 250) return;
    this.elapsed = 0;
    const player = this.getPlayer(),
      state = this.getState();
    const cx = Math.floor(player.x / TILE_SIZE),
      cy = Math.floor(player.y / TILE_SIZE),
      radius = 30;
    let changed = false;
    for (
      let y = Math.max(0, cy - radius);
      y <= Math.min(this.height - 1, cy + radius);
      y++
    ) {
      for (
        let x = Math.max(0, cx - radius);
        x <= Math.min(this.width - 1, cx + radius);
        x++
      ) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const index = y * this.width + x,
          char = this.lines[y]?.[x] ?? ".";
        const resourceType =
          char === "G"
            ? "gold"
            : char === "W" || char === "T"
              ? "wood"
              : char === "S"
                ? "stone"
                : undefined;
        const resourceExists =
          resourceType &&
          (state?.resources.get(`${resourceType}_${x}_${y}`)?.amount ?? 0) > 0;
        const color =
          char === "#" || resourceExists
            ? (COLORS[char] ?? "#233d26")
            : "#233d26";
        if (this.colors[index] !== color) {
          this.colors[index] = color;
          this.texture.context.fillStyle = color;
          this.texture.context.fillRect(x, y, 1, 1);
          changed = true;
        }
      }
    }
    if (changed) this.texture.refresh();
    this.dots.clear();
    this.fullDots.clear();
    const draw = (point: Vector2, color: number, size = 2) => {
      for (const [image, graphics] of [
        [this.mini, this.dots],
        [this.full, this.fullDots],
      ] as const) {
        if (!image.visible) continue;
        const rect = image.getBounds();
        const x = rect.x + (point.x / (this.width * TILE_SIZE)) * rect.width;
        const y = rect.y + (point.y / (this.height * TILE_SIZE)) * rect.height;
        graphics.fillStyle(color).fillCircle(x, y, size);
      }
    };
    if (state) {
      for (const unit of state.units.values()) draw(unit, 0xbac5d1, 1);
      for (const building of state.buildings.values())
        draw(building, 0x62a9de, 1.5);
      for (const other of state.players.values())
        if (!other.isDead) draw(other, 0xf59870);
    }
    draw(player, 0xffffff, 3);
  }
  destroy(): void {
    this.mini.destroy();
    this.full.destroy();
    this.dots.destroy();
    this.fullDots.destroy();
    this.scene.textures.remove(this.key);
  }
}
