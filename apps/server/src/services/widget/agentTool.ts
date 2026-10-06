import type {
  WidgetRunRecord,
  WidgetVersionContent,
  WidgetVersionRecord,
} from '@lobechat/builtin-tool-dashboard';
import type { DashboardToolService } from '@lobechat/builtin-tool-dashboard/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import { eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { DashboardModel } from '@/database/models/dashboard';
import { TopicModel } from '@/database/models/topic';
import { WidgetModel } from '@/database/models/widget';
import type { WidgetRunRow, WidgetVersionRow } from '@/database/schemas';
import { topics } from '@/database/schemas';

import { WidgetFlowError, WidgetService } from './index';
import { widgetVersionContentSchema } from './versionSchema';

/** Where the conversation that authors the widget lives; stamped on what it creates. */
export interface DashboardToolScope {
  agentId?: string;
  /** Assistant message carrying the tool call — recorded as the version's source. */
  messageId?: string;
  operationId?: string;
  projectId?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

const toVersionRecord = (row: WidgetVersionRow): WidgetVersionRecord => ({
  changeNote: row.changeNote,
  id: row.id,
  manifest: row.manifest,
  outputType: row.outputType,
  runtime: row.runtime,
  script: row.script,
  status: row.status,
  version: row.version,
  view: row.view,
});

const toRunRecord = (row: WidgetRunRow): WidgetRunRecord => ({
  durationMs: row.durationMs,
  error: row.error,
  exitCode: row.exitCode,
  finishedAt: row.finishedAt,
  id: row.id,
  output: row.output,
  startedAt: row.startedAt,
  status: row.status,
  stderr: row.stderr,
  stdout: row.stdout,
  trigger: row.trigger,
  versionId: row.versionId,
});

/** Same validation as the `dashboard.saveDraft` procedure, with a readable message. */
const parseContent = (content: WidgetVersionContent & { changeNote?: string | null }) => {
  const result = widgetVersionContentSchema.safeParse(content);
  if (!result.success) throw new Error(`Invalid widget draft: ${z.prettifyError(result.error)}`);
  return result.data;
};

/**
 * The dashboard tool's data access for one conversation. Widgets it creates
 * belong to the conversation's agent (and project, in a project topic) inside
 * the run's workspace; drafts record the agent, topic, message and operation
 * that wrote them. Boards it creates belong to the conversation's project in a
 * project topic, else to the home level (personal / workspace).
 */
export const createDashboardToolService = (
  db: LobeChatDatabase,
  scope: DashboardToolScope,
): DashboardToolService => {
  const { agentId, projectId, userId, workspaceId } = scope;
  const dashboards = new DashboardModel(db, userId, workspaceId);
  const widgets = new WidgetModel(db, userId, workspaceId);
  const flow = new WidgetService(db, userId, workspaceId);

  /**
   * A widget this conversation may work on: readable, and living on the exact
   * level new widgets are created on (same agent and project). A stale or
   * model-supplied id of another agent's or project's widget is out of reach,
   * even when the same user owns it.
   */
  const findScopedWidget = async (widgetId: string) => {
    const widget = await widgets.findById(widgetId);
    if (!widget) return undefined;
    const inScope =
      widget.agentId === (agentId ?? null) && widget.projectId === (projectId ?? null);
    return inScope ? widget : undefined;
  };

  const requireScopedWidget = async (widgetId: string) => {
    const widget = await findScopedWidget(widgetId);
    if (!widget) {
      throw new WidgetFlowError(
        'NOT_FOUND',
        'Widget not found in this conversation’s agent and project',
      );
    }
    return widget;
  };

  const source = {
    sourceAgentId: agentId ?? null,
    sourceMessageId: scope.messageId ?? null,
    sourceOperationId: scope.operationId ?? null,
    sourceTopicId: scope.topicId ?? null,
    sourceType: 'agent' as const,
  };

  return {
    addToDashboard: async (dashboardId, widgetId) => {
      await requireScopedWidget(widgetId);
      const board = await dashboards.findById(dashboardId);
      const item = board ? await dashboards.addItem(dashboardId, widgetId) : undefined;
      if (!board || !item) throw new Error('Dashboard or widget not found');
      return { projectId: board.projectId, title: board.title };
    },

    createDashboardWithWidget: async (title, widgetId) =>
      // One transaction: a widget that cannot be placed (stale, deleted,
      // unreadable, another workspace) rolls the new board back with it.
      db.transaction(async (tx) => {
        const scoped = new DashboardModel(tx as unknown as LobeChatDatabase, userId, workspaceId);
        const board = await scoped.create({ projectId: projectId ?? null, title });
        const item = await scoped.addItem(board.id, widgetId);
        if (!item) throw new Error('Widget not found');
        return { id: board.id, projectId: board.projectId, title: board.title };
      }),

    createWidgetDraft: async ({ content, description, title }) => {
      const version = parseContent(content);
      const widget = await widgets.create({
        agentId: agentId ?? null,
        description,
        projectId: projectId ?? null,
        title,
      });
      try {
        const draft = await flow.saveDraft(widget.id, { ...version, ...source });
        return { version: toVersionRecord(draft), widgetId: widget.id };
      } catch (error) {
        // Never leave an empty widget behind a failed first draft.
        await widgets.delete(widget.id);
        throw error;
      }
    },

    dryRun: async (widgetId, versionId) => {
      await requireScopedWidget(widgetId);
      const run = await flow.dryRun(widgetId, { operationId: scope.operationId, versionId });
      if (!run) throw new Error('Widget not found');
      return toRunRecord(run);
    },

    getRun: async (widgetId, runId) => {
      await requireScopedWidget(widgetId);
      const run = await widgets.findRun(widgetId, runId);
      return run ? toRunRecord(run) : undefined;
    },

    getWidget: async (widgetId) => {
      const widget = await findScopedWidget(widgetId);
      if (!widget) return undefined;
      const [publishedVersion, draftVersion] = await Promise.all([
        widget.publishedVersionId ? widgets.findVersion(widgetId, widget.publishedVersionId) : null,
        widget.draftVersionId ? widgets.findVersion(widgetId, widget.draftVersionId) : null,
      ]);
      return {
        description: widget.description,
        draftVersion: draftVersion ? toVersionRecord(draftVersion) : null,
        id: widget.id,
        publishedVersion: publishedVersion ? toVersionRecord(publishedVersion) : null,
        schedulePattern: widget.schedulePattern,
        scheduleTimezone: widget.scheduleTimezone,
        title: widget.title,
      };
    },

    listDashboards: async () => {
      const [projectBoards, homeBoards] = await Promise.all([
        projectId ? dashboards.listByProject(projectId) : [],
        dashboards.list({}),
      ]);
      return pMap(
        [...projectBoards, ...homeBoards],
        async (board) => ({
          id: board.id,
          projectId: board.projectId,
          title: board.title,
          widgets: (await dashboards.listItems(board.id)).map(({ widget }) => ({
            id: widget.id,
            title: widget.title,
          })),
        }),
        { concurrency: 5 },
      );
    },

    listRuns: async (widgetId, limit) => {
      await requireScopedWidget(widgetId);
      return (await widgets.listRuns(widgetId, { limit })).map(toRunRecord);
    },

    listWidgets: async () => {
      const rows = await widgets.list({ agentId, projectId });
      return rows.map((widget) => ({
        draftVersionId: widget.draftVersionId,
        hasDraft: !!widget.draftVersionId,
        id: widget.id,
        lastRunStatus: widget.lastRunStatus,
        published: !!widget.publishedVersionId,
        title: widget.title,
      }));
    },

    publish: async (widgetId, versionId) => {
      await requireScopedWidget(widgetId);
      const { version, widget } = await flow.publish(widgetId, versionId);
      // Fill the live card right away instead of waiting for the first tick.
      const firstRun = await flow.runNow(widgetId).catch((error) => {
        console.error('[dashboard-tool] first run after publish failed widget=%s', widgetId, error);
        return undefined;
      });
      return {
        firstRunStatus: firstRun?.status,
        schedulePattern: widget?.schedulePattern,
        version: toVersionRecord(version),
      };
    },

    saveDraft: async (widgetId, input) => {
      const { parentVersionId, ...content } = input;
      const version = parseContent(content);
      await requireScopedWidget(widgetId);
      const draft = await flow.saveDraft(widgetId, {
        ...version,
        ...source,
        parentVersionId: parentVersionId ?? null,
      });
      return toVersionRecord(draft);
    },

    updateWidget: async (widgetId, patch) => {
      await requireScopedWidget(widgetId);
      const updated = await widgets.update(widgetId, {
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.title !== undefined && { title: patch.title }),
      });
      if (!updated) throw new Error('Widget not found or not editable');
    },
  };
};

/** The project of a topic the run already authorized, when it lives in one. */
export const resolveTopicProjectId = async (db: LobeChatDatabase, topicId?: string) => {
  if (!topicId) return undefined;
  const [row] = await db
    .select({ projectId: topics.projectId })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  return row?.projectId ?? undefined;
};

/**
 * A topic id sent by a client, kept only when the caller can read the topic in
 * the current scope — then its project scopes what the tool creates. In a
 * workspace that includes teammates' topics (a member working in a teammate's
 * project topic); in personal mode only the caller's own.
 */
export const resolveClientTopic = async (
  db: LobeChatDatabase,
  topicId: string | null | undefined,
  userId: string,
  workspaceId?: string,
): Promise<{ projectId?: string; topicId?: string }> => {
  if (!topicId) return {};
  const topic = await new TopicModel(db, userId, workspaceId).findById(topicId);
  return topic ? { projectId: topic.projectId ?? undefined, topicId } : {};
};
