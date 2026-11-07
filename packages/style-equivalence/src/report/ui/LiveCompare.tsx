import { Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { type CaseSnapshot, fetchSnapshot, shotUrl } from '../api';
import type { ConditionColumn } from '../data';
import { stateLabel, THEME_LABELS } from '../labels';
import { type PropertyMode, propertyRows } from '../properties';

const styles = stylex.create({
  controls: { columnGap: 8, display: 'flex', flexWrap: 'wrap', rowGap: 8 },
  frame: (width: number) => ({ borderStyle: 'none', display: 'block', height: 240, width }),
  heading: { fontSize: cssVar.fontSize, fontWeight: 600, marginBlock: 0 },
  missing: { padding: 12 },
  pane: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  paneTitle: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    paddingBlock: 6,
    paddingInline: 12,
  },
  panes: { columnGap: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  root: { display: 'flex', flexDirection: 'column', rowGap: 12 },
  row: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 8,
    display: 'grid',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 20px',
    paddingBlock: 6,
    paddingInline: 12,
  },
  rowBad: { backgroundColor: cssVar.colorErrorBg },
  rowHead: { color: cssVar.colorTextTertiary, fontFamily: cssVar.fontFamily },
  shot: { display: 'block', maxWidth: '100%' },
  table: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  value: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  viewport: { overflow: 'hidden', width: 376 },
});

const MODES: Array<[PropertyMode, string]> = [
  ['declared', '声明过的属性'],
  ['diff', '只看不同'],
  ['all', '全部'],
];

const MARKS = { different: '✗', ignored: '≈', same: '✓' } as const;

const Segment = <T extends string | number>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<[T, string]>;
  value: T;
}) => (
  <Segmented
    options={options.map(([option, label]) => ({ label, value: String(option) }))}
    size="small"
    value={String(value)}
    onChange={(next) => {
      const match = options.find(([option]) => String(option) === next);
      if (match) onChange(match[0]);
    }}
  />
);

const Pane = ({
  caseKey,
  column,
  combo,
  revision,
  side,
}: {
  caseKey: string;
  column: ConditionColumn;
  combo: number;
  revision: string;
  side: 'base' | 'head';
}) => {
  const live = column.state === 'default' && !column.variant;
  const query = `case=${encodeURIComponent(caseKey)}&combo=${combo}&theme=${encodeURIComponent(column.theme)}`;
  return (
    <div {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.paneTitle)}>
        {side} {revision.slice(0, 7)} · {live ? '实时' : '截图'}
      </div>
      {live ? (
        <div {...stylex.props(styles.viewport)}>
          <iframe
            src={`/${side}/?${query}`}
            title={`${side} ${column.label}`}
            {...stylex.props(styles.frame(column.width))}
          />
        </div>
      ) : (
        <img
          alt={`${side} ${column.label}`}
          src={shotUrl(caseKey, side, column.label, combo)}
          {...stylex.props(styles.shot)}
        />
      )}
    </div>
  );
};

export const LiveCompare = ({
  base,
  caseKey,
  columns,
  combos,
  declared,
  head,
}: {
  base: string;
  caseKey: string;
  columns: ConditionColumn[];
  combos: number;
  declared: string[];
  head: string;
}) => {
  const [label, setLabel] = useState(columns[0]?.label ?? '');
  const [combo, setCombo] = useState(0);
  const [mode, setMode] = useState<PropertyMode>('declared');
  const [loaded, setLoaded] = useState<{
    error?: string;
    request: string;
    snapshot?: CaseSnapshot;
  }>();
  const column = columns.find((item) => item.label === label) ?? columns[0];
  const request = `${caseKey}\n${column?.label}\n${combo}`;
  useEffect(() => {
    if (!column) return;
    let current = true;
    fetchSnapshot(caseKey, column.label, combo)
      .then((snapshot) => current && setLoaded({ request, snapshot }))
      .catch((reason: unknown) => current && setLoaded({ error: String(reason), request }));
    return () => {
      current = false;
    };
  }, [caseKey, column, combo, request]);
  const snapshot = loaded?.request === request ? loaded.snapshot : undefined;
  const error = loaded?.request === request ? loaded.error : undefined;
  if (!column) return null;
  const pick = (change: Partial<ConditionColumn>) => {
    const wanted = { ...column, ...change };
    const match =
      columns.find(
        (item) =>
          item.theme === wanted.theme &&
          item.width === wanted.width &&
          item.state === wanted.state &&
          item.variant === wanted.variant,
      ) ??
      columns.find((item) => item.theme === wanted.theme && item.width === wanted.width) ??
      columns.find((item) => item.theme === wanted.theme);
    if (match) setLabel(match.label);
  };
  const themes = [...new Set(columns.map((item) => item.theme))];
  const widths = [
    ...new Set(columns.filter((item) => item.theme === column.theme).map((item) => item.width)),
  ];
  const states = columns.filter(
    (item) => item.theme === column.theme && item.width === column.width,
  );
  const rows = snapshot ? propertyRows(snapshot, declared, mode) : [];
  return (
    <div {...stylex.props(styles.root)}>
      <h3 {...stylex.props(styles.heading)}>实时对照</h3>
      <div {...stylex.props(styles.controls)}>
        <Segment
          options={themes.map((theme) => [theme, THEME_LABELS[theme] ?? theme])}
          value={column.theme}
          onChange={(theme) => pick({ theme })}
        />
        <Segment
          options={widths.map((width) => [width, String(width)])}
          value={column.width}
          onChange={(width) => pick({ width })}
        />
        <Segment
          options={states.map((item) => [item.label, stateLabel(item.state, item.variant)])}
          value={column.label}
          onChange={(value) => setLabel(value)}
        />
        {combos > 1 && (
          <Segment
            options={Array.from({ length: combos }, (_, index) => [index, `组合 ${index + 1}`])}
            value={combo}
            onChange={setCombo}
          />
        )}
      </div>
      <div {...stylex.props(styles.panes)}>
        <Pane caseKey={caseKey} column={column} combo={combo} revision={base} side="base" />
        <Pane caseKey={caseKey} column={column} combo={combo} revision={head} side="head" />
      </div>
      <Segment options={MODES} value={mode} onChange={setMode} />
      <div {...stylex.props(styles.table)}>
        <div {...stylex.props(styles.row, styles.rowHead)}>
          <span>属性（{snapshot?.base.targetKey ?? '目标元素'}）</span>
          <span>base</span>
          <span>head</span>
          <span />
        </div>
        {!snapshot && (
          <Text type={error ? 'danger' : 'secondary'} {...stylex.props(styles.missing)}>
            {error ? `读取失败：${error}` : '正在这个条件下重新采样…'}
          </Text>
        )}
        {snapshot && rows.length === 0 && (
          <Text type="secondary" {...stylex.props(styles.missing)}>
            {mode === 'diff' ? '这个条件下目标元素没有不同的属性。' : '没有可对照的属性。'}
          </Text>
        )}
        {rows.map((row) => (
          <div
            key={row.name}
            title={row.reason ? `不影响渲染：${row.reason}` : undefined}
            {...stylex.props(styles.row, row.mark === 'different' && styles.rowBad)}
          >
            <span {...stylex.props(styles.value)}>{row.name}</span>
            <span title={row.base} {...stylex.props(styles.value)}>
              {row.base ?? '--'}
            </span>
            <span title={row.head} {...stylex.props(styles.value)}>
              {row.head ?? '--'}
            </span>
            <span>{MARKS[row.mark]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
