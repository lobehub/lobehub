import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { caseStrip, type ConditionColumn, type ReportCase } from '../data';

const styles = stylex.create({
  cell: { borderRadius: 2, height: 8, width: 8 },
  large: { borderRadius: 3, height: 18, width: 18 },
  largeStrip: { columnGap: 3, rowGap: 3 },
  strip: (rows: number, size: number) => ({
    columnGap: 2,
    display: 'inline-grid',
    gridAutoFlow: 'column',
    gridTemplateRows: `repeat(${rows}, ${size}px)`,
    rowGap: 2,
  }),
});

const tones = stylex.create({
  'difference': { backgroundColor: cssVar.colorError },
  'equal': { backgroundColor: cssVar.colorSuccess, opacity: 0.85 },
  'flagged-difference': { backgroundColor: cssVar.colorWarning },
  'unknown': { backgroundColor: cssVar.colorFillSecondary },
});

export const MatrixStrip = ({
  columns,
  entry,
  large,
}: {
  columns: ConditionColumn[];
  entry: ReportCase;
  large?: boolean;
}) => {
  const rows = new Set(columns.map((column) => column.theme)).size || 1;
  return (
    <span
      aria-label="条件矩阵"
      {...stylex.props(styles.strip(rows, large ? 18 : 8), large && styles.largeStrip)}
    >
      {caseStrip(entry, columns).map((cell) => (
        <i
          data-status={cell.status}
          key={cell.label}
          title={cell.label}
          {...stylex.props(styles.cell, large && styles.large, tones[cell.status])}
        />
      ))}
    </span>
  );
};
