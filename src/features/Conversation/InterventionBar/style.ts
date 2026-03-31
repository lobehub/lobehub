import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  actions: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
  `,
  container: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    max-height: 50vh;
    margin-block-end: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;

    background: ${token.colorBgContainer};
  `,
  content: css`
    overflow-y: auto;
    flex: 1;

    min-height: 0;
    padding-block: 12px;
    padding-inline: 16px;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 14px;
    border-block-end: 2px solid transparent;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${token.colorText};
    }
  `,
  tabActive: css`
    border-block-end-color: ${token.colorPrimary};
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  tabBar: css`
    overflow-x: auto;
    display: flex;
    align-items: center;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  tabCounter: css`
    margin-inline-start: auto;
    padding-block: 6px;
    padding-inline: 14px;

    font-size: 11px;
    color: ${token.colorTextTertiary};
    white-space: nowrap;
  `,
}));
