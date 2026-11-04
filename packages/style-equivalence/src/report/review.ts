import { conditionColumns } from './data';

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

export const keyAction = (key: string, typing: boolean) =>
  typing ? undefined : KEYS[key.toLowerCase()];

export interface ComboDifference {
  combo: number;
  condition: string;
  summary: string[];
}

const DEFAULT_WIDTH = 1280;

export const reviewGrid = (
  combos: Array<{ index: number; label: string }>,
  conditions: string[],
  differences: ComboDifference[],
) => {
  const plain = conditionColumns(conditions).filter(
    (column) => column.state === 'default' && !column.variant,
  );
  const widths = plain.map((column) => column.width);
  const width = widths.includes(DEFAULT_WIDTH) ? DEFAULT_WIDTH : Math.max(...widths);
  const columns = plain.filter((column) => column.width === width);
  const shown = new Set(columns.map((column) => column.label));
  const differenceOf = (combo: number, condition: string) =>
    differences.find((entry) => entry.combo === combo && entry.condition === condition);
  const rows = combos.map((combo) => ({
    ...combo,
    cells: columns.map((column) => {
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
  const labels = new Map(combos.map((combo) => [combo.index, combo.label]));
  return {
    columns,
    restCount: (new Set(conditions).size - columns.length) * combos.length,
    restDifferences: differences
      .filter((entry) => !shown.has(entry.condition))
      .map((entry) => ({ ...entry, label: labels.get(entry.combo) ?? '默认' })),
    rows,
  };
};

const TOOL_REASONS: Array<[RegExp, (count: string) => string]> = [
  [/^mutation not fully caught$/, () => '工具自检没通过：注入的已知改动没有全部被发现。'],
  [
    /^calibration mismatch (\d+)$/,
    (count) => `工具自检没通过：${count} 处合成渲染和真实挂载不一致。`,
  ],
];

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
