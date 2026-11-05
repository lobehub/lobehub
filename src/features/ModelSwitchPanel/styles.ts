// oxlint-disable-next-line stylex-migration/no-plain-css -- the trigger's svg comes from caller-supplied @lobehub/icons avatars, which take no className or xstyle
import './styles.css';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const descendantStyles = {
  trigger: 'lobe-model-switch-panel-7fffbb6a-trigger',
} as const;

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
  providerMenuItem: {
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
