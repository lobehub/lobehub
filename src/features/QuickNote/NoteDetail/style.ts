import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  editorColumn: css`
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  `,
  sectionHeader: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
