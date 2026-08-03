import { createStaticStyles } from 'antd-style';

const TAB_HEIGHT = 26;

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  avatarWrapper: css`
    position: relative;
    flex-shrink: 0;
    line-height: 0;
  `,
  closeIcon: css`
    pointer-events: none;

    position: absolute;
    inset-inline-end: 3px;

    flex-shrink: 0;

    color: ${cssVar.colorTextTertiary};

    opacity: 0;

    transition: opacity 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  runningDot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgLayout};
    border-radius: 50%;

    background: ${cssVar.gold};
    box-shadow: 0 0 6px ${cssVar.gold};
  `,
  unreadDot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgLayout};
    border-radius: 50%;

    background: ${cssVar.colorInfo};
  `,
  container: css`
    flex: 1;
    min-width: 0;
  `,
  // Tabs are absolutely positioned inside this box so that pinning can spring a tab
  // across to its new slot; a flex reorder could only teleport it. The box tracks the
  // strip's own width so the trailing "+" follows the tabs instead of jumping.
  strip: css`
    position: relative;
    flex: none;
    height: ${TAB_HEIGHT}px;
  `,
  tab: css`
    cursor: default;
    user-select: none;

    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    height: ${TAB_HEIGHT}px;
    padding-inline: 8px 6px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;

    background-color: transparent;

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillQuaternary};
    }

    /* Persistent on a full tab, hover-only on a compact one. Below that the tab cannot
       spare the button's 20px: the title would be cut to a couple of glyphs to make room
       for it, and at icon width the icon is the only identity signal left. Pinned tabs
       are always at icon width, so they fall out of this rule too. The button stays
       mounted at every tier and fades — unmounting it made it vanish mid-pin. */
    &[data-tier='full'] [data-tab-close],
    &[data-tier='compact']:hover [data-tab-close] {
      pointer-events: auto;
      opacity: 1;
    }

    /* Reserve the button's footprint whether or not it is currently visible, so the
       title's fade lands before it and no glyph is ever drawn under the button. Margin
       rather than padding: the mask applies to the padding box, so padding would put the
       gradient inside the reservation instead of at the text's edge. Keeping the
       reservation constant also stops the text reflowing on hover.
       20px button + 3px inset - the tab's own 6px end padding. */
    &[data-tier='full'] [data-tab-title],
    &[data-tier='compact'] [data-tab-title] {
      margin-inline-end: 17px;
    }

    /* The avatar is the only thing left, so centre it and collapse the title rather than
       unmounting it — the tab is mid-shrink at this point and a title that pops out of
       the flow would jerk the avatar sideways instead of gliding it to the middle. */
    &[data-tier='icon'] {
      gap: 0;
      justify-content: center;
      padding-inline: 0;

      [data-tab-title] {
        flex: none;
        width: 0;
        opacity: 0;
      }
    }
  `,
  pinnedDivider: css`
    position: absolute;
    inset-block-start: 4px;
    inset-inline-start: 0;

    width: 1px;
    height: 18px;

    background-color: ${cssVar.colorBorder};

    transition: opacity 0.18s ${cssVar.motionEaseInOut};
  `,
  // A pinned tab renders at icon width, which is pixel-identical to an unpinned tab
  // squeezed by a crowded strip — the surface is what tells the two apart. Declared
  // ahead of `tabActive` so that an active pinned tab still reads as active:
  // createStaticStyles settles equal specificity by definition order.
  tabPinned: css`
    background-color: ${cssVar.colorFillQuaternary};

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  overflowButton: css`
    cursor: default;

    flex-shrink: 0;
    justify-content: center;

    height: 22px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  tabDragging: css`
    cursor: grabbing;
    z-index: 1;
    background-color: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  // The active tab floats above the titlebar rather than merging into the content card.
  // An attached (Chrome-style) treatment was built and tried on the real desktop app and
  // rejected: the seam it produced read worse than the separation it replaced.
  tabActive: css`
    background-color: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    &:hover {
      background-color: ${cssVar.colorBgElevated};
    }

    html.desktop[data-theme='dark'] & {
      background-color: ${cssVar.colorFillSecondary};
      box-shadow: inset 0 0 0 1px ${cssVar.colorBorderSecondary};

      &:hover {
        background-color: ${cssVar.colorFillSecondary};
      }
    }
  `,
  tabIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  tabTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorText};
    white-space: nowrap;

    transition: opacity 0.12s ${cssVar.motionEaseInOut};

    /* The one physical direction left in this file — mask-image has no logical form, and
       nothing in the app sets dir="rtl". max(60%, …) caps the ramp at 40% of the box:
       a narrow tab leaves the title barely 22px to live in, and a flat 20px ramp would
       swallow the whole word rather than trailing it off. */
    mask-image: linear-gradient(to right, #000 max(60%, calc(100% - 20px)), transparent);
  `,
  newTabButton: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 22px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    transition:
      background-color 0.15s ${cssVar.motionEaseInOut},
      color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
}));
