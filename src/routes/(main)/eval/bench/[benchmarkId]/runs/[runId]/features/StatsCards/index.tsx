'use client';

import type { EvalRunMetrics } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, Clock, DollarSign, Hash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '../../../../../../utils';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  grid: css`
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  `,
  // Pass rate hero — the run's headline outcome, given the most visual weight.
  hero: css`
    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  heroValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading1};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: 999px;

    background: ${cssVar.colorSuccess};

    transition: width 0.3s ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  progressTrack: css`
    overflow: hidden;

    width: 100%;
    height: 8px;
    border-radius: 999px;

    background: ${cssVar.colorFillSecondary};
  `,
  subtitle: css`
    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
  `,
  subtitleUnit: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading3};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface StatsCardsProps {
  metrics?: EvalRunMetrics;
}

const StatsCards = memo<StatsCardsProps>(({ metrics }) => {
  const { t } = useTranslation('eval');

  const passedCount = metrics?.passedCases ?? 0;
  const totalCases = metrics?.totalCases ?? 0;
  const hasPassRate = metrics?.passRate !== undefined;
  const passPct = hasPassRate ? Math.round((metrics?.passRate ?? 0) * 100) : 0;

  const cards = [
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
    <Flexbox gap={16}>
      {/* Pass rate hero */}
      <Flexbox className={styles.hero} gap={16}>
        <Flexbox horizontal align={'flex-end'} gap={16} justify={'space-between'}>
          <Flexbox gap={6}>
            <Flexbox horizontal align={'center'} gap={8}>
              <div className={styles.iconBox} style={{ background: cssVar.colorSuccessBg }}>
                <Icon icon={CheckCircle2} size={16} style={{ color: cssVar.colorSuccess }} />
              </div>
              <span className={styles.label}>{t('run.metrics.passRate')}</span>
            </Flexbox>
            <span className={styles.heroValue}>{hasPassRate ? `${passPct}%` : '-'}</span>
          </Flexbox>
          {totalCases > 0 && (
            <Text className={styles.subtitle}>
              {passedCount}/{totalCases}{' '}
              <span className={styles.subtitleUnit}>{t('table.filter.passed')}</span>
            </Text>
          )}
        </Flexbox>
        {hasPassRate && totalCases > 0 && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${passPct}%` }} />
          </div>
        )}
      </Flexbox>

      {/* Secondary metrics */}
      <div className={styles.grid}>
        {cards.map((card) => (
          <Flexbox horizontal align={'center'} className={styles.card} gap={12} key={card.label}>
            <div className={styles.iconBox} style={{ background: card.bgColor }}>
              <Icon icon={card.icon} size={16} style={{ color: card.color }} />
            </div>
            <Flexbox gap={2}>
              <span className={styles.label}>{card.label}</span>
              <span className={styles.value}>{card.value}</span>
              {card.subtitle && <span className={styles.subtitle}>{card.subtitle}</span>}
            </Flexbox>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
});

export default StatsCards;
