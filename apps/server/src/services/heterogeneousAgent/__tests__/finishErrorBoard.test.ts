// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';

/**
 * The gateway files an errored run on its error board from the terminal
 * `agent_runtime_end` alone, so heteroFinish has to say what failed and whether
 * it belongs on the board.
 */
const finish = async (
  params: Pick<Parameters<HeterogeneousAgentService['heteroFinish']>[0], 'error' | 'result'>,
) => {
  vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockResolvedValue(undefined as any);
  const publishStreamEvent = vi.fn(async () => 'ok');
  const service = new HeterogeneousAgentService({} as any, 'user-1', {
    agentOperationModel: { findById: vi.fn(async () => ({ metadata: {} })) } as any,
    persistenceHandler: { finish: vi.fn(async () => undefined) } as any,
    snapshotStore: null,
    streamEventManager: { publishStreamEvent } as any,
    topicModel: {
      settleRunningOperation: vi.fn(async () => ({ status: 'settled' })),
      updateMetadata: vi.fn(async () => undefined),
    } as any,
    workspaceId: 'ws-1',
  });

  await service.heteroFinish({
    agentType: 'claude-code',
    operationId: 'op-1',
    topicId: 'tpc-1',
    ...params,
  });

  const [, event] = publishStreamEvent.mock.calls.at(-1) as unknown as [string, any];
  expect(event.type).toBe('agent_runtime_end');
  return event.data;
};

describe('HeterogeneousAgentService.heteroFinish — gateway error board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the user's own CLI session limit off the board", async () => {
    const data = await finish({
      error: {
        body: {
          code: 'rate_limit',
          error: "You've hit your session limit · resets 2:00am (Asia/Shanghai)",
        },
        message: "You've hit your session limit · resets 2:00am (Asia/Shanghai)",
        type: 'AgentRuntimeError',
      },
      result: 'error',
    });

    expect(data).toMatchObject({
      errorType: 'AgentRuntimeError',
      reason: 'error',
      reasonDetail: "You've hit your session limit · resets 2:00am (Asia/Shanghai)",
      recordError: false,
    });
  });

  it('files an unclassified CLI failure with its message', async () => {
    const data = await finish({
      error: { message: 'thread-store conflict', type: 'AgentRuntimeError' },
      result: 'error',
    });

    expect(data).toMatchObject({
      errorType: 'AgentRuntimeError',
      reasonDetail: 'thread-store conflict',
      recordError: true,
    });
  });

  it('adds no board fields to a successful run', async () => {
    const data = await finish({ result: 'success' });

    expect(data).not.toHaveProperty('recordError');
    expect(data).not.toHaveProperty('errorType');
  });
});
