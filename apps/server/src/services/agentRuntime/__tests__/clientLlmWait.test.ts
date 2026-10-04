// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import { createClientLlmExecutorUnavailableError } from '@/server/modules/AgentRuntime/llmRelay/errors';

import { AgentRuntimeService } from '../AgentRuntimeService';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      findLatestAssistantByOperationId: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      createAgentOperation: vi.fn(),
      getOperationMetadata: vi.fn(),
      hasQueuedMessages: vi.fn().mockResolvedValue(false),
      isInterrupted: vi.fn().mockResolvedValue(false),
      loadAgentState: vi.fn(),
      markInterrupted: vi.fn().mockResolvedValue(undefined),
      refreshStepLock: vi.fn().mockResolvedValue(true),
      releaseStepLock: vi.fn().mockResolvedValue(undefined),
      saveAgentState: vi.fn(),
      saveStepResult: vi.fn(),
      tryClaimStep: vi.fn().mockResolvedValue(true),
    };
  }),
  createStreamEventManager: vi.fn(function () {
    return {
      cleanupOperation: vi.fn(),
      publishAgentRuntimeEnd: vi.fn(),
      publishAgentRuntimeInit: vi.fn(),
      publishStreamEvent: vi.fn(),
    };
  }),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue/impls', () => ({ LocalQueueServiceImpl: class {} }));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

const OPERATION_ID = 'op-local-model';
const NOW = Date.parse('2026-10-04T08:00:00.000Z');

const runningState = (overrides: Record<string, unknown> = {}) => ({
  host: {},
  lastModified: new Date(NOW).toISOString(),
  messages: [{ content: 'hi', role: 'user' }],
  metadata: {},
  modelRuntimeConfig: { model: 'qwen', provider: 'lmstudio' },
  origin: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'user-1' },
  status: 'running',
  stepCount: 1,
  ...overrides,
});

const unavailableErrorState = (
  reason: Parameters<typeof createClientLlmExecutorUnavailableError>[1],
) =>
  runningState({
    error: formatErrorForState(createClientLlmExecutorUnavailableError('lmstudio', reason)),
    status: 'error',
    stepCount: 2,
  });

const waitingState = (overrides: Record<string, unknown> = {}) =>
  runningState({
    clientLlmWait: {
      assistantMessageId: 'msg-assistant',
      expiresAt: new Date(NOW + 600_000).toISOString(),
      parentMessageId: 'msg-user',
      parkedAt: new Date(NOW).toISOString(),
      provider: 'lmstudio',
      reason: 'no_executor',
    },
    status: 'waiting_for_client',
    stepCount: 2,
    ...overrides,
  });

const llmExecutor = {
  capabilities: ['llm_relay@1'],
  clientId: 'tab-b',
  providers: ['lmstudio'],
};

