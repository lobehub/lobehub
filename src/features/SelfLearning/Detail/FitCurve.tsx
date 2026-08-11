'use client';

import { useTheme } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail, ExpertiseMaturity } from '@/services/expertise';

import { projectSeries, runsToRatio } from '../hooks';

const W = 900;
const H = 320;
const PL = 44;
const PB = 34;
const PT = 14;
/** 右侧留给「N 条」那一列刻度。 */
const PR = 84;

interface FitCurveProps {
  maturity: ExpertiseMaturity;
  runCount: number;
  series: ExpertiseDomainDetail['series'];
}

/**
 * 累计学到的经验，纵轴同时标成熟度百分比与条数。
 *
 * 外推只在拟合可信时画，且**永远是虚线** —— 实线段是观测，虚线段是模型，两者在
 * 视觉上必须能一眼分开。撞了 τ 上界的拟合一条虚线都不画：那条线会画出一个
 * 「永远学不完」的斜坡，那是搜索边界的伪影，不是这个 agent 的事实。
 */
const FitCurve = memo<FitCurveProps>(({ series, maturity, runCount }) => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();

  const geom = useMemo(() => {
    const usable = maturity.usable && !!maturity.pInf && !!maturity.tau;
    const pInf = usable ? maturity.pInf! : Math.max(1, ...series.map((s) => s.activeCount));
    const tau = usable ? maturity.tau! : 0;
    const n90 = usable ? runsToRatio(tau, 0.9) : runCount;
    const xMax = usable ? Math.max(runCount, Math.round(n90 * 1.12)) : Math.max(1, runCount);

    const x = (i: number) => PL + ((i - 1) / Math.max(1, xMax - 1)) * (W - PL - PR);
    const y = (n: number) => H - PB - (n / pInf) * (H - PB - PT);

    const actual = series
      .map(
        (s, k) =>
          `${k === 0 ? 'M' : 'L'}${x(s.runIndex).toFixed(1)},${y(s.activeCount).toFixed(1)}`,
      )
      .join(' ');

    const last = series.at(-1);
    const future =
      usable && last
        ? projectSeries(pInf, tau, last.runIndex, last.activeCount, xMax)
            .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.run).toFixed(1)},${y(p.n).toFixed(1)}`)
            .join(' ')
        : '';

    // 每次新增的柱：相邻快照的差；有人在对话里的那几次单独着色
    const bars = series.map((s, k) => ({
      gain: s.activeCount - (series[k - 1]?.activeCount ?? 0),
      human: s.hadHumanInLoop,
      run: s.runIndex,
    }));
    const maxGain = Math.max(1, ...bars.map((b) => b.gain));

    return { actual, bars, future, last, maxGain, n90, pInf, usable, x, xMax, y };
  }, [series, maturity, runCount]);

  const { x, y, pInf, xMax, usable, n90, last } = geom;
  const ticks = [1, Math.round(xMax * 0.33), Math.round(xMax * 0.66), xMax].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <svg height={H} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${W} ${H}`}>
      {[0, 25, 50, 75, 90, 100].map((p) => {
        const yy = H - PB - (p / 100) * (H - PB - PT);
        return (
          <g key={p}>
            <line
              strokeDasharray={p === 0 || p === 100 ? '' : '3 4'}
              x1={PL}
              x2={W - PR + 6}
              y1={yy}
              y2={yy}
              stroke={
                p === 90
                  ? theme.colorSuccessBorder
                  : p === 0 || p === 100
                    ? theme.colorTextQuaternary
                    : theme.colorBorderSecondary
              }
            />
            <text fill={theme.colorTextQuaternary} fontSize={10} x={4} y={yy + 3}>
              {p}%
            </text>
            <text fill={theme.colorTextQuaternary} fontSize={10} x={W - PR + 12} y={yy + 3}>
              {t('detail.chart.count', { count: Math.round((p / 100) * pInf) })}
            </text>
          </g>
        );
      })}
      {ticks.map((i) => (
        <text
          fill={theme.colorTextQuaternary}
          fontSize={10}
          key={i}
          textAnchor={'middle'}
          x={x(i)}
          y={H - 16}
        >
          {i <= 1 ? t('detail.chart.firstRun') : t('detail.chart.nthRun', { n: i })}
        </text>
      ))}

      {geom.bars.map((b) =>
        b.gain <= 0 ? null : (
          <rect
            fill={b.human ? theme.colorInfoBorder : theme.colorFillSecondary}
            height={(b.gain / geom.maxGain) * 46}
            key={b.run}
            rx={1.5}
            width={Math.max(3, (W - PL - PR) / xMax - 1)}
            x={x(b.run) - 2}
            y={H - PB - (b.gain / geom.maxGain) * 46}
          />
        ),
      )}

      {usable && geom.future && (
        <path
          d={geom.future}
          fill={'none'}
          opacity={maturity.usable && maturity.speculative ? 0.35 : 0.6}
          stroke={theme.colorSuccess}
          strokeDasharray={'7 5'}
          strokeWidth={2.2}
        />
      )}

      <path
        d={geom.actual}
        fill={'none'}
        stroke={theme.colorSuccess}
        strokeLinecap={'round'}
        strokeWidth={2.8}
      />
      {last && (
        <circle cx={x(last.runIndex)} cy={y(last.activeCount)} fill={theme.colorSuccess} r={4.5} />
      )}

      {last && (
        <>
          <line
            stroke={theme.colorBorder}
            strokeDasharray={'2 3'}
            x1={x(last.runIndex)}
            x2={x(last.runIndex)}
            y1={PT}
            y2={H - PB}
          />
          <text
            fill={theme.colorText}
            fontSize={10.5}
            fontWeight={600}
            textAnchor={'middle'}
            x={x(last.runIndex)}
            y={PT - 2}
          >
            {t('detail.chart.today', { count: runCount })}
          </text>
        </>
      )}

      {usable && n90 > (last?.runIndex ?? 0) && (
        <g>
          <circle
            cx={x(n90)}
            cy={y(pInf * 0.9)}
            fill={'none'}
            r={5}
            stroke={theme.colorSuccess}
            strokeDasharray={'2 2'}
            strokeWidth={1.6}
          />
          <text
            fill={theme.colorText}
            fontSize={10.5}
            fontWeight={600}
            textAnchor={'end'}
            x={x(n90) - 11}
            y={y(pInf * 0.9) - 16}
          >
            {t('detail.chart.reach90', { run: n90 })}
          </text>
          <text
            fill={theme.colorTextTertiary}
            fontSize={10}
            textAnchor={'end'}
            x={x(n90) - 11}
            y={y(pInf * 0.9) - 4}
          >
            {t('detail.chart.remaining', { count: n90 - (last?.runIndex ?? 0) })}
          </text>
        </g>
      )}
    </svg>
  );
});

FitCurve.displayName = 'FitCurve';

export default FitCurve;
