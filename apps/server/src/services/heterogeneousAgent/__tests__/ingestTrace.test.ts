// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type {
  ExecutionSnapshot,
  ISnapshotStore,
  PartialSaveOptions,
  PartialSaveResult,
} from '@lobechat/agent-tracing';
import { describe, expect, it, vi } from 'vitest';

import type { HeterogeneousPersistenceHandler } from '..';
import { HeterogeneousAgentService } from '..';

/** In-memory partial store; `gate` holds a write open until the test releases it. */
class MemorySnapshotStore implements ISnapshotStore {
  gate?: Promise<void>;
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  writes = 0;

  async loadPartial(operationId: string) {
    const partial = this.partials.get(operationId);
    return partial ? structuredClone(partial) : null;
  }
  async savePartial(
    operationId: string,
    partial: Partial<ExecutionSnapshot>,
    _options?: PartialSaveOptions,
  ): Promise<PartialSaveResult | void> {
    this.writes += 1;
    await this.gate;
    this.partials.set(operationId, structuredClone(partial));
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save() {}
  async get() {
    return null;
  }
  async getLatest() {
    return null;
  }
  async list() {
    return [];
  }
  async listPartials() {
    return [...this.partials.keys()];
  }
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const event = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown> = {},
): AgentStreamEvent => ({
  data,
  operationId: 'op-trace',
  stepIndex,
  timestamp: 1_700_000_000_000 + stepIndex,
  type,
});

const createService = (options: {
  persist?: () => Promise<void>;
  publish?: (event: any) => Promise<void>;
  touchRunning?: () => Promise<boolean>;
}) => {
  const store = new MemorySnapshotStore();
  const publishedKeys = new Set<string>();
  const key = (e: AgentStreamEvent) => `${e.stepIndex}:${e.type}:${e.timestamp}`;
  const persistenceHandler = {
    filterUnpublishedEvents: (_op: string, events: AgentStreamEvent[]) =>
      events.filter((e) => !publishedKeys.has(key(e))),
    ingest: vi.fn(async () => options.persist?.()),
    markEventPublished: (_op: string, e: AgentStreamEvent) => publishedKeys.add(key(e)),
    publishData: (_op: string, e: AgentStreamEvent) => e.data,
  } as unknown as HeterogeneousPersistenceHandler;
  const published: any[] = [];
  const service = new HeterogeneousAgentService({} as any, 'user-test', {
    agentOperationModel: {
      recordHeteroIngestRejection: vi.fn(async () => true),
      touchRunning: vi.fn(options.touchRunning ?? (async () => true)),
    } as any,
    persistenceHandler,
    snapshotStore: store,
    streamEventManager: {
      publishStreamEvent: vi.fn(async (_op: string, e: any) => {
        await options.publish?.(e);
        published.push(e);
        return `id-${published.length}`;
      }),
    } as any,
  });
  const ingest = (events: AgentStreamEvent[]) =>
    service.heteroIngest({
      agentType: 'claude-code',
      events,
      operationId: 'op-trace',
      topicId: 'topic-1',
    });
  return { ingest, persistenceHandler, published, store };
};

const stepContent = (store: MemorySnapshotStore) =>
  store.partials.get('op-trace')?.steps?.map((step) => step.content);

describe('HeterogeneousAgentService.heteroIngest — execution trace', () => {
  it('writes the trace while the batch is persisted, and answers once it is written', async () => {
    // Regression: the trace write ran after persistence and publishing, and
    // the device waits for this answer before sending its next batch, so its
    // R2 round trip (~0.7s) delayed every later event of the run.
    const persisted = deferred();
    const written = deferred();
    const { ingest, store } = createService({ persist: () => persisted.promise });
    store.gate = written.promise;

    let answered = false;
    const ingesting = ingest([event('stream_chunk', 0, { chunkType: 'text', content: 'hi' })]);
    void ingesting.then(() => (answered = true));
    await vi.waitFor(() => expect(store.writes).toBe(1));

    persisted.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);

    written.resolve();
    await expect(ingesting).resolves.toEqual({ accepted: true });
    expect(stepContent(store)).toEqual(['hi']);
  });

  it('folds a batch redelivered after a lost answer only once', async () => {
    const { ingest, published, store } = createService({});
    const events = [
      event('stream_chunk', 0, { chunkType: 'text', content: 'hi' }),
      event('tool_start', 1, { toolCallId: 'tc-1' }),
    ];

    await ingest(events);
    await ingest(events);

    expect(published).toHaveLength(2);
    expect(stepContent(store)).toEqual(['hi', undefined]);
  });

  it('folds a batch whose first attempt failed to publish only once', async () => {
    let failSecondPublish = true;
    const { ingest, published, store } = createService({
      publish: async () => {
        if (failSecondPublish && published.length === 1) {
          failSecondPublish = false;
          throw new Error('redis down');
        }
      },
    });
    const events = [
      event('stream_start', 0),
      event('stream_chunk', 0, { chunkType: 'text', content: 'hello' }),
    ];

    await expect(ingest(events)).rejects.toThrow('redis down');
    await ingest(events);

    expect(published.map((e) => e.type)).toEqual(['stream_start', 'stream_chunk']);
    expect(stepContent(store)).toEqual(['hello']);
  });

  it('records nothing for a batch the server refuses up front', async () => {
    const { ingest, persistenceHandler, store } = createService({
      touchRunning: async () => false,
    });

    await expect(
      ingest([event('stream_chunk', 0, { chunkType: 'text', content: 'late' })]),
    ).resolves.toMatchObject({ accepted: false });

    expect(persistenceHandler.ingest).not.toHaveBeenCalled();
    expect(store.writes).toBe(0);
  });
});
