'use client';

import { Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AutomationStatusReason,
  AutomationStatusTag,
} from '@/features/Automations/AutomationStatus';
import { summarizeArguments } from '@/features/Automations/formatArguments';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import type { McpEventSubscriptionSummary } from '../../types';
import ConnectorEventLabel from './ConnectorEventLabel';

interface SubscriptionSummaryProps {
  /** Add the reason line when something is wrong (a single result, not a list row). */
  detailed?: boolean;
  subscription: McpEventSubscriptionSummary;
}

/**
 * One subscription as the conversation shows it: where events come from, the
 * filter, its state, and how long it lasts. The status reads the same as the
 * settings list because both resolve it through `AutomationStatus`.
 */
const SubscriptionSummary = memo<SubscriptionSummaryProps>(({ detailed, subscription }) => {
  const { t } = useTranslation('plugin');
  const { identifier } = subscription.connector;
  // The tool result names the connector only by identifier. Resolve the row the
  // way the server does for this agent, so "Reconnect" opens the connector this
  // subscription actually uses — the agent's own copy when it has one.
  const agentId = useAgentStore((s) => s.activeAgentId);
  const connectorAgentId = useToolStore(
    (s) => connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s)?.agentId,
  );
  const args = summarizeArguments(subscription.arguments, 3);
  const filter = args
    ? args.more > 0
      ? t('builtins.lobe-mcp-events.render.moreArgs', { count: args.more, text: args.text })
      : args.text
    : t('builtins.lobe-mcp-events.render.noFilter', { event: subscription.eventName });
  const lifetime = subscription.expiresAt
    ? t('builtins.lobe-mcp-events.render.expiresAt', {
        time: dayjs(subscription.expiresAt).format('YYYY-MM-DD HH:mm'),
      })
    : t('builtins.lobe-mcp-events.render.expiresNever');

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <ConnectorEventLabel
          event={subscription.eventName}
          fallbackName={subscription.connector.name}
          identifier={subscription.connector.identifier}
        />
        <AutomationStatusTag item={subscription} />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {filter} · {lifetime}
      </Text>
      {detailed && (
        <AutomationStatusReason
          connector={{ agentId: connectorAgentId, identifier }}
          item={subscription}
        />
      )}
    </Flexbox>
  );
});

SubscriptionSummary.displayName = 'McpEventsSubscriptionSummary';

export default SubscriptionSummary;
