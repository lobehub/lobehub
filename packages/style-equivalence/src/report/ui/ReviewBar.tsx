import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { RefObject } from 'react';

import type { ReviewView } from '../api';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    columnGap: 12,
    display: 'flex',
    paddingBlock: 16,
    paddingInline: 32,
  },
  button: {
    backgroundColor: { ':disabled': cssVar.colorFillTertiary, 'default': cssVar.colorBgContainer },
    borderColor: cssVar.colorBorder,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    color: { ':disabled': cssVar.colorTextQuaternary, 'default': cssVar.colorText },
    cursor: { ':disabled': 'not-allowed', 'default': 'pointer' },
    fontFamily: 'inherit',
    fontSize: 13,
    height: 34,
    paddingInline: 14,
    whiteSpace: 'nowrap',
  },
  danger: { borderColor: cssVar.colorErrorBorder, color: cssVar.colorError },
  error: { color: cssVar.colorError, fontSize: 12 },
  input: {
    borderColor: cssVar.colorBorder,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: '1',
    fontFamily: 'inherit',
    fontSize: 13,
    height: 34,
    minWidth: 0,
    paddingInline: 12,
  },
  keys: { color: cssVar.colorTextTertiary, fontSize: 11.5, whiteSpace: 'nowrap' },
  primary: {
    backgroundColor: cssVar.colorText,
    borderColor: cssVar.colorText,
    color: cssVar.colorBgContainer,
  },
});

export const ReviewBar = ({
  busy,
  error,
  inputRef,
  item,
  note,
  onNote,
  onPass,
  onRework,
}: {
  busy: boolean;
  error?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  item: ReviewView;
  note: string;
  onNote: (value: string) => void;
  onPass: () => void;
  onRework: () => void;
}) => {
  const passNeedsNote = item.category === 'difference';
  const waiting = item.state === 'waiting-agent';
  return (
    <div {...stylex.props(styles.bar)}>
      <input
        aria-label="打回原因"
        disabled={busy}
        ref={inputRef}
        value={note}
        placeholder={
          passNeedsNote
            ? '写一句：为什么不一样也没问题，或者哪里要改'
            : '打回原因（打回时必填）：比如「在线时多了一圈灰边」'
        }
        onChange={(event) => onNote(event.target.value)}
        {...stylex.props(styles.input)}
      />
      {error && <span {...stylex.props(styles.error)}>{error}</span>}
      <button
        disabled={busy || waiting || !note.trim()}
        type="button"
        onClick={onRework}
        {...stylex.props(styles.button, styles.danger)}
      >
        打回
      </button>
      <button
        disabled={busy || !item.canPass || (passNeedsNote && !note.trim())}
        title={item.canPass ? undefined : '这一项只能打回'}
        type="button"
        onClick={onPass}
        {...stylex.props(styles.button, item.canPass && styles.primary)}
      >
        没问题
      </button>
      <span {...stylex.props(styles.keys)}>J / K 上下条 · Y 通过 · N 打回</span>
    </div>
  );
};
