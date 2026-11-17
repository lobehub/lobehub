// @vitest-environment node
import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { PROJECT_AGENT_LABEL } from '../../../models/projectMainAgent';
import {
  agentBotProviders,
  agentLabelAssignments,
  agentLabels,
  agents,
  chatGroups,
  chatGroupsAgents,
  projectAgents,
  projectCoordinatorOwnershipLog,
  projects,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ProjectRepository } from '../../project';
import { ProjectCoordinatorRepository } from '../../projectCoordinator';
import {
  ProjectCoordinatorConfigError,
  ProjectCoordinatorConfigRepository,
} from '../../projectCoordinatorConfig';
import {
  backfillProjectCoordinatorOwnership,
  classifyProjectCoordinator,
  revertProjectCoordinatorOwnership,
} from '../index';

const db: LobeChatDatabase = await getTestDB();
const userId = 'coord-owner-user';
const projectRepo = new ProjectRepository(db, userId);
const configRepo = new ProjectCoordinatorConfigRepository(db, userId);
const agentModel = new AgentModel(db, userId);

let sequence = 0;
const nextIdentifier = () => `C${String(++sequence).padStart(5, '0')}`;

/** A coordinator configured the way a long-lived project's would be, plus an IM bot. */
const RICH_CONFIG = {
  chatConfig: { enableHistoryCount: true, historyCount: 12 } as any,
  description: 'Coordinates the Legacy project',
  model: 'claude-opus-5-5',
  openingMessage: 'Hi, I run this project.',
  openingQuestions: ['What is blocked?', 'What ships next?'],
  params: { temperature: 0.3, top_p: 0.9 },
  plugins: ['lobe-web-browsing', 'lobe-artifacts'],
  provider: 'anthropic',
  systemRole: 'You are the coordinator agent of a project.\nKeep the roadmap honest.',
  title: 'Legacy Project Agent',
};

const findAgent = async (id: string) => {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row;
};

const countRows = async (
  table: typeof agents | typeof agentBotProviders | typeof projectCoordinatorOwnershipLog,
) => {
  const [{ value }] = await db.select({ value: count() }).from(table as any);
  return value;
};

const labelAsProjectAgent = async (agentId: string) => {
  let [label] = await db.select().from(agentLabels).where(eq(agentLabels.userId, userId));
  if (!label) {
    [label] = await db
      .insert(agentLabels)
      .values({ name: PROJECT_AGENT_LABEL, userId })
      .returning();
  }
  await db.insert(agentLabelAssignments).values({ agentId, labelId: label.id, userId });
};

/** An agent a project created before ownership existed: `Project` label, no mark. */
const insertLabelledCoordinator = async (id: string, config: Record<string, unknown> = {}) => {
  await db.insert(agents).values({ id, userId, ...config });
  await labelAsProjectAgent(id);
  return id;
};

/** A project row as it sits in the database before the migration, seated coordinator included. */
const insertLegacyProject = async (id: string, coordinatorAgentId: string | null) => {
  await db
    .insert(projects)
    .values({ coordinatorAgentId, id, identifier: nextIdentifier(), name: id, userId });
  if (coordinatorAgentId) {
    await db.insert(projectAgents).values({
      addedByUserId: userId,
      agentId: coordinatorAgentId,
      projectId: id,
      role: 'coordinator',
    });
  }
};

const insertBot = (agentId: string, applicationId: string, platform = 'telegram') =>
  db.insert(agentBotProviders).values({
    agentId,
    applicationId,
    credentials: `encrypted:${applicationId}`,
    enabled: true,
    platform,
    settings: { charLimit: 4000, dmPolicy: 'open' },
    userId,
  });

