'use client';

import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import { ActionIcon, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createModal, type ModalInstance, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { t as i18nT } from 'i18next';
import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon, ZapIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentQuotaService } from '@/services/agentQuota';

import {
  buildBurnSeries,
  buildDailyBurn,
  buildMonthGrid,
  burnLevelOf,
  currentWeeklyWindow,
  dayKeyOf,
  projectBurnout,
  type WeeklyWindowSpan,
} from './quotaCalendarModel';

const styles = createStaticStyles(({ css }) => ({
  calendarGrid: css`
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  `,
  chartFrame: css`
    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  dayCell: css`
    position: relative;

    display: flex;
    flex-direction: column;
    justify-content: space-between;

    height: 56px;
    padding-block: 4px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;

    background: ${cssVar.colorFillQuaternary};

    &[data-in-month='false'] {
      opacity: 0.35;
    }

    &[data-today='true'] {
      box-shadow: inset 0 0 0 1.5px ${cssVar.colorPrimary};
    }

    &[data-burn-level='1'] {
      background: ${cssVar.colorSuccessBg};
    }

    &[data-burn-level='2'] {
      background: ${cssVar.colorSuccessBgHover};
    }

    &[data-burn-level='3'] {
      background: ${cssVar.colorSuccessBorder};
    }

    &[data-burn-level='4'] {
      background: ${cssVar.colorWarningBg};
      box-shadow: inset 0 0 0 1px ${cssVar.colorWarningBorder};
    }
  `,
  dayFooter: css`
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;

    min-height: 14px;

    font-size: 10px;
    color: ${cssVar.colorTextSecondary};
  `,
  legendSwatch: css`
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: ${cssVar.colorFillQuaternary};

    &[data-burn-level='1'] {
      background: ${cssVar.colorSuccessBg};
    }

    &[data-burn-level='2'] {
      background: ${cssVar.colorSuccessBgHover};
    }

    &[data-burn-level='3'] {
      background: ${cssVar.colorSuccessBorder};
    }

    &[data-burn-level='4'] {
      background: ${cssVar.colorWarningBg};
      box-shadow: inset 0 0 0 1px ${cssVar.colorWarningBorder};
    }
  `,
  statusExhaust: css`
    color: ${cssVar.colorError};
  `,
  statusSafe: css`
    color: ${cssVar.colorTextSecondary};
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

interface NormalizedWindow extends WeeklyWindowSpan {
  scopeKey: string;
}

const normalizeWeeklyWindows = (rows: WindowRow[]): NormalizedWindow[] =>
  rows
    .filter((row) => row.limitType.startsWith('weekly'))
    .map((row) => ({
      peakUtilization: row.peakUtilization,
      rateLimitedAt: toMs(row.rateLimitedAt),
      resetsAt: toMs(row.resetsAt)!,
      scopeKey: row.scopeKey || '',
      windowStartAt: toMs(row.windowStartAt)!,
    }));

const CHART_W = 640;
const CHART_H = 132;

const xOf = (time: number, window: WeeklyWindowSpan) =>
  ((time - window.windowStartAt) / (window.resetsAt - window.windowStartAt)) * CHART_W;
const yOf = (utilization: number) => CHART_H * (1 - utilization / 100);

/**
 * Burn-down curve for one weekly window: actual utilization polyline against
 * the even-pace diagonal, extended by a dashed projection at the current pace
 * — the "burn out" read at a glance.
 */
const BurnChart = memo<{
  now: number;
  readings: QuotaLimitReading[];
  scopeKey: string;
  window: WeeklyWindowSpan;
}>(({ now, readings, scopeKey, window }) => {
  const { t } = useTranslation('chat');

  const points = useMemo(
    () => buildBurnSeries(readings, scopeKey, window),
    [readings, scopeKey, window],
  );
  const isLive = window.resetsAt > now;
  const projection = useMemo(() => projectBurnout(points, window), [points, window]);

  const last = points.at(-1)!;
  const daysElapsed = Math.max((last.time - window.windowStartAt) / 86_400_000, 1 / 24);
  const dailyAverage = last.utilization / daysElapsed;

  const polyline = points.map((p) => `${xOf(p.time, window)},${yOf(p.utilization)}`).join(' ');
  const area = `M0,${CHART_H} L${polyline.replaceAll(' ', ' L')} L${xOf(last.time, window)},${CHART_H} Z`;

  const projectionEnd =
    projection.kind === 'exhaust'
      ? { time: projection.exhaustAt, utilization: 100 }
      : projection.kind === 'safe'
        ? { time: window.resetsAt, utilization: projection.projectedEndUtilization }
        : null;
  const willExhaust = projection.kind === 'exhaust';

  const statusText = !isLive
    ? t('heteroAgent.claudeQuota.calendar.pastWindow')
    : projection.kind === 'exhausted'
      ? t('heteroAgent.claudeQuota.calendar.burnout.exhausted', {
          time: dayjs(window.resetsAt).format('M/D HH:mm'),
        })
      : willExhaust
        ? t('heteroAgent.claudeQuota.calendar.burnout.willExhaust', {
            time: dayjs(projection.exhaustAt).format('M/D HH:mm'),
          })
        : t('heteroAgent.claudeQuota.calendar.burnout.safe', {
            percent: Math.round(projection.projectedEndUtilization),
          });

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'baseline'} gap={8} justify={'space-between'}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('heteroAgent.claudeQuota.calendar.usedSoFar', {
            daily: Math.round(dailyAverage),
            percent: Math.round(last.utilization),
          })}
        </Text>
        <Text
          style={{ fontSize: 12 }}
          className={cx(
            willExhaust || projection.kind === 'exhausted'
              ? styles.statusExhaust
              : styles.statusSafe,
          )}
        >
          {statusText}
        </Text>
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
              stroke={willExhaust ? cssVar.colorError : cssVar.colorTextTertiary}
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
              fill={cssVar.colorError}
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
          {dayjs(window.windowStartAt).format('M/D HH:mm')}
        </Text>
        <Text style={{ color: cssVar.colorTextQuaternary, fontSize: 11 }}>
          {t('heteroAgent.claudeQuota.calendar.pace')}
        </Text>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          {dayjs(window.resetsAt).format('M/D HH:mm')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

BurnChart.displayName = 'BurnChart';

interface QuotaCalendarProps {
  externalAccountId?: string;
}

const QuotaCalendar = memo<QuotaCalendarProps>(({ externalAccountId }) => {
  const { t } = useTranslation('chat');
  const [loading, setLoading] = useState(true);
  const [readings, setReadings] = useState<QuotaLimitReading[]>([]);
  const [windows, setWindows] = useState<NormalizedWindow[]>([]);
  const [scopeKey, setScopeKey] = useState('');
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const now = Date.now();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const accounts = await agentQuotaService.listAccounts().catch(() => []);
      const claude = accounts.filter((a) => a.provider === 'claude-code');
      const account = claude.find((a) => a.externalAccountId === externalAccountId) ?? claude[0];
      if (!account) return;

      const [windowRows, series] = await Promise.all([
        agentQuotaService.getWindows(account.id, 80).catch(() => [] as WindowRow[]),
        agentQuotaService.listSnapshots(account.id, 42).catch(() => [] as QuotaLimitReading[]),
      ]);
      if (cancelled) return;
      setWindows(normalizeWeeklyWindows(windowRows));
      setReadings(series);
    })().finally(() => setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [externalAccountId]);

  const scopeOptions = useMemo(() => {
    const scoped = [
      ...new Set(
        readings
          .filter((r) => r.limitType.startsWith('weekly') && r.scopeKey)
          .map((r) => r.scopeKey),
      ),
    ].sort();

    return [
      { label: t('heteroAgent.quota.weekly'), value: '' },
      ...scoped.map((key) => ({
        label: t('heteroAgent.claudeQuota.scopedWeekly', { model: key }),
        value: key,
      })),
    ];
  }, [readings, t]);

  const dailyBurn = useMemo(() => buildDailyBurn(readings, scopeKey), [readings, scopeKey]);

  // Chart window: the live one from the newest reading, else the most recently
  // observed window from the projection table so the chart never goes blank.
  const chartWindow = useMemo(() => {
    const live = currentWeeklyWindow(readings, scopeKey, now);
    if (live) return live;
    const past = windows.filter((w) => w.scopeKey === scopeKey);
    return past.length > 0 ? past.reduce((a, b) => (a.resetsAt > b.resetsAt ? a : b)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, scopeKey, windows]);

  // Reset badges: every observed window boundary of this series, plus the live
  // window's upcoming reset (which has no projection row yet).
  const resetsByDay = useMemo(() => {
    const map = new Map<string, { peakUtilization: number; resetsAt: number }>();
    for (const w of windows) {
      if (w.scopeKey !== scopeKey) continue;
      map.set(dayKeyOf(w.resetsAt), { peakUtilization: w.peakUtilization, resetsAt: w.resetsAt });
    }
    if (chartWindow && chartWindow.resetsAt > now) {
      map.set(dayKeyOf(chartWindow.resetsAt), {
        peakUtilization: chartWindow.peakUtilization,
        resetsAt: chartWindow.resetsAt,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, scopeKey, chartWindow]);

  const rateLimitedDays = useMemo(
    () =>
      new Set(
        windows
          .filter((w) => w.scopeKey === scopeKey && w.rateLimitedAt != null)
          .map((w) => dayKeyOf(w.rateLimitedAt!)),
      ),
    [windows, scopeKey],
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

  if (loading)
    return (
      <Flexbox gap={12}>
        <Skeleton.Button active block style={{ height: 160 }} />
        <Skeleton.Button active block style={{ height: 320 }} />
      </Flexbox>
    );

  if (readings.length === 0 && windows.length === 0)
    return (
      <Text style={{ paddingBlock: 24, textAlign: 'center' }} type={'secondary'}>
        {t('heteroAgent.claudeQuota.calendar.empty')}
      </Text>
    );

  return (
    <Flexbox gap={16}>
      {scopeOptions.length > 1 && (
        <Segmented
          options={scopeOptions}
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          value={scopeKey}
          onChange={(value) => setScopeKey(value as string)}
        />
      )}

      {chartWindow && (
        <BurnChart now={now} readings={readings} scopeKey={scopeKey} window={chartWindow} />
      )}

      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          <Text strong style={{ fontSize: 13 }}>
            {month.format('YYYY/MM')}
          </Text>
          <Flexbox horizontal gap={2}>
            <ActionIcon
              icon={ChevronLeftIcon}
              size={'small'}
              onClick={() => setMonth((m) => m.subtract(1, 'month'))}
            />
            <ActionIcon
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
            const burn = dailyBurn.get(cell.key) ?? 0;
            const reset = resetsByDay.get(cell.key);
            const rateLimited = rateLimitedDays.has(cell.key);
            const tooltipParts = [
              burn > 0 &&
                t('heteroAgent.claudeQuota.calendar.dayBurn', { percent: Math.round(burn) }),
              reset &&
                t('heteroAgent.claudeQuota.calendar.resetAt', {
                  percent: reset.peakUtilization,
                  time: dayjs(reset.resetsAt).format('HH:mm'),
                }),
              rateLimited && t('heteroAgent.claudeQuota.calendar.rateLimited'),
            ].filter(Boolean) as string[];

            const day = (
              <div
                className={styles.dayCell}
                data-burn-level={burnLevelOf(burn)}
                data-in-month={cell.inMonth}
                data-today={cell.key === todayKey}
                key={cell.key}
              >
                <span>{cell.date.date()}</span>
                <span className={styles.dayFooter}>
                  <span>{burn > 0 ? `${Math.round(burn)}%` : ''}</span>
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    {rateLimited && <Icon color={cssVar.colorError} icon={ZapIcon} size={11} />}
                    {reset && (
                      <Icon color={cssVar.colorTextSecondary} icon={RotateCcwIcon} size={11} />
                    )}
                  </span>
                </span>
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
            {[1, 2, 3].map((level) => (
              <span className={styles.legendSwatch} data-burn-level={level} key={level} />
            ))}
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.legendMore')}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <span className={styles.legendSwatch} data-burn-level={4} />
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.legendOverPace')}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon color={cssVar.colorTextSecondary} icon={RotateCcwIcon} size={11} />
            <Text style={{ fontSize: 11 }} type={'secondary'}>
              {t('heteroAgent.claudeQuota.calendar.legendReset')}
            </Text>
          </Flexbox>
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
