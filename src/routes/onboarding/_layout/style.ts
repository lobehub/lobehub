import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    height: 24px;
  `,

  innerContainer: css`
    position: relative;

    overflow: hidden auto;

    border-radius: 10px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,

  innerContainerMobile: css`
    position: relative;
    overflow: hidden auto;
    background: ${cssVar.colorBgContainer};
  `,

  outerContainer: css`
    position: relative;
  `,
}));
