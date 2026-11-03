// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as agentSignalService from '@/server/services/agentSignal';
import * as verifyServices from '@/server/services/verify';
import type * as WorkRegistrationModule from '@/server/services/workRegistration';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  // Keep the real scope resolver: it is pure, and the share-visitor test
  // asserts the scope it derives reaches both the scan and the anchor lookup.
  ...(await importOriginal<typeof WorkRegistrationModule>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.dispatchHooks — lastAssistantContent DB recovery (Discord bot empty-reply)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildDoneState = (assistantContent: string | undefined) => ({
    messages: [
      { content: 'user prompt', id: 'msg-user', role: 'user' },
      { content: assistantContent, id: 'msg-assistant', role: 'assistant' },
    ],
    host: { hooks: [] },
    origin: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
    status: 'done',
  });

  const setupSpies = (lifecycle: CompletionLifecycle) => {
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(verifyServices, 'runVerifyOnCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    vi.spyOn(console, 'warn').mockImplementation(function () {});
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

  it('extracts final Markdown images when the reply is recovered from the database', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const content = '![Result](https://cdn.example.com/recovered.png)';
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockResolvedValue({ content, id: 'msg-assistant' }),
    };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({
        attachments: [{ fetchUrl: 'https://cdn.example.com/recovered.png', type: 'image' }],
        lastAssistantContent: content,
      }),
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
        host: { hooks: [] },
        origin: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
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

  // The named row can be an empty placeholder while the run's real reply sits
  // on another row (the Discord thread bug where the bot kept repeating the
  // same message). Resolve it by the run's own provenance
  // (`metadata.operationId`), never by "the latest assistant row in the topic" —
  // a topic can hold a concurrent run's rows.
  it('falls back to operation provenance when the named row is empty', async () => {
    const lifecycle = buildLifecycle();
    const dispatchSpy = setupSpies(lifecycle);
    const findById = vi.fn().mockResolvedValue({ content: '', id: 'msg-assistant' });
    const findLatestAssistantByOperationId = vi
      .fn()
      .mockResolvedValue({ content: 'final step reply', id: 'msg-final-step' });
    (lifecycle as any).messageModel = { findById, findLatestAssistantByOperationId };

    await lifecycle.dispatchHooks('op-1', buildDoneState(''), 'done');

    expect(findById).toHaveBeenCalledWith('msg-assistant');
    expect(findLatestAssistantByOperationId).toHaveBeenCalledWith({
      operationId: 'op-1',
      topicId: 'tpc-1',
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.objectContaining({ lastAssistantContent: 'final step reply' }),
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
      origin: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
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

  it('reads a memory-writer run thread when the terminal state carries no messages', async () => {
    const emitSpy = vi
      .spyOn(agentSignalService, 'emitAgentSignalSourceEvent')
      .mockResolvedValue(undefined as any);
    const lifecycle = buildLifecycle();
    const query = vi.spyOn(lifecycle['messageModel'], 'query').mockResolvedValue([
      {
        id: 'msg-tool-call',
        role: 'assistant',
        tools: [
          {
            apiName: 'addPreferenceMemory',
            arguments: JSON.stringify({
              summary: 'Answer in bullets',
              title: 'Prefers bullet answers',
            }),
            id: 'call_pref',
            identifier: 'lobe-user-memory',
            type: 'builtin',
          },
        ],
      },
      {
        content: 'Preference memory saved with memoryId: "mem_1" and preferenceId: "pref_1"',
        id: 'msg-tool-result',
        role: 'tool',
        tool_call_id: 'call_pref',
      },
    ] as any);

    await lifecycle.emitSignalEvents(
      'op-memory',
      {
        messages: [],
        origin: {
          agentId: 'agent-1',
          signal: { kind: 'memory', sourceId: 'memory-source-1', topicId: 'tpc-1' },
          threadId: 'thd-memory',
          topicId: 'tpc-1',
          userId: 'user-1',
        },
        stepCount: 3,
        usage: {
          tools: {
            byTool: [{ calls: 1, errors: 0, name: 'lobe-user-memory/addPreferenceMemory' }],
          },
        },
      },
      'done',
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thd-memory', topicId: 'tpc-1' }),
      expect.anything(),
    );
    const [emission] = emitSpy.mock.calls[0];
    expect(emission.payload.selfIteration.mutations[0].data.target).toMatchObject({
      id: 'pref_1',
      memoryId: 'mem_1',
      title: 'Prefers bullet answers',
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
        origin: { agentId: 'agent-1', topicId: 'tpc-1', userId: 'user-1' },
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
