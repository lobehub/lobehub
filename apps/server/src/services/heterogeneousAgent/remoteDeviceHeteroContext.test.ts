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

  it('names the active worktree and the source repo to fall back to', () => {
    const result = buildRemoteDeviceHeteroContext({
      activeWorktree: { path: '/repo-wt', sourceDirectory: '/repo' },
    })!;
    expect(result).toContain('<active_worktree>');
    expect(result).toContain('selected git worktree is /repo-wt');
    expect(result).toContain('If it no longer exists, work in /repo.');
  });

  it('says nothing about a worktree that is the source repo itself', () => {
    expect(
      buildRemoteDeviceHeteroContext({
        activeWorktree: { path: '/repo', sourceDirectory: '/repo' },
      }),
    ).toBeUndefined();
  });

  it('appends unanswered user messages after the agent context', () => {
    const result = buildRemoteDeviceHeteroContext({
      agentSystemContext: 'AGENT_CTX',
      unansweredUserTurns: [{ content: 'Clone the repo', files: [] }],
    })!;
    expect(result.indexOf('AGENT_CTX')).toBeLessThan(result.indexOf('<unanswered_user_messages>'));
    expect(result).toContain('Clone the repo');
  });
});
