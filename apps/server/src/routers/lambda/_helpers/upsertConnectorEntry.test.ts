// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { userConnectors, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { upsertConnectorEntry } from './upsertConnectorEntry';

const owner = 'uce-owner';
const mate = 'uce-mate';
const workspaceId = 'uce-ws';

const gmailAccount = {
  appSlug: 'GMAIL',
  authConfigId: 'ac-gmail',
  connectedAccountId: 'ca-owner-gmail',
  status: 'ACTIVE',
};

let serverDB: LobeChatDatabase;

/** A detail-panel refresh of the Gmail plugin projection, as `syncPluginTools` sends it. */
const syncGmail = (userId: string) =>
  upsertConnectorEntry(
    {
      connectorModel: new ConnectorModel(serverDB, userId, workspaceId),
      serverDB,
      userId,
      workspaceId,
      workspaceRole: 'member',
    },
    {
      composio: gmailAccount,
      description: 'Gmail tools',
      identifier: 'gmail',
      name: 'Gmail',
      sourceType: 'marketplace',
    },
  );

const gmailRows = () =>
  serverDB
    .select({ id: userConnectors.id, metadata: userConnectors.metadata })
    .from(userConnectors)
    .where(
      and(eq(userConnectors.workspaceId, workspaceId), eq(userConnectors.identifier, 'gmail')),
    );

beforeEach(async () => {
  serverDB = await getTestDB();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: mate }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: 'uce-ws' });
  // The owner's Composio Gmail connector, switched to private
  await serverDB.insert(userConnectors).values({
    identifier: 'gmail',
    metadata: { composio: gmailAccount },
    name: 'Gmail',
    sourceType: 'marketplace',
    status: 'connected',
    userId: owner,
    visibility: 'private',
    workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('upsertConnectorEntry with a private connector', () => {
  it('refreshes the owner’s private row instead of creating a shared one', async () => {
    // Regression: the lookup saw shared rows only, so the refresh created an
    // enabled shared Gmail row holding the private account.
    const [privateRow] = await gmailRows();

    expect(await syncGmail(owner)).toEqual({ connectorId: privateRow.id, writable: true });
    expect(await gmailRows()).toEqual([
      { id: privateRow.id, metadata: { composio: gmailAccount, description: 'Gmail tools' } },
    ]);
  });

  it('creates nothing for a teammate reading the private account off the projection', async () => {
    expect(await syncGmail(mate)).toEqual({ connectorId: null, writable: false });
    expect(await gmailRows()).toHaveLength(1);
  });

  it('never stamps the projection’s linker onto a private row naming the same account', async () => {
    // A member writes a teammate's legacy account id (readable off the
    // projection) into their own private row's metadata. The detail-panel sync
    // must not then copy in the projection's attribution, or the row passes
    // for the teammate's connection and hides it from the workspace.
    const linker = 'uce-legacy-linker';
    const legacy = { ...gmailAccount, connectedAccountId: 'ca-legacy', linkedByUserId: linker };
    const [forged] = await serverDB
      .insert(userConnectors)
      .values({
        identifier: 'gmail',
        metadata: { composio: { connectedAccountId: 'ca-legacy' } },
        name: 'Gmail',
        sourceType: 'custom',
        status: 'connected',
        userId: mate,
        visibility: 'private',
        workspaceId,
      })
      .returning();

    await upsertConnectorEntry(
      {
        connectorModel: new ConnectorModel(serverDB, mate, workspaceId),
        serverDB,
        userId: mate,
        workspaceId,
        workspaceRole: 'member',
      },
      { composio: legacy, identifier: 'gmail', name: 'Gmail', sourceType: 'marketplace' },
    );

    const [row] = await serverDB
      .select({ metadata: userConnectors.metadata })
      .from(userConnectors)
      .where(eq(userConnectors.id, forged.id));
    expect(row.metadata?.composio).toEqual({ connectedAccountId: 'ca-legacy' });
    expect(
      await new ConnectorModel(serverDB, mate, workspaceId).pickLegacyComposioMirrors([
        { connectedAccountId: 'ca-legacy', identifier: 'gmail', ownerUserId: linker },
      ]),
    ).toHaveLength(1);
  });
});
