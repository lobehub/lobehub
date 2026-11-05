import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// Mirrors TAB_ICON_SIZE / TAB_HEIGHT in ./tabLayout and this file's former constants.
const TAB_ICON_SIZE = '16px';
const TAB_HEIGHT = '26px';
const DARK_DESKTOP = ':is(html.desktop[data-theme="dark"] *)';

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
  closeIcon: {
    pointerEvents: 'none',
    position: 'absolute',
    insetInlineEnd: '3px',
    flexShrink: 0,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    opacity: 0,
    transition: `opacity 0.15s ${cssVar.motionEaseInOut}`,
  },
  // The button and the 17px reserved for it in tabTitleReserved are gated together, so the
  // title's fade never runs under a revealed button. Gated off below the compact tier,
  // where the tab cannot spare the room. :focus-visible carries the keyboard path.
  closeIconRevealed: {
    pointerEvents: {
      'default': 'none',
      ':focus-visible': 'auto',
      [stylex.when.ancestor(':hover')]: 'auto',
    },
    opacity: { 'default': 0, ':focus-visible': 1, [stylex.when.ancestor(':hover')]: 1 },
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
  tab: {
    cursor: 'default',
    userSelect: 'none',
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: 'flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    height: TAB_HEIGHT,
    paddingInlineStart: '8px',
    paddingInlineEnd: '6px',
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    transition: `background-color 0.15s ${cssVar.motionEaseInOut}, box-shadow 0.15s ${cssVar.motionEaseInOut}`,
  },
  // Merged after tabPinned and tabDragging so an active pinned or dragged tab reads as active.
  tabActive: {
    boxShadow: {
      default: cssVar.boxShadowTertiary,
      [DARK_DESKTOP]: `inset 0 0 0 1px ${cssVar.colorBorderSecondary}`,
    },
    backgroundColor: { default: cssVar.colorBgElevated, [DARK_DESKTOP]: cssVar.colorFillSecondary },
  },
  tabDragging: {
    cursor: 'grabbing',
    boxShadow: cssVar.boxShadowSecondary,
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorFillQuaternary },
  },
  // While dragging, hover still resolves to the resting (or pinned) hover surface, as it did
  // when the dragging rule lost to the base :hover rule on specificity.
  tabDraggingPinned: {
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorFillTertiary },
  },
  tabIcon: { flexShrink: 0, color: cssVar.colorTextSecondary },
  tabPinned: {
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
  },
  tabSplitVisible: {
    '::after': {
      content: "''",
      position: 'absolute',
      insetBlockEnd: '1px',
      insetInline: '8px',
      height: '1px',
      borderRadius: '1px',
      opacity: 0.65,
      backgroundColor: cssVar.colorPrimary,
      backgroundImage: 'none',
    },
  },
  tabTitle: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: '12px',
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
    transition: `margin-inline-end 0.15s ${cssVar.motionEaseInOut}, opacity 0.12s ${cssVar.motionEaseInOut}`,
    maskImage: 'linear-gradient(to right, #000 max(60%, calc(100% - 20px)), transparent)',
  },
  // Fade only: the tier flips a whole spring before the width arrives, so anything that
  // moves layout here would jump ahead of the box.
  tabTitleHidden: { opacity: 0 },
  // Margin rather than padding: the mask applies to the padding box.
  tabTitleReserved: {
    marginInlineEnd: {
      'default': null,
      ':has(~ [data-tab-close]:focus-visible)': '17px',
      [stylex.when.ancestor(':hover')]: '17px',
    },
  },
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
