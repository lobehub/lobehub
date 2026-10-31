/**
 * @vitest-environment node
 */
import type { AgentState } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finishOperation } from '../executeStep/completion';
import { prepareStepInput } from '../executeStep/prepare';
import { readQueuedMessagesFlag } from '../operationControl';

const { steerQueueLength } = vi.hoisted(() => ({ steerQueueLength: vi.fn() }));
vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { length: steerQueueLength } },
}));

const stateOf = (overrides: Partial<AgentState> = {}) =>
  ({
    origin: { topicId: 'tpc-1' },
    status: 'done',
    stepCount: 3,
    ...overrides,
  }) as AgentState;

describe('server-side steer queue in the step loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    steerQueueLength.mockResolvedValue(0);
  });

  describe('readQueuedMessagesFlag', () => {
    const depsWithFlag = (flag: boolean) =>
      ({
        coordinator: { hasQueuedMessages: vi.fn().mockResolvedValue(flag) },
        userId: 'user-1',
      }) as any;

    it('hands the turn back when follow-ups wait in the server queue', async () => {
      steerQueueLength.mockResolvedValue(2);

      await expect(
        readQueuedMessagesFlag(
          depsWithFlag(false),
          'op-1',
          1,
          stateOf({ origin: { threadId: 'thd-1', topicId: 'tpc-1' } }),
        ),
      ).resolves.toBe(true);
      expect(steerQueueLength).toHaveBeenCalledWith(
        { threadId: 'thd-1', topicId: 'tpc-1', userId: 'user-1' },
        'op-1',
      );
    });

    it('keeps honouring the client flag without reading the queue', async () => {
      await expect(readQueuedMessagesFlag(depsWithFlag(true), 'op-1', 1, stateOf())).resolves.toBe(
        true,
      );
      expect(steerQueueLength).not.toHaveBeenCalled();
    });

    it('never hands a child run back for its parent conversation queue', async () => {
      steerQueueLength.mockResolvedValue(1);
      const child = stateOf({
        origin: { lineage: { isSubAgent: true, parentOperationId: 'op-0' }, topicId: 'tpc-1' },
      });

      await expect(readQueuedMessagesFlag(depsWithFlag(false), 'op-1', 1, child)).resolves.toBe(
        false,
      );
      expect(steerQueueLength).not.toHaveBeenCalled();
    });

    it('keeps the run going when the queue cannot be read', async () => {
      steerQueueLength.mockRejectedValue(new Error('redis down'));

      await expect(readQueuedMessagesFlag(depsWithFlag(false), 'op-1', 1, stateOf())).resolves.toBe(
        false,
      );
    });
  });

  describe('finishOperation', () => {
    const createDeps = (startQueuedFollowUp = vi.fn().mockResolvedValue(undefined)) => {
      const order: string[] = [];
      const deps = {
        completionLifecycle: {
          dispatchHooks: vi.fn(async () => {
            order.push('hooks');
          }),
          emitSignalEvents: vi.fn().mockResolvedValue([]),
          extractErrorMessage: vi.fn(),
        },
        delegate: {
          startQueuedFollowUp: vi.fn(async (params) => {
            order.push('followUp');
            return startQueuedFollowUp(params);
          }),
        },
        determineCompletionReason: (state: AgentState) =>
          state.status === 'done' ? 'done' : state.status,
        recordInterventionLifecycleCompletion: vi.fn(),
        traceRecorder: { finalize: vi.fn(), flushPartial: vi.fn() },
        tryResumeParentFromAsyncTool: vi.fn(),
        userId: 'user-1',
      } as any;
      return { deps, order };
    };

    const finish = (deps: any, state: AgentState) =>
      finishOperation(deps, {
        invokeAgentSpan: { setAttributes: vi.fn() } as any,
        operationId: 'op-1',
        stepIndex: 3,
        stepResult: { events: [], newState: state } as any,
      });

    it('starts the queued follow-ups once the finished run released the topic', async () => {
      const { deps, order } = createDeps();
      const state = stateOf();

      await finish(deps, state);

      expect(deps.delegate.startQueuedFollowUp).toHaveBeenCalledWith({
        operationId: 'op-1',
        scope: { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      });
      expect(order).toEqual(['hooks', 'followUp']);
    });

    it.each(['error', 'interrupted', 'waiting_for_human'] as const)(
      'leaves the queue alone when the run ends as %s',
      async (status) => {
        const { deps } = createDeps();

        await finish(deps, stateOf({ status }));

        expect(deps.delegate.startQueuedFollowUp).not.toHaveBeenCalled();
      },
    );

    it('leaves the parent conversation queue to the parent run', async () => {
      const { deps } = createDeps();

      await finish(deps, stateOf({ origin: { lineage: { isSubAgent: true }, topicId: 'tpc-1' } }));
      await finish(deps, stateOf({ origin: {} }));

      expect(deps.delegate.startQueuedFollowUp).not.toHaveBeenCalled();
    });

    it('does not fail the finishing step when the follow-up cannot start', async () => {
      const { deps } = createDeps(vi.fn().mockRejectedValue(new Error('boom')));

      await expect(finish(deps, stateOf())).resolves.toBeUndefined();
    });
  });

  describe('prepareStepInput — joining follow-ups before the next LLM call', () => {
    const toolMessages = [
      { content: '', id: 'msg-assistant', role: 'assistant', tools: [{ id: 'call-1' }] },
      { content: '391', id: 'msg-tool', parentId: 'msg-assistant', role: 'tool' },
    ];
    const refreshed = [...toolMessages, { content: 'follow-up', id: 'msg-steer', role: 'user' }];

    const createDeps = (injected?: { messageId: string }) =>
      ({
        computeDeviceContext: vi.fn().mockResolvedValue(undefined),
        humanIntervention: { process: vi.fn() },
        injectQueuedFollowUp: vi.fn().mockResolvedValue(injected),
        readQueuedMessagesFlag: vi.fn().mockResolvedValue(false),
        refreshMessagesFromDB: vi.fn().mockResolvedValue(refreshed),
        resolveAsyncToolResumeParentMessageId: vi.fn(),
      }) as any;

    const prepare = (deps: any, phase: string, messages: any[] = toolMessages) =>
      prepareStepInput(deps, {
        agentState: stateOf({ messages, status: 'running' } as any),
        params: {
          context: { payload: { parentMessageId: 'msg-tool' }, phase },
          operationId: 'op-1',
          stepIndex: 2,
        } as any,
        stepEntryMessages: undefined as any,
      });

    it.each(['tool_result', 'tools_batch_result', 'sub_agent_result', 'sub_agents_batch_result'])(
      're-enters the LLM on the joined steer message after %s',
      async (phase) => {
        const deps = createDeps({ messageId: 'msg-steer' });

        const { currentContext, currentState } = await prepare(deps, phase);

        expect(deps.injectQueuedFollowUp).toHaveBeenCalledWith('op-1', 2, expect.anything());
        expect(currentContext).toMatchObject({
          payload: { parentMessageId: 'msg-steer' },
          phase: 'user_input',
        });
        expect(currentState.messages).toEqual(refreshed);
      },
    );

    it('keeps the decision point when nothing joined', async () => {
      const deps = createDeps(undefined);

      const { currentContext } = await prepare(deps, 'tool_result');

      expect(currentContext).toMatchObject({ phase: 'tool_result' });
      expect(deps.refreshMessagesFromDB).not.toHaveBeenCalled();
    });

    it('never splits an assistant’s tool calls from their results', async () => {
      const deps = createDeps({ messageId: 'msg-steer' });

      await prepare(deps, 'llm_result');
      await prepare(deps, 'user_input');

      expect(deps.injectQueuedFollowUp).not.toHaveBeenCalled();
    });

    it('lets the agent park for a tool still waiting for approval first', async () => {
      const deps = createDeps({ messageId: 'msg-steer' });
      const pending = [
        toolMessages[0],
        { ...toolMessages[1], pluginIntervention: { status: 'pending' } },
      ];

      await prepare(deps, 'tool_result', pending);

      expect(deps.injectQueuedFollowUp).not.toHaveBeenCalled();
    });
  });
});
