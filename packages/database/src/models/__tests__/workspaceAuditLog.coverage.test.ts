// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceAuditLogs, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceAuditLogModel } from '../workspaceAuditLog';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wal-coverage-owner';
const workspaceId = 'wal-coverage-ws';

beforeEach(async () => {
  // The workspace and its audit logs cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [ownerId]));
  await serverDB.insert(users).values({ id: ownerId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: ownerId, slug: workspaceId });
  await serverDB.insert(workspaceAuditLogs).values([
    {
      action: 'workspace.created',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      userId: ownerId,
      workspaceId,
    },
    {
      action: 'workspace.updated',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      userId: ownerId,
      workspaceId,
    },
    {
      action: 'workspace.deleted',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      userId: ownerId,
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [ownerId]));
});

describe('WorkspaceAuditLogModel coverage', () => {
  it('bounds the list by startDate and endDate inclusively', async () => {
    const model = new WorkspaceAuditLogModel(serverDB);

    const fromFeb = await model.list({ startDate: new Date('2026-02-01T00:00:00Z'), workspaceId });
    expect(fromFeb.items.map((row) => row.action)).toEqual([
      'workspace.deleted',
      'workspace.updated',
    ]);

    const untilFeb = await model.list({ endDate: new Date('2026-02-01T00:00:00Z'), workspaceId });
    expect(untilFeb.items.map((row) => row.action)).toEqual([
      'workspace.updated',
      'workspace.created',
    ]);

    const onlyFeb = await model.list({
      endDate: new Date('2026-02-15T00:00:00Z'),
      startDate: new Date('2026-01-15T00:00:00Z'),
      workspaceId,
    });
    expect(onlyFeb).toEqual({
      items: [expect.objectContaining({ action: 'workspace.updated' })],
      nextCursor: null,
    });
  });
});
