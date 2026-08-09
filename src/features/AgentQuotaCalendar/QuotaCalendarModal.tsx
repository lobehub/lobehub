'use client';

import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import { ActionIcon, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createModal, type ModalInstance, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import { t as i18nT } from 'i18next';
import { BanIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentQuotaService } from '@/services/agentQuota';

import {
  buildBurnSeries,
  buildDailyBurn,
  buildDailyHeatLevels,
  buildDailySpend,
  buildMonthGrid,
  buildSessionGrid,
  buildWindowStats,
  currentWindow,
  dayKeyOf,
  type DaySpend,
  formatCost,
  formatTokens,
  isCalendarMonthAvailable,
  projectBurnout,
  type QuotaSeriesKey,
  type QuotaWindowSpan,
  selectQuotaAccount,
  seriesId,
  SESSION_SERIES,
  shouldShowHeatDot,
  spendInWindow,
  trackedCostOf,
  type UsageTurn,
  utilizationStatusOf,
  type WindowStat,
} from './quotaCalendarModel';

const styles = createStaticStyles(({ css }) => ({
  calendarGrid: css`
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  `,
  chartFrame: css`
    padding: 4px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  cost: css`
    align-self: flex-start;

    padding-block: 1px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 10px;
    font-weight: 500;
    line-height: 14px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  /** Keep the content surface neutral; intensity is carried by the corner dot. */
  dayCell: css`
    position: relative;

    display: flex;
    flex-direction: column;
    justify-content: space-between;

    height: 58px;
    padding-block: 4px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;

    background: ${cssVar.colorFillQuaternary};

    &[data-in-month='false'] {
      opacity: 0.35;
    }

    /* Rate limited: the provider refused work that day — an error state, not heat. */
    &[data-rate-limited='true'] {
      color: ${cssVar.colorErrorText};
      background: ${cssVar.colorErrorBg};
    }

    &[data-today='true'] {
      box-shadow: inset 0 0 0 1.5px ${cssVar.colorPrimary};
    }
  `,
  dayFooter: css`
    display: flex;
    gap: 4px;
    align-items: flex-end;
    justify-content: space-between;

    min-height: 14px;
  `,
  heatDot: css`
    position: absolute;
    inset-block-start: 6px;
    inset-inline-end: 6px;

    width: 4px;
    height: 4px;
    border-radius: 50%;

    opacity: 0.45;
    background: ${cssVar.colorSuccess};

    &[data-heat='2'] {
      width: 6px;
      height: 6px;
      opacity: 0.65;
    }

    &[data-heat='3'] {
      width: 8px;
      height: 8px;
      opacity: 0.82;
    }

    &[data-heat='4'] {
      width: 10px;
      height: 10px;
      opacity: 1;
    }

    &[data-legend='true'] {
      position: relative;
      inset: auto;
      flex: none;
    }
  `,
  legendSwatch: css`
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: ${cssVar.colorFillQuaternary};

    &[data-rate-limited='true'] {
      background: ${cssVar.colorErrorBg};
    }
  `,
  capacityRing: css`
    position: relative;

    display: grid;
    flex: none;
    place-items: center;

    width: 54px;
    height: 54px;

    color: ${cssVar.colorSuccess};

    &[data-status='warning'] {
      color: ${cssVar.colorWarning};
    }

    &[data-status='error'] {
      color: ${cssVar.colorError};
    }
  `,
  capacityRingLabel: css`
    position: absolute;

    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: currentcolor;
  `,
  capacityRingSvg: css`
    transform: rotate(-90deg);
    display: block;
    width: 100%;
    height: 100%;
  `,
  statusExhausted: css`
    font-size: 12px;
    color: ${cssVar.colorErrorText};
  `,
  /* A forecast is a warning, not a failure — the quota has not run out yet. */
  statusForecast: css`
    font-size: 12px;
    color: ${cssVar.colorWarningText};
  `,
  statusSafe: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  tokens: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
  capacityFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};

    &[data-status='warning'] {
      background: ${cssVar.colorWarning};
    }

    &[data-status='error'] {
      background: ${cssVar.colorError};
    }
  `,
  capacityTrack: css`
    overflow: hidden;

    width: 100%;
    height: 5px;
    border-radius: 999px;

    background: ${cssVar.colorFillSecondary};
  `,
  windowCell: css`
    display: flex;
    flex-direction: column;
    gap: 3px;

    min-width: 0;
    height: 54px;
    padding: 4px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    &[data-rate-limited='true'] {
      color: ${cssVar.colorErrorText};
      background: ${cssVar.colorErrorBg};
    }
  `,
  windowGrid: css`
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  `,
  windowListRow: css`
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(120px, 1fr) minmax(0, 1fr);
    gap: 12px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  windowSection: css`
    padding: 10px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  windowSpend: css`
    overflow: hidden;

    font-size: 9px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  weekday: css`
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
}));

type WindowRow = Awaited<ReturnType<typeof agentQuotaService.getWindows>>[number];

const toMs = (value: Date | number | string | null | undefined): number | null =>
  value == null ? null : new Date(value).getTime();

interface NormalizedWindow extends QuotaWindowSpan {
  seriesId: string;
}

const normalizeWindows = (rows: WindowRow[]): NormalizedWindow[] =>
  rows.map((row) => ({
    peakUtilization: row.peakUtilization,
    rateLimitedAt: toMs(row.rateLimitedAt),
    resetsAt: toMs(row.resetsAt)!,
    seriesId: row.limitType.startsWith('weekly') ? `weekly:${row.scopeKey || ''}` : 'session:',
    windowStartAt: toMs(row.windowStartAt)!,
  }));

const CHART_W = 640;
const CHART_H = 120;
const HISTORY_DAYS = 90;
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const xOf = (time: number, window: QuotaWindowSpan) =>
  ((time - window.windowStartAt) / (window.resetsAt - window.windowStartAt)) * CHART_W;
const yOf = (utilization: number) => CHART_H * (1 - utilization / 100);

const formatTrackedCost = (
  spend: Pick<DaySpend, 'cost' | 'hasUnpricedTurn'>,
  t: TFunction<'chat'>,
) => {
  const trackedCost = trackedCostOf(spend);
  if (trackedCost.kind === 'unknown') return t('heteroAgent.claudeQuota.calendar.unpricedCost');
  if (trackedCost.kind === 'lower-bound')
    return t('heteroAgent.claudeQuota.calendar.partialCost', {
      cost: formatCost(trackedCost.cost),
    });
  return formatCost(trackedCost.cost);
};

/**
 * Burn-down curve for one window: actual utilization against the even-pace
 * diagonal, extended by a dashed projection at the current pace, plus what the
 * window actually cost in tokens and dollars.
 */
const BurnChart = memo<{
  now: number;
  readings: QuotaLimitReading[];
  series: QuotaSeriesKey;
  turns: UsageTurn[];
  window: QuotaWindowSpan;
}>(({ now, readings, series, turns, window }) => {
  const { t } = useTranslation('chat');

  const points = useMemo(
    () => buildBurnSeries(readings, series, window),
    [readings, series, window],
  );
  const isLive = window.resetsAt > now;
  const projection = useMemo(() => projectBurnout(points, window), [points, window]);
  const spend = useMemo(() => spendInWindow(turns, window), [turns, window]);

  const last = points.at(-1)!;
  const polyline = points.map((p) => `${xOf(p.time, window)},${yOf(p.utilization)}`).join(' ');
  const area = `M0,${CHART_H} L${polyline.replaceAll(' ', ' L')} L${xOf(last.time, window)},${CHART_H} Z`;

  const projectionEnd =
    projection.kind === 'exhaust'
      ? { time: projection.exhaustAt, utilization: 100 }
      : projection.kind === 'safe'
        ? { time: window.resetsAt, utilization: projection.projectedEndUtilization }
        : null;
  const willExhaust = projection.kind === 'exhaust';
  const exhausted = projection.kind === 'exhausted';
  const timeFormat = series.type === 'session' ? 'HH:mm' : 'M/D HH:mm';

  const statusText = !isLive
    ? t('heteroAgent.claudeQuota.calendar.pastWindow')
    : exhausted
      ? t('heteroAgent.claudeQuota.calendar.burnout.exhausted', {
          time: dayjs(window.resetsAt).format(timeFormat),
        })
      : willExhaust
        ? t('heteroAgent.claudeQuota.calendar.burnout.willExhaust', {
            time: dayjs(projection.exhaustAt).format(timeFormat),
          })
        : t('heteroAgent.claudeQuota.calendar.burnout.safe', {
            percent: Math.round(projection.projectedEndUtilization),
          });

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'flex-end'} gap={12} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={10}>
          <CapacityRing utilization={last.utilization} />
          <Flexbox gap={2}>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.usedOfWindow')}
            </Text>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {spend.tokens > 0
                ? t('heteroAgent.claudeQuota.calendar.windowSpend', {
                    cost: formatTrackedCost(spend, t),
                    tokens: formatTokens(spend.tokens),
                  })
                : t('heteroAgent.claudeQuota.calendar.noLedgerSpend')}
            </Text>
          </Flexbox>
        </Flexbox>
        <span
          className={
            exhausted
              ? styles.statusExhausted
              : willExhaust
                ? styles.statusForecast
                : styles.statusSafe
          }
        >
          {statusText}
        </span>
      </Flexbox>

      <div className={styles.chartFrame}>
        <svg
          height={CHART_H}
          preserveAspectRatio={'none'}
          style={{ display: 'block' }}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          width={'100%'}
        >
          {[25, 50, 75].map((u) => (
            <line
              key={u}
              stroke={cssVar.colorBorderSecondary}
              strokeWidth={1}
              x1={0}
              x2={CHART_W}
              y1={yOf(u)}
              y2={yOf(u)}
            />
          ))}
          {/* even pace: exactly exhausting the window at its reset */}
          <line
            stroke={cssVar.colorTextQuaternary}
            strokeDasharray={'4 4'}
            strokeWidth={1}
            x1={0}
            x2={CHART_W}
            y1={CHART_H}
            y2={0}
          />
          <path d={area} fill={cssVar.colorSuccess} opacity={0.12} />
          <polyline fill={'none'} points={polyline} stroke={cssVar.colorSuccess} strokeWidth={2} />
          {isLive && projectionEnd && (
            <line
              stroke={willExhaust ? cssVar.colorWarning : cssVar.colorTextTertiary}
              strokeDasharray={'4 4'}
              strokeWidth={1.5}
              x1={xOf(last.time, window)}
              x2={xOf(projectionEnd.time, window)}
              y1={yOf(last.utilization)}
              y2={yOf(projectionEnd.utilization)}
            />
          )}
          {isLive && willExhaust && (
            <circle
              cx={xOf(projection.exhaustAt, window)}
              cy={yOf(100)}
              fill={cssVar.colorWarning}
              r={3.5}
            />
          )}
          <circle
            cx={xOf(last.time, window)}
            cy={yOf(last.utilization)}
            fill={cssVar.colorSuccess}
            r={3.5}
          />
        </svg>
      </div>

      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          {dayjs(window.windowStartAt).format(timeFormat)}
        </Text>
        <Text style={{ color: cssVar.colorTextQuaternary, fontSize: 11 }}>
          {t('heteroAgent.claudeQuota.calendar.pace')}
        </Text>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          {dayjs(window.resetsAt).format(timeFormat)}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

BurnChart.displayName = 'BurnChart';

const CapacityRing = memo<{ utilization: number }>(({ utilization }) => {
  const value = Math.min(100, Math.max(0, utilization));

  return (
    <div
      aria-label={`${Math.round(utilization)}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(utilization)}
      className={styles.capacityRing}
      data-status={utilizationStatusOf(utilization)}
      role={'meter'}
    >
      <svg className={styles.capacityRingSvg} viewBox={'0 0 54 54'}>
        <circle
          cx={27}
          cy={27}
          fill={'none'}
          r={RING_RADIUS}
          stroke={cssVar.colorFillSecondary}
          strokeWidth={5}
        />
        <circle
          cx={27}
          cy={27}
          fill={'none'}
          r={RING_RADIUS}
          stroke={'currentColor'}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - value / 100)}
          strokeLinecap={'round'}
          strokeWidth={5}
        />
      </svg>
      <span className={styles.capacityRingLabel}>{Math.round(utilization)}%</span>
    </div>
  );
});

