// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShares, userContactRequests, userContacts, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ContactModel, parseContactHandle } from '../contact';

const serverDB: LobeChatDatabase = await getTestDB();

const alice = 'contact-test-alice';
const bob = 'contact-test-bob';
const carol = 'contact-test-carol';
const bobAgent = 'agt_contact_bob';
const aliceAgent = 'agt_contact_alice';

const aliceModel = new ContactModel(serverDB, alice);
const bobModel = new ContactModel(serverDB, bob);
const carolModel = new ContactModel(serverDB, carol);

let bobShareId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { fullName: 'Alice', id: alice, username: 'alice' },
    { fullName: 'Bob', id: bob, username: 'Bob' },
    { id: carol, username: 'carol' },
  ]);
  await serverDB.insert(agents).values([
    { id: bobAgent, title: 'Bob Helper', userId: bob },
    { id: aliceAgent, title: 'Alice Helper', userId: alice },
  ]);
  const [share] = await serverDB
    .insert(agentShares)
    .values({
      agentId: bobAgent,
      shareConfig: { monthlySpendLimit: 1, slug: 'bob-helper' },
      visibility: 'link',
    })
    .returning();
  bobShareId = share.id;
  await serverDB
    .insert(agentShares)
    .values({ agentId: aliceAgent, shareConfig: { monthlySpendLimit: 1 }, visibility: 'link' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(userContactRequests);
  await serverDB.delete(userContacts);
  await serverDB.delete(users);
});

describe('parseContactHandle', () => {
  it('accepts handles, @handles and share links', () => {
    expect(parseContactHandle('bob')).toBe('bob');
    expect(parseContactHandle(' @bob ')).toBe('bob');
    expect(parseContactHandle('https://app.lobehub.com/a/bob-helper/chat?x=1')).toBe('bob-helper');
    expect(parseContactHandle('  ')).toBeUndefined();
  });
});

describe('contact requests', () => {
  it('becomes mutual contacts once the addressee accepts', async () => {
    const sent = await aliceModel.sendRequest(bob, 'hi');
    expect(sent.status).toBe('pending');
    expect(await aliceModel.relationTo(bob)).toBe('request_sent');
    expect(await bobModel.relationTo(alice)).toBe('request_received');

    const [incoming] = await bobModel.listRequests();
    expect(incoming).toMatchObject({ direction: 'incoming', message: 'hi', user: { id: alice } });

    await bobModel.acceptRequest(sent.requestId);

    expect((await aliceModel.list()).map((c) => c.type === 'user' && c.user.id)).toEqual([bob]);
    expect((await bobModel.list()).map((c) => c.type === 'user' && c.user.id)).toEqual([alice]);
    expect(await bobModel.listRequests()).toEqual([]);
  });

  it('repeating a pending request returns it instead of adding another', async () => {
    const first = await aliceModel.sendRequest(bob);
    const second = await aliceModel.sendRequest(bob);
    expect(second).toEqual(first);
  });

  it('a crossing request accepts the pending one', async () => {
    const first = await aliceModel.sendRequest(bob);
    const crossing = await bobModel.sendRequest(alice);
    expect(crossing).toEqual({ requestId: first.requestId, status: 'accepted' });
    expect(await aliceModel.isContact(bob)).toBe(true);
  });

  it('only the addressee can accept or decline, only the requester can cancel', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);
    await expect(aliceModel.acceptRequest(requestId)).rejects.toThrow('Request not found');
    await expect(carolModel.declineRequest(requestId)).rejects.toThrow('Request not found');
    await expect(bobModel.cancelRequest(requestId)).rejects.toThrow('Request not found');

    await aliceModel.cancelRequest(requestId);
    expect(await bobModel.listRequests()).toEqual([]);
    // A new request may follow a cancelled one.
    expect((await aliceModel.sendRequest(bob)).status).toBe('pending');
  });

  /**
   * The requester withdraws after the addressee's answer read the request as pending but before
   * it wrote: the withdrawal wins and no contacts appear. Simulated by withdrawing right after
   * the read, inside the answering transaction.
   */
  const withdrawAfterRead = (model: ContactModel) => {
    const target = model as unknown as {
      incomingPending: (tx: LobeChatDatabase, id: string) => Promise<{ id: string }>;
    };
    const read = target.incomingPending.bind(model);
    vi.spyOn(target, 'incomingPending').mockImplementation(async (tx, id) => {
      const request = await read(tx, id);
      await tx
        .update(userContactRequests)
        .set({ status: 'cancelled' })
        .where(eq(userContactRequests.id, request.id));
      return request;
    });
  };

  it('does not accept a request withdrawn while it was being accepted', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);
    withdrawAfterRead(bobModel);

    await expect(bobModel.acceptRequest(requestId)).rejects.toThrow('Request not found');

    expect(await aliceModel.isContact(bob)).toBe(false);
    expect(await bobModel.isContact(alice)).toBe(false);
    const [row] = await serverDB
      .select({ status: userContactRequests.status })
      .from(userContactRequests)
      .where(eq(userContactRequests.id, requestId));
    // The refused answer rolls back with its transaction; it never became accepted.
    expect(row.status).not.toBe('accepted');
  });

  it('does not decline a request withdrawn while it was being declined', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);
    withdrawAfterRead(bobModel);

    await expect(bobModel.declineRequest(requestId)).rejects.toThrow('Request not found');

    const [row] = await serverDB
      .select({ status: userContactRequests.status })
      .from(userContactRequests)
      .where(eq(userContactRequests.id, requestId));
    expect(row.status).not.toBe('declined');
  });

  it('rejects requests to yourself and to existing contacts', async () => {
    await expect(aliceModel.sendRequest(alice)).rejects.toThrow('You cannot add yourself');
    const { requestId } = await aliceModel.sendRequest(bob);
    await bobModel.acceptRequest(requestId);
    await expect(aliceModel.sendRequest(bob)).rejects.toThrow('Already a contact');
  });

  it('removing a contact removes it on both sides', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);
    await bobModel.acceptRequest(requestId);
    await bobModel.removeUser(alice);
    expect(await aliceModel.list()).toEqual([]);
    expect(await bobModel.list()).toEqual([]);
  });
});

