'use client';

import type { BuiltinRender, BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import { DashboardFeatureGate } from '@/features/Dashboard/FeatureGate';
import WidgetPreviewCard, { WidgetVersionPreviewCard } from '@/features/Dashboard/WidgetPreview';

import type {
  AddWidgetToDashboardState,
  DryRunWidgetState,
  RequestPublishState,
} from '../../types';
import { DashboardApiName } from '../../types';
import AddedToDashboard from './AddedToDashboard';

/**
 * The dry run as it will look on a board, with publish / place / details
 * actions. Every card here renders only while the `dashboard` flag is on.
 */
const DryRunWidgetRender = memo<BuiltinRenderProps<unknown, DryRunWidgetState>>(
  ({ pluginState }) => {
    if (!pluginState?.runId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetPreviewCard runId={pluginState.runId} widgetId={pluginState.widgetId} />
      </DashboardFeatureGate>
    );
  },
);
DryRunWidgetRender.displayName = 'DashboardDryRunWidgetRender';

/** After the user approved: the version that went live, with where to place it. */
const RequestPublishRender = memo<BuiltinRenderProps<unknown, RequestPublishState>>(
  ({ pluginState }) => {
    if (!pluginState?.versionId) return null;
    return (
      <DashboardFeatureGate>
        <WidgetVersionPreviewCard
          versionId={pluginState.versionId}
          widgetId={pluginState.widgetId}
        />
      </DashboardFeatureGate>
    );
  },
);
RequestPublishRender.displayName = 'DashboardRequestPublishRender';

const AddWidgetToDashboardRender = memo<BuiltinRenderProps<unknown, AddWidgetToDashboardState>>(
  ({ pluginState }) => {
    if (!pluginState?.dashboardId) return null;
    return (
      <DashboardFeatureGate>
        <AddedToDashboard {...pluginState} />
      </DashboardFeatureGate>
    );
  },
);
AddWidgetToDashboardRender.displayName = 'DashboardAddWidgetToDashboardRender';

export const DashboardRenders: Record<string, BuiltinRender> = {
  [DashboardApiName.addWidgetToDashboard]: AddWidgetToDashboardRender as BuiltinRender,
  [DashboardApiName.dryRunWidget]: DryRunWidgetRender as BuiltinRender,
  [DashboardApiName.requestPublish]: RequestPublishRender as BuiltinRender,
};
