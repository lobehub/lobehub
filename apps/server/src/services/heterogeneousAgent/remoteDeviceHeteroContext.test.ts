import { describe, expect, it } from 'vitest';

import { buildRemoteDeviceHeteroContext } from './remoteDeviceHeteroContext';

describe('buildRemoteDeviceHeteroContext', () => {
  it('returns undefined when there is nothing to inject', () => {
    expect(buildRemoteDeviceHeteroContext({})).toBeUndefined();
    expect(buildRemoteDeviceHeteroContext({ agentSystemContext: '   ' })).toBeUndefined();
    expect(buildRemoteDeviceHeteroContext({ conversationHistory: [] })).toBeUndefined();
  });

  it('puts the agent static context first', () => {
    const result = buildRemoteDeviceHeteroContext({ agentSystemContext: 'Follow the repo rules.' });
    expect(result).toBe('Follow the repo rules.');
  });

  it('appends and truncates prior conversation turns', () => {
    const result = buildRemoteDeviceHeteroContext({
      conversationHistory: [
        { content: 'a'.repeat(2000), role: 'user' },
        { content: 'short reply', role: 'assistant' },
      ],
    });
    expect(result).toContain('<previous_conversation>');
    expect(result).toContain('… [truncated]'); // user turn exceeds the 1 KB cap
    expect(result).toContain('short reply');
  });

  it('orders the agent context before conversation history without workspace boilerplate', () => {
    const result = buildRemoteDeviceHeteroContext({
      agentSystemContext: 'AGENT_CTX',
      conversationHistory: [{ content: 'HIST', role: 'user' }],
    })!;
    expect(result.indexOf('AGENT_CTX')).toBeLessThan(result.indexOf('<previous_conversation>'));
    expect(result).not.toContain('## Workspace');
  });
});
