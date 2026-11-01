import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  preview: css`
    overflow: hidden;

    width: 100%;
    max-width: var(--preview-max-width, none);
    min-height: 100%;
    margin: var(--preview-margin, 0 auto);
    border-start-start-radius: ${cssVar.borderRadiusLG};
    border-start-end-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 0 0 1px ${cssVar.colorFillTertiary},
      0 8px 24px color-mix(in srgb, ${cssVar.colorText} 8%, transparent);

    /* stylelint-disable selector-class-pattern */
    .react-pdf__Document *,
    .react-pdf__Page * {
      pointer-events: none;
    }
    /* stylelint-enable selector-class-pattern */
  `,
  previewNarrow: css`
    --preview-max-width: 480px;
  `,
  previewText: css`
    --preview-max-width: 720px;
  `,
  previewWide: css`
    --preview-max-width: 880px;
  `,
}));
