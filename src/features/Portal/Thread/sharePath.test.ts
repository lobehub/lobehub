import { describe, expect, it } from 'vitest';

import {
  buildOperationSourcePath,
  buildThreadSharePath,
  PORTAL_THREAD_QUERY_KEY,
} from './sharePath';

describe('buildOperationSourcePath', () => {
  it('points at the agent topic when the turn ran in a one-to-one conversation', () => {
    expect(buildOperationSourcePath({ agentId: 'agt_1', topicId: 'tpc_1' })).toBe(
      '/agent/agt_1/tpc_1',
    );
  });

  it('reopens the thread the turn ran in', () => {
    expect(
      buildOperationSourcePath({ agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' }),
    ).toBe('/agent/agt_1/tpc_1?portalThread=thd_1');
  });

  /**
   * A group's turns live under the group route; routing them through the agent
   * would open the supervisor's own conversation instead of the group the turn
   * actually came from.
   */
  it('points at the group conversation, with or without a thread', () => {
    expect(
      buildOperationSourcePath({
        agentId: 'agt_supervisor',
        chatGroupId: 'grp_1',
        topicId: 'tpc_1',
      }),
    ).toBe('/group/grp_1/tpc_1');

    expect(
      buildOperationSourcePath({
        agentId: 'agt_supervisor',
        chatGroupId: 'grp_1',
        threadId: 'thd_1',
        topicId: 'tpc_1',
      }),
    ).toBe('/group/grp_1/tpc_1?portalThread=thd_1');
  });

  it('has no path without a topic', () => {
    expect(buildOperationSourcePath({ agentId: 'a', topicId: undefined })).toBeUndefined();
    expect(buildOperationSourcePath({ topicId: 't' })).toBeUndefined();
  });
});

describe('buildThreadSharePath', () => {
  it('points at the topic and reopens the thread in the side panel', () => {
    expect(buildThreadSharePath({ agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' })).toBe(
      '/agent/agt_1/tpc_1?portalThread=thd_1',
    );
  });

  it('points at the group topic inside a group, not the supervisor agent', () => {
    expect(
      buildThreadSharePath({
        agentId: 'agt_supervisor',
        groupId: 'grp_1',
        threadId: 'thd_1',
        topicId: 'tpc_1',
      }),
    ).toBe('/group/grp_1/tpc_1?portalThread=thd_1');
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
