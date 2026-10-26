import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const RAIL_ICON_SIZE = 18;

export const styles = stylex.create({
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: '1px',
    insetInlineEnd: '1px',
    minWidth: '15px',
    height: '15px',
    paddingInline: '4px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgLayout,
    borderRadius: '999px',
    fontSize: '9px',
    fontWeight: 600,
    lineHeight: '12px',
    color: cssVar.colorBgContainer,
    textAlign: 'center',
    backgroundColor: cssVar.colorText,
  },
  divider: {
    width: '20px',
    height: '1px',
    marginBlock: '6px',
    backgroundColor: cssVar.colorBorderSecondary,
  },
  item: {
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    borderRadius: cssVar.borderRadius,
    color: { default: cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { default: null, ':hover': cssVar.colorFillTertiary },
    transition: 'color 0.15s, background-color 0.15s',
  },
  itemActive: {
    color: cssVar.colorText,
    backgroundColor: { default: cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  rail: {
    userSelect: 'none',
    flex: 'none',
    alignItems: 'center',
    // Keep in sync with RAIL_WIDTH (./const): StyleX only compiles local literals.
    width: '52px',
    height: '100%',
    paddingBlock: '10px',
  },
});
