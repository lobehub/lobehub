'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

import { earlyPassRate, passRateSeries, recentPassRate, zeroViolationStreak } from '../helpers';

const styles = createStaticStyles(({ css }) => ({
  chart: css`
    flex: 1;
    min-width: 0;

    .axis {
      font-size: 10px;
      fill: ${cssVar.colorTextQuaternary};
    }

    .grid {
      stroke: ${cssVar.colorBorderSecondary};
    }

    .line {
      fill: none;
      stroke: ${cssVar.colorSuccess};
      stroke-width: 1.75;
    }

    .area {
      fill: ${cssVar.colorSuccess};
      fill-opacity: 0.08;
    }

    .pt {
      fill: ${cssVar.colorSuccess};
    }

    .ref {
      stroke: ${cssVar.colorSuccess};
      stroke-dasharray: 3 3;
      stroke-opacity: 0.45;
    }

    .refLabel {
      font-size: 10px;
      fill: ${cssVar.colorSuccess};
    }
  `,
}));

const W = 380;
const H = 96;
const L = 6;
const R = 44;
const T = 10;
const B = 16;

interface GrowthChartsProps {
  domains: ExpertiseDomainItem[];
}

/**
 * 两块默认展示的成长曲线：累计学到（它懂了多少）+ 做对率（它可靠了没）。
 * 两条都往上走 —— 「学得多了、做得对了」同向，一眼读出「在变成专家」。
 * 多个方向时按实践序号对齐求和 / 求均。
 */
