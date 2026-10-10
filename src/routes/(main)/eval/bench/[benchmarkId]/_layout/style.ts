import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  mainContainer: css`
    position: relative;
    overflow: auto;
    background: ${cssVar.colorBgContainer};
  `,
}));
