import { describe, expect, it } from 'vitest';

import { resolveProducerScopeKey, resolveRuntimeScopeKey } from '../runtime/scope';

describe('Agent Signal scope key resolution', () => {
  it('prefers topic scope for producer input when topicId exists', () => {
    expect(resolveProducerScopeKey({ topicId: 't1' })).toBe('topic:t1');
  });

  it('falls back to bot scope for producer input when topicId is missing', () => {
    expect(
      resolveProducerScopeKey({
        applicationId: 'app',
        platform: 'wechat',
        platformThreadId: 'th1',
      }),
    ).toBe('bot:wechat:app:th1');
  });

  it('falls back to global scope for producer input when no routing identifiers exist', () => {
    expect(resolveProducerScopeKey({})).toBe('fallback:global');
  });

  it('prefers semantic runtime scope ordering for runtime input', () => {
    expect(
      resolveRuntimeScopeKey({
        agentId: 'agent-1',
        botScopeKey: 'bot:wechat:app:thread-1',
        taskId: 'task-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).toBe('topic:topic-1');
  });

  it('falls back through bot, task, agent, then user scope for runtime input', () => {
    expect(
      resolveRuntimeScopeKey({
        botScopeKey: 'bot:wechat:app:thread-1',
        userId: 'user-1',
      }),
    ).toBe('bot:wechat:app:thread-1');
    expect(
      resolveRuntimeScopeKey({
        taskId: 'task-1',
        userId: 'user-1',
      }),
    ).toBe('task:task-1');
    expect(
      resolveRuntimeScopeKey({
        agentId: 'agent-1',
        userId: 'user-1',
      }),
    ).toBe('agent:agent-1:user:user-1');
    expect(
      resolveRuntimeScopeKey({
        userId: 'user-1',
      }),
    ).toBe('user:user-1');
  });
});
