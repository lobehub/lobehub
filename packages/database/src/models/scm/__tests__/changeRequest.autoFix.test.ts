// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmChangeRequests, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmChangeRequestModel } from '../changeRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'scm-autofix-user';
const otherUserId = 'scm-autofix-other';
const topicId = 'scm-autofix-topic';
const workspaceId = 'scm-autofix-workspace';

const snapshot = {
  headSha: '4'.repeat(40),
  number: 11,
  provider: 'github' as const,
  repoFullName: 'lobehub/lobehub',
  state: 'open' as const,
  url: 'https://github.com/lobehub/lobehub/pull/11',
  userId,
};

const personal = { userId };

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(scmChangeRequests);
  await serverDB.delete(topics);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const linkedRow = () => ScmChangeRequestModel.upsert(serverDB, { ...snapshot, links: { topicId } });

describe('ScmChangeRequestModel.setAutoFix', () => {
  it('turns Auto-fix off without touching the rest of the metadata', async () => {
    const row = await linkedRow();
    await ScmChangeRequestModel.reserveWake(serverDB, row.id, 3, 'ci_failed');
    await serverDB
      .update(scmChangeRequests)
      .set({ metadata: { ...row.metadata, lobehubCommentId: 'c-1' } })
      .where(eq(scmChangeRequests.id, row.id));

    expect(await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, false)).toEqual({
      autoFix: false,
      wakeCount: 1,
    });

    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.metadata.autoFix).toBe(false);
    expect(after?.metadata.lobehubCommentId).toBe('c-1');
    // Turning it off is not a reset: the count only restarts when it comes back on.
    expect(after?.wakeCount).toBe(1);
  });

  it('drops a held wake when turned off, so the opt-out is never followed by a run', async () => {
    const row = await linkedRow();
    await ScmChangeRequestModel.markPendingWake(serverDB, row.id, 'ci_failed');

    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, false);

    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.metadata.pendingWake).toBeUndefined();
  });

  it('starts the wake count over only when Auto-fix comes back on from off', async () => {
    const row = await linkedRow();
    for (let i = 0; i < 3; i++) {
      await ScmChangeRequestModel.reserveWake(serverDB, row.id, 3, 'ci_failed');
    }

    // Already on (absent): enabling again keeps the count.
    expect(await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, true)).toEqual({
      autoFix: true,
      wakeCount: 3,
    });

    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, false);
    expect(await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, true)).toEqual({
      autoFix: true,
      wakeCount: 0,
    });
    // The cap applies again from zero.
    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 3, 'ci_failed')).toBe(1);
  });

  it('refuses a row the scope does not own', async () => {
    const row = await linkedRow();

    expect(
      await ScmChangeRequestModel.setAutoFix(serverDB, { userId: otherUserId }, row.id, false),
    ).toBeNull();
    // The workspace is not the personal row's tenant either.
    expect(
      await ScmChangeRequestModel.setAutoFix(serverDB, { userId, workspaceId }, row.id, false),
    ).toBeNull();
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.metadata.autoFix).toBe(
      undefined,
    );
  });

  it('lets any member of the owning workspace scope write it', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, { ...snapshot, workspaceId });

    expect(
      await ScmChangeRequestModel.setAutoFix(
        serverDB,
        { userId: otherUserId, workspaceId },
        row.id,
        false,
      ),
    ).toEqual({ autoFix: false, wakeCount: 0 });
  });

  it('refuses to reserve a wake while Auto-fix is off', async () => {
    const row = await linkedRow();
    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, false);

    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 3, 'ci_failed')).toBeNull();
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.wakeCount).toBe(0);

    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, true);
    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 3, 'ci_failed')).toBe(1);
  });

  it('stops reporting a wake target while Auto-fix is off', async () => {
    const row = await linkedRow();
    const has = () => ScmChangeRequestModel.hasWakeTarget(serverDB, personal, topicId, 3);

    expect(await has()).toBe(true);
    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, false);
    expect(await has()).toBe(false);
    await ScmChangeRequestModel.setAutoFix(serverDB, personal, row.id, true);
    expect(await has()).toBe(true);
  });
});
