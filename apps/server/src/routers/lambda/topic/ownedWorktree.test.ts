// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { topics, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ChatTopicMetadata } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../__tests__/integration/setup';

// Opened once: a first PGlite boot inside a hook can outlast the hook timeout.
const testDB: LobeChatDatabase = await getTestDB();
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

// General access to the agent has its own tests; this file covers who may act
// on a topic's worktree and on which device.
vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCanUseTopicTargets: vi.fn(async () => []),
}));

const discard = vi.hoisted(() => vi.fn(async () => ({ path: 'x' })));
vi.mock('@/server/services/worktreeCleanup', () => ({
  WorktreeCleanupService: class {
    discard = discard;
  },
}));

const { topicRouter } = await import('./index');

const WT = '/Users/me/.lobehub/worktrees/repo-1a2b3c4d/quiet-hill';

/**
 * "Discard changes and delete" force-removes a worktree's uncommitted work, so
 * in a workspace it stays the topic creator's call (or an owner's), and only on
 * a device the caller may operate — the service dispatches to it directly.
 */
describe('topic.discardOwnedWorktree authorization', () => {
  let creatorId: string;
  let teammateId: string;
  let workspaceId: string;

  beforeEach(async () => {
    creatorId = await createTestUser(testDB);
    teammateId = await createTestUser(testDB);
    const [workspace] = await testDB
      .insert(workspaces)
      .values({ name: 'Team', primaryOwnerId: creatorId, slug: `ws-owt-${creatorId}` })
      .returning();
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    discard.mockClear();
    await cleanupTestUser(testDB, teammateId);
    await cleanupTestUser(testDB, creatorId);
  });

  const seed = async (deviceId?: string) => {
    const metadata: ChatTopicMetadata = {
      ownedWorktrees: [
        {
          branch: 'lobehub/quiet-hill',
          cleanup: { at: 'x', dirtyFiles: 2, state: 'keptDirty', trigger: 'archived' },
          createdAt: 'y',
          ...(deviceId && { deviceId }),
          path: WT,
          sourcePath: '/code/repo',
        },
      ],
    };
    const [topic] = await testDB
      .insert(topics)
      .values({ metadata, status: 'completed', title: 't', userId: creatorId, workspaceId })
      .returning();
    return topic.id;
  };

  const caller = (userId: string, workspaceRole: 'member' | 'owner' = 'member') =>
    topicRouter.createCaller({ userId, workspaceId, workspaceRole } as any);

  it("refuses a teammate discarding the creator's worktree", async () => {
    const topicId = await seed();
    await expect(caller(teammateId).discardOwnedWorktree({ path: WT, topicId })).rejects.toThrow();
    expect(discard).not.toHaveBeenCalled();
  });

  it('lets the creator discard it', async () => {
    const topicId = await seed();
    await caller(creatorId).discardOwnedWorktree({ path: WT, topicId });
    expect(discard).toHaveBeenCalledWith(topicId, WT, { local: undefined });
  });

  it('refuses a desktop claiming the IPC jobs of a device that is not its own', async () => {
    await expect(
      caller(teammateId).claimLocalWorktreeCleanups({ deviceId: 'device-not-mine' }),
    ).rejects.toThrow(/machine itself/i);
  });

  it('refuses a device the caller may not operate, even for the creator', async () => {
    const topicId = await seed('device-not-in-this-workspace');
    await expect(caller(creatorId).discardOwnedWorktree({ path: WT, topicId })).rejects.toThrow(
      /device/i,
    );
    expect(discard).not.toHaveBeenCalled();
  });
});
