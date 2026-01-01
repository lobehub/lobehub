'use client';

import { createStaticStyles, useThemeMode } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dividerDark: css`
    flex: none;
    width: 100%;
    height: 6px;
    background: color-mix(in srgb, ${cssVar.colorFillTertiary} 4%, transparent);
  `,
  dividerLight: css`
    flex: none;
    width: 100%;
    height: 6px;
    background: ${cssVar.colorFillTertiary};
  `,
}));

const Divider = memo(() => {
  const { isDarkMode } = useThemeMode();

  return <div className={isDarkMode ? styles.dividerDark : styles.dividerLight} />;
});

export default Divider;
