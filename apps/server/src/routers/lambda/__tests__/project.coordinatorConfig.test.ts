// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentBotProviders, agents, projects } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillProjectCoordinatorOwnership } from '@/database/repositories/projectCoordinatorOwnership';

import { projectRouter } from '../project';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// The project's General channel is another aggregate; not under test here.
vi.mock('@/server/services/channel/defaultChannel', () => ({
  createDefaultChannel: vi.fn(async () => undefined),
}));

/**
 * The project settings read and write the main agent's configuration through
 * the project (`project.getCoordinatorConfig` / `project.updateCoordinatorConfig`).
 */
describe('project coordinator config by project', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const caller = () => projectRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it('creates a project whose main agent is the project’s own, then reads and writes it by project', async () => {
    const created = await caller().create({ identifier: 'CFGA', name: 'Atlas' });
    const projectId = created!.data.id;
    const agentId = created!.data.coordinatorAgentId;

    const [agent] = await serverDB.select().from(agents).where(eq(agents.id, agentId));
    expect(agent.ownerProjectId).toBe(projectId);

    const read = await caller().getCoordinatorConfig({ id: projectId });
    expect(read!.data).toMatchObject({
      agentId,
      editable: true,
      ownerProjectId: projectId,
      projectId,
      source: 'owned',
    });
    expect(read!.data.config.title).toBe('Atlas Project Agent');

    const written = await caller().updateCoordinatorConfig({
      config: { model: 'claude-opus-5-5', provider: 'anthropic', systemRole: 'Lead Atlas.' },
      id: projectId,
      responsibility: 'Keeps Atlas on schedule',
    });
    expect(written!.data).toMatchObject({
      config: { model: 'claude-opus-5-5', provider: 'anthropic', systemRole: 'Lead Atlas.' },
      responsibility: 'Keeps Atlas on schedule',
      source: 'owned',
    });

    const [stored] = await serverDB.select().from(agents).where(eq(agents.id, agentId));
    expect(stored).toMatchObject({
      model: 'claude-opus-5-5',
      ownerProjectId: projectId,
      provider: 'anthropic',
      systemRole: 'Lead Atlas.',
    });
  });

  it('reads a migrated legacy project’s prompt, model and IM connection through the project', async () => {
    await serverDB.insert(agents).values({
      id: 'agt_routerLegacy',
      model: 'gpt-5',
      provider: 'openai',
      systemRole: 'Legacy prompt',
      userId,
      virtual: true,
    });
    await serverDB.insert(agentBotProviders).values({
      agentId: 'agt_routerLegacy',
      applicationId: 'router-legacy-bot',
      credentials: 'encrypted-secret',
      platform: 'slack',
      userId,
    });
    await serverDB.insert(projects).values({
      coordinatorAgentId: 'agt_routerLegacy',
      id: 'prj_routerLegacy',
      identifier: 'RLEG',
      name: 'Legacy',
      userId,
    });

    await backfillProjectCoordinatorOwnership(serverDB);
    const read = await caller().getCoordinatorConfig({ id: 'prj_routerLegacy' });

    expect(read!.data).toMatchObject({
      agentId: 'agt_routerLegacy',
      config: {
        botProviders: [
          { applicationId: 'router-legacy-bot', enabled: true, platform: 'slack', settings: {} },
        ],
        model: 'gpt-5',
        provider: 'openai',
        systemRole: 'Legacy prompt',
      },
      ownerProjectId: 'prj_routerLegacy',
      source: 'owned',
    });
    expect(JSON.stringify(read)).not.toContain('encrypted-secret');
  });

  it('keeps LobeAI read-only from a project', async () => {
    await serverDB
      .insert(projects)
      .values({ id: 'prj_routerInbox', identifier: 'RINB', name: 'Inbox led', userId });

    const read = await caller().getCoordinatorConfig({ id: 'prj_routerInbox' });
    expect(read!.data).toMatchObject({ editable: false, source: 'builtin' });

    await expect(
      caller().updateCoordinatorConfig({ config: { systemRole: 'x' }, id: 'prj_routerInbox' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects fields outside the coordinator config', async () => {
    const created = await caller().create({ identifier: 'CFGB', name: 'Strict' });

    await expect(
      caller().updateCoordinatorConfig({
        config: { ownerProjectId: null } as any,
        id: created!.data.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('is not found for a project the caller cannot see', async () => {
    const created = await caller().create({ identifier: 'CFGC', name: 'Private' });
    const strangerId = await createTestUser(serverDB);
    const stranger = projectRouter.createCaller({
      jwtPayload: { userId: strangerId },
      userId: strangerId,
    } as any);

    await expect(stranger.getCoordinatorConfig({ id: created!.data.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await cleanupTestUser(serverDB, strangerId);
  });
});
