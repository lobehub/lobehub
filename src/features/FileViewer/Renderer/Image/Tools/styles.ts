import { createStaticStyles, cssVar } from 'antd-style';

/** Shared chrome for the floating bottom bar and side panels of the image tools. */
export const toolStyles = createStaticStyles(({ css }) => ({
  bar: css`
    pointer-events: auto;

    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    align-items: center;
    justify-content: center;

    max-width: 100%;
    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  divider: css`
    flex-shrink: 0;

    width: 1px;
    height: 20px;
    margin-inline: 4px;

    background: ${cssVar.colorSplit};
  `,
  dock: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;
    inset-block-end: 12px;
    inset-inline: 12px;

    display: flex;
    justify-content: center;
  `,
  hint: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  overlayFill: css`
    position: absolute;
    inset: 0;
  `,
  panel: css`
    position: absolute;
    z-index: 3;
    inset-block: 52px 68px;
    inset-inline-end: 8px;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: min(280px, calc(100% - 16px));
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  /** The panel on a narrow viewer: a sheet above the bar, as wide as the viewer. */
  sheet: css`
    position: absolute;
    z-index: 3;
    inset-block-end: 60px;
    inset-inline: 8px;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    max-height: 40%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  swatch: css`
    cursor: pointer;

    width: 20px;
    height: 20px;
    padding: 0;
    border: 2px solid ${cssVar.colorBorder};
    border-radius: 50%;

    &[aria-pressed='true'] {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 1px;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
}));
