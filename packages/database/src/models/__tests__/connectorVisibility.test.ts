import { RequestTrigger } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  chatGroups,
  topics,
  userConnectors,
  userConnectorTools,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CHANNEL_TOPIC_TRIGGER } from '../../utils/topicVisibility';
import { ConnectorModel } from '../connector';
import { ConnectorToolModel } from '../connectorTool';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'cv-owner';
const mate = 'cv-mate';
const workspaceId = 'cv-ws';
const privateAgent = 'cv-agent-private';
const workspaceAgent = 'cv-agent-workspace';
const matePrivateAgent = 'cv-agent-mate-private';
const privateTopic = 'cv-topic-private';
const workspaceAgentTopic = 'cv-topic-workspace-agent';

const insertConnector = async (row: {
  agentId?: string | null;
  identifier: string;
  metadata?: Record<string, unknown> | null;
  name?: string;
  userId?: string;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}) => {
  const [created] = await serverDB
    .insert(userConnectors)
    .values({
      agentId: row.agentId ?? null,
      identifier: row.identifier,
      mcpConnectionType: 'http',
      mcpServerUrl: `https://${row.identifier}.example.com/mcp`,
      metadata: row.metadata ?? null,
      name: row.name ?? row.identifier,
      sourceType: 'custom',
      status: 'connected',
      userId: row.userId ?? owner,
      visibility: row.visibility ?? 'public',
      workspaceId: row.workspaceId === undefined ? workspaceId : row.workspaceId,
    })
    .returning();
  return created;
};

const insertTopic = async (row: {
  agentId?: string;
  groupId?: string;
  id: string;
  senderId?: string;
  trigger?: string;
  userId?: string;
}) => {
  await serverDB.insert(topics).values({
    agentId: row.agentId ?? privateAgent,
    groupId: row.groupId,
    id: row.id,
    senderId: row.senderId,
    trigger: row.trigger,
    userId: row.userId ?? owner,
    workspaceId,
  });
};

/**
 * The connector identifiers a run resolves, sorted. Each fixture row uses a
 * distinct identifier unless a test is about collisions.
 */
const resolvedIdentifiers = async (
  model: ConnectorModel,
  target: { agentId?: string; topicId?: string },
) => (await model.resolveAll(target)).map((row) => row.identifier).sort();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: mate }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: 'cv-ws' });
  await serverDB.insert(agents).values([
    { id: privateAgent, userId: owner, visibility: 'private', workspaceId },
    { id: workspaceAgent, userId: owner, visibility: 'public', workspaceId },
    { id: matePrivateAgent, userId: mate, visibility: 'private', workspaceId },
  ]);
  await insertTopic({ id: privateTopic });
  await insertTopic({ agentId: workspaceAgent, id: workspaceAgentTopic });
});

afterEach(async () => {
  await serverDB.delete(users);
});

/** Workspace shared + the owner's private + the owner's personal, plus a teammate's private. */
const seedConnectors = async () => {
  await insertConnector({ identifier: 'ws-shared-linear', userId: mate });
  await insertConnector({ identifier: 'owner-private-notion', visibility: 'private' });
  await insertConnector({ identifier: 'owner-personal-gmail', workspaceId: null });
  await insertConnector({ identifier: 'mate-private-slack', userId: mate, visibility: 'private' });
  await insertConnector({ identifier: 'mate-personal-github', userId: mate, workspaceId: null });
};

describe('connector visibility — management view', () => {
  it('lists the shared rows plus only the caller’s own private rows', async () => {
    await seedConnectors();

    const ownerList = (await new ConnectorModel(serverDB, owner, workspaceId).query())
      .map((row) => row.identifier)
      .sort();
    const mateList = (await new ConnectorModel(serverDB, mate, workspaceId).query())
      .map((row) => row.identifier)
      .sort();

    expect(ownerList).toEqual(['owner-private-notion', 'ws-shared-linear']);
    expect(mateList).toEqual(['mate-private-slack', 'ws-shared-linear']);
  });

  it('hides a private row from a teammate looking it up by id', async () => {
    const privateRow = await insertConnector({ identifier: 'notion', visibility: 'private' });

    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).findById(privateRow.id),
    ).toBeNull();
    expect(
      (await new ConnectorModel(serverDB, owner, workspaceId).findById(privateRow.id))?.id,
    ).toBe(privateRow.id);
  });

  it('exposes the visibility on public records', async () => {
    await insertConnector({ identifier: 'notion', visibility: 'private' });

    const [record] = await new ConnectorModel(serverDB, owner, workspaceId).queryPublic();

    expect(record.visibility).toBe('private');
  });
});

