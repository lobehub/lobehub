import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/*
 * The tab itself, its title and its close button live in ./tab.module.css: their rules
 * select on `[data-tier]` and reach into the tab's children.
 */

// Mirrors TAB_ICON_SIZE / TAB_HEIGHT in ./tabLayout and this file's former constants.
const TAB_ICON_SIZE = '16px';
const TAB_HEIGHT = '26px';

export const styles = stylex.create({
  // A fixed slot, because the indicator is not one size: a tab with metadata renders a
  // 16px Avatar and one without falls back to a 14px Icon. resolveTabInset centres on
  // TAB_ICON_SIZE for both, so the slot has to be that size or the fallback sits a pixel
  // off centre in a pinned pill. Measured on the desktop app, not inferred.
  avatarWrapper: {
    position: 'relative',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: TAB_ICON_SIZE,
    height: TAB_ICON_SIZE,
    lineHeight: 0,
  },
  container: { flex: '1', minWidth: 0 },
  newTabButton: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '22px',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    transition: `background-color 0.15s ${cssVar.motionEaseInOut}, color 0.15s ${cssVar.motionEaseInOut}`,
  },
  overflowButton: {
    cursor: 'default',
    flexShrink: 0,
    justifyContent: 'center',
    height: '22px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '11px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  pinnedDivider: {
    position: 'absolute',
    insetBlockStart: '4px',
    insetInlineStart: 0,
    width: '1px',
    height: '18px',
    backgroundColor: cssVar.colorBorder,
    transition: `opacity 0.18s ${cssVar.motionEaseInOut}`,
  },
  previewCard: { display: 'flex', flexDirection: 'column', gap: '6px', width: '240px' },
  previewImage: {
    display: 'block',
    aspectRatio: '16 / 10',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
    objectFit: 'cover',
    objectPosition: 'top center',
  },
  previewTitle: {
    overflow: 'hidden',
    fontSize: '12px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  runningDot: {
    position: 'absolute',
    insetBlockEnd: '-2px',
    insetInlineEnd: '-2px',
    width: '8px',
    height: '8px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgLayout,
    borderRadius: '50%',
    backgroundColor: cssVar.gold,
    backgroundImage: 'none',
    boxShadow: `0 0 6px ${cssVar.gold}`,
  },
  // Tabs are absolutely positioned inside this box so that pinning can spring a tab
  // across to its new slot; a flex reorder could only teleport it. The box tracks the
  // strip's own width so the trailing "+" follows the tabs instead of jumping.
  strip: { position: 'relative', flex: 'none', height: TAB_HEIGHT },
  tabIcon: { flexShrink: 0, color: cssVar.colorTextSecondary },
  unreadDot: {
    position: 'absolute',
    insetBlockEnd: '-2px',
    insetInlineEnd: '-2px',
    width: '8px',
    height: '8px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgLayout,
    borderRadius: '50%',
    backgroundColor: cssVar.colorInfo,
    backgroundImage: 'none',
  },
});
