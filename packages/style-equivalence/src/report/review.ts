import { conditionColumns } from './data';
import { stateLabel, THEME_LABELS } from './labels';

export const OPEN_STATES = new Set(['changed', 'todo']);

export const nextOpen = (
  items: Array<{ key: string; state: string }>,
  current: string | undefined,
) => {
  const start = current ? items.findIndex((item) => item.key === current) : -1;
  for (let step = 1; step <= items.length; step += 1) {
    const candidate = items[(start + step + items.length) % items.length];
    if (candidate && candidate.key !== current && OPEN_STATES.has(candidate.state))
      return candidate.key;
  }
  return undefined;
};

export const nextSelection = (
  items: Array<{ key: string; state: string }>,
  current: string | undefined,
): string | undefined => nextOpen(items, current);

const KEYS: Record<string, 'next' | 'pass' | 'previous' | 'rework'> = {
  j: 'next',
  k: 'previous',
  n: 'rework',
  y: 'pass',
};

export const keyAction = (key: string, typing: boolean, covered = false) =>
  typing || covered ? undefined : KEYS[key.toLowerCase()];

export interface ComboDifference {
  combo: number;
  condition: string;
  summary: string[];
}

const DEFAULT_WIDTH = 1280;

const THEME_TITLES: Record<string, string> = { dark: '暗色', light: '亮色' };

const STATE_TITLES: Array<[string, string]> = [
  ['hover-target', '鼠标悬停'],
  ['hover-chain', '悬停在外层'],
  ['focus-visible', '键盘聚焦'],
];

export const reviewGrid = (
  combos: Array<{ index: number; label: string }>,
  conditions: string[],
  differences: ComboDifference[],
) => {
  const all = conditionColumns(conditions).filter((column) => !column.variant);
  const plain = all.filter((column) => column.state === 'default');
  const widths = plain.map((column) => column.width);
  const width = widths.includes(DEFAULT_WIDTH) ? DEFAULT_WIDTH : Math.max(...widths);
  const columns = plain
    .filter((column) => column.width === width)
    .map((column) => ({ ...column, title: THEME_TITLES[column.theme] ?? column.theme }));
  const stateColumns = STATE_TITLES.flatMap(([state, title]) =>
    all
      .filter(
        (column) => column.theme === 'light' && column.width === width && column.state === state,
      )
      .map((column) => ({ ...column, title })),
  );
  const differenceOf = (combo: number, condition: string) =>
    differences.find((entry) => entry.combo === combo && entry.condition === condition);
  const rowsFor = (shownColumns: typeof columns) =>
    combos.map((combo) => ({
      ...combo,
      cells: shownColumns.map((column) => {
        const difference = differenceOf(combo.index, column.label);
        return {
          combo: combo.index,
          condition: column.label,
          differs: Boolean(difference),
          summary: difference?.summary ?? [],
          theme: column.theme,
        };
      }),
    }));
  const shown = new Set([...columns, ...stateColumns].map((column) => column.label));
  const labels = new Map(combos.map((combo) => [combo.index, combo.label]));
  return {
    columns,
    restCount: (new Set(conditions).size - shown.size) * combos.length,
    restDifferences: differences
      .filter((entry) => !shown.has(entry.condition))
      .map((entry) => ({ ...entry, label: labels.get(entry.combo) ?? '默认' })),
    rows: rowsFor(columns),
    states: { columns: stateColumns, rows: rowsFor(stateColumns) },
  };
};

const TOOL_REASONS: Array<[RegExp, (count: string) => string]> = [
  [/^mutation not fully caught$/, () => '工具自检没通过：注入的已知改动没有全部被发现。'],
  [
    /^calibration mismatch (\d+)$/,
    (count) => `工具自检没通过：${count} 处合成渲染和真实挂载不一致。`,
  ],
];

export const cellVerdict = (key: string, cell: { differs: boolean; summary: string[] }) => {
  const side = /\|unpaired:(base|head):/.exec(key)?.[1];
  if (side === 'head') return { text: '只有改之后，没有可对比的', tone: 'neutral' as const };
  if (side === 'base') return { text: '只有改之前，改之后不见了', tone: 'neutral' as const };
  return cell.differs
    ? { text: `不一样：${cell.summary.join('；')}`, tone: 'error' as const }
    : { text: '一致', tone: 'ok' as const };
};

