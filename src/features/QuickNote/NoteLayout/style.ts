import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  listColumn: css`
    overflow: hidden;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  mainContainer: css`
    position: relative;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
}));
