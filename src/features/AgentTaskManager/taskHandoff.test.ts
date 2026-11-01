import { describe, expect, it } from 'vitest';

import { buildTaskHandoffPath, resolveTaskHandoffTopic } from './taskHandoff';

describe('task handoff', () => {
  it('encodes the Inbox agent and task topic in the task workspace route', () => {
    expect(buildTaskHandoffPath('inbox/agent', 'topic?id')).toBe(
      '/tasks?agentId=inbox%2Fagent&topicId=topic%3Fid',
    );
  });

  it('restores the routed topic when it belongs to the selected agent', () => {
    expect(
      resolveTaskHandoffTopic({
        routedAgentId: 'inbox',
        routedTopicId: 'topic-1',
        selectedAgentId: 'inbox',
      }),
    ).toBe('topic-1');
    expect(
      resolveTaskHandoffTopic({
        routedAgentId: 'inbox',
        routedTopicId: 'topic-1',
        selectedAgentId: 'another-agent',
      }),
    ).toBeNull();
  });
});
