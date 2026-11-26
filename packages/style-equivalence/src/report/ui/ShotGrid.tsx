import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { TriangleAlert } from 'lucide-react';

import { REVEAL_COLORS } from '../../server/reveal';
import { cropShotUrl, type ReviewView } from '../api';
import type { reviewGrid } from '../review';
import { cellVerdict, shotNotes } from '../review';

const styles = stylex.create({
  cell: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    rowGap: 8,
  },
  checker: (dark: string, light: string) => ({
    backgroundImage: `repeating-conic-gradient(${dark} 0 25%, ${light} 0 50%)`,
    backgroundSize: '6px 6px',
    borderRadius: 2,
    height: 12,
    width: 12,
  }),
  colHead: { paddingInlineStart: 4 },
  dash: (color: string) => ({
    borderColor: color,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 10,
    width: 14,
  }),
  diff: {
    borderColor: cssVar.colorError,
    boxShadow: `0 0 0 3px ${cssVar.colorErrorBg}`,
  },
  grid: { alignItems: 'stretch', columnGap: 16, display: 'grid', rowGap: 12 },
  gridColumns: (count: number) => ({
    gridTemplateColumns: `96px repeat(${count}, minmax(0, 1fr))`,
  }),
  pair: { columnGap: 8, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  rowHead: { alignSelf: 'center', overflowWrap: 'anywhere' },
  shot: {
    backgroundColor: cssVar.colorBgLayout,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    display: 'block',
    height: 128,
    imageRendering: 'pixelated',
    objectFit: 'contain',
    width: '100%',
  },
  side: { minWidth: 0 },
  standIn: {
    backgroundColor: cssVar.colorWarningBg,
    borderColor: cssVar.colorWarningBorder,
    borderRadius: cssVar.borderRadiusSM,
    borderStyle: 'solid',
    borderWidth: 1,
    fontWeight: 500,
    paddingBlock: 2,
    paddingInline: 6,
  },
  warnIcon: { marginInlineEnd: 4, verticalAlign: '-2px' },
});

type Grid = ReturnType<typeof reviewGrid>;

const SIDE_LABELS = { base: '改之前', head: '改之后' } as const;

const sidesOf = (item: ReviewView) => {
  const unpaired = /\|unpaired:(base|head):/.exec(item.key)?.[1] as 'base' | 'head' | undefined;
  return unpaired && !item.styles.counterpart ? [unpaired] : (['base', 'head'] as const);
};

export const Pair = ({
  combo,
  condition,
  item,
}: {
  combo: number;
  condition: string;
  item: ReviewView;
}) => (
  <div {...stylex.props(styles.pair)}>
    {sidesOf(item).map((side) => {
      const notes = shotNotes(item, side);
      return (
        <Flexbox gap={4} key={side} {...stylex.props(styles.side)}>
          <Text fontSize={12} type="secondary">
            {item.styles.counterpart === side
              ? `${SIDE_LABELS[side]}：同一位置的元素，没有样式类`
              : SIDE_LABELS[side]}
          </Text>
          {notes.map((note) => (
            <Text fontSize={12} key={note} type="warning" {...stylex.props(styles.standIn)}>
              <TriangleAlert size={12} {...stylex.props(styles.warnIcon)} />
              {note}
            </Text>
          ))}
          <img
            alt={`${SIDE_LABELS[side]} ${item.title}`}
            loading="lazy"
            src={cropShotUrl(item.key, side, condition, combo)}
            {...stylex.props(styles.shot)}
          />
        </Flexbox>
      );
    })}
  </div>
);

export const CellVerdict = ({
  cell,
  counterpart,
  itemKey,
}: {
  cell: { differs: boolean; summary: string[] };
  counterpart?: 'base' | 'head';
  itemKey: string;
}) => {
  const verdict = cellVerdict(itemKey, cell, counterpart);
  const type =
    verdict.tone === 'ok' ? 'success' : verdict.tone === 'error' ? 'danger' : 'secondary';
  return (
    <Text fontSize={12} type={type}>
      {verdict.text}
    </Text>
  );
};

export const ShotGrid = ({
  columns,
  item,
  rows,
}: {
  columns: Grid['columns'];
  item: ReviewView;
  rows: Grid['rows'];
}) => (
  <div {...stylex.props(styles.grid, styles.gridColumns(columns.length))}>
    <div />
    {columns.map((column) => (
      <Text fontSize={12} key={column.label} type="secondary" {...stylex.props(styles.colHead)}>
        {column.title}
      </Text>
    ))}
    {rows.map((row) => [
      <Text
        fontSize={12}
        key={`${row.index}-head`}
        type="secondary"
        {...stylex.props(styles.rowHead)}
      >
        {row.label}
      </Text>,
      ...row.cells.map((cell) => (
        <div
          data-differs={cell.differs || undefined}
          key={`${row.index}-${cell.condition}`}
          {...stylex.props(styles.cell, cell.differs && styles.diff)}
        >
          <Pair combo={cell.combo} condition={cell.condition} item={item} />
          <CellVerdict cell={cell} counterpart={item.styles.counterpart} itemKey={item.key} />
        </div>
      )),
    ])}
  </div>
);

export const Legend = () => (
  <Flexbox horizontal align="center" gap={16} wrap="wrap">
    <Flexbox horizontal align="center" gap={6}>
      <span {...stylex.props(styles.checker(...REVEAL_COLORS.checker))} />
      <Text fontSize={12} type="secondary">
        棋盘格：透明，没有背景
      </Text>
    </Flexbox>
    <Flexbox horizontal align="center" gap={6}>
      <span {...stylex.props(styles.dash(REVEAL_COLORS.element))} />
      <Text fontSize={12} type="secondary">
        粉色虚线：这个元素的边界
      </Text>
    </Flexbox>
    <Flexbox horizontal align="center" gap={6}>
      <span {...stylex.props(styles.dash(REVEAL_COLORS.pseudo))} />
      <Text fontSize={12} type="secondary">
        蓝色虚线：::before / ::after
      </Text>
    </Flexbox>
  </Flexbox>
);
