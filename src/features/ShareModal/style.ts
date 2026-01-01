import { createStaticStyles, responsive } from 'antd-style';

// Dynamic styles with widthMode prop - converted to CSS variables
export { styles as containerStyles } from './useContainerStyles';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    ${responsive.sm} {
      padding-block-end: 68px;
    }
  `,
  footer: css`
    ${responsive.sm} {
      position: absolute;
      inset-block-end: 0;
      inset-inline: 0;

      width: 100%;
      margin: 0;
      padding: 16px;

      background: ${cssVar.colorBgContainer};
    }
  `,
  sidebar: css`
    flex: none;
    width: max(240px, 25%);
    ${responsive.sm} {
      flex: 1;
      width: unset;
      margin-inline: -16px;
    }
  `,
}));
