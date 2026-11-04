import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewPayload, ReviewState, ReviewView } from '../api';

const styles = stylex.create({
  current: {
    backgroundColor: cssVar.colorFillTertiary,
    boxShadow: `inset 2px 0 ${cssVar.colorText}`,
    color: cssVar.colorText,
    fontWeight: 500,
  },
  empty: { color: cssVar.colorTextTertiary, fontSize: 12, padding: 16 },
  file: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    fontWeight: 500,
    paddingBlockStart: '10px',
    paddingBlockEnd: '4px',
    paddingInline: 16,
    wordBreak: 'break-all',
  },
  hint: { color: cssVar.colorTextTertiary, fontSize: 11, marginInlineStart: 'auto' },
  item: {
    alignItems: 'center',
    backgroundColor: { ':hover': cssVar.colorFillQuaternary, 'default': 'transparent' },
    borderStyle: 'none',
    color: cssVar.colorTextSecondary,
    columnGap: 10,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: 'inherit',
    fontSize: 13,
    paddingBlock: 7,
    paddingInline: 16,
    textAlign: 'start',
    width: '100%',
  },
  mark: { flex: 'none', fontSize: 12, textAlign: 'center', width: 16 },
  markChanged: { color: cssVar.colorInfo },
  markPassed: { color: cssVar.colorSuccess },
  markReworked: { color: cssVar.colorError },
  markTodo: { color: cssVar.colorTextQuaternary },
  markWaiting: { color: cssVar.colorWarning },
  resolved: { color: cssVar.colorTextTertiary, fontSize: 12, paddingBlock: 4, paddingInline: 16 },
  root: { paddingBlock: 12 },
});

const MARKS: Record<ReviewState, { mark: string; style: stylex.StyleXStyles }> = {
  'changed': { mark: '●', style: styles.markChanged },
  'passed': { mark: '✓', style: styles.markPassed },
  'reworked': { mark: '↩', style: styles.markReworked },
  'todo': { mark: '●', style: styles.markTodo },
  'waiting-agent': { mark: '…', style: styles.markWaiting },
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
    {!payload.items.length && <div {...stylex.props(styles.empty)}>没有要你看的项。</div>}
    {byFile(payload.items).map(([file, items]) => (
      <div key={file}>
        <div title={file} {...stylex.props(styles.file)}>
          {shortFile(file)}
        </div>
        {items.map((item) => (
          <button
            aria-current={item.key === current ? 'true' : undefined}
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            {...stylex.props(styles.item, item.key === current && styles.current)}
          >
            <span {...stylex.props(styles.mark, MARKS[item.state].style)}>
              {MARKS[item.state].mark}
            </span>
            <span>{item.title}</span>
            {HINTS[item.state] && <span {...stylex.props(styles.hint)}>{HINTS[item.state]}</span>}
          </button>
        ))}
      </div>
    ))}
    {payload.resolved.length > 0 && (
      <div>
        <div {...stylex.props(styles.file)}>已解决</div>
        {payload.resolved.map((entry) => (
          <div key={entry.key} {...stylex.props(styles.resolved)}>
            ✓ {entry.key.slice(entry.key.indexOf('|') + 1)}：{entry.note}
          </div>
        ))}
      </div>
    )}
  </nav>
);
