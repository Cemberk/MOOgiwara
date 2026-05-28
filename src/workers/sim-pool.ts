/**
 * Manages simulation Web Workers from the main thread.
 * Provides job queue, progress tracking, and cancellation.
 */
import type {
  SimBatchRequest,
  SimGameResult,
  WorkerOutMessage,
} from './sim-protocol';
import { jobStore } from '../storage/idb';

export interface SimJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  deckA: string[];
  deckB: string[];
  games: number;
  completed: number;
  results: SimGameResult[];
  error?: string;
}

const jobs = new Map<string, SimJob>();
let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (e) => console.error('Sim worker error:', e);
  }
  return worker;
}

function handleWorkerMessage(e: MessageEvent<WorkerOutMessage>): void {
  const msg = e.data;

  switch (msg.type) {
    case 'progress': {
      const job = jobs.get(msg.jobId);
      if (job) {
        job.completed = msg.completed;
        job.status = 'running';
      }
      break;
    }
    case 'result': {
      const job = jobs.get(msg.jobId);
      if (job) {
        job.results = msg.results;
        job.status = 'completed';
        job.completed = job.games;
        jobStore.update(job.id, { status: 'completed', result: summarize(msg.results) });
      }
      break;
    }
    case 'error': {
      const job = jobs.get(msg.jobId);
      if (job) {
        job.status = 'error';
        job.error = msg.error;
        jobStore.update(job.id, { status: 'error' });
      }
      break;
    }
  }
}

function summarize(results: SimGameResult[]): Record<string, unknown> {
  const total = results.length;
  const p1wins = results.filter(r => r.winner === 1).length;
  const p2wins = results.filter(r => r.winner === 2).length;
  const draws = results.filter(r => r.winner === 'draw').length;
  const avgTurns = results.reduce((s, r) => s + r.turns, 0) / total;
  const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / total;
  return { total, p1wins, p2wins, draws, avgTurns, avgMs };
}

export async function enqueueSimBatch(params: {
  deckA: string[];
  deckB: string[];
  games: number;
  botA?: string;
  botB?: string;
  seedPrefix?: number;
}): Promise<SimJob> {
  const id = crypto.randomUUID();
  const job: SimJob = {
    id,
    status: 'queued',
    deckA: params.deckA,
    deckB: params.deckB,
    games: params.games,
    completed: 0,
    results: [],
  };
  jobs.set(id, job);

  await jobStore.create({
    type: 'sim_batch',
    status: 'queued',
    params: {
      deckA: params.deckA,
      deckB: params.deckB,
      games: params.games,
    },
  });

  const msg: SimBatchRequest = {
    type: 'run_batch',
    jobId: id,
    deckA: params.deckA,
    deckB: params.deckB,
    games: params.games,
    botA: params.botA ?? 'heuristic-v1',
    botB: params.botB ?? 'heuristic-v1',
    seedPrefix: params.seedPrefix ?? Date.now(),
  };

  getWorker().postMessage(msg);
  job.status = 'running';
  return job;
}

export function cancelJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (job && (job.status === 'queued' || job.status === 'running')) {
    job.status = 'cancelled';
    getWorker().postMessage({ type: 'cancel', jobId });
    jobStore.update(jobId, { status: 'cancelled' });
  }
}

export function getJob(jobId: string): SimJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(): SimJob[] {
  return [...jobs.values()];
}

export function getResults(jobId: string): SimGameResult[] {
  return jobs.get(jobId)?.results ?? [];
}
