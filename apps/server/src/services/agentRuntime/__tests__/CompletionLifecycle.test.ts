// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as agentSignalService from '@/server/services/agentSignal';
import * as verifyServices from '@/server/services/verify';

import { CompletionLifecycle } from '../CompletionLifecycle';
import { hookDispatcher } from '../hooks';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

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
});
