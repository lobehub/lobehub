// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { notifications, resourceTransferRequests, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  PENDING_TRANSFER_LIST_LIMIT,
  ResourceTransferRequestModel,
  TRANSFER_REQUEST_ALREADY_PENDING,
  TRANSFER_REQUEST_EXPIRED,
  TRANSFER_REQUEST_NOT_PENDING,
  TRANSFER_REQUEST_TTL_MS,
} from '../resourceTransferRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const initiatorId = 'rtr-initiator';
const recipientId = 'rtr-recipient';
const outsiderId = 'rtr-outsider';
const workspaceId = 'rtr-workspace';
const otherWorkspaceId = 'rtr-other-workspace';

const model = new ResourceTransferRequestModel(serverDB, workspaceId);

const createRequest = (overrides: Partial<Parameters<typeof model.create>[0]> = {}) =>
  model.create({
    initiatorId,
    recipientId,
    resourceId: 'agent-1',
    resourceType: 'agent',
    ...overrides,
  });

const forceExpire = async (id: string) => {
  await serverDB
    .update(resourceTransferRequests)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(resourceTransferRequests.id, id));
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB
    .insert(users)
    .values([{ id: initiatorId }, { id: recipientId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'W', primaryOwnerId: initiatorId, slug: 'rtr-w' },
    { id: otherWorkspaceId, name: 'W2', primaryOwnerId: initiatorId, slug: 'rtr-w2' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ResourceTransferRequestModel', () => {
  describe('create', () => {
    it('creates a pending request with a 7-day expiry and previousOwnerId defaulting to initiator', async () => {
      const before = Date.now();
      const row = await createRequest();

      expect(row).toMatchObject({
        initiatorId,
        previousOwnerId: initiatorId,
        recipientId,
        resourceId: 'agent-1',
        resourceType: 'agent',
        status: 'pending',
        workspaceId,
      });
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + TRANSFER_REQUEST_TTL_MS - 1000,
      );
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + TRANSFER_REQUEST_TTL_MS + 1000,
      );
    });

    it('keeps an explicit previousOwnerId (primary-owner reassignment)', async () => {
      const row = await createRequest({ previousOwnerId: outsiderId });
      expect(row.previousOwnerId).toBe(outsiderId);
    });

    it('rejects a second pending request for the same resource', async () => {
      await createRequest();
      await expect(createRequest({ recipientId: outsiderId })).rejects.toThrow(
        TRANSFER_REQUEST_ALREADY_PENDING,
      );
    });

    it('allows a new request for a different resource', async () => {
      await createRequest();
      await expect(createRequest({ resourceId: 'agent-2' })).resolves.toMatchObject({
        resourceId: 'agent-2',
      });
    });

    it('allows a new request after the previous one resolved', async () => {
      const first = await createRequest();
      await model.decline(first.id, recipientId);
      await expect(createRequest()).resolves.toMatchObject({ status: 'pending' });
    });

    it('expires an overdue pending request instead of blocking the new one', async () => {
      const stale = await createRequest();
      await forceExpire(stale.id);

      const fresh = await createRequest();
      expect(fresh.status).toBe('pending');

      const [staleRow] = await serverDB
        .select()
        .from(resourceTransferRequests)
        .where(eq(resourceTransferRequests.id, stale.id));
      expect(staleRow.status).toBe('expired');
      expect(staleRow.resolvedAt).not.toBeNull();
    });
  });

  describe('accept', () => {
    it('flips pending → accepted for the recipient', async () => {
      const row = await createRequest();
      const accepted = await model.accept(row.id, recipientId);
      expect(accepted.status).toBe('accepted');
      expect(accepted.resolvedAt).not.toBeNull();
    });

    it('rejects an actor who is not the recipient', async () => {
      const row = await createRequest();
      await expect(model.accept(row.id, outsiderId)).rejects.toThrow(TRANSFER_REQUEST_NOT_PENDING);
    });

    it('rejects an expired request and stamps it expired', async () => {
      const row = await createRequest();
      await forceExpire(row.id);

      await expect(model.accept(row.id, recipientId)).rejects.toThrow(TRANSFER_REQUEST_EXPIRED);

      const reloaded = await model.findById(row.id);
      expect(reloaded?.status).toBe('expired');
    });

    it('rejects a second transition after decline', async () => {
      const row = await createRequest();
      await model.decline(row.id, recipientId);
      await expect(model.accept(row.id, recipientId)).rejects.toThrow(TRANSFER_REQUEST_NOT_PENDING);
    });

    it('is scoped to the workspace', async () => {
      const row = await createRequest();
      const foreignModel = new ResourceTransferRequestModel(serverDB, otherWorkspaceId);
      await expect(foreignModel.accept(row.id, recipientId)).rejects.toThrow(
        TRANSFER_REQUEST_NOT_PENDING,
      );
    });
  });

  describe('decline / cancel', () => {
    it('decline is recipient-only', async () => {
      const row = await createRequest();
      await expect(model.decline(row.id, initiatorId)).rejects.toThrow(
        TRANSFER_REQUEST_NOT_PENDING,
      );
      await expect(model.decline(row.id, recipientId)).resolves.toMatchObject({
        status: 'declined',
      });
    });

    it('cancel is initiator-only', async () => {
      const row = await createRequest();
      await expect(model.cancel(row.id, recipientId)).rejects.toThrow(TRANSFER_REQUEST_NOT_PENDING);
      await expect(model.cancel(row.id, initiatorId)).resolves.toMatchObject({
        status: 'cancelled',
      });
    });
  });

  describe('findPendingByResource', () => {
    it('returns the live request', async () => {
      const row = await createRequest();
      await expect(model.findPendingByResource('agent', 'agent-1')).resolves.toMatchObject({
        id: row.id,
      });
    });

    it('returns undefined for resolved or overdue requests', async () => {
      const row = await createRequest();
      await forceExpire(row.id);
      await expect(model.findPendingByResource('agent', 'agent-1')).resolves.toBeUndefined();

      const reloaded = await model.findById(row.id);
      expect(reloaded?.status).toBe('expired');
    });
  });

  describe('listPendingForUser', () => {
    it('lists requests where the user is recipient or initiator, dropping overdue ones', async () => {
      const asRecipient = await createRequest();
      const asInitiator = await createRequest({
        recipientId: outsiderId,
        resourceId: 'agent-2',
      });
      const overdue = await createRequest({ resourceId: 'agent-3' });
      await forceExpire(overdue.id);
      // Someone else's request in the same workspace must not leak in.
      await createRequest({
        initiatorId: outsiderId,
        recipientId: outsiderId,
        resourceId: 'agent-4',
      });

      const forRecipient = await model.listPendingForUser(recipientId);
      expect(forRecipient.map((r) => r.id)).toEqual([asRecipient.id]);

      const forInitiator = await model.listPendingForUser(initiatorId);
      expect(new Set(forInitiator.map((r) => r.id))).toEqual(
        new Set([asRecipient.id, asInitiator.id]),
      );
    });

    it('hides orphaned rows whose recipient account was deleted', async () => {
      const orphan = await createRequest();
      // FK `ON DELETE SET NULL`: simulate the recipient account vanishing.
      await serverDB
        .update(resourceTransferRequests)
        .set({ recipientId: null })
        .where(eq(resourceTransferRequests.id, orphan.id));

      await expect(model.listPendingForUser(initiatorId)).resolves.toEqual([]);
      await expect(model.findPendingByResource('agent', 'agent-1')).resolves.toBeUndefined();
      // The partial unique index ignores the orphan, so a replacement request
      // for the same resource must go through — and become the visible one.
      const replacement = await createRequest();
      const visible = await model.findPendingByResource('agent', 'agent-1');
      expect(visible?.id).toBe(replacement.id);
    });

    it('caps the listing at PENDING_TRANSFER_LIST_LIMIT rows', async () => {
      for (let i = 0; i < PENDING_TRANSFER_LIST_LIMIT + 3; i++) {
        await createRequest({ resourceId: `agent-cap-${i}` });
      }

      const rows = await model.listPendingForUser(recipientId);
      expect(rows).toHaveLength(PENDING_TRANSFER_LIST_LIMIT);
    });
  });

  describe('invalidateRequest', () => {
    it('retires only the given pending request, leaving a replacement untouched', async () => {
      const stale = await createRequest();
      await model.invalidateRequest(stale.id);
      const replacement = await createRequest();

      await model.invalidateRequest(stale.id); // already resolved → no-op

      const [staleRow] = await serverDB
        .select()
        .from(resourceTransferRequests)
        .where(eq(resourceTransferRequests.id, stale.id));
      expect(staleRow.status).toBe('cancelled');
      const visible = await model.findPendingByResource('agent', 'agent-1');
      expect(visible?.id).toBe(replacement.id);
    });
  });

  describe('invalidateForResources', () => {
    it('cancels pending requests of the given resources only', async () => {
      const doomed = await createRequest();
      const kept = await createRequest({ resourceId: 'agent-2' });

      await model.invalidateForResources('agent', ['agent-1']);

      await expect(model.findById(doomed.id)).resolves.toMatchObject({ status: 'cancelled' });
      await expect(model.findById(kept.id)).resolves.toMatchObject({ status: 'pending' });
    });

    it('does not touch already-resolved rows', async () => {
      const row = await createRequest();
      await model.accept(row.id, recipientId);
      await model.invalidateForResources('agent', ['agent-1']);
      await expect(model.findById(row.id)).resolves.toMatchObject({ status: 'accepted' });
    });
  });

  describe('settling linked inbox rows', () => {
    // A pending item's read state IS its handled state: the linked request
    // notice must flip to read the moment the request leaves `pending`.
    const seedLinkedRow = async (requestId: string) => {
      const [row] = await serverDB
        .insert(notifications)
        .values({
          category: 'pending',
          content: 'transfer request',
          metadata: { transfer: { requestId } },
          title: 'Transfer request',
          type: 'agent_transfer_requested',
          userId: recipientId,
          workspaceId,
        })
        .returning();
      return row;
    };

    const isRowRead = async (id: string) => {
      const [row] = await serverDB
        .select({ isRead: notifications.isRead })
        .from(notifications)
        .where(eq(notifications.id, id));
      return row.isRead;
    };

    it.each([
      ['accept', (id: string) => model.accept(id, recipientId)],
      ['decline', (id: string) => model.decline(id, recipientId)],
      ['cancel', (id: string) => model.cancel(id, initiatorId)],
      ['invalidateRequest', (id: string) => model.invalidateRequest(id)],
      ['invalidateForResources', () => model.invalidateForResources('agent', ['agent-1'])],
    ])('marks the linked notice read on %s', async (_label, act) => {
      const request = await createRequest();
      const notice = await seedLinkedRow(request.id);
      expect(await isRowRead(notice.id)).toBe(false);

      await act(request.id);

      expect(await isRowRead(notice.id)).toBe(true);
    });

    it('marks the linked notice read on lazy expiry', async () => {
      const request = await createRequest();
      const notice = await seedLinkedRow(request.id);
      await forceExpire(request.id);

      await model.listPendingForUser(recipientId);

      expect(await isRowRead(notice.id)).toBe(true);
    });

    it('leaves unrelated notices untouched', async () => {
      const request = await createRequest();
      const other = await seedLinkedRow('some-other-request');
      await model.accept(request.id, recipientId);
      expect(await isRowRead(other.id)).toBe(false);
    });
  });
});
