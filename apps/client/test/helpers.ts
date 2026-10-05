import { expect, type Page } from "@playwright/test";
import type Phaser from "phaser";
import type { GameScene } from "../src/game/scenes/GameScene";
import type { Room } from "@colyseus/sdk";
import type { WorldState } from "shared";

declare global {
  interface Window {
    PHASER_GAME: Phaser.Game;
    previousRoom?: Room<WorldState>;
  }
}

export async function join(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Pseudo" }).fill(name);
  await page.getByRole("textbox", { name: "Pseudo" }).press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const game = window.PHASER_GAME;
        const scene = game?.scene.getScene("GameScene") as
          GameScene | undefined;
        return game?.scene.isActive("UIScene") && !!scene?.self;
      }),
    )
    .toBe(true);
}
export async function clickText(page: Page, prefix: string) {
  let point: { x: number; y: number } | undefined;
  await expect
    .poll(
      async () => {
        point = await page.evaluate((prefix) => {
          const scene = window.PHASER_GAME.scene.getScene("UIScene");
          function find(
            objects: Phaser.GameObjects.GameObject[],
          ): { x: number; y: number } | undefined {
            for (const object of objects) {
              if ("visible" in object && !object.visible) continue;
              if (
                object.type === "Text" &&
                (object as Phaser.GameObjects.Text).text.startsWith(prefix)
              ) {
                const rect = (object as Phaser.GameObjects.Text).getBounds();
                return { x: rect.centerX, y: rect.centerY };
              }
              if (object.type === "Container") {
                const result = find(
                  (object as Phaser.GameObjects.Container).list,
                );
                if (result) return result;
              }
            }
          }
          return find(scene.children.list);
        }, prefix);
        return !!point;
      },
      { message: `Canvas text ${prefix} is visible` },
    )
    .toBe(true);
  // Phaser commits newly interactive objects during the next scene frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.click(point!.x, point!.y);
}
export async function clickWorld(page: Page, x: number, y: number) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const point = await page.evaluate(
    ({ x, y }) => {
      const camera =
        window.PHASER_GAME.scene.getScene("GameScene").cameras.main;
      const point = camera.matrix.transformPoint(
        x - camera.scrollX,
        y - camera.scrollY,
      );
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

export async function uiText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const texts: string[] = [];
    function collect(objects: Phaser.GameObjects.GameObject[]) {
      for (const object of objects) {
        if ("visible" in object && !object.visible) continue;
        if (object.type === "Text")
          texts.push((object as Phaser.GameObjects.Text).text);
        if (object.type === "Container")
          collect((object as Phaser.GameObjects.Container).list);
      }
    }
    collect(window.PHASER_GAME.scene.getScene("UIScene").children.list);
    return texts.join("\n");
  });
}
