import type { AgentRunBoardData, AgentRunBoardLane } from '@lobechat/types';
import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { sx } from '@/styles/sx';

import {
  buildAxisTicks,
  formatDuration,
  layoutLaneTopics,
  type PlacedRun,
  resolveRowLabel,
} from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';
import { useOpenRunDrawer } from './useOpenRunDrawer';

const BAR_HEIGHT = 22;

const styles = stylex.create({
  agent: { paddingBlock: 6 },
  axis: { height: 20, position: 'relative' },
  bar: {
    borderRadius: 5,
    borderStyle: 'none',
    borderWidth: 0,
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    height: BAR_HEIGHT,
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
  tickEnd: { transform: 'translateX(-100%)' },
  tickStart: { transform: 'none' },
  barLabel: {
    color: cssVar.colorText,
    fontSize: 12,
    lineHeight: `${BAR_HEIGHT}px`,
    overflow: 'hidden',
    paddingInline: 8,
    pointerEvents: 'none',
    position: 'absolute',
    textOverflow: 'ellipsis',
    top: 3,
    whiteSpace: 'nowrap',
  },
  track: { flexGrow: 1, height: 28, minWidth: 0, position: 'relative' },
});

const Bar = ({
  agentId,
  placed,
  title,
  windowEnd,
}: {
  agentId: string;
  placed: PlacedRun;
  title: string;
  windowEnd: Date;
}) => {
  const { t } = useTranslation('home');
  const openDrawer = useOpenRunDrawer();
  const profiles = useWorkspaceMemberProfiles();
  const { left, run, width } = placed;
  const member = profiles.get(run.userId);
  const duration = formatDuration((run.endedAt ?? windowEnd).getTime() - run.startedAt.getTime());

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
          backgroundColor: `color-mix(in srgb, ${RUN_STATUS_VISUALS[run.status].color} 32%, transparent)`,
          insetInlineStart: `${left}%`,
          width: `${width}%`,
        })}
        onClick={() => openDrawer({ agentId, title, topicId: run.topicId })}
      />
    </Tooltip>
  );
};

const RowLabel = ({ placed, title }: { placed: PlacedRun[]; title: string }) => {
  const { anchor, offset } = resolveRowLabel(placed);

  return (
    <span
      data-testid={'team-board-topic-title'}
      {...sx(styles.barLabel, {
        maxWidth: `${100 - offset}%`,
        ...(anchor === 'start'
          ? { insetInlineStart: `${offset}%` }
          : { insetInlineEnd: `${offset}%` }),
      })}
    >
      {title}
    </span>
  );
};

const Lane = ({
  lane,
  windowEnd,
  windowStart,
}: {
  lane: AgentRunBoardLane;
  windowEnd: Date;
  windowStart: Date;
}) => {
  const { t } = useTranslation('home');
  const meta = useAgentDisplayMeta(lane.agentId);
  const { overflow, rows } = layoutLaneTopics(lane.runs, windowStart, windowEnd);
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
                  placed={placed}
                  title={title}
                  windowEnd={windowEnd}
                />
              ))}
              <RowLabel placed={row.runs} title={title} />
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
  const tickPercent = (index: number) => `${(index / (ticks.length - 1)) * 100}%`;

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.axis)}>
        {ticks.map((tick, index) => (
          <span
            key={tick.getTime()}
            {...sx(
              styles.tick,
              index === 0 && styles.tickStart,
              index === ticks.length - 1 && styles.tickEnd,
              { insetInlineStart: tickPercent(index) },
            )}
          >
            {index === ticks.length - 1 ? t('team.axis.now') : dayjs(tick).format('HH:mm')}
          </span>
        ))}
      </div>
      <div {...stylex.props(styles.lanes)}>
        <div {...stylex.props(styles.gridLines)}>
          {ticks.map((tick, index) => (
            <span
              key={tick.getTime()}
              {...sx(styles.gridLine, { insetInlineStart: tickPercent(index) })}
            />
          ))}
        </div>
        {lanes.map((lane) => (
          <Lane key={lane.agentId} lane={lane} windowEnd={generatedAt} windowStart={windowStart} />
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
