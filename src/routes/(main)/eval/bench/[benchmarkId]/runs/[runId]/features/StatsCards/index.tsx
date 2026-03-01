'use client';

import type { EvalRunMetrics } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, Clock, DollarSign, Hash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '../../../../../../utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;
  `,
  label: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  subtitle: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  subtitleUnit: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    font-size: 24px;
    font-weight: bold;
  `,
  valueSuffix: css`
    font-size: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface StatsCardsProps {
  metrics?: EvalRunMetrics;
}

const StatsCards = memo<StatsCardsProps>(({ metrics }) => {
  const { t } = useTranslation('eval');

  const passedCount = metrics?.passedCases ?? 0;
  const totalCases = metrics?.totalCases ?? 0;

  const cards = [
    {
      bgColor: cssVar.colorSuccessBg,
      color: cssVar.colorSuccess,
      icon: CheckCircle2,
      label: t('run.metrics.passRate'),
      subtitle:
        totalCases > 0 ? (
          <>
            {passedCount}/{totalCases}{' '}
            <span className={styles.subtitleUnit}>{t('table.filter.passed')}</span>
          </>
        ) : undefined,
      value: metrics?.passRate !== undefined ? `${Math.round(metrics.passRate * 100)}%` : '-',
      valueSuffix: undefined,
    },
    {
      bgColor: cssVar.colorWarningBg,
      color: cssVar.colorWarning,
      icon: Clock,
      label: t('run.metrics.duration'),
      subtitle:
        metrics?.totalDuration !== undefined && totalCases > 0 ? (
          <>
            ~{formatDuration(metrics.totalDuration / totalCases)}{' '}
            <span className={styles.subtitleUnit}>{t('run.metrics.perCase')}</span>
          </>
        ) : undefined,
      value: metrics?.duration !== undefined ? formatDuration(metrics.duration) : '-',
    },
    {
      bgColor: cssVar.colorPrimaryBg,
      color: cssVar.colorPrimary,
      icon: DollarSign,
      label: t('run.metrics.cost'),
      subtitle:
        metrics?.perCaseCost !== undefined ? (
          <>
            ~${formatCost(metrics.perCaseCost)}{' '}
            <span className={styles.subtitleUnit}>{t('run.metrics.perCase')}</span>
          </>
        ) : undefined,
      value: metrics?.totalCost !== undefined ? `$${formatCost(metrics.totalCost)}` : '-',
    },
    {
      bgColor: cssVar.colorInfoBg,
      color: cssVar.colorInfo,
      icon: Hash,
      label: t('run.metrics.tokens'),
      subtitle:
        metrics?.perCaseTokens !== undefined ? (
          <>
            ~{formatShortenNumber(Math.round(metrics.perCaseTokens))}{' '}
            <span className={styles.subtitleUnit}>{t('run.metrics.perCase')}</span>
          </>
        ) : undefined,
      value: metrics?.totalTokens !== undefined ? formatShortenNumber(metrics.totalTokens) : '-',
    },
  ];

  return (
    <div className={styles.grid}>
      {cards.map((card) => (
        <Flexbox horizontal align="center" className={styles.card} gap={12} key={card.label}>
          <div className={styles.iconBox} style={{ background: card.bgColor }}>
            <Icon icon={card.icon} size={16} style={{ color: card.color }} />
          </div>
          <Flexbox gap={2}>
            <span className={styles.label}>{card.label}</span>
            <span className={styles.value}>
              {card.value}
              {card.valueSuffix && <span className={styles.valueSuffix}>{card.valueSuffix}</span>}
            </span>
            {card.subtitle && <span className={styles.subtitle}>{card.subtitle}</span>}
          </Flexbox>
        </Flexbox>
      ))}
    </div>
  );
});

export default StatsCards;
