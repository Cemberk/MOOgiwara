/**
 * DuckDB-Wasm analytics engine.
 *
 * Loads DuckDB-Wasm lazily (only when first analytics query runs).
 * Ingests simulation results into in-memory tables for SQL queries.
 *
 * Starts in single-threaded mode (no SharedArrayBuffer required)
 * to stay compatible with GitHub Pages without COOP/COEP headers.
 */

let duckdb: any = null;
let db: any = null;
let conn: any = null;

/** Lazy-load DuckDB-Wasm from CDN */
async function ensureDb(): Promise<any> {
  if (conn) return conn;

  // Dynamic import from CDN — keeps the bundle small
  const duck = await import(
    /* @vite-ignore */
    // @ts-ignore CDN module has no type declarations
    'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm'
  );
  duckdb = duck;

  const JSDELIVR_BUNDLES = {
    mvp: {
      mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-mvp.wasm',
      mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-eh.wasm',
      mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-eh.worker.js',
    },
  };

  const bundle = await duck.selectBundle(JSDELIVR_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duck.ConsoleLogger();
  db = new duck.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();

  // Create the results table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sim_results (
      game_index INTEGER,
      seed BIGINT,
      winner VARCHAR,
      turns INTEGER,
      duration_ms DOUBLE,
      job_id VARCHAR,
      deck_a VARCHAR,
      deck_b VARCHAR
    )
  `);

  return conn;
}

export interface SimResultRow {
  gameIndex: number;
  seed: number;
  winner: 1 | 2 | 'draw';
  turns: number;
  durationMs: number;
}

/** Ingest simulation results into the analytics table */
export async function ingestResults(
  jobId: string,
  deckA: string,
  deckB: string,
  results: SimResultRow[],
): Promise<void> {
  const c = await ensureDb();

  // Build INSERT VALUES batch
  const values = results
    .map(
      r =>
        `(${r.gameIndex}, ${r.seed}, '${r.winner}', ${r.turns}, ${r.durationMs}, '${jobId}', '${deckA}', '${deckB}')`,
    )
    .join(',\n');

  await c.query(`
    INSERT INTO sim_results (game_index, seed, winner, turns, duration_ms, job_id, deck_a, deck_b)
    VALUES ${values}
  `);
}

/** Run a read-only SQL query and return rows as objects */
export async function query(
  sql: string,
  maxRows = 100,
): Promise<Record<string, unknown>[]> {
  assertReadOnly(sql);
  const c = await ensureDb();
  const result = await c.query(`${sql} LIMIT ${maxRows}`);
  return result.toArray().map((row: any) => row.toJSON());
}

/** Matchup matrix: win rates between deck pairs */
export async function matchupMatrix(): Promise<Record<string, unknown>[]> {
  return query(`
    SELECT
      deck_a,
      deck_b,
      COUNT(*) as games,
      SUM(CASE WHEN winner = '1' THEN 1 ELSE 0 END) as deck_a_wins,
      SUM(CASE WHEN winner = '2' THEN 1 ELSE 0 END) as deck_b_wins,
      SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) as draws,
      ROUND(SUM(CASE WHEN winner = '1' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as deck_a_winrate,
      AVG(turns) as avg_turns
    FROM sim_results
    GROUP BY deck_a, deck_b
    ORDER BY games DESC
  `, 1000);
}

/** Deck report: stats for a specific deck across all matchups */
export async function deckReport(deckId: string): Promise<Record<string, unknown>[]> {
  return query(`
    SELECT
      CASE WHEN deck_a = '${deckId}' THEN deck_b ELSE deck_a END as opponent,
      COUNT(*) as games,
      SUM(CASE
        WHEN (deck_a = '${deckId}' AND winner = '1') OR (deck_b = '${deckId}' AND winner = '2')
        THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE
        WHEN (deck_a = '${deckId}' AND winner = '1') OR (deck_b = '${deckId}' AND winner = '2')
        THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as winrate,
      AVG(turns) as avg_turns
    FROM sim_results
    WHERE deck_a = '${deckId}' OR deck_b = '${deckId}'
    GROUP BY opponent
    ORDER BY games DESC
  `, 1000);
}

/** Refresh: currently a no-op (data is already in-memory) */
export async function refresh(): Promise<void> {
  await ensureDb();
}

/** Check that SQL is read-only */
function assertReadOnly(sql: string): void {
  const upper = sql.trim().toUpperCase();
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE'];
  for (const kw of forbidden) {
    if (upper.startsWith(kw)) {
      throw new Error(`Query must be read-only. Cannot start with ${kw}`);
    }
  }
}
