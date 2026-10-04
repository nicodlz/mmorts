import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";
import { UIScene } from "./scenes/UIScene";
import { MenuScene } from "./scenes/MenuScene";

export class Game extends Phaser.Game {
  constructor() {
    super({
      type: Phaser.AUTO,
      parent: "phaser-container",
      backgroundColor: "#000000",
      scene: [MenuScene, GameScene, UIScene],
      pixelArt: true,
      antialias: false,
      dom: { createContainer: true },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      fps: { target: 60 },
      render: { pixelArt: true, antialias: false, roundPixels: true },
      callbacks: {
        postBoot: (game) => {
          if (import.meta.env.VITE_E2E === "true") {
            (window as Window & { PHASER_GAME?: Phaser.Game }).PHASER_GAME =
              game;
          }
        },
      },
    });
  }
}
