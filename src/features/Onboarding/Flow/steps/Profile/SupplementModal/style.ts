import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 8px 20px;
    padding-inline: 20px;
  `,

  description: css`
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,

  sectionLabel: css`
    font-size: 14px;
    font-weight: 600;
  `,
}));
