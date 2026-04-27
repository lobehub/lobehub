import { describe, expect, it } from 'vitest';

import { resolveAgentTopicGroupMode } from './topicGroupMode';

describe('resolveAgentTopicGroupMode', () => {
  it('defaults Claude Code agents to project grouping', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'claude-code',
        globalMode: 'byTime',
      }),
    ).toBe('byProject');
  });

  it('defaults Codex agents to project grouping', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'codex',
        globalMode: 'byTime',
      }),
    ).toBe('byProject');
  });

  it('keeps normal agents on the global default grouping', () => {
    expect(resolveAgentTopicGroupMode({ globalMode: 'byTime' })).toBe('byTime');
  });

  it('respects a non-default global selection', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'claude-code',
        globalMode: 'flat',
      }),
    ).toBe('flat');
  });

  it('uses the agent-specific selection when present', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentSpecificMode: 'byTime',
        agentType: 'codex',
        globalMode: 'byTime',
      }),
    ).toBe('byTime');
  });
});
