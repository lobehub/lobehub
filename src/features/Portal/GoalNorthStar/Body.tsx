'use client';

import { LineChart } from '@lobehub/charts';
import {
  Button,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Skeleton,
  Text,
  useTheme,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import { ListChecks } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import MetBadge from '@/features/AgentGoals/NorthStarMetrics/MetBadge';
import {
  buildNorthStarChartRows,
  buildObservationRows,
  type DeltaTone,
  deltaTone,
  formatMetricValue,
  type NorthStarObservationRow,
} from '@/features/AgentGoals/NorthStarMetrics/northStar';
import { useGoalNodeSelect } from '@/features/AgentGoals/ProcessControl/useGoalProcessActions';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { useNorthStarCard } from './useNorthStarCard';

/**
 * Detail of one north-star clause: where the number stands against its
 * target, how it got there, and the actions that move it — recording a new
 * observation or adjusting the clause itself.
 */

const styles = createStaticStyles(({ css }) => ({
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  /* The chart names each series path after its category; dash the target line. */
  chart: css`
    & path[name='target'] {
      stroke-dasharray: 4 4;
    }
  `,
  row: css`
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  task: css`
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
  `,
  taskCell: css`
    overflow: hidden;
    min-width: 0;
  `,
  taskTitle: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  time: css`
    flex: none;
    width: 72px;
  `,
  value: css`
    flex: none;
    min-width: 96px;
  `,
  section: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Axis labels at the granularity the series actually spans. */
const timeFormat = (points: { observedAt: Date }[]) => {
  const span =
    points.length > 1 ? points.at(-1)!.observedAt.getTime() - points[0].observedAt.getTime() : 0;
  return span >= DAY_MS ? 'MM-DD HH:mm' : 'HH:mm:ss';
};

const formatDelta = (delta: number) =>
  `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${formatMetricValue(Math.abs(delta))}`;

/** At most this many task links per observation; the rest are counted. */
const TASKS_PER_ROW = 1;

/** Who put the number there, for an observation no finished task explains. */
const observationSource = (row: NorthStarObservationRow): 'agent' | 'api' | 'manual' | 'probe' =>
  row.actorType === 'agent' ? 'agent' : (row.sourceType ?? 'manual');

const DELTA_COLOR: Record<DeltaTone, string> = {
  bad: cssVar.colorError,
  good: cssVar.colorSuccess,
  neutral: cssVar.colorTextTertiary,
};

const NorthStarDetail = memo<{ goalId: string; metricKey: string }>(({ goalId, metricKey }) => {
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const { card, criterion, error, graph, isLoading, loaded, points, retry, tasks } =
    useNorthStarCard(goalId, metricKey);

  const chartRows = useMemo(
    () =>
      card
        ? buildNorthStarChartRows(points, card.target, (date) =>
            dayjs(date).format(timeFormat(points)),
          )
        : [],
    [card, points],
  );
  // A task link shows the Task itself, as a click on the map would.
  const openNode = useGoalNodeSelect(goalId, graph);
  const history = useMemo(() => buildObservationRows(points, tasks), [points, tasks]);

  if (!loaded || isLoading)
    return (
      <Flexbox gap={16} padding={16}>
        <Skeleton height={96} />
        <Skeleton height={200} />
      </Flexbox>
    );

  if (!criterion || !card)
    return (
      <Flexbox padding={16}>
        <Text type={'secondary'}>{t('goalProcess.northStar.detail.removed')}</Text>
      </Flexbox>
    );

  if (error && points.length === 0)
    return (
      <Flexbox padding={16}>
        <AsyncError error={error} variant={'metric'} onRetry={retry} />
      </Flexbox>
    );

  const accent = card.met ? cssVar.colorSuccess : cssVar.colorInfo;
  const unit = card.unit ? ` ${card.unit}` : '';
  // Literal theme colors: the chart ids its SVG gradients by the color string.
  const chartColors = [card.met ? theme.colorSuccess : theme.colorInfo, theme.colorTextQuaternary];

  return (
    <Flexbox gap={24} padding={16}>
      <Flexbox gap={10}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text fontSize={28} style={{ color: card.met ? accent : undefined }} weight={700}>
              {formatMetricValue(card.current)}
            </Text>
            <Text type={'secondary'}>
              {t(`goalProcess.northStar.op.${card.op}` as const)} {formatMetricValue(card.target)}
              {unit}
            </Text>
            {card.met && <MetBadge />}
          </Flexbox>
        </Flexbox>
        <Text
          fontSize={12}
          style={card.stale ? { color: cssVar.colorWarning } : undefined}
          type={'secondary'}
        >
          {card.latestAt == null
            ? t('goalProcess.northStar.unmeasured')
            : t('goalProcess.northStar.lastObserved', { time: dayjs(card.latestAt).fromNow() })}
          {card.stale ? ` · ${t('goalProcess.northStar.staleWarning')}` : ''}
        </Text>
      </Flexbox>

      <Flexbox gap={8}>
        <Text className={styles.section}>{t('goalProcess.northStar.detail.trend')}</Text>
        {chartRows.length < 2 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('goalProcess.northStar.detail.trendEmpty')}
          </Text>
        ) : (
          <LineChart
            autoMinValue
            categories={['value', 'target']}
            className={styles.chart}
            colors={chartColors}
            data={chartRows}
            height={200}
            index={'time'}
            startEndOnly={chartRows.length > 8}
            valueFormatter={formatMetricValue}
            yAxisWidth={56}
            customCategories={{
              target: t('goalProcess.northStar.detail.target'),
              value: card.label,
            }}
          />
        )}
      </Flexbox>

      <Flexbox gap={4}>
        <Text className={styles.section}>
          {t('goalProcess.northStar.detail.history', { count: history.length })}
        </Text>
        {history.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('goalProcess.northStar.unmeasured')}
          </Text>
        ) : (
          <Flexbox>
            {history.map((row) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={12}
                key={row.observedAt.getTime()}
              >
                <Text
                  className={styles.time}
                  fontSize={12}
                  title={dayjs(row.observedAt).format('YYYY-MM-DD HH:mm:ss')}
                  type={'secondary'}
                >
                  {dayjs(row.observedAt).fromNow()}
                </Text>
                <Flexbox horizontal align={'baseline'} className={styles.value} gap={6}>
                  <Text className={styles.mono} weight={500}>
                    {formatMetricValue(row.value)}
                  </Text>
                  {row.delta != null && (
                    <Text
                      className={styles.mono}
                      fontSize={12}
                      style={{
                        color: DELTA_COLOR[deltaTone(card.op, row.value, row.delta, card.target)],
                      }}
                    >
                      {formatDelta(row.delta)}
                    </Text>
                  )}
                </Flexbox>
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.taskCell}
                  flex={1}
                  gap={6}
                  justify={'flex-end'}
                >
                  {row.tasks.length > 0 ? (
                    <>
                      {row.tasks.slice(0, TASKS_PER_ROW).map((task) => (
                        <Button
                          className={styles.task}
                          icon={<Icon icon={ListChecks} size={12} />}
                          key={task.id}
                          size={'small'}
                          title={task.title}
                          type={'text'}
                          onClick={() => openNode(task.id)}
                        >
                          <span className={styles.taskTitle}>{task.title}</span>
                        </Button>
                      ))}
                      {row.tasks.length > TASKS_PER_ROW && (
                        <Text fontSize={12} type={'secondary'}>
                          +{row.tasks.length - TASKS_PER_ROW}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text fontSize={12} type={'secondary'}>
                      {t(`goalProcess.northStar.detail.source.${observationSource(row)}` as const)}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

NorthStarDetail.displayName = 'GoalNorthStarDetail';

const Body = memo(() => {
  const view = useChatStore(chatPortalSelectors.goalNorthStarView);
  if (!view) return null;

  return <NorthStarDetail goalId={view.goalId} key={view.metricKey} metricKey={view.metricKey} />;
});

Body.displayName = 'GoalNorthStarBody';

export default Body;
