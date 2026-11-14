import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const AVATAR_SIZE = 28;

export const styles = stylex.create({
  avatar: {
    position: 'relative',
    display: 'inline-flex',
    flex: 'none',
  },
  /** Marks a project avatar as one of that project's Channels. */
  channelMark: {
    position: 'absolute',
    insetBlockEnd: '-3px',
    insetInlineEnd: '-3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '4px',
    backgroundColor: cssVar.colorBgElevated,
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
  tag: {
    marginInlineStart: '6px',
    fontSize: '11px',
    fontWeight: 400,
    color: cssVar.colorTextQuaternary,
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
  /** Same quiet colour as the preview it replaces, so a reply in progress does not shout. */
  typing: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
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
