'use client';

import { ComposedChart } from '@lobehub/charts';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail, ExpertiseMaturity } from '@/services/expertise';

import { projectCurve, runsToNinety } from './hooks';

const COLORS = ['#91caff', '#1677ff', '#9254de'];

interface LearningCurveProps {
  maturity: ExpertiseMaturity;
  series: ExpertiseDomainDetail['series'];
}

/**
 * 学习曲线 —— 柱是「这一轮新学到几条」，线是累计，虚线段是外推。
 *
 * 外推只在拟合可信时画。撞了搜索上界的 τ 会画出一条几乎笔直的「永远学不完」，
 * 那是边界伪影不是事实；宁可不画。
 */
const LearningCurve = memo<LearningCurveProps>(({ series, maturity }) => {
  const { t } = useTranslation('selfLearning');

  const { data, reachAt } = useMemo(() => {
    const newKey = t('chart.newRules');
    const cumKey = t('chart.actual');
    const projKey = t('chart.projection');

    const observed = series.map((s, i) => ({
      [cumKey]: s.activeCount,
      [newKey]: s.activeCount - (series[i - 1]?.activeCount ?? 0),
      label: `#${s.runIndex}`,
      runIndex: s.runIndex,
    }));

    if (!maturity.usable || !maturity.pInf || !maturity.tau) {
      return { data: observed, reachAt: undefined };
    }

    const n90 = runsToNinety(maturity.tau);
    const lastRun = series.at(-1)?.runIndex ?? 0;
    // 曲线画到 90% 那一点，让「还要练多少次」在图上是一段可见的距离而不是一个数字
    const horizon = Math.max(lastRun, n90);
    const projected = projectCurve(maturity.pInf, maturity.tau, horizon);
    const byRun = new Map(observed.map((o) => [o.runIndex, o]));

    return {
      data: projected.map((p) => ({
        ...(byRun.get(p.n) ?? { label: `#${p.n}`, runIndex: p.n }),
        [projKey]: Number(p.value.toFixed(1)),
      })),
      reachAt: n90,
    };
  }, [series, maturity, t]);

  const seriesDef = useMemo(() => {
    const defs: { color: string; key: string; type: 'bar' | 'line' }[] = [
      { color: COLORS[0], key: t('chart.newRules'), type: 'bar' },
      { color: COLORS[1], key: t('chart.actual'), type: 'line' },
    ];
    if (reachAt) defs.push({ color: COLORS[2], key: t('chart.projection'), type: 'line' });
    return defs;
  }, [reachAt, t]);

  const lastRun = series.at(-1)?.runIndex ?? 0;

  return (
    <Block gap={12} padding={20} variant={'outlined'}>
      <Flexbox gap={2}>
        <Text weight={600}>{t('chart.title')}</Text>
        <Text fontSize={12} type={'secondary'}>
          {maturity.usable && reachAt
            ? maturity.speculative
              ? t('chart.speculative', { span: (maturity.observedSpan ?? 0).toFixed(2) })
              : t('chart.trustworthy', {
                  remaining: Math.max(0, reachAt - lastRun),
                  run: reachAt,
                  span: (maturity.observedSpan ?? 0).toFixed(1),
                })
            : t('chart.bars')}
        </Text>
      </Flexbox>
      <ComposedChart data={data} height={280} index={'label'} series={seriesDef} />
    </Block>
  );
});

LearningCurve.displayName = 'LearningCurve';

export default LearningCurve;
