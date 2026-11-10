import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const AVATAR_SIZE = 28;

export const styles = stylex.create({
  avatar: {
    position: 'relative',
    display: 'inline-flex',
    flex: 'none',
  },
  empty: {
    paddingBlock: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  /** Pinned rows share one tinted block, like WeChat's 置顶, instead of a card per row. */
  pinnedGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  preview: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: '1',
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    textDecoration: 'none',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    transition: 'background-color 0.15s',
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  /** Title plus preview line, so a row without a preview keeps the same height. */
  rowText: {
    minWidth: 0,
    minHeight: '36px',
  },
  rowTextSingleLine: {
    minHeight: 0,
  },
  running: {
    color: cssVar.colorSuccess,
  },
  time: {
    flex: 'none',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextQuaternary,
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: '1',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: '18px',
  },
  unread: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: '-5px',
    insetInlineEnd: '-6px',
    minWidth: '16px',
    height: '16px',
    paddingInline: '4px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: '13px',
    color: '#fff',
    textAlign: 'center',
    backgroundColor: cssVar.colorError,
  },
});
