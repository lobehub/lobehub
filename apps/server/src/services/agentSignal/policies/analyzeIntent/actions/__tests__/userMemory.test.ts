// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import {
  buildUserMemoryActionAgentSignalMarker,
  defineUserMemoryActionHandler,
  resolveMemoryActionTargetFromState,
} from '../userMemory';

const memoryActionRunner = vi.fn();

const context = {
  now: () => 1,
  runtimeState: {
    getGuardState: vi.fn().mockResolvedValue({}),
    touchGuardState: vi.fn().mockResolvedValue({}),
  },
  scopeKey: 'topic:topic-1',
} as const satisfies RuntimeProcessorContext;

describe('defineUserMemoryActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the memory action through the injected memory agent runner', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_memory_agent',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
          evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
          feedbackHint: 'not_satisfied',
          idempotencyKey: 'source_1:memory:msg_1',
          message: 'Going forward, keep code review comments concise and file-specific.',
          reason: 'durable future preference for code review',
          serializedContext: '{"surface":"chat"}',
          sourceHints: { intents: ['memory'] },
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).toHaveBeenCalledWith({
      agentId: 'agent_1',
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
      evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
      feedbackHint: 'not_satisfied',
      message: 'Going forward, keep code review comments concise and file-specific.',
      reason: 'durable future preference for code review',
      serializedContext: '{"surface":"chat"}',
      sourceHints: { intents: ['memory'] },
      topicId: 'topic_1',
    });
    expect(result?.status).toBe('applied');
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  it('isolates the memory-agent thread on the user message id when no assistant boundary exists', async () => {
    // Non-clientRuntimeComplete source: sourceId has no `:completion:` segment,
    // so assistantMessageId is absent. The run must still create a child thread
    // under the triggering user message instead of leaking into the main topic.
    memoryActionRunner.mockResolvedValue({ status: 'applied' });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    await handler.handle(
      {
        actionId: 'act_memory_fallback_thread',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_user_1',
          message: 'Remember that I prefer concise answers.',
          messageId: 'msg_user_1',
          topicId: 'topic_1',
        },
        signal: { signalId: 'sig_1', signalType: 'signal.feedback.domain.memory' },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMessageId: 'msg_user_1', topicId: 'topic_1' }),
    );
  });

  it('returns the applied memory target from the memory agent runner', async () => {
    memoryActionRunner.mockResolvedValue({
      detail: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      status: 'applied',
      target: {
        id: 'mem_td3XirTeX4f7',
        memoryId: 'mem_8gISOK6BhxGP',
        memoryLayer: LayersEnum.Preference,
        summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
        title: '偏好更详细、更长的回答段落',
        type: 'memory',
      },
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_memory_target',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_1',
          message:
            '<speaker id="833816919" username="nivra2000" nickname="Aa T" />\n每一块都有点太短了？能否长一点呢',
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      output: {
        target: {
          id: 'mem_td3XirTeX4f7',
          memoryId: 'mem_8gISOK6BhxGP',
          memoryLayer: LayersEnum.Preference,
          summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
          title: '偏好更详细、更长的回答段落',
          type: 'memory',
        },
      },
      status: 'applied',
    });
  });

  it('skips memory actions when the feedback message is missing', async () => {
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_missing_message',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          idempotencyKey: 'source_1:memory:msg_missing',
          message: '   ',
        },
        signal: {
          signalId: 'sig_missing',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'Missing memory action message.',
      status: 'skipped',
    });
  });

  it('skips repeated actions after the same idempotency key was already applied', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const getGuardState = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ lastEventAt: 1 });
    const touchGuardState = vi.fn().mockResolvedValue({});
    const idempotentContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_idempotent',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_repeat',
        message: 'Remember that I prefer conclusion-first answers.',
      },
      signal: {
        signalId: 'sig_repeat',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, idempotentContext);
    const second = await handler.handle(action, idempotentContext);

    expect(first?.status).toBe('applied');
    expect(second).toMatchObject({
      detail: 'Action idempotency key already applied.',
      status: 'skipped',
    });
    expect(memoryActionRunner).toHaveBeenCalledTimes(1);
  });

  it('surfaces memory agent failures without marking idempotency', async () => {
    memoryActionRunner.mockResolvedValue({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_failed',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_failed',
          message: 'Remember the style I liked yesterday.',
        },
        signal: {
          signalId: 'sig_failed',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
  });

  it('does not poison the idempotency lane when the first agent attempt fails', async () => {
    memoryActionRunner
      .mockResolvedValueOnce({
        detail: 'Memory action agent finished with an error.',
        status: 'failed',
      })
      .mockResolvedValueOnce({
        status: 'applied',
      });

    const getGuardState = vi.fn().mockResolvedValue({});
    const touchGuardState = vi.fn().mockResolvedValue({});
    const retryableContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_retryable',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_retry',
        message: 'Going forward, remember that I want concise answers.',
      },
      signal: {
        signalId: 'sig_retry',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, retryableContext);
    const second = await handler.handle(action, retryableContext);

    expect(first?.status).toBe('failed');
    expect(second?.status).toBe('applied');
    expect(touchGuardState).toHaveBeenCalledTimes(1);
    expect(memoryActionRunner).toHaveBeenCalledTimes(2);
  });
});

