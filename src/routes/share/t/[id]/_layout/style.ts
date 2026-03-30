import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100vw;
    min-height: 100vh;
    background: ${cssVar.colorBgLayout};
  `,

  content: css`
    flex: 1;
    width: 100%;
  `,

  // Divider style
  divider: css`
    height: 24px;
  `,

  footer: css`
    padding-block: 16px;
    padding-inline: 24px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,

  header: css`
    height: 52px;
    padding: 8px;
  `,

  // Inner container - dark mode
  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  // Inner container - light mode
  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  // Outer container
  outerContainer: css`
    position: relative;
  `,
}));
