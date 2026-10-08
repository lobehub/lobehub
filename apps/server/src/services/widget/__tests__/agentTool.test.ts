// @vitest-environment node
import { DashboardExecutionRuntime } from '@lobechat/builtin-tool-dashboard/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  projects,
  topics,
  users,
  widgets,
  widgetVersions,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardModel } from '@/database/models/dashboard';
import { dashboardRuntime } from '@/server/services/toolExecution/serverRuntimes/dashboard';

import { createDashboardToolService, resolveClientTopic } from '../agentTool';

const dashboardFlag = vi.hoisted(() => ({ value: true }));
vi.mock('@/server/featureFlags', async () => {
  const { mapFeatureFlagsEnvToState } = await import('@/config/featureFlags');
  return {
    getServerFeatureFlagsStateFromRuntimeConfig: async (userId?: string) =>
      mapFeatureFlagsEnvToState({ dashboard: dashboardFlag.value }, userId),
  };
});

const runSandbox = vi.fn();
vi.mock('@/server/services/widget/sandbox', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createWidgetSandboxRunner: () => ({ run: runSandbox }),
}));

const printed = (output: unknown) => ({
  durationMs: 9,
  exitCode: 0,
  stderr: 'fetched 1 page',
  stdout: JSON.stringify(output),
  timedOut: false,
});

const statDraft = {
  outputType: 'stat' as const,
  runtime: 'node' as const,
  script: `console.log(JSON.stringify({ type: 'stat', value: 7 }))`,
};

const userId = 'dashboard-tool-user';
const agentId = 'dashboard-tool-agent';
const projectId = 'dashboard-tool-project';
const projectTopicId = 'dashboard-tool-project-topic';
const plainTopicId = 'dashboard-tool-topic';

let db: LobeChatDatabase;

beforeEach(async () => {
  runSandbox.mockReset();
  db = await getTestDB();
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values([
    { id: agentId, userId },
    { id: `${projectId}-coordinator`, userId },
  ]);
  await db.insert(projects).values({
    coordinatorAgentId: `${projectId}-coordinator`,
    id: projectId,
    identifier: 'DTP',
    name: 'Dashboard tool project',
    userId,
  });
  await db.insert(topics).values([
    { agentId, id: projectTopicId, projectId, userId },
    { agentId, id: plainTopicId, userId },
  ]);
});

const teammateId = 'dashboard-tool-teammate';

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(inArray(users.id, [userId, teammateId]));
});

const scope = {
  agentId,
  messageId: 'msg_assistant_1',
  operationId: 'op_1',
  topicId: plainTopicId,
  userId,
};

