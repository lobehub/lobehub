import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { cropShotUrl, fetchRun, type ReviewView, type RunPayload } from '../api';
import { reviewGrid } from '../review';
import { CaseView } from './CaseView';

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
  details: { color: cssVar.colorTextSecondary, fontSize: 13, marginBlockStart: 20 },
  diff: { borderColor: cssVar.colorError, boxShadow: `0 0 0 3px ${cssVar.colorErrorBg}` },
  error: { color: cssVar.colorError },
  grid: { alignItems: 'stretch', columnGap: 16, display: 'grid', rowGap: 12 },
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

const THEMES: Record<string, string> = { dark: '暗色', light: '亮色' };

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
    {(['base', 'head'] as const).map((side) => (
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

const Details = ({ caseKey }: { caseKey: string }) => {
  const [run, setRun] = useState<RunPayload>();
  return (
    <details
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open && !run) fetchRun().then(setRun);
      }}
      {...stylex.props(styles.details)}
    >
      <summary>详情：源码对比 · 生效的规则 · 比较了哪些条件</summary>
      {run ? <CaseView caseKey={caseKey} payload={run} /> : null}
    </details>
  );
};

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
      截图看不出这一项。agent 还没读这段代码，读完会写一句结论，这里才能操作。
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
  const visual = !item.needsAgent && item.category !== 'blocking' && item.category !== 'unpaired';
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
      {visual && (
        <div {...stylex.props(styles.grid, styles.gridColumns(grid.columns.length))}>
          <div />
          {grid.columns.map((column) => (
            <div key={column.label} {...stylex.props(styles.colHead)}>
              {THEMES[column.theme] ?? column.theme}
            </div>
          ))}
          {grid.rows.map((row) => [
            <div key={`${row.index}-head`} {...stylex.props(styles.rowHead)}>
              {row.label}
            </div>,
            ...row.cells.map((cell) => (
              <div
                key={`${row.index}-${cell.condition}`}
                {...stylex.props(styles.cell, cell.differs && styles.diff)}
              >
                <Pair combo={cell.combo} condition={cell.condition} item={item} />
                <div {...stylex.props(styles.verdict, cell.differs ? styles.error : styles.ok)}>
                  {cell.differs ? `● 不一样：${cell.summary.join('；')}` : '✓ 一致'}
                </div>
              </div>
            )),
          ])}
        </div>
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
      {item.category !== 'unpaired' && <Details caseKey={item.key} />}
    </section>
  );
};
