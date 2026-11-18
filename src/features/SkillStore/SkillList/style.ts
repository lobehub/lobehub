import { createStaticStyles, responsive } from '@lobehub/ui';

export const gridStyles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    padding-block-end: 16px;
    padding-inline: 16px;

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
    gap: 12px;

    padding-block-end: 16px;
    padding-inline: 16px;
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

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
