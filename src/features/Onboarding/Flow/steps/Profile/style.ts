import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyState: css`
    font-size: 14px;
    color: ${cssVar.colorTextDescription};
  `,

  paragraph: css`
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorText};
  `,

  scrollArea: css`
    overflow-y: auto;
    max-height: 320px;
  `,

  sectionSkeleton: css`
    width: 100%;
    height: 16px;
  `,

  sectionTitle: css`
    font-size: 15px;
    font-weight: 600;
  `,

  tellUsMore: css`
    flex: none;
  `,
}));
