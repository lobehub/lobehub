'use client';

import type { BuiltinIntervention, BuiltinInterventionProps } from '@lobechat/types';
import { memo, useCallback, useLayoutEffect } from 'react';

import { DashboardFeatureGate } from '@/features/Dashboard/FeatureGate';
import { useDashboardFeature } from '@/features/Dashboard/hooks/useDashboardFeature';
import WidgetDryRunReview from '@/features/Dashboard/WidgetPreview/DryRunReview';
import WidgetPublishReview from '@/features/Dashboard/WidgetPreview/PublishReview';

import type { DryRunWidgetParams, RequestPublishParams } from '../../types';
import { DashboardApiName } from '../../types';

/**
 * While no review renders — the dashboard feature is off or its flag is still
 * loading, or the request names no widget — there is nothing to approve
 * against: hold approval. Once the review mounts it reports its own readiness.
 */
const useHoldApprovalWithoutReview = (
  widgetId: string | undefined,
  onApprovalBlockedChange?: (blocked: boolean) => void,
) => {
  const { enabled } = useDashboardFeature();
  const reviewable = enabled && !!widgetId;
  useLayoutEffect(() => {
    if (!reviewable) onApprovalBlockedChange?.(true);
  }, [reviewable, onApprovalBlockedChange]);
};

/**
 * The only way an agent gets a widget live: the user reviews the dry run,
 * credentials, network, schedule and code diff here, then approves or rejects.
 */
const RequestPublishIntervention = memo<BuiltinInterventionProps<RequestPublishParams>>(
  ({ args, onApprovalBlockedChange, onArgsChange }) => {
    // A request without a version (older messages, a model that skipped it)
    // gets the version on screen written into its args before approval, so
    // the runtime publishes exactly what the user reviewed.
    const pinVersion = useCallback(
      (versionId: string) => onArgsChange?.({ ...args, versionId }),
      [args, onArgsChange],
    );
    useHoldApprovalWithoutReview(args?.widgetId, onApprovalBlockedChange);

    if (!args?.widgetId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetPublishReview
          summary={args.summary}
          versionId={args.versionId}
          widgetId={args.widgetId}
          onApprovalBlockedChange={onApprovalBlockedChange}
          onPinVersion={pinVersion}
        />
      </DashboardFeatureGate>
    );
  },
);

RequestPublishIntervention.displayName = 'DashboardRequestPublishIntervention';

/**
 * Shown only for drafts that declare connector credentials or network hosts:
 * the user approves running exactly this script with that access.
 */
const DryRunWidgetIntervention = memo<BuiltinInterventionProps<DryRunWidgetParams>>(
  ({ args, onApprovalBlockedChange, onArgsChange }) => {
    const pinVersion = useCallback(
      (versionId: string) => onArgsChange?.({ ...args, versionId }),
      [args, onArgsChange],
    );
    useHoldApprovalWithoutReview(args?.widgetId, onApprovalBlockedChange);

    if (!args?.widgetId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetDryRunReview
          versionId={args.versionId}
          widgetId={args.widgetId}
          onApprovalBlockedChange={onApprovalBlockedChange}
          onPinVersion={pinVersion}
        />
      </DashboardFeatureGate>
    );
  },
);

DryRunWidgetIntervention.displayName = 'DashboardDryRunWidgetIntervention';

export const DashboardInterventions: Record<string, BuiltinIntervention> = {
  [DashboardApiName.dryRunWidget]: DryRunWidgetIntervention as BuiltinIntervention,
  [DashboardApiName.requestPublish]: RequestPublishIntervention as BuiltinIntervention,
};
