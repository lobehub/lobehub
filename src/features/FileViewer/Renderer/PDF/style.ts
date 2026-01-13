import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    height: 100%;
  `,
  document: css`
    position: relative;
  `,
  documentContainer: css`
    flex: 1;
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
