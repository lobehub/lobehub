import type { AgentRunBoardData, AgentRunBoardLane, AgentRunBoardRunStatus } from '@lobechat/types';
import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import AuthorChip from '@/features/HomeInbox/AuthorChip';
import { sx } from '@/styles/sx';

import {
  axisPercent,
  buildAxisTicks,
  formatDuration,
  layoutLaneTopics,
  NOW_TICK_INDEX,
  type PlacedRun,
  resolveRowLabel,
  type TopicRow,
} from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';
import { useOpenRunDrawer } from './useOpenRunDrawer';

const BAR_HEIGHT = 22;

const shineSweep = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(250%)' },
});

const styles = stylex.create({
  agent: { paddingBlock: 6 },
  axis: { height: 20, position: 'relative' },
  bar: {
    borderRadius: 5,
    borderStyle: 'none',
    borderWidth: 0,
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    display: 'flex',
    height: BAR_HEIGHT,
    overflow: 'hidden',
    opacity: { 'default': 1, ':hover': 0.75 },
    paddingBlock: 0,
    paddingInline: 0,
    position: 'absolute',
    top: 3,
  },
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    minWidth: 0,
    paddingBlock: 16,
    paddingInline: 16,
  },
  gridLine: {
    backgroundColor: cssVar.colorFillQuaternary,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  nowLine: { backgroundColor: cssVar.colorTextQuaternary },
  gridLines: {
    bottom: 0,
    insetInlineEnd: 0,
    insetInlineStart: 0,
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
  },
  lane: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlock: 6,
  },
  lanes: { position: 'relative' },
  meta: { color: cssVar.colorTextTertiary, fontSize: 12 },
  row: { height: 28 },
  tick: {
    color: cssVar.colorTextQuaternary,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    position: 'absolute',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
  },
  tickStart: { transform: 'none' },
  barLabel: {
    alignItems: 'center',
    color: cssVar.colorText,
    display: 'flex',
    fontSize: 12,
    gap: 6,
    height: BAR_HEIGHT,
    paddingInline: 6,
    pointerEvents: 'none',
    position: 'absolute',
    top: 3,
  },
  barLabelAuthor: { flexShrink: 0, pointerEvents: 'auto' },
  barLabelText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  askMark: { borderInlineStartStyle: 'solid', borderInlineStartWidth: 2, boxSizing: 'border-box' },
  segment: { display: 'block', height: '100%', overflow: 'hidden', position: 'relative' },
  live: { borderInlineEndStyle: 'solid', borderInlineEndWidth: 2, boxSizing: 'border-box' },
  shine: {
    animationDuration: '2.4s',
    animationIterationCount: 'infinite',
    animationName: { 'default': shineSweep, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationTimingFunction: 'ease-in-out',
    bottom: 0,
    display: 'block',
    left: 0,
    position: 'absolute',
    top: 0,
    width: '40%',
  },
  track: { flexGrow: 1, height: 28, minWidth: 0, position: 'relative' },
});

const mix = (status: AgentRunBoardRunStatus, percent: number) =>
  `color-mix(in srgb, ${RUN_STATUS_VISUALS[status].color} ${percent}%, transparent)`;

const tint = (status: AgentRunBoardRunStatus) => mix(status, 32);

/** Live work: fills toward its leading edge, with a light sweeping across it. */
const LiveSegment = () => (
  <span
    data-testid={'team-board-run-live'}
    {...sx(styles.segment, styles.live, {
      backgroundImage: `linear-gradient(to right, ${mix('running', 8)}, ${mix('running', 45)})`,
      borderInlineEndColor: RUN_STATUS_VISUALS.running.color,
      flexGrow: 1,
    })}
  >
    <span
      {...sx(styles.shine, {
        backgroundImage: `linear-gradient(to right, transparent, ${mix('running', 55)}, transparent)`,
      })}
    />
  </span>
);