describe('connector visibility — runtime resolution', () => {
  it('gives a private agent the shared rows plus its owner’s private and personal rows', async () => {
    await seedConnectors();
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(
      await resolvedIdentifiers(model, { agentId: privateAgent, topicId: privateTopic }),
    ).toEqual(['owner-personal-gmail', 'owner-private-notion', 'ws-shared-linear']);
  });

  it('gives a workspace agent the shared rows only', async () => {
    await seedConnectors();
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(
      await resolvedIdentifiers(model, { agentId: workspaceAgent, topicId: workspaceAgentTopic }),
    ).toEqual(['ws-shared-linear']);
  });

  it('keeps private rows out when the run names no topic', async () => {
    await seedConnectors();
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(await resolvedIdentifiers(model, { agentId: privateAgent })).toEqual([
      'ws-shared-linear',
    ]);
    expect(await resolvedIdentifiers(model, {})).toEqual(['ws-shared-linear']);
  });

  it.each([
    ['a group topic', { groupId: 'cv-group' }],
    ['a channel run topic', { trigger: CHANNEL_TOPIC_TRIGGER }],
    ['a bot topic', { trigger: RequestTrigger.Bot }],
    ['an agent-share topic', { trigger: RequestTrigger.AgentShare }],
    ['a share visitor topic', { senderId: 'visitor-1' }],
    ['a topic of another agent', { agentId: workspaceAgent }],
  ])('keeps private rows out of %s', async (_label, topic) => {
    await serverDB
      .insert(chatGroups)
      .values({ id: 'cv-group', title: 'Group', userId: owner, workspaceId });
    await insertTopic({ id: 'cv-topic-shared-surface', ...topic });
    await seedConnectors();
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(
      await resolvedIdentifiers(model, {
        agentId: privateAgent,
        topicId: 'cv-topic-shared-surface',
      }),
    ).toEqual(['ws-shared-linear']);
  });

  it('never resolves the owner’s private rows for anyone else', async () => {
    await seedConnectors();
    // A teammate naming the owner's private agent and topic gets nothing private:
    // the agent and topic must belong to the caller.
    const mateModel = new ConnectorModel(serverDB, mate, workspaceId);

    expect(
      await resolvedIdentifiers(mateModel, { agentId: privateAgent, topicId: privateTopic }),
    ).toEqual(['ws-shared-linear']);
  });

  it('gives a teammate’s private agent the teammate’s private rows, not the owner’s', async () => {
    await insertTopic({ agentId: matePrivateAgent, id: 'cv-topic-mate', userId: mate });
    await seedConnectors();
    const mateModel = new ConnectorModel(serverDB, mate, workspaceId);

    expect(
      await resolvedIdentifiers(mateModel, { agentId: matePrivateAgent, topicId: 'cv-topic-mate' }),
    ).toEqual(['mate-personal-github', 'mate-private-slack', 'ws-shared-linear']);
  });

  it('does not resolve a private row mounted by a workspace agent', async () => {
    await insertConnector({
      identifier: 'notion',
      metadata: { mountedByAgentId: workspaceAgent },
      visibility: 'private',
    });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(
      await resolvedIdentifiers(model, { agentId: workspaceAgent, topicId: workspaceAgentTopic }),
    ).toEqual([]);
  });

  it('leaves personal-mode resolution unchanged', async () => {
    await seedConnectors();
    const personal = new ConnectorModel(serverDB, owner);

    expect(await resolvedIdentifiers(personal, {})).toEqual(['owner-personal-gmail']);
  });

  it('keeps agentless identifier lookups to the shared rows', async () => {
    await insertConnector({ identifier: 'notion', visibility: 'private' });
    const shared = await insertConnector({ identifier: 'notion', userId: mate });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect((await model.queryByIdentifiers(['notion'])).map((row) => row.id)).toEqual([shared.id]);
    expect((await model.queryReferencesByIdentifiers(['notion'])).map((row) => row.id)).toEqual([
      shared.id,
    ]);
  });
});

