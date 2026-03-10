import fs from 'node:fs/promises';
import path from 'node:path';

import type { ExecutionSnapshot, SnapshotSummary } from '../types';
import type { ISnapshotStore } from './types';

const DEFAULT_DIR = '.agent-tracing';
const PARTIAL_DIR = '_partial';

export class FileSnapshotStore implements ISnapshotStore {
  private dir: string;

  constructor(rootDir?: string) {
    this.dir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR);
  }

  // ==================== Completed snapshots ====================

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });

    const ts = new Date(snapshot.startedAt).toISOString().replaceAll(':', '-');
    const shortId = snapshot.traceId.slice(0, 12);
    const filename = `${ts}_${shortId}.json`;
    const filePath = path.join(this.dir, filename);

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

    // Update latest symlink
    const latestPath = path.join(this.dir, 'latest.json');
    try {
      await fs.unlink(latestPath);
    } catch {
      // ignore if doesn't exist
    }
    await fs.symlink(filename, latestPath);
  }

  async get(traceId: string): Promise<ExecutionSnapshot | null> {
    if (traceId === 'latest') return this.getLatest();

    // Search completed snapshots first
    const files = await this.listFiles();
    const match = files.find((f) => f.includes(traceId.slice(0, 12)));
    if (match) {
      const content = await fs.readFile(path.join(this.dir, match), 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    }

    // Fallback to partials
    const partial = await this.getPartial(traceId);
    if (partial) return partialToSnapshot(partial);

    return null;
  }

  async list(options?: { limit?: number }): Promise<SnapshotSummary[]> {
    const files = await this.listFiles();
    const limit = options?.limit ?? 10;
    const recent = files.slice(0, limit);

    const summaries: SnapshotSummary[] = [];

    for (const file of recent) {
      try {
        const content = await fs.readFile(path.join(this.dir, file), 'utf8');
        const snapshot = JSON.parse(content) as ExecutionSnapshot;
        summaries.push(toSummary(snapshot));
      } catch {
        // skip corrupted files
      }
    }

    return summaries;
  }

  async getLatest(): Promise<ExecutionSnapshot | null> {
    const latestPath = path.join(this.dir, 'latest.json');
    try {
      const realPath = await fs.realpath(latestPath);
      const content = await fs.readFile(realPath, 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    } catch {
      // No latest symlink — fall back to most recent by filename
      const files = await this.listFiles();
      if (files.length === 0) return null;

      const content = await fs.readFile(path.join(this.dir, files[0]), 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    }
  }

  // ==================== Partial snapshots ====================

  private partialDir(): string {
    return path.join(this.dir, PARTIAL_DIR);
  }

  private partialPath(operationId: string): string {
    const safe = operationId.replaceAll('/', '_');
    return path.join(this.partialDir(), `${safe}.json`);
  }

  async listPartials(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.partialDir());
      return entries
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async getPartial(idOrFilename: string): Promise<Partial<ExecutionSnapshot> | null> {
    // Try exact filename first
    try {
      const filePath = idOrFilename.endsWith('.json')
        ? path.join(this.partialDir(), idOrFilename)
        : this.partialPath(idOrFilename);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      // Fall back to substring match
      const files = await this.listPartials();
      const match = files.find((f) => f.includes(idOrFilename));
      if (!match) return null;
      const content = await fs.readFile(path.join(this.partialDir(), match), 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    }
  }

  async loadPartial(operationId: string): Promise<Partial<ExecutionSnapshot> | null> {
    try {
      const content = await fs.readFile(this.partialPath(operationId), 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      return null;
    }
  }

  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>): Promise<void> {
    await fs.mkdir(this.partialDir(), { recursive: true });
    await fs.writeFile(this.partialPath(operationId), JSON.stringify(partial), 'utf8');
  }

  async removePartial(operationId: string): Promise<void> {
    try {
      await fs.unlink(this.partialPath(operationId));
    } catch {
      // ignore
    }
  }

  // ==================== Internal ====================

  private async listFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .sort()
        .reverse(); // newest first (ISO timestamp prefix)
    } catch {
      return [];
    }
  }
}

function partialToSnapshot(partial: Partial<ExecutionSnapshot>): ExecutionSnapshot {
  return {
    completedAt: undefined,
    completionReason: undefined,
    error: undefined,
    model: partial.model,
    operationId: partial.operationId ?? '?',
    provider: partial.provider,
    startedAt: partial.startedAt ?? Date.now(),
    steps: partial.steps ?? [],
    totalCost: partial.totalCost ?? 0,
    totalSteps: partial.steps?.length ?? 0,
    totalTokens: partial.totalTokens ?? 0,
    traceId: partial.traceId ?? '?',
    ...partial,
  } as ExecutionSnapshot;
}

function toSummary(snapshot: ExecutionSnapshot): SnapshotSummary {
  return {
    completionReason: snapshot.completionReason,
    createdAt: snapshot.startedAt,
    durationMs: (snapshot.completedAt ?? Date.now()) - snapshot.startedAt,
    hasError: !!snapshot.error,
    model: snapshot.model,
    operationId: snapshot.operationId,
    totalSteps: snapshot.totalSteps,
    totalTokens: snapshot.totalTokens,
    traceId: snapshot.traceId,
  };
}
