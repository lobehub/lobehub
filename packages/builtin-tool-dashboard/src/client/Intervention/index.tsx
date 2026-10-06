'use client';

import type { BuiltinIntervention, BuiltinInterventionProps } from '@lobechat/types';
import { memo, useCallback } from 'react';

import { DashboardFeatureGate } from '@/features/Dashboard/FeatureGate';
import WidgetDryRunReview from '@/features/Dashboard/WidgetPreview/DryRunReview';
import WidgetPublishReview from '@/features/Dashboard/WidgetPreview/PublishReview';

import type { DryRunWidgetParams, RequestPublishParams } from '../../types';
import { DashboardApiName } from '../../types';

/**
 * The only way an agent gets a widget live: the user reviews the dry run,
 * credentials, network, schedule and code diff here, then approves or rejects.
 */
const RequestPublishIntervention = memo<BuiltinInterventionProps<RequestPublishParams>>(
  ({ args, onArgsChange }) => {
    // A request without a version (older messages, a model that skipped it)
    // gets the version on screen written into its args before approval, so
    // the runtime publishes exactly what the user reviewed.
    const pinVersion = useCallback(
      (versionId: string) => onArgsChange?.({ ...args, versionId }),
      [args, onArgsChange],
    );

    if (!args?.widgetId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetPublishReview
          summary={args.summary}
          versionId={args.versionId}
          widgetId={args.widgetId}
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
  ({ args, onArgsChange }) => {
    const pinVersion = useCallback(
      (versionId: string) => onArgsChange?.({ ...args, versionId }),
      [args, onArgsChange],
    );

    if (!args?.widgetId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetDryRunReview
          versionId={args.versionId}
          widgetId={args.widgetId}
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
