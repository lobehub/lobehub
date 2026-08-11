'use client';

import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseMaturity } from '@/services/expertise';

interface MaturityBadgeProps {
  /** 已学到的规则数 —— 可信时用来和渐近线一起说人话。 */
  lessonCount: number;
  maturity: ExpertiseMaturity;
  size?: 'small' | 'large';
}

/**
 * 成熟度。
 *
 * 四种「没有百分比」的状态各说各的话，不合并成一个「暂无数据」：还在算、样本不够、
 * 拟合撞了 τ 的搜索上界、根本没练过 —— 对用户的含义完全不同。9 组回测里 6 组撞界，
 * 那时旧实现全都报成了正常百分比，用户看到的是编出来的数字。
 */
const MaturityBadge = memo<MaturityBadgeProps>(({ maturity, lessonCount, size = 'small' }) => {
  const { t } = useTranslation('selfLearning');

  if (!maturity.usable) {
    const title = {
      'low-confidence': t('maturity.lowConfidence'),
      'no-data': t('maturity.noData'),
      'pending': t('maturity.pending'),
      'tau-pinned': t('maturity.unbounded'),
    }[maturity.reason];
    const desc = {
      'low-confidence': t('maturity.lowConfidenceDesc', {
        kind: 'plateauKind' in maturity ? (maturity.plateauKind ?? '—') : '—',
      }),
      'no-data': t('maturity.noDataDesc'),
      'pending': t('maturity.pendingDesc'),
      'tau-pinned': t('maturity.unboundedDesc'),
    }[maturity.reason];

    return (
      <Tooltip title={desc}>
        <Flexbox gap={2}>
          <Text fontSize={size === 'large' ? 15 : 13} type={'secondary'}>
            {title}
          </Text>
          {size === 'large' && (
            <Text fontSize={12} type={'secondary'}>
              {desc}
            </Text>
          )}
        </Flexbox>
      </Tooltip>
    );
  }

  const pct = Math.round((maturity.maturity ?? 0) * 100);
  const ceiling = Math.round(maturity.pInf ?? 0);

  return (
    <Flexbox gap={2}>
      <Flexbox horizontal align={'baseline'} gap={6}>
        <Text fontSize={size === 'large' ? 28 : 18} weight={600}>
          {pct}%
        </Text>
        {maturity.speculative && (
          <Tooltip
            title={t('chart.speculative', { span: (maturity.observedSpan ?? 0).toFixed(2) })}
          >
            <Text fontSize={12} type={'secondary'}>
              {t('maturity.speculativeTag')}
            </Text>
          </Tooltip>
        )}
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('maturity.value', { ceiling, learned: lessonCount })}
      </Text>
    </Flexbox>
  );
});

MaturityBadge.displayName = 'MaturityBadge';

export default MaturityBadge;
