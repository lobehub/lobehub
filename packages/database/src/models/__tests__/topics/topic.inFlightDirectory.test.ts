// @vitest-environment node
import type { ChatTopicMetadata } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-inflight-user';
const memberId = 'topic-inflight-member';
const strangerId = 'topic-inflight-stranger';
const workspaceId = 'topic-inflight-ws';

const insert = (
  id: string,
  metadata: ChatTopicMetadata,
  extra: { status?: 'active' | 'running'; userId?: string; workspaceId?: string | null } = {},
) =>
  serverDB.insert(topics).values({
    id,
    metadata,
    status: extra.status ?? 'running',
    userId: extra.userId ?? userId,
    workspaceId: extra.workspaceId ?? null,
  });

const inRepo = (path: string, extra: Partial<ChatTopicMetadata> = {}): ChatTopicMetadata => ({
  boundDeviceId: 'dev-1',
  workingDirectoryConfig: { path },
  ...extra,
});

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: memberId }, { id: strangerId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: 'topic-inflight-ws' });
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, memberId, strangerId]));
});

describe('TopicModel.countInFlightInDirectory', () => {
  const personal = () => new TopicModel(serverDB, userId);

  it('counts running topics in the same directory, however the path is spelled', async () => {
    await insert('t-1', inRepo('/code/lobehub'));
    await insert('t-2', { boundDeviceId: 'dev-1', workingDirectory: '/code/lobehub/' });

    expect(
      await personal().countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub/' }),
    ).toBe(2);
  });

  it('counts a picked worktree against both checkouts a run may use', async () => {
    // A native agent works in the worktree, but a local CLI process starts in
    // the source repository.
    await insert(
      't-wt',
      inRepo('/code/lobehub', {
        workingDirectoryConfig: {
          git: { activeWorktree: '/home/.lobehub/worktrees/x' },
          path: '/code/lobehub',
        },
      }),
    );

    const model = personal();
    expect(await model.countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' })).toBe(
      1,
    );
    expect(
      await model.countInFlightInDirectory({
        deviceId: 'dev-1',
        path: '/home/.lobehub/worktrees/x',
      }),
    ).toBe(1);
  });

  it('counts a worktree made on the first send only against itself', async () => {
    await insert(
      't-auto',
      inRepo('/code/lobehub', {
        workingDirectoryConfig: {
          git: { activeWorktree: '/home/.lobehub/worktrees/y', autoCreated: true },
          path: '/code/lobehub',
          sessionPath: '/home/.lobehub/worktrees/y',
        },
      }),
    );

    const model = personal();
    expect(await model.countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' })).toBe(
      0,
    );
    expect(
      await model.countInFlightInDirectory({
        deviceId: 'dev-1',
        path: '/home/.lobehub/worktrees/y',
      }),
    ).toBe(1);
  });

  it('counts a live run marker even when the status is not running', async () => {
    await insert(
      't-op',
      inRepo('/code/lobehub', {
        runningOperation: { assistantMessageId: 'm', operationId: 'op', threadId: null },
      }),
      { status: 'active' },
    );

    expect(
      await personal().countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).toBe(1);
  });

  it('ignores idle topics, other devices and other directories', async () => {
    await insert('t-idle', inRepo('/code/lobehub'), { status: 'active' });
    await insert('t-dev', { ...inRepo('/code/lobehub'), boundDeviceId: 'dev-2' });
    await insert('t-dir', inRepo('/code/other'));

    expect(
      await personal().countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).toBe(0);
  });

  it('follows the device a run was dispatched to over the pin', async () => {
    await insert(
      't-moved',
      inRepo('/code/lobehub', {
        boundDeviceId: 'dev-2',
        runningOperation: {
          assistantMessageId: 'm',
          deviceId: 'dev-1',
          operationId: 'op',
          threadId: null,
        },
      }),
    );

    expect(
      await personal().countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).toBe(1);
  });

  it('spans every member in a workspace but nothing outside it', async () => {
    await insert('t-me', inRepo('/code/lobehub'), { workspaceId });
    await insert('t-member', inRepo('/code/lobehub'), { userId: memberId, workspaceId });
    await insert('t-personal', inRepo('/code/lobehub'));
    await insert('t-stranger', inRepo('/code/lobehub'), { userId: strangerId });

    const inWorkspace = new TopicModel(serverDB, userId, workspaceId);
    expect(
      await inWorkspace.countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).toBe(2);
    expect(
      await personal().countInFlightInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).toBe(1);
  });
});
