import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,

  row: css`
    padding-block: 4px;
  `,

  rowLabel: css`
    font-size: 14px;
    font-weight: 500;
  `,
}));
