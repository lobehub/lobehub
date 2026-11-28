/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '..';
import { setUpService } from './testUtils';

vi.mock('@lobechat/model-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

const { ssrfSafeFetch: mockSsrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', (...args) =>
  import('./testUtils').then((m) => (m.libsTrustedClientModule as (...a: any[]) => any)(...args)),
);

// Mock database and models
vi.mock('@/server/services/file', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesFileModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/message', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsMessageModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/database/models/agent', (...args) =>
  import('./testUtils').then((m) => (m.databaseModelsAgentModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/plugin', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsPluginModule as (...a: any[]) => any)(...args),
  ),
);

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverServicesSearchModule as (...a: any[]) => any)(...args),
  ),
);

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeFactoryModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/redis', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeRedisModule as (...a: any[]) => any)(...args),
  ),
);

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
vi.mock('@lobechat/agent-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/queue', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesQueueModule as (...a: any[]) => any)(...args)),
);

// Mock Mecha module
vi.mock('@/server/modules/Mecha', (...args) =>
  import('./testUtils').then((m) => (m.serverModulesMechaModule as (...a: any[]) => any)(...args)),
);

// Mock model-bank
vi.mock('model-bank', (...args) =>
  import('./testUtils').then((m) => (m.modelBankModule as (...a: any[]) => any)(...args)),
);

/**
 * A `callSubAgent` child used to ignore its `timeout` and run until its step
 * cap — hours — while the user waited. These cover the watchdog that now ends
 * it at the deadline and the result the parent gets.
 */