CapacityRing.displayName = 'CapacityRing';

const CapacityMeter = memo<{ utilization: number }>(({ utilization }) => (
  <div
    aria-label={`${Math.round(utilization)}%`}
    aria-valuemax={100}
    aria-valuemin={0}
    aria-valuenow={Math.round(utilization)}
    className={styles.capacityTrack}
    role={'meter'}
  >
    <div
      className={styles.capacityFill}
      data-status={utilizationStatusOf(utilization)}
      style={{ width: `${Math.min(100, Math.max(0, utilization))}%` }}
    />
  </div>
));

CapacityMeter.displayName = 'CapacityMeter';

const windowTooltip = (stat: WindowStat, t: TFunction<'chat'>) =>
  [
    `${dayjs(stat.windowStartAt).format('M/D HH:mm')} – ${dayjs(stat.resetsAt).format('M/D HH:mm')}`,
    t('heteroAgent.claudeQuota.calendar.windowUtilization', {
      percent: Math.round(stat.peakUtilization),
    }),
    stat.tokens > 0 &&
      t('heteroAgent.claudeQuota.calendar.windowSpend', {
        cost: formatTrackedCost(stat, t),
        tokens: formatTokens(stat.tokens),
      }),
    stat.rateLimitedAt && t('heteroAgent.claudeQuota.calendar.rateLimited'),
  ].filter(Boolean) as string[];

