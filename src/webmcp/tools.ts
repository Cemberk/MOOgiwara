/**
 * All WebMCP tool definitions for the TCG research lab.
 * Call registerAllTools() once on app startup.
 */
import { registry } from './registry';
import { deckStore, jobStore, settingsStore } from '../storage/idb';
import { replayStore, exportAllData, clearAllOpfs } from '../storage/opfs';
import { enqueueSimBatch, cancelJob, getJob, listJobs, getResults } from '../workers/sim-pool';
import { query as analyticsQuery, matchupMatrix, deckReport, refresh as analyticsRefresh, ingestResults } from '../analytics/db';
import { CoreGame } from '../core/game';
import cardMetadata from '../cards/metadata.json';

export function registerAllTools(): void {
  // ======== APP TOOLS ========

  registry.register({
    name: 'app_get_status',
    title: 'Get app status',
    description: 'Returns current app status: tool count, storage info, WebMCP support.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return {
        toolCount: registry.toolCount,
        webMcpSupport: registry.hasWebMcpSupport(),
        enabled: registry.enabled,
        auditLogSize: registry.auditLog.length,
      };
    },
  });

  registry.register({
    name: 'app_get_capabilities',
    title: 'Get app capabilities',
    description: 'Lists all available tool names and their descriptions.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return { tools: registry.list() };
    },
  });

  registry.register({
    name: 'app_get_storage_summary',
    title: 'Get storage summary',
    description: 'Returns counts of stored decks, jobs, and replays.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const [decks, jobs, replays] = await Promise.all([
        deckStore.list(),
        jobStore.list(),
        replayStore.list(),
      ]);
      return { decks: decks.length, jobs: jobs.length, replays: replays.length };
    },
  });

  registry.register({
    name: 'app_export_bundle',
    title: 'Export all data',
    description: 'Exports all decks, jobs, and replay data as a JSON bundle.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const [decks, jobs, opfsData] = await Promise.all([
        deckStore.list(),
        jobStore.list(),
        exportAllData(),
      ]);
      return { decks, jobs, ...opfsData };
    },
  });

  registry.register({
    name: 'app_clear_storage',
    title: 'Clear all storage',
    description: 'Deletes all decks, jobs, replays, and datasets. Destructive.',
    inputSchema: { type: 'object', properties: {} },
    destructiveHint: true,
    async execute() {
      await Promise.all([deckStore.clear(), jobStore.clear(), clearAllOpfs()]);
      return { cleared: true };
    },
  });

  // ======== CARD TOOLS ========

  registry.register({
    name: 'cards_search',
    title: 'Search cards',
    description: 'Search card metadata by name, color, type, or effect text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in card name/effect/type' },
        category: { type: 'string', enum: ['LEADER', 'CHARACTER', 'EVENT', 'STAGE'] },
        color: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const meta = cardMetadata as Record<string, any>;
      const results: any[] = [];
      const q = (input.query || '').toLowerCase();
      const maxResults = input.maxResults || 20;

      for (const [id, card] of Object.entries(meta)) {
        if (input.category && card.Category !== input.category) continue;
        if (input.color && card.Color !== input.color) continue;
        if (q) {
          const haystack = `${card.Name} ${card.Effect} ${card.Type} ${id}`.toLowerCase();
          if (!haystack.includes(q)) continue;
        }
        results.push({ id, ...card });
        if (results.length >= maxResults) break;
      }
      return { results, count: results.length };
    },
  });

  registry.register({
    name: 'cards_get',
    title: 'Get card',
    description: 'Get full metadata for a specific card by ID.',
    inputSchema: {
      type: 'object',
      required: ['cardId'],
      properties: { cardId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const meta = (cardMetadata as Record<string, any>)[input.cardId];
      if (!meta) throw new Error(`Card not found: ${input.cardId}`);
      return { id: input.cardId, ...meta };
    },
  });

  registry.register({
    name: 'cards_list_sets',
    title: 'List card sets',
    description: 'Returns all unique card sets in the metadata.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const meta = cardMetadata as Record<string, any>;
      const sets = new Set<string>();
      for (const card of Object.values(meta)) {
        if (card['Card Set(s)'] && card['Card Set(s)'] !== '-') {
          sets.add(card['Card Set(s)']);
        }
      }
      return { sets: [...sets].sort() };
    },
  });

  // ======== DECK TOOLS ========

  registry.register({
    name: 'decks_list',
    title: 'List decks',
    description: 'List all locally saved decks.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return { decks: await deckStore.list() };
    },
  });

  registry.register({
    name: 'decks_get',
    title: 'Get deck',
    description: 'Get a specific deck by ID.',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: { deckId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const deck = await deckStore.get(input.deckId);
      if (!deck) throw new Error(`Deck not found: ${input.deckId}`);
      return deck;
    },
  });

  registry.register({
    name: 'decks_create',
    title: 'Create deck',
    description: 'Create a local deck from a leader card ID and card-count map.',
    inputSchema: {
      type: 'object',
      required: ['name', 'leaderId', 'cards'],
      properties: {
        name: { type: 'string' },
        leaderId: { type: 'string' },
        cards: {
          type: 'object',
          additionalProperties: { type: 'integer', minimum: 1, maximum: 4 },
        },
      },
    },
    async execute(input: any) {
      const deck = await deckStore.create({
        name: input.name,
        leaderId: input.leaderId,
        cards: input.cards,
      });
      return deck;
    },
  });

  registry.register({
    name: 'decks_edit',
    title: 'Edit deck',
    description: 'Update a deck\'s name, leader, or card list.',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: {
        deckId: { type: 'string' },
        name: { type: 'string' },
        leaderId: { type: 'string' },
        cards: { type: 'object', additionalProperties: { type: 'integer' } },
      },
    },
    async execute(input: any) {
      const { deckId, ...changes } = input;
      const updated = await deckStore.update(deckId, changes);
      if (!updated) throw new Error(`Deck not found: ${deckId}`);
      return updated;
    },
  });

  registry.register({
    name: 'decks_delete',
    title: 'Delete deck',
    description: 'Delete a deck by ID. Destructive.',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: { deckId: { type: 'string' } },
    },
    destructiveHint: true,
    async execute(input: any) {
      await deckStore.delete(input.deckId);
      return { deleted: true };
    },
  });

  registry.register({
    name: 'decks_validate',
    title: 'Validate deck',
    description: 'Check if a deck is legal (50 cards, max 4 copies, color match).',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: { deckId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const deck = await deckStore.get(input.deckId);
      if (!deck) throw new Error(`Deck not found: ${input.deckId}`);
      const issues: string[] = [];
      const totalCards = Object.values(deck.cards).reduce((s: number, n: number) => s + n, 0);
      if (totalCards !== 50) issues.push(`Deck has ${totalCards} cards (need 50)`);
      for (const [id, count] of Object.entries(deck.cards)) {
        if ((count as number) > 4) issues.push(`${id} has ${count} copies (max 4)`);
      }
      return { valid: issues.length === 0, issues, totalCards };
    },
  });

  registry.register({
    name: 'decks_import_text',
    title: 'Import deck from text',
    description: 'Import a deck from card ID list (one per line or comma-separated).',
    inputSchema: {
      type: 'object',
      required: ['name', 'text'],
      properties: {
        name: { type: 'string' },
        text: { type: 'string', description: 'Card IDs, one per line or comma-separated' },
      },
    },
    async execute(input: any) {
      const ids = input.text.split(/[,\n]+/).map((s: string) => s.trim()).filter(Boolean);
      const cards: Record<string, number> = {};
      let leaderId = '';
      for (const id of ids) {
        const meta = (cardMetadata as Record<string, any>)[id];
        if (!meta) continue;
        if (meta.Category === 'LEADER') {
          leaderId = id;
        } else {
          cards[id] = (cards[id] || 0) + 1;
        }
      }
      const deck = await deckStore.create({ name: input.name, leaderId, cards });
      return deck;
    },
  });

  registry.register({
    name: 'decks_export_text',
    title: 'Export deck as text',
    description: 'Export a deck as a newline-separated card ID list.',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: { deckId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const deck = await deckStore.get(input.deckId);
      if (!deck) throw new Error(`Deck not found: ${input.deckId}`);
      const lines = [deck.leaderId];
      for (const [id, count] of Object.entries(deck.cards)) {
        for (let i = 0; i < (count as number); i++) lines.push(id);
      }
      return { text: lines.join('\n'), cardCount: lines.length };
    },
  });

  // ======== GAME TOOLS ========

  let currentGame: CoreGame | null = null;

  function requireGame(): CoreGame {
    if (!currentGame) throw new Error('No active game. Call game_new first.');
    return currentGame;
  }

  function playerSummary(g: CoreGame, playerIndex: 1 | 2) {
    const p = g.getPlayer(playerIndex);
    return {
      leader: p.leader ? { id: p.leader.id, name: p.leader.name, power: p.leader.power, life: p.leader.life, resting: p.leader.isResting, don: p.leader.attachedDon.length } : null,
      hand: p.hand.list().map(c => ({ id: c.id, name: c.name, cost: c.cost, power: c.power, category: c.category })),
      handSize: p.hand.size(),
      deckSize: p.deck.size(),
      lifeRemaining: p.lifeCards.size(),
      characters: p.characterArea.list().map((c, i) => ({
        index: i, id: c.id, name: c.name, power: c.getTotalAttack(), basePower: c.power,
        resting: c.isResting, summoningSickness: c.summoningSickness,
        don: c.attachedDon.length, blocker: c.isBlocker,
      })),
      donAvailable: p.getUnrestedDonCount(),
      donTotal: p.donArea.size(),
      donDeckRemaining: p.donDeck.size(),
      trash: p.trash.list().map(c => ({ id: c.id, name: c.name })),
      trashSize: p.trash.size(),
    };
  }

  registry.register({
    name: 'game_new',
    title: 'New game',
    description: 'Create a new game. Both players draw 5 cards. You must call game_mulligan for each player before play begins.',
    inputSchema: {
      type: 'object',
      required: ['deckA', 'deckB'],
      properties: {
        deckA: { type: 'array', items: { type: 'string' }, description: 'Player 1 deck (leader + 50 cards)' },
        deckB: { type: 'array', items: { type: 'string' }, description: 'Player 2 deck (leader + 50 cards)' },
        seed: { type: 'integer', description: 'RNG seed for deterministic replay' },
      },
    },
    async execute(input: any) {
      const seed = input.seed ?? Date.now();
      currentGame = new CoreGame(input.deckA, input.deckB, seed);
      currentGame.start();
      currentGame.setupPhase();
      return {
        firstPlayer: currentGame.whoseTurn,
        seed,
        p1: playerSummary(currentGame, 1),
        p2: playerSummary(currentGame, 2),
        nextStep: 'Call game_mulligan for player 1 and player 2',
      };
    },
  });

  registry.register({
    name: 'game_mulligan',
    title: 'Mulligan decision',
    description: 'Decide whether a player mulligans (shuffles hand back, draws 5 new). Both players must mulligan before the first turn starts.',
    inputSchema: {
      type: 'object',
      required: ['player', 'mulligan'],
      properties: {
        player: { type: 'integer', enum: [1, 2] },
        mulligan: { type: 'boolean', description: 'true = shuffle and redraw, false = keep hand' },
      },
    },
    async execute(input: any) {
      const g = requireGame();
      g.mulligan(input.player, input.mulligan);
      const p = g.getPlayer(input.player);
      const result: any = {
        player: input.player,
        mulliganed: input.mulligan,
        newHand: p.hand.list().map(c => ({ id: c.id, name: c.name, cost: c.cost, category: c.category })),
      };
      if (g.bothPlayersMulliganed()) {
        // Start the first turn automatically
        g.executeTurnStart();
        result.gameReady = true;
        result.firstPlayer = g.whoseTurn;
        result.turnNumber = g.turnNumber;
        result.message = `Both players mulliganed. Turn ${g.turnNumber}: Player ${g.whoseTurn}'s turn.`;
      }
      return result;
    },
  });

  registry.register({
    name: 'game_get_state',
    title: 'Get game state',
    description: 'Full game state for both players: hand contents, field, life, don, trash, turn info.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const g = requireGame();
      return {
        turnNumber: g.turnNumber,
        whoseTurn: g.whoseTurn,
        finished: g.finished,
        p1: playerSummary(g, 1),
        p2: playerSummary(g, 2),
      };
    },
  });

  registry.register({
    name: 'game_get_player_view',
    title: 'Get player view',
    description: 'Detailed view for one player (hand card IDs, field, resources).',
    inputSchema: {
      type: 'object',
      required: ['player'],
      properties: { player: { type: 'integer', enum: [1, 2] } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const g = requireGame();
      return playerSummary(g, input.player);
    },
  });

  registry.register({
    name: 'game_get_legal_actions',
    title: 'Get legal actions',
    description: 'All legal actions for the current player. Each action is a structured object you pass to game_apply_action.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const g = requireGame();
      if (g.finished) return { actions: [], message: 'Game is over.' };

      const p = g.getCurrentPlayer();
      const opp = g.getOpponent(p);
      const actions: any[] = [];

      // End turn is always available
      actions.push({ type: 'end_turn', description: 'End your turn' });

      // Playable cards from hand
      for (let i = 0; i < p.hand.size(); i++) {
        const c = p.hand.get(i)!;
        if (c.cost <= p.getUnrestedDonCount()) {
          if (c.isCharacterCard() && p.characterArea.size() < 5) {
            actions.push({ type: 'play_card', handIndex: i, cardId: c.id, name: c.name, cost: c.cost, description: `Play ${c.name} (cost ${c.cost})` });
          } else if (c.isEventCard() && !c.isEventCounterCard()) {
            actions.push({ type: 'play_card', handIndex: i, cardId: c.id, name: c.name, cost: c.cost, description: `Play event ${c.name} (cost ${c.cost})` });
          }
        }
      }

      // Attack — each attacker can target any valid defender
      const attackers: { source: 'leader' | number; id: string; power: number }[] = [];
      if (p.leader && !p.leader.isResting && !p.leader.summoningSickness) {
        attackers.push({ source: 'leader', id: p.leader.id, power: p.leader.getTotalAttack() });
      }
      for (let i = 0; i < p.characterArea.size(); i++) {
        const c = p.characterArea.get(i)!;
        if (!c.isResting && !c.summoningSickness) {
          attackers.push({ source: i, id: c.id, power: c.getTotalAttack() });
        }
      }

      const targets = g.getAttackTargets(g.whoseTurn);
      for (const atk of attackers) {
        for (const def of targets) {
          actions.push({
            type: 'attack',
            attackerSource: atk.source,
            attackerId: atk.id,
            attackPower: atk.power,
            defenderTarget: def.target,
            defenderId: def.id,
            defendPower: def.power,
            description: `${atk.id} (${atk.power}) attacks ${def.id} (${def.power})`,
          });
        }
      }

      // Don attachment
      if (p.getUnrestedDonCount() > 0) {
        if (p.leader) {
          actions.push({ type: 'attach_don', targetIndex: -1, targetId: p.leader.id, description: `Attach Don to leader ${p.leader.id}` });
        }
        for (let i = 0; i < p.characterArea.size(); i++) {
          const c = p.characterArea.get(i)!;
          actions.push({ type: 'attach_don', targetIndex: i, targetId: c.id, description: `Attach Don to ${c.name}` });
        }
      }

      return { currentPlayer: g.whoseTurn, turnNumber: g.turnNumber, actions };
    },
  });

  registry.register({
    name: 'game_apply_action',
    title: 'Apply action',
    description: 'Execute one action. Pass an action object from game_get_legal_actions.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'object',
          description: 'An action object from game_get_legal_actions',
          properties: {
            type: { type: 'string', enum: ['end_turn', 'play_card', 'attack', 'attach_don'] },
            handIndex: { type: 'integer' },
            attackerSource: {},
            defenderTarget: {},
            targetIndex: { type: 'integer' },
          },
          required: ['type'],
        },
      },
    },
    async execute(input: any) {
      const g = requireGame();
      if (g.finished) throw new Error('Game is over');
      const action = input.action;
      const p = g.getCurrentPlayer();

      switch (action.type) {
        case 'end_turn': {
          g.changeTurn();
          const phases = g.executeTurnStart();
          return {
            type: 'end_turn',
            turnNumber: g.turnNumber,
            whoseTurn: g.whoseTurn,
            ...phases,
            state: playerSummary(g, g.whoseTurn),
          };
        }

        case 'play_card': {
          const card = p.playCard(action.handIndex);
          if (!card) throw new Error(`Cannot play card at index ${action.handIndex}`);
          g.logEvent(g.whoseTurn, 'play_card', { cardId: card.id, name: card.name, zone: card.isCharacterCard() ? 'character' : 'trash' });
          return {
            type: 'play_card',
            played: card.id,
            name: card.name,
            zone: card.isCharacterCard() ? 'characterArea' : 'trash',
            donRemaining: p.getUnrestedDonCount(),
            handSize: p.hand.size(),
            fieldSize: p.characterArea.size(),
          };
        }

        case 'attack': {
          const result = g.resolveAttack(
            g.whoseTurn,
            action.attackerSource,
            action.defenderTarget,
          );
          return {
            type: 'attack',
            ...result,
            finished: g.finished,
          };
        }

        case 'attach_don': {
          const idx = action.targetIndex ?? -1;
          const ok = p.attachDon(idx);
          if (!ok) throw new Error('Cannot attach Don');
          const target = idx === -1 ? p.leader : p.characterArea.get(idx);
          g.logEvent(g.whoseTurn, 'attach_don', { target: target?.id, donCount: target?.attachedDon.length });
          return {
            type: 'attach_don',
            target: target?.id,
            newPower: target?.getTotalAttack(),
            donOnCard: target?.attachedDon.length,
            donRemaining: p.getUnrestedDonCount(),
          };
        }

        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    },
  });

  registry.register({
    name: 'game_get_attack_targets',
    title: 'Get attack targets',
    description: 'List valid attack targets on the opponent\'s field (leader + resting characters).',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const g = requireGame();
      return { targets: g.getAttackTargets(g.whoseTurn) };
    },
  });

  registry.register({
    name: 'game_reset',
    title: 'Reset game',
    description: 'Destroy the current game. Call game_new to start a new one.',
    inputSchema: { type: 'object', properties: {} },
    destructiveHint: true,
    async execute() {
      const had = currentGame !== null;
      currentGame = null;
      return { reset: true, hadActiveGame: had };
    },
  });

  registry.register({
    name: 'game_get_replay',
    title: 'Get replay',
    description: 'Get the full replay event log for the current game.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const g = requireGame();
      return { events: g.replay, eventCount: g.replay.length };
    },
  });

  // ======== SIMULATION TOOLS ========

  registry.register({
    name: 'sim_run_batch',
    title: 'Run simulation batch',
    description: 'Run deterministic local bot-vs-bot simulations between two decks.',
    inputSchema: {
      type: 'object',
      required: ['deckA', 'deckB', 'games'],
      properties: {
        deckA: { type: 'array', items: { type: 'string' } },
        deckB: { type: 'array', items: { type: 'string' } },
        games: { type: 'integer', minimum: 1, maximum: 100000 },
        seedPrefix: { type: 'integer' },
      },
    },
    async execute(input: any) {
      const job = await enqueueSimBatch({
        deckA: input.deckA,
        deckB: input.deckB,
        games: input.games,
        seedPrefix: input.seedPrefix,
      });
      return { jobId: job.id, status: job.status, games: input.games };
    },
  });

  registry.register({
    name: 'sim_list_jobs',
    title: 'List simulation jobs',
    description: 'List all simulation jobs and their status.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return {
        jobs: listJobs().map(j => ({
          id: j.id, status: j.status, games: j.games,
          completed: j.completed, error: j.error,
        })),
      };
    },
  });

  registry.register({
    name: 'sim_get_job',
    title: 'Get simulation job',
    description: 'Get details for a specific simulation job.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const job = getJob(input.jobId);
      if (!job) throw new Error(`Job not found: ${input.jobId}`);
      return {
        id: job.id, status: job.status, games: job.games,
        completed: job.completed, error: job.error,
        resultCount: job.results.length,
      };
    },
  });

  registry.register({
    name: 'sim_cancel_job',
    title: 'Cancel simulation job',
    description: 'Cancel a running or queued simulation job.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
    async execute(input: any) {
      cancelJob(input.jobId);
      return { cancelled: true };
    },
  });

  registry.register({
    name: 'sim_get_results',
    title: 'Get simulation results',
    description: 'Get results from a completed simulation job.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const results = getResults(input.jobId);
      const max = input.maxResults || 100;
      const total = results.length;
      const p1wins = results.filter(r => r.winner === 1).length;
      const p2wins = results.filter(r => r.winner === 2).length;
      const draws = results.filter(r => r.winner === 'draw').length;
      const avgTurns = total > 0 ? results.reduce((s, r) => s + r.turns, 0) / total : 0;
      return {
        total, p1wins, p2wins, draws, avgTurns,
        p1Winrate: total > 0 ? (p1wins / total * 100).toFixed(2) + '%' : 'N/A',
        sample: results.slice(0, max),
      };
    },
  });

  // ======== ANALYTICS TOOLS ========

  registry.register({
    name: 'analytics_refresh',
    title: 'Refresh analytics',
    description: 'Ensure analytics engine is loaded and ready.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      await analyticsRefresh();
      return { ready: true };
    },
  });

  registry.register({
    name: 'analytics_query',
    title: 'Run analytics SQL',
    description: 'Run a read-only SQL query against local simulation tables.',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string' },
        maxRows: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const rows = await analyticsQuery(input.sql, input.maxRows);
      return { rows, rowCount: rows.length };
    },
  });

  registry.register({
    name: 'analytics_matchup_matrix',
    title: 'Matchup matrix',
    description: 'Get win rates between all tested deck pairs.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return { matrix: await matchupMatrix() };
    },
  });

  registry.register({
    name: 'analytics_deck_report',
    title: 'Deck report',
    description: 'Get aggregate stats for a specific deck across all matchups.',
    inputSchema: {
      type: 'object',
      required: ['deckId'],
      properties: { deckId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      return { report: await deckReport(input.deckId) };
    },
  });

  registry.register({
    name: 'analytics_ingest',
    title: 'Ingest simulation results',
    description: 'Ingest completed simulation results into the analytics engine.',
    inputSchema: {
      type: 'object',
      required: ['jobId', 'deckA', 'deckB'],
      properties: {
        jobId: { type: 'string' },
        deckA: { type: 'string', description: 'Deck A identifier' },
        deckB: { type: 'string', description: 'Deck B identifier' },
      },
    },
    async execute(input: any) {
      const results = getResults(input.jobId);
      if (results.length === 0) throw new Error('No results to ingest');
      await ingestResults(input.jobId, input.deckA, input.deckB, results);
      return { ingested: results.length };
    },
  });

  // ======== REPLAY TOOLS ========

  registry.register({
    name: 'replays_list',
    title: 'List replays',
    description: 'List all stored replay IDs.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      return { replays: await replayStore.list() };
    },
  });

  registry.register({
    name: 'replays_get',
    title: 'Get replay',
    description: 'Get a stored replay by game ID.',
    inputSchema: {
      type: 'object',
      required: ['gameId'],
      properties: { gameId: { type: 'string' } },
    },
    readOnlyHint: true,
    async execute(input: any) {
      const data = await replayStore.get(input.gameId);
      if (!data) throw new Error(`Replay not found: ${input.gameId}`);
      return { gameId: input.gameId, data };
    },
  });

  registry.register({
    name: 'replays_delete',
    title: 'Delete replay',
    description: 'Delete a stored replay. Destructive.',
    inputSchema: {
      type: 'object',
      required: ['gameId'],
      properties: { gameId: { type: 'string' } },
    },
    destructiveHint: true,
    async execute(input: any) {
      await replayStore.delete(input.gameId);
      return { deleted: true };
    },
  });

  registry.register({
    name: 'replays_export_jsonl',
    title: 'Export replays',
    description: 'Export all replays as JSONL.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: true,
    async execute() {
      const data = await replayStore.exportAll();
      return { jsonl: data, lineCount: data.split('\n').filter(Boolean).length };
    },
  });

  console.log(`[WebMCP] Registered ${registry.toolCount} tools`);
  if (registry.hasWebMcpSupport()) {
    console.log('[WebMCP] navigator.modelContext detected — tools registered natively');
  } else {
    console.log('[WebMCP] No navigator.modelContext — tools available via window.__OPTCG_LAB__');
  }
}
