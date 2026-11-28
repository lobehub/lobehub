// @vitest-environment node
import type {
  AgentShareAuthorizationChange,
  AgentShareAuthorizationChangeSet,
  AgentShareAuthorizationObserver,
} from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'authorization-test-owner';
const adminId = 'authorization-test-admin';
const visitorId = 'authorization-test-visitor';
const agentId = 'authorization-test-agent';
const workspaceAgentId = 'authorization-test-workspace-agent';
const workspaceId = 'authorization-test-workspace';

let reported: AgentShareAuthorizationChangeSet[];
const observer: AgentShareAuthorizationObserver = async (changeSet) => {
  reported.push(changeSet);
};

const ownerShares = new AgentShareModel(serverDB, ownerId, undefined, {
  onAuthorizationChange: observer,
});

/** Every reported change, flattened, with the change set's actor and notice. */
const changesFor = (id: string) =>
  reported
    .filter((changeSet) => changeSet.agentId === id)
    .flatMap(({ changes, ...changeSet }) =>
      changes.map((change: AgentShareAuthorizationChange) => ({ ...changeSet, ...change })),
    );

const approve = (shareId: string, grantId: string) =>
  AgentShareModel.grantByRequest(
    serverDB,
    { channelId: 'chn_test', grantId, shareId, userId: visitorId },
    { actorUserId: ownerId, onAuthorizationChange: observer },
  );