const GrowthCharts = memo<GrowthChartsProps>(({ domains }) => {
  const { t } = useTranslation('selfLearning');

  const { cum, rate, streak, runs } = useMemo(() => {
    if (domains.length === 1) {
      const d = domains[0];
      return {
        cum: d.series.map((p) => ({ n: p.n, run: p.run })),
        rate: passRateSeries(d.reliability),
        runs: d.runCount,
        streak: zeroViolationStreak(d.reliability),
      };
    }
    // Multi-domain: sum learned per run index across domains, average pass rate per run index.
    const maxRun = Math.max(0, ...domains.map((d) => d.runCount));
    const cumArr: { n: number; run: number }[] = [];
    const rateArr: { rate: number; run: number }[] = [];
    for (let run = 1; run <= maxRun; run++) {
      let n = 0;
      let pass = 0;
      let violation = 0;
      for (const d of domains) {
        const last = [...d.series].reverse().find((p) => p.run <= run);
        n += last?.n ?? 0;
        const rel = d.reliability.find((r) => r.run === run);
        if (rel) {
          pass += rel.pass;
          violation += rel.violation;
        }
      }
      cumArr.push({ n, run });
      if (pass + violation > 0) rateArr.push({ rate: pass / (pass + violation), run });
    }
    const merged = Array.from({ length: maxRun }, (_, i) => {
      let pass = 0;
      let violation = 0;
      for (const d of domains) {
        const rel = d.reliability.find((r) => r.run === i + 1);
        if (rel) {
          pass += rel.pass;
          violation += rel.violation;
        }
      }
      return { pass, run: i + 1, violation };
    });
    return { cum: cumArr, rate: rateArr, runs: maxRun, streak: zeroViolationStreak(merged) };
  }, [domains]);

  if (cum.length < 2) {
    return (
      <Text fontSize={12.5} type={'secondary'}>
        {t('charts.tooFew')}
      </Text>
    );
  }

  const n = cum.length;
  const x = (i: number, len: number) => L + (len === 1 ? 0 : (i / (len - 1)) * (W - L - R));
  const cmax = Math.max(1, ...cum.map((p) => p.n));
  const yc = (v: number) => T + (1 - v / cmax) * (H - T - B);
  const yr = (v: number) => T + (1 - v) * (H - T - B);
  const recent = recentPassRate(rate);
  const early = earlyPassRate(rate);
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

  return (
    <Block padding={'12px 14px'} variant={'outlined'}>
      <Flexbox horizontal gap={24}>
        <Flexbox className={styles.chart} gap={4}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text fontSize={12} type={'secondary'}>
              {t('charts.learned')}
            </Text>
            <Text fontSize={18} weight={700}>
              {t('charts.count', { count: cum.at(-1)!.n })}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('charts.learnedSub', { runs })}
            </Text>
          </Flexbox>
          <svg height={H} viewBox={`0 0 ${W} ${H}`} width={'100%'}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line className={'grid'} x1={L} x2={W - R} y1={yc(cmax * f)} y2={yc(cmax * f)} />
                <text className={'axis'} x={W - R + 4} y={yc(cmax * f) + 3}>
                  {Math.round(cmax * f)}
                </text>
              </g>
            ))}
            <polygon
              className={'area'}
              points={`${x(0, n)},${yc(0)} ${cum.map((p, i) => `${x(i, n)},${yc(p.n)}`).join(' ')} ${x(n - 1, n)},${yc(0)}`}
            />
            <polyline
              className={'line'}
              points={cum.map((p, i) => `${x(i, n)},${yc(p.n)}`).join(' ')}
            />
            <circle className={'pt'} cx={x(n - 1, n)} cy={yc(cum.at(-1)!.n)} r={2.5} />
            <text className={'axis'} x={L} y={H - 3}>
              {t('charts.run1')}
            </text>
            <text className={'axis'} textAnchor={'end'} x={W - R} y={H - 3}>
              {t('charts.runN', { n: cum.at(-1)!.run })}
            </text>
          </svg>
        </Flexbox>

        <Flexbox className={styles.chart} gap={4}>
          <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
            <Text fontSize={12} type={'secondary'}>
              {t('charts.passRate')}
            </Text>
            <Text fontSize={18} weight={700}>
              {pct(recent)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {streak >= 2
                ? t('charts.streak', { count: streak })
                : t('charts.recentAvg', { count: Math.min(4, rate.length) })}
              {early !== null && rate.length > 4
                ? ` · ${t('charts.early', { rate: Math.round(early * 100) })}`
                : ''}
            </Text>
          </Flexbox>
          <svg height={H} viewBox={`0 0 ${W} ${H}`} width={'100%'}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line className={'grid'} x1={L} x2={W - R} y1={yr(f)} y2={yr(f)} />
                <text className={'axis'} x={W - R + 4} y={yr(f) + 3}>
                  {Math.round(f * 100)}%
                </text>
              </g>
            ))}
            <line className={'ref'} x1={L} x2={W - R} y1={yr(0.9)} y2={yr(0.9)} />
            <text className={'refLabel'} x={L + 2} y={yr(0.9) - 3}>
              {t('charts.refLine')}
            </text>
            {rate.length > 0 && (
              <>
                <polygon
                  className={'area'}
                  points={`${x(0, rate.length)},${yr(0)} ${rate.map((p, i) => `${x(i, rate.length)},${yr(p.rate)}`).join(' ')} ${x(rate.length - 1, rate.length)},${yr(0)}`}
                />
                <polyline
                  className={'line'}
                  points={rate.map((p, i) => `${x(i, rate.length)},${yr(p.rate)}`).join(' ')}
                />
                <circle
                  className={'pt'}
                  cx={x(rate.length - 1, rate.length)}
                  cy={yr(rate.at(-1)!.rate)}
                  r={2.5}
                />
              </>
            )}
            <text className={'axis'} x={L} y={H - 3}>
              {t('charts.run1')}
            </text>
            <text className={'axis'} textAnchor={'end'} x={W - R} y={H - 3}>
              {t('charts.runN', { n: cum.at(-1)!.run })}
            </text>
          </svg>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

GrowthCharts.displayName = 'ExpertiseGrowthCharts';

export default GrowthCharts;
