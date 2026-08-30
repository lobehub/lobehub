// @vitest-environment node
import { type Message, parse } from '@lobechat/conversation-flow';
import { ChatErrorType, RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotifyAgentInterventionRequiredParams } from '@/business/server/agent-run/agentInterventionReview';
import * as agentSignalService from '@/server/services/agentSignal';
import * as verifyServices from '@/server/services/verify';
import { registerWorksForOperation } from '@/server/services/workRegistration';

import {
  CompletionLifecycle,
  CriticalAgentInterventionPersistenceError,
  isSuccessLikeCompletionReason,
} from '../CompletionLifecycle';
import { CriticalHookDeliveryError, hookDispatcher } from '../hooks';

// Default async no-op implementation: the production code chains `.catch` on
// the returned promise, so a bare vi.fn() (returning undefined) would throw
// inside every unrelated `done`-path test. mockRestore/mockReset fall back to
// this original implementation.
const {
  mockBuildRuntimeInterventionNotification,
  mockNotifyAgentInterventionRequired,
  mockNotifyAgentRunCompleted,
} = vi.hoisted(() => ({
  mockBuildRuntimeInterventionNotification: vi.fn<
    () => Promise<NotifyAgentInterventionRequiredParams | undefined>
  >(async () => undefined),
  mockNotifyAgentInterventionRequired: vi.fn(async () => {}),
  mockNotifyAgentRunCompleted: vi.fn(async () => {}),
}));

vi.mock('@/business/server/agent-run/agentInterventionReview', () => ({
  notifyAgentInterventionRequired: mockNotifyAgentInterventionRequired,
}));

vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () => ({
  notifyAgentRunCompleted: mockNotifyAgentRunCompleted,
}));

vi.mock('../agentInterventionNotification', () => ({
  buildRuntimeInterventionNotification: mockBuildRuntimeInterventionNotification,
}));

vi.mock('@/server/services/workRegistration', () => ({
  registerWorksForOperation: vi.fn(),
}));

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('isSuccessLikeCompletionReason', () => {
  // Regression: file-Work registration was gated on `reason === 'done'` alone,
  // silently skipping runs stopped by a step/cost cap even though the lifecycle
  // persists those as status='done' and recovers their assistant content.
  it('treats capped runs (max_steps / cost_limit) as successful completions', () => {
    expect(isSuccessLikeCompletionReason('done')).toBe(true);
    expect(isSuccessLikeCompletionReason('max_steps')).toBe(true);
    expect(isSuccessLikeCompletionReason('cost_limit')).toBe(true);
  });

  it('rejects non-success terminal and parked reasons', () => {
    expect(isSuccessLikeCompletionReason('error')).toBe(false);
    expect(isSuccessLikeCompletionReason('interrupted')).toBe(false);
    expect(isSuccessLikeCompletionReason('waiting_for_human')).toBe(false);
    expect(isSuccessLikeCompletionReason('waiting_for_async_tool')).toBe(false);
  });
});

describe('CompletionLifecycle.extractErrorMessage', () => {
  it('extracts message from ChatCompletionErrorPayload (InsufficientBudgetForModel)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Budget exceeded');
  });

  it('extracts message from ChatCompletionErrorPayload (InvalidProviderAPIKey)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      endpoint: 'https://cdn.example.com/v1',
      error: {
        code: '',
        error: { code: '', message: '无效的令牌', type: 'new_api_error' },
        message: '无效的令牌',
        status: 401,
        type: 'new_api_error',
      },
      errorType: 'InvalidProviderAPIKey',
      provider: 'openai',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('无效的令牌');
  });

  it('extracts message from formatted ChatMessageError with body.error.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { error: { message: 'Rate limit exceeded' } },
      message: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Rate limit exceeded');
  });

  it('extracts message from ChatMessageError with body.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { message: 'Something went wrong' },
      message: 'error',
      type: 'InternalServerError',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Something went wrong');
  });

  it('falls back to error.message when body is absent', () => {
    const lifecycle = buildLifecycle();
    const error = { message: 'Connection timeout', type: 'NetworkError' };

    expect(lifecycle.extractErrorMessage(error)).toBe('Connection timeout');
  });

  it('falls back to errorType when message is "error"', () => {
    const lifecycle = buildLifecycle();
    const error = { errorType: 'InsufficientBudgetForModel', message: 'error' };

    expect(lifecycle.extractErrorMessage(error)).toBe('InsufficientBudgetForModel');
  });

  it('returns undefined for null/undefined', () => {
    const lifecycle = buildLifecycle();

    expect(lifecycle.extractErrorMessage(null)).toBeUndefined();
    expect(lifecycle.extractErrorMessage(undefined)).toBeUndefined();
  });

  it('never returns [object Object] for nested error objects', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    const result = lifecycle.extractErrorMessage(error);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result).toBe('Budget exceeded');
  });
});