describe('createDashboardToolService', () => {
  it('stamps the agent scope on the widget and the conversation on its draft', async () => {
    const service = createDashboardToolService(db, scope);
    const { version, widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: 'Always 7',
      title: 'Seven',
    });

    const [widget] = await db.select().from(widgets).where(eq(widgets.id, widgetId));
    expect(widget).toMatchObject({
      agentId,
      description: 'Always 7',
      draftVersionId: version.id,
      projectId: null,
      workspaceId: null,
    });
    const [row] = await db.select().from(widgetVersions).where(eq(widgetVersions.id, version.id));
    expect(row).toMatchObject({
      sourceAgentId: agentId,
      sourceMessageId: 'msg_assistant_1',
      sourceOperationId: 'op_1',
      sourceTopicId: plainTopicId,
      sourceType: 'agent',
      status: 'draft',
    });
  });

  it('rejects an invalid draft without leaving an empty widget behind', async () => {
    const service = createDashboardToolService(db, scope);

    await expect(
      service.createWidgetDraft({
        content: { ...statDraft, manifest: { env: [{ name: 'NOT A NAME' }] } },
        description: '',
        title: 'Broken',
      }),
    ).rejects.toThrow(/Invalid widget draft/);
    expect(await db.select().from(widgets)).toHaveLength(0);
  });

  it('refuses to publish an untried draft, then publishes and runs it once after a dry run', async () => {
    runSandbox.mockResolvedValue(printed({ type: 'stat', value: 7 }));
    const service = createDashboardToolService(db, scope);
    const { version, widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Seven',
    });

    await expect(service.publish(widgetId, version.id)).rejects.toThrow(/dry-run it/);

    const run = await service.dryRun(widgetId);
    expect(run).toMatchObject({
      output: { type: 'stat', value: 7 },
      status: 'succeeded',
      stderr: 'fetched 1 page',
      trigger: 'preview',
      versionId: version.id,
    });

    const published = await service.publish(widgetId, version.id);
    expect(published).toMatchObject({
      firstRunStatus: 'succeeded',
      version: { status: 'published' },
    });
    const [widget] = await db.select().from(widgets).where(eq(widgets.id, widgetId));
    expect(widget.publishedVersionId).toBe(version.id);
    // The first live run filled the card.
    expect(widget.latestOutput).toEqual({ type: 'stat', value: 7 });
  });

  it('saves follow-up drafts on top of the previous one', async () => {
    const service = createDashboardToolService(db, scope);
    const { version, widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Seven',
    });

    const next = await service.saveDraft(widgetId, {
      ...statDraft,
      changeNote: 'print eight',
      parentVersionId: version.id,
      script: `console.log(JSON.stringify({ type: 'stat', value: 8 }))`,
    });
    expect(next).toMatchObject({ changeNote: 'print eight', status: 'draft', version: 2 });
    expect((await service.getWidget(widgetId))?.draftVersion?.id).toBe(next.id);
  });

  it('lists home boards with their widgets and only this level’s widgets', async () => {
    const service = createDashboardToolService(db, scope);
    const { widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Mine',
    });
    // Same agent, but inside a project: a different level.
    await createDashboardToolService(db, { ...scope, projectId }).createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Project one',
    });

    const board = await service.createDashboardWithWidget('Ops', widgetId);
    expect(board).toMatchObject({ projectId: null, title: 'Ops' });
    expect(await service.addToDashboard(board.id, widgetId)).toEqual({
      projectId: null,
      title: 'Ops',
    });
    // Boards of an agent / project level are not home boards.
    await new DashboardModel(db, userId).create({ agentId, title: 'Agent board' });

    expect(await service.listDashboards()).toEqual([
      { id: board.id, projectId: null, title: 'Ops', widgets: [{ id: widgetId, title: 'Mine' }] },
    ]);
    expect((await service.listWidgets()).map((widget) => widget.title)).toEqual(['Mine']);
  });

  it('refuses widgets of another agent or project, even the same user’s', async () => {
    runSandbox.mockResolvedValue(printed({ type: 'stat', value: 7 }));
    const service = createDashboardToolService(db, scope);
    const runtime = new DashboardExecutionRuntime(service);
    const board = await service.createDashboardWithWidget(
      'Ops',
      (await service.createWidgetDraft({ content: statDraft, description: '', title: 'Mine' }))
        .widgetId,
    );

    const otherAgent = await createDashboardToolService(db, {
      ...scope,
      agentId: `${projectId}-coordinator`,
    }).createWidgetDraft({ content: statDraft, description: '', title: 'Other agent' });
    // Same agent, but authored in a project topic.
    const otherProject = await createDashboardToolService(db, {
      ...scope,
      projectId,
      topicId: projectTopicId,
    }).createWidgetDraft({ content: statDraft, description: '', title: 'Project one' });

    for (const { version, widgetId } of [otherAgent, otherProject]) {
      const results = await Promise.all([
        runtime.updateWidgetDraft({ script: 'console.log(1)', widgetId }),
        runtime.updateWidgetDraft({ title: 'Renamed', widgetId }),
        runtime.dryRunWidget({ versionId: version.id, widgetId }),
        runtime.requestPublish({ versionId: version.id, widgetId }),
        runtime.addWidgetToDashboard({ dashboardId: board.id, widgetId }),
        runtime.addWidgetToDashboard({ newDashboardTitle: 'Leaked board', widgetId }),
        runtime.getWidgetRuns({ widgetId }),
      ]);
      for (const result of results) {
        expect(result.success).toBe(false);
        expect(result.content).toMatch(/not found/i);
      }
      await expect(service.saveDraft(widgetId, statDraft)).rejects.toThrow(/not found/i);
      expect(await service.getWidget(widgetId)).toBeUndefined();

      const [row] = await db.select().from(widgets).where(eq(widgets.id, widgetId));
      expect(row).toMatchObject({ draftVersionId: version.id, publishedVersionId: null });
      expect(row.title).not.toBe('Renamed');
    }
    expect(runSandbox).not.toHaveBeenCalled();
    // Refusing a new-board placement creates no board either.
    expect((await new DashboardModel(db, userId).list({})).map(({ title }) => title)).toEqual([
      'Ops',
    ]);
    expect((await service.listDashboards())[0].widgets.map(({ title }) => title)).toEqual(['Mine']);
  });

  it('loads the widgets of every listed board in one batch', async () => {
    const service = createDashboardToolService(db, {
      ...scope,
      projectId,
      topicId: projectTopicId,
    });
    const create = (title: string) =>
      service.createWidgetDraft({ content: statDraft, description: '', title });
    const [a, b, c] = [await create('A'), await create('B'), await create('C')];
    const projectBoard = await service.createDashboardWithWidget('Project', a.widgetId);
    await service.addToDashboard(projectBoard.id, b.widgetId);
    const home = await new DashboardModel(db, userId).create({ title: 'Home' });
    const empty = await new DashboardModel(db, userId).create({ title: 'Empty' });
    const homeWidget = await createDashboardToolService(db, scope).createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Home widget',
    });
    await new DashboardModel(db, userId).addItem(home.id, homeWidget.widgetId);
    await new DashboardModel(db, userId).addItem(home.id, c.widgetId);

    const perBoard = vi.spyOn(DashboardModel.prototype, 'listItems');
    const batch = vi.spyOn(DashboardModel.prototype, 'listItemsForDashboards');

    expect(await service.listDashboards()).toEqual([
      {
        id: projectBoard.id,
        projectId,
        title: 'Project',
        widgets: [
          { id: a.widgetId, title: 'A' },
          { id: b.widgetId, title: 'B' },
        ],
      },
      {
        id: home.id,
        projectId: null,
        title: 'Home',
        widgets: [
          { id: homeWidget.widgetId, title: 'Home widget' },
          { id: c.widgetId, title: 'C' },
        ],
      },
      { id: empty.id, projectId: null, title: 'Empty', widgets: [] },
    ]);
    expect(perBoard).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('refuses placement on boards outside the conversation’s project or level', async () => {
    const service = createDashboardToolService(db, {
      ...scope,
      projectId,
      topicId: projectTopicId,
    });
    const { widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Project metric',
    });

    // Another project's board: readable and creator-owned, but this
    // conversation was never offered it.
    const otherProjectId = 'dashboard-tool-other-project';
    await db.insert(agents).values({ id: `${otherProjectId}-coordinator`, userId });
    await db.insert(projects).values({
      coordinatorAgentId: `${otherProjectId}-coordinator`,
      id: otherProjectId,
      identifier: 'DTO',
      name: 'Other project',
      userId,
    });
    const otherBoard = await new DashboardModel(db, userId).create({
      projectId: otherProjectId,
      title: 'Other project board',
    });
    // An agent-level board is not a home board either.
    const agentBoard = await new DashboardModel(db, userId).create({
      agentId,
      title: 'Agent board',
    });

    await expect(service.addToDashboard(otherBoard.id, widgetId)).rejects.toThrow(/not found/i);
    await expect(service.addToDashboard(agentBoard.id, widgetId)).rejects.toThrow(/not found/i);
    expect(await new DashboardModel(db, userId).listItems(otherBoard.id)).toEqual([]);
    expect(await new DashboardModel(db, userId).listItems(agentBoard.id)).toEqual([]);

    // Its own project's board and home boards still take the placement.
    const ownBoard = await service.createDashboardWithWidget('Own project board', widgetId);
    const homeBoard = await new DashboardModel(db, userId).create({ title: 'Home board' });
    await expect(service.addToDashboard(ownBoard.id, widgetId)).resolves.toEqual({
      projectId,
      title: 'Own project board',
    });
    await expect(service.addToDashboard(homeBoard.id, widgetId)).resolves.toEqual({
      projectId: null,
      title: 'Home board',
    });

    // A home conversation is the mirror image: project boards are out of reach.
    const homeService = createDashboardToolService(db, scope);
    const homeWidget = await homeService.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Home metric',
    });
    await expect(homeService.addToDashboard(ownBoard.id, homeWidget.widgetId)).rejects.toThrow(
      /not found/i,
    );
    expect(await new DashboardModel(db, userId).listItems(ownBoard.id)).toHaveLength(1);
  });

  it('creates no board when the widget cannot be placed on it', async () => {
    const service = createDashboardToolService(db, scope);
    const runtime = new DashboardExecutionRuntime(service);

    const result = await runtime.addWidgetToDashboard({
      newDashboardTitle: 'Ops',
      widgetId: '00000000-0000-4000-8000-000000000000',
    });

    expect(result.success).toBe(false);
    expect(await new DashboardModel(db, userId).list({})).toEqual([]);
  });

  it('creates boards on the project in a project topic and lists them before home boards', async () => {
    const home = await new DashboardModel(db, userId).create({ title: 'Home' });
    const service = createDashboardToolService(db, {
      ...scope,
      projectId,
      topicId: projectTopicId,
    });
    const { widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Project metric',
    });

    const board = await service.createDashboardWithWidget('Project board', widgetId);
    expect(board).toMatchObject({ projectId, title: 'Project board' });
    // A board another agent of the project owns is still the project's.
    const agentBoard = await new DashboardModel(db, userId).create({
      agentId,
      projectId,
      title: 'Agent board in project',
    });

    expect(await new DashboardModel(db, userId).findById(board.id)).toMatchObject({
      agentId: null,
      projectId,
    });
    expect(
      (await service.listDashboards()).map(({ id, projectId: level }) => ({ id, level })),
    ).toEqual([
      { id: board.id, level: projectId },
      { id: agentBoard.id, level: projectId },
      { id: home.id, level: null },
    ]);
  });
});

