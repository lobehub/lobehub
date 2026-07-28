import { describe, expect, it } from 'vitest';

import { buildTaskHandoffPath, isTaskHandoffTopic } from './taskHandoff';

describe('task handoff', () => {
  it('encodes the Inbox agent and task topic in the task workspace route', () => {
    expect(buildTaskHandoffPath('inbox/agent', 'topic?id')).toBe(
      '/tasks?agentId=inbox%2Fagent&topicId=topic%3Fid',
    );
  });

  it('preserves only the routed topic owned by the selected agent', () => {
    expect(
      isTaskHandoffTopic({
        activeTopicId: 'topic-1',
        routedAgentId: 'inbox',
        routedTopicId: 'topic-1',
        selectedAgentId: 'inbox',
      }),
    ).toBe(true);
    expect(
      isTaskHandoffTopic({
        activeTopicId: 'topic-2',
        routedAgentId: 'inbox',
        routedTopicId: 'topic-1',
        selectedAgentId: 'inbox',
      }),
    ).toBe(false);
  });
});
