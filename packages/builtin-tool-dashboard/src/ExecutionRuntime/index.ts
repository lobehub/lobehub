import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  AddWidgetToDashboardParams,
  AddWidgetToDashboardState,
  CreateWidgetDraftParams,
  DashboardSummary,
  DashboardWidgetRecord,
  DashboardWidgetSummary,
  DryRunWidgetParams,
  DryRunWidgetState,
  GetWidgetRunsParams,
  GetWidgetRunsState,
  ListDashboardsState,
  RequestPublishParams,
  RequestPublishState,
  UpdateWidgetDraftParams,
  WidgetDraftState,
  WidgetRunRecord,
  WidgetVersionContent,
  WidgetVersionRecord,
} from '../types';

/**
 * Data access the dashboard tool needs, bound by the host to the caller and to
 * the conversation's ownership scope (agent / project / workspace). Methods
 * throw on refused requests; the runtime turns the message into tool content.
 */
export interface DashboardToolService {
  addToDashboard: (
    dashboardId: string,
    widgetId: string,
  ) => Promise<{ projectId?: string | null; title: string }>;
  /**
   * Create a board and place the widget on it atomically: when the widget
   * cannot be placed nothing is created. The board lives on the
   * conversation's project in a project topic, else on the home level.
   */
  createDashboardWithWidget: (
    title: string,
    widgetId: string,
  ) => Promise<{ id: string; projectId?: string | null; title: string }>;
  /** Validate the content, create the widget and record its first draft. */
  createWidgetDraft: (input: {
    content: WidgetVersionContent;
    description: string;
    title: string;
  }) => Promise<{ version: WidgetVersionRecord; widgetId: string }>;
  dryRun: (widgetId: string, versionId: string) => Promise<WidgetRunRecord>;
  getRun: (widgetId: string, runId: string) => Promise<WidgetRunRecord | undefined>;
  getWidget: (widgetId: string) => Promise<DashboardWidgetRecord | undefined>;
  /** The project's boards first (in a project topic), then the home boards. */
  listDashboards: () => Promise<DashboardSummary[]>;
  listRuns: (widgetId: string, limit: number) => Promise<WidgetRunRecord[]>;
  /** Widgets owned at the conversation's level (this agent, in this project). */
  listWidgets: () => Promise<DashboardWidgetSummary[]>;
  publish: (
    widgetId: string,
    versionId: string,
  ) => Promise<{
    /** Status of the refresh run right after publishing, when one was attempted. */
    firstRunStatus?: WidgetRunRecord['status'];
    schedulePattern?: string | null;
    version: WidgetVersionRecord;
  }>;
  saveDraft: (
    widgetId: string,
    input: WidgetVersionContent & { changeNote?: string | null; parentVersionId?: string | null },
  ) => Promise<WidgetVersionRecord>;
  updateWidget: (
    widgetId: string,
    patch: { description?: string; title?: string },
  ) => Promise<void>;
}

/** How much of each log stream a tool result quotes. */
export const LOG_EXCERPT_CHARS = 2000;
/** How much of the output JSON a tool result quotes. */
export const OUTPUT_EXCERPT_CHARS = 3000;

const DEFAULT_RUN_LIMIT = 10;
const MAX_RUN_LIMIT = 50;

/** Keep the tail of a log (where errors are) and say how much was cut. */
export const tailExcerpt = (text: string | null | undefined, max = LOG_EXCERPT_CHARS) => {
  if (!text) return '';
  const trimmed = text.trimEnd();
  if (trimmed.length <= max) return trimmed;
  return `…(${trimmed.length - max} earlier chars omitted)\n${trimmed.slice(-max)}`;
};

const headExcerpt = (text: string, max = OUTPUT_EXCERPT_CHARS) =>
  text.length <= max ? text : `${text.slice(0, max)}\n…(${text.length - max} more chars)`;

