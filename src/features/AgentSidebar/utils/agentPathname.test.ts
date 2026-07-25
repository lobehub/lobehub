import { describe, expect, it } from 'vitest';

import { buildPrefixedAgentRoutePath, parseAgentPathname } from './agentPathname';

describe('agentPathname', () => {
  it('parses an agent route without a prefix', () => {
    expect(parseAgentPathname('/agent/agent-1/topic-1')).toEqual({
      agentId: 'agent-1',
      prefix: '',
      segmentsAfterAgent: ['topic-1'],
    });
  });

  it('parses workspace and proxy prefixes before the agent segment', () => {
    expect(parseAgentPathname('/team/agent/agent-1/profile')).toEqual({
      agentId: 'agent-1',
      prefix: '/team',
      segmentsAfterAgent: ['profile'],
    });

    expect(parseAgentPathname('/_dangerous_local_dev_proxy/agent/agent-1/profile')).toEqual({
      agentId: 'agent-1',
      prefix: '/_dangerous_local_dev_proxy',
      segmentsAfterAgent: ['profile'],
    });
  });

  it('ignores paths without an agent id', () => {
    expect(parseAgentPathname('/settings/profile')).toBeUndefined();
    expect(parseAgentPathname('/team/agent')).toBeUndefined();
  });

  it('preserves a detected prefix only when workspace navigation cannot restore it', () => {
    const route = parseAgentPathname('/team/agent/agent-1/profile');

    expect(buildPrefixedAgentRoutePath('/agent/agent-1/topic-1', route, null)).toBe(
      '/team/agent/agent-1/topic-1',
    );
    expect(buildPrefixedAgentRoutePath('/agent/agent-1/topic-1', route, 'team')).toBe(
      '/agent/agent-1/topic-1',
    );
  });
});
