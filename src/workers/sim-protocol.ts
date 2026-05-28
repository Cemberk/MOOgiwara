/**
 * Message protocol between the main thread and simulation Web Worker.
 */

export interface SimBatchRequest {
  type: 'run_batch';
  jobId: string;
  deckA: string[];
  deckB: string[];
  games: number;
  botA: string;
  botB: string;
  seedPrefix: number;
}

export interface SimProgressMessage {
  type: 'progress';
  jobId: string;
  completed: number;
  total: number;
}

export interface SimResultMessage {
  type: 'result';
  jobId: string;
  results: SimGameResult[];
}

export interface SimErrorMessage {
  type: 'error';
  jobId: string;
  error: string;
}

export interface SimCancelRequest {
  type: 'cancel';
  jobId: string;
}

export interface SimGameResult {
  gameIndex: number;
  seed: number;
  winner: 1 | 2 | 'draw';
  turns: number;
  durationMs: number;
}

export type WorkerInMessage = SimBatchRequest | SimCancelRequest;
export type WorkerOutMessage = SimProgressMessage | SimResultMessage | SimErrorMessage;
