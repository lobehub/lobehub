import { Empty, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCheck } from 'lucide-react';

import type { ReviewPayload, ReviewState, ReviewView } from '../api';

const styles = stylex.create({
  current: {
    backgroundColor: { ':hover': cssVar.colorFillSecondary, 'default': cssVar.colorFillSecondary },
    color: cssVar.colorText,
    fontWeight: 500,
  },
  file: {
    paddingBlockEnd: 4,
    paddingBlockStart: 12,
    paddingInline: 8,
  },
  item: {
    alignItems: 'start',
    backgroundColor: { ':hover': cssVar.colorFillTertiary, 'default': 'transparent' },
    borderRadius: cssVar.borderRadius,
    borderStyle: 'none',
    color: cssVar.colorTextSecondary,
    columnGap: 8,
    cursor: 'pointer',
    display: 'grid',
    font: 'inherit',
    gridTemplateColumns: '8px minmax(0, 1fr) auto',
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'start',
    width: '100%',
  },
  mark: { borderRadius: '50%', height: 8, marginBlockStart: 7, width: 8 },
  root: { padding: 8 },
  title: { overflowWrap: 'anywhere' },
});

const marks = stylex.create({
  'changed': { backgroundColor: cssVar.colorInfo },
  'passed': { backgroundColor: cssVar.colorSuccess },
  'reworked': { backgroundColor: cssVar.colorError },
  'todo': { backgroundColor: cssVar.colorTextQuaternary },
  'waiting-agent': { backgroundColor: cssVar.colorWarning },
});

const STATE_LABELS: Record<ReviewState, string> = {
  'changed': '已修改',
  'passed': '已通过',
  'reworked': '已打回',
  'todo': '待看',
  'waiting-agent': '等 agent',
};

const HINTS: Partial<Record<ReviewState, string>> = {
  'changed': '已修改',
  'waiting-agent': '等 agent',
};

const byFile = (items: ReviewView[]) => {
  const groups = new Map<string, ReviewView[]>();
  for (const item of items) groups.set(item.file, [...(groups.get(item.file) ?? []), item]);
  return [...groups];
};

const shortFile = (file: string) => file.split('/').slice(-3).join('/');

const scrollIntoView = (element: HTMLButtonElement | null) => {
  element?.scrollIntoView({ block: 'nearest' });
};

export const ReviewQueue = ({
  current,
  onSelect,
  payload,
}: {
  current?: string;
  onSelect: (key: string) => void;
  payload: ReviewPayload;
}) => (
  <nav aria-label="复查队列" {...stylex.props(styles.root)}>
    {!payload.items.length && (
      <Empty description="工具已证明的项不用人工看。" icon={CheckCheck} title="没有要你看的项" />
    )}
    {byFile(payload.items).map(([file, items]) => (
      <div key={file}>
        <Text ellipsis fontSize={12} title={file} type="secondary" {...stylex.props(styles.file)}>
          {shortFile(file)}
        </Text>
        {items.map((item) => (
          <button
            aria-current={item.key === current ? 'true' : undefined}
            key={item.key}
            ref={item.key === current ? scrollIntoView : undefined}
            type="button"
            onClick={() => onSelect(item.key)}
            {...stylex.props(styles.item, item.key === current && styles.current)}
          >
            <span
              aria-label={STATE_LABELS[item.state]}
              role="img"
              {...stylex.props(styles.mark, marks[item.state])}
            />
            <span {...stylex.props(styles.title)}>{item.title}</span>
            {HINTS[item.state] && (
              <Text fontSize={12} type="secondary">
                {HINTS[item.state]}
              </Text>
            )}
          </button>
        ))}
      </div>
    ))}
    {payload.resolved.length > 0 && (
      <div>
        <Text fontSize={12} type="secondary" {...stylex.props(styles.file)}>
          已解决
        </Text>
        {payload.resolved.map((entry) => (
          <Text fontSize={12} key={entry.key} type="secondary" {...stylex.props(styles.file)}>
            {entry.key.slice(entry.key.indexOf('|') + 1)}：{entry.note}
          </Text>
        ))}
      </div>
    )}
  </nav>
);
