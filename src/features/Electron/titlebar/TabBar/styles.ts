import { createStaticStyles } from 'antd-style';

const TAB_HEIGHT = 26;

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  avatarWrapper: css`
    position: relative;
    flex-shrink: 0;
    line-height: 0;
  `,
  closeIcon: css`
    position: absolute;
    inset-inline-end: 4px;

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
  tab: css`
    cursor: default;
    user-select: none;

    position: relative;

    display: flex;
    flex-shrink: 0;
    align-items: center;

    height: ${TAB_HEIGHT}px;
    padding-inline: 8px 6px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;

    background-color: transparent;

    /* No transition here: dnd-kit writes its own into the inline style, which would win
       over anything declared in this class. TabItem composes both. */

    &:hover {
      background-color: ${cssVar.colorFillQuaternary};
    }

    /* Persistent on a full tab, hover-only on a compact one. Narrower tiers carry no
       close button at all — see TabItem. */
    &[data-tier='full'] [data-tab-close],
    &:hover [data-tab-close] {
      opacity: 1;
    }

    /* Reserve the button's footprint whether or not it is currently visible, so the
       title's ellipsis lands before it. Fading the title out under the button instead
       leaves half-opaque glyphs inside the gradient, which reads as an overlap. Keeping
       the reservation constant also stops the text reflowing on hover. */
    &[data-tier='full'] [data-tab-title],
    &[data-tier='compact'] [data-tab-title] {
      padding-inline-end: 22px;
    }
  `,
  pinnedDivider: css`
    align-self: center;

    width: 1px;
    height: 18px;
    margin-inline: 6px;

    background-color: ${cssVar.colorBorder};
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
    text-overflow: ellipsis;
    white-space: nowrap;
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
