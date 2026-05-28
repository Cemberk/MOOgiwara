/**
 * LocalGame orchestrates a single-player local game.
 * It replaces the server: processes game events and sends responses
 * back through EventBus channels that mimic socket.io.
 *
 * IMPORTANT: All toClient.emit() calls are wrapped in defer() to match
 * socket.io's async delivery. Phaser needs render frames between events.
 * Callbacks (socket.io acknowledgements) fire synchronously like socket.io.
 */
import { CoreGame } from '../core/game';
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

  /** Defer event delivery to next microtask — matches socket.io async behavior */
  function defer(fn: () => void): void {
    setTimeout(fn, 0);
  }

  /** Send an event to the client asynchronously */
  function send(event: string, ...args: any[]): void {
    defer(() => toClient.emit(event, ...args));
  }

  /** Send multiple events with small delays between them so Phaser can render */
  function sendSequence(events: Array<[string, ...any[]]>, delayMs = 16): void {
    events.forEach(([event, ...args], i) => {
      setTimeout(() => toClient.emit(event, ...args), i * delayMs);
    });
  }

  // The socket-like object the UI will use
  const socket: LocalSocket = {
    id: 'local-player-1',
    disconnected: false,

    emit(event: string, ...args: any[]): void {
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
        setTimeout(() => startGame(), 100);
        break;

      case 'boardFullyLoaded':
        player.boardReady = true;
        opponent.boardReady = true;
        setTimeout(() => toClient.emit('mulligan', {}), 500);
        break;

      case 'onMulligan': {
        const data = args[0];
        const doMulligan = data?.mulligan === 'mulligan';
        game.mulligan(1, doMulligan);
        game.mulligan(2, false);

        if (game.bothPlayersMulliganed()) {
          // Defer mulliganDone so Phaser can process the button click first
          defer(() => {
            toClient.emit('mulliganDone', {});

            // If bot goes first, run bot turn then give control to player
            if (game.getCurrentPlayer() === opponent) {
              setTimeout(() => {
                botTurn();
              }, 300);
            } else {
              // Player goes first
              setTimeout(() => {
                toClient.emit('changeTurn', {
                  personToChangeTurnTo: socket.id,
                  turnNumber: game.turnNumber,
                });
              }, 200);
            }
          });
        }
        break;
      }

      case 'drawCard': {
        const amount = args[0] || 1;
        const callback = args[1];
        player.drawCard(amount);
        // Callbacks fire synchronously (socket.io acknowledgement pattern)
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
        send('updateCardList', {
          cards: serializeCardList(player.donArea.list()),
          type: 'donArea',
        });
        break;
      }

      case 'shuffleHandToDeck':
        player.shuffleHandToDeck(game.rng);
        send('updateCardList', {
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

        const events: Array<[string, any]> = [];

        if (cardPlayed.isCharacterCard()) {
          events.push(['updateCardList', {
            cards: serializeCardList(player.characterArea.list()),
            type: 'characterArea',
          }]);
        } else {
          events.push(['updateCardList', {
            cards: serializeCardList(player.trash.list()),
            type: 'trash',
          }]);
        }
        events.push(['updateCardList', {
          cards: serializeCardList(player.hand.list()),
          type: 'hand',
        }]);
        events.push(['updateCardList', {
          cards: serializeCardList(player.donArea.list()),
          type: 'donArea',
        }]);

        // Broadcast to opponent
        events.push(['opponentRemoveCardFromHand', { amount: 1 }]);
        if (cardPlayed.isCharacterCard()) {
          events.push(['opponentUpdateCharacterArea', {
            cards: serializeCardList(player.characterArea.list()),
          }]);
        }

        sendSequence(events);
        break;
      }

      case 'refreshPhase':
        if (!game.isPlayersTurn(player)) break;
        player.refreshPhase();
        if (game.turnNumber === 2 || game.turnNumber === 3) {
          if (player.leader) player.leader.summoningSickness = false;
        }
        sendSequence([
          ['updateCardList', {
            cards: serializeCardList(player.characterArea.list()),
            type: 'characterArea',
          }],
          ['updateCardList', {
            cards: serializeCardList(player.donArea.list()),
            type: 'donArea',
          }],
        ]);
        break;

      case 'endTurn': {
        send('chatMessage', {
          message: `Server: ${playerName} ended their turn.`,
        });
        game.changeTurn();
        if (game.isPlayersTurn(opponent)) {
          setTimeout(() => botTurn(), 300);
        } else {
          send('changeTurn', {
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
        // Callback fires synchronously (acknowledgement)
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

        // Resolve attack on the core game
        const attackerSource = cardAttackingIsLeader ? 'leader' as const : cardAttackingIndex;
        const defenderTarget = cardDefendingIsLeader ? 'leader' as const : cardDefendingIndex;
        try {
          game.resolveAttack(1, attackerSource, defenderTarget);
        } catch {
          // Attack resolution failed, just rest the card
        }

        // Bot never blocks for now — send skip-block code
        if (callback) callback(-3);
        break;
      }

      case 'chatMessage': {
        const data = args[0];
        send('chatMessage', { message: data.message });
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

    // Always make the human player go first for better UX
    game.whoseTurn = 1;

    toClient.emit('start', {
      name: playerName,
      opponentName: opponentName,
      lobbyId: 'local',
      deckList: deckA,
      opponentDeckList: deckB,
    });
  }

  function botTurn(): void {
    // Simple bot: refresh, draw, don, play what it can, then end turn
    opponent.refreshPhase();
    if (game.turnNumber === 2 || game.turnNumber === 3) {
      if (opponent.leader) opponent.leader.summoningSickness = false;
    }
    if (game.turnNumber !== 0) {
      opponent.drawCard(1);
    }
    const donAmount = game.turnNumber === 0 ? 1 : 2;
    opponent.drawDon(donAmount);

    // Bot plays characters it can afford (re-scan after each play since indices shift)
    let played = true;
    while (played) {
      played = false;
      for (let i = 0; i < opponent.hand.size(); i++) {
        const c = opponent.hand.get(i);
        if (c && c.isCharacterCard() && c.cost <= opponent.getUnrestedDonCount() && opponent.characterArea.size() < 5) {
          opponent.playCard(i);
          played = true;
          break;
        }
      }
    }

    // Send opponent area updates to the UI with delays
    const events: Array<[string, any]> = [];
    events.push(['opponentUpdateCharacterArea', {
      cards: serializeCardList(opponent.characterArea.list()),
    }]);
    if (game.turnNumber !== 0) {
      events.push(['opponentDrawCard', { amount: 1 }]);
    }
    events.push(['opponentDrawDon', { amount: donAmount }]);
    events.push(['chatMessage', {
      message: `Server: ${opponentName} ended their turn.`,
    }]);

    sendSequence(events);

    // End bot turn and give control back to player
    setTimeout(() => {
      game.changeTurn();
      toClient.emit('changeTurn', {
        personToChangeTurnTo: socket.id,
        turnNumber: game.turnNumber,
      });
    }, events.length * 16 + 300);
  }

  return { socket, start: () => {} };
}
