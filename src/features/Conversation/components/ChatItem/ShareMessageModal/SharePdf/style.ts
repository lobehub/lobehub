import { createStyles } from 'antd-style';

export const useContainerStyles = createStyles(({ css, token, stylish, cx, responsive }) => ({
  preview: cx(
    stylish.noScrollbar,
    css`
      overflow: hidden scroll;

      width: 100%;
      max-height: 70dvh;
      border: 1px solid ${token.colorBorder};
      border-radius: ${token.borderRadiusLG}px;

      background: ${token.colorBgLayout};

      /* stylelint-disable selector-class-pattern */
      .react-pdf__Document *,
      .react-pdf__Page * {
        pointer-events: none;
      }
      /* stylelint-enable selector-class-pattern */

      ::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }

      ${responsive.mobile} {
        max-height: 40dvh;
      }
    `,
  ),
}));

export const useStyles = createStyles(({ responsive, token, css }) => ({
  body: css`
    ${responsive.mobile} {
      padding-block-end: 68px;
    }
  `,
  footer: css`
    ${responsive.mobile} {
      position: absolute;
      inset-block-end: 0;
      inset-inline: 0;

      width: 100%;
      margin: 0;
      padding: 16px;

      background: ${token.colorBgContainer};
    }
  `,
  sidebar: css`
    flex: none;
    width: max(240px, 25%);
    ${responsive.mobile} {
      flex: 1;
      width: unset;
      margin-inline: -16px;
    }
  `,
}));
