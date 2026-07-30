import { describe, expect, it } from 'vitest';

import { buildActiveConversationUrl, resolveActiveConversationCoordinate } from './coordinate';

describe('active conversation coordinate', () => {
  it('resolves a workspace topic route and preserves unrelated URL state when changing topic', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a', topicId: 'topic-a' },
      resolvedAgentId: 'agent-a',
      url: '/team/agent/agent-a/topic-a?thread=thread-a&mode=single#message-a',
    });

    expect(coordinate).toMatchObject({
      agentBasePath: '/team/agent/agent-a',
      agentId: 'agent-a',
      isConversation: true,
      routeAgentId: 'agent-a',
      threadId: 'thread-a',
      topicId: 'topic-a',
    });
    expect(buildActiveConversationUrl(coordinate, 'topic-b', null)).toBe(
      '/team/agent/agent-a/topic-b?mode=single#message-a',
    );
  });

  it('does not interpret an agent subpage as a conversation route', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a' },
      resolvedAgentId: 'agent-a',
      url: '/agent/agent-a/profile?thread=stale',
    });

    expect(coordinate.isConversation).toBe(false);
    expect(coordinate.topicId).toBeNull();
    expect(coordinate.threadId).toBeNull();
  });

  it('ignores non-agent routes even when another segment is named agent', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: {},
      url: '/community/agent/example',
    });

    expect(coordinate.routeAgentId).toBeUndefined();
    expect(coordinate.isConversation).toBe(false);
  });
});
