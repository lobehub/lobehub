import { agentDisplayName } from '@lobechat/types';
import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { homeType } from '@/features/Home/components/homeType';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useHomeInboxAgentIds } from '@/store/entity';

import TopicRow from './TopicRow';

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
  bareRoot: css`
    margin-block: -6px;
    margin-inline: -8px;
  `,
  body: css`
    padding-block: 4px 8px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  bareBody: css`
    padding-inline: 0;
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  head: css`
    flex: 1;
    justify-content: flex-start;

    width: auto;
    min-width: 0;
    height: auto;
    padding-block: 11px;
    padding-inline: 14px;
    border: 0;

    text-align: start;

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  // Inside a rail card the shell is already drawn; only the hover bleed remains.
  bareHead: css`
    padding-block: 7px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
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
      title={agentDisplayName(agent)}
    />
  );
});

/**
 * Who is working, without opening the card. A count alone ("3 tasks running")
 * says how much is in flight but not *whose* — and which agents are busy is the
 * thing the user actually recognises at a glance.
 */
const RunningAgentAvatars = memo<{ topicIds: string[] }>(({ topicIds }) => {
  // One avatar per agent, not per topic: an agent running three topics is still
  // one face, and the count next to it already carries the volume.
  const agentIds = useHomeInboxAgentIds(topicIds);
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

interface RunningTasksCardProps {
  action?: ReactNode;
  /** Rendered inside a rail card, which already draws the shell. */
  bare?: boolean;
  /** Team view: tag each expanded row with whose run it is. */
  showAuthor?: boolean;
  topicIds: string[];
}

/**
 * Runs that are executing fine need no attention — so this collapses to a
 * single line by default and only opens on demand. Nothing here is actionable;
 * it exists so the user knows work is in flight.
 */
const RunningTasksCard = memo<RunningTasksCardProps>(({ action, bare, showAuthor, topicIds }) => {
  const { t } = useTranslation('home');
  const [open, setOpen] = useState(false);

  if (topicIds.length === 0) return null;

  return (
    <Flexbox className={bare ? styles.bareRoot : styles.card}>
      <Flexbox horizontal align={'center'}>
        <Button
          className={cx(styles.head, bare && styles.bareHead)}
          type={'text'}
          onClick={() => setOpen((v) => !v)}
        >
          <Flexbox horizontal align={'center'} gap={10} style={{ width: '100%' }}>
            <RunningGlyph />
            <Text className={homeType.itemTitle} style={{ flex: 1 }}>
              {t('inbox.running.title', { count: topicIds.length })}
            </Text>
            <RunningAgentAvatars topicIds={topicIds} />
            <Icon
              color={cssVar.colorTextQuaternary}
              icon={open ? ChevronDownIcon : ChevronRightIcon}
              size={14}
            />
          </Flexbox>
        </Button>
        {action}
      </Flexbox>

      {open && (
        <Flexbox className={cx(styles.body, bare && styles.bareBody)}>
          {topicIds.map((topicId) => (
            <TopicRow
              key={topicId}
              leading={<RunningGlyph size={14} />}
              showAuthor={showAuthor}
              topicId={topicId}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunningTasksCard;
