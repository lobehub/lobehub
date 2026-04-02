import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    align-self: center;
    width: min(100%, 960px);
    padding-inline: 16px;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: 8px;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 16px;
    padding-inline: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};

    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 50%;
  `,
  viewAll: css`
    cursor: pointer;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));
