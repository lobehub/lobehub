import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Absolutely positioned container, fills parent
  absoluteContainer: css`
    position: absolute;
    inset: 0;
  `,

  // Content area - dark mode
  contentDark: css`
    overflow: hidden;
    background: linear-gradient(
      to bottom,
      ${cssVar.colorBgContainer},
      var(--content-bg-secondary, ${cssVar.colorBgContainer})
    );
  `,

  // Content area - light mode
  contentLight: css`
    overflow: hidden;
    background: var(--content-bg-secondary, ${cssVar.colorBgContainer});
  `,
}));
