import * as stylex from '@stylexjs/stylex';

import { densityTokens } from '@/styles/density.stylex';

export const vaultStyles = stylex.create({
  /** The outlined card both vault tabs list their credentials in. */
  container: {
    overflow: 'hidden',
    width: '100%',
    paddingBlock: '4px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
});