/** The per-field configuration as stored before the migration (agent row + bots). */
const readStoredConfig = async (agentId: string) => {
  const agent = await findAgent(agentId);
  const bots = await db
    .select()
    .from(agentBotProviders)
    .where(eq(agentBotProviders.agentId, agentId))
    .orderBy(agentBotProviders.platform, agentBotProviders.applicationId);
  return { agent, bots };
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('creating a project', () => {
  it('marks the main agent it creates as the project’s own', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Apollo' });

    const agent = await findAgent(project.coordinatorAgentId!);
    expect(agent.ownerProjectId).toBe(project.id);
    // Nothing about the agent itself changes: it is still an ordinary agent.
    expect(agent.virtual).toBe(false);
    expect(agent.title).toBe('Apollo Project Agent');
  });

  it('marks the reserved agent id the create form passes', async () => {
    const project = await projectRepo.create({
      dedicatedAgentId: 'agt_reservedOwnr',
      id: 'prj_reservedOwnr',
      identifier: nextIdentifier(),
      name: 'Reserved',
    });

    expect(project.coordinatorAgentId).toBe('agt_reservedOwnr');
    expect((await findAgent('agt_reservedOwnr')).ownerProjectId).toBe('prj_reservedOwnr');
  });

  it('only links an agent the user picked, without marking it', async () => {
    const picked = await agentModel.create({ title: 'My agent' });
    const project = await projectRepo.create({
      coordinatorAgentId: picked.id,
      identifier: nextIdentifier(),
      name: 'Linked',
    });

    expect(project.coordinatorAgentId).toBe(picked.id);
    expect((await findAgent(picked.id)).ownerProjectId).toBeNull();
  });

  it('keeps the agent when the project is deleted, only clearing the mark', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Gone' });
    const agentId = project.coordinatorAgentId!;
    await agentModel.update(agentId, { systemRole: 'kept prompt' });

    await projectRepo.delete(project.id);

    const agent = await findAgent(agentId);
    expect(agent).toBeDefined();
    expect(agent.ownerProjectId).toBeNull();
    expect(agent.systemRole).toBe('kept prompt');
  });

  it('hands the owned agent back to the agents list when another agent takes over', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Handover' });
    const previousId = project.coordinatorAgentId!;
    const successor = await agentModel.create({ title: 'Successor' });

    await new ProjectCoordinatorRepository(db, userId).replaceCoordinator(project.id, successor.id);

    expect((await findAgent(previousId)).ownerProjectId).toBeNull();
    expect((await findAgent(successor.id)).ownerProjectId).toBeNull();
  });

  it('never lets an agent config write set or clear the mark', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Guarded' });
    const agentId = project.coordinatorAgentId!;

    await agentModel.update(agentId, { ownerProjectId: null, systemRole: 'edited' } as any);
    await agentModel.updateConfig(agentId, { ownerProjectId: null } as any);
    const created = await agentModel.create({
      ownerProjectId: project.id,
      title: 'Squatter',
    } as any);

    expect((await findAgent(agentId)).ownerProjectId).toBe(project.id);
    expect((await findAgent(agentId)).systemRole).toBe('edited');
    expect((await findAgent(created.id)).ownerProjectId).toBeNull();
  });
});

