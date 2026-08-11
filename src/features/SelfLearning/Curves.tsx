'use client';

import { useTheme } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

const W = 860;
const H = 210;
const PL = 34;
const PB = 22;
/** 右侧留给线尾标签的空间 —— 标签压在图上就没人看得清哪条是哪条。 */
const PR = 60;

interface CurvesProps {
  colors: Record<string, string>;
  domains: ExpertiseDomainItem[];
  /** 上色并带标签的那几条；其余淡成背景。 */
  focusIds: string[];
  hoverId?: string;
  onHover: (id?: string) => void;
  onOpen: (id: string) => void;
}

/**
 * 所有专长的累计曲线叠在一张图上。
 *
 * **纵轴是成熟度比例，不是条数** —— 学到 3 条的领域和学到 34 条的领域在条数坐标里
 * 差一个量级，叠在一起只能看见一条线。归一化之后，形状本身就是结论：压平了 = 学完了，
 * 还在陡 = 在长，掉头 = 能力在退，贴着底 = 练了没学到。
 *
 * 拟合不可信的专长没有 pInf，用它自己的最大值归一 —— 形状仍然成立，只是纵轴读数
 * 不该被当成成熟度，所以那几条不进 focus、不带标签。
 */
const Curves = memo<CurvesProps>(({ domains, focusIds, colors, hoverId, onHover, onOpen }) => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();

  const { maxRun, paths } = useMemo(() => {
    const runs = Math.max(1, ...domains.map((d) => d.runCount));
    const items = domains
      .filter((d) => d.series.length > 1)
      .map((d) => {
        const ceiling = d.maturity.usable
          ? (d.maturity.pInf ?? 0)
          : Math.max(...d.series.map((p) => p.n));
        const scale = ceiling > 0 ? ceiling : 1;
        const pts = d.series.map((p) => ({
          x: PL + (p.run / runs) * (W - PL - PR),
          y: H - PB - (p.n / scale) * (H - PB - 14),
        }));
        return {
          d: pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' '),
          end: pts.at(-1)!,
          id: d.id,
          title: d.title,
        };
      });
    return { maxRun: runs, paths: items };
  }, [domains]);

  const focus = paths.filter((p) => focusIds.includes(p.id));
  const rest = paths.filter((p) => !focusIds.includes(p.id));

  return (
    <svg height={H} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${W} ${H}`}>
      {[0, 25, 50, 75, 100].map((v) => {
        const y = H - PB - (v / 100) * (H - PB - 14);
        return (
          <g key={v}>
            <line
              pointerEvents={'none'}
              stroke={theme.colorBorderSecondary}
              strokeDasharray={v === 0 || v === 100 ? '' : '3 4'}
              x1={PL}
              x2={W - PR + 4}
              y1={y}
              y2={y}
            />
            <text
              fill={theme.colorTextQuaternary}
              fontSize={10}
              pointerEvents={'none'}
              x={0}
              y={y + 3}
            >
              {v}%
            </text>
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => {
        const run = Math.round(maxRun * r);
        return (
          <text
            fill={theme.colorTextQuaternary}
            fontSize={10}
            key={r}
            pointerEvents={'none'}
            textAnchor={'middle'}
            x={PL + r * (W - PL - PR)}
            y={H - 6}
          >
            {run <= 1 ? t('detail.chart.firstRun') : t('detail.chart.nthRun', { n: run })}
          </text>
        );
      })}

      {rest.map((p) => (
        <path
          d={p.d}
          fill={'none'}
          key={p.id}
          opacity={hoverId && hoverId !== p.id ? 0.12 : 0.28}
          stroke={theme.colorTextQuaternary}
          strokeWidth={hoverId === p.id ? 2.5 : 1.5}
          style={{ cursor: 'pointer' }}
          onClick={() => onOpen(p.id)}
          onMouseEnter={() => onHover(p.id)}
          onMouseLeave={() => onHover(undefined)}
        />
      ))}
      {focus.map((p) => (
        <g key={p.id}>
          <path
            d={p.d}
            fill={'none'}
            opacity={hoverId && hoverId !== p.id ? 0.25 : 1}
            stroke={colors[p.id]}
            strokeLinecap={'round'}
            strokeWidth={hoverId === p.id ? 3.2 : 2.2}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpen(p.id)}
            onMouseEnter={() => onHover(p.id)}
            onMouseLeave={() => onHover(undefined)}
          />
          <circle cx={p.end.x} cy={p.end.y} fill={colors[p.id]} pointerEvents={'none'} r={3.4} />
          <text
            fill={hoverId && hoverId !== p.id ? theme.colorTextQuaternary : theme.colorText}
            fontSize={11}
            fontWeight={600}
            pointerEvents={'none'}
            x={p.end.x + 7}
            y={p.end.y + 4}
          >
            {p.title}
          </text>
        </g>
      ))}
    </svg>
  );
});

Curves.displayName = 'Curves';

export default Curves;
