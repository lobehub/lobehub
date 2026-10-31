'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '14px',
    height: '14px',
    paddingInline: '4px',
    borderRadius: '7px',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorWarning,
    backgroundImage: 'none',
  },
});

const FlagOverrideBadge = memo(() => {
  const overrideCount = useServerConfigStore((s) => Object.keys(s._featureFlagOverrides).length);
  if (overrideCount === 0) return null;
  return <span {...stylex.props(styles.badge)}>{overrideCount}</span>;
});

FlagOverrideBadge.displayName = 'DevFeatureFlagPanel/Badge';

export default FlagOverrideBadge;
