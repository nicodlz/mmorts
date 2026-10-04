import Phaser from "phaser";
import type { Vector2 } from "shared";

export class InputController {
  private readonly arrows?: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private pressAt = 0;
  private held = false;
  private commanded = false;
  private target?: Vector2;
  private readonly onDown: (
    pointer: Phaser.Input.Pointer,
    objects: Phaser.GameObjects.GameObject[],
  ) => void;
  private readonly onUp: (pointer: Phaser.Input.Pointer) => void;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly actions: {
      click: (point: Vector2, button: number) => void;
      mode: () => void;
      buildMenu: () => void;
      fullMap: () => void;
      escape: () => void;
      moveUnits: (point: Vector2) => void;
      isCombatMode: () => boolean;
    },
  ) {
    const keyboard = scene.input.keyboard;
    this.arrows = keyboard?.createCursorKeys();
    for (const key of ["W", "A", "S", "D", "Z", "Q"]) {
      const input = keyboard?.addKey(key);
      if (input) this.keys[key] = input;
    }
    keyboard?.addCapture(["TAB", "SPACE", "UP", "DOWN", "LEFT", "RIGHT"]);
    const hotkeys: Record<string, () => void> = {
      Tab: actions.mode,
      KeyB: actions.buildMenu,
      KeyM: actions.fullMap,
      Escape: actions.escape,
    };
    this.onKey = (event) => {
      const action = hotkeys[event.code];
      if (!action || event.repeat) return;
      // Phaser queues events until the next frame; its stopPropagation marks a handled event.
      event.stopPropagation();
      event.preventDefault();
      action();
    };
    this.onDown = (pointer, objects) => {
      if (objects.length) return;
      const point = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      actions.click(point, pointer.button);
      if (pointer.button === 0) {
        this.held = true;
        this.pressAt = performance.now();
        this.target = point;
        this.commanded = false;
      }
    };
    this.onUp = () => {
      this.held = false;
      this.commanded = false;
      this.target = undefined;
    };
    keyboard?.on("keydown", this.onKey);
    scene.input.on("pointerdown", this.onDown);
    scene.input.on("pointerup", this.onUp);
    scene.input.on("pointerupoutside", this.onUp);
    scene.game.events.on(Phaser.Core.Events.BLUR, this.onUp);
    scene.input.mouse?.disableContextMenu();
  }
  get mining(): boolean {
    return (
      this.held &&
      this.scene.input.activePointer.isDown &&
      !this.actions.isCombatMode()
    );
  }
  direction(): Vector2 {
    const left =
      this.arrows?.left.isDown || this.keys.A?.isDown || this.keys.Q?.isDown;
    const right = this.arrows?.right.isDown || this.keys.D?.isDown;
    const up =
      this.arrows?.up.isDown || this.keys.W?.isDown || this.keys.Z?.isDown;
    const down = this.arrows?.down.isDown || this.keys.S?.isDown;
    const x = Number(!!right) - Number(!!left),
      y = Number(!!down) - Number(!!up);
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }
  update(): void {
    if (
      this.held &&
      this.target &&
      !this.commanded &&
      this.actions.isCombatMode() &&
      performance.now() - this.pressAt >= 200
    ) {
      this.actions.moveUnits(this.target);
      this.commanded = true;
    }
  }
  destroy(): void {
    this.scene.input.off("pointerdown", this.onDown);
    this.scene.input.off("pointerup", this.onUp);
    this.scene.input.off("pointerupoutside", this.onUp);
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.onUp);
    this.scene.input.keyboard?.off("keydown", this.onKey);
    this.scene.input.keyboard?.removeCapture([
      "TAB",
      "SPACE",
      "UP",
      "DOWN",
      "LEFT",
      "RIGHT",
    ]);
  }
}
