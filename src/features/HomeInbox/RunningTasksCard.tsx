import { agentDisplayName } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { homeType } from '@/features/Home/components/homeType';
import RunningGlyph from '@/features/Home/components/RunningGlyph';

import AuthorChip from './AuthorChip';
import moduleStyles from './RunningTasksCard.module.css';
import TopicRow from './TopicRow';
import { type InboxTopic } from './useHomeInboxTopics';

const AVATAR_SIZE = 20;
/** Past this the stack turns into a smudge; the rest are counted instead. */
const MAX_AVATARS = 5;

const styles = stylex.create({
  bareRoot: {
    marginBlock: '-6px',
    marginInline: '-8px',
  },
  body: {
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInline: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  bareBody: {
    paddingInline: 0,
  },
  card: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  head: {
    flex: '1',
    justifyContent: 'flex-start',
    width: 'auto',
    minWidth: 0,
    height: 'auto',
    paddingBlock: '11px',
    paddingInline: '14px',
    borderWidth: 0,
    textAlign: 'start',
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  // Inside a rail card the shell is already drawn; only the hover bleed remains.
  bareHead: {
    paddingBlock: '7px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
  },
  // The stack's overlap rule (`.avatars > :not(:first-child)`) also reaches this
  // count and outranks any margin set here, so none is declared.
  overflowCount: {
    flex: 'none',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  // Ring in the card's own background so overlapping avatars stay separable.
  stackedAvatar: {
    flex: 'none',
    boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
  },
});

/** One avatar of the collapsed stack. Its own component because `useAgentDisplayMeta` is a hook and the stack is a list. */
const StackedAgentAvatar = memo<{ agentId: string }>(({ agentId }) => {
  const agent = useAgentDisplayMeta(agentId);
  if (!agent) return null;

  return (
    <AgentAvatar
      agentId={agentId}
      avatar={agent.avatar}
      background={agent.backgroundColor}
      className={stylex.props(styles.stackedAvatar).className}
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
const RunningAgentAvatars = memo<{ running: InboxTopic[] }>(({ running }) => {
  // One avatar per agent, not per topic: an agent running three topics is still
  // one face, and the count next to it already carries the volume.
  const agentIds = [...new Set(running.map((topic) => topic.agentId).filter(Boolean))] as string[];
  const shown = agentIds.slice(0, MAX_AVATARS);
  const overflow = agentIds.length - shown.length;

  if (shown.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} className={moduleStyles.avatars} flex={'none'}>
      {shown.map((agentId) => (
        <StackedAgentAvatar agentId={agentId} key={agentId} />
      ))}
      {overflow > 0 && <span {...stylex.props(styles.overflowCount)}>+{overflow}</span>}
    </Flexbox>
  );
});

interface RunningTasksCardProps {
  action?: ReactNode;
  /** Rendered inside a rail card, which already draws the shell. */
  bare?: boolean;
  running: InboxTopic[];
  /** Team view: tag each expanded row with whose run it is. */
  showAuthor?: boolean;
}

/**
 * Runs that are executing fine need no attention — so this collapses to a
 * single line by default and only opens on demand. Nothing here is actionable;
 * it exists so the user knows work is in flight.
 */
const RunningTasksCard = memo<RunningTasksCardProps>(({ action, bare, running, showAuthor }) => {
  const { t } = useTranslation('home');
  const [open, setOpen] = useState(false);

  if (running.length === 0) return null;

  return (
    <Flexbox className={stylex.props(bare ? styles.bareRoot : styles.card).className}>
      <Flexbox horizontal align={'center'}>
        <Button
          className={stylex.props(styles.head, bare && styles.bareHead).className}
          type={'text'}
          onClick={() => setOpen((v) => !v)}
        >
          <Flexbox horizontal align={'center'} gap={10} style={{ width: '100%' }}>
            <RunningGlyph />
            <Text className={stylex.props(homeType.itemTitle).className} style={{ flex: 1 }}>
              {t('inbox.running.title', { count: running.length })}
            </Text>
            <RunningAgentAvatars running={running} />
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
        <Flexbox className={stylex.props(styles.body, bare && styles.bareBody).className}>
          {running.map((topic) => (
            <TopicRow
              key={topic.id}
              leading={<RunningGlyph size={14} />}
              topic={topic}
              trailing={
                showAuthor ? (
                  <AuthorChip trigger={topic.trigger} userId={topic.userId} />
                ) : undefined
              }
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunningTasksCard;
