import type { WidgetOutput } from '@lobechat/types';

import type { WidgetRow, WidgetRunRow, WidgetVersionRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { widgetRouter } from '@/server/routers/lambda/widget';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateWidgetRequest,
  DryRunWidgetRequest,
  PublishWidgetRequest,
  SaveWidgetDraftRequest,
  UpdateWidgetRequest,
  UpdateWidgetScheduleRequest,
  WidgetDetailResponse,
  WidgetListQuery,
  WidgetResponse,
  WidgetRunListQuery,
  WidgetRunResponse,
  WidgetVersionResponse,
} from '../types/widget.type';

const toIso = (value: Date | string): string => new Date(value).toISOString();
const toIsoOrNull = (value: Date | string | null | undefined) => (value ? toIso(value) : null);

/** Stored outputs were checked against the contract when written; the type only narrows it. */
const toOutput = (output: WidgetOutput | null | undefined) =>
  (output ?? null) as WidgetResponse['latestOutput'];

export const toWidget = (row: WidgetRow): WidgetResponse => ({
  agentId: row.agentId ?? null,
  consecutiveFailures: row.consecutiveFailures,
  createdAt: toIso(row.createdAt),
  description: row.description ?? null,
  draftVersionId: row.draftVersionId ?? null,
  id: row.id,
  lastRunAt: toIsoOrNull(row.lastRunAt),
  lastRunError: row.lastRunError ?? null,
  lastRunStatus: row.lastRunStatus ?? null,
  latestOutput: toOutput(row.latestOutput),
  latestOutputAt: toIsoOrNull(row.latestOutputAt),
  metadata: row.metadata ?? null,
  nextRunAt: toIsoOrNull(row.nextRunAt),
  projectId: row.projectId ?? null,
  publishedVersionId: row.publishedVersionId ?? null,
  schedulePattern: row.schedulePattern ?? null,
  scheduleTimezone: row.scheduleTimezone ?? null,
  title: row.title,
  updatedAt: toIso(row.updatedAt),
  userId: row.userId,
  visibility: row.visibility,
  workspaceId: row.workspaceId ?? null,
});

export const toWidgetVersion = (row: WidgetVersionRow): WidgetVersionResponse => ({
  changeNote: row.changeNote ?? null,
  contentHash: row.contentHash,
  createdAt: toIso(row.createdAt),
  id: row.id,
  manifest: (row.manifest ?? null) as WidgetVersionResponse['manifest'],
  outputType: row.outputType,
  parentVersionId: row.parentVersionId ?? null,
  publishedAt: toIsoOrNull(row.publishedAt),
  runtime: row.runtime,
  script: row.script,
  sourceAgentId: row.sourceAgentId ?? null,
  sourceTopicId: row.sourceTopicId ?? null,
  sourceType: row.sourceType,
  status: row.status,
  updatedAt: toIso(row.updatedAt),
  version: row.version,
  view: (row.view ?? null) as WidgetVersionResponse['view'],
  widgetId: row.widgetId,
});

export const toWidgetRun = (row: WidgetRunRow): WidgetRunResponse => ({
  createdAt: toIso(row.createdAt),
  durationMs: row.durationMs ?? null,
  error: row.error ?? null,
  exitCode: row.exitCode ?? null,
  finishedAt: toIsoOrNull(row.finishedAt),
  id: row.id,
  output: toOutput(row.output),
  startedAt: toIso(row.startedAt),
  status: row.status,
  stderr: row.stderr ?? null,
  stdout: row.stdout ?? null,
  trigger: row.trigger,
  versionId: row.versionId,
  widgetId: row.widgetId,
});

/**
 * Widgets REST service.
 *
 * Every call goes through the `widget` tRPC procedures, called server-side, so
 * REST shares their gates: the `dashboard` feature flag, the workspace member
 * role on writes, creator-only edits, the dry-run-before-publish rule and the
 * sandbox runner with its credential injection. Missing and invisible widgets
 * both read as 404.
 *
 * The explicit `confirm` / `versionId` of a dry run or publish is checked by
 * the request schema; `versionId` is then passed through, so the call always
 * executes exactly the version the caller reviewed — never whatever draft
 * happens to be current.
 */
