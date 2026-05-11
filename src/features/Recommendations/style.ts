import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
    }
  `,
  subtitle: css`
    color: ${cssVar.colorTextDescription};
  `,
}));
