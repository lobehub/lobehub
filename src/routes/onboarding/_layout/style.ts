import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Divider style
  divider: css`
    height: 24px;
  `,

  // Inner container - dark mode
  innerContainerDark: css`
    position: relative;

    overflow: hidden auto;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  // Inner container - light mode
  innerContainerLight: css`
    position: relative;

    overflow: hidden auto;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  // Outer container
  outerContainer: css`
    position: relative;
  `,
}));
