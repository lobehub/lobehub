import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  backHeader: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  categoryExtra: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    align-items: center;

    max-width: 180px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  container: css`
    position: fixed;
    z-index: 99999;

    display: flex;
    flex-direction: column;

    min-width: 260px;
    max-width: 360px;
    max-height: 360px;
    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  divider: css`
    height: 1px;
    margin-block: 4px;
    margin-inline: 8px;
    background: ${cssVar.colorBorder};
  `,
  empty: css`
    padding-block: 16px;
    padding-inline: 12px;

    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 6px;

    font-size: 13px;

    transition: background 0.1s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemWithCategoryExtra: css`
    padding-inline-end: 6px;
  `,
  itemActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  itemIcon: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 6px;
  `,
  itemLabel: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  localFileName: css`
    overflow: hidden;
    flex: 1;

    min-width: 88px;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  localFilePath: css`
    overflow: hidden;
    flex: 0 1 auto;

    max-width: 190px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scrollArea: css`
    overflow-y: auto;
    flex: 1;
    margin: -4px;
    padding: 4px;
  `,
}));
