import React, { useEffect, useState } from 'react';
import { Game as PhaserGame } from './game/Game';
import './App.css';

const App: React.FC = () => {
  const [gameInitialized, setGameInitialized] = useState(false);

  useEffect(() => {
    if (!gameInitialized) {
      console.log('Initialisation du jeu Phaser...');
      const game = new PhaserGame();
      console.log('Jeu initialisé !');
      setGameInitialized(true);
    }
  }, [gameInitialized]);

  return (
    <div className="app">
      <div id="phaser-container" />
      <div className="ui-overlay">
        {/* Éléments UI React par-dessus le jeu Phaser */}
      </div>
    </div>
  );
};

export default App; 