describe('buildUserMemoryActionAgentSignalMarker', () => {
  it('keeps the user message as trigger without using it as the receipt anchor', () => {
    const marker = buildUserMemoryActionAgentSignalMarker({
      messageId: 'msg_user_1',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
    });

    expect(marker).toEqual({
      kind: 'memory',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });
  });

  it('uses the assistant message as anchor while preserving the user trigger', () => {
    const marker = buildUserMemoryActionAgentSignalMarker({
      assistantMessageId: 'msg_assistant_1',
      messageId: 'msg_user_1',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
    });

    expect(marker).toEqual({
      anchorMessageId: 'msg_assistant_1',
      kind: 'memory',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });
  });
});

describe('resolveMemoryActionTargetFromState', () => {
  it('extracts the successful memory title from runtime tool calls', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_bad',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{,',
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_bad',
              type: 'function',
            },
          ],
        },
        {
          content: 'The tool call arguments string is not valid JSON.',
          role: 'tool',
          tool_call_id: 'call_bad',
        },
        {
          id: 'msg_good',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  details: '用户反馈当前回复的每个模块都太短，希望后续展开得更充分。',
                  summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
                  title: '偏好更详细、更长的回答段落',
                  withPreference: {
                    conclusionDirectives: '回答时展开每个段落和模块。',
                  },
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_good',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "偏好更详细、更长的回答段落" saved with memoryId: "mem_8gISOK6BhxGP" and preferenceId: "mem_td3XirTeX4f7"',
          role: 'tool',
          tool_call_id: 'call_good',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'mem_td3XirTeX4f7',
      memoryId: 'mem_8gISOK6BhxGP',
      memoryLayer: LayersEnum.Preference,
      summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      title: '偏好更详细、更长的回答段落',
      type: 'memory',
    });
  });

  it('resolves update identity targets from nested set arguments', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_update_identity',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  id: 'identity-existing',
                  mergeStrategy: 'replace',
                  set: {
                    details: 'The user clarified that they maintain LobeHub Agent Signal code.',
                    summary: 'The user maintains Agent Signal memory receipt behavior.',
                    title: 'Maintains Agent Signal receipts',
                  },
                }),
                name: 'lobe-user-memory____updateIdentityMemory',
              },
              id: 'call_update_identity',
              type: 'function',
            },
          ],
        },
        {
          content: 'Identity memory updated: identity-existing',
          pluginState: { identityId: 'identity-existing' },
          role: 'tool',
          tool_call_id: 'call_update_identity',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'identity-existing',
      memoryLayer: LayersEnum.Identity,
      summary: 'The user maintains Agent Signal memory receipt behavior.',
      title: 'Maintains Agent Signal receipts',
      type: 'memory',
    });
  });

  it('resolves receipt targets from persisted tool snapshots', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_persisted_tool',
          role: 'assistant',
          tools: [
            null,
            {
              apiName: 'addPreferenceMemory',
              arguments: {
                title: 'Persisted preference title',
                withPreference: {
                  conclusionDirectives: 'Use persisted tool metadata for receipt targets.',
                },
              },
              id: 'call_persisted',
              identifier: 'lobe-user-memory',
            },
          ],
        },
        {
          content: 'Preference memory saved',
          plugin: { id: 'call_persisted' },
          pluginState: { memoryId: 'mem_persisted', preferenceId: 'pref_persisted' },
          role: 'tool',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_persisted',
      memoryId: 'mem_persisted',
      memoryLayer: LayersEnum.Preference,
      summary: 'Use persisted tool metadata for receipt targets.',
      title: 'Persisted preference title',
      type: 'memory',
    });
  });

  it('skips confirmed memory tool calls with invalid arguments', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_confirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  details: 'Fallback details for a valid confirmed target.',
                  title: 'Valid confirmed preference',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_confirmed',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Valid confirmed preference" saved with memoryId: "mem_confirmed" and preferenceId: "pref_confirmed"',
          role: 'tool',
          tool_call_id: 'call_confirmed',
        },
        {
          id: 'msg_invalid',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{,',
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_invalid',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Invalid latest preference" saved with memoryId: "mem_invalid" and preferenceId: "pref_invalid"',
          role: 'tool',
          tool_call_id: 'call_invalid',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_confirmed',
      memoryId: 'mem_confirmed',
      memoryLayer: LayersEnum.Preference,
      summary: 'Fallback details for a valid confirmed target.',
      title: 'Valid confirmed preference',
      type: 'memory',
    });
  });

  it('ignores unconfirmed memory write tool calls when resolving receipt targets', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_confirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'The user prefers longer, more developed answers.',
                  title: 'Confirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_confirmed',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Confirmed preference title" saved with memoryId: "mem_confirmed" and preferenceId: "pref_confirmed"',
          role: 'tool',
          tool_call_id: 'call_confirmed',
        },
        {
          id: 'msg_unconfirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'This write was not confirmed by a successful tool result.',
                  title: 'Unconfirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_unconfirmed',
              type: 'function',
            },
          ],
        },
        {
          content: 'addPreferenceMemory with error detail: database timeout',
          role: 'tool',
          tool_call_id: 'call_unconfirmed',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_confirmed',
      memoryId: 'mem_confirmed',
      memoryLayer: LayersEnum.Preference,
      summary: 'The user prefers longer, more developed answers.',
      title: 'Confirmed preference title',
      type: 'memory',
    });
  });

  it('does not resolve a target when no memory write has a successful tool result', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_unconfirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'This write was not confirmed by a successful tool result.',
                  title: 'Unconfirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_unconfirmed',
              type: 'function',
            },
          ],
        },
        {
          content: 'addPreferenceMemory with error detail: database timeout',
          role: 'tool',
          tool_call_id: 'call_unconfirmed',
        },
      ],
    } as never);

    expect(target).toBeUndefined();
  });
});
