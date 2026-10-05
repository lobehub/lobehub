import { validateCronPattern } from '@lobechat/utils/cronEval';

import { type CreateWidgetVersionInput, WidgetModel } from '@/database/models/widget';
import type { LobeChatDatabase } from '@/database/type';

import { executeWidgetRun, type ResolveWidgetEnv } from './executeRun';
import { createWidgetSandboxRunner } from './sandbox';
import type { WidgetSandboxRunner } from './sandbox/types';
import { nextScheduleOccurrence } from './schedule';

export type WidgetFlowErrorCode =
  | 'DRY_RUN_REQUIRED'
  | 'FORBIDDEN'
  | 'INVALID_SCHEDULE'
  | 'NO_VERSION'
  | 'NOT_FOUND'
  | 'NOT_ROLLBACK_TARGET';

/** A request the version flow refuses; mapped to a client error by the router. */
export class WidgetFlowError extends Error {
  constructor(
    public readonly code: WidgetFlowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WidgetFlowError';
  }
}

export interface WidgetServiceDeps {
  resolveEnv?: ResolveWidgetEnv;
  runner?: WidgetSandboxRunner;
}

/**
 * The widget version flow and run entry points, on behalf of one caller:
 *
 *   draft ──dry-run──▶ (usable run for this contentHash) ──publish──▶ published
 *                                                     rollback ◀── archived
 *
 * - `saveDraft` records content as a draft version; identical content
 *   (same `contentHash`) returns the current draft instead of a new row.
 * - `dryRun` executes a draft (default: the current draft) as a `preview` run
 *   that never touches the widget snapshot or its metrics.
 * - `publish` makes a draft live only when a run of the *same content hash*
 *   produced a usable output (`succeeded` or `partial`), so what goes live is
 *   exactly what was tried.
 * - `rollback` re-publishes a previously published (archived) version; it was
 *   live before, so no new dry run is required.
 * - `runNow` refreshes the published version (`manual`), open to any reader.
 *
 * Authoring (draft / dry run / publish / rollback / schedule) is limited to the
 * widget's creator, mirroring the model's write rule.
 */
