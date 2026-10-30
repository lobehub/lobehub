import { describe, expect, it } from 'vitest';

import { freshProjectTopicAgentId } from './freshProjectTopicAgentId';

const fresh = {
  listed: false,
  projectId: 'prj_a',
  storedTopic: { projectId: 'prj_a', sessionId: 'agt_owner' },
  topicId: 'tpc_new',
};

describe('freshProjectTopicAgentId', () => {
  it('returns the owner of a just-created topic of this project before the list has it', () => {
    expect(freshProjectTopicAgentId(fresh)).toBe('agt_owner');
  });

  /** @example Review: project A's cached topic rendered inside project B's conversation URL. */
  it("does not treat another project's cached topic as fresh", () => {
    expect(freshProjectTopicAgentId({ ...fresh, projectId: 'prj_b' })).toBeUndefined();
    expect(
      freshProjectTopicAgentId({
        ...fresh,
        storedTopic: { projectId: null, sessionId: 'agt_owner' },
      }),
    ).toBeUndefined();
  });

  /** @example Review: another pane changed the focused agent, and the fresh topic was rebound to it. */
  it('takes the owner from the topic row, so a topic without one is not adopted', () => {
    expect(
      freshProjectTopicAgentId({ ...fresh, storedTopic: { projectId: 'prj_a' } }),
    ).toBeUndefined();
  });

  it('keeps the remembered owner once a refreshed row no longer carries one', () => {
    const refreshed = { ...fresh, storedTopic: { projectId: 'prj_a' } };

    expect(
      freshProjectTopicAgentId({
        ...refreshed,
        rememberedOwner: { agentId: 'agt_owner', topicId: 'tpc_new' },
      }),
    ).toBe('agt_owner');
    expect(
      freshProjectTopicAgentId({
        ...refreshed,
        rememberedOwner: { agentId: 'agt_owner', topicId: 'tpc_other' },
      }),
    ).toBeUndefined();
  });

  it('is undefined once the project list has the topic', () => {
    expect(freshProjectTopicAgentId({ ...fresh, listed: true })).toBeUndefined();
  });
});
