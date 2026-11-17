// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, scmCredentialGrants, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmCredentialGrantModel } from '../credentialGrant';

const db: LobeChatDatabase = await getTestDB();

const alice = 'grant-alice';
const bob = 'grant-bob';
const workspaceId = 'grant-ws';

const grant = (overrides: Partial<Parameters<typeof ScmCredentialGrantModel.create>[1]> = {}) => ({
  deviceId: 'device-1',
  operationId: 'op-1',
  path: 'hetero' as const,
  repo: 'lobehub/lobehub',
  requesterUserId: alice,
  result: 'issued' as const,
  workspaceId,
  ...overrides,
});

const cleanup = async () => {
  await db.delete(scmCredentialGrants);
  await db.delete(agentOperations);
  await db.delete(workspaces);
  await db.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([{ id: alice }, { id: bob }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Grants', primaryOwnerId: alice, slug: 'grants' });
});

afterEach(cleanup);

describe('ScmCredentialGrantModel', () => {
  it("lists a workspace's grants newest first, successes and failures alike", async () => {
    await ScmCredentialGrantModel.create(
      db,
      grant({ createdAt: new Date('2026-11-17T01:00:00Z') }),
    );
    await ScmCredentialGrantModel.create(
      db,
      grant({
        createdAt: new Date('2026-11-17T02:00:00Z'),
        operationId: 'op-2',
        requesterUserId: bob,
        result: 'not_authorized',
      }),
    );

    const rows = await ScmCredentialGrantModel.list(db, { workspaceId });

    expect(rows.map((row) => [row.operationId, row.result])).toEqual([
      ['op-2', 'not_authorized'],
      ['op-1', 'issued'],
    ]);
  });

  it('narrows the list to one requester', async () => {
    await ScmCredentialGrantModel.create(db, grant());
    await ScmCredentialGrantModel.create(db, grant({ operationId: 'op-2', requesterUserId: bob }));

    const rows = await ScmCredentialGrantModel.list(db, { requesterUserId: bob, workspaceId });

    expect(rows.map((row) => row.requesterUserId)).toEqual([bob]);
  });

  it('narrows the list to one repository', async () => {
    await ScmCredentialGrantModel.create(db, grant());
    await ScmCredentialGrantModel.create(
      db,
      grant({ operationId: 'op-2', repo: 'lobehub/lobe-ui' }),
    );

    const rows = await ScmCredentialGrantModel.list(db, { repo: 'lobehub/lobe-ui', workspaceId });

    expect(rows.map((row) => row.operationId)).toEqual(['op-2']);
  });

  it('pages with a createdAt cursor', async () => {
    await ScmCredentialGrantModel.create(
      db,
      grant({ createdAt: new Date('2026-11-17T01:00:00Z') }),
    );
    await ScmCredentialGrantModel.create(
      db,
      grant({ createdAt: new Date('2026-11-17T02:00:00Z'), operationId: 'op-2' }),
    );

    const rows = await ScmCredentialGrantModel.list(db, {
      before: new Date('2026-11-17T02:00:00Z'),
      workspaceId,
    });

    expect(rows.map((row) => row.operationId)).toEqual(['op-1']);
  });

  it('names the requesters an operation was issued a credential for', async () => {
    await ScmCredentialGrantModel.create(db, grant({ operationId: 'op-issued' }));
    await ScmCredentialGrantModel.create(db, grant({ operationId: 'op-issued' }));
    await ScmCredentialGrantModel.create(
      db,
      grant({ operationId: 'op-failed', result: 'not_authorized' }),
    );

    await expect(ScmCredentialGrantModel.issuedRequesterIds(db, 'op-issued')).resolves.toEqual([
      alice,
    ]);
    await expect(ScmCredentialGrantModel.issuedRequesterIds(db, 'op-failed')).resolves.toEqual([]);
  });

  it('finds another running operation of the same requester that holds a credential', async () => {
    await db.insert(agentOperations).values([
      { id: 'op-ended', status: 'completed', userId: alice },
      { id: 'op-running', status: 'running', userId: alice },
      { id: 'op-bob', status: 'running', userId: bob },
    ]);
    await ScmCredentialGrantModel.create(db, grant({ operationId: 'op-ended' }));
    await ScmCredentialGrantModel.create(
      db,
      grant({ operationId: 'op-bob', requesterUserId: bob }),
    );

    await expect(
      ScmCredentialGrantModel.hasOtherRunningIssued(db, alice, 'op-ended'),
    ).resolves.toBe(false);

    await ScmCredentialGrantModel.create(db, grant({ operationId: 'op-running' }));

    await expect(
      ScmCredentialGrantModel.hasOtherRunningIssued(db, alice, 'op-ended'),
    ).resolves.toBe(true);
  });
});
