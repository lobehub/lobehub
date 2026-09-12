import { createStaticStyles } from 'antd-style';

/** Shared card chrome for device lists and device/pool detail content. */
export const deviceSurfaceStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));
