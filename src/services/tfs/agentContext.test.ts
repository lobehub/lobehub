import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTfsAgentContext, withTfsInitialContext } from './agentContext';

const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock('@/services/tfs', () => ({ tfsService: { agentContext: mocks.context } }));

describe('TFS browser context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue('<tfs_repositories>repo</tfs_repositories>');
  });

  it('adds repositories to the browser runtime without losing other project context', async () => {
    const initial = { projectContext: { contextPrompt: 'Project members and tasks' } };
    const result = await withTfsInitialContext(initial, 'topic-1');
    expect(result?.projectContext?.contextPrompt).toContain('Project members and tasks');
    expect(result?.projectContext?.contextPrompt).toContain('<tfs_repositories>');
    expect(initial.projectContext.contextPrompt).toBe('Project members and tasks');
  });

  it('returns the original context unchanged for a GitHub-only conversation', async () => {
    mocks.context.mockResolvedValue(undefined);
    const initial = { projectContext: { contextPrompt: 'GitHub project' } };
    expect(await withTfsInitialContext(initial, 'topic')).toBe(initial);
  });

  it('withholds owner repository metadata from share visitors', async () => {
    expect(await withTfsInitialContext(undefined, 'topic', true)).toBeUndefined();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('does not read an unrelated active topic for a new conversation', async () => {
    expect(await loadTfsAgentContext()).toBeUndefined();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('reads updated metadata on later turns', async () => {
    await loadTfsAgentContext('topic');
    mocks.context.mockResolvedValue('new branch');
    expect(await loadTfsAgentContext('topic')).toBe('new branch');
    expect(mocks.context).toHaveBeenCalledTimes(2);
  });

  it('keeps the browser runtime usable when the optional lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.context.mockRejectedValue(new Error('offline'));
      const initial = { projectContext: { contextPrompt: 'project' } };
      expect(await withTfsInitialContext(initial, 'topic')).toBe(initial);
    } finally {
      error.mockRestore();
    }
  });
});
