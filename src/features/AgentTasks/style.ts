import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  container: css`
    overflow-y: auto;
    flex: 1;
  `,
  content: css`
    align-self: center;
    width: min(100%, 960px);
    padding-block: 16px;
    padding-inline: 16px;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: 12px;
  `,
  switchGroup: css`
    display: flex;
    gap: 2px;

    padding: 2px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,
}));
