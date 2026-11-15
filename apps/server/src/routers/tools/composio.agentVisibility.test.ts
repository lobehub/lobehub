// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  userConnectors,
  userConnectorTools,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composioToolsRouter } from './composio';

const mocks = vi.hoisted(() => ({
  processToolCallResult: vi.fn(),
  toolsExecute: vi.fn(),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => testDB),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({ tools: { execute: mocks.toolsExecute } }),
  isComposioClientAvailable: () => true,
  isComposioConnectedAccountNotFoundError: () => false,
}));

vi.mock('@/server/services/mcp', () => ({
  MCPService: { processToolCallResult: mocks.processToolCallResult },
}));

const owner = 'cav-owner';
const mate = 'cav-mate';
const workspaceId = 'cav-ws';
const agentId = 'cav-agent';
let connectorId: string;

const callerFor = (userId: string) =>
  composioToolsRouter.createCaller({ userId, workspaceId } as any);

const call = {
  agentId,
  identifier: 'gmail',
  toolArgs: { to: 'a@b.c' },
  toolSlug: 'GMAIL_SEND_EMAIL',
};

/**
 * A member runs a Composio tool as an agent through the manual
 * `tools.composio.executeAction`, which takes the agent id from the client.
 * The agent's own Composio row (`agent_id = agentId`) is a shared workspace
 * row, so the agent's visibility is what keeps it from a teammate.
 */
describe('composioToolsRouter.executeAction — agent visibility (real models)', () => {
  beforeEach(async () => {
    testDB = await getTestDB();
    vi.clearAllMocks();
    mocks.toolsExecute.mockResolvedValue({ data: 'sent' });
    mocks.processToolCallResult.mockResolvedValue({ content: 'sent', success: true });

    await testDB.delete(users).where(inArray(users.id, [owner, mate]));
    await testDB.insert(users).values([{ id: owner }, { id: mate }]);
    await testDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: workspaceId });
    // A workspace (public) agent, with a Composio account bound to it by its owner.
    await testDB
      .insert(agents)
      .values({ id: agentId, userId: owner, visibility: 'public', workspaceId });
    const [connector] = await testDB
      .insert(userConnectors)
      .values({
        agentId,
        identifier: 'gmail',
        metadata: { composio: { connectedAccountId: 'acc-agent', linkedByUserId: owner } },
        name: 'Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        userId: owner,
        visibility: 'public',
        workspaceId,
      })
      .returning();
    connectorId = connector.id;
    await testDB.insert(userConnectorTools).values({
      crudType: 'write',
      permission: 'auto',
      toolName: 'GMAIL_SEND_EMAIL',
      userConnectorId: connectorId,
      userId: owner,
      workspaceId,
    });
  });

  afterEach(async () => {
    await testDB.delete(users).where(inArray(users.id, [owner, mate]));
  });

  /**
   * @example
   * expect(executeAction({ agentId: privatizedAgent })).rejects.toMatchObject({ code: 'NOT_FOUND' });
   */
  it("stops running an agent's Composio account for a teammate once the agent is made private", async () => {
    // ROOT CAUSE:
    //
    // The route handed the client's agentId to the resolver unchecked. An agent's own rows are
    // scoped by workspace only, so a teammate who kept the id of an agent made private ran its
    // Composio account with any tool and arguments. Only an agent the caller can see resolves.

    // While the agent is a workspace agent, a teammate may run it.
    await callerFor(mate).executeAction(call);
    expect(mocks.toolsExecute).toHaveBeenCalledTimes(1);
    expect(mocks.toolsExecute).toHaveBeenLastCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'acc-agent', userId: owner }),
    );

    await testDB.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agentId));

    await expect(callerFor(mate).executeAction(call)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Naming a topic does not get around it either.
    await expect(
      callerFor(mate).executeAction({ ...call, topicId: 'cav-any-topic' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.toolsExecute).toHaveBeenCalledTimes(1);

    // The owner still runs their own private agent.
    await callerFor(owner).executeAction(call);
    expect(mocks.toolsExecute).toHaveBeenCalledTimes(2);
    expect(mocks.toolsExecute).toHaveBeenLastCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'acc-agent', userId: owner }),
    );
  });

  /**
   * @example
   * expect(executeAction({ agentId, toolSlug: unlistedTool })).rejects.toMatchObject({ code: 'NOT_FOUND' });
   * expect(composio.tools.execute).not.toHaveBeenCalled();
   */
  it("refuses a slug missing from the agent's Composio tool list, for a teammate and the owner", async () => {
    // ROOT CAUSE:
    //
    // The per-tool gate blocked only a `disabled` row. A provider tool absent from the synced
    // rows read as allowed, so a member who saw a workspace agent sent any Gmail action, with any
    // arguments, under the owner's account.
    for (const userId of [mate, owner]) {
      await expect(
        callerFor(userId).executeAction({ ...call, toolSlug: 'GMAIL_DELETE_MESSAGE' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(mocks.toolsExecute).not.toHaveBeenCalled();

    // A tool the connector lists still runs.
    await callerFor(mate).executeAction(call);
    expect(mocks.toolsExecute).toHaveBeenCalledTimes(1);
  });

  /**
   * @example
   * expect(executeAction({ agentId, toolSlug: disabledTool })).resolves.toMatchObject({ success: true });
   * expect(composio.tools.execute).not.toHaveBeenCalled();
   */
  it("blocks a tool disabled on the agent's Composio connector, for a teammate and the owner", async () => {
    // ROOT CAUSE:
    //
    // The manual route resolved the agent's account and called Composio as its owner without the
    // per-tool gate the runtime applies (`ToolExecutionService`), so a member who saw a workspace
    // agent ran a tool its owner had disabled, with any arguments. The route now reads the
    // resolved connector's tool settings and returns the runtime's blocked-tool response.
    await testDB
      .update(userConnectorTools)
      .set({ permission: 'disabled' })
      .where(eq(userConnectorTools.userConnectorId, connectorId));

    for (const userId of [mate, owner]) {
      const result = await callerFor(userId).executeAction(call);
      expect(result).toMatchObject({
        content: expect.stringContaining('"GMAIL_SEND_EMAIL" has been disabled'),
        success: true,
      });
    }
    // Naming the conversation does not get around it either.
    await callerFor(mate).executeAction({ ...call, topicId: 'cav-any-topic' });
    expect(mocks.toolsExecute).not.toHaveBeenCalled();

    // Re-enabled, the same call runs the agent's account again.
    await testDB
      .update(userConnectorTools)
      .set({ permission: 'auto' })
      .where(eq(userConnectorTools.userConnectorId, connectorId));
    await callerFor(mate).executeAction(call);
    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ connectedAccountId: 'acc-agent', userId: owner }),
    );
  });
});
