import type { AgentRunBoardData, AgentRunBoardLane, AgentRunBoardRunStatus } from '@lobechat/types';
import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
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
  resolveTopicSpan,
  type TopicRow,
} from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';
import { useOpenRunDrawer } from './useOpenRunDrawer';

const BAR_HEIGHT = 22;
const WAIT_MARK_WIDTH = 28;

const shineSweep = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(250%)' },
});

const styles = stylex.create({
  agent: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    color: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    font: 'inherit',
    gap: 8,
    maxWidth: '100%',
    paddingBlock: 6,
    paddingInline: 0,
    textAlign: 'start',
  },
  moreButton: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    fontSize: 12,
    paddingBlock: 2,
    paddingInline: 0,
  },
  axis: { height: 20, position: 'relative' },
  bar: {
    // A bare <button> paints the browser's gray under the translucent segments.
    backgroundColor: 'transparent',
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
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    color: 'inherit',
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    font: 'inherit',
    minWidth: 0,
    overflow: 'hidden',
    paddingBlock: 0,
    paddingInline: 0,
    pointerEvents: 'auto',
    textDecorationLine: { 'default': 'none', ':hover:not(:disabled)': 'underline' },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  waitIcon: {
    alignItems: 'center',
    display: 'flex',
    height: '100%',
    justifyContent: 'center',
  },
  topicSpan: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 5,
    height: BAR_HEIGHT,
    pointerEvents: 'none',
    position: 'absolute',
    top: 3,
  },
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

const tint = (status: AgentRunBoardRunStatus) =>
  // Finished turns read as work done on the track, so they stay blue against the idle band.
  status === 'done' ? `color-mix(in srgb, ${cssVar.colorInfo} 24%, transparent)` : mix(status, 32);

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
  const { left, run, width } = placed;
  const waiting = run.status === 'needs_human';
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
          width: waiting ? `calc(${width}% + ${WAIT_MARK_WIDTH}px)` : `${width}%`,
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
        {waiting ? (
          <>
            <span
              {...sx(styles.segment, {
                backgroundImage: `linear-gradient(to right, ${mix('running', 10)}, ${mix('running', 38)})`,
                flexGrow: 1,
              })}
            />
            <span
              data-testid={'team-board-run-wait-mark'}
              {...sx(styles.segment, {
                backgroundColor: RUN_STATUS_VISUALS.needs_human.color,
                flexBasis: WAIT_MARK_WIDTH,
                flexShrink: 0,
              })}
            >
              <span {...stylex.props(styles.waitIcon)}>
                <Icon
                  color={cssVar.colorBgContainer}
                  icon={RUN_STATUS_VISUALS.needs_human.icon}
                  size={14}
                />
              </span>
            </span>
          </>
        ) : run.status === 'running' ? (
          <LiveSegment />
        ) : (
          <span {...sx(styles.segment, { backgroundColor: tint(run.status), flexGrow: 1 })} />
        )}
      </button>
    </Tooltip>
  );
};

/** One band per topic: bars are its working turns, the band showing between them its idle time. */
const TopicSpanBand = ({ runs }: { runs: PlacedRun[] }) => {
  const { endsWaiting, left, width } = resolveTopicSpan(runs);

  return (
    <span
      aria-hidden
      data-testid={'team-board-topic-span'}
      {...sx(styles.topicSpan, {
        insetInlineStart: `${left}%`,
        width: endsWaiting ? `calc(${width}% + ${WAIT_MARK_WIDTH}px)` : `${width}%`,
      })}
    />
  );
};

const RowLabel = ({ agentId, row, title }: { agentId: string; row: TopicRow; title: string }) => {
  const openDrawer = useOpenRunDrawer();
  const { anchor, offset, room } = resolveRowLabel(row.runs);
  const latestRun = row.runs.at(-1)!.run;

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
      <button
        data-testid={'team-board-topic-open'}
        disabled={!row.topicId}
        type={'button'}
        {...stylex.props(styles.barLabelText)}
        onClick={() =>
          openDrawer({
            agentId,
            runningOperation: latestRun.runningOperation,
            title,
            topicId: row.topicId,
          })
        }
      >
        {title}
      </button>
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
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { overflow, rows } = layoutLaneTopics(lane.runs, windowStart, now, { expanded });
  const agentTitle = lane.title || meta?.title || t('team.agent.untitled');

  return (
    <div {...stylex.props(styles.lane)} data-testid={'team-board-lane'}>
      <button
        aria-expanded={!collapsed}
        data-testid={'team-board-lane-toggle'}
        type={'button'}
        {...stylex.props(styles.agent)}
        onClick={() => setCollapsed((value) => !value)}
      >
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
          size={14}
        />
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
      </button>
      {!collapsed &&
        rows.map((row) => {
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
                <TopicSpanBand runs={row.runs} />
                {row.runs.map((placed) => (
                  <Bar
                    agentId={lane.agentId}
                    key={placed.run.id}
                    now={now}
                    placed={placed}
                    title={title}
                  />
                ))}
                <RowLabel agentId={lane.agentId} row={row} title={title} />
              </div>
            </Flexbox>
          );
        })}
      {!collapsed && overflow > 0 && (
        <button
          data-testid={'team-board-lane-more'}
          type={'button'}
          {...stylex.props(styles.moreButton)}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('team.lane.showLess') : t('team.lane.more', { count: overflow })}
        </button>
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
