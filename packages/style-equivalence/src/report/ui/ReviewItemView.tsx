import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { REVEAL_COLORS } from '../../server/reveal';
import { cropShotUrl, type ReviewView } from '../api';
import { cellVerdict, reviewGrid } from '../review';
import { StyleDetails } from './StyleDetails';

const styles = stylex.create({
  agent: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 1.7,
    maxWidth: 760,
    padding: 16,
  },
  agentTag: { fontSize: 12, fontWeight: 600, marginInlineEnd: 8 },
  ask: {
    color: cssVar.colorTextSecondary,
    fontSize: 14,
    lineHeight: 1.6,
    marginBlockStart: '8px',
    marginBlockEnd: '20px',
    maxWidth: 760,
  },
  cell: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 12,
  },
  colHead: { color: cssVar.colorTextTertiary, fontSize: 12, paddingInlineStart: 4 },
  diff: { borderColor: cssVar.colorError, boxShadow: `0 0 0 3px ${cssVar.colorErrorBg}` },
  error: { color: cssVar.colorError },
  neutral: { color: cssVar.colorTextSecondary },
  grid: {
    alignItems: 'stretch',
    columnGap: 16,
    display: 'grid',
    marginBlockStart: 20,
    rowGap: 12,
  },
  checker: (dark: string, light: string) => ({
    backgroundImage: `repeating-conic-gradient(${dark} 0 25%, ${light} 0 50%)`,
    backgroundSize: '6px 6px',
    borderRadius: 2,
    height: 12,
    width: 12,
  }),
  dash: (color: string) => ({
    borderColor: color,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 10,
    width: 14,
  }),
  legend: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    columnGap: 6,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 12,
    marginBlockStart: 12,
  },
  legendItem: { marginInlineEnd: 10 },
  heading: { fontSize: 15, fontWeight: 600, marginBlockEnd: 0, marginBlockStart: 28 },
  gridColumns: (count: number) => ({ gridTemplateColumns: `96px repeat(${count}, 1fr)` }),
  ok: { color: cssVar.colorSuccess },
  pair: { columnGap: 8, display: 'grid', gridTemplateColumns: '1fr 1fr' },
  rest: { color: cssVar.colorTextSecondary, fontSize: 12.5, marginBlockStart: 14 },
  restItem: { marginBlockStart: 6 },
  rowHead: { alignSelf: 'center', color: cssVar.colorTextSecondary, fontSize: 13 },
  shot: {
    backgroundColor: cssVar.colorBgLayout,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'block',
    height: 128,
    imageRendering: 'pixelated',
    objectFit: 'contain',
    width: '100%',
  },
  side: { color: cssVar.colorTextTertiary, fontSize: 11, marginBlockEnd: 4 },
  title: { fontSize: 20, fontWeight: 600, marginBlock: 0 },
  verdict: {
    alignItems: 'center',
    columnGap: 8,
    display: 'flex',
    fontSize: 12,
    marginBlockStart: 10,
  },
});

type Grid = ReturnType<typeof reviewGrid>;

const sidesOf = (item: ReviewView) => {
  const unpaired = /\|unpaired:(base|head):/.exec(item.key)?.[1] as 'base' | 'head' | undefined;
  return unpaired ? [unpaired] : (['base', 'head'] as const);
};

const Pair = ({
  combo,
  condition,
  item,
}: {
  combo: number;
  condition: string;
  item: ReviewView;
}) => (
  <div {...stylex.props(styles.pair)}>
    {sidesOf(item).map((side) => (
      <div key={side}>
        <div {...stylex.props(styles.side)}>{side === 'base' ? '改之前' : '改之后'}</div>
        <img
          alt={`${side === 'base' ? '改之前' : '改之后'} ${item.title}`}
          loading="lazy"
          src={cropShotUrl(item.key, side, condition, combo)}
          {...stylex.props(styles.shot)}
        />
      </div>
    ))}
  </div>
);