describe('connector visibility — agent configuration', () => {
  const availableIdentifiers = async (model: ConnectorModel, agentId?: string) =>
    (await model.queryAvailableForAgent(agentId)).map((row) => row.identifier).sort();

  it('offers a private agent its owner’s private and personal rows without a topic', async () => {
    // Regression: validation ran the topic-free runtime scope, so Agent Builder
    // refused to enable the owner's private connector on their private agent.
    await seedConnectors();
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(await availableIdentifiers(model, privateAgent)).toEqual([
      'owner-personal-gmail',
      'owner-private-notion',
      'ws-shared-linear',
    ]);
  });

  it('offers a workspace agent, or a teammate naming the private agent, the shared rows only', async () => {
    await seedConnectors();
    const ownerModel = new ConnectorModel(serverDB, owner, workspaceId);
    const mateModel = new ConnectorModel(serverDB, mate, workspaceId);

    expect(await availableIdentifiers(ownerModel, workspaceAgent)).toEqual(['ws-shared-linear']);
    expect(await availableIdentifiers(mateModel, privateAgent)).toEqual(['ws-shared-linear']);
    expect(await availableIdentifiers(ownerModel)).toEqual(['ws-shared-linear']);
  });

  it('reports the row the agent’s own conversation ranks first, without credentials', async () => {
    await insertConnector({ identifier: 'notion', userId: mate });
    const privateRow = await insertConnector({ identifier: 'notion', visibility: 'private' });
    await serverDB
      .update(userConnectors)
      .set({ isEnabled: false })
      .where(eq(userConnectors.id, privateRow.id));
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(await model.queryAvailableForAgent(privateAgent)).toEqual([
      { identifier: 'notion', isEnabled: false, status: 'connected' },
    ]);
  });
});

describe('connector visibility — priority within one identifier', () => {
  it('prefers the owner’s workspace-private row, then personal, then shared', async () => {
    const shared = await insertConnector({ identifier: 'gmail', userId: mate });
    const personal = await insertConnector({ identifier: 'gmail', workspaceId: null });
    const workspacePrivate = await insertConnector({ identifier: 'gmail', visibility: 'private' });
    const model = new ConnectorModel(serverDB, owner, workspaceId);
    const target = { agentId: privateAgent, topicId: privateTopic };

    expect((await model.resolveByIdentifiers(['gmail'], target)).map((r) => r.id)).toEqual([
      workspacePrivate.id,
    ]);

    await serverDB.delete(userConnectors).where(eq(userConnectors.id, workspacePrivate.id));
    expect((await model.resolveByIdentifiers(['gmail'], target)).map((r) => r.id)).toEqual([
      personal.id,
    ]);

    await serverDB.delete(userConnectors).where(eq(userConnectors.id, personal.id));
    expect((await model.resolveByIdentifiers(['gmail'], target)).map((r) => r.id)).toEqual([
      shared.id,
    ]);
  });

  it('lets an agent binding outrank whose connection it is', async () => {
    await insertConnector({ identifier: 'gmail', visibility: 'private' });
    const agentOwned = await insertConnector({ agentId: privateAgent, identifier: 'gmail' });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect(
      (
        await model.resolveByIdentifiers(['gmail'], {
          agentId: privateAgent,
          topicId: privateTopic,
        })
      ).map((r) => r.id),
    ).toEqual([agentOwned.id]);
  });

  it('breaks a tie by id, not by physical row order', async () => {
    const [first, second] = [
      await insertConnector({ identifier: 'gmail', userId: mate }),
      await insertConnector({ identifier: 'gmail', userId: owner }),
    ].sort((a, b) => a.id.localeCompare(b.id));
    const model = new ConnectorModel(serverDB, owner, workspaceId);
    // Touch the lower id so it moves to the end of the heap.
    await serverDB
      .update(userConnectors)
      .set({ name: 'touched' })
      .where(eq(userConnectors.id, first.id));

    const [picked] = await model.resolveByIdentifiers(['gmail'], {
      agentId: privateAgent,
      topicId: privateTopic,
    });

    expect(picked.id).toBe(first.id);
    expect(picked.id).not.toBe(second.id);
  });
});

