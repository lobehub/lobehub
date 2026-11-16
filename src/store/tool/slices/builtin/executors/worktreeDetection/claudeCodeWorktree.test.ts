import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isWorktreeExitContent,
  parseWorktreeEnterInfo,
  recordWorktreeEnter,
  recordWorktreeExit,
} from './claudeCodeWorktree';

const chatMocks = vi.hoisted(() => ({
  topics: {} as Record<string, { agentId?: string | null; metadata?: Record<string, any> }>,
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@/store/chat/store', () => ({
  getChatStoreState: () => chatMocks,
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: typeof chatMocks) => state.topics[id],
  },
}));

const PR_TOPIC = {
  metadata: { workingDirectoryConfig: { path: '/repo', repoType: 'github' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  chatMocks.topics = {};
});

/**
 * Verbatim `EnterWorktree` / `ExitWorktree` result messages, matching the templates
 * Claude Code builds in its `call()`. Only `message` crosses the wire as the
 * tool_result content, so these strings ARE the contract this module parses.
 */
const SESSION_TAIL =
  'The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.';
const enterCreated = (path: string, branch?: string) =>
  `Created worktree at ${path}${branch ? ` on branch ${branch}` : ''}. ${SESSION_TAIL}`;
const enterExisting = (path: string) => `Entered worktree at ${path}. ${SESSION_TAIL}`;
/** A subagent pinned to its own cwd — it moved only itself, never the session. */
const enterPinnedAgent = (path: string) =>
  `Entered worktree at ${path} on branch worktree-x. This agent's working directory and write access now point at the worktree; the previous directory was left untouched.`;

describe('parseWorktreeEnterInfo', () => {
  it('reads path and branch out of a created-worktree message', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/repo/.claude/worktrees/a', 'worktree-a'))).toEqual(
      {
        branch: 'worktree-a',
        path: '/repo/.claude/worktrees/a',
      },
    );
  });

  it('omits the branch when the message has none', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/repo/wt'))).toEqual({ path: '/repo/wt' });
  });

  it('reads the path when switching into an existing worktree', () => {
    expect(parseWorktreeEnterInfo(enterExisting('/tmp/wt'))).toEqual({ path: '/tmp/wt' });
  });

  it('keeps a path containing spaces intact', () => {
    expect(parseWorktreeEnterInfo(enterCreated('/tmp/my wt', 'worktree-b'))?.path).toBe(
      '/tmp/my wt',
    );
  });

  it('ignores a subagent that moved only its own pinned cwd', () => {
    expect(parseWorktreeEnterInfo(enterPinnedAgent('/tmp/wt'))).toBeUndefined();
  });

  it('ignores unrelated, truncated or empty content', () => {
    expect(parseWorktreeEnterInfo('')).toBeUndefined();
    expect(parseWorktreeEnterInfo(undefined)).toBeUndefined();
    expect(parseWorktreeEnterInfo('Created worktree at /tmp/wt.')).toBeUndefined();
  });
});

describe('isWorktreeExitContent', () => {
  it('accepts every successful exit outcome', () => {
    expect(
      isWorktreeExitContent(
        'Exited worktree. Your work is preserved at /tmp/wt on branch worktree-a. Session is now back in /repo.',
      ),
    ).toBe(true);
    expect(
      isWorktreeExitContent(
        'Exited and removed worktree at /tmp/wt. Discarded 3 uncommitted files. Session is now back in /repo.',
      ),
    ).toBe(true);
    expect(
      isWorktreeExitContent(
        'Exited worktree but could not remove it — kept at /tmp/wt. Session is now back in /repo.',
      ),
    ).toBe(true);
  });

  it('rejects the no-op and anything else', () => {
    expect(isWorktreeExitContent('No-op: there is no active EnterWorktree session to exit.')).toBe(
      false,
    );
    expect(isWorktreeExitContent(undefined)).toBe(false);
  });
});

describe('recordWorktreeEnter', () => {
  it('records the worktree and its branch onto the run topic', async () => {
    chatMocks.topics = { t1: PR_TOPIC };

    await recordWorktreeEnter({ content: enterCreated('/repo/wt', 'worktree-a'), topicId: 't1' });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo/wt', branch: 'worktree-a', isWorktree: true },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('does not record a subagent-only worktree move', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeEnter({ content: enterPinnedAgent('/repo/wt'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the worktree resolves to the source path', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeEnter({ content: enterExisting('/repo'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent when already in that worktree', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: { activeWorktree: '/repo/wt', isWorktree: true },
            path: '/repo',
          },
        },
      },
    };
    await recordWorktreeEnter({ content: enterExisting('/repo/wt'), topicId: 't1' });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});

describe('recordWorktreeExit', () => {
  const IN_WORKTREE = {
    metadata: {
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo/wt', branch: 'worktree-a', isWorktree: true },
        path: '/repo',
      },
    },
  };

  it('clears the worktree when the session exits and keeps it on disk', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };

    await recordWorktreeExit({
      content: 'Exited worktree. Your work is preserved at /repo/wt. Session is now back in /repo.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('clears the worktree when it is removed', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };

    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt. Session is now back in /repo.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo' },
    });
  });

  it('drops the linked PR with the worktree branch it belonged to', async () => {
    chatMocks.topics = {
      t1: {
        metadata: {
          workingDirectoryConfig: {
            git: {
              activeWorktree: '/repo/wt',
              branch: 'worktree-a',
              github: { pullRequest: { number: 7 }, pullRequestStatus: 'ok' },
              isWorktree: true,
            },
            path: '/repo',
            repoType: 'github',
          },
        },
      },
    };

    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt.',
      topicId: 't1',
    });

    expect(chatMocks.updateTopicMetadata).toHaveBeenCalledWith('t1', {
      workingDirectoryConfig: { git: { isWorktree: false }, path: '/repo', repoType: 'github' },
    });
  });

  it('does nothing for the no-op exit message', async () => {
    chatMocks.topics = { t1: IN_WORKTREE };
    await recordWorktreeExit({
      content: 'No-op: there is no active EnterWorktree session to exit.',
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the topic is not in a worktree', async () => {
    chatMocks.topics = { t1: PR_TOPIC };
    await recordWorktreeExit({
      content: 'Exited and removed worktree at /repo/wt.',
      topicId: 't1',
    });
    expect(chatMocks.updateTopicMetadata).not.toHaveBeenCalled();
  });
});
