// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  dashboardWidgets,
  dashboardWidgetVersions,
  projects,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardModel } from '@/database/models/dashboard';
import { dashboardRuntime } from '@/server/services/toolExecution/serverRuntimes/dashboard';

import { createDashboardToolService, resolveClientTopic } from '../agentTool';
import { DashboardSandboxRunner } from '../sandboxRunner';

const runSandbox = vi.fn();
vi.spyOn(DashboardSandboxRunner, 'fromEnv').mockReturnValue({
  run: runSandbox,
} as unknown as DashboardSandboxRunner);

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

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
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

    const [widget] = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.id, widgetId));
    expect(widget).toMatchObject({
      agentId,
      description: 'Always 7',
      draftVersionId: version.id,
      projectId: null,
      workspaceId: null,
    });
    const [row] = await db
      .select()
      .from(dashboardWidgetVersions)
      .where(eq(dashboardWidgetVersions.id, version.id));
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
    expect(await db.select().from(dashboardWidgets)).toHaveLength(0);
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
    const [widget] = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.id, widgetId));
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

    const board = await service.createDashboard('Ops');
    expect(await service.addToDashboard(board.id, widgetId)).toEqual({ title: 'Ops' });
    // Boards of an agent / project level are not home boards.
    await new DashboardModel(db, userId).create({ agentId, title: 'Agent board' });

    expect(await service.listDashboards()).toEqual([
      { id: board.id, title: 'Ops', widgets: [{ id: widgetId, title: 'Mine' }] },
    ]);
    expect((await service.listWidgets()).map((widget) => widget.title)).toEqual(['Mine']);
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
    const [widget] = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.id, result.state.widgetId));
    expect(widget).toMatchObject({ agentId, projectId });
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
