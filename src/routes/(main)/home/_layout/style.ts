import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  absoluteContainer: css`
    position: absolute;
    inset: 0;
  `,

  content: css`
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
}));
