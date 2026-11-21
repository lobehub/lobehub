import { createStaticStyles, responsive } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export { styles as containerStyles } from './useContainerStyles';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    flex: none;
    gap: 8px;

    min-height: 64px;
    padding-block: ${densityVars.contentGap};
    padding-inline: 20px 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    ${responsive.sm} {
      flex-direction: column;
      align-items: stretch;
      padding-block-end: ${densityVars.cardPadding};
      padding-inline: ${densityVars.cardPadding};
    }
  `,
  footerActions: css`
    ${responsive.sm} {
      > * {
        flex: 1;
      }
    }
  `,
  meta: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;

    ${responsive.sm} {
      text-align: center;
    }
  `,
  stage: css`
    position: relative;

    overflow: auto;
    flex: 1;

    min-height: 0;
    padding-block: 24px 0;
    padding-inline: 32px;

    background: ${cssVar.colorBgLayout};

    ${responsive.sm} {
      padding-block-start: ${densityVars.cardPadding};
      padding-inline: ${densityVars.cardPadding};
    }
  `,
  toolbar: css`
    overflow-x: auto;
    flex: none;
    gap: 6px;

    min-height: 48px;
    padding-inline: ${densityVars.cardPadding};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    white-space: nowrap;

    ::-webkit-scrollbar {
      display: none;
    }

    ${responsive.sm} {
      flex-wrap: wrap;
      padding-block: 8px;
      white-space: normal;
    }
  `,
  toolbarDivider: css`
    flex: none;

    width: 1px;
    height: 18px;
    margin-inline: 6px;

    background: ${cssVar.colorBorder};

    ${responsive.sm} {
      display: none;
    }
  `,
}));
