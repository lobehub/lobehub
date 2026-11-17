// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmCredentialGrantModel } from '@/database/models/scm';
import { agentOperations, scmCredentialGrants, users, workspaces } from '@/database/schemas';

import { rotateRequesterTokenIfIdle } from '../rotateOnIdle';

const db = await getTestDB();

const rotate = vi.fn();
vi.mock('../userToken', () => ({
  GithubUserTokenService: vi.fn(function () {
    return { rotate };
  }),
}));

const owner = 'rot-owner';
const alice = 'rot-alice';
const workspaceId = 'rot-ws';

const operation = (id: string, status: 'completed' | 'running') =>
  db.insert(agentOperations).values({ id, status, userId: owner, workspaceId });

const issue = (operationId: string, result: 'issued' | 'not_authorized' = 'issued') =>
  ScmCredentialGrantModel.create(db, {
    operationId,
    path: 'hetero',
    requesterUserId: alice,
    result,
    workspaceId,
  });

const cleanup = async () => {
  await db.delete(scmCredentialGrants);
  await db.delete(agentOperations);
  await db.delete(workspaces);
  await db.delete(users);
};

beforeEach(async () => {
  vi.clearAllMocks();
  rotate.mockResolvedValue({ ok: true });
  await cleanup();
  await db.insert(users).values([{ id: owner }, { id: alice }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Rot', primaryOwnerId: owner, slug: 'rot' });
});

afterEach(cleanup);

describe('rotateRequesterTokenIfIdle', () => {
  it("rotates the requester's token once their last credentialed run ends", async () => {
    await operation('op-1', 'completed');
    await issue('op-1');
    await issue('op-1');

    await rotateRequesterTokenIfIdle(db, 'op-1');

    expect(rotate).toHaveBeenCalledTimes(1);
    expect(rotate).toHaveBeenCalledWith(alice);
  });

  it('waits while another credentialed run of theirs is still going', async () => {
    await operation('op-1', 'completed');
    await operation('op-2', 'running');
    await issue('op-1');
    await issue('op-2');

    await rotateRequesterTokenIfIdle(db, 'op-1');

    expect(rotate).not.toHaveBeenCalled();
  });

  it('leaves tokens alone for a run that was never issued one', async () => {
    await operation('op-1', 'completed');
    await issue('op-1', 'not_authorized');

    await rotateRequesterTokenIfIdle(db, 'op-1');

    expect(rotate).not.toHaveBeenCalled();
  });

  it('swallows a failed rotation so the completion is unaffected', async () => {
    await operation('op-1', 'completed');
    await issue('op-1');
    rotate.mockRejectedValue(new Error('github down'));

    await expect(rotateRequesterTokenIfIdle(db, 'op-1')).resolves.toBeUndefined();
  });
});
