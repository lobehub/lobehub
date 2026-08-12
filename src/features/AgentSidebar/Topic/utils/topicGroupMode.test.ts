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

  it.each(['amp', 'codebuddy', 'opencode', 'pi', 'qoder'] as const)(
    'defaults %s agents to project grouping',
    (agentType) => {
      expect(
        resolveAgentTopicGroupMode({
          agentType,
          globalMode: 'byTime',
        }),
      ).toBe('byProject');
    },
  );

  it('keeps remote heterogeneous agents on the global default grouping', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'openclaw',
        globalMode: 'byTime',
      }),
    ).toBe('byTime');
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'hermes',
        globalMode: 'flat',
      }),
    ).toBe('flat');
  });

  it('keeps normal agents on the global default grouping', () => {
    expect(resolveAgentTopicGroupMode({ globalMode: 'byTime' })).toBe('byTime');
  });

  it('keeps Claude Code agents on project grouping when the global selection changes', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentType: 'claude-code',
        globalMode: 'flat',
      }),
    ).toBe('byProject');
  });

  it('uses the global selection for normal agents', () => {
    expect(resolveAgentTopicGroupMode({ globalMode: 'flat' })).toBe('flat');
  });

  it('uses the agent chat config selection when present', () => {
    expect(
      resolveAgentTopicGroupMode({
        agentTopicGroupMode: 'byTime',
        agentType: 'codex',
        globalMode: 'byTime',
      }),
    ).toBe('byTime');
  });
});
