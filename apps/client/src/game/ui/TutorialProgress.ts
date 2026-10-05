import {
  BUILDING_COSTS,
  BuildingType,
  ResourceType,
  TILE_SIZE,
  UNIT_COSTS,
  UnitType,
  distanceSquared,
} from "shared";
import type { Player, ResourceAmounts, Vector2, WorldState } from "shared";
import { RESOURCE_LABELS } from "../rendering/labels";

export type TutorialAction =
  | { kind: "build"; type: BuildingType }
  | { kind: "select"; id: string }
  | { kind: "map" };

export interface TutorialView {
  step: number;
  title: string;
  text: string;
  progress?: string;
  target?: Vector2 & { label: string };
  action?: TutorialAction;
  actionLabel?: string;
  complete?: boolean;
}

/** Goals read the authoritative schema. Rejected clicks never complete a goal. */
export class TutorialProgress {
  private moved = false;
  private mapOpened = false;
  private mapClosed = false;
  private wasDead = false;
  private complete = false;
  private readonly start: Vector2;

  constructor(player: Vector2) {
    this.start = { x: player.x, y: player.y };
  }

  mapVisibilityChanged(open: boolean): void {
    if (open) this.mapOpened = true;
    else if (this.mapOpened) this.mapClosed = true;
  }

  view(
    state: WorldState,
    player: Player,
    mode: { combat: boolean; building: boolean },
  ): TutorialView {
    if (this.complete) return this.finished();
    if (player.isDead) {
      this.wasDead = true;
      return {
        step: 0,
        title: "On reprend après la réapparition",
        text: "Vos objectifs vous attendent. À votre retour, nous vérifierons les ressources et les bâtiments encore disponibles.",
      };
    }
    if (this.wasDead) {
      this.start.x = player.x;
      this.start.y = player.y;
      this.wasDead = false;
    }
    if (distanceSquared(player, this.start) >= TILE_SIZE ** 2)
      this.moved = true;
    if (!this.moved)
      return {
        step: 1,
        title: "Prenez vos repères",
        text: "Déplacez votre personnage avec les flèches ou WASD / ZQSD. La caméra vous suit. Parcourez au moins une case pour commencer.",
      };

    let house, center;
    for (const building of state.buildings.values()) {
      if (building.owner !== player.id) continue;
      if (building.type === BuildingType.HOUSE) house = building;
      if (building.type === BuildingType.TOWN_CENTER) center = building;
    }
    const villager = [...state.units.values()].some(
      (unit) => unit.owner === player.id && unit.type === UnitType.VILLAGER,
    );
    // A destroyed/recycled prerequisite is taught again instead of leaving recruitment blocked.
    if (!villager && player.population >= player.maxPopulation) {
      const gather = this.gather(
        state,
        player,
        BUILDING_COSTS[BuildingType.HOUSE],
        mode,
      );
      if (gather)
        return {
          step: 2,
          title: house
            ? "Préparez une autre maison"
            : "Récoltez pour votre maison",
          ...gather,
        };
      return {
        step: 3,
        title: "Construisez une maison",
        text: "La maison débloque de la place pour vos unités. B ouvre les constructions : choisissez Maison, puis cliquez sur une case libre près de vous lorsque l'aperçu est vert. Échap annule la pose.",
        action: { kind: "build", type: BuildingType.HOUSE },
        actionLabel: "Choisir Maison",
      };
    }
    if (!center) {
      const gather = this.gather(
        state,
        player,
        BUILDING_COSTS[BuildingType.TOWN_CENTER],
        mode,
      );
      if (gather)
        return { step: 4, title: "Préparez votre centre-ville", ...gather };
      return {
        step: 5,
        title: "Installez votre centre-ville",
        text: "Le centre-ville recrute les villageois et reçoit leur récolte. Placez-le près des arbres ou des gisements, sur une case libre avec un aperçu vert. Gardez de l'espace autour pour circuler.",
        action: { kind: "build", type: BuildingType.TOWN_CENTER },
        actionLabel: "Choisir Centre-ville",
      };
    }
    if (!villager) {
      const gather = this.gather(state, player, UNIT_COSTS.VILLAGER, mode);
      if (gather)
        return {
          step: 6,
          title: "Gardez de l'or pour un villageois",
          ...gather,
        };
      return {
        step: 6,
        title: "Recrutez votre premier villageois",
        text: `Échap quitte la construction. Cliquez sur votre centre-ville, puis sur « Villageois » dans son panneau. Coût : ${UNIT_COSTS.VILLAGER.gold} or. Il choisira une ressource proche et rapportera sa récolte automatiquement.`,
        target: {
          x: center.x + TILE_SIZE / 2,
          y: center.y + TILE_SIZE / 2,
          label: "Votre centre-ville",
        },
        action: { kind: "select", id: center.id },
        actionLabel: "Voir le centre-ville",
      };
    }
    if (!this.mapOpened || !this.mapClosed)
      return {
        step: 7,
        title: "Explorez la carte",
        text: this.mapOpened
          ? "Le point blanc indique votre position. Les zones se révèlent en explorant. Repérez vos prochaines réserves : les ressources s'épuisent. Appuyez sur M ou Échap pour refermer la carte et terminer le guide."
          : "Appuyez sur M pour ouvrir la carte. Les zones se révèlent en explorant ; le point blanc indique votre position. M ou Échap la referme. Les ressources s'épuisent : repérez vos prochaines réserves.",
        action: { kind: "map" },
        actionLabel: this.mapOpened
          ? "Fermer la carte · M"
          : "Ouvrir la carte · M",
      };
    this.complete = true;
    return this.finished();
  }

