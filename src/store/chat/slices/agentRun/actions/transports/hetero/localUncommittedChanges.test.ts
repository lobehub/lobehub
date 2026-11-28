import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLocalHeterogeneousSystemContext } from './localSystemContext';
import { readLocalUncommittedChanges } from './localUncommittedChanges';

const git = vi.hoisted(() => ({
  getGitBranch: vi.fn(),
  getGitWorkingTreeStatus: vi.fn(),
}));
vi.mock('@/services/git', () => ({ gitService: git }));

const topics = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: (id: string) => () => topics.current[id] },
}));

beforeEach(() => {
  vi.clearAllMocks();
  git.getGitBranch.mockResolvedValue({ branch: 'main' });
  git.getGitWorkingTreeStatus.mockResolvedValue({ clean: false, total: 2 });
  topics.current = { tpc: { id: 'tpc', projectId: 'prj' } };
});

describe('readLocalUncommittedChanges', () => {
  it("reads this desktop's checkout for a project conversation in the agent's own directory", async () => {
    const changes = await readLocalUncommittedChanges({} as never, {
      context: { topicId: 'tpc' },
      workingDirectoryConfig: { path: '/repo' },
    });

    expect(changes).toEqual({ count: 2, path: '/repo' });
    expect(git.getGitWorkingTreeStatus).toHaveBeenCalledWith({ path: '/repo' });
    expect(buildLocalHeterogeneousSystemContext({ uncommittedChanges: changes })).toContain(
      '<uncommitted_changes>',
    );
  });

  it('does not read a project folder or a first-send worktree', async () => {
    topics.current = { tpc: { id: 'tpc', projectId: 'prj', projectWorkingDirectoryId: 'dir' } };
    expect(
      await readLocalUncommittedChanges({} as never, {
        context: { topicId: 'tpc' },
        workingDirectoryConfig: { path: '/repo' },
      }),
    ).toBeUndefined();

    topics.current = { tpc: { id: 'tpc', projectId: 'prj' } };
    expect(
      await readLocalUncommittedChanges({} as never, {
        context: { topicId: 'tpc' },
        workingDirectoryConfig: { git: { autoCreated: true }, path: '/repo-wt' } as never,
      }),
    ).toBeUndefined();
    expect(git.getGitWorkingTreeStatus).not.toHaveBeenCalled();
  });

  // Review: the hint repeated on every turn, though a resumed session already
  // holds it and the changes it then finds are the agent's own.
  it('hints only a fresh session', async () => {
    expect(
      await readLocalUncommittedChanges({} as never, {
        context: { topicId: 'tpc' },
        resumeSessionId: 'ses',
        workingDirectoryConfig: { path: '/repo' },
      }),
    ).toBeUndefined();
    expect(git.getGitWorkingTreeStatus).not.toHaveBeenCalled();
  });

  // Review: the run-start config missed a worktree the conversation moved into.
  it("follows the topic's current working directory", async () => {
    topics.current = {
      tpc: {
        id: 'tpc',
        metadata: { workingDirectoryConfig: { git: { activeWorktree: '/wt' }, path: '/repo' } },
        projectId: 'prj',
      },
    };
    expect(
      await readLocalUncommittedChanges({} as never, {
        context: { topicId: 'tpc' },
        workingDirectoryConfig: { path: '/repo' },
      }),
    ).toBeUndefined();
  });
});
