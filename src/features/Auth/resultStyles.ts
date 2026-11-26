// oxlint-disable-next-line stylex-migration/no-emotion-styles -- Result renders its subtitle paragraph without a slot
import { createStaticStyles } from '@lobehub/ui';

export const resultStyles = createStaticStyles(({ css }) => ({
  fullWidthSubTitle: css`
    p {
      max-width: 100%;
    }
  `,
}));