export class WidgetService {
  private readonly model: WidgetModel;
  private readonly runner: WidgetSandboxRunner;
  private readonly resolveEnv?: ResolveWidgetEnv;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string,
    deps: WidgetServiceDeps = {},
  ) {
    this.model = new WidgetModel(db, userId, workspaceId);
    this.runner = deps.runner ?? createWidgetSandboxRunner();
    this.resolveEnv = deps.resolveEnv;
  }

  private async requireWidget(widgetId: string) {
    const widget = await this.model.findById(widgetId);
    if (!widget) throw new WidgetFlowError('NOT_FOUND', 'Widget not found');
    return widget;
  }

  private async requireManageable(widgetId: string) {
    const widget = await this.requireWidget(widgetId);
    if (widget.userId !== this.userId) {
      throw new WidgetFlowError('FORBIDDEN', 'Only the widget creator can change it');
    }
    return widget;
  }

  private async requireVersion(widgetId: string, versionId: string) {
    const version = await this.model.findVersion(widgetId, versionId);
    if (!version) throw new WidgetFlowError('NOT_FOUND', 'Version not found');
    return version;
  }

  async saveDraft(widgetId: string, input: CreateWidgetVersionInput) {
    await this.requireManageable(widgetId);
    const version = await this.model.createVersion(widgetId, input);
    if (!version) throw new WidgetFlowError('NOT_FOUND', 'Widget not found');
    return version;
  }

  /** Execute a draft as a preview; defaults to the current draft, else the published version. */
  async dryRun(widgetId: string, options: { operationId?: string; versionId?: string } = {}) {
    const widget = await this.requireManageable(widgetId);
    const versionId = options.versionId ?? widget.draftVersionId ?? widget.publishedVersionId;
    if (!versionId) throw new WidgetFlowError('NO_VERSION', 'Widget has no version yet');
    const version = await this.requireVersion(widgetId, versionId);

    const run = await this.model.startRun(widgetId, {
      operationId: options.operationId,
      trigger: 'preview',
      versionId,
    });
    if (!run) throw new WidgetFlowError('NOT_FOUND', 'Widget not found');

    return this.execute(widget, version, run);
  }

  /** Refresh the published version now. Any reader of the widget may do this. */
  async runNow(widgetId: string) {
    const widget = await this.requireWidget(widgetId);
    if (!widget.publishedVersionId) {
      throw new WidgetFlowError('NO_VERSION', 'Widget has no published version');
    }
    const version = await this.requireVersion(widgetId, widget.publishedVersionId);

    // Pin the run to the version read above: a publish landing in between must
    // not relabel a run that executes this version's script.
    const run = await this.model.startRun(widgetId, { trigger: 'manual', versionId: version.id });
    if (!run) throw new WidgetFlowError('NOT_FOUND', 'Widget not found');

    return this.execute(widget, version, run);
  }

  async publish(widgetId: string, versionId: string) {
    const widget = await this.requireManageable(widgetId);
    const version = await this.requireVersion(widgetId, versionId);
    if (version.status === 'published') return { version, widget };

    if (version.status === 'draft') {
      const tried = await this.model.hasSucceededRunForContentHash(widgetId, version.contentHash);
      if (!tried) {
        throw new WidgetFlowError(
          'DRY_RUN_REQUIRED',
          `Version ${version.version} has no usable run of its content yet; dry-run it before publishing`,
        );
      }
    }

    return this.makeLive(widget, version);
  }

  /**
   * Re-publish an archived version — by default the one most recently
   * replaced. Only versions that were live before qualify.
   */
  async rollback(widgetId: string, versionId?: string) {
    const widget = await this.requireManageable(widgetId);

    let target;
    if (versionId) {
      target = await this.requireVersion(widgetId, versionId);
    } else {
      const versions = await this.model.listVersions(widgetId);
      target = versions
        .filter((v) => v.status === 'archived' && v.publishedAt)
        .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())[0];
      if (!target) {
        throw new WidgetFlowError(
          'NOT_ROLLBACK_TARGET',
          'No previously published version to roll back to',
        );
      }
    }
    if (target.status !== 'archived') {
      throw new WidgetFlowError(
        'NOT_ROLLBACK_TARGET',
        `Version ${target.version} is ${target.status}; only a previously published version can be rolled back to`,
      );
    }

    return this.makeLive(widget, target);
  }

  /**
   * Set or clear the refresh schedule. The next due instant is computed from
   * the pattern; scheduled runs only fire once a version is published.
   */
  async setSchedule(widgetId: string, pattern: string | null, timezone?: string | null) {
    await this.requireManageable(widgetId);

    let nextRunAt: Date | null = null;
    if (pattern) {
      const validation = validateCronPattern(pattern, timezone ?? null, { count: 1 });
      if (!validation.valid) {
        throw new WidgetFlowError('INVALID_SCHEDULE', `Invalid schedule: ${validation.error}`);
      }
      nextRunAt = validation.nextRuns[0];
    }

    // Reservations belong to the old schedule; never let them resume under the new one.
    await this.model.cancelScheduledRuns(widgetId);

    return this.model.update(widgetId, {
      nextRunAt,
      schedulePattern: pattern ? pattern.trim() : null,
      scheduleTimezone: pattern ? (timezone ?? null) : null,
    });
  }

  private async makeLive(
    widget: Awaited<ReturnType<WidgetService['requireWidget']>>,
    version: Awaited<ReturnType<WidgetService['requireVersion']>>,
  ) {
    // A widget without its own schedule adopts the one the script suggests.
    const suggested = version.manifest?.schedule;
    const adopt =
      !widget.schedulePattern &&
      suggested?.pattern &&
      validateCronPattern(suggested.pattern, suggested.timezone ?? null).valid;
    const pattern = adopt ? suggested!.pattern : widget.schedulePattern;
    const timezone = adopt ? (suggested!.timezone ?? null) : widget.scheduleTimezone;

    if (adopt) {
      await this.model.update(widget.id, {
        schedulePattern: pattern,
        scheduleTimezone: timezone,
      });
    }

    const result = await this.model.publishVersion(widget.id, version.id, {
      nextRunAt: pattern ? nextScheduleOccurrence(pattern, timezone) : null,
    });
    if (!result) throw new WidgetFlowError('NOT_FOUND', 'Version not found');
    return result;
  }

  private execute(
    widget: Awaited<ReturnType<WidgetService['requireWidget']>>,
    version: Awaited<ReturnType<WidgetService['requireVersion']>>,
    run: { id: string; trigger: 'manual' | 'preview' | 'schedule' },
  ) {
    return executeWidgetRun(
      this.db,
      { run, version, widget },
      { resolveEnv: this.resolveEnv, runner: this.runner },
    );
  }
}

export { executeWidgetRun } from './executeRun';
export { createWidgetSandboxRunner } from './sandbox';
export { nextScheduleOccurrence } from './schedule';
