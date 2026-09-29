import type {
  DashboardWidgetDetail,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
} from '@/services/dashboard';

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
  latestOutput: run.status === 'succeeded' ? run.output : null,
  latestOutputAt: run.status === 'succeeded' ? run.finishedAt : null,
  // Stale / next-run judgement belongs to the live widget, not to a one-off preview.
  nextRunAt: null,
  schedulePattern: null,
});

/** The most recent successful dry run of a version, from a newest-first run list. */
export const findSucceededPreviewRun = <T extends PreviewRun & { trigger: string }>(
  runs: T[],
  versionId?: string,
) =>
  versionId
    ? runs.find(
        (run) =>
          run.versionId === versionId && run.trigger === 'preview' && run.status === 'succeeded',
      )
    : undefined;

export type PreviewPublishState =
  /** This run's version is live. */
  | 'live'
  /** The run succeeded and its version can be published. */
  | 'publishable'
  /** The run did not succeed (yet); nothing to publish. */
  | 'notReady'
  /** The agent saved a newer draft since; this preview is history. */
  | 'outdated';

/** What the preview card offers for a dry run of `run.versionId`. */
export const getPreviewPublishState = (
  widget: Pick<DashboardWidgetDetail, 'draftVersionId' | 'publishedVersionId'>,
  run: Pick<PreviewRun, 'status' | 'versionId'>,
): PreviewPublishState => {
  if (widget.publishedVersionId === run.versionId) return 'live';
  if (widget.draftVersionId && widget.draftVersionId !== run.versionId) return 'outdated';
  return run.status === 'succeeded' ? 'publishable' : 'notReady';
};

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
