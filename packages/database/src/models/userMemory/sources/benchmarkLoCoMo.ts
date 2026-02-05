import { createNanoId } from '../../../utils/idGenerator';
import type { UserMemorySource } from './shared';

export interface BenchmarkLoCoMoPart {
  content: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
  partIndex: number;
  sessionId?: string;
  speaker?: string;
}

export interface UpsertBenchmarkLoCoMoParams {
  id?: string;
  metadata?: Record<string, unknown>;
  sampleId?: string;
  sourceType: string;
}

export class UserMemorySourceBenchmarkLoCoMoModel {
  private static readonly sources = new Map<string, Map<string, UserMemorySource>>();
  private static readonly parts = new Map<string, Map<string, BenchmarkLoCoMoPart[]>>();
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private getSourceStore() {
    if (!UserMemorySourceBenchmarkLoCoMoModel.sources.has(this.userId)) {
      UserMemorySourceBenchmarkLoCoMoModel.sources.set(this.userId, new Map());
    }

    return UserMemorySourceBenchmarkLoCoMoModel.sources.get(this.userId)!;
  }

  private getPartStore() {
    if (!UserMemorySourceBenchmarkLoCoMoModel.parts.has(this.userId)) {
      UserMemorySourceBenchmarkLoCoMoModel.parts.set(this.userId, new Map());
    }

    return UserMemorySourceBenchmarkLoCoMoModel.parts.get(this.userId)!;
  }

  async upsertSource(params: UpsertBenchmarkLoCoMoParams) {
    const id = params.id ?? createNanoId(16)();
    const now = new Date();
    const store = this.getSourceStore();
    const existing = store.get(id);

    const record: UserMemorySource = {
      createdAt: existing?.createdAt ?? now,
      id,
      metadata: params.metadata,
      sampleId: params.sampleId,
      sourceType: params.sourceType,
      updatedAt: now,
      userId: this.userId,
    };

    store.set(id, record);

    return { id };
  }

  replaceParts(sourceId: string, parts: BenchmarkLoCoMoPart[]) {
    const store = this.getPartStore();
    store.delete(sourceId);
    if (!parts.length) return;

    const normalized = parts.map((part) => ({
      ...part,
      createdAt: part.createdAt ?? new Date(),
    }));

    store.set(sourceId, normalized);
  }

  async listParts(sourceId: string) {
    const store = this.getPartStore();
    const parts = store.get(sourceId) ?? [];

    return [...parts]
      .map((part) => ({ ...part }))
      .sort((a, b) => {
        if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;

        return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      });
  }
}
