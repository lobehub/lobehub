'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-width: 14px;
    height: 14px;
    padding-inline: 4px;
    border-radius: 7px;

    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorWarning};
  `,
}));

const FlagOverrideBadge = memo(() => {
  const overrideCount = useServerConfigStore((s) => Object.keys(s._featureFlagOverrides).length);
  if (overrideCount === 0) return null;
  return <span className={styles.badge}>{overrideCount}</span>;
});

FlagOverrideBadge.displayName = 'DevFeatureFlagPanel/Badge';

export default FlagOverrideBadge;
