import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    padding-block: 16px;
    padding-inline: 20px;
  `,

  empty: css`
    padding-block: 48px;
    padding-inline: 0;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,

  groupHeader: css`
    padding-block: 8px;
    padding-inline: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
  `,

  row: css`
    display: grid;
    grid-template-columns: 1fr 140px 120px 100px 80px 64px;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 120ms ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,

  rowHeader: css`
    display: grid;
    grid-template-columns: 1fr 140px 120px 100px 80px 64px;
    gap: 12px;

    padding: 8px;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
  `,

  commandCell: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,

  statusExited: css`
    color: ${cssVar.colorTextSecondary};
  `,

  statusKilled: css`
    color: ${cssVar.colorError};
  `,

  statusRunning: css`
    color: ${cssVar.colorSuccess};
  `,

  toolbar: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block-end: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
