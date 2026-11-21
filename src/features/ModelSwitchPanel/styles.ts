import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    pointer-events: auto;
    user-select: none;
    overflow: hidden;
    padding: 0 !important;
  `,
  detailPopup: css`
    user-select: none;
    overscroll-behavior: contain;
    width: 400px;
  `,
  dropdownMenu: css`
    user-select: none;

    [role='menuitem'] {
      margin-block: 1px;
      margin-inline: 4px;
      padding-block: 8px;
      padding-inline: 8px;
      border-radius: ${cssVar.borderRadiusSM};
    }

    html[data-density='compact'] & [role='menuitem'] {
      min-height: ${densityVars.controlHeight};
      padding-block: calc((${densityVars.controlHeight} - 20px) / 2);
      border-radius: ${densityVars.radius};

      font-size: ${densityVars.fontSize};
      line-height: 20px;
    }
  `,
  groupHeader: css`
    width: 100%;
    color: ${cssVar.colorTextSecondary};
  `,
  list: css`
    position: relative;
    overflow: hidden auto;
    overscroll-behavior: contain;
    width: 100%;
  `,
  menuItem: css`
    cursor: pointer;

    position: relative;

    gap: 8px;
    align-items: center;

    margin-block: 1px;
    margin-inline: 4px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    html[data-density='compact'] & {
      min-height: ${densityVars.controlHeight};
      padding-block: calc((${densityVars.controlHeight} - 20px) / 2);
      border-radius: ${densityVars.radius};

      font-size: ${densityVars.fontSize};
      line-height: 20px;
    }
  `,
  rowTrigger: css`
    padding-block: 8px;
    padding-inline: 8px;

    html[data-density='compact'] & {
      min-height: ${densityVars.controlHeight};
      padding-block: calc((${densityVars.controlHeight} - 20px) / 2);
      border-radius: ${densityVars.radius};

      font-size: ${densityVars.fontSize};
      line-height: 20px;
    }
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  footer: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  toolbar: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trigger: css`
    display: inline-flex;
    outline: none;

    /* SVG icons (from @lobehub/icons IconAvatar) can receive focus when dropdown closes,
       causing an unwanted blue outline ring */
    svg:focus {
      outline: none;
    }
  `,
}));
