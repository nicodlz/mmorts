import { useEffect } from "react";
import { Game } from "./game/Game";
import "./App.css";

export default function App() {
  useEffect(() => {
    let game: Game | undefined;
    // StrictMode can clean up an effect before Phaser's deferred boot has run.
    const frame = requestAnimationFrame(() => {
      game = new Game();
    });
    return () => {
      cancelAnimationFrame(frame);
      game?.destroy(true);
    };
  }, []);
  return (
    <div className="app">
      <div id="phaser-container" />
    </div>
  );
}
