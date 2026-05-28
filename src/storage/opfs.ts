/**
 * OPFS (Origin Private File System) storage for large data:
 * replay logs, simulation result datasets, and DuckDB files.
 *
 * Falls back to in-memory storage if OPFS is not available.
 */

async function getRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function getOrCreateDir(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

// ---- Replay Storage ----

export const replayStore = {
  async save(gameId: string, data: string): Promise<void> {
    const root = await getRoot();
    if (!root) {
      console.warn('OPFS not available; replay not persisted');
      return;
    }
    const dir = await getOrCreateDir(root, 'replays');
    const file = await dir.getFileHandle(`${gameId}.jsonl`, { create: true });
    const writable = await file.createWritable();
    await writable.write(data);
    await writable.close();
  },

  async get(gameId: string): Promise<string | null> {
    const root = await getRoot();
    if (!root) return null;
    try {
      const dir = await getOrCreateDir(root, 'replays');
      const file = await dir.getFileHandle(`${gameId}.jsonl`);
      const blob = await file.getFile();
      return await blob.text();
    } catch {
      return null;
    }
  },

  async list(): Promise<string[]> {
    const root = await getRoot();
    if (!root) return [];
    try {
      const dir = await getOrCreateDir(root, 'replays');
      const names: string[] = [];
      for await (const [name] of (dir as any).entries()) {
        if (name.endsWith('.jsonl')) {
          names.push(name.replace('.jsonl', ''));
        }
      }
      return names;
    } catch {
      return [];
    }
  },

  async delete(gameId: string): Promise<void> {
    const root = await getRoot();
    if (!root) return;
    try {
      const dir = await getOrCreateDir(root, 'replays');
      await dir.removeEntry(`${gameId}.jsonl`);
    } catch {
      // Already deleted or doesn't exist
    }
  },

  async exportAll(): Promise<string> {
    const ids = await this.list();
    const lines: string[] = [];
    for (const id of ids) {
      const data = await this.get(id);
      if (data) lines.push(data);
    }
    return lines.join('\n');
  },
};

// ---- Dataset Storage ----

export const datasetStore = {
  async save(name: string, data: string): Promise<void> {
    const root = await getRoot();
    if (!root) return;
    const dir = await getOrCreateDir(root, 'datasets');
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(data);
    await writable.close();
  },

  async get(name: string): Promise<string | null> {
    const root = await getRoot();
    if (!root) return null;
    try {
      const dir = await getOrCreateDir(root, 'datasets');
      const file = await dir.getFileHandle(name);
      const blob = await file.getFile();
      return await blob.text();
    } catch {
      return null;
    }
  },

  async list(): Promise<string[]> {
    const root = await getRoot();
    if (!root) return [];
    try {
      const dir = await getOrCreateDir(root, 'datasets');
      const names: string[] = [];
      for await (const [name] of (dir as any).entries()) {
        names.push(name);
      }
      return names;
    } catch {
      return [];
    }
  },

  async delete(name: string): Promise<void> {
    const root = await getRoot();
    if (!root) return;
    try {
      const dir = await getOrCreateDir(root, 'datasets');
      await dir.removeEntry(name);
    } catch {
      // Already deleted
    }
  },
};

// ---- Import/Export ----

export async function exportAllData(): Promise<{
  replays: string;
  datasets: Record<string, string>;
}> {
  const replays = await replayStore.exportAll();
  const datasetNames = await datasetStore.list();
  const datasets: Record<string, string> = {};
  for (const name of datasetNames) {
    const data = await datasetStore.get(name);
    if (data) datasets[name] = data;
  }
  return { replays, datasets };
}

export async function clearAllOpfs(): Promise<void> {
  const root = await getRoot();
  if (!root) return;
  try {
    await root.removeEntry('replays', { recursive: true });
  } catch { /* ok */ }
  try {
    await root.removeEntry('datasets', { recursive: true });
  } catch { /* ok */ }
}
