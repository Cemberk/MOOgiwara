/**
 * Simulation Web Worker.
 * Runs bot-vs-bot games deterministically using the core game engine.
 * Reports progress and results back to the main thread.
 */
import { CoreGame } from '../core/game';
import type { WorkerInMessage, SimGameResult, WorkerOutMessage } from './sim-protocol';

const cancelledJobs = new Set<string>();

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    cancelledJobs.add(msg.jobId);
    return;
  }

  if (msg.type === 'run_batch') {
    runBatch(msg);
  }
};

function runBatch(msg: {
  jobId: string;
  deckA: string[];
  deckB: string[];
  games: number;
  seedPrefix: number;
}): void {
  const { jobId, deckA, deckB, games, seedPrefix } = msg;
  const results: SimGameResult[] = [];
  const PROGRESS_INTERVAL = Math.max(1, Math.floor(games / 100));

  for (let i = 0; i < games; i++) {
    if (cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId);
      return;
    }

    const seed = seedPrefix + i;
    const start = performance.now();
    const result = simulateOneGame(deckA, deckB, seed);
    const duration = performance.now() - start;

    results.push({
      gameIndex: i,
      seed,
      winner: result.winner,
      turns: result.turns,
      durationMs: duration,
    });

    if ((i + 1) % PROGRESS_INTERVAL === 0 || i === games - 1) {
      post({ type: 'progress', jobId, completed: i + 1, total: games });
    }
  }

  post({ type: 'result', jobId, results });
}

/**
 * Simulate a single game with simple heuristic bots.
 * Both bots: play affordable characters, then end turn.
 */
function simulateOneGame(
  deckA: string[],
  deckB: string[],
  seed: number,
): { winner: 1 | 2 | 'draw'; turns: number } {
  const game = new CoreGame(deckA, deckB, seed);
  game.start();
  game.setupPhase();

  // Auto-mulligan: both keep
  game.mulligan(1, false);
  game.mulligan(2, false);

  const MAX_TURNS = 200;

  for (let t = 0; t < MAX_TURNS; t++) {
    const player = game.getCurrentPlayer();

    // Turn start phases
    game.executeTurnStart();

    // Main phase: play all affordable characters
    let played = true;
    while (played) {
      played = false;
      for (let i = 0; i < player.hand.size(); i++) {
        const card = player.hand.get(i);
        if (!card) continue;
        if (card.isCharacterCard() && card.cost <= player.getUnrestedDonCount() && player.characterArea.size() < 5) {
          player.playCard(i);
          played = true;
          break; // Re-scan from start since indices shifted
        }
      }
    }

    // Simple attack: attack with all unrested characters + leader
    const opponent = game.getOpponent(player);
    if (player.leader && !player.leader.isResting && !player.leader.summoningSickness) {
      player.leader.isResting = true;
      // "Attack" opponent leader — check if opponent has life
      if (opponent.lifeCards.size() > 0) {
        // In a real game, the defender can counter. Here we just remove a life card.
        if (player.leader.getTotalAttack() >= (opponent.leader?.power ?? 0)) {
          opponent.lifeCards.popTop();
        }
      } else {
        // No life left + successful attack = win
        return { winner: player.index, turns: game.turnNumber };
      }
    }

    for (const card of player.characterArea.list()) {
      if (!card.isResting && !card.summoningSickness) {
        card.isResting = true;
        if (opponent.lifeCards.size() > 0) {
          if (card.getTotalAttack() >= (opponent.leader?.power ?? 0)) {
            opponent.lifeCards.popTop();
          }
        } else {
          return { winner: player.index, turns: game.turnNumber };
        }
      }
    }

    // Check for deck-out
    if (player.deck.isEmpty()) {
      return { winner: game.getOpponent(player).index, turns: game.turnNumber };
    }

    game.changeTurn();
  }

  return { winner: 'draw', turns: MAX_TURNS };
}

function post(msg: WorkerOutMessage): void {
  (self as any).postMessage(msg);
}
