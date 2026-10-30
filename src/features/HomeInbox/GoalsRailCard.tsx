import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, FlagIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { homeType } from '@/features/Home/components/homeType';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { type HomeGoalEntry, homeGoalHref, resolveHomeGoalView } from './homeGoals';

const AVATAR_SIZE = 20;
const ROW_GAP = 10;
const ROW_PADDING_INLINE = 14;
const BARE_PADDING_INLINE = 8;

const styles = stylex.create({
  bareGroupLabel: {
    paddingInline: `${BARE_PADDING_INLINE}px`,
  },
  bareList: {
    marginInline: `-${BARE_PADDING_INLINE}px`,
  },
  bareRow: {
    paddingBlock: '7px',
    paddingInline: `${BARE_PADDING_INLINE}px`,
    borderRadius: cssVar.borderRadius,
  },
  glyph: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
  },
  // The bucket a row belongs to is the one thing a goal glance must not make the
  // reader infer, so each pile is named — even when it holds a single row.
  groupLabel: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '2px',
    paddingInline: `${ROW_PADDING_INLINE}px`,
  },
  list: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  rounds: {
    flex: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  row: {
    justifyContent: 'flex-start',
    width: '100%',
    height: 'auto',
    paddingBlock: '9px',
    paddingInline: `${ROW_PADDING_INLINE}px`,
    borderWidth: 0,
    textAlign: 'start',
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

/** The agent behind the goal — the face is what makes a long-running goal recognisable. */
const GoalAgentAvatar = memo<{ agentId: string | null }>(({ agentId }) => {
  const agent = useAgentDisplayMeta(agentId);
  if (!agent) return null;

  return (
    <AgentAvatar
      agentId={agentId}
      avatar={agent.avatar}
      background={agent.backgroundColor}
      shape={'circle'}
      size={AVATAR_SIZE}
      style={{ flex: 'none' }}
      title={agent.title}
    />
  );
});

interface GoalRowProps {
  bare?: boolean;
  entry: HomeGoalEntry;
}

const GoalRow = memo<GoalRowProps>(({ bare, entry }) => {
  const { t } = useTranslation(['home', 'chat']);
  const navigate = useWorkspaceAwareNavigate();
  const href = homeGoalHref(entry);

  return (
    <Button
      className={stylex.props(styles.row, bare && styles.bareRow).className}
      disabled={!href}
      type={'text'}
      onClick={() => href && navigate(href)}
    >
      <Flexbox horizontal align={'center'} gap={ROW_GAP} style={{ width: '100%' }}>
        {/* The pile heading says which of the two states this is; the glyph
            carries the exact one (verifying, planning, waiting) on hover, where
            it costs the row nothing. */}
        <span {...stylex.props(styles.glyph)} title={t(entry.statusKey, { ns: 'chat' })}>
          {entry.bucket === 'running' ? (
            <RunningGlyph />
          ) : (
            <Icon color={cssVar.colorInfo} icon={FlagIcon} size={16} />
          )}
        </span>
        <Text
          ellipsis
          className={stylex.props(homeType.itemTitle).className}
          style={{ flex: 1, minWidth: 0 }}
        >
          {entry.title}
        </Text>
        <GoalAgentAvatar agentId={entry.agentId} />
        {/* A goal is measured in the tasks it has closed, not in time — how far
            through its own decomposition it is says more at a glance. */}
        <span {...stylex.props(homeType.meta, styles.rounds)}>
          {entry.pendingDecisions > 0
            ? t('goalList.needsYou', { count: entry.pendingDecisions, ns: 'chat' })
            : t('goalList.taskProgress', {
                done: entry.taskDone,
                ns: 'chat',
                total: entry.taskTotal,
              })}
        </span>
        <Icon color={cssVar.colorTextQuaternary} icon={ChevronRightIcon} size={14} />
      </Flexbox>
    </Button>
  );
});

interface GoalsRailCardProps {
  /** Rendered inside a rail card, which already draws the shell. */
  bare?: boolean;
  entries: HomeGoalEntry[];
}

/**
 * Goals outlive the sessions that created them, so unlike a run they have
 * nowhere to surface on their own: this is the standing place to see the ones
 * still in flight. Two piles only — waiting on you, and working — because those
 * are the states a long-horizon goal is *open* in; the rest are history and live
 * on the agent's own goal page.
 */
const GoalsRailCard = memo<GoalsRailCardProps>(({ bare, entries }) => {
  const { t } = useTranslation('home');
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const { buckets, collapsed } = resolveHomeGoalView(entries, expanded);

  return (
    <Flexbox className={stylex.props(bare ? styles.bareList : styles.list).className}>
      {buckets.map(({ bucket, entries: rows, total }) => (
        <Flexbox key={bucket}>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.groupLabel, bare && styles.bareGroupLabel).className}
            gap={6}
          >
            <span {...stylex.props(homeType.sectionLabel)}>
              {t(bucket === 'review' ? 'inbox.goals.review' : 'inbox.goals.running')}
            </span>
            <span {...stylex.props(homeType.badge)}>{total}</span>
          </Flexbox>
          {rows.map((entry) => (
            <GoalRow bare={bare} entry={entry} key={entry.id} />
          ))}
        </Flexbox>
      ))}
      {collapsed && (
        <Button
          type={'text'}
          className={
            stylex.props(styles.row, bare && styles.bareRow, homeType.supporting).className
          }
          onClick={() => setExpanded(true)}
        >
          {t('inbox.goals.showAll', { count: entries.length })}
        </Button>
      )}
    </Flexbox>
  );
});

export default GoalsRailCard;
