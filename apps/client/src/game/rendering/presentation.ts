import Phaser from "phaser";
import { BuildingType, ResourceType } from "shared";

export const BUILDINGS = [
  { type: BuildingType.HOUSE, name: "Maison" },
  { type: BuildingType.FORGE, name: "Forge" },
  { type: BuildingType.BARRACKS, name: "Caserne" },
  { type: BuildingType.FURNACE, name: "Fourneau" },
  { type: BuildingType.FACTORY, name: "Usine" },
  { type: BuildingType.PLAYER_WALL, name: "Mur" },
  { type: BuildingType.TOWER, name: "Tour" },
  { type: BuildingType.TOWN_CENTER, name: "Centre-ville" },
  { type: BuildingType.YARD, name: "Carrière" },
  { type: BuildingType.CABIN, name: "Cabane" },
];
export const RESOURCE_SPRITES: Record<ResourceType, string> = {
  [ResourceType.GOLD]: "gold",
  [ResourceType.WOOD]: "tree",
  [ResourceType.STONE]: "stone",
  [ResourceType.IRON]: "stone",
  [ResourceType.COAL]: "stone",
  [ResourceType.STEEL]: "stone",
};
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  gold: "Or",
  wood: "Bois",
  stone: "Pierre",
  iron: "Fer",
  coal: "Charbon",
  steel: "Acier",
};
export const hueColor = (hue: number): number =>
  Phaser.Display.Color.HSVToRGB((((hue % 360) + 360) % 360) / 360, 0.85, 1)
    .color;
export function preloadAssets(scene: Phaser.Scene): void {
  for (const key of [
    "grass",
    "grass2",
    "grass3",
    "wall",
    "tree",
    "tree2",
    "stone",
    "gold",
    "pickaxe",
    ...Object.values(BuildingType),
  ]) {
    if (!scene.textures.exists(key))
      scene.load.image(key, `/sprites/${key}.png`);
  }
}
