import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resource, ResourceType, RESOURCE_AMOUNTS, TILE_SIZE } from "shared";

export interface WorldData {
  mapLines: string[];
  resources: Resource[];
}
const characters: Record<string, ResourceType> = {
  G: ResourceType.GOLD,
  W: ResourceType.WOOD,
  T: ResourceType.WOOD,
  S: ResourceType.STONE,
  I: ResourceType.IRON,
  C: ResourceType.COAL,
};

export function parseMap(content: string): WorldData {
  const mapLines = content.replace(/\r/g, "").trimEnd().split("\n");
  const width = mapLines[0]?.length ?? 0;
  if (!width || mapLines.some((line) => line.length !== width))
    throw new Error("The map must be a nonempty rectangle.");
  const resources: Resource[] = [];
  for (let y = 0; y < mapLines.length; y++) {
    for (let x = 0; x < width; x++) {
      const type = characters[mapLines[y][x]];
      if (!type) continue;
      const amount = RESOURCE_AMOUNTS[type];
      // Iron and coal are manufactured; unsupported markers do not create invalid amounts.
      if (amount === undefined) continue;
      const resource = new Resource();
      Object.assign(resource, {
        id: `${type}_${x}_${y}`,
        type,
        x: x * TILE_SIZE + TILE_SIZE / 2,
        y: y * TILE_SIZE + TILE_SIZE / 2,
        amount,
        maxAmount: amount,
      });
      resources.push(resource);
    }
  }
  return { mapLines, resources };
}
export function loadMap(
  mapPath = process.env.MAP_PATH || join(__dirname, "..", "default.map"),
): WorldData {
  return parseMap(readFileSync(mapPath, "utf8"));
}
