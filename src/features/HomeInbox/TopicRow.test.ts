import { describe, expect, it } from 'vitest';

import { getTopicChatUrl } from './TopicRow';

describe('getTopicChatUrl', () => {
  it('opens an agent topic in its agent chat', () => {
    expect(getTopicChatUrl({ agentId: 'agt_1', groupId: null, id: 'tpc_1' })).toBe(
      '/agent/agt_1/tpc_1',
    );
  });

  it('opens a group topic, which has no agent, in its group chat', () => {
    expect(getTopicChatUrl({ agentId: null, groupId: 'grp_1', id: 'tpc_1' })).toBe(
      '/group/grp_1/tpc_1',
    );
  });

  it('has nowhere to go without an agent or a group', () => {
    expect(getTopicChatUrl({ agentId: null, groupId: null, id: 'tpc_1' })).toBeUndefined();
  });
});
