import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  container: css`
    margin-block-end: 12px;
  `,
  content: css`
    overflow-y: auto;
    flex: 1;

    min-height: 0;
    padding-block: 8px 12px;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 14px;
    border-block-end: 2px solid transparent;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

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
    margin-inline-start: auto;
    padding-block: 6px;
    padding-inline: 14px;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
}));