describe('connector visibility — write paths', () => {
  it('looks up the idempotency row within one visibility', async () => {
    const shared = await insertConnector({ identifier: 'notion', userId: mate });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    expect((await model.findScopedByIdentifier('notion'))?.id).toBe(shared.id);
    expect(
      await model.findScopedByIdentifier('notion', undefined, undefined, 'private'),
    ).toBeNull();

    const mine = await insertConnector({ identifier: 'notion', visibility: 'private' });
    expect(
      (await model.findScopedByIdentifier('notion', undefined, undefined, 'private'))?.id,
    ).toBe(mine.id);
    // A teammate's private row of the same identifier is never "mine".
    await insertConnector({ identifier: 'slack', userId: mate, visibility: 'private' });
    expect(await model.findScopedByIdentifier('slack', undefined, undefined, 'private')).toBeNull();
  });

  it('targets the row holding the Composio account a write names', async () => {
    const composio = (connectedAccountId: string) => ({ composio: { connectedAccountId } });
    const shared = await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-shared'),
      userId: mate,
    });
    const mine = await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-mine'),
      visibility: 'private',
    });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    // Removing or refreshing the shared account (Settings lists it) must not
    // land on the caller's private connection of the same app.
    expect((await model.findManageableByIdentifier('gmail', undefined, 'acc-shared'))?.id).toBe(
      shared.id,
    );
    expect((await model.findManageableByIdentifier('gmail', undefined, 'acc-mine'))?.id).toBe(
      mine.id,
    );
    // A new connection (no account yet) keeps the private row first.
    expect((await model.findManageableByIdentifier('gmail'))?.id).toBe(mine.id);
    // An account no row holds is a legacy, workspace-wide connection: it lands
    // on the shared row, never in the caller's private one.
    expect((await model.findManageableByIdentifier('gmail', undefined, 'acc-legacy'))?.id).toBe(
      shared.id,
    );
  });

  it('never adopts a legacy Composio account into the caller’s private row', async () => {
    await insertConnector({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-mine' } },
      visibility: 'private',
    });
    const model = new ConnectorModel(serverDB, owner, workspaceId);

    // No shared row yet: the write creates one under the shared policy.
    expect(await model.findManageableByIdentifier('gmail', undefined, 'acc-legacy')).toBeNull();
  });

  it('tells when a Composio account sits on a teammate’s private connector', async () => {
    await insertConnector({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-mate' } },
      userId: mate,
      visibility: 'private',
    });
    await insertConnector({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-shared' } },
      userId: mate,
    });
    const ownerModel = new ConnectorModel(serverDB, owner, workspaceId);

    expect(await ownerModel.isComposioAccountPrivateToTeammate('acc-mate')).toBe(true);
    expect(await ownerModel.isComposioAccountPrivateToTeammate('acc-shared')).toBe(false);
    // The teammate's own row is not "a teammate's" to them, and nothing is
    // private outside a workspace.
    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).isComposioAccountPrivateToTeammate(
        'acc-mate',
      ),
    ).toBe(false);
    expect(
      await new ConnectorModel(serverDB, owner).isComposioAccountPrivateToTeammate('acc-mate'),
    ).toBe(false);
  });

  it('finds a Composio account by the account alone, whatever identifier a write names', async () => {
    // ROOT CAUSE:
    //
    // The private-account check also matched on the identifier the request
    // named. A member who read a teammate's private account id from the
    // workspace-wide projection sent it with another identifier, the check
    // missed the teammate's row, and the remote account was deleted.
    const matePrivate = await insertConnector({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-mate' } },
      userId: mate,
      visibility: 'private',
    });
    // A member's own row may name any account: its metadata is client-written.
    const forged = await insertConnector({
      identifier: 'github',
      metadata: { composio: { connectedAccountId: 'acc-mate' } },
      visibility: 'private',
    });
    await serverDB
      .insert(workspaces)
      .values({ id: 'cv-ws-other', name: 'Other', primaryOwnerId: mate, slug: 'cv-ws-other' });
    await insertConnector({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-mate' } },
      userId: mate,
      workspaceId: 'cv-ws-other',
    });
    const ownerModel = new ConnectorModel(serverDB, owner, workspaceId);

    expect(await ownerModel.isComposioAccountPrivateToTeammate('acc-mate')).toBe(true);
    // Both rows of this workspace that name the account, the teammate's private
    // one included; another workspace's row is out of scope.
    expect(
      (await ownerModel.queryComposioAccountHolders('acc-mate')).map((row) => row.id).toSorted(),
    ).toEqual([matePrivate.id, forged.id].toSorted());
    expect(await ownerModel.queryComposioAccountHolders('acc-unknown')).toEqual([]);
  });

  it('writes a personal row resolved in a workspace run through its personal scope', async () => {
    const personal = await insertConnector({ identifier: 'gmail', workspaceId: null });
    const workspaceModel = new ConnectorModel(serverDB, owner, workspaceId);

    // The workspace model alone cannot reach the personal row.
    await workspaceModel.update(personal.id, { name: 'via workspace' });
    expect(
      (await serverDB.select().from(userConnectors).where(eq(userConnectors.id, personal.id)))[0]
        .name,
    ).toBe('gmail');

    await workspaceModel.forRow(personal).update(personal.id, { name: 'via home scope' });
    expect(
      (await serverDB.select().from(userConnectors).where(eq(userConnectors.id, personal.id)))[0]
        .name,
    ).toBe('via home scope');
  });

  it('never re-homes a teammate’s or a workspace row', async () => {
    const workspaceModel = new ConnectorModel(serverDB, owner, workspaceId);
    const matePersonal = await insertConnector({
      identifier: 'github',
      userId: mate,
      workspaceId: null,
    });
    const shared = await insertConnector({ identifier: 'linear' });

    expect(workspaceModel.forRow(matePersonal)).toBe(workspaceModel);
    expect(workspaceModel.forRow(shared)).toBe(workspaceModel);
  });
});

