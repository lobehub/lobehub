// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';
import { HeteroTraceRecorder } from '../HeteroTraceRecorder';

const finish = async (result: 'error' | 'success') => {
  const order: string[] = [];
  vi.spyOn(HeteroTraceRecorder.prototype, 'finalize').mockResolvedValue(undefined as any);
  const registerFileWorks = vi
    .spyOn(CompletionLifecycle.prototype, 'registerFileWorks')
    .mockImplementation(async (_operationId, state) => {
      order.push('works');
      state.metadata._fileWorksRegistered = true;
    });
  const dispatchHooks = vi
    .spyOn(CompletionLifecycle.prototype, 'dispatchHooks')
    .mockResolvedValue(undefined);
  const publishStreamEvent = vi.fn(async (_operationId: string, event: { type: string }) => {
    if (event.type === 'agent_runtime_end') order.push('end');
    return 'ok';
  });
  const service = new HeterogeneousAgentService({} as any, 'user-1', {
    agentOperationModel: { findById: vi.fn(async () => ({ metadata: {} })) } as any,
    persistenceHandler: { finish: vi.fn(async () => undefined) } as any,
    snapshotStore: null,
    streamEventManager: { publishStreamEvent } as any,
    topicModel: {
      settleRunningOperation: vi.fn(async () => ({
        assistantMessageId: 'asst-1',
        status: 'settled',
      })),
      updateMetadata: vi.fn(async () => undefined),
    } as any,
  });

  await service.heteroFinish({ agentType: 'codex', operationId: 'op-1', result, topicId: 'tpc-1' });

  return { dispatchHooks, order, registerFileWorks };
};

describe('HeterogeneousAgentService.heteroFinish — Works', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the run Works before publishing agent_runtime_end', async () => {
    const { order, registerFileWorks } = await finish('success');

    expect(order).toEqual(['works', 'end']);
    expect(registerFileWorks).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ assistantMessageId: 'asst-1' }),
        origin: expect.objectContaining({ topicId: 'tpc-1' }),
      }),
    );
  });

  it('tells the completion lifecycle the Works are registered so it does not scan again', async () => {
    const { dispatchHooks } = await finish('success');

    const [, state] = dispatchHooks.mock.calls[0] as [string, any];
    expect(state.metadata._fileWorksRegistered).toBe(true);
  });

  it('leaves a failed run to the completion lifecycle', async () => {
    const { order, registerFileWorks } = await finish('error');

    expect(registerFileWorks).not.toHaveBeenCalled();
    expect(order).toEqual(['end']);
  });
});
