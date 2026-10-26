import { createStaticStyles } from '@lobehub/ui';

// The rail wrap (`routes/(main)/_layout/style.ts`) owns the border, radius and
// outer spacing; this container only fills the content column inside it.
export const styles = createStaticStyles(({ css, cssVar }) => ({
  innerContainer: css`
    position: relative;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,

  outerContainer: css`
    position: relative;
    overflow: hidden;
    min-width: 0;
  `,
}));