const CellVerdict = ({
  cell,
  itemKey,
}: {
  cell: { differs: boolean; summary: string[] };
  itemKey: string;
}) => {
  const verdict = cellVerdict(itemKey, cell);
  return <div {...stylex.props(styles.verdict, styles[verdict.tone])}>{verdict.text}</div>;
};

const ShotGrid = ({
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
      <div key={column.label} {...stylex.props(styles.colHead)}>
        {column.title}
      </div>
    ))}
    {rows.map((row) => [
      <div key={`${row.index}-head`} {...stylex.props(styles.rowHead)}>
        {row.label}
      </div>,
      ...row.cells.map((cell) => (
        <div
          key={`${row.index}-${cell.condition}`}
          {...stylex.props(styles.cell, cell.differs && styles.diff)}
        >
          <Pair combo={cell.combo} condition={cell.condition} item={item} />
          <CellVerdict cell={cell} itemKey={item.key} />
        </div>
      )),
    ])}
  </div>
);

const Legend = () => (
  <div {...stylex.props(styles.legend)}>
    <span {...stylex.props(styles.checker(...REVEAL_COLORS.checker))} />
    <span {...stylex.props(styles.legendItem)}>棋盘格：透明，没有背景</span>
    <span {...stylex.props(styles.dash(REVEAL_COLORS.element))} />
    <span {...stylex.props(styles.legendItem)}>粉色虚线：这个元素的边界</span>
    <span {...stylex.props(styles.dash(REVEAL_COLORS.pseudo))} />
    <span {...stylex.props(styles.legendItem)}>蓝色虚线：::before / ::after</span>
  </div>
);

const AgentNote = ({ item }: { item: ReviewView }) =>
  item.note ? (
    <div {...stylex.props(styles.agent)}>
      <span
        {...stylex.props(
          styles.agentTag,
          item.note.suggestion === 'pass' ? styles.ok : styles.error,
        )}
      >
        agent {item.note.suggestion === 'pass' ? '建议通过' : '建议打回'}
      </span>
      {item.note.finding}
    </div>
  ) : (
    <div {...stylex.props(styles.agent)}>
      截图之外还要读代码确认。agent 还没读，读完会在这里写一句结论，之后才能操作。
    </div>
  );

export const ReviewItemView = ({
  conditions,
  item,
}: {
  conditions: string[];
  item: ReviewView;
}) => {
  const grid = reviewGrid(item.combos, conditions, item.comboDifferences);
  const visual = item.category !== 'blocking';
  return (
    <section>
      <h1 {...stylex.props(styles.title)}>{item.title}</h1>
      <p {...stylex.props(styles.ask)}>
        {item.ask}
        {item.rework && `　你上次打回的原因：${item.rework.note}`}
      </p>
      {item.category === 'blocking' && (
        <div {...stylex.props(styles.agent, styles.error)}>{item.errors[0] ?? '渲染失败'}</div>
      )}
      {item.needsAgent && <AgentNote item={item} />}
      {visual && <Legend />}
      {visual && <ShotGrid columns={grid.columns} item={item} rows={grid.rows} />}
      {visual && grid.states.columns.length > 0 && (
        <>
          <h2 {...stylex.props(styles.heading)}>交互状态</h2>
          <ShotGrid columns={grid.states.columns} item={item} rows={grid.states.rows} />
        </>
      )}
      {visual && (
        <div {...stylex.props(styles.rest)}>
          {grid.restDifferences.length
            ? `其余 ${grid.restCount} 个宽度和交互状态里，下面这些不一样：`
            : `还有 ${grid.restCount} 个宽度和交互状态，全部一致。`}
          {grid.restDifferences.map((entry) => (
            <div key={`${entry.combo}-${entry.condition}`} {...stylex.props(styles.restItem)}>
              <div {...stylex.props(styles.error)}>
                {entry.label} · {entry.condition}：{entry.summary.join('；')}
              </div>
              <Pair combo={entry.combo} condition={entry.condition} item={item} />
            </div>
          ))}
        </div>
      )}
      <StyleDetails item={item} />
    </section>
  );
};
