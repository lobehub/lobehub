import { describe, expect, it } from 'vitest';

import { buildThreadSharePath, PORTAL_THREAD_QUERY_KEY } from './sharePath';

describe('buildThreadSharePath', () => {
  it('points at the topic and reopens the thread in the side panel', () => {
    expect(buildThreadSharePath({ agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' })).toBe(
      '/agent/agt_1/tpc_1?portalThread=thd_1',
    );
  });

  it('uses the query key ThreadHydration reads', () => {
    const path = buildThreadSharePath({ agentId: 'a', threadId: 'thd_1', topicId: 't' })!;

    expect(new URL(path, 'https://x').searchParams.get(PORTAL_THREAD_QUERY_KEY)).toBe('thd_1');
    expect(PORTAL_THREAD_QUERY_KEY).toBe('portalThread');
  });

  it('has no path until agent, topic and thread are all known', () => {
    expect(
      buildThreadSharePath({ agentId: 'a', threadId: undefined, topicId: 't' }),
    ).toBeUndefined();
    expect(
      buildThreadSharePath({ agentId: 'a', threadId: 'thd', topicId: undefined }),
    ).toBeUndefined();
    expect(buildThreadSharePath({ agentId: null, threadId: 'thd', topicId: 't' })).toBeUndefined();
  });
});
