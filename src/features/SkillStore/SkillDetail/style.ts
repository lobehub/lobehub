import { createStaticStyles, responsive } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const agentListStyles = createStaticStyles(({ css }) => ({
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