describe('connector visibility — legacy Composio projection', () => {
  const composio = (connectedAccountId: string, linkedByUserId?: string) => ({
    composio: { connectedAccountId, ...(linkedByUserId && { linkedByUserId }) },
  });
  /** The owner's legacy connection, as the workspace-wide plugin projection holds it. */
  const legacy = { connectedAccountId: 'acc-legacy', identifier: 'gmail', ownerUserId: owner };
  const legacyFor = (userId: string) =>
    new ConnectorModel(serverDB, userId, workspaceId).pickLegacyComposioMirrors([legacy]);

  it('keeps a teammate’s legacy connection when a member adds a private connector of the app', async () => {
    // ROOT CAUSE:
    //
    // Any connector row of the identifier counted as the projection's connector,
    // so a member's private row — added without the shared connector policy —
    // took the legacy connection away from every other member.
    await insertConnector({ identifier: 'gmail', userId: mate, visibility: 'private' });
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-mate', mate),
      userId: mate,
      visibility: 'private',
    });

    expect(await legacyFor(owner)).toEqual([legacy]);
    expect(await legacyFor(mate)).toEqual([legacy]);
  });

  it('keeps it when a member writes the legacy account id into their own row', async () => {
    // Every member reads the projection's account ids, and a connector's
    // metadata is client-written: an account id alone proves nothing.
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-legacy'),
      userId: mate,
      visibility: 'private',
    });
    await insertConnector({
      agentId: matePrivateAgent,
      identifier: 'gmail',
      metadata: composio('acc-legacy'),
      userId: mate,
    });

    expect(await legacyFor(mate)).toEqual([legacy]);
  });

  it('withholds the mirror of a connector its creator made private', async () => {
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-legacy', owner),
      visibility: 'private',
    });

    expect(await legacyFor(mate)).toEqual([]);
  });

  it('withholds a private connection copied into a projection row of another app', async () => {
    // ROOT CAUSE:
    //
    // Only connector rows of the mirror's identifier were compared, and every
    // member can write a projection row under any app. Copying a teammate's
    // privatized account and entity under another identifier made it pass as
    // a legacy connection, and Composio runs any tool on it.
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-legacy', owner),
      visibility: 'private',
    });
    const forged = { ...legacy, identifier: 'notion' };

    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).pickLegacyComposioMirrors([forged]),
    ).toEqual([]);
    // Another app's account, or the same account under another entity, is not
    // this connection.
    const unrelated = [
      { ...forged, connectedAccountId: 'acc-other' },
      { ...forged, ownerUserId: mate },
    ];
    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).pickLegacyComposioMirrors(unrelated),
    ).toEqual(unrelated);
  });

  it('withholds the mirror of an account an agent row now runs', async () => {
    await insertConnector({
      agentId: workspaceAgent,
      identifier: 'gmail',
      metadata: composio('acc-legacy'),
    });

    expect(await legacyFor(mate)).toEqual([]);
  });

  it('withholds the previous account while its linker reconnects the app', async () => {
    // The private row already holds the new, still pending account; the
    // projection rows of other members still carry the previous one.
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-reconnecting', owner),
      visibility: 'private',
    });

    expect(await legacyFor(mate)).toEqual([]);
    // A mirror of another app, or linked by someone else, is unaffected.
    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).pickLegacyComposioMirrors([
        { ...legacy, identifier: 'slack' },
        { ...legacy, ownerUserId: mate },
      ]),
    ).toEqual([
      { ...legacy, identifier: 'slack' },
      { ...legacy, ownerUserId: mate },
    ]);
  });

  it('looks at the caller’s own rows outside a workspace', async () => {
    await insertConnector({
      identifier: 'gmail',
      metadata: composio('acc-legacy', owner),
      workspaceId: null,
    });

    expect(await new ConnectorModel(serverDB, owner).pickLegacyComposioMirrors([legacy])).toEqual(
      [],
    );
    expect(
      await new ConnectorModel(serverDB, mate).pickLegacyComposioMirrors([
        { ...legacy, ownerUserId: mate },
      ]),
    ).toEqual([{ ...legacy, ownerUserId: mate }]);
  });
});

