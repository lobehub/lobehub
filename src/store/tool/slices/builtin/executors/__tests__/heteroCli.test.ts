import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeExecutor, codexExecutor } from '../heteroCli';

const detectMocks = vi.hoisted(() => ({ applyWorktreeAddFromToolCall: vi.fn() }));

vi.mock('../worktreeDetection', () => ({
  applyWorktreeAddFromToolCall: detectMocks.applyWorktreeAddFromToolCall,
}));

beforeEach(() => vi.clearAllMocks());

describe('heteroCli executors', () => {
  it('registers the CLI adapter identifiers and exposes no invokable APIs', () => {
    expect(claudeCodeExecutor.identifier).toBe('claude-code');
    expect(codexExecutor.identifier).toBe('codex');
    // Empty apiEnum → never treated as an invokable client tool.
    expect(claudeCodeExecutor.hasApi('Bash')).toBe(false);
    expect(claudeCodeExecutor.getApiNames()).toEqual([]);
  });

  it('runs worktree detection on a successful tool call', async () => {
    const params = { command: 'git worktree add /wt' };
    await claudeCodeExecutor.onAfterCall!({
      apiName: 'Bash',
      identifier: 'claude-code',
      params,
      result: { content: '', success: true },
    });
    expect(detectMocks.applyWorktreeAddFromToolCall).toHaveBeenCalledWith(params);
  });

  it('skips detection when the tool call failed', async () => {
    await claudeCodeExecutor.onAfterCall!({
      apiName: 'Bash',
      identifier: 'claude-code',
      params: { command: 'git worktree add /wt' },
      result: { content: 'fatal: ...', success: false },
    });
    expect(detectMocks.applyWorktreeAddFromToolCall).not.toHaveBeenCalled();
  });
});
