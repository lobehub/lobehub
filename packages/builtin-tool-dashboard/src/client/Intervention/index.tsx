'use client';

import type { BuiltinIntervention, BuiltinInterventionProps } from '@lobechat/types';
import { memo } from 'react';

import WidgetPublishReview from '@/features/Dashboard/WidgetPreview/PublishReview';

import type { RequestPublishParams } from '../../types';
import { DashboardApiName } from '../../types';

/**
 * The only way an agent gets a widget live: the user reviews the dry run,
 * credentials, network, schedule and code diff here, then approves or rejects.
 */
const RequestPublishIntervention = memo<BuiltinInterventionProps<RequestPublishParams>>(
  ({ args }) => {
    if (!args?.widgetId) return null;
    return (
      <WidgetPublishReview
        summary={args.summary}
        versionId={args.versionId}
        widgetId={args.widgetId}
      />
    );
  },
);

RequestPublishIntervention.displayName = 'DashboardRequestPublishIntervention';

export const DashboardInterventions: Record<string, BuiltinIntervention> = {
  [DashboardApiName.requestPublish]: RequestPublishIntervention as BuiltinIntervention,
};
