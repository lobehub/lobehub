// oxlint-disable-next-line stylex-migration/no-emotion-styles -- `* { user-select }` reaches route-owned panel content
import { createStaticStyles } from '@lobehub/ui';

export const fallback = createStaticStyles(({ css }) => ({
  panel: css`
    * {
      user-select: none;
    }
  `,
}));