  private gather(
    state: WorldState,
    player: Player,
    costs: ResourceAmounts,
    mode: { combat: boolean; building: boolean },
  ): Pick<TutorialView, "text" | "progress" | "target"> | undefined {
    const entries = Object.entries(costs) as [ResourceType, number][];
    const missing = entries.find(
      ([type, cost]) => (player.resources.get(type) ?? 0) < cost,
    );
    if (!missing) return;
    const [type] = missing;
    let nearest,
      distance = Infinity;
    for (const resource of state.resources.values()) {
      if (resource.type !== type || resource.amount <= 0) continue;
      const d = distanceSquared(player, resource);
      if (d < distance) {
        nearest = resource;
        distance = d;
      }
    }
    const source =
      type === ResourceType.WOOD
        ? "d'un arbre"
        : type === ResourceType.STONE
          ? "d'un rocher"
          : "d'un gisement d'or";
    const controls = `${mode.building ? "Échap annule la construction. " : ""}${mode.combat ? "Tab revient en mode Récolte. " : ""}`;
    return {
      text: `${controls}Approchez-vous ${source}, puis maintenez le clic gauche au sol pour récolter la ressource la plus proche. ${nearest ? "Suivez le repère ; changez de réserve quand elle est épuisée." : "Explorez autour de vous pour trouver une réserve : M ouvre la carte."}`,
      progress: entries
        .map(
          ([resource, cost]) =>
            `${RESOURCE_LABELS[resource]} ${Math.min(player.resources.get(resource) ?? 0, cost)}/${cost}`,
        )
        .join(" · "),
      target: nearest
        ? { x: nearest.x, y: nearest.y, label: RESOURCE_LABELS[type] }
        : undefined,
    };
  }

  private finished(): TutorialView {
    return {
      step: 7,
      title: "Votre colonie est lancée !",
      text: "Vos villageois récoltent et rapportent les ressources au centre-ville. Ajoutez des maisons pour agrandir la population.\n\nPour l'armée : une forge transforme la pierre en fer, puis une caserne recrute les soldats. Tab active le combat ; un clic maintenu au sol donne un ordre de déplacement aux soldats.",
      complete: true,
    };
  }
}