describe('dashboardRuntime', () => {
  it('attaches widgets built in a project conversation to that project', async () => {
    const runtime = await dashboardRuntime.factory({
      agentId,
      serverDB: db,
      toolManifestMap: {},
      topicId: projectTopicId,
      userId,
    });

    const result = await runtime.createWidgetDraft({
      ...statDraft,
      description: 'Project metric',
      title: 'In project',
    });

    expect(result.success).toBe(true);
    const [widget] = await db.select().from(widgets).where(eq(widgets.id, result.state.widgetId));
    expect(widget).toMatchObject({ agentId, projectId });
  });

  it('refuses to run the tool in-process while the `dashboard` flag is off', async () => {
    dashboardFlag.value = false;
    try {
      await expect(
        dashboardRuntime.factory({ serverDB: db, toolManifestMap: {}, userId }),
      ).rejects.toThrow('Dashboards are not enabled');
    } finally {
      dashboardFlag.value = true;
    }
  });
});

describe('resolveClientTopic', () => {
  it('resolves only the caller’s own topics, with their project', async () => {
    expect(await resolveClientTopic(db, projectTopicId, userId)).toEqual({
      projectId,
      topicId: projectTopicId,
    });
    expect(await resolveClientTopic(db, plainTopicId, userId)).toEqual({
      projectId: undefined,
      topicId: plainTopicId,
    });
    expect(await resolveClientTopic(db, projectTopicId, 'someone-else')).toEqual({});
    expect(await resolveClientTopic(db, undefined, userId)).toEqual({});
  });
});

