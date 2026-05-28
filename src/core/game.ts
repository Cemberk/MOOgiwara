import { CorePlayer } from './player-state';
import { SeededRng } from './rng';
import type { ReplayEvent } from './types';

/**
 * Pure game-logic Game. No socket, no rendering.
 * Manages two players, turn order, and replay logging.
 */
export class CoreGame {
  playerOne: CorePlayer;
  playerTwo: CorePlayer;
  whoseTurn: 1 | 2 = 1;
  turnNumber = 0;
  rng: SeededRng;
  replay: ReplayEvent[] = [];
  started = false;
  finished = false;

  constructor(
    deckListA: string[],
    deckListB: string[],
    seed: number,
    usernameA = 'Player 1',
    usernameB = 'Player 2',
  ) {
    this.rng = new SeededRng(seed);
    this.playerOne = new CorePlayer(1, usernameA, deckListA);
    this.playerTwo = new CorePlayer(2, usernameB, deckListB);
  }

  getPlayer(index: 1 | 2): CorePlayer {
    return index === 1 ? this.playerOne : this.playerTwo;
  }

  getOpponent(player: CorePlayer): CorePlayer {
    return player === this.playerOne ? this.playerTwo : this.playerOne;
  }

  getCurrentPlayer(): CorePlayer {
    return this.getPlayer(this.whoseTurn);
  }

  isPlayersTurn(player: CorePlayer): boolean {
    return (player === this.playerOne && this.whoseTurn === 1) ||
           (player === this.playerTwo && this.whoseTurn === 2);
  }

  /** Start the game: assign object IDs, shuffle decks */
  start(): void {
    this.started = true;
    this.whoseTurn = (this.rng.nextInt(2) + 1) as 1 | 2;

    // Assign object IDs
    let id = 0;
    for (const card of this.playerOne.deck.list()) {
      card.objectId = id++;
    }
    for (const card of this.playerTwo.deck.list()) {
      card.objectId = id++;
    }

    // Shuffle decks
    this.playerOne.deck.shuffle(this.rng);
    this.playerTwo.deck.shuffle(this.rng);

    this.logEvent(this.whoseTurn, 'game_start', { firstPlayer: this.whoseTurn });
  }

  /** Both players set life cards and draw initial hand */
  setupPhase(): void {
    this.playerOne.setLifeCards();
    this.playerTwo.setLifeCards();
    this.playerOne.drawCard(5);
    this.playerTwo.drawCard(5);
    this.logEvent(this.whoseTurn, 'setup_complete', {});
  }

  /** Process mulligan for a player */
  mulligan(playerIndex: 1 | 2, doMulligan: boolean): void {
    const player = this.getPlayer(playerIndex);
    if (doMulligan) {
      player.shuffleHandToDeck(this.rng);
      player.drawCard(5);
    }
    player.mulligan = true;
    this.logEvent(playerIndex, 'mulligan', { mulligan: doMulligan });
  }

  bothPlayersMulliganed(): boolean {
    return this.playerOne.mulligan && this.playerTwo.mulligan;
  }

  /** Change turn to the next player */
  changeTurn(): void {
    this.whoseTurn = this.whoseTurn === 1 ? 2 : 1;
    this.turnNumber++;
    this.logEvent(this.whoseTurn, 'turn_start', { turnNumber: this.turnNumber });
  }

  /** Full turn sequence for the current player (automated) */
  executeTurnStart(): { donDrawn: number; cardDrawn: boolean } {
    const player = this.getCurrentPlayer();

    // Refresh phase
    player.refreshPhase();

    // Leader summoning sickness cleared on turns 2-3
    if (this.turnNumber === 2 || this.turnNumber === 3) {
      if (player.leader) player.leader.summoningSickness = false;
    }

    // Draw phase (player going first on turn 0 doesn't draw)
    let cardDrawn = false;
    if (this.turnNumber !== 0) {
      player.drawCard(1);
      cardDrawn = true;
    }

    // Don phase
    const donAmount = this.turnNumber === 0 ? 1 : 2;
    const donDrawn = player.drawDon(donAmount);

    this.logEvent(this.whoseTurn, 'turn_phases', { cardDrawn, donDrawn });

    return { donDrawn, cardDrawn };
  }

