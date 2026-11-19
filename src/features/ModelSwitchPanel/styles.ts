import { createStaticStyles } from '@lobehub/ui';

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
      min-height: var(--lobe-density-control-height);
      margin-block: 1px;
      margin-inline: 4px;
      padding-block: calc((var(--lobe-density-control-height) - 20px) / 2);
      padding-inline: 8px;
      border-radius: var(--lobe-density-radius);

      font-size: var(--lobe-density-font-size);
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

    min-height: var(--lobe-density-control-height);
    margin-block: 1px;
    margin-inline: 4px;
    padding-block: calc((var(--lobe-density-control-height) - 20px) / 2);
    padding-inline: 8px;
    border-radius: var(--lobe-density-radius);

    font-size: var(--lobe-density-font-size);
    line-height: 20px;
  `,
  rowTrigger: css`
    min-height: var(--lobe-density-control-height);
    padding-block: calc((var(--lobe-density-control-height) - 20px) / 2);
    padding-inline: 8px;
    border-radius: var(--lobe-density-radius);

    font-size: var(--lobe-density-font-size);
    line-height: 20px;
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
