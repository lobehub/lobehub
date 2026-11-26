import { createStaticStyles, responsive } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const gridStyles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: ${densityVars.contentGap};

    padding-block-end: ${densityVars.cardPadding};
    padding-inline: ${densityVars.cardPadding};

    ${responsive.sm} {
      grid-template-columns: 1fr;
    }
  `,
  // Borderless page rows (SkillListRow) carry their own padding and hover, so
  // they sit closer together, spaced like the Connectors page catalog.
  rows: css`
    row-gap: 4px;
    column-gap: 32px;
    padding-inline: 4px;
  `,
}));

export const virtuosoGridStyles = createStaticStyles(({ css }) => ({
  item: css`
    width: calc(50% - 6px);

    ${responsive.sm} {
      width: 100%;
    }
  `,
  list: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${densityVars.contentGap};

    padding-block-end: ${densityVars.cardPadding};
    padding-inline: ${densityVars.cardPadding};
  `,
}));

export const masonicGridStyles = createStaticStyles(({ css }) => ({
  list: css`
    padding-block-end: ${densityVars.cardPadding};
    padding-inline: ${densityVars.cardPadding};
  `,
}));

export const itemStyles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;

    font-size: ${densityVars.fontSize};
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