describe('shared Agents', () => {
  it('adds another person’s Agent by its share handle and grants access', async () => {
    const profile = await aliceModel.addAgent('https://app.lobehub.com/a/bob-helper');
    expect(profile).toMatchObject({ agentId: bobAgent, owner: { id: bob }, shareId: bobShareId });

    const [contact] = await aliceModel.list();
    expect(contact).toMatchObject({ available: true, type: 'agent' });
    expect(await aliceModel.findAgentAccess(bobAgent)).toEqual({
      agentId: bobAgent,
      name: null,
      ownerId: bob,
      shareId: bobShareId,
      title: 'Bob Helper',
      workspaceId: null,
    });
    // Adding twice keeps one entry.
    await aliceModel.addAgent(bobShareId);
    expect(await aliceModel.list()).toHaveLength(1);
  });

  it('pausing the share keeps the contact but removes access', async () => {
    await aliceModel.addAgent('bob-helper');
    await serverDB.update(agentShares).set({ visibility: 'private' });

    const [contact] = await aliceModel.list();
    expect(contact).toMatchObject({ available: false, type: 'agent' });
    expect(await aliceModel.findAgentAccess(bobAgent)).toBeUndefined();
    await expect(carolModel.addAgent('bob-helper')).rejects.toThrow('Agent not found');
  });

  it('does not grant access without a contact entry or to your own Agent', async () => {
    expect(await carolModel.findAgentAccess(bobAgent)).toBeUndefined();
    await expect(bobModel.addAgent('bob-helper')).rejects.toThrow('This Agent is already yours');
  });

  it('reads only a person’s public profile fields', async () => {
    expect(await aliceModel.findUser(bob)).toEqual({
      avatar: null,
      fullName: 'Bob',
      id: bob,
      username: 'Bob',
    });
    expect(await aliceModel.findUser('missing')).toBeUndefined();
  });

  it('lists a person’s link-shared Agents to anyone, contact or not', async () => {
    expect((await carolModel.listSharedAgentsOf(bob)).map((a) => a.agentId)).toEqual([bobAgent]);
    await serverDB.update(agentShares).set({ visibility: 'private' });
    expect(await carolModel.listSharedAgentsOf(bob)).toEqual([]);
  });
});

describe('search', () => {
  it('finds people by exact username, case-insensitively, with their relation', async () => {
    const [result] = await aliceModel.search('@BOB');
    expect(result).toMatchObject({ relation: 'none', type: 'user', user: { id: bob } });
    expect(await aliceModel.search('bo')).toEqual([]);
    const [self] = await aliceModel.search('alice');
    expect(self).toMatchObject({ relation: 'self' });
  });

  it('finds Agents by share handle and link', async () => {
    const [result] = await aliceModel.search('https://app.lobehub.com/a/bob-helper');
    expect(result).toMatchObject({ agent: { agentId: bobAgent }, relation: 'none', type: 'agent' });
    await aliceModel.addAgent('bob-helper');
    const [added] = await aliceModel.search('bob-helper');
    expect(added).toMatchObject({ relation: 'contact' });
  });
});