describe('connector visibility — tool rows of a resolved personal connector', () => {
  const insertTool = async (connector: {
    id: string;
    userId: string;
    workspaceId: string | null;
  }) =>
    serverDB.insert(userConnectorTools).values({
      crudType: 'read',
      permission: 'auto',
      toolName: 'search',
      userConnectorId: connector.id,
      userId: connector.userId,
      workspaceId: connector.workspaceId,
    });

  it('lets the workspace run read the caller’s own personal connector tools by id', async () => {
    const personal = await insertConnector({ identifier: 'gmail', workspaceId: null });
    await insertTool(personal);
    const toolModel = new ConnectorToolModel(serverDB, owner, workspaceId, { agentRun: true });

    expect((await toolModel.queryAllByConnectorIds([personal.id])).map((t) => t.toolName)).toEqual([
      'search',
    ]);
    expect((await toolModel.queryByConnector(personal.id)).map((t) => t.toolName)).toEqual([
      'search',
    ]);
    // Name lookups without a resolved connector stay strictly scoped.
    expect(await toolModel.findByToolName('search')).toBeUndefined();
  });

  it('never reads a teammate’s personal connector tools', async () => {
    const matePersonal = await insertConnector({
      identifier: 'github',
      userId: mate,
      workspaceId: null,
    });
    await insertTool(matePersonal);
    const toolModel = new ConnectorToolModel(serverDB, owner, workspaceId, { agentRun: true });

    expect(await toolModel.queryAllByConnectorIds([matePersonal.id])).toEqual([]);
  });

  it('hides a teammate’s private connector tools', async () => {
    const matePrivate = await insertConnector({
      identifier: 'slack',
      userId: mate,
      visibility: 'private',
    });
    await insertTool(matePrivate);

    expect(
      await new ConnectorToolModel(serverDB, owner, workspaceId, {
        agentRun: true,
      }).queryByConnector(matePrivate.id),
    ).toEqual([]);
    expect(
      (
        await new ConnectorToolModel(serverDB, mate, workspaceId, {
          agentRun: true,
        }).queryByConnector(matePrivate.id)
      ).length,
    ).toBe(1);
  });
});
