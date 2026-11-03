import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  mainContainer: css`
    position: relative;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
}));
