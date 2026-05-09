// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbandonOperationService } from '../AbandonOperationService';

const buildStore = () => ({
  get: vi.fn(),
  getLatest: vi.fn(),
  list: vi.fn(),
  listPartials: vi.fn(),
  loadPartial: vi.fn(),
  removePartial: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  savePartial: vi.fn().mockResolvedValue(undefined),
});

const buildCoordinator = (
  overrides: Partial<{
    loadAgentState: ReturnType<typeof vi.fn>;
    deleteAgentOperation: ReturnType<typeof vi.fn>;
  }> = {},
) => ({
  loadAgentState: vi.fn(),
  deleteAgentOperation: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const messageUpdateMock = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({ update: messageUpdateMock })),
}));

const stateWith = (overrides: Record<string, any> = {}) => ({
  cost: { total: 0.1 },
  metadata: {
    agentId: 'agt_x',
    assistantMessageId: 'msg_assist_1',
    topicId: 'tpc_x',
    userId: 'user_x',
  },
  status: 'running',
  stepCount: 5,
  usage: { llm: { tokens: { total: 1000 } } },
  ...overrides,
});

describe('AbandonOperationService', () => {
  beforeEach(() => {
    messageUpdateMock.mockClear();
  });

  it('returns found:false when coordinator has no state', async () => {
    const coord = buildCoordinator({ loadAgentState: vi.fn().mockResolvedValue(null) });
    const store = buildStore();
    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_missing', 'inactivity_5m');

    expect(result).toEqual({
      assistantMessageUpdated: false,
      finalized: false,
      found: false,
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('finalizes snapshot and marks assistant message errored when state + partial exist', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
      startedAt: 1_777_991_958_128,
      steps: [
        { stepIndex: 0, stepType: 'call_llm' },
        { stepIndex: 1, stepType: 'call_tool' },
      ],
    });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'inactivity_5m');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(true);

    // Final snapshot saved
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved = store.save.mock.calls[0][0];
    expect(saved.operationId).toBe('op_x');
    expect(saved.error?.type).toBe('AgentRuntimeError');
    expect(saved.error?.message).toContain('inactivity_5m');
    expect(saved.completionReason).toBe('error');
    // failedStep synthesized at lastIndex+1
    expect(saved.steps).toHaveLength(3);
    const synth = saved.steps[2];
    expect(synth.stepIndex).toBe(2);
    expect(synth.events?.[0]?.type).toBe('error');

    // Partial cleaned up
    expect(store.removePartial).toHaveBeenCalledWith('op_x');

    // Assistant message updated
    expect(messageUpdateMock).toHaveBeenCalledWith('msg_assist_1', {
      error: expect.objectContaining({
        message: expect.stringContaining('inactivity_5m'),
        type: 'AgentRuntimeError',
      }),
    });

    // Coordinator state cleaned
    expect(coord.deleteAgentOperation).toHaveBeenCalledWith('op_x');
  });

  it('skips snapshot finalize when no partial exists but still updates message', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue(null);

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'inactivity_5m');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(false); // partial was missing
    expect(result.assistantMessageUpdated).toBe(true);
    expect(store.save).not.toHaveBeenCalled();
    expect(messageUpdateMock).toHaveBeenCalled();
  });

  it('synthesizes failedStep at index 0 when partial has zero steps', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [], startedAt: 1 });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    await svc.finalizeAbandoned('op_x', 'reason');

    const saved = store.save.mock.calls[0][0];
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0].stepIndex).toBe(0);
  });

  it('does not crash when state has no metadata.assistantMessageId', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith({ metadata: { userId: 'user_x' } })),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [{ stepIndex: 0 }], startedAt: 1 });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'reason');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(false);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('treats non-fatal errors during message update / coordinator cleanup as best-effort', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
      deleteAgentOperation: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [{ stepIndex: 0 }], startedAt: 1 });
    messageUpdateMock.mockRejectedValueOnce(new Error('db down'));

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    // Should not throw — both failure paths are caught & logged
    const result = await svc.finalizeAbandoned('op_x', 'reason');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(false);
  });
});
