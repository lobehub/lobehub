'use client';

import type { EvalRunMetrics } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { formatDuration } from '../../../../../../utils';

const styles = stylex.create({
  // One flat strip: the numbers carry the row, so no per-metric card or icon.
  strip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    rowGap: 16,
  },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
    paddingInline: 20,
    borderInlineStartWidth: { 'default': 1, ':first-child': 0 },
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    paddingInlineStart: { 'default': 20, ':first-child': 0 },
  },
  label: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  value: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading3,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    lineHeight: 1.2,
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
  },
  sub: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  progressTrack: {
    overflow: 'hidden',
    width: '100%',
    height: 4,
    marginBlockStart: 4,
    borderRadius: 999,
    backgroundColor: cssVar.colorFillSecondary,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: cssVar.colorSuccess,
  },
});

interface StatsCardsProps {
  metrics?: EvalRunMetrics;
}

interface Metric {
  key: string;
  label: string;
  sub?: ReactNode;
  value: string;
}

const perCase = (value: string, unit: string) => `~${value} ${unit}`;

/**
 * The run's headline numbers in reading order: the outcome, then what the
 * cases took (steps, cost, tokens), then how long they ran.
 */
const StatsCards = ({ metrics }: StatsCardsProps) => {
  const { t } = useTranslation('eval');

  const passedCount = metrics?.passedCases ?? 0;
  const totalCases = metrics?.totalCases ?? 0;
  const hasPassRate = metrics?.passRate !== undefined;
  const passPct = hasPassRate ? Math.round((metrics?.passRate ?? 0) * 100) : 0;
  const unit = t('run.metrics.perCase');

  const callSplit =
    metrics?.perCaseLlmCalls !== undefined || metrics?.perCaseToolCalls !== undefined
      ? t('run.metrics.stepsSplit', {
          llm: (metrics?.perCaseLlmCalls ?? 0).toFixed(1),
          tool: (metrics?.perCaseToolCalls ?? 0).toFixed(1),
        })
      : undefined;

  const items: Metric[] = [
    {
      key: 'steps',
      label: t('run.metrics.steps'),
      sub: callSplit,
      value: metrics?.perCaseSteps !== undefined ? metrics.perCaseSteps.toFixed(1) : '-',
    },
    {
      key: 'cost',
      label: t('run.metrics.cost'),
      sub:
        metrics?.perCaseCost !== undefined
          ? perCase(`$${formatCost(metrics.perCaseCost)}`, unit)
          : undefined,
      value: metrics?.totalCost !== undefined ? `$${formatCost(metrics.totalCost)}` : '-',
    },
    {
      key: 'tokens',
      label: t('run.metrics.tokens'),
      sub:
        metrics?.perCaseTokens !== undefined
          ? perCase(formatShortenNumber(Math.round(metrics.perCaseTokens)), unit)
          : undefined,
      value: metrics?.totalTokens !== undefined ? formatShortenNumber(metrics.totalTokens) : '-',
    },
    {
      key: 'duration',
      label: t('run.metrics.duration'),
      sub:
        metrics?.totalDuration !== undefined && totalCases > 0
          ? perCase(formatDuration(metrics.totalDuration / totalCases), unit)
          : undefined,
      value: metrics?.duration !== undefined ? formatDuration(metrics.duration) : '-',
    },
  ];

  return (
    <div {...stylex.props(styles.strip)}>
      <div {...stylex.props(styles.metric)}>
        <span {...stylex.props(styles.label)}>{t('run.metrics.passRate')}</span>
        <span {...stylex.props(styles.value)}>{hasPassRate ? `${passPct}%` : '-'}</span>
        {totalCases > 0 && (
          <span {...stylex.props(styles.sub)}>
            {passedCount}/{totalCases} {t('table.filter.passed')}
          </span>
        )}
        {hasPassRate && totalCases > 0 && (
          <div {...stylex.props(styles.progressTrack)}>
            <div {...sx(styles.progressFill, { width: `${passPct}%` })} />
          </div>
        )}
      </div>
      {items.map((item) => (
        <div key={item.key} {...stylex.props(styles.metric)}>
          <span {...stylex.props(styles.label)}>{item.label}</span>
          <span {...stylex.props(styles.value)}>{item.value}</span>
          {item.sub && <span {...stylex.props(styles.sub)}>{item.sub}</span>}
        </div>
      ))}
    </div>
  );
};

export default StatsCards;
