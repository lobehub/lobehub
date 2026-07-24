'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router';

const styles = createStaticStyles(({ css }) => ({
  path: css`
    overflow: hidden;

    max-width: 320px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const RoutePathWidget = memo(() => {
  const { pathname } = useLocation();
  return (
    <span className={styles.path} title={pathname}>
      {pathname}
    </span>
  );
});

RoutePathWidget.displayName = 'DevDockRoutePathWidget';

export default RoutePathWidget;