const Bar = ({
  agentId,
  placed,
  title,
  now,
}: {
  agentId: string;
  placed: PlacedRun;
  title: string;
  now: Date;
}) => {
  const { t } = useTranslation('home');
  const openDrawer = useOpenRunDrawer();
  const profiles = useWorkspaceMemberProfiles();
  const { left, run, runningShare, width } = placed;
  const member = profiles.get(run.userId);
  const duration = formatDuration((run.endedAt ?? now).getTime() - run.startedAt.getTime());

  return (
    <Tooltip
      title={[
        title,
        t(`team.status.${run.status}`),
        duration,
        member?.fullName || member?.username,
        run.model,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <button
        aria-label={title}
        data-status={run.status}
        data-testid={'team-board-run'}
        disabled={!run.topicId}
        type={'button'}
        {...sx(styles.bar, {
          insetInlineStart: `${left}%`,
          width: `${width}%`,
        })}
        onClick={() =>
          openDrawer({
            agentId,
            runningOperation: run.runningOperation,
            title,
            topicId: run.topicId,
          })
        }
      >
        {runningShare !== null && (
          <span
            data-testid={'team-board-run-before-ask'}
            {...sx(styles.segment, {
              backgroundImage: `linear-gradient(to right, ${mix('running', 10)}, ${mix('running', 38)})`,
              flexBasis: `${runningShare}%`,
            })}
          />
        )}
        {run.status === 'running' ? (
          <LiveSegment />
        ) : (
          <span
            {...sx(
              styles.segment,
              runningShare !== null && styles.askMark,
              {
                backgroundColor:
                  run.status === 'needs_human' ? mix('needs_human', 62) : tint(run.status),
                flexGrow: 1,
              },
              runningShare !== null && {
                borderInlineStartColor: RUN_STATUS_VISUALS.needs_human.color,
              },
            )}
          />
        )}
      </button>
    </Tooltip>
  );
};

const RowLabel = ({ row, title }: { row: TopicRow; title: string }) => {
  const { anchor, offset, room } = resolveRowLabel(row.runs);

  return (
    <span
      data-testid={'team-board-topic-title'}
      {...sx(styles.barLabel, {
        ...(anchor === 'start'
          ? { insetInlineStart: `${offset}%` }
          : { insetInlineEnd: `${offset}%` }),
        maxWidth: `${room}%`,
      })}
    >
      <span {...stylex.props(styles.barLabelAuthor)}>
        <AuthorChip avatarOnly trigger={row.trigger} userId={row.startedBy} />
      </span>
      <span {...stylex.props(styles.barLabelText)}>{title}</span>
    </span>
  );
};

const Lane = ({
  lane,
  now,
  windowStart,
}: {
  lane: AgentRunBoardLane;
  now: Date;
  windowStart: Date;
}) => {
  const { t } = useTranslation('home');
  const meta = useAgentDisplayMeta(lane.agentId);
  const { overflow, rows } = layoutLaneTopics(lane.runs, windowStart, now);
  const agentTitle = lane.title || meta?.title || t('team.agent.untitled');

  return (
    <div {...stylex.props(styles.lane)} data-testid={'team-board-lane'}>
      <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.agent)}>
        <AgentAvatar
          agentId={lane.agentId}
          avatar={lane.avatar ?? undefined}
          background={lane.backgroundColor ?? undefined}
          name={agentTitle}
          size={24}
        />
        <Text ellipsis weight={500}>
          {agentTitle}
        </Text>
        <AuthorChip avatarOnly userId={lane.ownerUserId} />
      </Flexbox>
      {rows.map((row) => {
        const title = row.title || t('team.run.untitled');

        return (
          <Flexbox
            horizontal
            align={'center'}
            data-testid={'team-board-topic'}
            key={row.key}
            {...stylex.props(styles.row)}
          >
            <div {...stylex.props(styles.track)}>
              {row.runs.map((placed) => (
                <Bar
                  agentId={lane.agentId}
                  key={placed.run.id}
                  now={now}
                  placed={placed}
                  title={title}
                />
              ))}
              <RowLabel row={row} title={title} />
            </div>
          </Flexbox>
        );
      })}
      {overflow > 0 && (
        <span {...sx(styles.meta, { paddingInlineStart: 0 })}>
          {t('team.lane.more', { count: overflow })}
        </span>
      )}
    </div>
  );
};

const Timeline = ({ board }: { board: AgentRunBoardData }) => {
  const { t } = useTranslation('home');
  const { generatedAt, hiddenLaneCount, lanes, windowStart } = board;
  const ticks = buildAxisTicks(windowStart, generatedAt);
  const tickPercent = (index: number) => `${axisPercent(ticks[index], windowStart, generatedAt)}%`;

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.axis)}>
        {ticks.map((tick, index) => (
          <span
            key={tick.getTime()}
            {...sx(styles.tick, index === 0 && styles.tickStart, {
              insetInlineStart: tickPercent(index),
            })}
          >
            {index === NOW_TICK_INDEX ? t('team.axis.now') : dayjs(tick).format('HH:mm')}
          </span>
        ))}
      </div>
      <div {...stylex.props(styles.lanes)}>
        <div {...stylex.props(styles.gridLines)}>
          {ticks.map((tick, index) => (
            <span
              key={tick.getTime()}
              {...sx(styles.gridLine, index === NOW_TICK_INDEX && styles.nowLine, {
                insetInlineStart: tickPercent(index),
              })}
            />
          ))}
        </div>
        {lanes.map((lane) => (
          <Lane key={lane.agentId} lane={lane} now={generatedAt} windowStart={windowStart} />
        ))}
      </div>
      {hiddenLaneCount > 0 && (
        <span {...stylex.props(styles.meta)}>
          {t('team.lanes.hidden', { count: hiddenLaneCount })}
        </span>
      )}
    </div>
  );
};

export default Timeline;
