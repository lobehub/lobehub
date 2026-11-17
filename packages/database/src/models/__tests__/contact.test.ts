// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentShares,
  userContactRequests,
  userContacts,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
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
const teamId = 'contact-test-team';
const aliceInTeam = new ContactModel(serverDB, alice, teamId);
const carolInTeam = new ContactModel(serverDB, carol, teamId);
// A model resolves the caller's role in the scope once, like one request; Bob's changes as he
// joins, so each use gets a fresh one.
const bobInTeam = () => new ContactModel(serverDB, bob, teamId);

let bobShareId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { fullName: 'Alice', id: alice, username: 'alice' },
    { fullName: 'Bob', id: bob, username: 'Bob' },
    { id: carol, username: 'carol' },
  ]);
  await serverDB
    .insert(workspaces)
    .values({ id: teamId, name: 'Team', primaryOwnerId: alice, slug: teamId });
  // Alice owns the team and Carol is a member; Bob stays outside it.
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: alice, workspaceId: teamId },
    { role: 'member', userId: carol, workspaceId: teamId },
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
  await serverDB.delete(workspaces);
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

    await expect(aliceModel.cancelRequest(requestId)).resolves.toEqual({ addresseeId: bob });
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

describe('shared Agents in a workspace', () => {
  it('belong to the workspace: every member sees and can message them', async () => {
    await aliceInTeam.addAgent('bob-helper');
    const [entry] = await serverDB.select().from(userContacts);
    expect(entry).toMatchObject({ agentId: bobAgent, userId: alice, workspaceId: teamId });

    for (const member of [aliceInTeam, carolInTeam]) {
      expect(await member.list()).toMatchObject([{ agent: { agentId: bobAgent } }]);
      expect(await member.findAgentAccess(bobAgent)).toMatchObject({ ownerId: bob });
      expect((await member.search('bob-helper'))[0]).toMatchObject({ relation: 'contact' });
    }
    // Neither personal address book holds it.
    expect(await aliceModel.list()).toEqual([]);
    expect(await carolModel.findAgentAccess(bobAgent)).toBeUndefined();
    expect((await aliceModel.search('bob-helper'))[0]).toMatchObject({ relation: 'none' });
  });

  it('lists people only in the personal space', async () => {
    await bobModel.sendRequest(alice);
    const [request] = await aliceModel.listRequests();
    await aliceModel.acceptRequest(request.id);
    expect(await aliceModel.list()).toMatchObject([{ type: 'user', user: { id: bob } }]);
    // A personal contact is not a colleague: the workspace lists its members instead.
    expect(await aliceInTeam.list()).toEqual([]);
    expect(await aliceInTeam.isContact(bob)).toBe(false);
    // Nor does it let Bob into the workspace.
    await expect(bobInTeam().list()).rejects.toThrow('Not a member of this workspace');
  });

  it('holds an Agent once per workspace, apart from personal entries', async () => {
    await aliceModel.addAgent('bob-helper');
    await aliceInTeam.addAgent('bob-helper');
    await carolInTeam.addAgent(bobShareId);
    expect(await serverDB.select().from(userContacts)).toHaveLength(2);

    // Any member removes it for the workspace; the personal entry stays.
    await carolInTeam.removeAgent(bobAgent);
    expect(await aliceInTeam.list()).toEqual([]);
    expect(await aliceModel.list()).toHaveLength(1);
  });
});

