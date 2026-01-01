import { lobeStaticStylish } from '@lobehub/ui';
import { createStaticStyles, cx, responsive } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  preview: cx(
    lobeStaticStylish.noScrollbar,
    css`
      overflow: hidden scroll;

      width: 100%;
      max-width: var(--preview-max-width, none);
      max-height: 70dvh;
      margin: var(--preview-margin, 0);
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgLayout};

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

      ${responsive.sm} {
        max-height: 40dvh;
      }
    `,
  ),
  previewNarrow: css`
    --preview-max-width: 480px;
    --preview-margin: 0 auto;
  `,
  previewWide: css`
    --preview-max-width: none;
    --preview-margin: 0;
  `,
}));
