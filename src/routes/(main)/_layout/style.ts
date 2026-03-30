import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Main container - non-PWA mode (no top border)
  mainContainer: css`
    position: relative;
  `,

  // Main container - PWA mode (with top border)
  mainContainerPWA: css`
    position: relative;
    border-block-start: 1px solid ${cssVar.colorBorder};
  `,
}));