/** What the model should do about each run error code. */
const ERROR_HINTS: Record<string, string> = {
  CREDENTIALS_ERROR:
    'The platform could not read the connected credentials. Retry later; if it persists ask the user to reconnect the connector.',
  EMPTY_OUTPUT: 'Print exactly one JSON document to stdout (logs belong on stderr).',
  INVALID_JSON:
    'stdout must contain only the JSON document — move every other print/echo to stderr.',
  INVALID_OUTPUT:
    'The JSON does not match the output contract for this outputType; compare field names and types with the contract.',
  MISSING_ENV:
    "A required variable has no source. If the message lists a connector's headers, set manifest.env[].field to the right one with updateWidgetDraft; otherwise tell the user which connector to connect for this agent or workspace — never ask for the secret in chat.",
  NON_ZERO_EXIT: 'The script failed; read stderr, fix the script and dry-run again.',
  OUTPUT_TOO_LARGE: 'Trim the output: fewer rows / items / points (use view.limit for display).',
  OUTPUT_TYPE_MISMATCH: 'The printed "type" differs from the widget outputType; align them.',
  PARTIAL_OUTPUT:
    'The script reported an incomplete result (meta.complete=false). Fine if intended; otherwise fix the failing source.',
  SANDBOX_BAD_REQUEST:
    'The sandbox rejected the request; check runtime and manifest.timeoutMs (max 120000).',
  SANDBOX_ERROR: 'The sandbox itself failed, not the script. Retry the dry run once.',
  SANDBOX_NOT_CONFIGURED:
    'Script execution is not configured on this server. Tell the user; do not retry.',
  SANDBOX_UNAUTHORIZED:
    'The sandbox rejected the platform credentials. Tell the user; do not retry.',
  TIMEOUT: 'The script exceeded its time limit; make it do less or raise manifest.timeoutMs.',
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? 'Unknown error');

const fail = (error: unknown, action: string): BuiltinServerRuntimeOutput => {
  const message = errorMessage(error);
  return { content: `Failed to ${action}: ${message}`, error: { message }, success: false };
};

const formatRunHead = (run: WidgetRunRecord, version?: number) =>
  [
    `run ${run.id}`,
    version !== undefined && `v${version}`,
    run.trigger,
    run.status,
    typeof run.durationMs === 'number' && `${run.durationMs}ms`,
    run.startedAt && new Date(run.startedAt).toISOString(),
  ]
    .filter(Boolean)
    .join(' · ');

/** The full, model-facing account of one run: output or error, and both log tails. */
export const formatRunDetail = (run: WidgetRunRecord) => {
  const lines: string[] = [];
  if (run.error) {
    lines.push(`error: [${run.error.code}] ${run.error.message}`);
    const hint = ERROR_HINTS[run.error.code];
    if (hint) lines.push(`hint: ${hint}`);
  }
  if (typeof run.exitCode === 'number') lines.push(`exit code: ${run.exitCode}`);
  if (run.output) {
    lines.push(`output (${run.output.type}):`, headExcerpt(JSON.stringify(run.output, null, 2)));
  }
  // A good output already says what stdout held; quote stdout only when it did not parse.
  if (!run.output) {
    const stdout = tailExcerpt(run.stdout);
    lines.push(stdout ? `stdout:\n${stdout}` : 'stdout: (empty)');
  }
  const stderr = tailExcerpt(run.stderr);
  if (stderr) lines.push(`stderr:\n${stderr}`);
  return lines.join('\n');
};

const versionLabel = (version: Pick<WidgetVersionRecord, 'status' | 'version'>) =>
  `v${version.version} (${version.status})`;

export class DashboardExecutionRuntime {
  constructor(private readonly service: DashboardToolService) {}

