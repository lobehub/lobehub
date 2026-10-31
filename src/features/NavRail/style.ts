import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// 48px rail; review settled the glyph between 13px (too small) and 18px (too
// large): 16px at 1.5 stroke inside a 30px hit area, 10px apart.
export const RAIL_ICON_SIZE = { size: 16, strokeWidth: 1.5 };
export const RAIL_GAP = 10;

export const styles = stylex.create({
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: '-5px',
    insetInlineEnd: '-6px',
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
  item: {
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
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
    width: '48px',
    height: '100%',
    paddingBlock: '10px',
  },
});