describe('external contacts of a workspace', () => {
  /** Alice invites Bob from the team and Bob accepts it from his personal space. */
  const inviteBob = async () => {
    const { requestId } = await aliceInTeam.sendRequest(bob, 'Join us');
    const [invitation] = await bobModel.listRequests();
    expect(invitation).toMatchObject({
      direction: 'incoming',
      id: requestId,
      user: { id: alice },
      workspace: { id: teamId, name: 'Team' },
    });
    expect(await bobModel.acceptRequest(requestId)).toEqual({
      contactUserId: alice,
      workspaceId: teamId,
    });
  };

  it('keeps the invitation in its own scope until it is answered', async () => {
    await aliceInTeam.sendRequest(bob);
    // The inviter sees it in the team, not in her personal space.
    expect(await aliceInTeam.listRequests()).toMatchObject([
      { direction: 'outgoing', user: { id: bob } },
    ]);
    expect(await aliceModel.listRequests()).toEqual([]);
    expect(await carolInTeam.listRequests()).toEqual([]);
    expect(await aliceInTeam.relationTo(bob)).toBe('request_sent');
    expect(await aliceModel.relationTo(bob)).toBe('none');
    // A personal request between the same two people is separate.
    expect(await aliceModel.sendRequest(bob)).toMatchObject({ status: 'pending' });
  });

  it('invites only people outside the workspace, and only as a member', async () => {
    await expect(aliceInTeam.sendRequest(carol)).rejects.toThrow('Already a member');
    expect(await aliceInTeam.relationTo(carol)).toBe('member');
    await inviteBob();
    await expect(bobInTeam().sendRequest(carol)).rejects.toThrow('Only members add contacts');
  });

  it('shows an external contact only the inviter, and nothing else of the workspace', async () => {
    await carolInTeam.addAgent('bob-helper');
    await inviteBob();

    expect(await bobInTeam().list()).toMatchObject([{ type: 'user', user: { id: alice } }]);
    expect(await bobInTeam().search('carol')).toEqual([]);
    expect(await bobInTeam().listRequests()).toEqual([]);
    expect(await bobInTeam().findAgentAccess(bobAgent)).toBeUndefined();
    // His personal address book is untouched.
    expect(await bobModel.list()).toEqual([]);
  });

  it('lists every external contact to every member, marking who is open to them', async () => {
    await inviteBob();
    const externals = (items: Awaited<ReturnType<ContactModel['list']>>) =>
      items.filter((item) => item.type === 'user');

    expect(externals(await aliceInTeam.list())).toMatchObject([
      { external: { openedToMe: true }, user: { id: bob } },
    ]);
    expect(externals(await carolInTeam.list())).toMatchObject([
      { external: { openedToMe: false }, user: { id: bob } },
    ]);

    // Carol opens herself; Bob now sees her too.
    await carolInTeam.openTo(bob);
    expect(externals(await carolInTeam.list())).toMatchObject([
      { external: { openedToMe: true }, user: { id: bob } },
    ]);
    expect((await bobInTeam().list()).map((item) => item.type === 'user' && item.user.id)).toEqual(
      expect.arrayContaining([alice, carol]),
    );

    // Closing again only removes her own pairing.
    await carolInTeam.removeUser(bob);
    expect(await bobInTeam().list()).toMatchObject([{ user: { id: alice } }]);
  });

  it('opens only to an external contact, never a stranger or a colleague', async () => {
    await expect(carolInTeam.openTo(bob)).rejects.toThrow('External contact not found');
    await expect(carolInTeam.openTo(alice)).rejects.toThrow('External contact not found');
  });

  it('lets an owner or admin remove an external contact from the workspace', async () => {
    await inviteBob();
    await carolInTeam.openTo(bob);
    await expect(carolInTeam.removeExternal(bob)).rejects.toThrow('Only owners and admins');

    await aliceInTeam.removeExternal(bob);
    expect(await carolInTeam.list()).toEqual([]);
    await expect(bobInTeam().list()).rejects.toThrow('Not a member of this workspace');
  });

  it('lets the invitation lapse once the inviter leaves the workspace', async () => {
    const { requestId } = await carolInTeam.sendRequest(bob);
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, carol));
    await expect(bobModel.acceptRequest(requestId)).rejects.toThrow('Request not found');
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

describe('contact edge cases', () => {
  it('treats a bare @ as no handle at all', () => {
    expect(parseContactHandle('@')).toBeUndefined();
  });

  it('reports a person already in the address book as a contact', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);
    await bobModel.acceptRequest(requestId);

    expect(await aliceModel.relationTo(bob)).toBe('contact');
  });

  it('lists a request in both directions', async () => {
    await aliceModel.sendRequest(bob);

    const [outgoing] = await aliceModel.listRequests();
    expect(outgoing).toMatchObject({ direction: 'outgoing', user: { id: bob } });

    const [incoming] = await bobModel.listRequests();
    expect(incoming).toMatchObject({ direction: 'incoming', user: { id: alice } });
  });

  it('declines a pending request without creating a contact', async () => {
    const { requestId } = await aliceModel.sendRequest(bob);

    await expect(bobModel.declineRequest(requestId)).resolves.toEqual({ requesterId: alice });

    expect(await aliceModel.list()).toEqual([]);
    expect(await aliceModel.relationTo(bob)).toBe('none');
    const [row] = await serverDB
      .select({ status: userContactRequests.status })
      .from(userContactRequests)
      .where(eq(userContactRequests.id, requestId));
    expect(row.status).toBe('declined');
  });

  it('rejects a request to somebody who does not exist', async () => {
    await expect(aliceModel.sendRequest('contact-test-missing')).rejects.toThrow('User not found');
  });

  it('rejects a request id that is not a uuid', async () => {
    await expect(aliceModel.cancelRequest('not-a-uuid')).rejects.toThrow('Request not found');
    await expect(bobModel.acceptRequest('not-a-uuid')).rejects.toThrow('Request not found');
    await expect(bobModel.declineRequest('not-a-uuid')).rejects.toThrow('Request not found');
  });

  it('refuses to add an Agent when the handle names nothing', async () => {
    await expect(aliceModel.addAgent('@')).rejects.toThrow('Agent not found');
    expect(await aliceModel.search('@')).toEqual([]);
  });

  it('removes a shared Agent from the address book', async () => {
    await aliceModel.addAgent('bob-helper');

    await aliceModel.removeAgent(bobAgent);

    expect(await aliceModel.list()).toEqual([]);
    expect(await aliceModel.findAgentAccess(bobAgent)).toBeUndefined();
  });

  it('reports an Agent that has no title as having none', async () => {
    await serverDB.insert(agents).values({ id: 'agt_contact_untitled', userId: bob });
    await serverDB.insert(agentShares).values({
      agentId: 'agt_contact_untitled',
      shareConfig: { monthlySpendLimit: 1, slug: 'untitled-helper' },
      visibility: 'link',
    });

    const [found] = await aliceModel.search('untitled-helper');

    expect(found.type).toBe('agent');
    expect(found.agent?.title).toBeNull();
  });

  it('marks your own Agent share as your own', async () => {
    await serverDB
      .update(agentShares)
      .set({ shareConfig: { monthlySpendLimit: 1, slug: 'alice-helper' } })
      .where(eq(agentShares.agentId, aliceAgent));

    const [own] = await aliceModel.search('alice-helper');

    expect(own).toMatchObject({ agent: { agentId: aliceAgent }, relation: 'self', type: 'agent' });
  });
});