describe('AgentRuntimeService sub-agent timeout', () => {
  let service: AgentRuntimeService;
  let mockCoordinator: any;
  let mockQueueService: any;
  let updateToolMessage: ReturnType<typeof vi.fn>;

  const timeoutParams = {
    operationId: 'child-op-1',
    parentOperationId: 'parent-op-1',
    threadId: 'thread-1',
    timeoutMs: 30 * 60 * 1000,
    toolMessageId: 'tool-msg-1',
  };

  beforeEach(() => {
    ({ service, mockCoordinator, mockQueueService } = setUpService(
      AgentRuntimeService,
      'test-user-id',
    ));
    vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
      metadata: { _hooks: [] },
    });
    updateToolMessage = vi.fn().mockResolvedValue({ success: true });
    (service as any).messageModel.updateToolMessage = updateToolMessage;
    (service as any).messageModel.findMessagePlugin = vi
      .fn()
      .mockResolvedValue({ apiName: 'callSubAgent', identifier: 'lobe-agent' });
    (service as any).messageModel.query = vi.fn().mockResolvedValue([
      { content: 'Research the topic', id: 'u1', role: 'user' },
      { content: 'Found three sources so far.', id: 'a1', role: 'assistant' },
    ]);
    vi.spyOn(service, 'tryResumeParentFromAsyncTool').mockResolvedValue(true);
  });

  describe('watchdog', () => {
    it('schedules a delayed /run delivery keyed on the child', async () => {
      const schedule = vi.spyOn(mockQueueService, 'scheduleMessage').mockResolvedValue('m1');

      await service.scheduleSubAgentTimeout(timeoutParams);

      expect(schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: timeoutParams.timeoutMs,
          operationId: 'child-op-1',
          payload: { subAgentTimeout: timeoutParams },
          stepIndex: 0,
        }),
      );
    });

    it('no-ops when the child already finished', async () => {
      mockCoordinator.loadAgentStatus.mockResolvedValue('done');
      const interruptSpy = vi.spyOn(service, 'interruptOperation');
      const bridgeSpy = vi.spyOn(service, 'completeSubAgentBridge');

      const result = await service.executeStep({
        operationId: 'child-op-1',
        stepIndex: 0,
        subAgentTimeout: timeoutParams,
      } as any);

      expect(result).toMatchObject({ nextStepScheduled: false, success: true });
      expect(interruptSpy).not.toHaveBeenCalled();
      expect(bridgeSpy).not.toHaveBeenCalled();
      expect(mockCoordinator.loadAgentState).not.toHaveBeenCalled();
    });

    it('interrupts a running child and reports the timeout to its parent', async () => {
      mockCoordinator.loadAgentStatus.mockResolvedValue('running');
      mockCoordinator.loadAgentState.mockResolvedValue({ status: 'running' });
      const interruptSpy = vi.spyOn(service, 'interruptOperation').mockResolvedValue(true);
      const bridgeSpy = vi.spyOn(service, 'completeSubAgentBridge');

      const result = await service.executeStep({
        operationId: 'child-op-1',
        stepIndex: 0,
        subAgentTimeout: timeoutParams,
      } as any);

      expect(interruptSpy).toHaveBeenCalledWith('child-op-1');
      expect(bridgeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'Sub-agent timed out after 30 minutes',
          operationId: 'child-op-1',
          parentOperationId: 'parent-op-1',
          reason: 'timeout',
          threadId: 'thread-1',
          toolMessageId: 'tool-msg-1',
        }),
      );
      expect(result.nextStepScheduled).toBe(true);
    });
  });

  describe('timeout result', () => {
    const bridgeTimeout = () =>
      service.completeSubAgentBridge({
        errorMessage: 'Sub-agent timed out after 30 minutes',
        finalState: { status: 'running' } as any,
        operationId: 'child-op-1',
        parentOperationId: 'parent-op-1',
        reason: 'timeout',
        threadId: 'thread-1',
        toolMessageId: 'tool-msg-1',
      });

    it('tells a waiting parent it timed out, with its last progress and its id', async () => {
      await bridgeTimeout();

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({
          content:
            'Sub-agent timed out after 30 minutes and was stopped before it finished. Anything it already did is kept in its thread.' +
            '\n\nIts last reply before the timeout:\n\nFound three sources so far.' +
            '\n\n<sub_agent id="thread-1" />',
          onlyIfEmpty: true,
          pluginError: { message: 'Sub-agent timed out after 30 minutes' },
          pluginState: expect.objectContaining({ status: 'error', timedOut: true }),
        }),
      );
      expect(service.tryResumeParentFromAsyncTool).toHaveBeenCalledWith(
        { parentOperationId: 'parent-op-1' },
        { knownFulfilledMessageId: 'tool-msg-1', scheduleVerifyOnHold: true },
      );
    });

    describe('background sub-agent', () => {
      let deliver: ReturnType<typeof vi.fn>;
      let pluginState: Record<string, unknown>;

      beforeEach(() => {
        pluginState = { background: true, status: 'pending' };
        (service as any).messageModel.findMessagePlugin = vi.fn(async () => ({
          apiName: 'callSubAgent',
          identifier: 'lobe-agent',
          state: pluginState,
        }));
        (service as any).messageModel.findById = vi
          .fn()
          .mockResolvedValue({ id: 'tool-msg-1', topicId: 'topic-1' });
        (service as any).messageModel.releaseCancelSuppressedDelivery = vi
          .fn()
          .mockResolvedValue([]);
        deliver = vi.fn().mockResolvedValue(undefined);
        (service as any).delegate.deliverBackgroundSubAgentResults = deliver;
      });

      it('stores the timeout as its result and delivers it', async () => {
        await bridgeTimeout();

        const [, update] = updateToolMessage.mock.calls[0];
        expect(update.content).toBeUndefined();
        expect(update.pluginState).toMatchObject({ status: 'error', timedOut: true });
        expect(update.pluginState.result).toContain('timed out after 30 minutes');
        expect(update.pluginState.result).toContain('Found three sources so far.');
        expect(deliver).toHaveBeenCalledWith({ topicId: 'topic-1' });
      });

      it('keeps the timeout result when the interrupted child completes afterwards', async () => {
        pluginState = { ...pluginState, result: 'timed out', status: 'error', timedOut: true };

        await service.completeSubAgentBridge({
          operationId: 'child-op-1',
          parentOperationId: 'parent-op-1',
          reason: 'interrupted',
          threadId: 'thread-1',
          toolMessageId: 'tool-msg-1',
        });

        expect(updateToolMessage).not.toHaveBeenCalled();
        expect(deliver).not.toHaveBeenCalled();
      });
    });
  });
});
