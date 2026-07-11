import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  row: css`
    cursor: pointer;
    padding-block: 8px;
  `,

  rowLabel: css`
    font-size: 14px;
    color: ${cssVar.colorText};
  `,

  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));
