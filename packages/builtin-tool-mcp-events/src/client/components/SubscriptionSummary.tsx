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
 * One subscription as the conversation shows it: the name people gave it, where
 * events come from (the fixed event it follows), the filter, its state, how long
 * it lasts and, when known, the topic its events run in. The status reads the
 * same as the settings list because both resolve it through `AutomationStatus`.
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

  // A name the user gave it; one that only repeats the event adds nothing.
  const title =
    subscription.name?.trim() && subscription.name !== subscription.eventName
      ? subscription.name.trim()
      : undefined;

  return (
    <Flexbox gap={6}>
      {title && (
        <Text ellipsis weight={500}>
          {title}
        </Text>
      )}
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <ConnectorEventLabel
          event={subscription.eventName}
          fallbackName={subscription.connector.name}
          identifier={subscription.connector.identifier}
        />
        <AutomationStatusTag item={subscription} />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {[
          filter,
          lifetime,
          subscription.topic &&
            t('builtins.lobe-mcp-events.render.inTopic', {
              topic:
                subscription.topic.title?.trim() ||
                t('builtins.lobe-mcp-events.render.untitledTopic'),
            }),
          // Made in a Channel: each event's result is posted back there, not left in a topic.
          subscription.deliversTo &&
            t(
              subscription.deliversTo === 'thread'
                ? 'builtins.lobe-mcp-events.render.deliversToThread'
                : 'builtins.lobe-mcp-events.render.deliversToChannel',
            ),
        ]
          .filter(Boolean)
          .join(' · ')}
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
