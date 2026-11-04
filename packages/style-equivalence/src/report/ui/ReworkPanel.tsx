import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewPayload } from '../api';

const styles = stylex.create({
  close: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    cursor: 'pointer',
    fontSize: 13,
    marginInlineStart: 'auto',
  },
  code: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 6,
    display: 'block',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12.5,
    marginBlock: 8,
    padding: 10,
    userSelect: 'all',
  },
  head: { alignItems: 'center', display: 'flex', marginBlockEnd: 12 },
  item: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    fontSize: 13,
    paddingBlock: 10,
  },
  muted: { color: cssVar.colorTextTertiary, fontSize: 12.5, lineHeight: 1.7 },
  panel: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.18)',
    maxHeight: '80vh',
    overflowY: 'auto',
    padding: 20,
    width: 560,
  },
  scrim: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    display: 'flex',
    inset: 0,
    justifyContent: 'center',
    position: 'fixed',
  },
  title: { fontSize: 16, fontWeight: 600 },
});

export const ReworkPanel = ({
  onClose,
  payload,
}: {
  onClose: () => void;
  payload: ReviewPayload;
}) => {
  const open = payload.items.filter((item) => item.state === 'reworked' && item.rework);
  const target = payload.pr ? `--pr ${payload.pr.number}` : payload.run.runId;
  return (
    <div role="presentation" onClick={onClose} {...stylex.props(styles.scrim)}>
      <div
        aria-label="处理打回"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        {...stylex.props(styles.panel)}
      >
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.title)}>处理打回（{open.length}）</span>
          <button type="button" onClick={onClose} {...stylex.props(styles.close)}>
            关闭
          </button>
        </div>
        <div {...stylex.props(styles.muted)}>
          在终端对 agent 说「处理打回」。agent 会读下面这份清单，到 PR
          分支上改、推送、重跑；改过的项会回到队列，标成「已修改」。
        </div>
        <code {...stylex.props(styles.code)}>bun run style-eq rework {target}</code>
        {open.length === 0 && <div {...stylex.props(styles.muted)}>现在没有打回的项。</div>}
        {open.map((item) => (
          <div key={item.key} {...stylex.props(styles.item)}>
            <b>{item.title}</b>
            <div {...stylex.props(styles.muted)}>{item.file}</div>
            <div>原因：{item.rework!.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
