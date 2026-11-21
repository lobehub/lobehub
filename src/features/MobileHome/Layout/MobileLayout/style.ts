import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css }) => ({
  // Search bar container
  searchBarContainer: css`
    padding-block: 8px;
    padding-inline: ${densityVars.cardPadding};
  `,
}));
