'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cssVar, cx, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnectorDisplay } from '@/features/Connectors/useConnectorDisplay';
import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import {
  type ListEventTypesState,
  type ListSubscriptionsArgs,
  type ListSubscriptionsState,
  McpEventsApiName,
  type SubscribeEventArgs,
  type SubscriptionState,
  type UnsubscribeEventState,
} from '../../types';
import { getToolError } from '../toolError';

type InspectorArgs = Partial<SubscribeEventArgs> &
  ListSubscriptionsArgs & { subscriptionId?: string };
type InspectorState = Partial<
  ListEventTypesState & ListSubscriptionsState & SubscriptionState & UnsubscribeEventState
>;

/**
 * The header line of every MCP Events call: what the agent is doing, the
 * connector and event (or the subscription) it is about, then a count or a
 * failure mark once the result is back. One component for every API because
 * they share the same anatomy; only the facet differs.
 */
const McpEventsInspector = memo<BuiltinInspectorProps<InspectorArgs, InspectorState>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading, pluginState, result }) => {
    const { t } = useTranslation('plugin');
    const params = args ?? partialArgs ?? {};
    const connector = useConnectorDisplay(params.connector);
    const pending = isArgumentsStreaming || isLoading;

    const title =
      apiName === McpEventsApiName.listSubscriptions && params.scope === 'agent'
        ? t('builtins.lobe-mcp-events.inspector.listAgentSubscriptions')
        : t(`builtins.lobe-mcp-events.apiName.${apiName}` as any);
    // The subscription a rename, check or removal acted on, by the name people know it by.
    const acted = pluginState?.subscription ?? pluginState;
    const subject =
      apiName === McpEventsApiName.subscribeEvent && params.connector
        ? [connector.name, params.name].filter(Boolean).join(' · ')
        : apiName === McpEventsApiName.listEventTypes && params.connector
          ? connector.name
          : apiName === McpEventsApiName.renameSubscription
            ? params.name?.trim() || acted?.name?.trim()
            : apiName === McpEventsApiName.checkSubscription ||
                apiName === McpEventsApiName.unsubscribeEvent
              ? acted?.name?.trim() || acted?.eventName
              : undefined;

    const failed = !pending && !!getToolError(pluginState ?? result?.state, result?.error);
    const count = pending
      ? undefined
      : apiName === McpEventsApiName.listEventTypes
        ? pluginState?.eventTypes?.length
        : apiName === McpEventsApiName.listSubscriptions
          ? pluginState?.subscriptions?.length
          : undefined;

    return (
      <div className={cx(inspectorTextStyles.root, pending && shinyTextStyles.shinyText)}>
        <span>{title}</span>
        {subject && <span className={highlightTextStyles.primary}>{subject}</span>}
        {typeof count === 'number' && !failed && (
          <Text
            code
            as={'span'}
            color={cssVar.colorTextSecondary}
            fontSize={12}
            style={{ marginInlineStart: 6 }}
          >
            {count}
          </Text>
        )}
        {failed && (
          <Text
            as={'span'}
            color={cssVar.colorError}
            fontSize={12}
            style={{ marginInlineStart: 6 }}
          >
            {t('builtins.lobe-mcp-events.inspector.failed')}
          </Text>
        )}
      </div>
    );
  },
);

McpEventsInspector.displayName = 'McpEventsInspector';

export const McpEventsInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(McpEventsApiName).map((api) => [api, McpEventsInspector as BuiltinInspector]),
);
