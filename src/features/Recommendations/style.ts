import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
    }
  `,
  iconTile: css`
    flex-shrink: 0;
    background: ${cssVar.colorFillSecondary};
  `,
  subtitle: css`
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));