describe('CompletionLifecycle.buildLifecycleEvent', () => {
  const callBuild = (state: unknown, reason = 'completed') =>
    (buildLifecycle() as any).buildLifecycleEvent('op-1', state, reason);

  it('extracts text content from a plain-string final assistant turn', () => {
    const state = {
      messages: [
        { content: 'user prompt', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      metadata: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('final answer');
    expect(event.attachments).toBeUndefined();
  });

  it('preserves the final answer after DB messages are parsed into an assistantGroup', () => {
    const dbMessages: Message[] = [
      {
        content: 'user prompt',
        createdAt: 0,
        id: 'msg-user',
        role: 'user',
        updatedAt: 0,
      },
      {
        content: '',
        createdAt: 1,
        id: 'msg-tool-call',
        parentId: 'msg-user',
        role: 'assistant',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'builtin',
            result_msg_id: 'msg-tool-result',
            type: 'default',
          },
        ],
        updatedAt: 1,
      },
      {
        content: 'tool result',
        createdAt: 2,
        id: 'msg-tool-result',
        parentId: 'msg-tool-call',
        role: 'tool',
        tool_call_id: 'tool-call-1',
        updatedAt: 2,
      },
      {
        content: 'final answer after tool use',
        createdAt: 3,
        id: 'msg-final',
        parentId: 'msg-tool-result',
        role: 'assistant',
        updatedAt: 3,
      },
    ];
    const { flatList } = parse(dbMessages);

    expect(flatList.at(-1)?.role).toBe('assistantGroup');

    const { assistantMessageId, event } = callBuild({ messages: flatList, metadata: {} });

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBe('final answer after tool use');
  });

  it('extracts the final assistant leaf from an assistantGroup', () => {
    const state = {
      messages: [
        { content: 'user prompt', id: 'msg-user', role: 'user' },
        {
          children: [
            {
              content: '',
              id: 'msg-tool-call',
              tools: [
                {
                  id: 'tool-call-1',
                  result: { content: 'tool result', id: 'msg-tool-result' },
                },
              ],
            },
            { content: 'grouped final answer', id: 'msg-final' },
          ],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      metadata: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBe('grouped final answer');
  });

  it('keeps the final empty assistantGroup leaf instead of falling back to stale text', () => {
    const state = {
      messages: [
        { content: 'stale prior answer', id: 'msg-stale', role: 'assistant' },
        { content: 'follow-up prompt', id: 'msg-user', role: 'user' },
        {
          children: [{ content: '', id: 'msg-final' }],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      metadata: {},
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('treats an empty assistantGroup as the final assistant boundary', () => {
    const state = {
      messages: [
        { content: 'stale prior answer', id: 'msg-stale', role: 'assistant' },
        { children: [], content: '', id: 'msg-empty-group', role: 'assistantGroup' },
      ],
      metadata: {},
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-empty-group');
    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('extracts attachments from grouped assistant and tool-result leaves', () => {
    const state = {
      messages: [
        {
          children: [
            {
              content: '',
              id: 'msg-tool-call',
              tools: [
                {
                  id: 'tool-call-1',
                  result: {
                    content: [
                      {
                        image_url: { url: 'https://cdn.example.com/tool.png' },
                        type: 'image_url',
                      },
                    ],
                    id: 'msg-tool-result',
                  },
                },
              ],
            },
            {
              content: [
                { text: 'done', type: 'text' },
                {
                  image_url: { url: 'https://cdn.example.com/final.png' },
                  type: 'image_url',
                },
              ],
              id: 'msg-final',
            },
          ],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('done');
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/tool.png', type: 'image' }),
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/final.png', type: 'image' }),
    ]);
  });

  it('concatenates text parts from a multimodal final assistant turn', () => {
    const state = {
      messages: [
        {
          content: [
            { text: 'here is the image: ', type: 'text' },
            { image_url: { url: 'https://cdn.example.com/a.png' }, type: 'image_url' },
            { text: '\n\nhope it helps', type: 'text' },
          ],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('here is the image: \n\nhope it helps');
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }),
    ]);
  });

  it('returns undefined text for image-only final assistant turn (no fallback to earlier text)', () => {
    // Regression: the previous implementation `.find(m => role === 'assistant' && hasText)`
    // would skip the image-only final turn and walk back to the earlier text
    // turn, shipping stale prose alongside the current image. The fix matches
    // on role only — text must be undefined when the final turn has no text.
    const state = {
      messages: [
        { content: 'stale prior text', role: 'assistant' },
        { content: 'follow-up prompt', role: 'user' },
        {
          content: [{ image_url: { url: 'https://cdn.example.com/new.png' }, type: 'image_url' }],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/new.png', type: 'image' }),
    ]);
  });

  it('returns undefined text when there are no assistant messages', () => {
    const state = {
      messages: [{ content: 'just a user prompt', role: 'user' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
  });

  it('returns undefined text when content is an empty string', () => {
    // `extractTextFromMessageContent` returns undefined for empty strings, so
    // an empty-string final assistant turn must not pretend it has text.
    const state = {
      messages: [{ content: '', role: 'assistant' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('handles missing messages array gracefully', () => {
    const { event } = callBuild({ metadata: { agentId: 'a' } });

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
    expect(event.agentId).toBe('a');
  });

  it('populates errorType + attribution from the normalized error on the error path', () => {
    // Regression: the event previously carried only errorDetail/errorMessage, so
    // bot reply renderers never saw the stable code/attribution and always fell
    // back to the opaque Operation ID. buildLifecycleEvent must normalize the
    // runtime error via formatErrorForState and surface these taxonomy fields.
    const state = {
      error: { error: { message: 'fetch failed' }, errorType: 'ProviderNetworkError' },
      metadata: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state, 'error');

    expect(event.errorType).toBe('ProviderNetworkError');
    expect(event.errorAttribution).toBe('system');
    expect(event.errorMessage).toBe('fetch failed');
  });

  it('leaves errorType + attribution undefined when there is no error', () => {
    const { event } = callBuild({ messages: [], metadata: {} }, 'done');

    expect(event.errorType).toBeUndefined();
    expect(event.errorAttribution).toBeUndefined();
  });

  it('resolves assistantMessageId from the final assistant message row when metadata omits it', () => {
    // Regression: a server execAgent turn carries operation-level metadata
    // ({} in DB) with no assistantMessageId, so the completion event previously
    // shipped assistantMessageId=undefined and the deferred skill-synthesis
    // handler no-oped. The id must fall back to the persisted id on the final
    // assistant message row in state (deferred skill synthesis needs the
    // anchor to seed the skill under the assistant group, not under the user
    // message).
    const state = {
      messages: [
        { content: 'user prompt', id: 'msg-user', role: 'user' },
        { content: 'tool result', id: 'msg-tool', role: 'tool' },
        { content: 'final answer', id: 'msg-assistant', role: 'assistant' },
        { content: 'trailing tool result', id: 'msg-tool-2', role: 'tool' },
      ],
      metadata: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { assistantMessageId } = callBuild(state, 'done');

    expect(assistantMessageId).toBe('msg-assistant');
  });

  it('prefers metadata.assistantMessageId over the state row (client runtime path)', () => {
    // The client runtime path supplies assistantMessageId on operation metadata;
    // it must win over the state-row fallback so the anchor stays the id the
    // client already persisted the parked candidate against.
    const state = {
      messages: [{ content: 'final answer', id: 'msg-from-state', role: 'assistant' }],
      metadata: { agentId: 'agent-1', assistantMessageId: 'msg-from-metadata' },
    };

    const { assistantMessageId } = callBuild(state, 'done');

    expect(assistantMessageId).toBe('msg-from-metadata');
  });

  it('leaves assistantMessageId undefined when neither metadata nor a state row carries it', () => {
    const { assistantMessageId } = callBuild(
      { messages: [{ content: 'just a user prompt', role: 'user' }], metadata: {} },
      'done',
    );

    expect(assistantMessageId).toBeUndefined();
  });
});

describe('CompletionLifecycle.dispatchHooks — error persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists budget errors without downgrading them to AgentRuntimeError', async () => {
    const lifecycle = buildLifecycle();
    const updateMessage = vi.fn().mockResolvedValue({ success: true });
    const budget = { required: 12 };

    (lifecycle as any).messageModel = { update: updateMessage };
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await lifecycle.dispatchHooks(
      'op-1',
      {
        error: {
          budget,
          error: { message: 'Budget exceeded' },
          errorType: ChatErrorType.FreePlanLimit,
          provider: 'lobehub',
        },
        metadata: { _hooks: [], assistantMessageId: 'msg-1' },
        status: 'error',
      },
      'error',
    );

    expect(updateMessage).toHaveBeenCalledWith('msg-1', {
      error: expect.objectContaining({
        body: expect.objectContaining({
          budget,
          message: 'Budget exceeded',
          provider: 'lobehub',
        }),
        message: 'Budget exceeded',
        type: ChatErrorType.FreePlanLimit,
      }),
    });
  });

  it('rethrows critical webhook failures after terminal persistence', async () => {
    const lifecycle = buildLifecycle();
    const persistCompletion = vi
      .spyOn(lifecycle as any, 'persistCompletion')
      .mockResolvedValue(undefined);
    const dispatch = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockRejectedValue(
        new CriticalHookDeliveryError('task-on-complete', new Error('qstash down')),
      );
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { metadata: { _hooks: [] }, status: 'interrupted' },
        'interrupted',
      ),
    ).rejects.toThrow('Critical webhook delivery failed: task-on-complete');

    expect(persistCompletion).toHaveBeenCalledBefore(dispatch);
  });

  it('does not dispatch hooks when another owner already interrupted the operation', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(false);
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await lifecycle.dispatchHooks(
      'op-reclaimed',
      { metadata: { _hooks: [] }, status: 'done' },
      'done',
    );

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.dispatchHooks — verify plan race', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits the start-time verify-plan instantiation before running the completion gate', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    // Control exactly when the fire-and-forget instantiation settles.
    let settle: () => void = () => {};
    const instantiation = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const instantiateSpy = vi
      .spyOn(verifyServices, 'instantiateVerifyPlanOnStart')
      .mockReturnValue(instantiation);
    const runVerifySpy = vi
      .spyOn(verifyServices, 'runVerifyOnCompletion')
      .mockResolvedValue(undefined);

    // A top-level task op registers the (still-pending) instantiation at start.
    await lifecycle.recordStart({ operationId: 'op-1', taskId: 'task-1' } as any);
    expect(instantiateSpy).toHaveBeenCalledTimes(1);

    // Completion fires while the plan instantiation is still in flight.
    const doneState = { metadata: { agentId: 'a', _hooks: [] }, status: 'done' };
    const dispatch = lifecycle.dispatchHooks('op-1', doneState, 'done');

    // The gate must stay blocked on the pending instantiation, not race past it.
    await flushMicrotasks();
    expect(runVerifySpy).not.toHaveBeenCalled();

    // Once the plan lands, the gate proceeds against the now-confirmed plan.
    settle();
    await dispatch;
    expect(runVerifySpy).toHaveBeenCalledTimes(1);
  });

  it('does not register an instantiation for a repair / verifier sub-op (parentOperationId set)', async () => {
    const lifecycle = buildLifecycle();
    const instantiateSpy = vi
      .spyOn(verifyServices, 'instantiateVerifyPlanOnStart')
      .mockResolvedValue(undefined);

    await lifecycle.recordStart({
      operationId: 'op-2',
      parentOperationId: 'op-1',
      taskId: 'task-1',
    } as any);

    expect(instantiateSpy).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.dispatchHooks — async-tool park', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const parkedState = {
    metadata: { agentId: 'a', _hooks: [] },
    status: 'waiting_for_async_tool',
  };

  it('persists the parked status but does NOT fire onComplete or unregister hooks', async () => {
    const lifecycle = buildLifecycle();
    const persistSpy = vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_async_tool');

    expect(persistSpy).toHaveBeenCalledWith('op-1', parkedState, 'waiting_for_async_tool');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(unregisterSpy).not.toHaveBeenCalled();
  });

  it('fires onComplete and unregisters on a terminal completion', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    const doneState = { metadata: { agentId: 'a', _hooks: [] }, status: 'done' };
    await lifecycle.dispatchHooks('op-1', doneState, 'done');

    expect(dispatchSpy).toHaveBeenCalledWith('op-1', 'onComplete', expect.anything(), []);
    expect(unregisterSpy).toHaveBeenCalledWith('op-1');
  });
});

describe('CompletionLifecycle.dispatchHooks — completion notification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockNotifyAgentRunCompleted.mockClear();
  });

  const stubSideEffects = (lifecycle: CompletionLifecycle) => {
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});
    vi.spyOn(verifyServices, 'runVerifyOnCompletion').mockResolvedValue(undefined);
    // The recall gate falls back to the op row when metadata carries no trigger.
    (lifecycle as any).agentOperationModel = { findById: vi.fn(async () => null) };
  };

  const buildDoneState = (metadata: Record<string, unknown> = {}) => ({
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    messages: [{ content: 'final reply', role: 'assistant' }],
    metadata: { _hooks: [], agentId: 'agt_1', topicId: 'tpc_1', ...metadata },
    status: 'done',
  });

  it('notifies with fields mapped from the lifecycle event on a done completion', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks('op-1', buildDoneState({ userId: 'user-2' }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        duration: expect.any(Number),
        lastAssistantContent: 'final reply',
        operationId: 'op-1',
        topicId: 'tpc_1',
        userId: 'user-2',
        // Personal lifecycle (no workspaceId) forwards undefined ⇒ bare link.
        workspaceId: undefined,
      }),
    );
  });

  it('forwards the workspace id so a team run gets a workspace-scoped deep link', async () => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1', 'ws_1');
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks('op-1', buildDoneState({ userId: 'user-2' }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_1' }),
    );
  });

  // 'task' is TopicTrigger.RunTask (the task-runner funnel), not a RequestTrigger member.
  it.each(['task', RequestTrigger.Bot, RequestTrigger.Eval, RequestTrigger.Api])(
    'does not notify for background %s-triggered completions',
    async (trigger) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState({ trigger }), 'done');
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
    },
  );

  // Scheduled = a user-deferred chat turn; Cron = the rate-limit auto-resume of
  // a user's chat turn. Both are "user walked away" runs the recall exists for.
  it.each([RequestTrigger.Chat, RequestTrigger.Scheduled, RequestTrigger.Cron])(
    'notifies for a user-recallable %s-triggered completion',
    async (trigger) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState({ trigger }), 'done');
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to the op row trigger when metadata carries none (synthetic hetero path)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ trigger: RequestTrigger.Bot })),
    };

    // heteroFinish/agentNotify build metadata via buildStateFromInput — no trigger.
    await lifecycle.dispatchHooks('op-1', buildDoneState(), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for internal child runs (verifier/repair pass parentOperationId only)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ parentOperationId: 'op-parent', trigger: null })),
    };

    await lifecycle.dispatchHooks('op-1', buildDoneState(), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for sub-agent completions', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks('op-1', buildDoneState({ isSubAgent: true }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for in-group member completions (orchestrationRole without isSubAgent)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    // execAgentMember stamps in-group members with orchestrationRole: 'member'
    // but NOT isSubAgent — they are internal steps of the supervisor run.
    await lifecycle.dispatchHooks('op-1', buildDoneState({ orchestrationRole: 'member' }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('preserves an in-group member role in synthesized completion state', () => {
    const lifecycle = buildLifecycle();

    const state = (lifecycle as any).buildStateFromInput({
      operationId: 'op-member',
      orchestrationRole: 'member',
    });

    expect(state.metadata.orchestrationRole).toBe('member');
  });

  it.each(['max_steps', 'cost_limit'])(
    'notifies on the success-like capped terminal %s (still produced a deliverable)',
    async (reason) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState(), reason);
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    },
  );

  it('does not notify on error / aborted terminals', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks(
      'op-1',
      { metadata: { _hooks: [], agentId: 'agt_1' }, status: 'error' },
      'error',
    );

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('a notification rejection never breaks the dispatch pipeline', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    // Once-only: a persistent mockRejectedValue would survive afterEach
    // (restoreAllMocks skips plain vi.fn, mockClear keeps implementations)
    // and leak into later dispatchHooks('done') tests in this file.
    mockNotifyAgentRunCompleted.mockRejectedValueOnce(new Error('push provider down'));

    const doneState = { metadata: { _hooks: [], agentId: 'agt_1' }, status: 'done' };
    await expect(lifecycle.dispatchHooks('op-1', doneState, 'done')).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(hookDispatcher.dispatch).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.anything(),
      [],
    );
    expect(hookDispatcher.unregister).toHaveBeenCalledWith('op-1');
  });
});

describe('CompletionLifecycle.dispatchHooks — parks do not register file works', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildRuntimeInterventionNotification.mockReset();
    mockBuildRuntimeInterventionNotification.mockResolvedValue(undefined);
    mockNotifyAgentInterventionRequired.mockReset();
    mockNotifyAgentInterventionRequired.mockResolvedValue(undefined);
  });

  const pendingNotification: NotifyAgentInterventionRequiredParams = {
    approvalMode: 'manual' as const,
    batch: {
      activityKey: '4369e854-719f-5301-bfa4-1f0742eec6ac',
      allowedActions: ['approve_tool', 'reject_continue', 'stop'],
      id: 'batch-1',
      kind: 'single' as const,
      sealed: true as const,
      stepIndex: 3,
    },
    context: {
      assistantMessageId: 'assistant-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    },
    items: [
      {
        allowedActions: ['approve_tool', 'reject_continue', 'stop'],
        interactionKind: 'tool_approval' as const,
        requestRevision: { hash: 'a'.repeat(64), version: 0 },
        sourceRef: {
          toolCallId: 'call-1',
          toolMessageId: 'tool-1',
          type: 'runtime' as const,
        },
        summary: 'Run command',
        surface: 'binary' as const,
      },
    ],
    summary: 'Approval required',
    systemActionEligibility: 'safe_single_binary' as const,
    userId: 'user-1',
  };

  const stubDurablePendingRows = (lifecycle: CompletionLifecycle) => {
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockResolvedValue({
        id: 'tool-1',
        parentId: 'assistant-1',
        role: 'tool',
        topicId: 'topic-1',
      }),
      findMessagePlugin: vi.fn().mockResolvedValue({
        intervention: {
          batchId: 'batch-1',
          itemIndex: 0,
          operationId: 'op-1',
          status: 'pending',
          stepIndex: 3,
        },
        toolCallId: 'call-1',
      }),
    };
  };

  it('publishes Review only after operation and every sealed batch row are durable', async () => {
    const lifecycle = buildLifecycle();
    const order: string[] = [];
    vi.spyOn(lifecycle as any, 'persistCompletion').mockImplementation(async () => {
      order.push('persist-operation');
      return true;
    });
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockImplementation(async () => {
      order.push('notify');
    });
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockImplementation(async () => {
        order.push('read-message');
        return {
          id: 'tool-1',
          parentId: 'assistant-1',
          role: 'tool',
          topicId: 'topic-1',
        };
      }),
      findMessagePlugin: vi.fn().mockImplementation(async () => {
        order.push('read-plugin');
        return {
          intervention: {
            batchId: 'batch-1',
            itemIndex: 0,
            operationId: 'op-1',
            status: 'pending',
            stepIndex: 3,
          },
          toolCallId: 'call-1',
        };
      }),
    };
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await lifecycle.dispatchHooks(
      'op-1',
      { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' },
      'waiting_for_human',
    );

    expect(mockNotifyAgentInterventionRequired).toHaveBeenCalledWith(pendingNotification);
    expect(order[0]).toBe('persist-operation');
    expect(order.at(-1)).toBe('notify');
  });

  it('fails the parked lifecycle when one row is outside the sealed batch', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockResolvedValue({
        id: 'tool-1',
        parentId: 'assistant-1',
        role: 'tool',
        topicId: 'topic-1',
      }),
      findMessagePlugin: vi.fn().mockResolvedValue({
        intervention: {
          batchId: 'late-batch',
          itemIndex: 0,
          operationId: 'op-1',
          status: 'pending',
          stepIndex: 3,
        },
        toolCallId: 'call-1',
      }),
    };
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).rejects.toBeInstanceOf(CriticalAgentInterventionPersistenceError);

    expect(mockNotifyAgentInterventionRequired).not.toHaveBeenCalled();
  });

  it('propagates a durable Review create failure so the parked lifecycle can retry', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockRejectedValueOnce(new Error('database unavailable'));
    stubDurablePendingRows(lifecycle);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregister = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'database unavailable' }),
      name: 'CriticalAgentInterventionPersistenceError',
    });

    expect(hookDispatcher.dispatch).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('continues after post-create push fanout fails inside the business slot', async () => {
    const lifecycle = buildLifecycle();
    const pushFanout = vi.fn().mockRejectedValue(new Error('APNs unavailable'));
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockImplementation(async () => {
      // Cloud owns this boundary: the generic row is already durable here, so
      // downstream delivery is best-effort and must not reject the slot.
      await pushFanout().catch(() => undefined);
    });
    stubDurablePendingRows(lifecycle);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).resolves.toBeUndefined();

    expect(pushFanout).toHaveBeenCalledOnce();
    expect(hookDispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it('does not build a Review when the parked operation persistence loses its CAS', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(false);

    await lifecycle.dispatchHooks(
      'op-1',
      { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' },
      'waiting_for_human',
    );

    expect(mockBuildRuntimeInterventionNotification).not.toHaveBeenCalled();
    expect(mockNotifyAgentInterventionRequired).not.toHaveBeenCalled();
  });

  // Regression: the park is not a completed deliverable boundary. The fresh
  // continuation sees the complete history and performs the terminal scan;
  // registering here would freeze pre-approval file content too early.
  it('does NOT register on a human-approval park before its continuation', async () => {
    const mockRegister = vi.mocked(registerWorksForOperation);
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});

    const parkedState = { metadata: { _hooks: [], agentId: 'a' }, status: 'waiting_for_human' };
    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_human');

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does NOT register on an async-tool park (same op resumes and registers later)', async () => {
    const mockRegister = vi.mocked(registerWorksForOperation);
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);

    const parkedState = {
      metadata: { _hooks: [], agentId: 'a' },
      status: 'waiting_for_async_tool',
    };
    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_async_tool');

    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.dispatchHooks — lastAssistantContent DB recovery (Discord bot empty-reply)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildDoneState = (assistantContent: string | undefined) => ({
    messages: [
      { content: 'user prompt', id: 'msg-user', role: 'user' },
      { content: assistantContent, id: 'msg-assistant', role: 'assistant' },
    ],
    metadata: { _hooks: [], agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
    status: 'done',
  });

  const setupSpies = (lifecycle: CompletionLifecycle) => {
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(verifyServices, 'runVerifyOnCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
  };

  it('recovers the reply text from the DB row when the state carries no assistant text', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn().mockResolvedValue({ content: 'the real reply', id: 'msg-assistant' });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(findById).toHaveBeenCalledWith('msg-assistant');
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: 'the real reply' }),
      [],
    );
  });

  it('recovers by the final assistantGroup child id when grouped state carries no text', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn().mockResolvedValue({
      content: 'the grouped reply from DB',
      id: 'msg-group-final',
    });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks(
      'op-1',
      {
        messages: [
          { content: 'user prompt', id: 'msg-user', role: 'user' },
          {
            children: [
              { content: '', id: 'msg-tool-call', tools: [{ id: 'tool-call-1' }] },
              { content: '', id: 'msg-group-final' },
            ],
            content: '',
            id: 'msg-group',
            role: 'assistantGroup',
          },
        ],
        metadata: { _hooks: [], agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
        status: 'done',
      },
      'done',
    );

    expect(findById).toHaveBeenCalledWith('msg-group-final');
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: 'the grouped reply from DB' }),
      [],
    );
  });

  it('does not hit the DB when the state already carries assistant text', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn();
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState('state reply'), 'done');

    expect(findById).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: 'state reply' }),
      [],
    );
  });

  it('extracts only text parts when the DB row stores serialized multimodal content', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const serialized = JSON.stringify([
      { text: '图里是一只猫', type: 'text' },
      { image: 'data:image/png;base64,xxx', type: 'image' },
    ]);
    const findById = vi.fn().mockResolvedValue({
      content: serialized,
      id: 'msg-assistant',
      metadata: { isMultimodal: true },
    });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: '图里是一只猫' }),
      [],
    );
  });

  it('returns a plain-text reply verbatim even when it looks like a parts array', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    // A legitimate text answer that happens to be a JSON array with `type`
    // fields — without metadata.isMultimodal it must NOT be parsed as parts.
    const jsonLookalike = '[{"type":"custom","value":1}]';
    const findById = vi.fn().mockResolvedValue({ content: jsonLookalike, id: 'msg-assistant' });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: jsonLookalike }),
      [],
    );
  });

  it('does not recover raw JSON from an image-only multimodal DB row', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const serialized = JSON.stringify([{ image: 'data:image/png;base64,xxx', type: 'image' }]);
    const findById = vi.fn().mockResolvedValue({
      content: serialized,
      id: 'msg-assistant',
      metadata: { isMultimodal: true },
    });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: undefined }),
      [],
    );
  });

  it('leaves the event untouched when the DB row is empty too', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn().mockResolvedValue({ content: '', id: 'msg-assistant' });
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: undefined }),
      [],
    );
  });

  it('still dispatches the original event when the DB lookup throws', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn().mockRejectedValue(new Error('db down'));
    (lifecycle as any).messageModel = { findById };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: undefined }),
      [],
    );
  });

  it('skips recovery on the error path', async () => {
    const lifecycle = buildLifecycle();
    setupSpies(lifecycle);
    const findById = vi.fn();
    (lifecycle as any).messageModel = { findById, update: vi.fn().mockResolvedValue(undefined) };

    await lifecycle.dispatchHooks(
      'op-1',
      { ...buildDoneState(''), error: { message: 'boom' }, status: 'error' },
      'error',
    );

    expect(findById).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.emitSignalEvents — assistant anchor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ships the resolved assistantMessageId on the completed payload for a server turn', async () => {
    // Regression: on a server execAgent turn the operation metadata has no
    // assistantMessageId, so the agent.execution.completed event used to carry
    // assistantMessageId=undefined and the deferred skill-synthesis handler
    // no-oped. The payload must now anchor to the final assistant message row
    // (so deferred skill synthesis seeds the skill under the completed turn's
    // assistant group, not as a floating mainline root).
    const emitSpy = vi
      .spyOn(agentSignalService, 'emitAgentSignalSourceEvent')
      .mockResolvedValue(undefined as any);

    const lifecycle = buildLifecycle();
    const state = {
      messages: [
        { content: 'user prompt', id: 'msg-user', role: 'user' },
        { content: 'final answer', id: 'msg-assistant', role: 'assistant' },
      ],
      metadata: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
      stepCount: 2,
    };

    await lifecycle.emitSignalEvents('op-1', state, 'done');

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [emission] = emitSpy.mock.calls[0];
    expect(emission.sourceType).toBe('agent.execution.completed');
    expect(emission.payload).toMatchObject({
      anchorMessageId: 'msg-assistant',
      assistantMessageId: 'msg-assistant',
    });
  });

  it('hydrates a persisted self-reflection marker when terminal state metadata lost it', async () => {
    const emitSpy = vi
      .spyOn(agentSignalService, 'emitAgentSignalSourceEvent')
      .mockResolvedValue(undefined as any);
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn().mockResolvedValue({
        metadata: {
          agentSignal: {
            agentId: 'agent-1',
            kind: 'self-reflection',
            sourceId: 'reflection-source-1',
            topicId: 'tpc-1',
          },
        },
      }),
    };

    await lifecycle.emitSignalEvents(
      'op-1',
      {
        messages: [{ content: 'review complete', id: 'msg-assistant', role: 'assistant' }],
        metadata: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
        stepCount: 1,
      },
      'done',
    );

    const [emission] = emitSpy.mock.calls[0];
    expect(emission.payload).toMatchObject({
      selfIteration: {
        marker: {
          agentId: 'agent-1',
          kind: 'self-reflection',
          sourceId: 'reflection-source-1',
          topicId: 'tpc-1',
        },
        userId: 'user-1',
      },
    });
  });
});

