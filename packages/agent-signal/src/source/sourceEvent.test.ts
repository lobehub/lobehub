import { describe, expect, it } from 'vitest';

import { AGENT_SIGNAL_SOURCE_TYPES, createSourceEvent, getSourceEventScopeKey } from './index';

describe('AgentSignal source events', () => {
  /**
   * @example
   * createSourceEvent({ sourceType: 'bot.message.merged', sourceId: 'src-1', payload })
   * returns a normalized source event with a bot thread scope key.
   */
  it('creates a normalized source event with a derived bot thread scope key', () => {
    const event = createSourceEvent({
      payload: {
        applicationId: 'discord-app',
        message: 'hello',
        platform: 'discord',
        platformThreadId: 'thread-1',
      },
      sourceId: 'src-1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
      timestamp: 123,
    });

    expect(event).toEqual({
      payload: {
        applicationId: 'discord-app',
        message: 'hello',
        platform: 'discord',
        platformThreadId: 'thread-1',
      },
      scopeKey: 'bot:discord:discord-app:thread-1',
      sourceId: 'src-1',
      sourceType: 'bot.message.merged',
      timestamp: 123,
    });
  });

  /**
   * @example
   * getSourceEventScopeKey({ topicId: 'topic-1' }) returns 'topic:topic-1'.
   */
  it('prefers topic scope over bot thread scope', () => {
    expect(
      getSourceEventScopeKey({
        applicationId: 'discord-app',
        platform: 'discord',
        platformThreadId: 'thread-1',
        topicId: 'topic-1',
      }),
    ).toBe('topic:topic-1');
  });
});
