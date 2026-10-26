import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const AVATAR_SIZE = 28;

export const styles = stylex.create({
  empty: {
    paddingBlock: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  nested: {
    paddingBlockStart: '2px',
    paddingBlockEnd: '6px',
    paddingInlineStart: '30px',
  },
  preview: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: '1',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '7px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    color: { default: cssVar.colorText, ':hover': cssVar.colorText },
    textDecoration: 'none',
    backgroundColor: { default: null, ':hover': cssVar.colorFillTertiary },
    transition: 'background-color 0.15s',
  },
  rowActive: {
    backgroundColor: { default: cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  running: {
    color: cssVar.colorSuccess,
  },
  sectionTitle: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  time: {
    flex: 'none',
    fontSize: '11px',
    lineHeight: '20px',
    color: cssVar.colorTextQuaternary,
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: '1',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
  },
  unread: {
    flex: 'none',
    minWidth: '16px',
    height: '16px',
    paddingInline: '5px',
    borderRadius: '999px',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: '16px',
    color: cssVar.colorBgContainer,
    textAlign: 'center',
    backgroundColor: cssVar.colorText,
  },
});
