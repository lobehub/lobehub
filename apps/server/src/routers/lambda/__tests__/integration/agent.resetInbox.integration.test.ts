// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_INBOX_TITLE } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, workspaceMembers, workspaces } from '@/database/schemas';

import { agentRouter } from '../../agent';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let db: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => db) }));

describe('agent.resetInboxAgent integration', () => {
  let userId: string;
  let memberId: string;

  const caller = (workspaceId?: string, viewer = userId) =>
    agentRouter.createCaller({ ...createTestContext(viewer), serverDB: db, workspaceId });

  const readAgent = async (id: string) => {
    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return row;
  };

  /** Provision the default assistant and personalize it the way the profile editor does. */
  const customizedInbox = async (workspaceId?: string) => {
    const api = caller(workspaceId);
    const inbox = await api.getBuiltinAgent({ slug: BUILTIN_AGENT_SLUGS.inbox });
    await api.updateAgentConfig({
      agentId: inbox!.id,
      value: {
        avatar: '🏗️',
        model: 'custom-model',
        params: { temperature: 0.2 },
        provider: 'custom-provider',
        systemRole: 'You are an architect.',
        title: 'Arquiteto Kolden',
      },
    });
    return inbox!.id;
  };

  beforeEach(async () => {
    db = await getTestDB();
    userId = await createTestUser(db);
    memberId = await createTestUser(db);
  });

  afterEach(async () => {
    await cleanupTestUser(db, memberId);
    await cleanupTestUser(db, userId);
  });

  it('returns the default assistant to its defaults and keeps it the inbox', async () => {
    const inboxId = await customizedInbox();
    expect(await readAgent(inboxId)).toMatchObject({
      systemRole: 'You are an architect.',
      title: 'Arquiteto Kolden',
    });

    const result = await caller().resetInboxAgent({ agentId: inboxId });

    expect(result.success).toBe(true);
    expect(result.agent).toMatchObject({ id: inboxId, title: DEFAULT_INBOX_TITLE });
    expect(await readAgent(inboxId)).toMatchObject({
      avatar: null,
      id: inboxId,
      model: null,
      params: {},
      provider: null,
      slug: BUILTIN_AGENT_SLUGS.inbox,
      systemRole: null,
      title: null,
    });
    // Still resolved as the builtin: no second inbox was provisioned.
    const inbox = await caller().getBuiltinAgent({ slug: BUILTIN_AGENT_SLUGS.inbox });
    expect(inbox).toMatchObject({ id: inboxId, title: DEFAULT_INBOX_TITLE });
  });

  it('refuses an ordinary agent and leaves it untouched', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ systemRole: 'keep me', title: 'Custom agent', userId })
      .returning();

    await expect(caller().resetInboxAgent({ agentId: agent.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(await readAgent(agent.id)).toMatchObject({
      systemRole: 'keep me',
      title: 'Custom agent',
    });
  });

  it("does not let a workspace member wipe the workspace's shared default assistant", async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Reset inbox', primaryOwnerId: userId, slug: `ri-${userId}` })
      .returning();
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId: workspace.id },
      { role: 'member', userId: memberId, workspaceId: workspace.id },
    ]);
    const inboxId = await customizedInbox(workspace.id);

    await expect(
      caller(workspace.id, memberId).resetInboxAgent({ agentId: inboxId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await readAgent(inboxId)).toMatchObject({ title: 'Arquiteto Kolden' });

    await expect(caller(workspace.id).resetInboxAgent({ agentId: inboxId })).resolves.toMatchObject(
      { success: true },
    );
    expect(await readAgent(inboxId)).toMatchObject({ systemRole: null, title: null });
  });
});