describe('backfillProjectCoordinatorOwnership — owned coordinator', () => {
  it('marks a labelled coordinator, keeping prompt, model and IM connection field by field', async () => {
    const agentId = await insertLabelledCoordinator('agt_legacyOwned', {
      ...RICH_CONFIG,
      agencyConfig: { executionTarget: 'sandbox' },
    });
    await insertBot(agentId, 'tg-legacy-1');
    await insertBot(agentId, 'discord-legacy-1', 'discord');
    await insertLegacyProject('prj_legacyOwned', agentId);

    const before = await readStoredConfig(agentId);
    const agentsBefore = await countRows(agents);
    const botsBefore = await countRows(agentBotProviders);

    const progress = await backfillProjectCoordinatorOwnership(db, { batchSize: 10 });
    expect(progress).toMatchObject({ marked: 1, scanned: 1 });
    expect(progress.decisions.owned).toBe(1);

    const after = await readStoredConfig(agentId);
    // The only change to the agent row is the ownership mark.
    expect(after.agent.ownerProjectId).toBe('prj_legacyOwned');
    // (`accessed_at` / `updated_at` are row bookkeeping drizzle stamps on any update.)
    const bookkeeping = { accessedAt: null, ownerProjectId: null, updatedAt: null };
    expect({ ...after.agent, ...bookkeeping }).toEqual({ ...before.agent, ...bookkeeping });
    // IM connections, credentials included, are untouched.
    expect(after.bots).toEqual(before.bots);
    // Nothing deleted.
    expect(await countRows(agents)).toBe(agentsBefore);
    expect(await countRows(agentBotProviders)).toBe(botsBefore);

    // The project settings read the same configuration, field by field.
    const read = await configRepo.getConfig('prj_legacyOwned');
    expect(read).toMatchObject({
      agentId,
      editable: true,
      ownerProjectId: 'prj_legacyOwned',
      sharedWithProjectIds: [],
      source: 'owned',
    });
    const c = read!.config;
    expect(c.systemRole).toBe(before.agent.systemRole);
    expect(c.systemRole).toBe(RICH_CONFIG.systemRole);
    expect(c.model).toBe(before.agent.model);
    expect(c.provider).toBe(before.agent.provider);
    expect(c.params).toEqual(before.agent.params);
    expect(c.plugins).toEqual(before.agent.plugins);
    expect(c.chatConfig).toEqual(before.agent.chatConfig);
    expect(c.agencyConfig).toEqual(before.agent.agencyConfig);
    expect(c.openingMessage).toBe(before.agent.openingMessage);
    expect(c.openingQuestions).toEqual(before.agent.openingQuestions);
    expect(c.title).toBe(before.agent.title);
    expect(c.description).toBe(before.agent.description);
    expect(c.botProviders).toEqual(
      before.bots.map((bot) => ({
        applicationId: bot.applicationId,
        enabled: bot.enabled,
        platform: bot.platform,
        settings: bot.settings,
      })),
    );
    // Credentials never leave agent_bot_providers.
    expect(JSON.stringify(read)).not.toContain('encrypted:');

    // The log keeps a verbatim snapshot taken at migration time.
    const [log] = await db
      .select()
      .from(projectCoordinatorOwnershipLog)
      .where(eq(projectCoordinatorOwnershipLog.projectId, 'prj_legacyOwned'));
    expect(log).toMatchObject({ agentId, decision: 'owned', marked: true, revertedAt: null });
    expect(log.configSnapshot).toEqual(read!.config);
  });

  it('marks a pre-November virtual coordinator that no group holds', async () => {
    await db
      .insert(agents)
      .values({ id: 'agt_virtualOld', systemRole: 'old prompt', userId, virtual: true });
    await insertLegacyProject('prj_virtualOld', 'agt_virtualOld');

    await backfillProjectCoordinatorOwnership(db);

    expect((await findAgent('agt_virtualOld')).ownerProjectId).toBe('prj_virtualOld');
    expect((await findAgent('agt_virtualOld')).systemRole).toBe('old prompt');
  });
});

describe('backfillProjectCoordinatorOwnership — shared agent', () => {
  it('leaves a coordinator two projects lead unmarked, with both projects logged shared', async () => {
    const agentId = await insertLabelledCoordinator('agt_sharedLead', RICH_CONFIG);
    await insertBot(agentId, 'tg-shared-1');
    await insertLegacyProject('prj_sharedA', agentId);
    await insertLegacyProject('prj_sharedB', agentId);
    const before = await readStoredConfig(agentId);

    const progress = await backfillProjectCoordinatorOwnership(db);

    expect(progress.decisions).toMatchObject({ owned: 0, shared: 2 });
    expect(progress.marked).toBe(0);
    const after = await readStoredConfig(agentId);
    expect(after.agent).toEqual(before.agent);
    expect(after.bots).toEqual(before.bots);

    const logs = await db.select().from(projectCoordinatorOwnershipLog);
    expect(logs.map((l) => [l.projectId, l.decision]).sort()).toEqual([
      ['prj_sharedA', 'shared'],
      ['prj_sharedB', 'shared'],
    ]);

    // Each project still reads (and may write) the one shared configuration.
    const read = await configRepo.getConfig('prj_sharedA');
    expect(read).toMatchObject({
      agentId,
      editable: true,
      ownerProjectId: null,
      sharedWithProjectIds: ['prj_sharedB'],
      source: 'shared',
    });
    expect(read!.config.systemRole).toBe(RICH_CONFIG.systemRole);
  });

  it('treats a coordinator seated as a member of another project as shared', async () => {
    const agentId = await insertLabelledCoordinator('agt_sharedSeat');
    await insertLegacyProject('prj_seatLead', agentId);
    await insertLegacyProject('prj_seatOther', null);
    await db
      .insert(projectAgents)
      .values({ addedByUserId: userId, agentId, projectId: 'prj_seatOther' });

    await backfillProjectCoordinatorOwnership(db);

    expect((await findAgent(agentId)).ownerProjectId).toBeNull();
    expect(
      await classifyProjectCoordinator(db, { agentId, projectId: 'prj_seatLead' }),
    ).toMatchObject({ decision: 'shared' });
  });

  it('does not take a virtual group member for a provisioned coordinator', async () => {
    await db.insert(agents).values({ id: 'agt_groupMember', userId, virtual: true });
    const [group] = await db.insert(chatGroups).values({ title: 'G', userId }).returning();
    await db
      .insert(chatGroupsAgents)
      .values({ agentId: 'agt_groupMember', chatGroupId: group.id, userId });
    await insertLegacyProject('prj_groupMember', 'agt_groupMember');

    await backfillProjectCoordinatorOwnership(db);

    expect((await findAgent('agt_groupMember')).ownerProjectId).toBeNull();
    const [log] = await db.select().from(projectCoordinatorOwnershipLog);
    expect(log.decision).toBe('user_picked');
  });
});

