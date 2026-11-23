// @vitest-environment node
import type {
  ExecutionSnapshot,
  ISnapshotStore,
  PartialSaveOptions,
  PartialSaveResult,
} from '@lobechat/agent-tracing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import type { HeterogeneousPersistenceHandler } from '..';
import { HeterogeneousAgentService } from '..';

vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: vi.fn(() => false),
}));

class MemorySnapshotStore implements ISnapshotStore {
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  saved = new Map<string, ExecutionSnapshot>();

  async loadPartial(operationId: string) {
    const p = this.partials.get(operationId);
    return p ? structuredClone(p) : null;
  }
  async savePartial(
    operationId: string,
    partial: Partial<ExecutionSnapshot>,
    _options?: PartialSaveOptions,
  ): Promise<PartialSaveResult | void> {
    this.partials.set(operationId, partial);
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save(snapshot: ExecutionSnapshot) {
    this.saved.set(snapshot.operationId, snapshot);
  }
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

const OP = 'op-cc-cumulative';
const TOPIC = 'topic-cc-cumulative';

const setup = (findPreviousCostedOnTopic: () => Promise<any>) => {
  const store = new MemorySnapshotStore();
  // One 1-step CC run whose client reported the session total ($139.60 for 470k
  // input tokens) rather than its own spend.
  store.partials.set(OP, {
    heteroSessionUsage: {
      totalCost: 139.6,
      totalInputTokens: 470_000,
      totalOutputTokens: 2000,
      totalTokens: 472_000,
    },
    provider: 'claude-code',
    steps: [],
  } as Partial<ExecutionSnapshot>);

  const agentOperationModel = {
    findById: vi.fn(async () => null),
    findPreviousCostedOnTopic: vi.fn(findPreviousCostedOnTopic),
    recordHeteroIngestRejection: vi.fn(async () => true),
    settleRunning: vi.fn(async () => true),
    touchRunning: vi.fn(async () => true),
  };
  const persistenceHandler = {
    finish: vi.fn(async () => {}),
  } as unknown as HeterogeneousPersistenceHandler;
  const topicModel = {
    settleRunningOperation: vi.fn(async (_topicId: string, operationId: string) => ({
      operationId,
      status: 'settled',
    })),
    updateMetadata: vi.fn(async () => undefined),
  };
  const service = new HeterogeneousAgentService({} as any, 'user-test', {
    agentOperationModel: agentOperationModel as any,
    persistenceHandler,
    snapshotStore: store,
    streamEventManager: { publishStreamEvent: vi.fn(async () => 'id') } as any,
    topicModel: topicModel as any,
  });
  const completeOperation = vi
    .spyOn(CompletionLifecycle.prototype, 'completeOperation')
    .mockResolvedValue(undefined);

  return { agentOperationModel, completeOperation, service, store };
};

const finish = (service: HeterogeneousAgentService, agentType: 'claude-code' | 'codex') =>
  service.heteroFinish({ agentType, operationId: OP, result: 'error', topicId: TOPIC });

describe('heteroFinish Claude Code session cost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('books only this run’s share of a legacy cumulative cost, in the op row and the snapshot', async () => {
    const { agentOperationModel, completeOperation, service, store } = setup(async () => ({
      reportedSessionTotal: null,
      totalCost: 137,
    }));

    await finish(service, 'claude-code');

    expect(agentOperationModel.findPreviousCostedOnTopic).toHaveBeenCalledWith({
      operationId: OP,
      provider: 'claude-code',
      topicId: TOPIC,
    });
    const [input] = completeOperation.mock.calls[0];
    expect(input.cost).toEqual({ reportedSessionTotal: 139.6, total: 2.6 });
    expect(store.saved.get(OP)?.totalCost).toBe(2.6);
  });

  it('compares against the previous op’s raw report when it was already de-cumulated', async () => {
    const { completeOperation, service } = setup(async () => ({
      reportedSessionTotal: 139,
      totalCost: 1.2,
    }));

    await finish(service, 'claude-code');

    expect(completeOperation.mock.calls[0][0].cost).toEqual({
      reportedSessionTotal: 139.6,
      total: 0.6,
    });
  });

  it('keeps the reported cost when the previous-op lookup fails', async () => {
    const { completeOperation, service, store } = setup(async () => {
      throw new Error('db down');
    });

    await finish(service, 'claude-code');

    expect(completeOperation.mock.calls[0][0].cost).toEqual({ total: 139.6 });
    expect(store.saved.get(OP)?.totalCost).toBe(139.6);
  });

  it('does not look up or rewrite cost for other agents', async () => {
    const { agentOperationModel, completeOperation, service } = setup(async () => ({
      reportedSessionTotal: null,
      totalCost: 137,
    }));

    await finish(service, 'codex');

    expect(agentOperationModel.findPreviousCostedOnTopic).not.toHaveBeenCalled();
    expect(completeOperation.mock.calls[0][0].cost).toEqual({ total: 139.6 });
  });
});
