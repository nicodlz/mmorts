import Phaser from "phaser";
import type { GameEvent } from "shared";

/** Phaser Group handles getFirstDead and killAndHide, with a fixed upper bound. */
export class Effects {
  private readonly texts: Phaser.GameObjects.Group;
  constructor(private readonly scene: Phaser.Scene) {
    this.texts = scene.add.group({ maxSize: 64 });
  }
  show(event: GameEvent): void {
    if (
      event.kind !== "damage" &&
      event.kind !== "harvest" &&
      event.kind !== "deposit"
    )
      return;
    let text = this.texts.getFirstDead(false) as Phaser.GameObjects.Text | null;
    if (!text && this.texts.getLength() < 64) {
      text = this.scene.add.text(0, 0, "", {
        fontSize: "10px",
        fontFamily: "Arial",
        stroke: "#000000",
        strokeThickness: 2,
      });
      this.texts.add(text);
    }
    if (!text) return;
    const value =
      event.kind === "damage"
        ? `-${event.amount ?? 0}`
        : `+${event.amount ?? 0}`;
    text
      .setPosition(event.x, event.y - 12)
      .setText(value)
      .setColor(event.kind === "damage" ? "#ff6666" : "#ffe08a")
      .setOrigin(0.5)
      .setDepth(30)
      .setAlpha(1)
      .setScale(1)
      .setActive(true)
      .setVisible(true);
    this.scene.tweens.add({
      targets: text,
      y: event.y - 35,
      alpha: 0,
      duration: 650,
      onComplete: () => {
        if (text) this.texts.killAndHide(text);
      },
    });
  }
  destroy(): void {
    // Scene UpdateList may have already destroyed its native groups during shutdown.
    if (!this.texts.scene) return;
    for (const child of this.texts.getChildren())
      this.scene.tweens.killTweensOf(child);
    this.texts.destroy(true);
  }
}
