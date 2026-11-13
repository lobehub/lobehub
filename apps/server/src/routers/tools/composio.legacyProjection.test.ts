// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { userConnectors, users, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginModel } from '@/database/models/plugin';

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

const owner = 'clp-owner';
const mate = 'clp-mate';
const workspaceId = 'clp-ws';

const callerFor = (userId: string) =>
  composioToolsRouter.createCaller({ userId, workspaceId } as any);

/** A member's plugin projection row: any member can write one, under any app. */
const fileProjection = (userId: string, identifier: string, account: string, linker: string) =>
  new PluginModel(testDB, userId, workspaceId).create({
    customParams: {
      composio: { connectedAccountId: account, linkedByUserId: linker, status: 'ACTIVE' },
    },
    identifier,
    type: 'plugin',
  });

/**
 * The legacy plugin projection (`user_installed_plugins.customParams.composio`)
 * is written by members, so `tools.composio.executeAction` may serve it only
 * when no connector row in the workspace runs its account.
 */
describe('composioToolsRouter.executeAction — legacy projection (real models)', () => {
  beforeEach(async () => {
    testDB = await getTestDB();
    vi.clearAllMocks();
    mocks.toolsExecute.mockResolvedValue({ data: 'ok' });
    mocks.processToolCallResult.mockResolvedValue({ content: 'ok', success: true });

    await testDB.delete(users).where(inArray(users.id, [owner, mate]));
    await testDB.insert(users).values([{ id: owner }, { id: mate }]);
    await testDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: workspaceId });
    // The owner's Gmail connection, made private.
    await testDB.insert(userConnectors).values({
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'acc-owner', linkedByUserId: owner } },
      name: 'Gmail',
      sourceType: 'marketplace',
      status: 'connected',
      userId: owner,
      visibility: 'private',
      workspaceId,
    });
  });

  afterEach(async () => {
    await testDB.delete(users).where(inArray(users.id, [owner, mate]));
  });

  /**
   * @example
   * expect(executeAction({ identifier: 'google-calendar' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
   */
  it("does not run a teammate's private account filed under another app's projection", async () => {
    // ROOT CAUSE:
    //
    // A projection counted as a mirror only of connector rows with its own identifier. A member
    // copied the private Gmail account and its linker into a projection under `google-calendar`,
    // the Gmail row did not claim it, and it ran as a legacy connection: the route forwards any
    // toolSlug with that account and entity to Composio.
    await fileProjection(mate, 'google-calendar', 'acc-owner', owner);

    await expect(
      callerFor(mate).executeAction({
        identifier: 'google-calendar',
        toolSlug: 'GMAIL_SEND_EMAIL',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.toolsExecute).not.toHaveBeenCalled();
  });

  it('still runs a legacy connection no connector row holds', async () => {
    await fileProjection(mate, 'google-calendar', 'acc-mate-legacy', mate);

    await callerFor(mate).executeAction({
      identifier: 'google-calendar',
      toolSlug: 'GOOGLECALENDAR_LIST_EVENTS',
    });

    expect(mocks.toolsExecute).toHaveBeenCalledWith(
      'GOOGLECALENDAR_LIST_EVENTS',
      expect.objectContaining({ connectedAccountId: 'acc-mate-legacy', userId: mate }),
    );
  });
});
