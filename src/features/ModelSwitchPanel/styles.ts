// oxlint-disable-next-line stylex-migration/no-emotion-styles -- caller-supplied @lobehub/icons svg takes no className
import { createStaticStyles } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const descendantStyles = createStaticStyles(({ css }) => ({
  trigger: css`
    svg:focus {
      outline: none;
    }
  `,
}));

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
