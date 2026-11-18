// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { userConnectors, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorModel } from '../connector';
import { ConnectorLinkModel } from '../connectorLink';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'conn-refresh-user';
const workspaceId = 'conn-refresh-ws';
const missingId = '00000000-0000-4000-8000-000000000001';
const base = { name: 'Connector', sourceType: 'builtin', status: 'connected' } as const;

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Refresh', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await cleanup();
});

describe('ConnectorModel refresh lock', () => {
  it('hands out a link model for the same identity', () => {
    const model = new ConnectorModel(serverDB, userId);

    expect(model.getLinkModel()).toBeInstanceOf(ConnectorLinkModel);
  });

  it('runs the action under a row lock on the personal connector', async () => {
    const model = new ConnectorModel(serverDB, userId);
    const created = await model.create({ ...base, identifier: 'refresh-1' });

    const seen: string[] = [];
    const result = await model.withOAuthRefreshLock(
      { id: created.id, workspaceId: null },
      async (row, locked) => {
        seen.push(row.id);
        await locked.update(created.id, { name: 'Renamed' });
        return 'refreshed';
      },
    );

    expect(result).toBe('refreshed');
    expect(seen).toEqual([created.id]);
    // The write made inside the lock landed with the refresh.
    const [row] = await serverDB
      .select({ name: userConnectors.name })
      .from(userConnectors)
      .where(eq(userConnectors.id, created.id));
    expect(row.name).toBe('Renamed');
  });

  it('answers undefined when the connector is gone', async () => {
    const model = new ConnectorModel(serverDB, userId);

    expect(
      await model.withOAuthRefreshLock({ id: missingId, workspaceId: null }, async () => 'never'),
    ).toBeUndefined();
  });

  it('keeps a workspace connector in the workspace scope', async () => {
    const [row] = await serverDB
      .insert(userConnectors)
      .values({ ...base, identifier: 'refresh-ws', userId, workspaceId })
      .returning();
    const model = new ConnectorModel(serverDB, userId, workspaceId);

    const result = await model.withOAuthRefreshLock({ id: row.id, workspaceId }, async (locked) => {
      expect(locked.workspaceId).toBe(workspaceId);
      return 'ok';
    });

    expect(result).toBe('ok');
  });
});
