import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import moduleStyles from './styles.module.css';

/** Class names for the descendant rules StyleX cannot express (see styles.module.css). */
export const descendantStyles = moduleStyles;

export const styles = stylex.create({
  container: {
    pointerEvents: 'auto',
    userSelect: 'none',
    overflow: 'hidden',
    padding: 0,
  },
  detailPopup: {
    userSelect: 'none',
    overscrollBehavior: 'contain',
    width: '400px',
  },
  dropdownMenu: {
    userSelect: 'none',
  },
  groupHeader: {
    width: '100%',
    color: cssVar.colorTextSecondary,
  },
  list: {
    position: 'relative',
    overflowX: 'hidden',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    width: '100%',
  },
  menuItem: {
    cursor: 'pointer',
    position: 'relative',
    gap: '8px',
    alignItems: 'center',
    marginBlock: '1px',
    marginInline: '4px',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
  },
  menuItemActive: {
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  footer: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  toolbar: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  trigger: {
    display: 'inline-flex',
    outlineStyle: 'none',
  },
});