describe('AgentShareModel authorization changes', () => {
  beforeEach(async () => {
    reported = [];
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: ownerId }, { id: adminId }, { id: visitorId }]);
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Authorization Test Workspace',
      primaryOwnerId: ownerId,
      slug: 'authorization-test-workspace',
    });
    await serverDB.insert(agents).values([
      { id: agentId, slug: 'authorization-agent', userId: ownerId },
      { id: workspaceAgentId, userId: ownerId, workspaceId },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('reports publishing with every grant it switches on', async () => {
    await ownerShares.create(agentId);
    await ownerShares.updateConfig(agentId, { allowReadMemory: true });
    expect(changesFor(agentId)).toMatchObject([{ kind: 'agent_share.capabilities' }]);

    const share = await ownerShares.updateVisibility(agentId, 'link');
    const changes = changesFor(agentId);

    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual({
      actorUserId: ownerId,
      after: {
        capabilities: expect.objectContaining({ allowReadMemory: true }),
        deviceAccess: { deviceAccess: 'none', deviceAllowUserIds: [], shareId: share!.id },
        disclosure: { allowCreatorViewSessions: false, shareId: share!.id },
        shareId: share!.id,
        visibility: 'link',
      },
      agentId,
      before: { shareId: share!.id, visibility: 'private' },
      kind: 'agent_share.visibility',
      notice: undefined,
      workspaceId: null,
    });
  });

  it('reports nothing for a share that admits nobody or a patch that grants nothing', async () => {
    await ownerShares.create(agentId);
    await ownerShares.updateConfig(agentId, {
      demoCases: [{ description: 'd', prompt: 'p' }],
      maxMessagesPerVisitor: 3,
    });
    await ownerShares.updateSlug(agentId, 'authorization-slug');

    expect(reported).toEqual([]);
  });

  it('reports the confirmed notice with the mutation it was confirmed for', async () => {
    await ownerShares.create(agentId, 'link');
    reported = [];
    const notice = { id: 'agent_share.device_access', locale: 'zh-CN', version: '2026-11-26' };

    await ownerShares.updateConfig(
      agentId,
      {
        deviceAccess: 'everyone',
        toolGrants: [{ identifier: 'web-browsing' }, { apis: ['b', 'a'], identifier: 'calc' }],
      },
      { notice },
    );

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          after: expect.objectContaining({ deviceAccess: 'everyone', deviceAllowUserIds: [] }),
          before: expect.objectContaining({ deviceAccess: 'none' }),
          kind: 'agent_share.device_access',
        }),
        expect.objectContaining({
          after: expect.objectContaining({
            toolGrants: [{ apis: ['a', 'b'], identifier: 'calc' }, { identifier: 'web-browsing' }],
          }),
          kind: 'agent_share.capabilities',
        }),
      ]),
      notice,
    });
  });

  it('rolls the mutation back when the observer rejects', async () => {
    await ownerShares.create(agentId, 'link');
    const failing = new AgentShareModel(serverDB, ownerId, undefined, {
      onAuthorizationChange: vi.fn().mockRejectedValue(new Error('unavailable')),
    });

    await expect(failing.updateVisibility(agentId, 'private')).rejects.toThrow('unavailable');
    await expect(failing.updateConfig(agentId, { allowReadMemory: true })).rejects.toThrow(
      'unavailable',
    );

    const share = await ownerShares.getByAgentId(agentId);
    expect(share).toMatchObject({ visibility: 'link' });
    expect(share?.shareConfig?.allowReadMemory).not.toBe(true);
  });

  it('reports nothing for a mutation that was refused', async () => {
    await ownerShares.create(agentId, 'link');
    reported = [];
    const refusing = new AgentShareModel(serverDB, ownerId, undefined, {
      authorizeMutation: vi.fn().mockRejectedValue(new Error('denied')),
      onAuthorizationChange: observer,
    });

    await expect(refusing.updateVisibility(agentId, 'private')).rejects.toThrow('denied');

    expect(reported).toEqual([]);
  });

  it('runs share mutations without an observer', async () => {
    await new AgentShareModel(serverDB, ownerId).create(agentId, 'link');
    await new AgentShareModel(serverDB, ownerId).updateVisibility(agentId, 'private');

    expect(reported).toEqual([]);
    expect(await ownerShares.getByAgentId(agentId)).toMatchObject({ visibility: 'private' });
  });

  it('reports pausing as a visibility change', async () => {
    await ownerShares.create(agentId, 'link');
    await ownerShares.updateVisibility(agentId, 'private');

    expect(changesFor(agentId)[1]).toMatchObject({
      after: { visibility: 'private' },
      before: { visibility: 'link' },
      kind: 'agent_share.visibility',
    });
  });

  it('reports a Workspace administrator stopping a share under their own name', async () => {
    const workspaceShares = new AgentShareModel(serverDB, ownerId, workspaceId);
    const share = await workspaceShares.create(workspaceAgentId, 'link');

    await AgentShareModel.forceDisableWorkspaceShare(serverDB, workspaceId, share.id, {
      actorUserId: adminId,
      onAuthorizationChange: observer,
    });

    expect(changesFor(workspaceAgentId)).toMatchObject([
      {
        actorUserId: adminId,
        after: { visibility: 'private' },
        kind: 'agent_share.visibility',
        workspaceId,
      },
    ]);
  });

  it('reports a person admitted by an approved request once, and their removal', async () => {
    const share = await ownerShares.create(agentId, 'card');
    reported = [];

    await approve(share.id, 'grant-1');
    await approve(share.id, 'grant-1');
    await expect(ownerShares.revokeGrant(agentId, visitorId)).resolves.toBe(true);
    await approve(share.id, 'grant-1');

    expect(changesFor(agentId)).toEqual([
      {
        actorUserId: ownerId,
        after: { shareId: share.id, source: 'request', userId: visitorId },
        agentId,
        before: null,
        kind: 'agent_share.person_grant',
        workspaceId: null,
      },
      {
        actorUserId: ownerId,
        after: null,
        agentId,
        before: { shareId: share.id, source: 'request', userId: visitorId },
        kind: 'agent_share.person_grant',
        workspaceId: null,
      },
      expect.objectContaining({
        after: expect.objectContaining({ userId: visitorId }),
        before: null,
      }),
    ]);
  });

  // A request grant also admits the person to the device outside the address book, so an
  // approval that turns their card grant into one widens what they reach.
  it('reports an approval that turns a card grant into a request grant', async () => {
    const share = await ownerShares.create(agentId, 'card');
    reported = [];
    await AgentShareModel.grant(serverDB, {
      issuedAt: new Date(),
      shareId: share.id,
      source: { channelId: 'chn_test', messageId: 'msg_card', type: 'card' },
      userId: visitorId,
    });

    await approve(share.id, 'grant-1');
    await approve(share.id, 'grant-2');

    expect(changesFor(agentId)).toMatchObject([
      {
        actorUserId: ownerId,
        after: { source: 'request', userId: visitorId },
        before: { source: 'card', userId: visitorId },
        kind: 'agent_share.person_grant',
      },
    ]);
    expect(changesFor(agentId)).toHaveLength(1);
    expect(await AgentShareModel.requestGrantedUserIds(serverDB, share.id, [visitorId])).toEqual([
      visitorId,
    ]);
  });

  it('reports one admission when the same approval arrives twice at once', async () => {
    const share = await ownerShares.create(agentId, 'card');
    reported = [];

    await Promise.all([
      approve(share.id, 'grant-1'),
      approve(share.id, 'grant-2'),
      approve(share.id, 'grant-3'),
    ]);
    await ownerShares.revokeGrant(agentId, visitorId);
    await Promise.all([approve(share.id, 'grant-4'), approve(share.id, 'grant-5')]);

    expect(changesFor(agentId).map((change) => [!!change.before, !!change.after])).toEqual([
      [false, true],
      [true, false],
      [false, true],
    ]);
    expect(await AgentShareModel.requestGrantedUserIds(serverDB, share.id, [visitorId])).toEqual([
      visitorId,
    ]);
  });
});
