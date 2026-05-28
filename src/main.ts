import Phaser from 'phaser';
import DeckManager from './scenes/deck_manager';
import GameBoard from './scenes/game_board';
import MainMenu from './scenes/main_menu';
import { registerAllTools } from './webmcp/tools';

// Register WebMCP tools on startup
registerAllTools();

const game = {
  type: Phaser.AUTO,
  width: 1920,
  height: 1080,
  parent: 'game-container',
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  transparent: true,
  scene: [MainMenu, GameBoard, DeckManager],
};

new Phaser.Game(game);
