import { test, expect, type Page } from "@playwright/test";
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

async function join(page: Page, name: string) {
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
async function clickText(page: Page, prefix: string) {
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
async function clickWorld(page: Page, x: number, y: number) {
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

test("menu, harvesting, construction, resizing and repeated scene restarts work without leaks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Pseudo" })).toBeVisible();
  await expect(page.locator("#phaser-container > canvas")).toHaveCount(1);
  await join(page, "BrowserTest");
  const initial = await page.evaluate(() => {
    const scene = window.PHASER_GAME.scene.getScene("GameScene") as GameScene;
    return {
      gold: scene.self!.resources.get("gold")!,
      x: scene.localPosition.x,
      y: scene.localPosition.y,
    };
  });
  await page.mouse.move(650, 400);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window.PHASER_GAME.scene.getScene("GameScene") as GameScene
        ).self?.resources.get("gold"),
      ),
    )
    .toBeGreaterThan(initial.gold);
  await page.mouse.up();
  await page.keyboard.press("b");
  await clickText(page, "Maison");
  await clickWorld(page, 12 * 32 + 16, 11 * 32 + 16);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.PHASER_GAME.scene.getScene("GameScene") as GameScene)
            .connection.room?.state.buildings.size,
      ),
    )
    .toBe(1);
  await clickWorld(page, 12 * 32 + 16, 11 * 32 + 16);
  await clickText(page, "Recycler");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.PHASER_GAME.scene.getScene("GameScene") as GameScene)
            .connection.room?.state.buildings.size,
      ),
    )
    .toBe(0);
  await page.keyboard.down("a");
  await page.waitForTimeout(250);
  await page.keyboard.up("a");
  const moved = await page.evaluate(
    () =>
      (window.PHASER_GAME.scene.getScene("GameScene") as GameScene)
        .localPosition.x,
  );
  expect(moved).toBeLessThan(initial.x);
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.PHASER_GAME.scene.getScene("GameScene") as GameScene)
            .combatMode,
      ),
    )
    .toBe(true);
  await page.keyboard.press("m");
  await page.setViewportSize({ width: 800, height: 600 });
  await page.keyboard.press("Escape");
  await expect(page.locator("#phaser-container > canvas")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect
    .poll(() => page.evaluate(() => window.PHASER_GAME.scale.width))
    .toBe(1280);
  const baseline = await page.evaluate(() => ({
    resize: window.PHASER_GAME.scale.listenerCount("resize"),
    textures: Object.keys(window.PHASER_GAME.textures.list).length,
  }));
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      window.previousRoom = (
        window.PHASER_GAME.scene.getScene("GameScene") as GameScene
      ).connection.room;
    });
    await clickText(page, "Menu");
    await expect(page.getByRole("textbox", { name: "Pseudo" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.previousRoom?.serializer.decoder.root.refs.size,
        ),
      )
      .toBe(0);
    await page.evaluate(() => {
      window.previousRoom = undefined;
    });
    await join(page, `BrowserTest${i}`);
    await expect(page.locator("#phaser-container > canvas")).toHaveCount(1);
    const counts = await page.evaluate(() => ({
      resize: window.PHASER_GAME.scale.listenerCount("resize"),
      textures: Object.keys(window.PHASER_GAME.textures.list).length,
    }));
    expect(counts.resize).toBe(baseline.resize);
    expect(counts.textures).toBeLessThanOrEqual(baseline.textures);
  }
  expect(errors).toEqual([]);
});
