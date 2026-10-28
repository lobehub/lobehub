// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { ResourceTransferRequestItem } from '../../schemas';
import { resourceTransferRequests, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  ResourceTransferRequestModel,
  TRANSFER_REQUEST_ALREADY_PENDING,
} from '../resourceTransferRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const initiatorId = 't863-rtr-cov-initiator';
const recipientId = 't863-rtr-cov-recipient';
const workspaceId = 't863-rtr-cov-workspace';

const model = new ResourceTransferRequestModel(serverDB, workspaceId);

/** `withLazyExpiry` is the private step every read runs a fetched row through. */
const lazyExpire = (row: ResourceTransferRequestItem) =>
  (
    model as unknown as {
      withLazyExpiry: (row: ResourceTransferRequestItem) => Promise<ResourceTransferRequestItem>;
    }
  ).withLazyExpiry(row);

const createOverdue = async () => {
  const row = await model.create({
    initiatorId,
    recipientId,
    resourceId: 't863-agent',
    resourceType: 'agent',
  });
  const [overdue] = await serverDB
    .update(resourceTransferRequests)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(resourceTransferRequests.id, row.id))
    .returning();
  return overdue;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: initiatorId }, { id: recipientId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'W', primaryOwnerId: initiatorId, slug: 't863-rtr-cov' });
});

afterEach(async () => {
  // The workspace and every request in it cascade with the owner.
  await serverDB.delete(users).where(inArray(users.id, [initiatorId, recipientId]));
});

describe('ResourceTransferRequestModel coverage', () => {
  it('rethrows a non-unique insert failure as-is', async () => {
    const error = await model
      .create({
        initiatorId,
        recipientId: 't863-rtr-cov-missing-user',
        resourceId: 't863-agent',
        resourceType: 'agent',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toBe(TRANSFER_REQUEST_ALREADY_PENDING);
    expect(await serverDB.select().from(resourceTransferRequests)).not.toContainEqual(
      expect.objectContaining({ workspaceId }),
    );
  });

  it('returns early when no resource ids are given', async () => {
    const row = await model.create({
      initiatorId,
      recipientId,
      resourceId: 't863-agent',
      resourceType: 'agent',
    });

    await expect(model.invalidateForResources('agent', [])).resolves.toBeUndefined();
    expect(await model.findById(row.id)).toMatchObject({ status: 'pending' });
  });

  describe('lazy expiry of a stale snapshot', () => {
    it('returns the stored row when a racer resolved it first', async () => {
      const overdue = await createOverdue();
      await serverDB
        .update(resourceTransferRequests)
        .set({ resolvedAt: new Date(), status: 'declined' })
        .where(eq(resourceTransferRequests.id, overdue.id));

      const result = await lazyExpire(overdue);

      expect(result).toMatchObject({ id: overdue.id, status: 'declined' });
    });

    it('falls back to an expired copy of the snapshot when the row is gone', async () => {
      const overdue = await createOverdue();
      await serverDB
        .delete(resourceTransferRequests)
        .where(eq(resourceTransferRequests.id, overdue.id));

      const result = await lazyExpire(overdue);

      expect(result).toMatchObject({ id: overdue.id, status: 'expired' });
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });
  });
});
