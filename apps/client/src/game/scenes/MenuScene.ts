import Phaser from "phaser";
import { hueColor } from "../rendering/presentation";

export class MenuScene extends Phaser.Scene {
  private inputElement?: Phaser.GameObjects.DOMElement;
  private preview?: Phaser.GameObjects.Rectangle;
  private title?: Phaser.GameObjects.Text;
  private play?: Phaser.GameObjects.Text;
  private help?: Phaser.GameObjects.Text;
  private name = "";
  private hue = 180;
  private onResize = () => this.layout();
  constructor() {
    super({ key: "MenuScene" });
  }
  create(): void {
    this.cameras.main.setBackgroundColor("#000000");
    this.title = this.add
      .text(0, 0, "PvPStrat.io", { fontSize: "48px", color: "#ffffff" })
      .setOrigin(0.5);
    this.preview = this.add
      .rectangle(0, 0, 64, 64, hueColor(180))
      .setStrokeStyle(2, 0x222222);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.placeholder = "Entrez votre pseudo…";
    input.setAttribute("aria-label", "Pseudo");
    input.style.cssText =
      "width:240px;padding:12px;background:#252525;color:white;border:1px solid #666;font:16px Arial;text-align:center;outline-color:#4caf50";
    this.name = localStorage.getItem("playerName") || "";
    input.value = this.name;
    input.addEventListener("input", () => {
      this.name = input.value;
      this.updateHue();
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") this.start();
    });
    this.inputElement = this.add.dom(0, 0, input);
    this.play = this.add
      .text(0, 0, "PLAY", {
        fontSize: "24px",
        backgroundColor: "#4caf50",
        padding: { x: 85, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.play.on("pointerdown", () => this.start());
    this.play.on("pointerover", () => this.play?.setBackgroundColor("#66bb6a"));
    this.play.on("pointerout", () => this.play?.setBackgroundColor("#4caf50"));
    this.help = this.add
      .text(
        0,
        0,
        "Récoltez, construisez et commandez votre armée.\nWASD / ZQSD · B : construire · Tab : combat · M : carte",
        { fontSize: "13px", color: "#aaaaaa", align: "center" },
      )
      .setOrigin(0.5);
    this.scale.on("resize", this.onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize);
      this.inputElement = undefined;
    });
    this.updateHue();
    this.layout();
  }
  private start(): void {
    const name = this.name.trim();
    if (!name) {
      (this.inputElement?.node as HTMLInputElement | undefined)?.focus();
      return;
    }
    localStorage.setItem("playerName", name);
    localStorage.setItem("playerHue", String(this.hue));
    this.scene.start("GameScene", { playerName: name, playerHue: this.hue });
  }
  private updateHue(): void {
    let hash = 0;
    for (const char of this.name)
      hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    this.hue = this.name ? Math.abs(hash % 360) : 180;
    this.preview?.setFillStyle(hueColor(this.hue));
  }
  private layout(): void {
    const x = this.scale.width / 2,
      y = this.scale.height / 2;
    this.title?.setPosition(x, y - 150);
    this.preview?.setPosition(x, y - 55);
    this.inputElement?.setPosition(x, y + 35);
    this.play?.setPosition(x, y + 100);
    this.help?.setPosition(x, y + 175);
  }
}
