import type { WidgetOutput, WidgetRunError, WidgetRunStatus } from '@lobechat/types';
import { WIDGET_RUN_OUTPUT_STATUSES } from '@lobechat/types';

/** A run whose output the card renders: `succeeded`, or `partial` (incomplete but usable). */
export const isUsableRunStatus = (status?: WidgetRunStatus | null) =>
  !!status && (WIDGET_RUN_OUTPUT_STATUSES as readonly string[]).includes(status);

/** How late a scheduled refresh may be before the card calls its data stale. */
export const WIDGET_STALE_GRACE_MS = 25 * 60 * 1000;

/** The widget fields a card needs to judge freshness — the hot read model on the widget row. */
export interface WidgetHealthInput {
  lastRunAt?: Date | string | null;
  lastRunError?: WidgetRunError | null;
  lastRunStatus?: WidgetRunStatus | null;
  latestOutput?: WidgetOutput | null;
  latestOutputAt?: Date | string | null;
  nextRunAt?: Date | string | null;
  publishedVersionId?: string | null;
  schedulePattern?: string | null;
}

export type WidgetHealthBadge = 'running' | 'failed' | 'stale' | 'partial';

export interface WidgetHealth {
  /** Badges to show, most urgent first. Empty means fresh and complete. */
  badges: WidgetHealthBadge[];
  /** Error of the last run when it did not succeed. */
  error?: WidgetRunError | null;
  failed: boolean;
  /** There is a last successful output to render. */
  hasOutput: boolean;
  partial: boolean;
  /** Script note attached to a partial result. */
  partialMessage?: string;
  running: boolean;
  stale: boolean;
  /** No published version yet — nothing will ever run until one is. */
  unpublished: boolean;
}

const toTime = (value?: Date | string | null) => (value ? new Date(value).getTime() : undefined);

/**
 * Judge what a widget card must say about its data.
 *
 * The card always renders the latest *successful* output. A failed or timed-out
 * last run does not clear it: the card keeps the old value and marks it
 * failed, so a broken script never reads as a real zero.
 */
export const getWidgetHealth = (
  widget: WidgetHealthInput,
  options: { now?: number; runningLocally?: boolean } = {},
): WidgetHealth => {
  const now = options.now ?? Date.now();
  const running = !!options.runningLocally || widget.lastRunStatus === 'running';
  const failed = widget.lastRunStatus === 'failed' || widget.lastRunStatus === 'timeout';
  const hasOutput = !!widget.latestOutput;

  const nextRunAt = toTime(widget.nextRunAt);
  const stale =
    !running &&
    !!widget.schedulePattern &&
    nextRunAt !== undefined &&
    now - nextRunAt > WIDGET_STALE_GRACE_MS;

  const meta = widget.latestOutput?.meta;
  const partial = hasOutput && meta?.complete === false;

  const badges: WidgetHealthBadge[] = [];
  if (running) badges.push('running');
  if (failed) badges.push('failed');
  if (stale) badges.push('stale');
  if (partial) badges.push('partial');

  return {
    badges,
    error: failed ? widget.lastRunError : undefined,
    failed,
    hasOutput,
    partial,
    partialMessage: partial ? meta?.message : undefined,
    running,
    stale,
    unpublished: !widget.publishedVersionId,
  };
};

/** The instant the shown data was produced, falling back to the last attempt. */
export const getWidgetUpdatedAt = (widget: WidgetHealthInput) =>
  widget.latestOutputAt ?? widget.lastRunAt ?? null;

/**
 * What a card's body shows. `output` whenever a successful result exists —
 * including after a failed run — so a broken script never replaces real data;
 * the empty states only apply when there has never been a good result.
 */
export type WidgetCardBody = 'output' | 'firstRun' | 'failedNoOutput' | 'unpublished' | 'noRun';

export const getWidgetCardBody = (health: WidgetHealth): WidgetCardBody => {
  if (health.hasOutput) return 'output';
  if (health.running) return 'firstRun';
  if (health.failed) return 'failedNoOutput';
  return health.unpublished ? 'unpublished' : 'noRun';
};