  /** Resolve an attack from one card against a target.
   *  Returns the result: damage dealt, life lost, KO, or game win. */
  resolveAttack(
    attackerPlayerIndex: 1 | 2,
    attackerSource: 'leader' | number,
    defenderTarget: 'leader' | number,
  ): {
    attackerCard: string;
    defenderCard: string;
    attackPower: number;
    defendPower: number;
    result: 'life_removed' | 'ko' | 'blocked' | 'game_win' | 'no_effect';
    winner?: 1 | 2;
  } {
    if (this.finished) throw new Error('Game is already finished');

    const attacker = this.getPlayer(attackerPlayerIndex);
    const defender = this.getOpponent(attacker);

    // Get attacking card
    const atkCard = attackerSource === 'leader'
      ? attacker.leader
      : attacker.characterArea.get(attackerSource as number);
    if (!atkCard) throw new Error('Attacker card not found');
    if (atkCard.isResting || atkCard.summoningSickness) throw new Error('Card cannot attack');

    // Get defending card
    const defCard = defenderTarget === 'leader'
      ? defender.leader
      : defender.characterArea.get(defenderTarget as number);
    if (!defCard) throw new Error('Defender card not found');

    // Rest the attacker
    atkCard.isResting = true;

    const attackPower = atkCard.getTotalAttack();
    const defendPower = defCard.isLeaderCard() ? defCard.power : defCard.getTotalAttack();

    let result: 'life_removed' | 'ko' | 'blocked' | 'game_win' | 'no_effect';
    let winner: 1 | 2 | undefined;

    if (attackPower >= defendPower) {
      if (defCard.isLeaderCard()) {
        // Attack on leader — remove a life card
        if (defender.lifeCards.size() > 0) {
          defender.lifeCards.popTop();
          result = 'life_removed';
        } else {
          // No life left = attacker wins
          this.finished = true;
          winner = attackerPlayerIndex;
          result = 'game_win';
        }
      } else {
        // Attack on character — KO (move to trash)
        defender.characterArea.remove(defCard);
        // Return attached dons
        for (const don of defCard.clearDon()) {
          defender.donArea.push(don);
        }
        defender.trash.push(defCard);
        result = 'ko';
      }
    } else {
      result = 'no_effect';
    }

    this.logEvent(attackerPlayerIndex, 'attack', {
      attacker: atkCard.id,
      attackerSource,
      defender: defCard.id,
      defenderTarget,
      attackPower,
      defendPower,
      result,
      winner,
    });

    return {
      attackerCard: atkCard.id,
      defenderCard: defCard.id,
      attackPower,
      defendPower,
      result,
      winner,
    };
  }

  /** Get all valid attack targets for the opponent */
  getAttackTargets(attackerPlayerIndex: 1 | 2): Array<{ target: 'leader' | number; id: string; power: number; resting: boolean }> {
    const defender = this.getOpponent(this.getPlayer(attackerPlayerIndex));
    const targets: Array<{ target: 'leader' | number; id: string; power: number; resting: boolean }> = [];

    if (defender.leader) {
      targets.push({
        target: 'leader',
        id: defender.leader.id,
        power: defender.leader.power,
        resting: defender.leader.isResting,
      });
    }

    for (let i = 0; i < defender.characterArea.size(); i++) {
      const c = defender.characterArea.get(i)!;
      if (c.isResting) {
        targets.push({
          target: i,
          id: c.id,
          power: c.getTotalAttack(),
          resting: c.isResting,
        });
      }
    }

    return targets;
  }

  logEvent(player: 1 | 2, action: string, data: Record<string, unknown>): void {
    this.replay.push({
      turn: this.turnNumber,
      player,
      action,
      data,
      timestamp: Date.now(),
    });
  }
}
