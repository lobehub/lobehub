import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    &:empty {
      display: none;
    }
  `,
  /**
   * Footer row: stop on the left, the per-card Submit (portalled into
   * `actions`) on the right. The chrome that used to sit on `actions` moved
   * here so the row keeps its border and background even when the portal is
   * still empty — otherwise the stop button would float without a bar.
   */
  footer: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px 10px;
    padding-inline: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary});
  `,
  container: css`
    margin-block-end: 12px;
  `,
  content: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-block: 6px 8px;
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
