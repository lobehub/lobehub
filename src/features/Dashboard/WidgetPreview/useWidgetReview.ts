import { useCallback, useEffect, useLayoutEffect } from 'react';

import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

/**
 * - `loading` — a review request has not settled yet (first load or a retry);
 * - `error` — a review request failed with nothing loaded to show;
 * - `missing` — everything loaded, but the version under review is not there;
 * - `pinning` — the review is on screen; its version is being written into the request;
 * - `ready` — the exact version that approval acts on is on screen.
 */
export type WidgetReviewStatus = 'error' | 'loading' | 'missing' | 'pinning' | 'ready';

interface ReviewRequest {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
}

/**
 * Where a review stands. Settled data wins over a later background failure;
 * loading is read before error so a retry in flight shows progress.
 */
export const resolveWidgetReviewStatus = ({
  hasTarget,
  pinned,
  requests,
}: {
  hasTarget: boolean;
  pinned: boolean;
  requests: ReviewRequest[];
}): WidgetReviewStatus => {
  const settled = requests.every((request) => request.data !== undefined);
  if (settled) {
    if (!hasTarget) return 'missing';
    return pinned ? 'ready' : 'pinning';
  }
  if (requests.some((request) => request.data === undefined && request.isLoading)) return 'loading';
  if (requests.some((request) => request.data === undefined && request.error)) return 'error';
  return 'loading';
};

interface UseWidgetReviewOptions {
  /**
   * Told whether approval must wait: blocked until the version approval acts
   * on is loaded, shown and pinned into the request.
   */
  onApprovalBlockedChange?: (blocked: boolean) => void;
  /**
   * Called once with the version shown when the request named none, so the
   * caller can persist it into the request.
   */
  onPinVersion?: (versionId: string) => void;
  /** Also load the widget's runs (the publish review shows its latest dry run). */
  withRuns?: boolean;
}

/**
 * Loads what an approval card reviews — the widget and the exact version that
 * will run or go live — and reports whether approval may proceed. Failures
 * surface as `error` with a retry instead of an endless skeleton.
 */
export const useWidgetReview = (
  widgetId: string,
  versionId: string | undefined,
  { onApprovalBlockedChange, onPinVersion, withRuns = false }: UseWidgetReviewOptions = {},
) => {
  const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  const useFetchWidgetVersionPreviewRun = useDashboardStore(
    (s) => s.useFetchWidgetVersionPreviewRun,
  );
  const detailRequest = useFetchWidgetDetail(widgetId);
  const versionsRequest = useFetchWidgetVersions(widgetId);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));

  const targetId = versionId ?? widget?.draftVersionId ?? undefined;
  const target = versions.find((version) => version.id === targetId);
  // Keyed by version, not the newest-N run list: a long-pending approval
  // keeps its preview after later runs push it out of the capped list.
  const previewRunRequest = useFetchWidgetVersionPreviewRun(
    withRuns ? widgetId : undefined,
    withRuns ? targetId : undefined,
  );

  const requests = withRuns
    ? [detailRequest, versionsRequest, previewRunRequest]
    : [detailRequest, versionsRequest];
  const status = resolveWidgetReviewStatus({
    hasTarget: !!widget && !!target,
    pinned: !!versionId,
    requests,
  });
  const error = requests.find((request) => request.data === undefined && request.error)?.error;

  const unpinnedTargetId = versionId ? undefined : target?.id;
  useEffect(() => {
    if (unpinnedTargetId) onPinVersion?.(unpinnedTargetId);
  }, [unpinnedTargetId, onPinVersion]);

  // Layout effect: the host's approve action is held before the first paint,
  // so it is never clickable while nothing has been reviewed. A publish
  // review is exactly what approval acts on — a version with no usable
  // preview run would be refused by the publish flow (DRY_RUN_REQUIRED), so
  // approval stays held until a successful dry run of this version exists.
  const hasUsablePreview = !withRuns || !!previewRunRequest.data;
  const blocked = status !== 'ready' || !hasUsablePreview;
  useLayoutEffect(() => {
    onApprovalBlockedChange?.(blocked);
  }, [blocked, onApprovalBlockedChange]);
  useLayoutEffect(() => () => onApprovalBlockedChange?.(false), [onApprovalBlockedChange]);

  const { mutate: retryDetail } = detailRequest;
  const { mutate: retryVersions } = versionsRequest;
  const { mutate: retryPreviewRun } = previewRunRequest;
  const retry = useCallback(() => {
    void retryDetail();
    void retryVersions();
    if (withRuns) void retryPreviewRun();
  }, [retryDetail, retryPreviewRun, retryVersions, withRuns]);

  return { error, retry, run: previewRunRequest.data, status, target, versions, widget };
};
