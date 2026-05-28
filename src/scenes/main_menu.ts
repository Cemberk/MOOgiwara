import Phaser from 'phaser';

import PlayButton from '../game/menu/buttons/play_button';
import HollowShortButton from '../game/menu/buttons/hollow_short_button';
import LoadingButton from '../game/menu/buttons/loading_button';
import { createLocalGame } from '../local/local-game';
import { notification } from '../handlers/toast';
import Player from '../game/player';

export default class MainMenu extends Phaser.Scene {
  constructor() {
    super('main-menu');
  }

  preload() {
    this.load.image('tallButton', './buttons/Tall Button.png');
    this.load.image('hollowShortButton', './buttons/Hollow Short Button.png');
    this.load.image('loading', './images/mugiwara_logo_temp.png');

    document.body.style.backgroundImage = '';
  }

  create() {
    // Logo
    this.add.text(10, 80, 'OP TCG Lab', {
      fontFamily: 'Georgia Bold',
      fontSize: '44px',
      color: '#222',
    });

    this.add.text(12, 132, 'ONE PIECE TCG Research Lab (Local Mode)', {
      fontFamily: 'Georgia Bold',
      fontSize: '24px',
      color: '#222',
    });

    // Description
    this.add.text(212, 380, 'HOW TO PLAY', {
      fontFamily: 'Georgia',
      fontSize: '28px',
      color: '#222',
    });

    this.add.text(
      214,
      420,
      "Hit 'Play!' to start a local game against a bot.\nUse 'Create Deck' to manage decks (coming soon).",
      { fontFamily: 'Georgia', fontSize: '18px', color: '#222' }
    );

    // Play button — starts local game
    const playButton = new PlayButton(this, 360, 900, () => {
      playButton.disableInteractive();
      this.add.existing(new LoadingButton(this, 360, 900));

      const { socket } = createLocalGame({
        playerName: 'Player',
        opponentName: 'Bot',
      });

      socket.on('start', (data: any) => {
        const player = new Player(data.name, data.lobbyId, socket as any);
        const opponent = new Player(data.opponentName, data.lobbyId, socket as any);

        this.scene.start('game-board', {
          player,
          opponent,
          deckList: data.deckList,
          opponentDeckList: data.opponentDeckList,
        });
      });

      // Trigger the local game to start
      socket.emit('queue');
    });

    this.add.existing(playButton);

    this.add.existing(
      new HollowShortButton(
        this,
        662,
        875,
        'Create Deck',
        { fontFamily: 'Impact', fontSize: '20px', color: '#15C' },
        () => {
          notification(this, 'Deck editor coming soon!');
        }
      )
    );

    this.add.existing(
      new HollowShortButton(
        this,
        662,
        925,
        'Options',
        { fontFamily: 'Impact', fontSize: '20px', color: '#15C' },
        () => {
          notification(this, 'Options coming soon!');
        }
      )
    );

    // News panel
    this.add.rectangle(1400, 515, 620, 875, 0xf0f0f0);
    this.add.rectangle(1400, 550, 590, 780, 0xf8f8f8);

    this.add.text(1110, 110, "What's new?", {
      fontFamily: 'Georgia',
      fontSize: '32px',
      color: '#222',
    });

    this.add.text(1120, 180, 'Local mode is live!\nNo server required — play in your browser.', {
      fontFamily: 'Georgia',
      fontSize: '18px',
      color: '#222',
    });
  }
}
