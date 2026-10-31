import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import moduleStyles from './useContainerStyles.module.css';

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

type PreviewVariant = 'narrow' | 'text' | 'wide';

const variantStyles = {
  narrow: styles.previewNarrow,
  text: styles.previewText,
  wide: styles.previewWide,
} as const;

/** Class names of the framed preview surface, for one of its width variants. */
export const previewClassName = (variant: PreviewVariant) =>
  `${stylex.props(styles.preview, variantStyles[variant]).className} ${moduleStyles.preview}`;