describe('backfillProjectCoordinatorOwnership — LobeAI default', () => {
  it('never marks LobeAI, whether the project falls back to it or picked it', async () => {
    const inbox = await agentModel.getBuiltinAgent('inbox');
    await agentModel.update(inbox!.id, { systemRole: 'LobeAI prompt' });
    await insertLegacyProject('prj_fallback', null);
    await insertLegacyProject('prj_pickedInbox', inbox!.id);

    const progress = await backfillProjectCoordinatorOwnership(db);

    expect(progress.decisions).toMatchObject({ builtin: 1, fallback_null: 1, owned: 0 });
    expect((await findAgent(inbox!.id)).ownerProjectId).toBeNull();
    const logs = await db.select().from(projectCoordinatorOwnershipLog);
    expect(Object.fromEntries(logs.map((l) => [l.projectId, [l.decision, l.agentId]]))).toEqual({
      prj_fallback: ['fallback_null', null],
      prj_pickedInbox: ['builtin', inbox!.id],
    });
    // The fallback stays a read-time fallback; nothing is written to the project.
    const [project] = await db.select().from(projects).where(eq(projects.id, 'prj_fallback'));
    expect(project.coordinatorAgentId).toBeNull();

    // The project settings show LobeAI read-only.
    for (const projectId of ['prj_fallback', 'prj_pickedInbox']) {
      const read = await configRepo.getConfig(projectId);
      expect(read).toMatchObject({ agentId: inbox!.id, editable: false, source: 'builtin' });
      expect(read!.config.systemRole).toBe('LobeAI prompt');
      await expect(
        configRepo.updateConfig(projectId, { config: { systemRole: 'hijack' } }),
      ).rejects.toThrow(ProjectCoordinatorConfigError);
    }
    expect((await findAgent(inbox!.id)).systemRole).toBe('LobeAI prompt');
  });
});

describe('backfillProjectCoordinatorOwnership — user-picked agent', () => {
  it('links the user’s own agent without marking it, and writes through to it', async () => {
    const mine = await agentModel.create({ ...RICH_CONFIG, title: 'My researcher' });
    await insertLegacyProject('prj_userPicked', mine.id);

    const progress = await backfillProjectCoordinatorOwnership(db);

    expect(progress.decisions).toMatchObject({ owned: 0, user_picked: 1 });
    expect((await findAgent(mine.id)).ownerProjectId).toBeNull();

    const updated = await configRepo.updateConfig('prj_userPicked', {
      config: { model: 'gpt-5', provider: 'openai' },
    });
    expect(updated).toMatchObject({ source: 'user_picked', editable: true });
    expect(updated!.config).toMatchObject({ model: 'gpt-5', provider: 'openai' });
    expect((await findAgent(mine.id)).model).toBe('gpt-5');
  });
});

