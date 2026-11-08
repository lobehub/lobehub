'use client';

import { cssVar as token } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const ROW_HEIGHT = 44;
const BAR_SIZE = 24;
const GRID_TICKS = [25, 50, 75];
/** Room right of the plot for the reach text that follows the longest bar. */
const REACH_TEXT_ROOM = 120;

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  // One grid for every row, so the label column is as wide as the longest
  // name (up to a cap), the ranked score sits right before its bar, and every
  // bar starts on the same axis.
  rows: {
    display: 'grid',
    gridTemplateColumns: 'fit-content(460px) max-content minmax(160px, 1fr)',
    minWidth: 0,
  },
  row: {
    display: 'grid',
    gridColumnStart: 1,
    gridColumnEnd: -1,
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    height: ROW_HEIGHT,
    minWidth: 0,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
  },
  clickable: { cursor: 'pointer' },
  label: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, paddingInlineEnd: 16 },
  rank: {
    flexShrink: 0,
    minWidth: 24,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.3,
    color: cssVar.colorTextQuaternary,
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },
  stack: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: 2,
    justifyContent: 'center',
    minWidth: 0,
  },
  name: {
    overflow: 'hidden',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.3,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  detail: {
    overflow: 'hidden',
    fontSize: 12,
    lineHeight: 1.3,
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  track: {
    position: 'relative',
    height: '100%',
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: cssVar.colorBorder,
  },
  // The bars' 0..100% span: the track less room for the text after the bar.
  plot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: REACH_TEXT_ROOM,
  },
  reachText: (left: string) => ({
    left: `calc(${left} + 8px)`,
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.3,
    color: cssVar.colorTextDescription,
    whiteSpace: 'nowrap',
  }),
  gridLine: (left: string) => ({
    left,
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 1,
    borderLeftStyle: 'dashed',
    borderLeftColor: cssVar.colorBorderSecondary,
  }),
  bar: (width: string, backgroundColor: string) => ({
    width,
    backgroundColor,
    position: 'absolute',
    top: '50%',
    left: 0,
    transform: 'translateY(-50%)',
    height: BAR_SIZE,
    maxWidth: '100%',
  }),
  reach: (left: string, width: string, backgroundColor: string) => ({
    left,
    width,
    backgroundColor,
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    height: BAR_SIZE,
    opacity: 0.28,
  }),
  score: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 48,
    paddingInlineEnd: 12,
  },
  scoreMain: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.3,
    color: cssVar.colorText,
  },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 16 },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  swatch: { width: 12, height: 12, backgroundColor: cssVar.colorTextTertiary },
  swatchReach: { opacity: 0.28 },
});

export interface RankingBarRow {
  /** Bar fill; the theme's primary color when the model's brand is unknown. */
  color?: string;
  detail?: string;
  icon?: ReactNode;
  key: string;
  name: string;
  rank: number;
  /** The ranked value, 0..1. */
  rate: number;
  /** Where the bar would reach on a looser reading (pass@k); drawn as a faint extension. */
  reach?: number;
  /** Short text for `reach`, right after the end of the bar. */
  reachText?: string;
}

interface RankingBarsProps {
  legendRate: string;
  legendReach: string;
  onSelect?: (row: RankingBarRow) => void;
  rows: RankingBarRow[];
}

const percent = (rate: number) => Math.max(0, Math.min(100, rate * 100));

/**
 * LobeBench's ranking anatomy (rank · icon · name and detail · ranked score ·
 * brand-colored bar · reach text), drawn here because the chart package's ranking chart cannot
 * add the pass@k reach: the solid bar is the ranked pass rate (every attempt
 * passed), the faint extension of the same bar shows how far the model got
 * when any attempt counts, so the gap between the two is its flakiness.
 */
const RankingBars = ({ legendRate, legendReach, onSelect, rows }: RankingBarsProps) => {
  const hasReach = rows.some((row) => row.reach !== undefined && row.reach > row.rate);
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.rows)} role={'list'}>
        {rows.map((row) => {
          const pct = percent(row.rate);
          const reachPct = row.reach === undefined ? pct : percent(row.reach);
          const fill = row.color ?? token.colorPrimary;
          return (
            <div
              aria-label={`#${row.rank} ${row.name}: ${Math.round(pct)}%`}
              key={row.key}
              role={'listitem'}
              onClick={onSelect ? () => onSelect(row) : undefined}
              {...stylex.props(styles.row, onSelect && styles.clickable)}
            >
              <div {...stylex.props(styles.label)}>
                <span {...stylex.props(styles.rank)}>#{row.rank}</span>
                {row.icon && <span {...stylex.props(styles.icon)}>{row.icon}</span>}
                <div {...stylex.props(styles.stack)}>
                  <div {...stylex.props(styles.name)}>{row.name}</div>
                  {row.detail && <div {...stylex.props(styles.detail)}>{row.detail}</div>}
                </div>
              </div>
              <div {...stylex.props(styles.score)}>
                <span {...stylex.props(styles.scoreMain)}>{Math.round(pct)}%</span>
              </div>
              <div {...stylex.props(styles.track)}>
                <div {...stylex.props(styles.plot)}>
                  {GRID_TICKS.map((tick) => (
                    <div aria-hidden key={tick} {...stylex.props(styles.gridLine(`${tick}%`))} />
                  ))}
                  {reachPct > pct && (
                    <div {...stylex.props(styles.reach(`${pct}%`, `${reachPct - pct}%`, fill))} />
                  )}
                  <div {...stylex.props(styles.bar(`${pct}%`, fill))} />
                  {row.reachText && (
                    <span {...stylex.props(styles.reachText(`${Math.max(pct, reachPct)}%`))}>
                      {row.reachText}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div {...stylex.props(styles.legend)}>
        <span {...stylex.props(styles.legendItem)}>
          <span {...stylex.props(styles.swatch)} />
          {legendRate}
        </span>
        {hasReach && (
          <span {...stylex.props(styles.legendItem)}>
            <span {...stylex.props(styles.swatch, styles.swatchReach)} />
            {legendReach}
          </span>
        )}
      </div>
    </div>
  );
};

export default RankingBars;
