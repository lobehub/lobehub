'use client';

import type { EvalRunMetrics } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, Clock, DollarSign, Hash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '../../../../../../utils';

const styles = stylex.create({
  card: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  hero: {
    padding: '20px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  heroValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading1,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: cssVar.borderRadius,
  },
  label: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextTertiary },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
    transition: { 'default': 'width 0.3s ease', '@media (prefers-reduced-motion: reduce)': 'none' },
  },
  progressTrack: {
    overflow: 'hidden',
    width: '100%',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  subtitle: { fontSize: cssVar.fontSize, color: cssVar.colorTextSecondary },
  subtitleUnit: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextTertiary },
  value: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    color: cssVar.colorText,
  },
});

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
            <span {...stylex.props(styles.subtitleUnit)}>{t('run.metrics.perCase')}</span>
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
            <span {...stylex.props(styles.subtitleUnit)}>{t('run.metrics.perCase')}</span>
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
            <span {...stylex.props(styles.subtitleUnit)}>{t('run.metrics.perCase')}</span>
          </>
        ) : undefined,
      value: metrics?.totalTokens !== undefined ? formatShortenNumber(metrics.totalTokens) : '-',
    },
  ];

  return (
    <Flexbox gap={16}>
      {/* Pass rate hero */}
      <Flexbox className={stylex.props(styles.hero).className} gap={16}>
        <Flexbox horizontal align={'flex-end'} gap={16} justify={'space-between'}>
          <Flexbox gap={6}>
            <Flexbox horizontal align={'center'} gap={8}>
              <div
                className={stylex.props(styles.iconBox).className}
                style={{ background: cssVar.colorSuccessBg }}
              >
                <Icon icon={CheckCircle2} size={16} style={{ color: cssVar.colorSuccess }} />
              </div>
              <span {...stylex.props(styles.label)}>{t('run.metrics.passRate')}</span>
            </Flexbox>
            <span {...stylex.props(styles.heroValue)}>{hasPassRate ? `${passPct}%` : '-'}</span>
          </Flexbox>
          {totalCases > 0 && (
            <Text className={stylex.props(styles.subtitle).className}>
              {passedCount}/{totalCases}{' '}
              <span {...stylex.props(styles.subtitleUnit)}>{t('table.filter.passed')}</span>
            </Text>
          )}
        </Flexbox>
        {hasPassRate && totalCases > 0 && (
          <div {...stylex.props(styles.progressTrack)}>
            <div
              className={stylex.props(styles.progressFill).className}
              style={{ width: `${passPct}%` }}
            />
          </div>
        )}
      </Flexbox>

      {/* Secondary metrics */}
      <div {...stylex.props(styles.grid)}>
        {cards.map((card) => (
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.card).className}
            gap={12}
            key={card.label}
          >
            <div
              className={stylex.props(styles.iconBox).className}
              style={{ background: card.bgColor }}
            >
              <Icon icon={card.icon} size={16} style={{ color: card.color }} />
            </div>
            <Flexbox gap={2}>
              <span {...stylex.props(styles.label)}>{card.label}</span>
              <span {...stylex.props(styles.value)}>{card.value}</span>
              {card.subtitle && <span {...stylex.props(styles.subtitle)}>{card.subtitle}</span>}
            </Flexbox>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
});

export default StatsCards;
