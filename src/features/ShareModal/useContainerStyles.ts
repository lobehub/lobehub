// oxlint-disable-next-line stylex-migration/no-emotion-styles -- react-pdf Document/Page DOM takes no className
import { createStaticStyles, cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  preview: {
    overflow: 'hidden',
    width: '100%',
    maxWidth: 'var(--preview-max-width, none)',
    minHeight: '100%',
    margin: 'var(--preview-margin,0 auto)',
    borderStartStartRadius: cssVar.borderRadiusLG,
    borderStartEndRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: `0 0 0 1px ${cssVar.colorFillTertiary},
      0 8px 24px color-mix(in srgb, ${cssVar.colorText} 8%, transparent)`,
  },
  previewNarrow: { '--preview-max-width': '480px' },
  previewText: { '--preview-max-width': '720px' },
  previewWide: { '--preview-max-width': '880px' },
});

const fallback = createStaticStyles(({ css }) => ({
  preview: css`
    .react-pdf__Document *,
    .react-pdf__Page * {
      pointer-events: none;
    }
  `,
}));

type PreviewVariant = 'narrow' | 'text' | 'wide';

const variantStyles = {
  narrow: styles.previewNarrow,
  text: styles.previewText,
  wide: styles.previewWide,
} as const;

/** Class names of the framed preview surface, for one of its width variants. */
export const previewClassName = (variant: PreviewVariant) =>
  cx(stylex.props(styles.preview, variantStyles[variant]).className, fallback.preview);
