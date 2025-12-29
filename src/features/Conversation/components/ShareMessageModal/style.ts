import { lobeStaticStylish } from '@lobehub/ui';
import { createStaticStyles, cx , responsive } from 'antd-style';

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
  preview: cx(
    lobeStaticStylish.noScrollbar,
    css`
      overflow: hidden scroll;

      width: 100%;
      max-height: 70dvh;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgLayout};

      * {
        pointer-events: none;

        ::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
        }
      }

      ${responsive.sm} {
        max-height: 40dvh;
      }
    `,
  ),
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