  async listDashboards(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const [dashboards, widgets] = await Promise.all([
        this.service.listDashboards(),
        this.service.listWidgets(),
      ]);
      const state: ListDashboardsState = { dashboards, widgets };

      const boardLines = dashboards.length
        ? dashboards.map((board) => {
            const placed = board.widgets.map((w) => `"${w.title}" (${w.id})`).join(', ');
            const level = board.projectId ? ' [project]' : '';
            return `- "${board.title}" (${board.id})${level}: ${placed || 'no widgets'}`;
          })
        : ['- none yet (addWidgetToDashboard with newDashboardTitle creates one)'];
      const widgetLines = widgets.length
        ? widgets.map((widget) => {
            const status = [
              widget.published ? 'published' : 'not published',
              widget.hasDraft &&
                (widget.draftVersionId ? `draft version id ${widget.draftVersionId}` : 'has draft'),
              widget.lastRunStatus && `last run ${widget.lastRunStatus}`,
            ]
              .filter(Boolean)
              .join(', ');
            return `- "${widget.title}" (${widget.id}): ${status}`;
          })
        : ['- none yet'];

      return {
        content: [
          `Dashboards (${dashboards.length}):`,
          ...boardLines,
          '',
          `Widgets owned by this agent (${widgets.length}):`,
          ...widgetLines,
        ].join('\n'),
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'list dashboards');
    }
  }

  async createWidgetDraft(params: CreateWidgetDraftParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { description, title, ...content } = params;
      const { version, widgetId } = await this.service.createWidgetDraft({
        content,
        description,
        title,
      });
      const state: WidgetDraftState = { version: version.version, versionId: version.id, widgetId };

      return {
        content: `Created widget "${title}" (${widgetId}) with draft ${versionLabel(version)}, version id ${version.id}. Nothing runs yet — call dryRunWidget to execute it.`,
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'create widget');
    }
  }

  async updateWidgetDraft(params: UpdateWidgetDraftParams): Promise<BuiltinServerRuntimeOutput> {
    const { widgetId, title, description, changeNote, ...patch } = params;
    try {
      const widget = await this.service.getWidget(widgetId);
      if (!widget) return fail(new Error('Widget not found'), 'update widget draft');

      // Title / description are written only after everything else in the
      // call succeeded, so a refused draft leaves the widget untouched and a
      // retry starts from the same state.
      const hasMetaPatch = title !== undefined || description !== undefined;
      const writeMeta = () =>
        hasMetaPatch
          ? this.service.updateWidget(widgetId, { description, title })
          : Promise.resolve();

      const base = widget.draftVersion ?? widget.publishedVersion;
      const hasContentPatch = Object.values(patch).some((value) => value !== undefined);
      if (!hasContentPatch) {
        if (!base) return fail(new Error('Widget has no version to keep'), 'update widget draft');
        await writeMeta();
        const state: WidgetDraftState = { version: base.version, versionId: base.id, widgetId };
        return {
          content: `Updated widget ${widgetId}'s title/description. Script unchanged (current ${versionLabel(base)}).`,
          state,
          success: true,
        };
      }

      const merged: WidgetVersionContent = {
        manifest: patch.manifest !== undefined ? patch.manifest : base?.manifest,
        outputType: patch.outputType ?? base?.outputType ?? 'stat',
        runtime: patch.runtime ?? base?.runtime ?? 'node',
        script: patch.script ?? base?.script ?? '',
        view: patch.view !== undefined ? patch.view : base?.view,
      };
      if (!merged.script) {
        return fail(new Error('script is required for the first draft'), 'update widget draft');
      }

      const version = await this.service.saveDraft(widgetId, {
        ...merged,
        changeNote: changeNote ?? null,
        parentVersionId: base?.id ?? null,
      });
      try {
        await writeMeta();
      } catch (error) {
        return fail(
          new Error(
            `Saved draft ${versionLabel(version)} (version id ${version.id}), but the title/description were not updated: ${errorMessage(error)}`,
          ),
          'update widget title/description',
        );
      }
      const state: WidgetDraftState = { version: version.version, versionId: version.id, widgetId };
      const reused = base && version.id === base.id;

      return {
        content: reused
          ? `The content is identical to ${versionLabel(version)}; no new draft was needed. Call dryRunWidget if it has not succeeded yet.`
          : `Saved draft ${versionLabel(version)} (version id ${version.id}) for widget ${widgetId}. Call dryRunWidget to execute it.`,
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'update widget draft');
    }
  }

  async dryRunWidget(params: DryRunWidgetParams): Promise<BuiltinServerRuntimeOutput> {
    // Run exactly the version named in the call — the one an approval card
    // showed — never whatever the current draft is by now.
    if (!params.versionId) {
      return fail(
        new Error(
          'versionId is required: pass the id returned by createWidgetDraft / updateWidgetDraft',
        ),
        'dry-run widget',
      );
    }
    try {
      const run = await this.service.dryRun(params.widgetId, params.versionId);
      const state: DryRunWidgetState = {
        durationMs: run.durationMs,
        error: run.error,
        runId: run.id,
        status: run.status,
        versionId: run.versionId,
        widgetId: params.widgetId,
      };
      const next =
        run.status === 'succeeded'
          ? 'The draft works. Check the numbers are plausible, then call requestPublish.'
          : run.status === 'partial'
            ? 'The draft works but reported an incomplete result (meta.complete: false). Make it complete if you can; otherwise tell the user what is missing before calling requestPublish.'
            : 'Fix the script with updateWidgetDraft and dry-run again.';

      return {
        content: [`Dry run ${run.status}: ${formatRunHead(run)}`, formatRunDetail(run), next].join(
          '\n',
        ),
        state,
        // A failing script is a normal authoring result, not a tool failure:
        // the model reads the logs and repairs it.
        success: true,
      };
    } catch (error) {
      return fail(error, 'dry-run widget');
    }
  }

  async requestPublish(params: RequestPublishParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      // Publish exactly the version the user reviewed and approved. Never fall
      // back to re-reading "the current draft": a newer draft saved while the
      // approval was pending would go live without review.
      const versionId = params.versionId;
      if (!versionId) {
        return fail(
          new Error(
            'versionId is required: pass the id of the dry-run draft the user should approve',
          ),
          'publish widget',
        );
      }

      const { firstRunStatus, schedulePattern, version } = await this.service.publish(
        params.widgetId,
        versionId,
      );
      const state: RequestPublishState = {
        schedulePattern,
        version: version.version,
        versionId: version.id,
        widgetId: params.widgetId,
      };

      return {
        content: [
          `The user approved: widget ${params.widgetId} v${version.version} is live${
            schedulePattern ? ` and refreshes on "${schedulePattern}"` : ' (manual refresh only)'
          }.`,
          firstRunStatus &&
            `First live run: ${firstRunStatus}${
              firstRunStatus === 'succeeded' || firstRunStatus === 'partial'
                ? ''
                : ' — inspect it with getWidgetRuns'
            }.`,
        ]
          .filter(Boolean)
          .join(' '),
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'publish widget');
    }
  }

  async addWidgetToDashboard(
    params: AddWidgetToDashboardParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const newTitle = params.newDashboardTitle?.trim();
    if (!params.dashboardId && !newTitle) {
      return fail(
        new Error('Pass dashboardId (from listDashboards) or newDashboardTitle'),
        'add widget to dashboard',
      );
    }
    try {
      const createdDashboard = !params.dashboardId;
      // A new board is created together with the placement, so a widget that
      // cannot be placed never leaves an empty board behind for retries to pile up.
      const {
        id: dashboardId,
        projectId,
        title,
      } = params.dashboardId
        ? {
            id: params.dashboardId,
            ...(await this.service.addToDashboard(params.dashboardId, params.widgetId)),
          }
        : await this.service.createDashboardWithWidget(newTitle!, params.widgetId);
      const state: AddWidgetToDashboardState = {
        createdDashboard,
        dashboardId,
        dashboardTitle: title,
        projectId: projectId ?? null,
        widgetId: params.widgetId,
      };

      return {
        content: `${createdDashboard ? `Created dashboard "${title}" (${dashboardId}) and placed` : 'Placed'} widget ${params.widgetId} on "${title}".`,
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'add widget to dashboard');
    }
  }

  async getWidgetRuns(params: GetWidgetRunsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (params.runId) {
        const run = await this.service.getRun(params.widgetId, params.runId);
        if (!run) return fail(new Error('Run not found'), 'get widget run');
        const state: GetWidgetRunsState = {
          runs: [
            {
              durationMs: run.durationMs,
              errorCode: run.error?.code,
              id: run.id,
              startedAt: run.startedAt,
              status: run.status,
              trigger: run.trigger,
            },
          ],
          widgetId: params.widgetId,
        };
        return {
          content: [formatRunHead(run), formatRunDetail(run)].join('\n'),
          state,
          success: true,
        };
      }

      const limit = Math.min(
        Math.max(Math.trunc(params.limit ?? DEFAULT_RUN_LIMIT), 1),
        MAX_RUN_LIMIT,
      );
      const runs = await this.service.listRuns(params.widgetId, limit);
      const state: GetWidgetRunsState = {
        runs: runs.map((run) => ({
          durationMs: run.durationMs,
          errorCode: run.error?.code,
          id: run.id,
          startedAt: run.startedAt,
          status: run.status,
          trigger: run.trigger,
        })),
        widgetId: params.widgetId,
      };
      if (runs.length === 0) {
        return { content: `Widget ${params.widgetId} has not run yet.`, state, success: true };
      }

      const lines = runs.map((run) => {
        const error = run.error ? ` — [${run.error.code}] ${run.error.message}` : '';
        return `- ${formatRunHead(run)}${error}`;
      });
      return {
        content: [
          `Last ${runs.length} runs of widget ${params.widgetId} (newest first):`,
          ...lines,
          'Pass runId for a run’s full output and logs.',
        ].join('\n'),
        state,
        success: true,
      };
    } catch (error) {
      return fail(error, 'list widget runs');
    }
  }
}
