/**
 * LocalGame orchestrates a single-player local game.
 * It replaces the server: processes game events and sends responses
 * back through EventBus channels that mimic socket.io.
 *
 * The UI code calls localSocket.emit('drawCard', ...) and receives
 * responses through localSocket.on('updateCardList', ...).
 */
import { CoreGame } from '../core/game';
import { CorePlayer } from '../core/player-state';
import { CoreCard } from '../core/card';
import { EventBus } from './event-bus';
import testDeckData from '../core/test-deck.json';

export interface LocalSocket {
  id: string;
  disconnected: boolean;
  emit(event: string, ...args: any[]): void;
  on(event: string, callback: (...args: any[]) => void): void;
  once(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback?: (...args: any[]) => void): void;
  disconnect(): void;
}

/**
 * Creates a local game and returns a socket-like interface for the UI.
 * The UI can use this exactly like a socket.io Socket.
 */
export function createLocalGame(options?: {
  deckList?: string[];
  opponentDeckList?: string[];
  seed?: number;
  playerName?: string;
  opponentName?: string;
}): { socket: LocalSocket; start: () => void } {
  const deckA = options?.deckList ?? testDeckData.blue;
  const deckB = options?.opponentDeckList ?? testDeckData.blue;
  const seed = options?.seed ?? Date.now();
  const playerName = options?.playerName ?? 'Player';
  const opponentName = options?.opponentName ?? 'Bot';

  const game = new CoreGame(deckA, deckB, seed, playerName, opponentName);
  const player = game.playerOne;
  const opponent = game.playerTwo;

  // EventBus for sending events TO the UI (server → client direction)
  const toClient = new EventBus();

  // The socket-like object the UI will use
  const socket: LocalSocket = {
    id: 'local-player-1',
    disconnected: false,

    emit(event: string, ...args: any[]): void {
      // Process the event as the server would
      handleClientEvent(event, args);
    },

    on(event: string, callback: (...args: any[]) => void): void {
      toClient.on(event, callback);
    },

    once(event: string, callback: (...args: any[]) => void): void {
      toClient.once(event, callback);
    },

    off(event: string, callback?: (...args: any[]) => void): void {
      toClient.off(event, callback);
    },

    disconnect(): void {
      socket.disconnected = true;
    },
  };

  function serializeCardList(list: CoreCard[]) {
    // Mimic the js-sdsl Vector serialization format the client expects
    // The client reads .W (array) and .i (length)
    return { W: list, i: list.length };
  }

  function handleClientEvent(event: string, args: any[]): void {
    switch (event) {
      case 'queue':
        // Auto-start the game
        setTimeout(() => startGame(), 100);
        break;

      case 'boardFullyLoaded':
        player.boardReady = true;
        // In local mode, bot is always ready
        opponent.boardReady = true;
        setTimeout(() => toClient.emit('mulligan', {}), 300);
        break;

      case 'onMulligan': {
        const data = args[0];
        const doMulligan = data?.mulligan === 'mulligan';
        game.mulligan(1, doMulligan);
        // Auto-mulligan for bot (keep)
        game.mulligan(2, false);
        if (game.bothPlayersMulliganed()) {
          toClient.emit('mulliganDone', {});
          // Start first turn
          const firstPlayer = game.getCurrentPlayer();
          toClient.emit('changeTurn', {
            personToChangeTurnTo: firstPlayer === player ? socket.id : 'bot',
            turnNumber: game.turnNumber,
          });
        }
        break;
      }

      case 'drawCard': {
        const amount = args[0] || 1;
        const callback = args[1];
        player.drawCard(amount);
        if (callback) {
          callback({
            cards: serializeCardList(player.hand.list()),
            type: 'hand',
          });
        }
        break;
      }

      case 'drawDon': {
        const data = args[0];
        const amount = data?.amount ?? 1;
        player.drawDon(amount);
        // Send updated don area
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.donArea.list()),
          type: 'donArea',
        });
        break;
      }

      case 'shuffleHandToDeck':
        player.shuffleHandToDeck(game.rng);
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.hand.list()),
          type: 'hand',
        });
        break;

      case 'shuffleDeck':
        player.deck.shuffle(game.rng);
        break;

      case 'playCard': {
        const data = args[0];
        const cardPlayed = player.playCard(data.index);
        if (!cardPlayed) break;

        if (cardPlayed.isCharacterCard()) {
          toClient.emit('updateCardList', {
            cards: serializeCardList(player.characterArea.list()),
            type: 'characterArea',
          });
        } else {
          toClient.emit('updateCardList', {
            cards: serializeCardList(player.trash.list()),
            type: 'trash',
          });
        }
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.hand.list()),
          type: 'hand',
        });
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.donArea.list()),
          type: 'donArea',
        });
        break;
      }

      case 'refreshPhase':
        if (!game.isPlayersTurn(player)) break;
        player.refreshPhase();
        // Leader summoning sickness for turns 2-3
        if (game.turnNumber === 2 || game.turnNumber === 3) {
          if (player.leader) player.leader.summoningSickness = false;
        }
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.characterArea.list()),
          type: 'characterArea',
        });
        toClient.emit('updateCardList', {
          cards: serializeCardList(player.donArea.list()),
          type: 'donArea',
        });
        break;

      case 'endTurn': {
        game.changeTurn();
        // If it's now the bot's turn, auto-play then end
        if (game.isPlayersTurn(opponent)) {
          botTurn();
        } else {
          toClient.emit('changeTurn', {
            personToChangeTurnTo: socket.id,
            turnNumber: game.turnNumber,
          });
        }
        break;
      }

      case 'deckCount': {
        const callback = args[1];
        if (callback) callback(player.deck.size());
        break;
      }

      case 'attachDon': {
        const cardIndex = args[0];
        const callback = args[1];
        player.attachDon(cardIndex);
        if (callback) callback(serializeCardList(player.donArea.list()));
        break;
      }

      case 'retireCard': {
        const indexInPlay = args[0];
        const indexInHand = args[1];
        const callback = args[2];
        player.retireCard(indexInPlay, indexInHand);
        if (callback) {
          callback(
            serializeCardList(player.characterArea.list()),
            serializeCardList(player.donArea.list()),
            serializeCardList(player.hand.list()),
            serializeCardList(player.trash.list()),
          );
        }
        break;
      }

      case 'initiateAttack': {
        const [cardAttackingIsLeader, cardAttackingIndex, cardDefendingIsLeader, cardDefendingIndex, callback] = args;

        // Set attacking card to resting
        if (!cardAttackingIsLeader) {
          const attacker = player.characterArea.get(cardAttackingIndex);
          if (attacker) attacker.isResting = true;
        } else if (player.leader) {
          player.leader.isResting = true;
        }

        // Bot never blocks for now
        if (callback) callback(-3); // Skip block code
        break;
      }

      case 'chatMessage': {
        const data = args[0];
        toClient.emit('chatMessage', { message: data.message });
        break;
      }

      case 'deckManager': {
        const callback = args[0];
        if (callback) callback([]);
        break;
      }
    }
  }

  function startGame(): void {
    game.start();
    game.setupPhase();

    toClient.emit('start', {
      name: playerName,
      opponentName: opponentName,
      lobbyId: 'local',
      deckList: deckA,
      opponentDeckList: deckB,
    });
  }

  function botTurn(): void {
    // Simple bot: refresh, draw, don, then end turn
    opponent.refreshPhase();
    if (game.turnNumber === 2 || game.turnNumber === 3) {
      if (opponent.leader) opponent.leader.summoningSickness = false;
    }
    if (game.turnNumber !== 0) {
      opponent.drawCard(1);
    }
    const donAmount = game.turnNumber === 0 ? 1 : 2;
    opponent.drawDon(donAmount);

    // Bot plays characters it can afford
    const playable = opponent.hand.list().filter(
      c => c.isCharacterCard() && c.cost <= opponent.getUnrestedDonCount() && opponent.characterArea.size() < 5
    );
    for (const card of playable) {
      const idx = opponent.hand.list().indexOf(card);
      if (idx !== -1) {
        opponent.playCard(idx);
      }
    }

    // Update opponent areas for the UI
    toClient.emit('opponentUpdateCharacterArea', {
      cards: serializeCardList(opponent.characterArea.list()),
    });
    toClient.emit('opponentDrawDon', { amount: donAmount });
    toClient.emit('opponentDrawCard', { amount: game.turnNumber !== 0 ? 1 : 0 });

    // End bot turn
    setTimeout(() => {
      game.changeTurn();
      toClient.emit('changeTurn', {
        personToChangeTurnTo: socket.id,
        turnNumber: game.turnNumber,
      });
      toClient.emit('chatMessage', {
        message: `Server: ${opponentName} ended their turn.`,
      });
    }, 500);
  }

  return { socket, start: () => {} };
}
