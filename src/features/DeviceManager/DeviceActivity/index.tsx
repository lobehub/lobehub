'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, type DeviceBoundAgentItem } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRightIcon, LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RunningGlyph from '@/features/Home/components/RunningGlyph';
import TopicRow, { getTopicChatUrl } from '@/features/HomeInbox/TopicRow';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { type DeviceRunningTopic, deviceService } from '@/services/device';

import { RunUserAvatar } from './RunningUsers';

/** Runs start and finish on their own, so keep the list close to live while the page is open. */
const REFRESH_INTERVAL_MS = 15_000;

const styles = stylex.create({
  agentRow: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  list: { padding: '6px' },
  placeholder: { paddingBlock: '14px', paddingInline: '16px' },
});

/**
 * One request backs both cards; SWR dedupes the second caller, so the running
 * topics and the bound agents always come from the same snapshot.
 */
export const useDeviceActivity = (deviceId: string) =>
  useClientDataSWR(
    ['device/activity', deviceId],
    () => deviceService.getDeviceActivity({ deviceId }),
    { focusThrottleInterval: 1000, refreshInterval: REFRESH_INTERVAL_MS },
  );

const Placeholder = ({ children }: { children: string }) => (
  <Text className={stylex.props(styles.placeholder).className} fontSize={13} type={'secondary'}>
    {children}
  </Text>
);

/**
 * The row itself opens the topic too, but a whole-row click is easy to miss;
 * the explicit button makes "jump to this run" visible at a glance.
 */
const OpenTopicButton = memo<{ topic: DeviceRunningTopic }>(({ topic }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const url = getTopicChatUrl(topic);
  if (!url) return null;

  return (
    <ActionIcon
      aria-label={t('devices.activity.runningTopics.open')}
      icon={ArrowUpRightIcon}
      size={'small'}
      title={t('devices.activity.runningTopics.open')}
      onClick={(e) => {
        // The row navigates on click as well; open once.
        e.stopPropagation();
        navigate(url);
      }}
    />
  );
});

OpenTopicButton.displayName = 'OpenTopicButton';

/**
 * Conversations whose turns are executing on this machine right now, each
 * with the member who started it — a shared device runs teammates' work too.
 */
export const RunningTopicList = memo<{ deviceId: string }>(({ deviceId }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading } = useDeviceActivity(deviceId);

  if (isLoading) return <Placeholder>{t('devices.activity.loading')}</Placeholder>;
  if (error && !data) return <Placeholder>{t('devices.activity.error')}</Placeholder>;

  const topics = data?.runningTopics ?? [];
  if (topics.length === 0)
    return <Placeholder>{t('devices.activity.runningTopics.empty')}</Placeholder>;

  return (
    <Flexbox className={stylex.props(styles.list).className}>
      {topics.map((topic) => (
        <TopicRow
          action={<OpenTopicButton topic={topic} />}
          key={topic.id}
          leading={<RunningGlyph size={14} />}
          topic={topic}
          trailing={topic.user ? <RunUserAvatar user={topic.user} /> : undefined}
        />
      ))}
    </Flexbox>
  );
});

RunningTopicList.displayName = 'RunningTopicList';

const BoundAgentRow = memo<{ agent: DeviceBoundAgentItem }>(({ agent }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const name = agentDisplayName(agent, t('untitledAgent', { ns: 'chat' }));
  const open = () => navigate(AGENT_CHAT_URL(agent.id));

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.agentRow).className}
      gap={10}
      onClick={open}
    >
      <Avatar
        avatar={agent.avatar ?? undefined}
        background={agent.backgroundColor ?? undefined}
        shape={'circle'}
        size={22}
        style={{ flex: 'none' }}
        title={name}
      />
      <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
        {name}
      </Text>
      {agent.visibility === 'private' && (
        <Tag icon={<Icon icon={LockIcon} />} size={'small'}>
          {t('devices.visibilityTabs.private')}
        </Tag>
      )}
      <ActionIcon
        aria-label={t('devices.activity.boundAgents.open')}
        icon={ArrowUpRightIcon}
        size={'small'}
        title={t('devices.activity.boundAgents.open')}
        onClick={(e) => {
          // The row navigates on click as well; open once.
          e.stopPropagation();
          open();
        }}
      />
    </Flexbox>
  );
});

BoundAgentRow.displayName = 'BoundAgentRow';

/** Agents whose execution is routed to this device. */
export const BoundAgentList = memo<{ deviceId: string }>(({ deviceId }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading } = useDeviceActivity(deviceId);

  if (isLoading) return <Placeholder>{t('devices.activity.loading')}</Placeholder>;
  if (error && !data) return <Placeholder>{t('devices.activity.error')}</Placeholder>;

  const agents = data?.agents ?? [];
  if (agents.length === 0)
    return <Placeholder>{t('devices.activity.boundAgents.empty')}</Placeholder>;

  return (
    <Flexbox className={stylex.props(styles.list).className}>
      {agents.map((agent) => (
        <BoundAgentRow agent={agent} key={agent.id} />
      ))}
    </Flexbox>
  );
});

BoundAgentList.displayName = 'BoundAgentList';
