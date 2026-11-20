import { createStaticStyles, cssVar } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css }) => ({
  dropZone: css`
    position: relative;
    height: 100%;
  `,
  dropZoneActive: css`
    background: ${cssVar.colorPrimaryBg};
    outline: 1px dashed ${cssVar.colorPrimaryBorder};
    outline-offset: -4px;
  `,
  header: css`
    min-width: 1040px;
    height: ${densityVars.toolbarHeight};
    min-height: ${densityVars.toolbarHeight};
    color: ${cssVar.colorTextDescription};
  `,
  headerItem: css`
    height: 100%;
    padding-block: 6px;
    padding-inline: 0 24px;
  `,
  headerItemSortable: css`
    cursor: pointer;
    user-select: none;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  scrollContainer: css`
    overflow: auto hidden;
    flex: 1;
  `,
  selectAllHint: css`
    position: sticky;
    z-index: 1;
    inset-block-start: ${densityVars.toolbarHeight};

    min-width: 1040px;
    padding-block: 8px;
    padding-inline: ${densityVars.cardPadding};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillTertiary};
  `,
}));