describe('CompletionLifecycle.registerFileWorks', () => {
  const mockRegister = vi.mocked(registerWorksForOperation);

  it('registers once and stamps the state marker so later calls skip', async () => {
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 1, failed: 0 });
    const lifecycle = buildLifecycle();
    const state = {
      cost: { total: 1.25 },
      metadata: { userId: 'user-2' },
      usage: { llm: { apiCalls: 2 } },
    } as any;

    await lifecycle.registerFileWorks('op-1', state);

    expect(mockRegister).toHaveBeenCalledTimes(1);
    // The terminal state's live totals ride along: on the pre-snapshot path the
    // op row's cost/usage columns are not persisted yet.
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        finalCost: { total: 1.25 },
        finalUsage: { llm: { apiCalls: 2 } },
        operationId: 'op-1',
        userId: 'user-2',
      }),
    );
    expect(state.metadata._fileWorksRegistered).toBe(true);

    // The dispatchHooks backstop receives the same state later in the request —
    // the marker must make that second call a no-op (no duplicate scan/export).
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('never throws and leaves the marker unset on failure so a later call retries', async () => {
    mockRegister.mockClear();
    mockRegister.mockRejectedValueOnce(new Error('sandbox export failed'));
    const lifecycle = buildLifecycle();
    const state = { metadata: {} } as any;

    await expect(lifecycle.registerFileWorks('op-1', state)).resolves.toBeUndefined();
    expect(state.metadata._fileWorksRegistered).toBeUndefined();

    mockRegister.mockResolvedValueOnce({ attempted: 1, failed: 0 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(state.metadata._fileWorksRegistered).toBe(true);
  });

  it('leaves the marker unset on a PARTIAL failure, then stamps it once all files land', async () => {
    // Regression: registerWorksForOperation swallows per-file failures and
    // never rejects, so a partial failure resolves normally. The marker must be
    // gated on the outcome (`failed === 0`), NOT stamped unconditionally — else
    // the dispatchHooks backstop skips the retry and the user gets neither a Work
    // nor the edited-files fallback card for the file that failed to export.
    mockRegister.mockClear();
    const lifecycle = buildLifecycle();
    const state = { metadata: {} } as any;

    // One of two files failed to export/register this round.
    mockRegister.mockResolvedValueOnce({ attempted: 2, failed: 1 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(state.metadata._fileWorksRegistered).toBeUndefined();

    // The backstop retries; the previously-registered file short-circuits on the
    // DB probe and the failed one now lands → failed=0 → marker set.
    mockRegister.mockResolvedValueOnce({ attempted: 2, failed: 0 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(state.metadata._fileWorksRegistered).toBe(true);
  });

  it('tolerates a state without metadata', async () => {
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();

    await expect(lifecycle.registerFileWorks('op-1', {} as any)).resolves.toBeUndefined();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
