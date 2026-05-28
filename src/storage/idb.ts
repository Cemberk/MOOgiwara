/**
 * IndexedDB storage for decks, job metadata, and app settings.
 * Uses a single database with multiple object stores.
 */

const DB_NAME = 'optcg-lab';
const DB_VERSION = 1;

export interface DeckRecord {
  id: string;
  name: string;
  leaderId: string;
  cards: Record<string, number>; // cardId → count
  createdAt: number;
  updatedAt: number;
}

export interface JobRecord {
  id: string;
  type: 'sim_batch';
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  key: string;
  value: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) {
        db.createObjectStore('decks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const txn = db.transaction(storeName, mode);
        const store = txn.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function txAll<T>(
  storeName: string,
  fn: (store: IDBObjectStore) => IDBRequest<T[]>,
): Promise<T[]> {
  return openDb().then(
    db =>
      new Promise<T[]>((resolve, reject) => {
        const txn = db.transaction(storeName, 'readonly');
        const store = txn.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---- Deck Store ----

export const deckStore = {
  async list(): Promise<DeckRecord[]> {
    return txAll('decks', store => store.getAll());
  },

  async get(id: string): Promise<DeckRecord | undefined> {
    return tx('decks', 'readonly', store => store.get(id));
  },

  async create(deck: Omit<DeckRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<DeckRecord> {
    const record: DeckRecord = {
      ...deck,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await tx('decks', 'readwrite', store => store.put(record));
    return record;
  },

  async update(id: string, changes: Partial<DeckRecord>): Promise<DeckRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...changes, id, updatedAt: Date.now() };
    await tx('decks', 'readwrite', store => store.put(updated));
    return updated;
  },

  async delete(id: string): Promise<void> {
    await tx('decks', 'readwrite', store => store.delete(id));
  },

  async clear(): Promise<void> {
    await tx('decks', 'readwrite', store => store.clear());
  },
};

// ---- Job Store ----

export const jobStore = {
  async list(): Promise<JobRecord[]> {
    return txAll('jobs', store => store.getAll());
  },

  async get(id: string): Promise<JobRecord | undefined> {
    return tx('jobs', 'readonly', store => store.get(id));
  },

  async create(job: Omit<JobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<JobRecord> {
    const record: JobRecord = {
      ...job,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await tx('jobs', 'readwrite', store => store.put(record));
    return record;
  },

  async update(id: string, changes: Partial<JobRecord>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    await tx('jobs', 'readwrite', store =>
      store.put({ ...existing, ...changes, id, updatedAt: Date.now() }),
    );
  },

  async clear(): Promise<void> {
    await tx('jobs', 'readwrite', store => store.clear());
  },
};

// ---- Settings Store ----

export const settingsStore = {
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const record = await tx<AppSettings | undefined>(
      'settings',
      'readonly',
      store => store.get(key),
    );
    return record?.value as T | undefined;
  },

  async set(key: string, value: unknown): Promise<void> {
    await tx('settings', 'readwrite', store => store.put({ key, value }));
  },

  async delete(key: string): Promise<void> {
    await tx('settings', 'readwrite', store => store.delete(key));
  },
};
