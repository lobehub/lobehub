import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewPayload } from '../api';

const styles = stylex.create({
  close: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  empty: { color: cssVar.colorTextTertiary, fontSize: 13, paddingBlock: 24, textAlign: 'center' },
  file: { color: cssVar.colorTextTertiary, fontSize: 12 },
  footer: {
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    lineHeight: 1.6,
    paddingBlock: 12,
    paddingInline: 20,
  },
  head: {
    alignItems: 'center',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    display: 'flex',
    justifyContent: 'space-between',
    paddingBlock: 16,
    paddingInline: 20,
  },
  item: {
    display: 'grid',
    paddingBlock: 14,
    paddingInline: 20,
    rowGap: 8,
  },
  itemHead: { alignItems: 'baseline', columnGap: 8, display: 'flex' },
  list: { maxHeight: '56vh', overflowY: 'auto' },
  name: { fontSize: 14, fontWeight: 600 },
  panel: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.18)',
    overflow: 'hidden',
    width: 520,
  },
  reason: {
    borderInlineStartColor: cssVar.colorError,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 3,
    color: cssVar.colorText,
    fontSize: 14,
    lineHeight: 1.6,
    paddingInlineStart: 10,
  },
  scrim: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    display: 'flex',
    inset: 0,
    justifyContent: 'center',
    position: 'fixed',
  },
  separator: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
  time: { color: cssVar.colorTextTertiary, fontSize: 12, marginInlineStart: 'auto' },
  title: { fontSize: 16, fontWeight: 600 },
});

const timeOf = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
  });

export const ReworkPanel = ({
  onClose,
  payload,
}: {
  onClose: () => void;
  payload: ReviewPayload;
}) => {
  const open = payload.items.filter((item) => item.state === 'reworked' && item.rework);
  return (
    <div role="presentation" onClick={onClose} {...stylex.props(styles.scrim)}>
      <div
        aria-label="已打回"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        {...stylex.props(styles.panel)}
      >
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.title)}>已打回 {open.length} 项</span>
          <button type="button" onClick={onClose} {...stylex.props(styles.close)}>
            关闭
          </button>
        </div>
        <div {...stylex.props(styles.list)}>
          {open.length === 0 && <div {...stylex.props(styles.empty)}>现在没有打回的项。</div>}
          {open.map((item, index) => (
            <div key={item.key} {...stylex.props(styles.item, index > 0 && styles.separator)}>
              <div {...stylex.props(styles.itemHead)}>
                <span {...stylex.props(styles.name)}>{item.title}</span>
                <span {...stylex.props(styles.file)}>{item.file.split('/').pop()}</span>
                <span {...stylex.props(styles.time)}>{timeOf(item.rework!.at)}</span>
              </div>
              <div {...stylex.props(styles.reason)}>{item.rework!.note}</div>
            </div>
          ))}
        </div>
        {open.length > 0 && (
          <div {...stylex.props(styles.footer)}>
            下一步：在终端对 agent
            说「处理打回」。改完重跑后，这些项会标成「已修改」回到左侧队列，请你再看一眼。
          </div>
        )}
      </div>
    </div>
  );
};
