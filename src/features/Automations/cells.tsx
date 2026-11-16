'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { agentDisplayName, type InboundWebhookItem } from '@lobechat/types';
import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { WebhookIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import ConnectorBrandIcon from '@/features/Connectors/ConnectorBrandIcon';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { summarizeArguments } from './formatArguments';

dayjs.extend(relativeTime);

const styles = stylex.create({
  iconTile: {
    flex: 'none',
    inlineSize: '32px',
    blockSize: '32px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  // Empty values and "never" read as metadata, not content.
  muted: { color: cssVar.colorTextTertiary },
  source: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sourceEvent: { fontFamily: cssVar.fontFamilyCode },
  topicLink: {
    overflow: 'hidden',
    display: 'block',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorLink },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** The empty-value placeholder, the same `--` the rest of settings uses. */
export const EmptyValue = () => <span {...stylex.props(styles.muted)}>--</span>;

/**
 * What the automation is: its name, and on a second line where it comes from
 * — the connector, the event when the name is not already the event, and the
 * subscription's filter. One cell for both because an MCP subscription is
 * named after its event; two columns would print the event twice.
 */
export const SubscriptionCell = memo<{ item: InboundWebhookItem }>(({ item }) => {
  const { t } = useTranslation('setting');
  const { connector, source } = item;
  if (source.kind === 'generic') {
    const name = item.name?.trim() || t('automations.source.webhook');
    const detail = [
      t('automations.source.webhook'),
      t(
        source.topicMode === 'reuse'
          ? 'automations.source.topicMode.reuse'
          : 'automations.source.topicMode.new',
      ),
    ].join(' · ');
    return (
      <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Center {...stylex.props(styles.iconTile)}>
          <Icon icon={WebhookIcon} size={18} />
        </Center>
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {name}
          </Text>
          <span title={detail} {...stylex.props(styles.source)}>
            {detail}
          </span>
        </Flexbox>
      </Flexbox>
    );
  }
  const name = item.name?.trim() || source.eventName;
  const args = summarizeArguments(source.arguments);

  const parts = [
    connector?.name,
    name === source.eventName ? undefined : source.eventName,
    args &&
      (args.more > 0
        ? t('automations.source.moreArgs', { count: args.more, text: args.text })
        : args.text),
  ].filter(Boolean);

  return (
    <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0, overflow: 'hidden' }}>
      <Center {...stylex.props(styles.iconTile)}>
        <ConnectorBrandIcon
          avatar={connector?.avatar}
          identifier={connector?.identifier ?? ''}
          name={connector?.name}
          size={20}
        />
      </Center>
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Text
          ellipsis
          weight={500}
          className={
            name === source.eventName ? stylex.props(styles.sourceEvent).className : undefined
          }
        >
          {name}
        </Text>
        {parts.length > 0 && (
          <span title={parts.join(' · ')} {...stylex.props(styles.source)}>
            {parts.join(' · ')}
          </span>
        )}
      </Flexbox>
    </Flexbox>
  );
});

SubscriptionCell.displayName = 'AutomationSubscriptionCell';

/**
 * Who an event wakes and where it lands: the agent, and under it the topic it
 * answers in, as a link back into that conversation. One cell because it is
 * one answer ("this agent, in that topic"), and it keeps the table inside the
 * settings column instead of scrolling sideways.
 */
export const TargetCell = memo<{ item: InboundWebhookItem }>(({ item }) => {
  const { t } = useTranslation(['setting', 'chat']);
  const { agent, topic } = item;
  if (!agent) return <EmptyValue />;

  const agentName = agentDisplayName(agent, t('untitledAgent', { ns: 'chat' }));
  const topicTitle = topic ? topic.title?.trim() || t('automations.untitledTopic') : undefined;

  return (
    <Flexbox gap={2} style={{ minWidth: 0 }}>
      <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        <AgentAvatar
          agentId={agent.id}
          avatar={agent.avatar}
          background={agent.backgroundColor ?? undefined}
          name={agentName}
          size={18}
          style={{ flex: 'none' }}
        />
        <Text ellipsis>{agentName}</Text>
      </Flexbox>
      {item.source.kind === 'generic' ? (
        // A webhook starts its own topics; its page lists every call and where it ran.
        <WorkspaceLink
          to={`/agent/${agent.id}/webhook`}
          {...stylex.props(styles.topicLink)}
          onClick={(event) => event.stopPropagation()}
        >
          {t('automations.target.webhookCalls')}
        </WorkspaceLink>
      ) : topic && topicTitle ? (
        <WorkspaceLink
          title={topicTitle}
          to={AGENT_CHAT_TOPIC_URL(agent.id, topic.id)}
          {...stylex.props(styles.topicLink)}
          onClick={(event) => event.stopPropagation()}
        >
          {topicTitle}
        </WorkspaceLink>
      ) : (
        <span {...stylex.props(styles.source, styles.muted)}>--</span>
      )}
    </Flexbox>
  );
});

TargetCell.displayName = 'AutomationTargetCell';

/** The Topic a row runs in, on a page that already shows whose agent it is. */
export const TopicCell = memo<{ item: InboundWebhookItem }>(({ item }) => {
  const { t } = useTranslation('setting');
  const { agent, topic } = item;
  // A webhook starts its own topics (a new one per run, or by thread); its page lists every call
  // and where it ran, as on the settings list.
  if (agent && item.source.kind === 'generic')
    return (
      <WorkspaceLink
        to={`/agent/${agent.id}/webhook`}
        {...stylex.props(styles.topicLink)}
        onClick={(event) => event.stopPropagation()}
      >
        {t('automations.target.webhookCalls')}
      </WorkspaceLink>
    );
  if (!agent || !topic) return <EmptyValue />;

  const topicTitle = topic.title?.trim() || t('automations.untitledTopic');
  return (
    <WorkspaceLink
      title={topicTitle}
      to={AGENT_CHAT_TOPIC_URL(agent.id, topic.id)}
      {...stylex.props(styles.topicLink)}
      onClick={(event) => event.stopPropagation()}
    >
      {topicTitle}
    </WorkspaceLink>
  );
});

TopicCell.displayName = 'AutomationTopicCell';

/**
 * When the last event arrived. Relative, because the question is "is this
 * still firing?"; the exact time is a hover away.
 */
export const LastDeliveryCell = memo<{ at: string | null }>(({ at }) => {
  const { t } = useTranslation('setting');
  if (!at)
    return <span {...stylex.props(styles.muted)}>{t('automations.lastDelivery.never')}</span>;

  const time = dayjs(at);
  return <span title={time.format('YYYY-MM-DD HH:mm:ss')}>{time.fromNow()}</span>;
});

LastDeliveryCell.displayName = 'AutomationLastDeliveryCell';
