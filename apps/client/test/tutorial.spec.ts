import { test, expect, type Page } from "@playwright/test";
import type { GameScene } from "../src/game/scenes/GameScene";
import { join, clickText, clickWorld, uiText } from "./helpers";

async function position(page: Page) {
  return page.evaluate(() => {
    const scene = window.PHASER_GAME.scene.getScene("GameScene") as GameScene;
    return { ...scene.localPosition };
  });
}

async function moveTo(page: Page, x: number, y: number) {
  // Travel along the fixture's clear lanes using the player's actual keyboard controls.
  for (const [axis, goal] of [
    ["y", 320],
    ["x", x],
    ["y", y],
  ] as const) {
    const start = (await position(page))[axis];
    if (Math.abs(goal - start) < 3) continue;
    const key =
      axis === "x" ? (goal > start ? "d" : "a") : goal > start ? "s" : "w";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ axis, goal, positive }) => {
          const point = (
            window.PHASER_GAME.scene.getScene("GameScene") as GameScene
          ).localPosition;
          return positive ? point[axis] >= goal - 3 : point[axis] <= goal + 3;
        },
        { axis, goal, positive: goal > start },
        { timeout: 5000, polling: "raf" },
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
}

async function harvest(
  page: Page,
  x: number,
  y: number,
  type: string,
  goal: number,
) {
  await moveTo(page, x + 30, y);
  await page.mouse.move(650, 460);
  await page.mouse.down();
  await expect
    .poll(
      () =>
        page.evaluate(
          (type) =>
            (
              window.PHASER_GAME.scene.getScene("GameScene") as GameScene
            ).self?.resources.get(type),
          type,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(goal);
  await page.mouse.up();
}

async function buildBesidePlayer(page: Page) {
  const player = await position(page);
  await clickWorld(
    page,
    (Math.floor(player.x / 32) + 1) * 32 + 16,
    (Math.floor(player.y / 32) + 1) * 32 + 16,
  );
}

test("new player completes the guide with real costs and can replay it after completion", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await join(page, "TutorialTest");
  await expect.poll(() => uiText(page)).toContain("Prenez vos repères");
  await page.screenshot({ path: test.info().outputPath("tutorial-start.png") });
  expect(
    await page.evaluate(() =>
      (
        window.PHASER_GAME.scene.getScene("GameScene") as GameScene
      ).self?.resources.get("wood"),
    ),
  ).toBe(0);
  await moveTo(page, 320, 320);
  await expect.poll(() => uiText(page)).toContain("Récoltez pour votre maison");
  await page.screenshot({
    path: test.info().outputPath("tutorial-harvest.png"),
  });
  await harvest(page, 208, 272, "wood", 10);
  await harvest(page, 400, 272, "stone", 10);
  await expect.poll(() => uiText(page)).toContain("Construisez une maison");
  await clickText(page, "Choisir Maison");
  // Selecting the building and an occupied tile must not validate construction.
  await clickWorld(page, 400, 272);
  await expect.poll(() => uiText(page)).toContain("Construisez une maison");
  await buildBesidePlayer(page);
  await expect
    .poll(() => uiText(page))
    .toContain("Préparez votre centre-ville");
  await page.keyboard.press("Escape");
  await harvest(page, 208, 208, "wood", 10);
  await harvest(page, 208, 144, "wood", 20);
  await harvest(page, 112, 144, "wood", 30);
  await harvest(page, 400, 272, "stone", 10);
  await harvest(page, 400, 176, "stone", 30);
  await harvest(page, 336, 400, "gold", 40);
  await expect
    .poll(() => uiText(page))
    .toContain("Installez votre centre-ville");
  await clickText(page, "Choisir Centre-ville");
  await buildBesidePlayer(page);
  await expect
    .poll(() => uiText(page))
    .toContain("Recrutez votre premier villageois");
  await clickText(page, "Voir le centre-ville");
  await clickText(page, "Villageois ·");
  await expect.poll(() => uiText(page)).toContain("Explorez la carte");
  await clickText(page, "Ouvrir la carte · M");
  await expect.poll(() => uiText(page)).toContain("Fermer la carte · M");
  await page.keyboard.press("Escape");
  await expect.poll(() => uiText(page)).toContain("Votre colonie est lancée");
  await clickText(page, "Terminer");
  expect(
    await page.evaluate(() => localStorage.getItem("mmorts.tutorial.v1")),
  ).toBe("done");
  await clickText(page, "Menu");
  await join(page, "TutorialAgain");
  expect(await uiText(page)).not.toContain("Prenez vos repères");
  await clickText(page, "Tuto");
  await expect.poll(() => uiText(page)).toContain("Prenez vos repères");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(() => page.evaluate(() => window.PHASER_GAME.scale.width))
    .toBe(800);
  await clickText(page, "Passer le tutoriel");
  expect(await uiText(page)).not.toContain("Prenez vos repères");
  await clickText(page, "Menu");
  await page.reload();
  await join(page, "TutorialSkipped");
  expect(await uiText(page)).not.toContain("Prenez vos repères");
  expect(errors).toEqual([]);
});
