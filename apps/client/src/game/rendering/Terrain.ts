import Phaser from "phaser";
import { TILE_SIZE } from "shared";

/** Phaser's TilemapLayer culls terrain to the camera; no sprite-per-tile chunk pool. */
export class Terrain {
  private readonly map: Phaser.Tilemaps.Tilemap;
  readonly layer: Phaser.Tilemaps.TilemapLayer;
  constructor(scene: Phaser.Scene, lines: readonly string[]) {
    const key = "terrain-atlas";
    if (!scene.textures.exists(key)) {
      const atlas = scene.textures.createCanvas(key, TILE_SIZE * 4, TILE_SIZE);
      if (!atlas) throw new Error("Could not create terrain atlas.");
      ["grass", "grass2", "grass3", "wall"].forEach((texture, index) => {
        const image = scene.textures
          .get(texture)
          .getSourceImage() as CanvasImageSource;
        atlas.context.drawImage(
          image,
          index * TILE_SIZE,
          0,
          TILE_SIZE,
          TILE_SIZE,
        );
      });
      atlas.refresh();
      atlas.setFilter(Phaser.Textures.NEAREST);
    }
    const data = lines.map((line, y) =>
      [...line].map((char, x) => {
        if (char === "#") return 3;
        const variation = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        return variation % 12 > 9 ? 1 + (variation % 2) : 0;
      }),
    );
    this.map = scene.make.tilemap({
      data,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = this.map.addTilesetImage(key, key, TILE_SIZE, TILE_SIZE);
    if (!tileset) throw new Error("Could not create terrain tileset.");
    const layer = this.map.createLayer(0, tileset, 0, 0);
    if (!layer) throw new Error("Could not create terrain layer.");
    this.layer = layer.setDepth(0).setCullPadding(2, 2);
    scene.cameras.main.setBounds(
      0,
      0,
      (lines[0]?.length ?? 0) * TILE_SIZE,
      lines.length * TILE_SIZE,
    );
  }
  destroy(): void {
    this.map.destroy();
  }
}
