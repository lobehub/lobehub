import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    padding-block: 8px 10px;
    padding-inline: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    /* ChatInput rounds its border without clipping, so this tinted strip would
      paint square over the card's bottom corners. Sits inside the 1px border. */
    border-end-start-radius: calc(${cssVar.borderRadiusLG} - 1px);
    border-end-end-radius: calc(${cssVar.borderRadiusLG} - 1px);

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary});

    &:empty {
      display: none;
    }
  `,
  container: css`
    margin-block-end: 12px;
  `,
  content: css`
    /* ChatInput's maxHeight owns the vertical scrolling; an overflow:auto here
      never scrolls itself but still severs position:sticky inside intervention
      bodies from that real scroll container. */
    overflow-y: visible;
    flex: 1;
    min-height: 0;
    padding-block: 0 8px;
  `,
  tabBar: css`
    overflow-x: auto;
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tabCounter: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  tabTrailing: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    margin-inline-start: auto;
    padding-block: 4px;
    padding-inline: 10px;
  `,
}));