const createService = () => {
  const scheduleMessage = vi.fn().mockResolvedValue('queued');
  const service = new AgentRuntimeService({} as any, 'user-1', {
    queueService: { getImpl: () => ({}), scheduleMessage } as any,
  });
  const coordinator = (service as any).coordinator;
  const messageModel = (service as any).messageModel;
  const operationModel = (service as any).agentOperationModel;
  const completionLifecycle = (service as any).completionLifecycle;

  let stored: any;
  coordinator.loadAgentState = vi.fn(async () => stored);
  coordinator.saveStepResult = vi.fn(async (_id: string, result: any) => {
    stored = result.newState;
  });
  coordinator.saveAgentState = vi.fn(async (_id: string, state: any) => {
    stored = state;
  });
  operationModel.findById = vi.fn().mockResolvedValue({ status: 'running' });
  operationModel.touchRunning = vi.fn().mockResolvedValue(undefined);
  operationModel.tryResumeFromClientWait = vi.fn().mockResolvedValue(true);
  operationModel.settleClientWait = vi.fn().mockResolvedValue(true);
  operationModel.recordCompletion = vi.fn().mockResolvedValue(true);
  vi.spyOn(completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
  const dispatchHooks = vi.spyOn(completionLifecycle, 'dispatchHooks').mockResolvedValue(undefined);
  const traceFinalize = vi
    .spyOn((service as any).traceRecorder, 'finalize')
    .mockResolvedValue(undefined);
  const traceFlushPartial = vi
    .spyOn((service as any).traceRecorder, 'flushPartial')
    .mockResolvedValue(undefined);

  const mockStep = (result: any) => {
    const step = vi.fn().mockResolvedValue(result);
    (service as any).createAgentRuntime = vi.fn().mockResolvedValue({ runtime: { step } });
    return step;
  };

  return {
    coordinator,
    traceFinalize,
    traceFlushPartial,
    dispatchHooks,
    getStored: () => stored,
    messageModel,
    mockStep,
    operationModel,
    scheduleMessage,
    service,
    setStored: (state: any) => {
      stored = state;
    },
  };
};

describe('waiting_for_client (U4c)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parking', () => {
    it.each(['no_executor', 'claim_timeout', 'not_delivered'] as const)(
      'parks a step whose LLM call found no client (%s) instead of failing the run',
      async (reason) => {
        const t = createService();
        t.setStored(runningState());
        t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({
          id: 'msg-assistant',
          parentId: 'msg-user',
        });
        t.mockStep({ events: [], newState: unavailableErrorState(reason), nextContext: undefined });

        const result = await t.service.executeStep({
          context: { phase: 'user_input' } as any,
          operationId: OPERATION_ID,
          stepIndex: 1,
        });

        const parked = t.getStored();
        expect(parked.status).toBe('waiting_for_client');
        expect(parked.error).toBeUndefined();
        expect(parked.clientLlmWait).toEqual({
          assistantMessageId: 'msg-assistant',
          context: { phase: 'user_input' },
          expiresAt: new Date(NOW + 600_000).toISOString(),
          parentMessageId: 'msg-user',
          parkedAt: new Date(NOW).toISOString(),
          provider: 'lmstudio',
          reason,
        });
        expect(result.nextStepScheduled).toBe(false);

        // The durable row is parked before anything advertises the wait.
        expect(t.operationModel.recordCompletion).toHaveBeenCalledWith(OPERATION_ID, {
          completionReason: 'waiting_for_client',
          status: 'waiting_for_client',
        });
        expect(t.operationModel.recordCompletion.mock.invocationCallOrder[0]).toBeLessThan(
          t.messageModel.update.mock.invocationCallOrder[0],
        );

        // The assistant row says why the run waits, flagged for the waiting card.
        expect(t.messageModel.update).toHaveBeenCalledWith('msg-assistant', {
          error: expect.objectContaining({
            body: expect.objectContaining({
              provider: 'lmstudio',
              reason,
              waitingForClient: true,
            }),
            type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
          }),
        });

        // Only the expiry check is queued — no next step.
        expect(t.scheduleMessage).toHaveBeenCalledTimes(1);
        expect(t.scheduleMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            delay: 600_000,
            operationId: OPERATION_ID,
            payload: { clientLlmWaitExpired: new Date(NOW).toISOString() },
            stepIndex: 2,
          }),
        );

        // No trace boundary: the partial carries over to the resumed steps.
        expect(t.traceFinalize).not.toHaveBeenCalled();
        expect(t.traceFlushPartial).toHaveBeenCalled();

        // Persisted as a park: same lifecycle as an async-tool park, no completion.
        expect(t.dispatchHooks).toHaveBeenCalledWith(
          OPERATION_ID,
          expect.objectContaining({ status: 'waiting_for_client' }),
          'waiting_for_client',
        );
      },
    );

    it.each([
      ['the durable row cannot be written', () => Promise.reject(new Error('db down'))],
      ['there is no durable row to park', () => Promise.resolve(false)],
    ])('fails the step instead of parking when %s', async (_label, recordCompletion) => {
      const t = createService();
      t.setStored(runningState());
      t.operationModel.recordCompletion = vi.fn(recordCompletion);
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({ id: 'msg-assistant' });
      t.mockStep({
        events: [],
        newState: unavailableErrorState('no_executor'),
        nextContext: undefined,
      });

      await t.service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: OPERATION_ID,
        stepIndex: 1,
      });

      expect(t.getStored().status).toBe('error');
      expect(t.getStored().clientLlmWait).toBeUndefined();
      expect(t.messageModel.update).not.toHaveBeenCalledWith(
        'msg-assistant',
        expect.objectContaining({
          error: expect.objectContaining({
            body: expect.objectContaining({ waitingForClient: true }),
          }),
        }),
      );
      expect(t.scheduleMessage).not.toHaveBeenCalled();
    });

    it('fails the step instead of parking when it has no assistant row to reconnect on', async () => {
      const t = createService();
      t.setStored(runningState());
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue(undefined);
      t.mockStep({
        events: [],
        newState: unavailableErrorState('no_executor'),
        nextContext: undefined,
      });

      await t.service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: OPERATION_ID,
        stepIndex: 1,
      });

      expect(t.getStored().status).toBe('error');
      expect(t.operationModel.recordCompletion).not.toHaveBeenCalledWith(
        OPERATION_ID,
        expect.objectContaining({ status: 'waiting_for_client' }),
      );
      expect(t.scheduleMessage).not.toHaveBeenCalled();
    });

    it('keeps failing a step a client cannot fix (relay_unsupported)', async () => {
      const t = createService();
      t.setStored(runningState());
      t.mockStep({
        events: [],
        newState: unavailableErrorState('relay_unsupported'),
        nextContext: undefined,
      });

      await t.service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: OPERATION_ID,
        stepIndex: 1,
      });

      expect(t.getStored().status).toBe('error');
      expect(t.scheduleMessage).not.toHaveBeenCalled();
      expect(t.dispatchHooks).toHaveBeenCalledWith(OPERATION_ID, expect.anything(), 'error');
    });

    it('honours AGENT_LLM_RELAY_CLIENT_WAIT_MS for the wait window', async () => {
      vi.stubEnv('AGENT_LLM_RELAY_CLIENT_WAIT_MS', '60000');
      try {
        const t = createService();
        t.setStored(runningState());
        t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({ id: 'msg-assistant' });
        t.mockStep({
          events: [],
          newState: unavailableErrorState('no_executor'),
          nextContext: undefined,
        });

        await t.service.executeStep({
          context: { phase: 'user_input' } as any,
          operationId: OPERATION_ID,
          stepIndex: 1,
        });

        expect(t.getStored().clientLlmWait.expiresAt).toBe(new Date(NOW + 60_000).toISOString());
        expect(t.scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({ delay: 60_000 }));
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('resuming', () => {
    it('records the asking client as executor and replays the parked step', async () => {
      const t = createService();
      t.setStored(waitingState());

      const result = await t.service.resumeFromClientLlmWait({
        llmExecutor,
        operationId: OPERATION_ID,
      });

      expect(result).toEqual({
        assistantMessageId: 'msg-assistant',
        resumed: true,
        topicId: 'tpc-1',
      });
      expect(t.operationModel.tryResumeFromClientWait).toHaveBeenCalledWith(OPERATION_ID);
      expect(t.getStored().host.llmExecutor).toEqual(llmExecutor);
      expect(t.messageModel.update).toHaveBeenCalledWith('msg-assistant', { error: null });
      expect(t.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: OPERATION_ID,
          payload: { resumeClientLlm: true },
          stepIndex: 2,
        }),
      );
    });

    it('resumes once when two clients race (CAS lost)', async () => {
      const t = createService();
      t.setStored(waitingState());
      t.operationModel.tryResumeFromClientWait.mockResolvedValue(false);

      const result = await t.service.resumeFromClientLlmWait({
        llmExecutor,
        operationId: OPERATION_ID,
      });

      expect(result.resumed).toBe(false);
      expect(t.coordinator.saveAgentState).not.toHaveBeenCalled();
      expect(t.scheduleMessage).not.toHaveBeenCalled();
    });

    it('stays parked and resumable when the resume step cannot be enqueued', async () => {
      const t = createService();
      const parked = waitingState();
      t.setStored(parked);
      t.operationModel.revertClientWaitResume = vi.fn().mockResolvedValue(true);
      t.scheduleMessage.mockRejectedValueOnce(new Error('QStash 503'));

      await expect(
        t.service.resumeFromClientLlmWait({ llmExecutor, operationId: OPERATION_ID }),
      ).rejects.toThrow('QStash 503');

      expect(t.operationModel.revertClientWaitResume).toHaveBeenCalledWith(OPERATION_ID);
      expect(t.getStored()).toEqual(parked);
      expect(t.messageModel.update).toHaveBeenLastCalledWith('msg-assistant', {
        error: expect.objectContaining({
          body: expect.objectContaining({ waitingForClient: true }),
          type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
        }),
      });
    });

    it('stays parked when saving the claimed state fails, even if restoring it fails too', async () => {
      const t = createService();
      const parked = waitingState();
      t.setStored(parked);
      t.operationModel.revertClientWaitResume = vi.fn().mockResolvedValue(true);
      t.coordinator.saveAgentState = vi.fn().mockRejectedValue(new Error('redis down'));

      await expect(
        t.service.resumeFromClientLlmWait({ llmExecutor, operationId: OPERATION_ID }),
      ).rejects.toThrow('redis down');

      expect(t.operationModel.revertClientWaitResume).toHaveBeenCalledWith(OPERATION_ID);
      expect(t.scheduleMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ payload: { resumeClientLlm: true } }),
      );
      expect(t.messageModel.update).toHaveBeenLastCalledWith('msg-assistant', {
        error: expect.objectContaining({
          body: expect.objectContaining({ waitingForClient: true }),
        }),
      });
    });

    it('fails instead of re-parking once the original wait is used up', async () => {
      const t = createService();
      t.setStored(
        waitingState({
          clientLlmWait: {
            assistantMessageId: 'msg-assistant',
            context: { phase: 'user_input' },
            expiresAt: new Date(NOW + 1000).toISOString(),
            parkedAt: new Date(NOW - 600_000).toISOString(),
            provider: 'lmstudio',
            reason: 'no_executor',
          },
        }),
      );
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({ id: 'msg-assistant' });
      t.mockStep({
        events: [],
        newState: unavailableErrorState('not_delivered'),
        nextContext: undefined,
      });

      await t.service.executeStep({
        operationId: OPERATION_ID,
        resumeClientLlm: true,
        stepIndex: 2,
      });

      // No expiry could race the step's own commit: the run just fails.
      expect(t.getStored().status).toBe('error');
      expect(t.scheduleMessage).not.toHaveBeenCalled();
    });

    it('has the re-park in place before arming its expiry', async () => {
      const t = createService();
      const deadline = new Date(NOW + 10_000).toISOString();
      t.setStored(
        waitingState({
          clientLlmWait: {
            assistantMessageId: 'msg-assistant',
            context: { phase: 'user_input' },
            expiresAt: deadline,
            parkedAt: new Date(NOW - 600_000).toISOString(),
            provider: 'lmstudio',
            reason: 'no_executor',
          },
        }),
      );
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({ id: 'msg-assistant' });
      t.mockStep({
        events: [],
        newState: unavailableErrorState('not_delivered'),
        nextContext: undefined,
      });
      // What an immediately delivered expiry would see when it runs.
      let seenByExpiry: any;
      let noticeWritten = false;
      t.messageModel.update.mockImplementation(async (_id: string, value: any) => {
        if (value.error?.body?.waitingForClient) noticeWritten = true;
      });
      t.scheduleMessage.mockImplementation(async (message: any) => {
        if (message.payload?.clientLlmWaitExpired) {
          seenByExpiry = { noticeWritten, state: structuredClone(t.getStored()) };
        }
        return 'queued';
      });

      await t.service.executeStep({
        operationId: OPERATION_ID,
        resumeClientLlm: true,
        stepIndex: 2,
      });

      expect(t.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 10_000,
          payload: { clientLlmWaitExpired: expect.any(String) },
        }),
      );
      expect(seenByExpiry.state.status).toBe('waiting_for_client');
      expect(seenByExpiry.state.clientLlmWait.parkedAt).toBe(new Date(NOW).toISOString());
      expect(seenByExpiry.noticeWritten).toBe(true);
    });

    it('keeps the original deadline when a resumed call finds no client again', async () => {
      const t = createService();
      const deadline = new Date(NOW + 120_000).toISOString();
      t.setStored(
        waitingState({
          clientLlmWait: {
            assistantMessageId: 'msg-assistant',
            context: { phase: 'user_input' },
            expiresAt: deadline,
            parkedAt: new Date(NOW - 480_000).toISOString(),
            provider: 'lmstudio',
            reason: 'no_executor',
          },
        }),
      );
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({ id: 'msg-assistant' });
      t.mockStep({
        events: [],
        newState: unavailableErrorState('not_delivered'),
        nextContext: undefined,
      });

      await t.service.executeStep({
        operationId: OPERATION_ID,
        resumeClientLlm: true,
        stepIndex: 2,
      });

      expect(t.getStored().status).toBe('waiting_for_client');
      expect(t.getStored().clientLlmWait.expiresAt).toBe(deadline);
      expect(t.scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({ delay: 120_000 }));
    });

    it('leaves a wait past its deadline to the (late) expiry instead of resuming it', async () => {
      const t = createService();
      t.setStored(
        waitingState({
          clientLlmWait: {
            assistantMessageId: 'msg-assistant',
            expiresAt: new Date(NOW - 1).toISOString(),
            parkedAt: new Date(NOW - 600_000).toISOString(),
            provider: 'lmstudio',
            reason: 'no_executor',
          },
        }),
      );

      const result = await t.service.resumeFromClientLlmWait({
        llmExecutor,
        operationId: OPERATION_ID,
      });

      expect(result.resumed).toBe(false);
      expect(t.operationModel.tryResumeFromClientWait).not.toHaveBeenCalled();
      expect(t.scheduleMessage).not.toHaveBeenCalled();
    });

    it('re-arms the expiry when rolling back, since one may have fired during the claim', async () => {
      const t = createService();
      const parked = waitingState();
      t.setStored(parked);
      t.operationModel.revertClientWaitResume = vi.fn().mockResolvedValue(true);
      t.scheduleMessage.mockRejectedValueOnce(new Error('QStash 503')).mockResolvedValue('queued');

      await expect(
        t.service.resumeFromClientLlmWait({ llmExecutor, operationId: OPERATION_ID }),
      ).rejects.toThrow('QStash 503');

      expect(t.getStored().status).toBe('waiting_for_client');
      expect(t.scheduleMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payload: { clientLlmWaitExpired: new Date(NOW).toISOString() },
        }),
      );
    });

    it('settles a Stop that raced the claim instead of re-parking over it', async () => {
      const t = createService();
      t.setStored(waitingState());
      t.operationModel.revertClientWaitResume = vi.fn().mockResolvedValue(true);
      t.operationModel.settleRunning = vi.fn().mockResolvedValue(true);
      // Stop lands while the row reads `running`: it saves `interrupted`, and its
      // own settle (which only matches a parked row) cannot apply.
      t.scheduleMessage.mockImplementationOnce(async () => {
        t.setStored({ ...t.getStored(), clientLlmWait: undefined, status: 'interrupted' });
        throw new Error('QStash 503');
      });

      await expect(
        t.service.resumeFromClientLlmWait({ llmExecutor, operationId: OPERATION_ID }),
      ).rejects.toThrow('QStash 503');

      expect(t.operationModel.revertClientWaitResume).not.toHaveBeenCalled();
      expect(t.getStored().status).toBe('interrupted');
      expect(t.operationModel.settleRunning).toHaveBeenCalledWith(OPERATION_ID, 'interrupted');
      expect(t.dispatchHooks).toHaveBeenCalledWith(
        OPERATION_ID,
        expect.objectContaining({ status: 'interrupted' }),
        'interrupted',
      );
    });

    it('does nothing for a run that is not parked', async () => {
      const t = createService();
      t.setStored(runningState());

      const result = await t.service.resumeFromClientLlmWait({
        llmExecutor,
        operationId: OPERATION_ID,
      });

      expect(result.resumed).toBe(false);
      expect(t.operationModel.tryResumeFromClientWait).not.toHaveBeenCalled();
    });

    it('re-runs the parked LLM turn into its own assistant row on resume', async () => {
      const t = createService();
      t.setStored(waitingState());
      const step = t.mockStep({
        events: [],
        newState: runningState({ status: 'done', stepCount: 3 }),
        nextContext: undefined,
      });

      await t.service.executeStep({
        operationId: OPERATION_ID,
        resumeClientLlm: true,
        stepIndex: 2,
      });

      expect(step).toHaveBeenCalledTimes(1);
      const [state, context] = step.mock.calls[0];
      expect(state.status).toBe('running');
      expect(state.clientLlmWait).toBeUndefined();
      expect(state.messages).toEqual([{ content: 'hi', role: 'user' }]);
      expect(state.pendingAssistantMessageId).toBe('msg-assistant');
      expect(context).toEqual({
        payload: { assistantMessageId: 'msg-assistant', parentMessageId: 'msg-user' },
        phase: 'user_input',
      });
    });

    it('replays the parked continuation context, not a generic user turn', async () => {
      const t = createService();
      t.setStored(runningState());
      t.messageModel.findLatestAssistantByOperationId.mockResolvedValue({
        id: 'msg-assistant',
        parentId: 'msg-tool',
      });
      const parkedContext = {
        payload: { parentMessageId: 'msg-tool' },
        phase: 'sub_agents_batch_result',
        stepContext: { hasQueuedMessages: false },
      };
      t.mockStep({
        events: [],
        newState: unavailableErrorState('no_executor'),
        nextContext: undefined,
      });
      await t.service.executeStep({
        context: parkedContext as any,
        operationId: OPERATION_ID,
        stepIndex: 1,
      });
      expect(t.getStored().clientLlmWait.context).toEqual({
        payload: { parentMessageId: 'msg-tool' },
        phase: 'sub_agents_batch_result',
      });

      const step = t.mockStep({
        events: [],
        newState: runningState({ status: 'done', stepCount: 3 }),
        nextContext: undefined,
      });
      await t.service.executeStep({
        operationId: OPERATION_ID,
        resumeClientLlm: true,
        stepIndex: 2,
      });

      const [state, context] = step.mock.calls[0];
      expect(context).toMatchObject({
        payload: { parentMessageId: 'msg-tool' },
        phase: 'sub_agents_batch_result',
      });
      expect(state.pendingAssistantMessageId).toBe('msg-assistant');
    });

    it('ignores a plain step delivery while the run waits for a client', async () => {
      const t = createService();
      t.setStored(waitingState());
      const step = t.mockStep({ events: [], newState: runningState(), nextContext: undefined });

      const result = await t.service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(step).not.toHaveBeenCalled();
      expect(result.state.status).toBe('waiting_for_client');
    });
  });

  describe('expiry', () => {
    it('ends a run nobody picked up with an actionable wait_timeout error', async () => {
      const t = createService();
      t.setStored(waitingState());

      const result = await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(result.state).toEqual({ status: 'error' });
      expect(t.operationModel.settleClientWait).toHaveBeenCalledWith(OPERATION_ID);
      const final = t.getStored();
      expect(final.status).toBe('error');
      expect(final.clientLlmWait).toBeUndefined();
      expect(final.error).toMatchObject({
        body: expect.objectContaining({ reason: 'wait_timeout' }),
        type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      });
      // The error lands on the assistant row through the normal failure path.
      expect(t.dispatchHooks).toHaveBeenCalledWith(
        OPERATION_ID,
        expect.objectContaining({ status: 'error' }),
        'error',
      );
    });

    it('writes the expiry error onto the assistant row before ending the stream', async () => {
      const t = createService();
      t.setStored(waitingState());
      // The end event's `uiMessages` snapshot is read from the DB inside this
      // save; record what the assistant row held at that moment.
      let rowErrorAtEnd: unknown;
      t.coordinator.saveAgentState.mockImplementationOnce(async (_id: string, state: any) => {
        const writes = t.messageModel.update.mock.calls.filter(
          ([id]: any[]) => id === 'msg-assistant',
        );
        rowErrorAtEnd = writes.at(-1)?.[1]?.error;
        t.setStored(state);
      });

      await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(rowErrorAtEnd).toMatchObject({
        body: expect.objectContaining({ reason: 'wait_timeout' }),
        type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      });
    });

    it('finishes on retry when an earlier delivery settled the row but failed to finish', async () => {
      const t = createService();
      t.setStored(waitingState());
      // First delivery: the CAS settled the row, then the Redis write failed.
      t.coordinator.saveAgentState.mockRejectedValueOnce(new Error('redis down'));
      await expect(
        t.service.executeStep({
          clientLlmWaitExpired: new Date(NOW).toISOString(),
          operationId: OPERATION_ID,
          stepIndex: 2,
        }),
      ).rejects.toThrow('redis down');
      expect(t.getStored().status).toBe('waiting_for_client');

      // The retry finds the row already terminal and the same park in Redis.
      t.operationModel.settleClientWait.mockResolvedValue(false);
      t.operationModel.findById.mockResolvedValue({ status: 'error' });

      const result = await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(result.state).toEqual({ status: 'error' });
      expect(t.getStored()).toMatchObject({ clientLlmWait: undefined, status: 'error' });
      expect(t.dispatchHooks).toHaveBeenCalledWith(
        OPERATION_ID,
        expect.objectContaining({ status: 'error' }),
        'error',
      );
    });

    it('redelivers the lifecycle when a critical hook failed after the run ended', async () => {
      const t = createService();
      t.setStored(waitingState());
      t.dispatchHooks.mockRejectedValueOnce(new Error('critical hook delivery failed'));
      const expire = () =>
        t.service.executeStep({
          clientLlmWaitExpired: new Date(NOW).toISOString(),
          operationId: OPERATION_ID,
          stepIndex: 2,
        });

      await expect(expire()).rejects.toThrow('critical hook delivery failed');
      expect(t.getStored().status).toBe('error');

      // QStash redelivers; the durable row is terminal and Redis already says error.
      t.operationModel.findById.mockResolvedValue({ status: 'error' });
      const result = await expire();

      expect(result.state).toEqual({ status: 'error' });
      expect(t.dispatchHooks).toHaveBeenCalledTimes(2);
      expect(t.dispatchHooks).toHaveBeenLastCalledWith(
        OPERATION_ID,
        expect.objectContaining({ status: 'error' }),
        'error',
      );
    });

    it('is a no-op once the run left that wait (resumed, or parked again later)', async () => {
      const t = createService();
      t.setStored(waitingState());

      await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW - 1000).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });
      t.setStored(runningState({ stepCount: 3 }));
      await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(t.operationModel.settleClientWait).not.toHaveBeenCalled();
      expect(t.coordinator.saveAgentState).not.toHaveBeenCalled();
      expect(t.dispatchHooks).not.toHaveBeenCalled();
    });

    it('leaves the run alone when a resume wins the durable row first', async () => {
      const t = createService();
      t.setStored(waitingState());
      t.operationModel.settleClientWait.mockResolvedValue(false);

      await t.service.executeStep({
        clientLlmWaitExpired: new Date(NOW).toISOString(),
        operationId: OPERATION_ID,
        stepIndex: 2,
      });

      expect(t.coordinator.saveAgentState).not.toHaveBeenCalled();
      expect(t.dispatchHooks).not.toHaveBeenCalled();
    });
  });

  it('settles a waiting run when it is stopped', async () => {
    const t = createService();
    t.setStored(waitingState());

    await expect(t.service.interruptOperation(OPERATION_ID)).resolves.toBe(true);

    expect(t.getStored().status).toBe('interrupted');
    expect(t.getStored().clientLlmWait).toBeUndefined();
    // The waiting card goes with the wait: nothing can continue a stopped run.
    expect(t.messageModel.update).toHaveBeenCalledWith('msg-assistant', { error: null });
    expect(t.operationModel.settleClientWait).toHaveBeenCalledWith(OPERATION_ID, 'interrupted');
    expect(t.dispatchHooks).toHaveBeenCalledWith(
      OPERATION_ID,
      expect.objectContaining({ status: 'interrupted' }),
      'interrupted',
    );
  });
});
