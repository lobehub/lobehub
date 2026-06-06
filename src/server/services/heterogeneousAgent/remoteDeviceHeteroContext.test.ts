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

  it('describes the working directory without cloud-sandbox boilerplate', () => {
    const result = buildRemoteDeviceHeteroContext({ cwd: '/Users/alice/projects/app' });
    expect(result).toContain('/Users/alice/projects/app');
    expect(result).toContain("user's own machine");
    // Must NOT leak the cloud-sandbox context.
    expect(result).not.toContain('/workspace');
    expect(result).not.toContain('ephemeral');
    expect(result).not.toContain('cloud sandbox');
  });

  it('trims a blank cwd instead of emitting an empty workspace note', () => {
    expect(buildRemoteDeviceHeteroContext({ cwd: '   ' })).toBeUndefined();
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

  it('orders sections: agent context → workspace → history', () => {
    const result = buildRemoteDeviceHeteroContext({
      agentSystemContext: 'AGENT_CTX',
      conversationHistory: [{ content: 'HIST', role: 'user' }],
      cwd: '/repo',
    })!;
    expect(result.indexOf('AGENT_CTX')).toBeLessThan(result.indexOf('/repo'));
    expect(result.indexOf('/repo')).toBeLessThan(result.indexOf('<previous_conversation>'));
  });
});
