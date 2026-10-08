import type { WidgetManifest } from '@lobechat/types';
import { validateCronPattern } from '@lobechat/utils/cronEval';

import type {
  DashboardWidgetDetail,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
} from '@/services/dashboard';

import { isUsableRunStatus } from '../utils/widgetHealth';

type PreviewRun = Pick<
  DashboardWidgetRunItem,
  'error' | 'finishedAt' | 'output' | 'startedAt' | 'status' | 'versionId'
>;

/**
 * The card model for one dry run: the widget row with that run's result in
 * place of its live snapshot. A preview never touches `latestOutput`, so the
 * card would otherwise show the (possibly empty) live state instead of what
 * the agent just tried.
 */
export const toPreviewWidget = (widget: DashboardWidgetDetail, run: PreviewRun) => ({
  ...widget,
  lastRunAt: run.startedAt,
  lastRunError: run.error,
  lastRunStatus: run.status,
  latestOutput: isUsableRunStatus(run.status) ? run.output : null,
  latestOutputAt: isUsableRunStatus(run.status) ? run.finishedAt : null,
  // Stale / next-run judgement belongs to the live widget, not to a one-off preview.
  nextRunAt: null,
  schedulePattern: null,
});

/** The most recent usable (succeeded or partial) dry run of a version, from a newest-first run list. */
export const findSucceededPreviewRun = <T extends PreviewRun & { trigger: string }>(
  runs: T[],
  versionId?: string,
) =>
  versionId
    ? runs.find(
        (run) =>
          run.versionId === versionId && run.trigger === 'preview' && isUsableRunStatus(run.status),
      )
    : undefined;

export type PreviewPublishState =
  /** This run's version is live. */
  | 'live'
  /** The run succeeded and its version can be published. */
  | 'publishable'
  /** The run did not succeed (yet); nothing to publish. */
  | 'notReady'
  /** Not the current draft; publishing it would roll the widget back. */
  | 'outdated';

/**
 * What the preview card offers for a dry run of `run.versionId`. Only the
 * current draft is publishable: any other version — a superseded draft or an
 * archived one — would silently roll the widget back to code the user never
 * approved as a release, so it reads as outdated history.
 */
export const getPreviewPublishState = (
  widget: Pick<DashboardWidgetDetail, 'draftVersionId' | 'publishedVersionId'>,
  run: Pick<PreviewRun, 'status' | 'versionId'>,
): PreviewPublishState => {
  if (widget.publishedVersionId === run.versionId) return 'live';
  if (widget.draftVersionId !== run.versionId) return 'outdated';
  return isUsableRunStatus(run.status) ? 'publishable' : 'notReady';
};

/**
 * Whether the preview may offer publishing at all. Publishing goes through
 * `WidgetService.publish`, which refuses everyone but the widget's creator —
 * a teammate reading a public widget would only meet a guaranteed failure, so
 * the action stays hidden from them. False until the current user is known.
 */
export const canPreviewPublish = (
  widget: Pick<DashboardWidgetDetail, 'userId'>,
  currentUserId?: string | null,
): boolean => !!currentUserId && currentUserId === widget.userId;

/**
 * Boards offered as placement targets from a widget preview. Placing writes
 * through `DashboardModel.addItem`, which only the board's creator can
 * perform — in a workspace the readable list includes teammates' public
 * boards, and offering them only ends in a refused write. While the current
 * user is unknown (profile still loading) nothing is offered.
 */
export const placeableDashboards = <T extends { userId: string }>(
  dashboards: T[],
  currentUserId?: string | null,
): T[] =>
  currentUserId ? dashboards.filter((dashboard) => dashboard.userId === currentUserId) : [];

/** Versions to compare by default: the one under review against the live one (or its parent). */
export const defaultDiffPair = (
  versions: Pick<DashboardWidgetVersionItem, 'id' | 'parentVersionId' | 'status'>[],
  targetId?: string,
): { baseId?: string; targetId?: string } => {
  const target = versions.find((v) => v.id === targetId) ?? versions[0];
  if (!target) return {};
  const live = versions.find((v) => v.status === 'published' && v.id !== target.id);
  const base =
    live ??
    versions.find((v) => v.id === target.parentVersionId) ??
    versions[versions.indexOf(target) + 1];
  return { baseId: base?.id, targetId: target.id };
};

/**
 * The schedule that will actually be on the widget after the version under
 * review goes live — exactly what `WidgetService.makeLive` persists: the
 * widget's own schedule wins, and only a widget without one adopts the
 * manifest's suggestion (when the pattern is valid). The review must show
 * this, not the raw manifest suggestion, or the approver signs off a cadence
 * the publish does not retain.
 */
export const resolvePublishSchedule = (
  widget: Pick<DashboardWidgetDetail, 'schedulePattern' | 'scheduleTimezone'>,
  manifest?: Pick<WidgetManifest, 'schedule'> | null,
): { pattern?: string; timezone?: string | null } => {
  if (widget.schedulePattern) {
    return { pattern: widget.schedulePattern, timezone: widget.scheduleTimezone };
  }
  const suggested = manifest?.schedule;
  if (
    suggested?.pattern &&
    validateCronPattern(suggested.pattern, suggested.timezone ?? null).valid
  ) {
    return { pattern: suggested.pattern, timezone: suggested.timezone ?? null };
  }
  return {};
};