describe('backfillProjectCoordinatorOwnership — idempotency', () => {
  it('a second run classifies nothing, adds no rows and overrides nothing changed since', async () => {
    const owned = await insertLabelledCoordinator('agt_idemOwned', RICH_CONFIG);
    await insertBot(owned, 'tg-idem-1');
    await insertLegacyProject('prj_idemOwned', owned);
    const shared = await insertLabelledCoordinator('agt_idemShared');
    await insertLegacyProject('prj_idemSharedA', shared);
    await insertLegacyProject('prj_idemSharedB', shared);
    await insertLegacyProject('prj_idemFallback', null);

    const first = await backfillProjectCoordinatorOwnership(db, { batchSize: 2 });
    expect(first).toMatchObject({ marked: 1, scanned: 4 });
    const logsAfterFirst = await db.select().from(projectCoordinatorOwnershipLog);

    // The project's settings now are the authority: edit through them.
    await configRepo.updateConfig('prj_idemOwned', {
      config: { systemRole: 'edited after migration' },
      responsibility: 'Ship the roadmap',
    });
    const agentsBefore = await countRows(agents);

    const second = await backfillProjectCoordinatorOwnership(db, { batchSize: 2 });

    expect(second).toMatchObject({ marked: 0, scanned: 0 });
    expect(await countRows(projectCoordinatorOwnershipLog)).toBe(4);
    expect(await db.select().from(projectCoordinatorOwnershipLog)).toEqual(logsAfterFirst);
    expect(await countRows(agents)).toBe(agentsBefore);
    const read = await configRepo.getConfig('prj_idemOwned');
    expect(read!.config.systemRole).toBe('edited after migration');
    expect(read!.responsibility).toBe('Ship the roadmap');
    expect((await findAgent(owned)).ownerProjectId).toBe('prj_idemOwned');
    expect((await findAgent(shared)).ownerProjectId).toBeNull();
  });

  it('logs projects created after deployment as owned without rewriting them', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Fresh' });

    const progress = await backfillProjectCoordinatorOwnership(db);

    expect(progress).toMatchObject({ marked: 0, scanned: 1 });
    expect(progress.decisions.owned).toBe(1);
    expect((await findAgent(project.coordinatorAgentId!)).ownerProjectId).toBe(project.id);
  });

  it('a dry run writes nothing', async () => {
    const agentId = await insertLabelledCoordinator('agt_dryRun');
    await insertLegacyProject('prj_dryRun', agentId);

    const progress = await backfillProjectCoordinatorOwnership(db, { apply: false });

    expect(progress).toMatchObject({ marked: 0, scanned: 1 });
    expect(progress.decisions.owned).toBe(1);
    expect(await countRows(projectCoordinatorOwnershipLog)).toBe(0);
    expect((await findAgent(agentId)).ownerProjectId).toBeNull();
  });

  it('reverts only the marks it made, and stays reverted on a rerun', async () => {
    const agentId = await insertLabelledCoordinator('agt_revert', RICH_CONFIG);
    await insertLegacyProject('prj_revert', agentId);
    const created = await projectRepo.create({ identifier: nextIdentifier(), name: 'Native' });
    await backfillProjectCoordinatorOwnership(db);
    const before = await findAgent(agentId);

    expect(await revertProjectCoordinatorOwnership(db)).toEqual({ cleared: 1 });
    expect(await revertProjectCoordinatorOwnership(db)).toEqual({ cleared: 0 });
    await backfillProjectCoordinatorOwnership(db);

    const after = await findAgent(agentId);
    expect(after.ownerProjectId).toBeNull();
    expect(after.systemRole).toBe(before.systemRole);
    // Ownership written at creation is not the migration's to undo.
    expect((await findAgent(created.coordinatorAgentId!)).ownerProjectId).toBe(created.id);
  });
});

describe('ProjectCoordinatorConfigRepository — writes by project', () => {
  it('writes prompt, model and responsibility to the project’s own coordinator', async () => {
    const project = await projectRepo.create({ identifier: nextIdentifier(), name: 'Editable' });

    const updated = await configRepo.updateConfig(project.id, {
      config: {
        model: 'claude-sonnet-5-5',
        params: { temperature: 0.1 },
        provider: 'anthropic',
        systemRole: 'Run Editable.',
        // Not a coordinator config field: ignored.
        ...({ ownerProjectId: null, userId: 'someone-else' } as any),
      },
      responsibility: 'Owns the release train',
    });

    expect(updated).toMatchObject({
      agentId: project.coordinatorAgentId,
      ownerProjectId: project.id,
      responsibility: 'Owns the release train',
      source: 'owned',
    });
    expect(updated!.config).toMatchObject({
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      systemRole: 'Run Editable.',
    });
    expect(updated!.config.params).toMatchObject({ temperature: 0.1 });
    const agent = await findAgent(project.coordinatorAgentId!);
    expect(agent.userId).toBe(userId);
    expect(agent.ownerProjectId).toBe(project.id);
  });

  it('resolves a project by slug or identifier, and returns null for one the caller cannot see', async () => {
    const project = await projectRepo.create({ identifier: 'CFGX', name: 'Lookup' });

    expect((await configRepo.getConfig('CFGX'))?.projectId).toBe(project.id);
    expect(
      await new ProjectCoordinatorConfigRepository(db, 'stranger').getConfig(project.id),
    ).toBeNull();
    expect(
      await new ProjectCoordinatorConfigRepository(db, 'stranger').updateConfig(project.id, {
        config: { systemRole: 'x' },
      }),
    ).toBeNull();
  });
});