const WindowHistory = memo<{
  series: QuotaSeriesKey;
  stats: WindowStat[];
}>(({ series, stats }) => {
  const { t } = useTranslation('chat');

  if (stats.length === 0) return null;

  if (series.type === 'session') {
    const latestDay = dayjs(Math.max(...stats.map((stat) => stat.windowStartAt)));
    const grid = buildSessionGrid(stats, latestDay);

    return (
      <Flexbox className={styles.windowSection} gap={8}>
        <Flexbox horizontal align={'baseline'} justify={'space-between'}>
          <Text strong style={{ fontSize: 13 }}>
            {t('heteroAgent.claudeQuota.calendar.sessionHistory')}
          </Text>
          <Text style={{ fontSize: 11 }} type={'secondary'}>
            {t('heteroAgent.claudeQuota.calendar.sessionHistoryHint')}
          </Text>
        </Flexbox>
        <div className={styles.windowGrid}>
          {grid.columns.map((column) => (
            <div className={styles.weekday} key={column.key}>
              {column.date.format('dd M/D')}
            </div>
          ))}
          {Array.from({ length: grid.rowCount }, (_, row) =>
            grid.columns.map((column) => {
              const stat = column.slots[row];
              if (!stat) return <div className={styles.windowCell} key={`${column.key}-${row}`} />;

              const cell = (
                <div
                  className={styles.windowCell}
                  data-rate-limited={stat.rateLimitedAt != null}
                  key={`${column.key}-${stat.resetsAt}`}
                >
                  <Flexbox
                    horizontal
                    justify={'space-between'}
                    style={{ minWidth: 0, width: '100%' }}
                  >
                    <span>{dayjs(stat.windowStartAt).format('HH:mm')}</span>
                    <strong>{Math.round(stat.peakUtilization)}%</strong>
                  </Flexbox>
                  <CapacityMeter utilization={stat.peakUtilization} />
                  <span className={styles.windowSpend}>
                    {stat.tokens > 0
                      ? `${formatTokens(stat.tokens)} · ${formatTrackedCost(stat, t)}`
                      : t('heteroAgent.claudeQuota.calendar.noLedgerSpendShort')}
                  </span>
                </div>
              );

              return (
                <Tooltip
                  key={`${column.key}-${stat.resetsAt}`}
                  title={windowTooltip(stat, t).join(' · ')}
                >
                  {cell}
                </Tooltip>
              );
            }),
          )}
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.windowSection} gap={6}>
      <Flexbox horizontal align={'baseline'} justify={'space-between'}>
        <Text strong style={{ fontSize: 13 }}>
          {t('heteroAgent.claudeQuota.calendar.weeklyHistory')}
        </Text>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          {t('heteroAgent.claudeQuota.calendar.weeklyHistoryHint')}
        </Text>
      </Flexbox>
      {stats.map((stat) => (
        <div className={styles.windowListRow} key={stat.resetsAt}>
          <Flexbox gap={1}>
            <Text style={{ fontSize: 11 }}>
              {dayjs(stat.windowStartAt).format('M/D')} – {dayjs(stat.resetsAt).format('M/D')}
            </Text>
            <Text style={{ fontSize: 10 }} type={'secondary'}>
              {stat.isLive
                ? t('heteroAgent.claudeQuota.calendar.currentWindow')
                : t('heteroAgent.claudeQuota.calendar.pastWindow')}
            </Text>
          </Flexbox>
          <Flexbox gap={4}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text style={{ fontSize: 10 }} type={'secondary'}>
                {t('heteroAgent.claudeQuota.calendar.capacityUsed')}
              </Text>
              <Text strong style={{ fontSize: 13 }}>
                {Math.round(stat.peakUtilization)}%
              </Text>
            </Flexbox>
            <CapacityMeter utilization={stat.peakUtilization} />
          </Flexbox>
          {stat.tokens > 0 ? (
            <Text style={{ fontSize: 11, textAlign: 'right' }} type={'secondary'}>
              {formatTokens(stat.tokens)} · {formatTrackedCost(stat, t)}
            </Text>
          ) : (
            <Tooltip title={t('heteroAgent.claudeQuota.calendar.noLedgerSpendHint')}>
              <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'}>
                <Icon color={cssVar.colorTextTertiary} icon={InfoIcon} size={11} />
                <Text style={{ fontSize: 11 }} type={'secondary'}>
                  {t('heteroAgent.claudeQuota.calendar.noLedgerSpendShort')}
                </Text>
              </Flexbox>
            </Tooltip>
          )}
        </div>
      ))}
    </Flexbox>
  );
});

