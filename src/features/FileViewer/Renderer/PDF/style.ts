import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    min-height: 100%;
  `,
  document: css`
    position: relative;
  `,
  documentContainer: css`
    padding-block: 10px;
    background-color: ${cssVar.colorBgLayout};
  `,
  page: css`
    overflow: hidden;
    margin-block-end: 12px;
    border-radius: 4px;
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
}));