describe('resolveClientTopic in a workspace', () => {
  const workspaceId = 'dashboard-tool-workspace';
  const wsAgentId = 'dashboard-tool-ws-agent';
  const wsProjectId = 'dashboard-tool-ws-project';
  const teammateTopicId = 'dashboard-tool-teammate-topic';

  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, teammateId));
    await db.insert(users).values({ id: teammateId });
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: teammateId, slug: workspaceId });
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: teammateId, workspaceId },
      { role: 'member', userId, workspaceId },
    ]);
    await db.insert(agents).values([
      { id: wsAgentId, userId, workspaceId },
      { id: `${wsProjectId}-coordinator`, userId: teammateId, workspaceId },
    ]);
    await db.insert(projects).values({
      coordinatorAgentId: `${wsProjectId}-coordinator`,
      id: wsProjectId,
      identifier: 'WSP',
      name: 'Team project',
      userId: teammateId,
      workspaceId,
    });
    // The teammate started the project topic; the member keeps working in it.
    await db
      .insert(topics)
      .values({ id: teammateTopicId, projectId: wsProjectId, userId: teammateId, workspaceId });
  });

  it('builds under the project of a teammate’s workspace topic', async () => {
    const topic = await resolveClientTopic(db, teammateTopicId, userId, workspaceId);
    expect(topic).toEqual({ projectId: wsProjectId, topicId: teammateTopicId });

    const service = createDashboardToolService(db, {
      ...scope,
      agentId: wsAgentId,
      ...topic,
      workspaceId,
    });
    const { widgetId } = await service.createWidgetDraft({
      content: statDraft,
      description: '',
      title: 'Team metric',
    });
    const board = await service.createDashboardWithWidget('Team board', widgetId);

    const [widget] = await db.select().from(widgets).where(eq(widgets.id, widgetId));
    expect(widget).toMatchObject({ projectId: wsProjectId, userId, workspaceId });
    expect(board).toMatchObject({ projectId: wsProjectId, title: 'Team board' });
  });

  it('does not reach a workspace topic from personal mode', async () => {
    expect(await resolveClientTopic(db, teammateTopicId, userId)).toEqual({});
    expect(await resolveClientTopic(db, teammateTopicId, teammateId)).toEqual({});
  });
});
