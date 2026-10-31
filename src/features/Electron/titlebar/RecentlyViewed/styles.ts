import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  actionIcon: {
    flexShrink: 0,
    color: {
      default: cssVar.colorTextTertiary,
      [stylex.when.ancestor(':hover')]: cssVar.colorText,
    },
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: `opacity 0.2s ${cssVar.motionEaseOut}`,
  },
  container: { overflowY: 'auto', width: '260px', maxHeight: '320px', padding: '4px' },
  divider: {
    height: '1px',
    marginBlock: '4px',
    backgroundColor: cssVar.colorBorderSecondary,
  },
  empty: {
    paddingBlock: '16px',
    paddingInline: '12px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  icon: { flexShrink: 0, color: cssVar.colorTextSecondary },
  item: {
    cursor: 'default',
    overflow: 'hidden',
    flexShrink: 0,
    paddingBlock: '3px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
    transition: `background-color 0.15s ${cssVar.motionEaseInOut}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
  },
  itemActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
  },
  itemHovered: { backgroundColor: cssVar.colorFillSecondary },
  itemTitle: {
    overflow: 'hidden',
    flex: '1',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
    textTransform: 'capitalize',
    letterSpacing: '0.5px',
  },
});