export class WidgetRestService extends BaseService {
  private readonly caller: ReturnType<typeof widgetRouter.createCaller>;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.caller = widgetRouter.createCaller({ userId: this.userId, workspaceId });
  }

  async listWidgets(query: WidgetListQuery) {
    const { limit, offset } = resolvePagination(query);
    const result = await this.caller.list({
      agentId: query.agentId ?? null,
      projectId: query.projectId ?? null,
    });
    const rows = result!.data;
    return { items: rows.slice(offset, offset + limit).map(toWidget), total: rows.length };
  }

  async createWidget(input: CreateWidgetRequest): Promise<WidgetResponse> {
    const result = await this.caller.create(input);
    return toWidget(result!.data);
  }

  async getWidget(id: string): Promise<WidgetDetailResponse> {
    const { dashboards, draftVersion, publishedVersion, ...widget } = (await this.caller.detail({
      id,
    }))!.data;
    return {
      ...toWidget(widget),
      dashboards: dashboards.map((board) => ({
        id: board.id,
        projectId: board.projectId ?? null,
        title: board.title,
      })),
      draftVersion: draftVersion ? toWidgetVersion(draftVersion) : null,
      publishedVersion: publishedVersion ? toWidgetVersion(publishedVersion) : null,
    };
  }

  async updateWidget(id: string, value: UpdateWidgetRequest): Promise<WidgetResponse> {
    return toWidget((await this.caller.update({ id, value }))!.data);
  }

  /** Moves the widget to the trash, as deleting it in the app does; it stays restorable there. */
  async deleteWidget(id: string): Promise<DeletedResource> {
    await this.caller.trash({ id });
    return { deleted: true, id };
  }

  async saveDraft(widgetId: string, input: SaveWidgetDraftRequest): Promise<WidgetVersionResponse> {
    // The shared content schema re-checks the full card layout tree here.
    const result = await this.caller.saveDraft({
      ...(input as Parameters<typeof this.caller.saveDraft>[0]),
      widgetId,
    });
    return toWidgetVersion(result!.data);
  }

  async listVersions(widgetId: string) {
    return { items: (await this.caller.listVersions({ widgetId }))!.data.map(toWidgetVersion) };
  }

  async getVersion(widgetId: string, versionId: string) {
    return toWidgetVersion((await this.caller.getVersion({ versionId, widgetId }))!.data);
  }

  async dryRun(widgetId: string, input: DryRunWidgetRequest): Promise<WidgetRunResponse> {
    const run = (await this.caller.dryRun({ versionId: input.versionId, widgetId }))!.data;
    if (!run) throw this.createNotFoundError('Widget not found');
    return toWidgetRun(run);
  }

  async publish(widgetId: string, input: PublishWidgetRequest) {
    const { version, widget } = (await this.caller.publish({
      versionId: input.versionId,
      widgetId,
    }))!.data;
    return { version: toWidgetVersion(version), widget: toWidget(widget) };
  }

  async run(widgetId: string): Promise<WidgetRunResponse> {
    const run = (await this.caller.run({ widgetId }))!.data;
    if (!run) throw this.createNotFoundError('Widget not found');
    return toWidgetRun(run);
  }

  async listRuns(widgetId: string, query: WidgetRunListQuery) {
    const result = await this.caller.listRuns({ limit: query.limit, widgetId });
    return { items: result!.data.map(toWidgetRun) };
  }

  async getRun(widgetId: string, runId: string) {
    return toWidgetRun((await this.caller.getRun({ runId, widgetId }))!.data);
  }

  async updateSchedule(id: string, input: UpdateWidgetScheduleRequest): Promise<WidgetResponse> {
    const result = await this.caller.setSchedule({
      id,
      pattern: input.pattern,
      timezone: input.timezone,
    });
    return toWidget(result!.data);
  }
}