WindowHistory.displayName = 'WindowHistory';

interface QuotaCalendarProps {
  externalAccountId?: string;
}

const QuotaCalendar = memo<QuotaCalendarProps>(({ externalAccountId }) => {
  const { t } = useTranslation('chat');
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readings, setReadings] = useState<QuotaLimitReading[]>([]);
  const [turns, setTurns] = useState<UsageTurn[]>([]);
  const [windows, setWindows] = useState<NormalizedWindow[]>([]);
  const [series, setSeries] = useState<QuotaSeriesKey>(SESSION_SERIES);
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const now = Date.now();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const accounts = await agentQuotaService.listAccounts().catch(() => []);
      const claude = accounts.filter((a) => a.provider === 'claude-code');
      const account = selectQuotaAccount(claude, externalAccountId);
      if (!account) {
        if (!cancelled) setAccountUnavailable(true);
        return;
      }
      setAccountUnavailable(false);

      const [windowRows, snapshotSeries, usageTurns] = await Promise.all([
        agentQuotaService.getWindows(account.id, 200).catch(() => [] as WindowRow[]),
        agentQuotaService
          .listSnapshots(account.id, HISTORY_DAYS)
          .catch(() => [] as QuotaLimitReading[]),
        agentQuotaService.listUsageTurns(account.id, HISTORY_DAYS).catch(() => [] as UsageTurn[]),
      ]);
      if (cancelled) return;
      setWindows(normalizeWindows(windowRows));
      setReadings(snapshotSeries);
      setTurns(usageTurns);
    })().finally(() => setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [externalAccountId]);

  // The 5-hour session window comes first: it is the window an agent actually
  // works inside, and the one that stops a run mid-task.
  const seriesOptions = useMemo(() => {
    const scoped = [
      ...new Set(
        readings
          .filter((r) => r.limitType.startsWith('weekly') && r.scopeKey)
          .map((r) => r.scopeKey),
      ),
    ].sort();

    return [
      { label: t('heteroAgent.claudeQuota.calendar.sessionWindow'), value: 'session:' },
      { label: t('heteroAgent.quota.weekly'), value: 'weekly:' },
      ...scoped.map((key) => ({
        label: t('heteroAgent.claudeQuota.scopedWeekly', { model: key }),
        value: `weekly:${key}`,
      })),
    ];
  }, [readings, t]);

  const dailySpend = useMemo(() => buildDailySpend(turns), [turns]);
  const dailyBurn = useMemo(() => buildDailyBurn(readings, series), [readings, series]);
  const dailyHeatLevels = useMemo(
    () => buildDailyHeatLevels(dailySpend, dailyBurn),
    [dailyBurn, dailySpend],
  );

  const chartWindow = useMemo(() => {
    const live = currentWindow(readings, series, now);
    if (live) return live;
    const past = windows.filter((w) => w.seriesId === seriesId(series));
    return past.length > 0 ? past.reduce((a, b) => (a.resetsAt > b.resetsAt ? a : b)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, series, windows]);

  const windowStats = useMemo(() => {
    const history = windows.filter((window) => window.seriesId === seriesId(series));
    return buildWindowStats(history, chartWindow, turns, now, series.type === 'session' ? 40 : 8);
    // `now` is intentionally captured when the modal opens, matching chartWindow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, chartWindow, turns, series]);

  // A 5-hour window resets several times a day, so a per-day reset badge would
  // fire on every cell — only the weekly windows get one.
  const resetsByDay = useMemo(() => {
    if (series.type === 'session') return new Map<string, number>();
    const map = new Map<string, number>();
    for (const w of windows) {
      if (w.seriesId !== seriesId(series)) continue;
      map.set(dayKeyOf(w.resetsAt), w.resetsAt);
    }
    if (chartWindow && chartWindow.resetsAt > now) {
      map.set(dayKeyOf(chartWindow.resetsAt), chartWindow.resetsAt);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, series, chartWindow]);

  const rateLimitedDays = useMemo(
    () =>
      new Set(
        windows
          .filter((w) => w.seriesId === seriesId(series) && w.rateLimitedAt != null)
          .map((w) => dayKeyOf(w.rateLimitedAt!)),
      ),
    [windows, series],
  );

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        dayjs()
          .day((index + 1) % 7)
          .format('dd'),
      ),
    [],
  );
  const todayKey = dayKeyOf(now);
  const previousMonth = month.subtract(1, 'month');
  const nextMonth = month.add(1, 'month');

  if (loading)
    return (
      <Flexbox gap={12}>
        <Skeleton.Button active block style={{ height: 170 }} />
        <Skeleton.Button active block style={{ height: 320 }} />
      </Flexbox>
    );

  if (readings.length === 0 && windows.length === 0)
    return (
      <Text style={{ paddingBlock: 24, textAlign: 'center' }} type={'secondary'}>
        {t(
          accountUnavailable
            ? 'heteroAgent.claudeQuota.calendar.accountUnavailable'
            : 'heteroAgent.claudeQuota.calendar.empty',
        )}
      </Text>
    );

  const dayLabel = (spend: DaySpend | undefined, burn: number) => {
    if (spend && spend.tokens > 0) return formatTokens(spend.tokens);
    // No ledger row (usage burned outside LobeHub) but the meter still moved.
    if (burn > 0) return `${Math.round(burn)}%`;
    return '';
  };

  return (
    <Flexbox gap={16}>
      <Segmented
        options={seriesOptions}
        size={'small'}
        style={{ alignSelf: 'flex-start' }}
        value={seriesId(series)}
        onChange={(value) => {
          const [type, scopeKey = ''] = String(value).split(':');
          setSeries({ scopeKey, type: type === 'session' ? 'session' : 'weekly' });
        }}
      />

      {chartWindow && (
        <BurnChart
          now={now}
          readings={readings}
          series={series}
          turns={turns}
          window={chartWindow}
        />
      )}

      <WindowHistory series={series} stats={windowStats} />

      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text strong style={{ fontSize: 13 }}>
              {t('heteroAgent.claudeQuota.calendar.monthSpend')}
            </Text>
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {month.format('YYYY/MM')}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={2}>
            <ActionIcon
              disabled={!isCalendarMonthAvailable(previousMonth, now)}
              icon={ChevronLeftIcon}
              size={'small'}
              onClick={() => setMonth((m) => m.subtract(1, 'month'))}
            />
            <ActionIcon
              disabled={!isCalendarMonthAvailable(nextMonth, now)}
              icon={ChevronRightIcon}
              size={'small'}
              onClick={() => setMonth((m) => m.add(1, 'month'))}
            />
          </Flexbox>
        </Flexbox>

        <div className={styles.calendarGrid}>
          {weekdayLabels.map((label) => (
            <div className={styles.weekday} key={label}>
              {label}
            </div>
          ))}
          {grid.map((cell) => {
            const spend = dailySpend.get(cell.key);
            const burn = dailyBurn.get(cell.key) ?? 0;
            const resetsAt = resetsByDay.get(cell.key);
            const rateLimited = rateLimitedDays.has(cell.key);
            const heatLevel = dailyHeatLevels.get(cell.key) ?? 0;
            const label = dayLabel(spend, burn);
            const tooltipParts = [
              spend &&
                spend.tokens > 0 &&
                t('heteroAgent.claudeQuota.calendar.dayTokens', {
                  cost: formatTrackedCost(spend, t),
                  tokens: formatTokens(spend.tokens),
                }),
              burn > 0 &&
                t('heteroAgent.claudeQuota.calendar.dayShare', { percent: Math.round(burn) }),
              resetsAt &&
                t('heteroAgent.claudeQuota.calendar.resetAt', {
                  time: dayjs(resetsAt).format('HH:mm'),
                }),
              rateLimited && t('heteroAgent.claudeQuota.calendar.rateLimited'),
            ].filter(Boolean) as string[];

            const day = (
              <div
                className={styles.dayCell}
                data-in-month={cell.inMonth}
                data-rate-limited={rateLimited}
                data-today={cell.key === todayKey}
                key={cell.key}
              >
                <span>{cell.date.date()}</span>
                {shouldShowHeatDot(heatLevel, rateLimited) && (
                  <span aria-hidden className={styles.heatDot} data-heat={heatLevel} />
                )}
                <span className={styles.dayFooter}>
                  <span className={styles.tokens}>{label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {rateLimited && <Icon color={cssVar.colorError} icon={BanIcon} size={12} />}
                    {resetsAt && (
                      <Icon color={cssVar.colorTextSecondary} icon={RotateCcwIcon} size={11} />
                    )}
                  </span>
                </span>
                {spend && (spend.cost > 0 || spend.hasUnpricedTurn) && (
                  <span className={styles.cost}>{formatTrackedCost(spend, t)}</span>
                )}
              </div>
            );

            return tooltipParts.length > 0 ? (
              <Tooltip key={cell.key} title={tooltipParts.join(' · ')}>
                {day}
              </Tooltip>
            ) : (
              day
            );
          })}
        </div>

        <Flexbox horizontal align={'center'} gap={12} style={{ fontSize: 11 }}>
          <Flexbox horizontal align={'center'} gap={4}>
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.legendLess')}
            </Text>
            {[1, 2, 3, 4].map((level) => (
              <span className={styles.heatDot} data-heat={level} data-legend={'true'} key={level} />
            ))}
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.legendMore')}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <span className={styles.legendSwatch} data-rate-limited={'true'} />
            <Icon color={cssVar.colorError} icon={BanIcon} size={11} />
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.rateLimited')}
            </Text>
          </Flexbox>
          {series.type !== 'session' && (
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon color={cssVar.colorTextSecondary} icon={RotateCcwIcon} size={11} />
              <Text style={{ fontSize: 11 }} type={'secondary'}>
                {t('heteroAgent.claudeQuota.calendar.legendReset')}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

QuotaCalendar.displayName = 'QuotaCalendar';

/** Calling this opens the modal — `createModal` mounts immediately. */
export const openQuotaCalendarModal = (
  params: { externalAccountId?: string } = {},
): ModalInstance =>
  createModal({
    content: <QuotaCalendar externalAccountId={params.externalAccountId} />,
    footer: null,
    title: i18nT('heteroAgent.claudeQuota.calendar.title', { ns: 'chat' }),
    width: 620,
  });

export default QuotaCalendar;
