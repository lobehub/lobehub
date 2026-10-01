import { createStaticStyles, cssVar } from 'antd-style';

/**
 * One sheet, Linear-style: a sticky header row, one hairline per row, group rows that run the
 * full width, and hover-only controls. The grid is shared by the header row and every rule row
 * so the columns line up without a table element.
 */
export const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
  `,
  cellId: css`
    padding-block-start: 2px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  chevron: css`
    display: inline-flex;
    color: ${cssVar.colorTextTertiary};
    transition: transform 0.15s;
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  divider: css`
    padding-block: 22px 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: 22px 40px minmax(220px, 2fr) 56px 64px 64px 28px;
    column-gap: 8px;
    align-items: start;
  `,
  hover: css`
    opacity: 0;
    transition: opacity 0.15s;
  `,
  modeBlock: css`
    color: ${cssVar.colorPrimary};
  `,
  modeBtn: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  modeRemind: css`
    color: ${cssVar.colorTextTertiary};
  `,
  muted: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 13px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowArchived: css`
    color: ${cssVar.colorTextTertiary};
  `,
  rowHover: css`
    &:hover [data-hover] {
      opacity: 1;
    }
  `,
  section: css`
    cursor: pointer;
    user-select: none;

    position: relative;

    display: flex;
    gap: 8px;
    align-items: center;

    height: 34px;
    margin-block-start: 10px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover [data-hover] {
      opacity: 1;
    }

    &:hover [data-line] {
      margin-inline-end: 64px;
    }
  `,
  sectionActions: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 8px;
    transform: translateY(-50%);
  `,
  sectionCollapsed: css`
    background: ${cssVar.colorFillQuaternary};
  `,
  sectionCount: css`
    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextTertiary};
  `,
  sectionLine: css`
    flex: 1;
    height: 1px;
    margin-inline: 4px -8px;
    background: ${cssVar.colorBorderSecondary};
  `,
  sectionScope: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
  `,
  thead: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 6px 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorder};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    font-weight: 500;
    text-wrap: pretty;
  `,
}));
