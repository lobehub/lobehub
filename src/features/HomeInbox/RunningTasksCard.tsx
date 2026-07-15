import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

import TopicRow from './TopicRow';
import { type InboxTopic } from './useHomeInboxTopics';

const AVATAR_SIZE = 20;
/** Past this the stack turns into a smudge; the rest are counted instead. */
const MAX_AVATARS = 5;

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatars: css`
    /* Overlap the stack so N agents read as one cluster, not a toolbar. */
    > *:not(:first-child) {
      margin-inline-start: -6px;
    }
  `,
  body: css`
    padding-block: 4px 8px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  head: css`
    cursor: pointer;
    padding-block: 11px;
    padding-inline: 14px;
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  overflowCount: css`
    flex: none;
    margin-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  // Ring in the card's own background so overlapping avatars stay separable.
  stackedAvatar: css`
    flex: none;
    box-shadow: 0 0 0 2px ${cssVar.colorBgContainer};
  `,
}));

/** One avatar of the collapsed stack. Its own component because `useAgentDisplayMeta` is a hook and the stack is a list. */
const StackedAgentAvatar = memo<{ agentId: string }>(({ agentId }) => {
  const agent = useAgentDisplayMeta(agentId);
  if (!agent) return null;

  return (
    <Avatar
      avatar={agent.avatar}
      background={agent.backgroundColor}
      className={styles.stackedAvatar}
      shape={'circle'}
      size={AVATAR_SIZE}
      title={agent.title}
    />
  );
});

/**
 * Who is working, without opening the card. A count alone ("3 tasks running")
 * says how much is in flight but not *whose* — and which agents are busy is the
 * thing the user actually recognises at a glance.
 */
const RunningAgentAvatars = memo<{ running: InboxTopic[] }>(({ running }) => {
  // One avatar per agent, not per topic: an agent running three topics is still
  // one face, and the count next to it already carries the volume.
  const agentIds = [...new Set(running.map((topic) => topic.agentId).filter(Boolean))] as string[];
  const shown = agentIds.slice(0, MAX_AVATARS);
  const overflow = agentIds.length - shown.length;

  if (shown.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.avatars} flex={'none'}>
      {shown.map((agentId) => (
        <StackedAgentAvatar agentId={agentId} key={agentId} />
      ))}
      {overflow > 0 && <span className={styles.overflowCount}>+{overflow}</span>}
    </Flexbox>
  );
});

/**
 * The ring track is a translucent wash of the same warning color, so the
 * spinner reads as one glyph rather than a colored arc on a grey donut.
 */
const RING_COLOR = `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

interface RunningTasksCardProps {
  running: InboxTopic[];
}

/**
 * Runs that are executing fine need no attention — so this collapses to a
 * single line by default and only opens on demand. Nothing here is actionable;
 * it exists so the user knows work is in flight.
 */
const RunningTasksCard = memo<RunningTasksCardProps>(({ running }) => {
  const { t } = useTranslation('home');
  const [open, setOpen] = useState(false);

  if (running.length === 0) return null;

  return (
    <Flexbox className={styles.card}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.head}
        gap={10}
        onClick={() => setOpen((v) => !v)}
      >
        <RingLoadingIcon ringColor={RING_COLOR} size={16} style={{ color: cssVar.colorWarning }} />
        <Text fontSize={13} style={{ flex: 1 }} weight={500}>
          {t('inbox.running.title', { count: running.length })}
        </Text>
        <RunningAgentAvatars running={running} />
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={open ? ChevronDownIcon : ChevronRightIcon}
          size={14}
        />
      </Flexbox>

      {open && (
        <Flexbox className={styles.body}>
          {running.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              leading={
                <RingLoadingIcon
                  ringColor={RING_COLOR}
                  size={14}
                  style={{ color: cssVar.colorWarning }}
                />
              }
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunningTasksCard;
