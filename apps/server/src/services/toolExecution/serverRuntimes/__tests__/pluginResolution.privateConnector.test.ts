// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { agents, userConnectors, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolvePluginIdentifier } from '../pluginResolution';

const owner = 'pr-owner';
const mate = 'pr-mate';
const workspaceId = 'pr-ws';
const privateAgent = 'pr-agent-private';
const workspaceAgent = 'pr-agent-workspace';

// No installed-plugin projection: the connector row is the only source
const pluginModel = { findById: async () => undefined, query: async () => [] } as any;

let serverDB: LobeChatDatabase;

const resolve = (userId: string, agentId: string) =>
  resolvePluginIdentifier(
    'acme-notes',
    { connectorModel: new ConnectorModel(serverDB, userId, workspaceId), pluginModel },
    { agentId },
  );

beforeEach(async () => {
  serverDB = await getTestDB();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: mate }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: 'pr-ws' });
  await serverDB.insert(agents).values([
    { id: privateAgent, userId: owner, visibility: 'private', workspaceId },
    { id: workspaceAgent, userId: owner, visibility: 'public', workspaceId },
  ]);
  // The owner's connected private custom MCP connector
  await serverDB.insert(userConnectors).values({
    identifier: 'acme-notes',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://notes.example.com/mcp',
    name: 'Acme Notes',
    sourceType: 'custom',
    status: 'connected',
    userId: owner,
    visibility: 'private',
    workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('resolvePluginIdentifier with a private connector', () => {
  it("lets the owner pin their private connector on their private agent's config", async () => {
    // Regression: validation resolved connectors the way a topic-free run does,
    // which keeps every private row out, so Agent Builder and installPlugin
    // refused the connector the agent runs in its own conversation.
    expect(await resolve(owner, privateAgent)).toEqual({ source: 'connector', status: 'loadable' });
  });

  it('keeps it unknown to a workspace agent and to a teammate', async () => {
    expect(await resolve(owner, workspaceAgent)).toMatchObject({ status: 'unknown' });
    expect(await resolve(mate, privateAgent)).toMatchObject({ status: 'unknown' });
  });
});
