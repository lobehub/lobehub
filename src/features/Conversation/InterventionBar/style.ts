import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    padding-block: 8px 10px;
    padding-inline: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
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
  tab: css`
    cursor: pointer;

    padding-block: 5px;
    padding-inline: 10px;
    border-block-end: 2px solid transparent;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition:
      border-color 0.2s,
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    border-block-end-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};
  `,
  tabBar: css`
    overflow-x: auto;
    display: flex;
    align-items: center;
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