export const completionText = (
  counts: Record<string, number>,
  verdict: { mergeable: boolean; reasons: string[] },
) => {
  if (verdict.mergeable) return ['全部看完了，可以合并。'];
  const lines = ['全部看完了。'];
  if (counts.reworked) lines.push(`${counts.reworked} 项已打回，等 agent 改完会回到这里请你复看。`);
  if (counts.changed) lines.push(`${counts.changed} 项已修改，在左侧队列里复看。`);
  if (counts['waiting-agent']) lines.push(`${counts['waiting-agent']} 项等 agent 读完代码。`);
  for (const reason of verdict.reasons)
    for (const [pattern, text] of TOOL_REASONS) {
      const match = pattern.exec(reason);
      if (match) lines.push(text(match[1] ?? ''));
    }
  return lines;
};

export const standInNote = (tags: string[] | undefined) =>
  tags?.length ? `替身：这里画的是占位块，不是真实组件（${tags.join('、')}）` : undefined;

export const shotNotes = (
  item: { flags: string[]; standIns?: Partial<Record<'base' | 'head', string[]>> },
  side: 'base' | 'head',
) => {
  const notes: string[] = [];
  const standIn = standInNote(item.standIns?.[side]);
  if (standIn) notes.push(standIn);
  if (item.flags.includes('INNER_TARGET')) {
    const partly = item.flags.find((flag) => flag.startsWith('INNER_TARGET_PARTLY_FORWARDED:'));
    const tag = partly?.slice(partly.indexOf(':') + 1).split('|')[0];
    notes.push(
      `只画了容器本身：规则要命中的${tag ? ` ${tag} ` : '内部元素'}在组件${tag ? '内部' : '里'}，截图里没有`,
    );
  }
  return notes;
};

export const hasScreenshots = (item: { category: string; key: string }) =>
  item.category !== 'blocking' && !item.key.endsWith('|file');

export const groupDifferences = <T extends { label: string; summary: string[] }>(entries: T[]) => {
  const groups = new Map<string, { entries: T[]; key: string; label: string; summary: string[] }>();
  for (const entry of entries) {
    const key = `${entry.label}\n${entry.summary.join('；')}`;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { entries: [entry], key, label: entry.label, summary: entry.summary });
  }
  return [...groups.values()];
};

const themeName = (theme: string) => THEME_LABELS[theme] ?? theme;

export const conditionName = (label: string) => {
  const [column] = conditionColumns([label]);
  return `${themeName(column.theme)} ${column.width} ${stateLabel(column.state, column.variant)}`;
};

export const describeConditions = (labels: string[]) => {
  const columns = conditionColumns(labels);
  return [...new Set(columns.map((column) => column.theme))].map((theme) => {
    const own = columns.filter((column) => column.theme === theme);
    const byStates = new Map<string, number[]>();
    for (const width of new Set(own.map((column) => column.width))) {
      const states = own
        .filter((column) => column.width === width)
        .map((column) => stateLabel(column.state, column.variant))
        .join('、');
      byStates.set(states, [...(byStates.get(states) ?? []), width]);
    }
    const parts = [...byStates].map(([states, widths]) => `${widths.join('、')}（${states}）`);
    return `${themeName(theme)} · ${parts.join('；')}`;
  });
};

interface DifferenceView {
  category: string;
  comboDifferences: ComboDifference[];
  combos: Array<{ index: number; label: string }>;
  differingConditions: string[];
  summary: string[];
}

export const hasRenderedDifference = (item: DifferenceView) =>
  item.category === 'difference' ||
  item.differingConditions.length > 0 ||
  item.comboDifferences.length > 0;

const MAX_NOTE_GROUPS = 3;

export const defaultReworkNote = (item: DifferenceView) => {
  if (!hasRenderedDifference(item)) return '';
  const labels = new Map(item.combos.map((combo) => [combo.index, combo.label]));
  const named = item.combos.length > 1;
  const groups = groupDifferences(
    item.comboDifferences.map((entry) => ({ ...entry, label: labels.get(entry.combo) ?? '默认' })),
  );
  if (!groups.length) return item.summary.length ? `不一样：${item.summary.join('；')}` : '';
  const parts = groups.slice(0, MAX_NOTE_GROUPS).map((group) => {
    const where =
      group.entries.length === 1
        ? conditionName(group.entries[0].condition)
        : `${group.entries.length} 个条件`;
    return `${named ? `${group.label} · ` : ''}${group.summary.join('；')}（${where}）`;
  });
  const rest = groups.length - parts.length;
  return `不一样：${parts.join('；')}${rest > 0 ? `；另有 ${rest} 种差异` : ''}`;
};
