// @vitest-environment node
import type { AgentSendMessageAction } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentHumanRequests, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentHumanRequestModel } from '../agentHumanRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'human-request-model-owner';
const otherUserId = 'human-request-model-other';
const agentId = 'human-request-model-agent';
const workspaceId = 'human-request-model-ws';

const action: AgentSendMessageAction = {
  accountId: 'acc-1',
  channel: 'mail',
  from: 'aria@lobe.id',
  text: 'Hi Bob',
  to: 'bob@example.com',
  type: 'send_message',
};

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

const model = (owner = userId, ws?: string) => new AgentHumanRequestModel(serverDB, owner, ws);

const createSecret = (owner = model()) =>
  owner.create({
    action,
    agentId,
    expiresAt: inAnHour(),
    recipientKey: 'sealed-key',
    secret: { kind: 'otp', label: 'verification-code', request: { id: 'req-1' } },
    type: 'secret',
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentHumanRequestModel', () => {
  describe('create / findById / list', () => {
    it('creates a pending row owned by the caller with a prefixed id', async () => {
      const row = await model().create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });

      expect(row.id).toMatch(/^hreq_/);
      expect(row).toMatchObject({ status: 'pending', userId, workspaceId: null });
      expect(await model().findById(row.id)).toMatchObject({ id: row.id });
    });

    it('scopes reads to the owner and the workspace', async () => {
      const personal = await model().create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });
      const inWorkspace = await model(userId, workspaceId).create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });

      expect(await model(otherUserId).findById(personal.id)).toBeUndefined();
      expect(await model().findById(inWorkspace.id)).toBeUndefined();
      expect((await model().list()).map((row) => row.id)).toEqual([personal.id]);
      expect((await model(userId, workspaceId).list()).map((row) => row.id)).toEqual([
        inWorkspace.id,
      ]);
      expect(await model(otherUserId).list()).toEqual([]);
    });

    it('filters by status, type and agent', async () => {
      const approval = await model().create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });
      const secret = await createSecret();
      await model().claim(secret.id, ['pending'], { status: 'declined' });

      expect((await model().list({ status: ['pending'] })).map((r) => r.id)).toEqual([approval.id]);
      expect((await model().list({ type: 'secret' })).map((r) => r.id)).toEqual([secret.id]);
      expect(await model().list({ agentId: 'another-agent' })).toEqual([]);
    });
  });

  describe('claim', () => {
    it('moves a row only out of the expected statuses, once', async () => {
      const row = await model().create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });

      const [first, second] = await Promise.all([
        model().claim(row.id, ['pending'], { status: 'executing' }),
        model().claim(row.id, ['pending'], { status: 'executing' }),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it("never moves another owner's row", async () => {
      const row = await model().create({
        action,
        agentId,
        expiresAt: inAnHour(),
        type: 'approval',
      });

      expect(
        await model(otherUserId).claim(row.id, ['pending'], { status: 'declined' }),
      ).toBeUndefined();
      expect((await model().findById(row.id))?.status).toBe('pending');
    });
  });

  describe('takeRecipientKey', () => {
    it('returns the sealed key once and destroys it in the same step', async () => {
      const row = await createSecret();

      const taken = await model().takeRecipientKey(row.id);
      expect(taken?.recipientKey).toBe('sealed-key');
      expect(taken?.row).toMatchObject({ recipientKey: null, status: 'executing' });

      expect(await model().takeRecipientKey(row.id)).toBeUndefined();
      const [stored] = await serverDB
        .select()
        .from(agentHumanRequests)
        .where(eq(agentHumanRequests.id, row.id));
      expect(stored.recipientKey).toBeNull();
    });

    it("does not hand another owner's key out", async () => {
      const row = await createSecret();

      expect(await model(otherUserId).takeRecipientKey(row.id)).toBeUndefined();
      expect((await model().findById(row.id))?.recipientKey).toBe('sealed-key');
    });
  });

  describe('expireDue', () => {
    it('expires overdue pending rows and drops their keys, leaving the rest', async () => {
      const due = await model().create({
        action,
        agentId,
        expiresAt: new Date(Date.now() - 1000),
        recipientKey: 'sealed-key',
        type: 'secret',
      });
      const fresh = await createSecret();
      const othersDue = await model(otherUserId).create({
        action,
        agentId,
        expiresAt: new Date(Date.now() - 1000),
        type: 'approval',
      });

      const expired = await model().expireDue();

      expect(expired.map((row) => row.id)).toEqual([due.id]);
      expect(await model().findById(due.id)).toMatchObject({
        recipientKey: null,
        status: 'expired',
      });
      expect((await model().findById(fresh.id))?.status).toBe('pending');
      expect((await model(otherUserId).findById(othersDue.id))?.status).toBe('pending');
    });
  });
});
